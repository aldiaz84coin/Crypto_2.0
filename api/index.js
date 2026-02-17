// api/index.js — Crypto Detector v2.0
'use strict';

const express = require('express');
const axios   = require('axios');
const { Packer } = require('docx');

const app = express();
app.use(require('cors')());
app.use(express.json({ limit: '5mb' }));

// ── Redis ─────────────────────────────────────────────────────────────────────
let redis = null;
try {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url, token });
    console.log('✅ Redis conectado');
  } else {
    console.warn('⚠️  Redis no configurado (sin KV_REST_API_URL / KV_REST_API_TOKEN)');
  }
} catch (e) {
  console.error('⚠️  Redis init error:', e.message);
}

// ── Módulos ───────────────────────────────────────────────────────────────────
const algorithmConfig = require('./algorithm-config');
const boostPowerCalc  = require('./boost-power-calculator');
const cyclesManager   = require('./cycles-manager');
const reportGenerator = require('./report-generator');
const apiHealthCheck  = require('./api-health-check');

const DEFAULT_CONFIG = algorithmConfig.DEFAULT_CONFIG;

// ── Redis helpers ─────────────────────────────────────────────────────────────
// Upstash deserializa automáticamente — nunca JSON.parse/stringify
async function redisGet(key) {
  if (!redis) return null;
  try { return await redis.get(key) ?? null; }
  catch (e) { console.error(`Redis GET ${key}:`, e.message); return null; }
}
async function redisSet(key, value) {
  if (!redis) throw new Error('Redis no disponible');
  try { await redis.set(key, value); return true; }
  catch (e) { console.error(`Redis SET ${key}:`, e.message); throw e; }
}
async function getConfig() {
  const stored = await redisGet('algorithm-config');
  let cfg = null;
  if (stored && typeof stored === 'object') cfg = stored;
  else if (stored && typeof stored === 'string') { try { cfg = JSON.parse(stored); } catch(_){} }
  if (!cfg) return { ...DEFAULT_CONFIG };

  // Migrar configs v1 (factorWeights) a v2 (potentialWeights + resistanceWeights)
  if (!cfg.potentialWeights || !cfg.resistanceWeights) {
    console.log('Config v1 detectada en Redis — migrando a v2');
    cfg = { ...DEFAULT_CONFIG, lastModified: new Date().toISOString() };
    // Guardar la nueva config para evitar migraciones futuras
    try { await redisSet('algorithm-config', cfg); } catch(_) {}
  }
  return cfg;
}
async function getRedisKey(envName) {
  const env = process.env[envName];
  if (env) return env;
  if (!redis) return null;
  try {
    const v = await redis.get('apikey:' + envName);
    return (v && typeof v === 'string' && v.trim()) ? v.trim() : null;
  } catch(_) { return null; }
}

// ── Sentiment helper ──────────────────────────────────────────────────────────
function analyzeSentiment(text) {
  const t = (text || '').toLowerCase();
  const pos = ['surge','gain','rise','bullish','adoption','partnership','upgrade','success',
               'growth','rally','recovery','innovation','launch','profit','momentum','soar',
               'pump','ath','milestone','integration','buy'];
  const neg = ['crash','drop','decline','bearish','hack','scam','ban','lawsuit','loss',
               'collapse','warning','fear','correction','fraud','exploit','plunge','dump',
               'sell','warning','risk','concern','investigation'];
  let score = 0;
  pos.forEach(w => { if (t.includes(w)) score++; });
  neg.forEach(w => { if (t.includes(w)) score--; });
  const normalized = Math.max(-1, Math.min(1, score / 3));
  return { score: normalized, label: normalized > 0.2 ? 'positive' : normalized < -0.2 ? 'negative' : 'neutral' };
}

// ── Fear & Greed ──────────────────────────────────────────────────────────────
async function getFearGreedIndex() {
  try {
    const r = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 4000 });
    const d = r.data?.data?.[0];
    if (d) return { success: true, value: parseInt(d.value), classification: d.value_classification };
  } catch(_) {}
  return { success: false };
}

// ── Noticias genéricas de mercado ─────────────────────────────────────────────
async function getMarketNews(limit = 10) {
  try {
    const key = await getRedisKey('CRYPTOCOMPARE_API_KEY');
    const headers = key ? { authorization: `Apikey ${key}` } : {};
    const r = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', {
      headers, timeout: 5000
    });
    if (r.data?.Data) {
      const articles = r.data.Data.slice(0, limit).map(a => ({
        id:        a.id,
        title:     a.title,
        url:       a.url,
        source:    a.source_info?.name || a.source,
        publishedAt: new Date(a.published_on * 1000).toISOString(),
        categories: a.categories,
        sentiment: analyzeSentiment(a.title + ' ' + (a.body || '')),
        tags:      (a.tags || '').split('|').filter(Boolean)
      }));
      const avgSentiment = articles.reduce((s, a) => s + a.sentiment.score, 0) / articles.length;
      return { success: true, count: articles.length, articles, avgSentiment };
    }
  } catch(_) {}
  return { success: false, count: 0, articles: [], avgSentiment: 0 };
}

// ── Noticias filtradas por activo ─────────────────────────────────────────────
async function getAssetNews(symbol, name) {
  try {
    // Primero intentar NewsAPI si está configurada (más relevante por símbolo)
    const newsApiKey = await getRedisKey('NEWSAPI_KEY');
    if (newsApiKey) {
      const query = `${name} OR ${symbol.toUpperCase()} crypto`;
      const r = await axios.get('https://newsapi.org/v2/everything', {
        timeout: 5000,
        params: { q: query, pageSize: 5, sortBy: 'publishedAt', language: 'en', apiKey: newsApiKey }
      });
      if (r.data?.status === 'ok' && r.data.articles?.length > 0) {
        const articles = r.data.articles.map(a => ({
          title:       a.title,
          url:         a.url,
          source:      a.source?.name,
          publishedAt: a.publishedAt,
          sentiment:   analyzeSentiment(a.title + ' ' + (a.description || ''))
        }));
        const avgSentiment = articles.reduce((s, a) => s + a.sentiment.score, 0) / articles.length;
        return { success: true, count: articles.length, articles, avgSentiment };
      }
    }

    // Fallback: filtrar noticias de CryptoCompare por el símbolo en el título
    const key = await getRedisKey('CRYPTOCOMPARE_API_KEY');
    const headers = key ? { authorization: `Apikey ${key}` } : {};
    const r = await axios.get(`https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${symbol.toUpperCase()}`, {
      headers, timeout: 5000
    });
    if (r.data?.Data?.length > 0) {
      const articles = r.data.Data.slice(0, 5).map(a => ({
        title:       a.title,
        url:         a.url,
        source:      a.source_info?.name || a.source,
        publishedAt: new Date(a.published_on * 1000).toISOString(),
        sentiment:   analyzeSentiment(a.title + ' ' + (a.body || ''))
      }));
      const avgSentiment = articles.reduce((s, a) => s + a.sentiment.score, 0) / articles.length;
      return { success: true, count: articles.length, articles, avgSentiment };
    }
  } catch(_) {}
  return { success: false, count: 0, articles: [], avgSentiment: 0 };
}

// ── Reddit por activo ─────────────────────────────────────────────────────────
async function getAssetReddit(symbol, name) {
  try {
    // Buscar en r/cryptocurrency y r/CryptoMarkets menciones del activo
    const query = encodeURIComponent(`${name} OR ${symbol.toUpperCase()}`);
    const r = await axios.get(
      `https://www.reddit.com/r/CryptoCurrency/search.json?q=${query}&sort=new&limit=10&t=day&restrict_sr=1`,
      { timeout: 5000, headers: { 'User-Agent': 'CryptoDetector/2.0' } }
    );
    if (r.data?.data?.children?.length > 0) {
      const posts = r.data.data.children.map(p => ({
        title:     p.data.title,
        score:     p.data.score,
        comments:  p.data.num_comments,
        url:       `https://reddit.com${p.data.permalink}`,
        created:   new Date(p.data.created_utc * 1000).toISOString(),
        sentiment: analyzeSentiment(p.data.title + ' ' + (p.data.selftext || ''))
      }));
      const postCount    = posts.length;
      const totalScore   = posts.reduce((s, p) => s + p.score, 0);
      const avgSentiment = posts.reduce((s, p) => s + p.sentiment.score, 0) / postCount;
      return { success: true, postCount, totalScore, avgSentiment, posts };
    }
  } catch(_) {}
  return { success: false, postCount: 0, totalScore: 0, avgSentiment: 0, posts: [] };
}

// ════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '2.0.0', redis: redis ? 'connected' : 'not available', timestamp: new Date().toISOString() });
});

app.get('/api/debug/redis', async (_req, res) => {
  if (!redis) return res.json({ success: false, error: 'Redis no configurado' });
  try {
    await redisSet('_debug_test', { ok: true, ts: Date.now() });
    const back = await redisGet('_debug_test');
    const activeIds = await cyclesManager.getActiveCycles(redis);
    res.json({ success: true, writeRead: !!back, activeIds, env: { hasUrl: !!process.env.KV_REST_API_URL, hasToken: !!process.env.KV_REST_API_TOKEN } });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/debug/cycles', async (_req, res) => {
  if (!redis) return res.json({ success: false, error: 'Redis no configurado' });
  try {
    const raw = await redis.get('active_cycles');
    const activeIds = await cyclesManager.getActiveCycles(redis);
    let firstCycle = null;
    if (activeIds.length > 0) firstCycle = await cyclesManager.getCycle(redis, activeIds[0]);
    res.json({ success: true, rawType: typeof raw, rawActiveValue: raw, activeIds,
      firstCycle: firstCycle ? { id: firstCycle.id, status: firstCycle.status, assetsCount: firstCycle.snapshot?.length } : null });
  } catch(e) { res.json({ success: false, error: e.message }); }
});

// ── Config ────────────────────────────────────────────────────────────────────
app.get('/api/config', async (_req, res) => {
  try { res.json({ success: true, config: await getConfig() }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ success: false, error: 'Se requiere "config"' });
    const v = algorithmConfig.validateConfig(config);
    if (!v.valid) return res.status(400).json({ success: false, errors: v.errors });
    config.lastModified = new Date().toISOString();
    config.version = '2.0.0';
    await redisSet('algorithm-config', config);
    res.json({ success: true, config });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/config/reset', async (_req, res) => {
  try {
    const config = { ...DEFAULT_CONFIG, lastModified: new Date().toISOString() };
    await redisSet('algorithm-config', config);
    res.json({ success: true, config });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/config/metadata', (_req, res) => {
  try { res.json({ success: true, metadata: algorithmConfig.getFactorMetadata() }); }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/config/api-key', async (req, res) => {
  try {
    const { apiName, apiKey } = req.body;
    const allowed = ['CRYPTOCOMPARE_API_KEY','NEWSAPI_KEY','GITHUB_TOKEN','TELEGRAM_BOT_TOKEN',
                     'SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY','WHALE_ALERT_API_KEY'];
    if (!allowed.includes(apiName)) return res.status(400).json({ success: false, error: 'API name no permitida' });
    await redisSet(`apikey:${apiName}`, apiKey?.trim() || '');
    res.json({ success: true, message: `Key guardada para ${apiName}` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/config/api-keys', async (_req, res) => {
  try {
    const names = ['CRYPTOCOMPARE_API_KEY','NEWSAPI_KEY','GITHUB_TOKEN','TELEGRAM_BOT_TOKEN',
                   'SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY','WHALE_ALERT_API_KEY'];
    const keys = {};
    for (const n of names) {
      const v = await redisGet(`apikey:${n}`);
      keys[n] = (v && v !== '' && v !== '""') ? '••••••' : '';
    }
    res.json({ success: true, keys });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Datos de mercado (lista completa) ─────────────────────────────────────────
app.get('/api/crypto', async (_req, res) => {
  try {
    const config = await getConfig();

    const [marketRes, fgRes, newsRes] = await Promise.allSettled([
      axios.get(
        'https://api.coingecko.com/api/v3/coins/markets' +
        '?vs_currency=usd&order=market_cap_desc&per_page=20&page=1' +
        '&sparkline=false&price_change_percentage=24h,7d',
        { timeout: 8000 }
      ),
      getFearGreedIndex(),
      getMarketNews(10)
    ]);

    if (marketRes.status === 'rejected')
      throw new Error('CoinGecko no disponible: ' + marketRes.reason?.message);

    const fg   = fgRes.status === 'fulfilled'   ? fgRes.value   : { success: false };
    const news = newsRes.status === 'fulfilled'  ? newsRes.value : { success: false, count: 0, articles: [], avgSentiment: 0 };

    const externalData = {
      fearGreed:  fg.success   ? fg   : null,
      marketNews: news.success ? news : null,
      // assetNews y assetReddit se rellenan en /api/crypto/:id/detail
      assetNews:   null,
      assetReddit: null
    };

    const cryptosWithBoost = marketRes.value.data.map(crypto => {
      const result = boostPowerCalc.calculateBoostPower(crypto, config, externalData);
      return {
        id:                              crypto.id,
        symbol:                          crypto.symbol,
        name:                            crypto.name,
        image:                           crypto.image,
        current_price:                   crypto.current_price,
        market_cap:                      crypto.market_cap,
        market_cap_rank:                 crypto.market_cap_rank,
        total_volume:                    crypto.total_volume,
        price_change_percentage_24h:     crypto.price_change_percentage_24h,
        price_change_percentage_7d_in_currency: crypto.price_change_percentage_7d_in_currency,
        ath:                             crypto.ath,
        atl:                             crypto.atl,
        atl_date:                        crypto.atl_date,
        circulating_supply:              crypto.circulating_supply,
        total_supply:                    crypto.total_supply,
        boostPower:                      result.boostPower,
        boostPowerPercent:               result.boostPowerPercent,
        predictedChange:                 result.predictedChange,
        classification:                  result.classification.category,
        classificationDetail:            result.classification,
        color:                           result.classification.color,
        breakdown:                       result.breakdown,
        summary:                         boostPowerCalc.generateSummary(crypto, result, externalData)
      };
    });

    cryptosWithBoost.sort((a, b) => b.boostPower - a.boostPower);

    res.json({
      success: true,
      data: cryptosWithBoost,
      marketContext: {
        fearGreed:     fg.success ? { value: fg.value, classification: fg.classification } : null,
        newsCount:     news.count || 0,
        newsAvgSentiment: news.avgSentiment || 0,
        topHeadlines:  (news.articles || []).slice(0, 3).map(a => ({ title: a.title, sentiment: a.sentiment, url: a.url }))
      },
      timestamp: new Date().toISOString()
    });
  } catch(e) {
    console.error('/api/crypto error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Detalle de activo individual ──────────────────────────────────────────────
app.get('/api/crypto/:id/detail', async (req, res) => {
  try {
    const config = await getConfig();
    const { id } = req.params;

    // Datos en paralelo: mercado + detail de CoinGecko + noticias + reddit + FGI
    const [marketRes, detailRes, fgRes] = await Promise.allSettled([
      axios.get(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${id}` +
        `&order=market_cap_desc&per_page=1&sparkline=false&price_change_percentage=24h,7d,30d`,
        { timeout: 6000 }
      ),
      axios.get(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`, { timeout: 6000 }),
      getFearGreedIndex()
    ]);

    const crypto = marketRes.status === 'fulfilled' ? marketRes.value.data[0] : null;
    if (!crypto) return res.status(404).json({ success: false, error: `Activo ${id} no encontrado` });

    const detail = detailRes.status === 'fulfilled' ? detailRes.value.data : null;
    const fg     = fgRes.status === 'fulfilled'     ? fgRes.value           : { success: false };

    // Enricher con datos del detail (30d, links, etc.)
    if (detail?.market_data) {
      crypto.price_change_percentage_30d = detail.market_data.price_change_percentage_30d;
      crypto.price_change_percentage_7d_in_currency = detail.market_data.price_change_percentage_7d_in_currency?.usd;
      crypto.circulating_supply = detail.market_data.circulating_supply;
      crypto.total_supply       = detail.market_data.total_supply;
      crypto.max_supply         = detail.market_data.max_supply;
    }

    // Noticias y Reddit en paralelo
    const [newsRes, redditRes] = await Promise.allSettled([
      getAssetNews(crypto.symbol, crypto.name),
      getAssetReddit(crypto.symbol, crypto.name)
    ]);

    const assetNews   = newsRes.status   === 'fulfilled' ? newsRes.value   : { success: false, count: 0, articles: [], avgSentiment: 0 };
    const assetReddit = redditRes.status === 'fulfilled' ? redditRes.value : { success: false, postCount: 0, posts: [] };

    const externalData = {
      fearGreed:   fg.success        ? fg          : null,
      assetNews:   assetNews.success ? assetNews   : null,
      assetReddit: assetReddit.success ? assetReddit : null,
      marketNews:  null
    };

    const result  = boostPowerCalc.calculateBoostPower(crypto, config, externalData);
    const summary = boostPowerCalc.generateSummary(crypto, result, externalData);

    res.json({
      success: true,
      asset: {
        id:            crypto.id,
        symbol:        crypto.symbol,
        name:          crypto.name,
        image:         crypto.image || detail?.image?.large,
        current_price: crypto.current_price,
        market_cap:    crypto.market_cap,
        total_volume:  crypto.total_volume,
        ath:           crypto.ath,
        ath_date:      crypto.ath_date,
        atl:           crypto.atl,
        atl_date:      crypto.atl_date,
        circulating_supply: crypto.circulating_supply,
        total_supply:       crypto.total_supply,
        max_supply:         crypto.max_supply,
        change24h:  crypto.price_change_percentage_24h,
        change7d:   crypto.price_change_percentage_7d_in_currency,
        change30d:  crypto.price_change_percentage_30d,
        // Análisis
        boostPower:         result.boostPower,
        boostPowerPercent:  result.boostPowerPercent,
        predictedChange:    result.predictedChange,
        classification:     result.classification,
        breakdown:          result.breakdown,
        summary,
        // Datos cualitativos del activo
        news:   assetNews.success   ? { count: assetNews.count,     avgSentiment: assetNews.avgSentiment,     articles: assetNews.articles }   : null,
        reddit: assetReddit.success ? { postCount: assetReddit.postCount, avgSentiment: assetReddit.avgSentiment, posts: assetReddit.posts } : null,
        fearGreed: fg.success ? { value: fg.value, classification: fg.classification } : null
      }
    });
  } catch(e) {
    console.error('/api/crypto/:id/detail error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Estado APIs ───────────────────────────────────────────────────────────────
app.get('/api/status/complete', async (_req, res) => {
  try {
    const status = await apiHealthCheck.checkAllAPIs(redis);
    res.json({ success: true, ...status });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// CICLOS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/cycles/start', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  const { snapshot, durationMs } = req.body;
  if (!snapshot?.length) return res.status(400).json({ success: false, error: 'Se requiere snapshot con activos' });

  const dur = parseInt(durationMs);
  const finalDuration = (!isNaN(dur) && dur >= 60000 && dur <= 7 * 86400000) ? dur : 43200000;

  try {
    const config = await getConfig();
    const cycle  = await cyclesManager.createCycle(redis, snapshot, config, finalDuration);
    res.json({ success: true, cycle: { id: cycle.id, startTime: cycle.startTime, endTime: cycle.endTime, durationMs: cycle.durationMs, assetsCount: cycle.snapshot.length } });
  } catch(e) {
    console.error('cycles/start:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/active', async (_req, res) => {
  if (!redis) return res.json({ success: true, cycles: [] });
  try {
    const ids    = await cyclesManager.getActiveCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, ids);
    const now = Date.now();
    cycles.forEach(c => { c.timeRemaining = Math.max(0, c.endTime - now); });
    res.json({ success: true, cycles });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/cycles/pending', async (_req, res) => {
  if (!redis) return res.json({ success: true, cycles: [] });
  try {
    const pending = await cyclesManager.detectPendingCycles(redis);
    res.json({ success: true, cycles: pending });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Completar ciclo — usa validación honesta del nuevo algoritmo
app.post('/api/cycles/:cycleId/complete', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const config  = await getConfig();
    const prices  = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1',
      { timeout: 8000 }
    );
    const cycle = await cyclesManager.completeCycle(redis, req.params.cycleId, prices.data, config);
    res.json({ success: true, cycle: { id: cycle.id, metrics: cycle.metrics, completedAt: cycle.completedAt } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/cycles/history', async (_req, res) => {
  if (!redis) return res.json({ success: true, cycles: [] });
  try {
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, ids);
    res.json({ success: true, cycles });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/cycles/stats/global', async (_req, res) => {
  if (!redis) return res.json({ success: true, stats: { totalCycles: 0, totalPredictions: 0, avgSuccessRate: '0.00' } });
  try {
    const stats = await cyclesManager.getGlobalStats(redis);
    res.json({ success: true, stats });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/cycles/:cycleId', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    res.json({ success: true, cycle });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/cycles/:cycleId/results/:assetId/toggle-exclude', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  const { cycleId, assetId } = req.params;
  try {
    const cycle = await cyclesManager.getCycle(redis, cycleId);
    if (!cycle)                       return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status !== 'completed') return res.status(400).json({ success: false, error: 'Ciclo no completado' });

    const excluded = cycle.excludedResults || [];
    const idx = excluded.indexOf(assetId);
    if (idx === -1) excluded.push(assetId); else excluded.splice(idx, 1);
    cycle.excludedResults = excluded;
    cycle.metrics = cyclesManager.recalculateMetrics(cycle.results.filter(r => !excluded.includes(r.id)));
    await redisSet(cycleId, cycle);
    res.json({ success: true, excluded, metrics: cycle.metrics, isExcluded: excluded.includes(assetId) });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/cycles/:cycleId/report', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycle)                       return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status !== 'completed') return res.status(400).json({ success: false, error: 'Ciclo aún no completado' });
    const doc    = reportGenerator.generateCycleReport(cycle);
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=Informe_${req.params.cycleId}.docx`);
    res.send(buffer);
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Arranque local ────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}

module.exports = app;
