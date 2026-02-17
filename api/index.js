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

// ── CoinDesk RSS ─────────────────────────────────────────────────────────────
async function getCoinDeskNews(symbol, name) {
  try {
    // CoinDesk tiene RSS público — usar XML parseado como texto
    const r = await axios.get('https://www.coindesk.com/arc/outboundfeeds/rss/', {
      timeout: 5000, headers: { 'User-Agent': 'CryptoDetector/2.0', 'Accept': 'application/rss+xml' }
    });
    const xml = r.data || '';
    // Parseo simple de RSS sin xml2js
    const items = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    const sym = symbol.toUpperCase();
    const nameLower = name.toLowerCase();
    itemMatches.slice(0, 30).forEach(item => {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const link  = (item.match(/<link>(.*?)<\/link>/))?.[1] || '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || '';
      const titleL = title.toLowerCase();
      if (titleL.includes(sym.toLowerCase()) || titleL.includes(nameLower) ||
          titleL.includes('crypto') || titleL.includes('bitcoin') || titleL.includes('ethereum')) {
        items.push({ title, url: link, publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          source: 'CoinDesk', sentiment: analyzeSentiment(title) });
      }
    });
    if (items.length > 0) {
      // Filtrar los específicos del activo
      const specific = items.filter(i => {
        const t = i.title.toLowerCase();
        return t.includes(sym.toLowerCase()) || t.includes(nameLower);
      });
      const use = specific.length > 0 ? specific : items.slice(0, 5);
      const avg = use.reduce((s, i) => s + i.sentiment.score, 0) / use.length;
      return { success: true, count: use.length, articles: use, avgSentiment: avg, source: 'coindesk' };
    }
  } catch(_) {}
  return { success: false, count: 0, articles: [], avgSentiment: 0 };
}

// ── CoinTelegraph RSS ─────────────────────────────────────────────────────────
async function getCoinTelegraphNews(symbol, name) {
  try {
    const r = await axios.get('https://cointelegraph.com/rss', {
      timeout: 5000, headers: { 'User-Agent': 'CryptoDetector/2.0', 'Accept': 'application/rss+xml' }
    });
    const xml = r.data || '';
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    const sym = symbol.toUpperCase();
    const nameLower = name.toLowerCase();
    const items = [];
    itemMatches.slice(0, 30).forEach(item => {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const link  = (item.match(/<link>(.*?)<\/link>/))?.[1] ||
                    (item.match(/<guid[^>]*>(.*?)<\/guid>/))?.[1] || '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || '';
      const titleL = title.toLowerCase();
      if (titleL.includes(sym.toLowerCase()) || titleL.includes(nameLower)) {
        items.push({ title, url: link, publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          source: 'CoinTelegraph', sentiment: analyzeSentiment(title) });
      }
    });
    if (items.length > 0) {
      const avg = items.reduce((s, i) => s + i.sentiment.score, 0) / items.length;
      return { success: true, count: items.length, articles: items.slice(0, 5), avgSentiment: avg, source: 'cointelegraph' };
    }
  } catch(_) {}
  return { success: false, count: 0, articles: [], avgSentiment: 0 };
}

// ── LunarCrush (social data) ─────────────────────────────────────────────────
// API pública v2 — no requiere key para datos básicos de coins
async function getLunarCrushData(symbol) {
  try {
    const key = await getRedisKey('LUNARCRUSH_API_KEY');
    const url = key
      ? `https://lunarcrush.com/api4/public/coins/${symbol.toLowerCase()}/v1`
      : `https://lunarcrush.com/api4/public/coins/list/v2?limit=1&sort=social_score&filter=${symbol.toUpperCase()}`;
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const r = await axios.get(url, { timeout: 5000, headers: { ...headers, 'User-Agent': 'CryptoDetector/2.0' } });
    const data = r.data?.data;
    if (!data) return { success: false };
    const coin = Array.isArray(data) ? data[0] : data;
    if (!coin) return { success: false };
    return {
      success: true,
      socialScore:      coin.social_score         ?? coin.social_dominance ?? null,
      socialVolume:     coin.social_volume         ?? null,
      socialSentiment:  coin.sentiment             ?? coin.social_score_calc_24h ?? null,
      galaxyScore:      coin.galaxy_score          ?? null,
      altRank:          coin.alt_rank              ?? null,
      tweetVolume:      coin.tweet_mentions        ?? coin.twitter_volume  ?? null,
      redditPosts:      coin.reddit_posts          ?? null,
      newsVolume:       coin.news_articles         ?? null,
      source: 'lunarcrush'
    };
  } catch(_) {}
  return { success: false };
}

// ── Santiment (social + dev activity) ────────────────────────────────────────
async function getSantimentData(symbol) {
  try {
    const key = await getRedisKey('SANTIMENT_API_KEY');
    if (!key) return { success: false, reason: 'no_key' };
    const slug = symbol.toLowerCase();
    const query = `{
      socialVolume: socialVolume(slug: "${slug}", from: "utc_now-1d", to: "utc_now", interval: "1d", socialVolumeType: TOTAL_MENTIONS) { value }
      socialDominance: socialDominance(slug: "${slug}", from: "utc_now-1d", to: "utc_now", interval: "1d", source: ALL) { value }
      devActivity: devActivity(slug: "${slug}", from: "utc_now-7d", to: "utc_now", interval: "7d") { value }
    }`;
    const r = await axios.post('https://api.santiment.net/graphql',
      { query },
      { timeout: 6000, headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${key}` } }
    );
    const d = r.data?.data;
    if (!d) return { success: false };
    return {
      success: true,
      socialVolume:    d.socialVolume?.[0]?.value     ?? null,
      socialDominance: d.socialDominance?.[0]?.value  ?? null,
      devActivity:     d.devActivity?.[0]?.value       ?? null,
      source: 'santiment'
    };
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

// ── Reddit por activo — multi-subreddit ───────────────────────────────────────
// Subreddits relevantes según capitalización del activo
function getSubredditsForAsset(symbol, marketCap) {
  const sym = symbol.toUpperCase();
  // Subreddits propios del activo (los más conocidos)
  const ownSubs = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binance',
    ADA: 'cardano', DOT: 'polkadot', AVAX: 'Avax', MATIC: 'maticnetwork',
    LINK: 'Chainlink', XRP: 'Ripple', DOGE: 'dogecoin', SHIB: 'SHIBArmy',
    LTC: 'litecoin', UNI: 'Uniswap', ATOM: 'cosmosnetwork'
  };
  // Siempre buscar en los subreddits generales de crypto
  const general = ['CryptoCurrency', 'CryptoMarkets', 'altcoin'];
  // Para pequeñas caps: moonshots y altcoins específicos
  const speculative = (marketCap || 0) < 500e6
    ? ['CryptoMoonShots', 'SatoshiStreetBets', 'altcoins']
    : [];
  const own = ownSubs[sym] ? [ownSubs[sym]] : [];
  return [...new Set([...own, ...general, ...speculative])];
}

async function getAssetReddit(symbol, name, marketCap) {
  try {
    const sym  = symbol.toUpperCase();
    const subs = getSubredditsForAsset(sym, marketCap);

    // Estrategia: buscar en múltiples subreddits en paralelo
    // Usar búsqueda global (sin restrict_sr) con términos precisos
    const queries = [
      sym,                    // ticker exacto: "ETH"
      `${sym} crypto`,        // "ETH crypto"
      name.split(' ')[0]      // primera palabra del nombre: "Ethereum"
    ];

    const allPosts = [];

    // Búsqueda 1: subreddit propio (si existe) — más relevante
    if (subs[0] !== 'CryptoCurrency') {
      try {
        const ownSub = subs[0];
        const r = await axios.get(
          `https://www.reddit.com/r/${ownSub}/hot.json?limit=5`,
          { timeout: 4000, headers: { 'User-Agent': 'CryptoDetector/2.0 (research bot)' } }
        );
        const posts = r.data?.data?.children || [];
        posts.forEach(p => {
          if (p.data.ups > 5) allPosts.push({ ...p.data, subreddit: ownSub, relevance: 'own' });
        });
      } catch(_) {}
    }

    // Búsqueda 2: búsqueda global por ticker en subreddits generales (sin restrict_sr)
    try {
      const q = encodeURIComponent(sym);
      const r = await axios.get(
        `https://www.reddit.com/search.json?q=${q}&sort=new&limit=15&t=day&type=link`,
        { timeout: 5000, headers: { 'User-Agent': 'CryptoDetector/2.0 (research bot)' } }
      );
      const posts = r.data?.data?.children || [];
      // Filtrar solo subreddits de crypto
      const cryptoSubs = new Set(['CryptoCurrency','CryptoMarkets','altcoin','CryptoMoonShots',
        'SatoshiStreetBets','altcoins','Bitcoin','ethereum','binance','cardano','solana',
        'investing','stocks','wallstreetbets','Superstonk']);
      posts.forEach(p => {
        if (cryptoSubs.has(p.data.subreddit)) {
          allPosts.push({ ...p.data, subreddit: p.data.subreddit, relevance: 'search' });
        }
      });
    } catch(_) {}

    // Búsqueda 3: CryptoMoonShots para small-caps
    if ((marketCap || 0) < 500e6) {
      try {
        const q = encodeURIComponent(sym);
        const r = await axios.get(
          `https://www.reddit.com/r/CryptoMoonShots+SatoshiStreetBets/search.json?q=${q}&sort=new&limit=10&t=week&restrict_sr=1`,
          { timeout: 4000, headers: { 'User-Agent': 'CryptoDetector/2.0 (research bot)' } }
        );
        const posts = r.data?.data?.children || [];
        posts.forEach(p => allPosts.push({ ...p.data, subreddit: p.data.subreddit, relevance: 'moonshots' }));
      } catch(_) {}
    }

    // Deduplicar por id y ordenar por score
    const seen = new Set();
    const unique = allPosts
      .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      .sort((a, b) => (b.ups || 0) - (a.ups || 0))
      .slice(0, 10);

    if (unique.length === 0) {
      return { success: false, postCount: 0, totalScore: 0, avgSentiment: 0, posts: [] };
    }

    const posts = unique.map(p => ({
      title:     p.title,
      score:     p.ups || 0,
      comments:  p.num_comments || 0,
      subreddit: p.subreddit,
      relevance: p.relevance,
      url:       `https://reddit.com${p.permalink}`,
      created:   new Date(p.created_utc * 1000).toISOString(),
      sentiment: analyzeSentiment(p.title + ' ' + (p.selftext || ''))
    }));

    const postCount    = posts.length;
    const totalScore   = posts.reduce((s, p) => s + p.score, 0);
    const avgSentiment = posts.reduce((s, p) => s + p.sentiment.score, 0) / postCount;
    return { success: true, postCount, totalScore, avgSentiment, posts, subredditsSearched: subs };

  } catch(e) {
    return { success: false, postCount: 0, totalScore: 0, avgSentiment: 0, posts: [], error: e.message };
  }
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
                     'SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY',
                     'WHALE_ALERT_API_KEY','LUNARCRUSH_API_KEY','SANTIMENT_API_KEY'];
    if (!allowed.includes(apiName)) return res.status(400).json({ success: false, error: 'API name no permitida' });
    await redisSet(`apikey:${apiName}`, apiKey?.trim() || '');
    res.json({ success: true, message: `Key guardada para ${apiName}` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/config/api-keys', async (_req, res) => {
  try {
    const names = ['CRYPTOCOMPARE_API_KEY','NEWSAPI_KEY','GITHUB_TOKEN','TELEGRAM_BOT_TOKEN',
                   'SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY',
                   'WHALE_ALERT_API_KEY','LUNARCRUSH_API_KEY','SANTIMENT_API_KEY'];
    const keys = {};
    for (const n of names) {
      const v = await redisGet(`apikey:${n}`);
      keys[n] = (v && v !== '' && v !== '""') ? '••••••' : '';
    }
    res.json({ success: true, keys });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Datos de mercado (lista completa) ─────────────────────────────────────────
// mode: 'normal' | 'speculative'
// En modo especulativo: excluir large-caps y mid-high caps
// Pide más activos y filtra por market cap
const SPECULATIVE_CAP_MAX = 200_000_000;  // $200M máximo
const SPECULATIVE_VOL_MAX = 50_000_000;   // $50M volumen máximo

app.get('/api/crypto', async (_req, res) => {
  try {
    const config = await getConfig();
    const mode   = req.query.mode || 'normal'; // ?mode=speculative

    // Especulativo: pedir 100 activos y filtrar; normal: top 20 por market cap
    const perPage = mode === 'speculative' ? 250 : 20;

    const [marketRes, fgRes, newsRes] = await Promise.allSettled([
      axios.get(
        'https://api.coingecko.com/api/v3/coins/markets' +
        `?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1` +
        '&sparkline=false&price_change_percentage=24h,7d',
        { timeout: 10000 }
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

    // Filtrar activos según el modo
    let rawCryptos = marketRes.value.data;
    if (mode === 'speculative') {
      rawCryptos = rawCryptos.filter(c =>
        (c.market_cap  || 0) <= SPECULATIVE_CAP_MAX &&
        (c.total_volume || 0) <= SPECULATIVE_VOL_MAX
      ).slice(0, 20); // Top 20 small-caps por market cap
    }

    const cryptosWithBoost = rawCryptos.map(crypto => {
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

    // Todas las fuentes en paralelo
    const [newsRes, redditRes, coinDeskRes, coinTelRes, lunarRes, santRes] = await Promise.allSettled([
      getAssetNews(crypto.symbol, crypto.name),
      getAssetReddit(crypto.symbol, crypto.name, crypto.market_cap),
      getCoinDeskNews(crypto.symbol, crypto.name),
      getCoinTelegraphNews(crypto.symbol, crypto.name),
      getLunarCrushData(crypto.symbol),
      getSantimentData(crypto.symbol)
    ]);

    const assetNews    = newsRes.status      === 'fulfilled' ? newsRes.value      : { success: false, count: 0, articles: [], avgSentiment: 0 };
    const assetReddit  = redditRes.status    === 'fulfilled' ? redditRes.value    : { success: false, postCount: 0, posts: [] };
    const coinDesk     = coinDeskRes.status  === 'fulfilled' ? coinDeskRes.value  : { success: false };
    const coinTel      = coinTelRes.status   === 'fulfilled' ? coinTelRes.value   : { success: false };
    const lunarCrush   = lunarRes.status     === 'fulfilled' ? lunarRes.value     : { success: false };
    const santiment    = santRes.status      === 'fulfilled' ? santRes.value      : { success: false };

    // Merge de artículos de todas las fuentes de noticias
    const allArticles = [
      ...(assetNews.articles    || []),
      ...(coinDesk.articles     || []),
      ...(coinTel.articles      || [])
    ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const mergedNews = allArticles.length > 0 ? {
      success: true,
      count: allArticles.length,
      articles: allArticles.slice(0, 10),
      avgSentiment: allArticles.reduce((s, a) => s + (a.sentiment?.score || 0), 0) / allArticles.length,
      sources: [assetNews.success && 'NewsAPI/CC', coinDesk.success && 'CoinDesk', coinTel.success && 'CoinTelegraph'].filter(Boolean)
    } : assetNews;

    const externalData = {
      fearGreed:   fg.success            ? fg          : null,
      assetNews:   mergedNews.success    ? mergedNews  : (assetNews.success ? assetNews : null),
      assetReddit: assetReddit.success   ? assetReddit : null,
      lunarCrush:  lunarCrush.success    ? lunarCrush  : null,
      santiment:   santiment.success     ? santiment   : null,
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
        news:       mergedNews.success  ? { count: mergedNews.count, avgSentiment: mergedNews.avgSentiment, articles: mergedNews.articles, sources: mergedNews.sources } : null,
        reddit:     assetReddit.success ? { postCount: assetReddit.postCount, avgSentiment: assetReddit.avgSentiment, posts: assetReddit.posts, subredditsSearched: assetReddit.subredditsSearched } : null,
        lunarCrush: lunarCrush.success  ? lunarCrush : null,
        santiment:  santiment.success   ? santiment  : null,
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
// ANÁLISIS DE SIMULACIONES — Recomendación de ajuste del algoritmo
// ════════════════════════════════════════════════════════════════════════════

const SIGNIFICANT_DURATION_MS = 6 * 3600000; // 6 horas = significativo

// Analizar un conjunto de ciclos y emitir recomendaciones de ajuste
function analyzeSimulations(cycles, config) {
  const significant = cycles.filter(c => (c.durationMs || 0) >= SIGNIFICANT_DURATION_MS && c.status === 'completed');
  const testing     = cycles.filter(c => (c.durationMs || 0) < SIGNIFICANT_DURATION_MS  && c.status === 'completed');

  if (significant.length === 0) {
    return { hasSignificant: false, significantCount: 0, testingCount: testing.length,
      message: 'No hay simulaciones significativas (>6h) para analizar. Las simulaciones cortas (<6h) no se usan para calibrar el algoritmo.' };
  }

  // Métricas agregadas por categoría en simulaciones significativas
  const catStats = { INVERTIBLE: { total:0, correct:0, errors:[] }, APALANCADO: { total:0, correct:0, errors:[] }, RUIDOSO: { total:0, correct:0, errors:[] } };
  const factorDeviations = {}; // acumular desviaciones por categoría

  significant.forEach(cycle => {
    (cycle.results || []).forEach(r => {
      const cat = r.classification || 'RUIDOSO';
      if (catStats[cat]) {
        catStats[cat].total++;
        if (r.correct) catStats[cat].correct++;
        catStats[cat].errors.push(parseFloat(r.error || 0));
      }
    });
  });

  // Calcular accuracy y error promedio por categoría
  const analysis = {};
  const recommendations = [];
  const weightAdjustments = {};

  Object.entries(catStats).forEach(([cat, s]) => {
    if (s.total === 0) return;
    const acc = (s.correct / s.total * 100);
    const avgErr = s.errors.reduce((a,b) => a+b, 0) / s.errors.length;
    const maxErr = Math.max(...s.errors);
    analysis[cat] = { total: s.total, correct: s.correct, accuracy: acc.toFixed(1), avgError: avgErr.toFixed(2), maxError: maxErr.toFixed(2) };

    if (cat === 'INVERTIBLE') {
      if (acc < 40) {
        recommendations.push({ priority:'HIGH', category:cat, issue:`Accuracy ${acc.toFixed(1)}% muy bajo — el algoritmo identifica mal los INVERTIBLES`, suggestion:'Aumentar umbral invertibleMinBoost a ' + Math.min(0.80, (config.classification?.invertibleMinBoost || 0.65) + 0.10).toFixed(2) + ' y reducir invertibleMaxMarketCap' });
        weightAdjustments.classification = { invertibleMinBoost: Math.min(0.80, (config.classification?.invertibleMinBoost || 0.65) + 0.05) };
      } else if (acc > 80) {
        recommendations.push({ priority:'LOW', category:cat, issue:`Accuracy ${acc.toFixed(1)}% excelente`, suggestion:'Parámetros bien calibrados para INVERTIBLE. Considera bajar levemente el umbral para capturar más oportunidades.' });
      } else {
        recommendations.push({ priority:'MEDIUM', category:cat, issue:`Accuracy ${acc.toFixed(1)}% aceptable pero mejorable`, suggestion:'Ajusta magnitudeTolerance a ' + Math.min(15, (config.prediction?.magnitudeTolerance || 5) + 2) + '% para reducir falsos negativos' });
      }
      if (avgErr > 15) {
        recommendations.push({ priority:'HIGH', category:cat, issue:`Error de magnitud ${avgErr.toFixed(1)}% alto en INVERTIBLES`, suggestion:'El target de ' + (config.prediction?.invertibleTarget || 30) + '% es demasiado ambicioso — reducir a ' + Math.max(10, (config.prediction?.invertibleTarget || 30) - 10) + '%' });
        weightAdjustments.prediction = { invertibleTarget: Math.max(10, (config.prediction?.invertibleTarget || 30) - 10) };
      }
    }

    if (cat === 'APALANCADO') {
      if (acc < 35) {
        recommendations.push({ priority:'MEDIUM', category:cat, issue:`Accuracy ${acc.toFixed(1)}% bajo en APALANCADOS`, suggestion:'Aumentar el peso de leverageRatio en resistencia — el sistema subestima la presión vendedora' });
        weightAdjustments.resistanceWeights = { ...(weightAdjustments.resistanceWeights||{}), leverageRatio: Math.min(0.55, (config.resistanceWeights?.leverageRatio || 0.40) + 0.05) };
      }
    }

    if (cat === 'RUIDOSO') {
      if (acc < 50) {
        recommendations.push({ priority:'LOW', category:cat, issue:`RUIDOSO acierta solo ${acc.toFixed(1)}% — muchos activos ruidosos sí se mueven`, suggestion:'Revisar si el umbral apalancadoMinBoost es demasiado alto (activos que deberían ser APALANCADO se clasifican como RUIDOSO)' });
      }
    }
  });

  // Calcular config ajustada sugerida
  const suggestedConfig = JSON.parse(JSON.stringify(config));
  if (weightAdjustments.classification) Object.assign(suggestedConfig.classification, weightAdjustments.classification);
  if (weightAdjustments.prediction)     Object.assign(suggestedConfig.prediction,     weightAdjustments.prediction);
  if (weightAdjustments.resistanceWeights) Object.assign(suggestedConfig.resistanceWeights, weightAdjustments.resistanceWeights);

  const overallAcc = significant.reduce((s, c) => s + parseFloat(c.metrics?.successRate || 0), 0) / significant.length;

  return {
    hasSignificant:   true,
    significantCount: significant.length,
    testingCount:     testing.length,
    overallAccuracy:  overallAcc.toFixed(1),
    analysis,
    recommendations,
    suggestedConfig,
    note: `Basado en ${significant.length} simulaciones significativas (≥6h) con ${significant.reduce((s,c) => s+(c.results?.length||0),0)} predicciones totales.`
  };
}

app.get('/api/simulations/analysis', async (_req, res) => {
  if (!redis) return res.json({ success: false, error: 'Redis no disponible' });
  try {
    const config  = await getConfig();
    const ids     = await cyclesManager.getCompletedCycles(redis);
    const cycles  = await cyclesManager.getCyclesDetails(redis, ids);
    const result  = analyzeSimulations(cycles, config);
    res.json({ success: true, ...result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Aplicar configuración sugerida por el análisis
app.post('/api/simulations/apply-suggestion', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, ids);
    const config = await getConfig();
    const result = analyzeSimulations(cycles, config);
    if (!result.hasSignificant) return res.status(400).json({ success: false, error: result.message });
    const newConfig = { ...result.suggestedConfig, lastModified: new Date().toISOString(), version: '2.0-autocal' };
    await redisSet('algorithm-config', newConfig);
    res.json({ success: true, applied: newConfig, changes: result.recommendations });
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
