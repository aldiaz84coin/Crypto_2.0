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
const boostPowerCalc    = require('./boost-power-calculator');
const cyclesManager     = require('./cycles-manager');
const reportGenerator   = require('./report-generator');
const enhancedReportGen = require('./enhanced-report-generator');
const llmInsights       = require('./llm-insights');
const apiHealthCheck    = require('./api-health-check');
const investManager     = require('./investment-manager');
const getClassificationStr = investManager.getClassificationStr || function(a) {
  const c = a.classification;
  if (!c) return 'RUIDOSO';
  if (typeof c === 'string') return c.toUpperCase();
  if (typeof c === 'object') return (c.category || c.label || 'RUIDOSO').toUpperCase();
  return 'RUIDOSO';
};
const exchangeConnector = require('./exchange-connector');
const pumpDetector      = require('./pump-detector');
const alertService      = require('./alert-service');
const iterationEngine   = require('./iteration-engine');
const scenariosEndpoint = require('./scenarios-endpoint');
const predCalibration   = require('./prediction-calibration');
const roundReportGen    = require('./round-report-generator');

const DEFAULT_CONFIG            = algorithmConfig.DEFAULT_CONFIG;
const DEFAULT_CONFIG_NORMAL     = algorithmConfig.DEFAULT_CONFIG_NORMAL;
const DEFAULT_CONFIG_SPECULATIVE = algorithmConfig.DEFAULT_CONFIG_SPECULATIVE;
const getDefaultConfig          = algorithmConfig.getDefaultConfig;
const getConfigKey              = algorithmConfig.getConfigKey;
const validateConfig            = algorithmConfig.validateConfig;

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
// getConfig(mode) — devuelve la config del modelo correcto
// mode: 'normal' | 'speculative'  (default: 'normal')
async function getConfig(mode = 'normal') {
  const key = getConfigKey(mode);
  const defaultCfg = getDefaultConfig(mode);

  const stored = await redisGet(key);
  let cfg = null;
  if (stored && typeof stored === 'object') cfg = stored;
  else if (stored && typeof stored === 'string') { try { cfg = JSON.parse(stored); } catch(_){} }
  if (!cfg) return { ...defaultCfg };

  // Migrar si el modelo guardado no coincide con el modo pedido
  if (cfg.modelType && cfg.modelType !== mode) {
    console.log(`Config de modo '${cfg.modelType}' no coincide con modo '${mode}' — usando defaults`);
    return { ...defaultCfg };
  }
  // Migrar configs v1/v2 antiguas (sin modelType)
  if (!cfg.modelType || !cfg.potentialWeights || !cfg.resistanceWeights) {
    console.log(`Config sin modelType detectada — migrando a v4.0-${mode}`);
    cfg = { ...defaultCfg, lastModified: new Date().toISOString() };
    try { await redisSet(key, cfg); } catch(_) {}
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

// ── Relevancia: el texto menciona el activo por símbolo o nombre ─────────────
function isRelevantToAsset(text, symbol, name) {
  if (!text) return false;
  const t   = text.toLowerCase();
  const sym = symbol.toLowerCase();
  // Nombres alternativos comunes
  const nameWords = name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return t.includes(sym) || nameWords.some(w => t.includes(w));
}

// ── Recencia: solo artículos de las últimas N horas ───────────────────────────
function isRecent(publishedAt, maxHours = 72) {
  if (!publishedAt) return true; // sin fecha → aceptar por defecto
  const age = (Date.now() - new Date(publishedAt).getTime()) / 3600000;
  return age <= maxHours;
}

// ── Sentiment: diccionario cripto-específico + ponderación por relevancia ──────
function analyzeSentiment(text, symbol = '', name = '') {
  const t = (text || '').toLowerCase();
  // Positivos específicos a cripto (excluir "pump" — es ambiguo/manipulación)
  const pos = [
    'surge','rally','breakout','bullish','adoption','partnership','upgrade',
    'integration','launch','milestone','growth','recovery','soar','outperform',
    'listing','mainnet','staking','yield','accumulate','institutional','etf',
    'approval','record','all-time high'
  ];
  // Negativos específicos a cripto
  const neg = [
    'crash','plunge','collapse','bearish','hack','exploit','scam','rug pull',
    'ban','lawsuit','sec','investigation','fraud','liquidation','dump',
    'delist','fork','vulnerability','breach','ponzi','bubble','correction',
    'suspended','halt','insolvent','bankruptcy'
  ];
  // Palabras que solo pesan si el activo está mencionado (contextuales)
  const contextualPos = ['buy','accumulate','undervalued','breakout','bottom'];
  const contextualNeg = ['sell','overvalued','overbought','warning','risk'];

  const relevant = isRelevantToAsset(text, symbol, name);
  let score = 0;
  pos.forEach(w          => { if (t.includes(w)) score++; });
  neg.forEach(w          => { if (t.includes(w)) score--; });
  // Solo sumar contextuales si el artículo menciona el activo
  if (relevant) {
    contextualPos.forEach(w => { if (t.includes(w)) score += 0.5; });
    contextualNeg.forEach(w => { if (t.includes(w)) score -= 0.5; });
  }
  const normalized = Math.max(-1, Math.min(1, score / 3));
  return {
    score:    normalized,
    label:    normalized > 0.2 ? 'positive' : normalized < -0.2 ? 'negative' : 'neutral',
    relevant  // si el texto menciona el activo explícitamente
  };
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
    itemMatches.slice(0, 40).forEach(item => {
      const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                       item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const link    = (item.match(/<link>(.*?)<\/link>/))?.[1] || '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || '';
      const desc    = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                       item.match(/<description>(.*?)<\/description>/))?.[1] || '';
      const publishedAt = pubDate ? new Date(pubDate).toISOString() : null;
      const text = title + ' ' + desc;
      // FILTRO ESTRICTO: el artículo DEBE mencionar el activo y ser reciente
      if (isRelevantToAsset(text, sym, nameLower) && isRecent(publishedAt, NEWS_MAX_HOURS)) {
        items.push({ title, url: link, publishedAt: publishedAt || new Date().toISOString(),
          source: 'CoinDesk', sentiment: analyzeSentiment(text, sym, nameLower) });
      }
    });
    if (items.length > 0) {
      const avg = items.reduce((s, i) => s + i.sentiment.score, 0) / items.length;
      return { success: true, count: items.length, articles: items.slice(0, 5), avgSentiment: avg, source: 'coindesk' };
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
    itemMatches.slice(0, 40).forEach(item => {
      const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                       item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const link    = (item.match(/<link>(.*?)<\/link>/))?.[1] ||
                      (item.match(/<guid[^>]*>(.*?)<\/guid>/))?.[1] || '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/))?.[1] || '';
      const desc    = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                       item.match(/<description>(.*?)<\/description>/))?.[1] || '';
      const publishedAt = pubDate ? new Date(pubDate).toISOString() : null;
      const text = title + ' ' + desc;
      // FILTRO ESTRICTO: menciona el activo + reciente
      if (isRelevantToAsset(text, sym, nameLower) && isRecent(publishedAt, NEWS_MAX_HOURS)) {
        items.push({ title, url: link, publishedAt: publishedAt || new Date().toISOString(),
          source: 'CoinTelegraph', sentiment: analyzeSentiment(text, sym, nameLower) });
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


// ── Google Trends via SerpAPI ─────────────────────────────────────────────────
// Cache Redis de 12h por activo para no agotar el cupo de 100 busquedas/mes gratuitas.
// La key de cache incluye el simbolo en minusculas: trends:btc, trends:eth, etc.
// Devuelve siempre un objeto con { success, ... } -- nunca lanza excepcion.
async function getGoogleTrends(name, symbol) {
  const cacheKey   = `trends:${symbol.toLowerCase()}`;
  const CACHE_TTL  = 43200; // 12 horas en segundos

  // 1. Verificar cache Redis
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && typeof cached === 'object' && cached.success) {
        return { ...cached, cached: true };
      }
    } catch(_) {}
  }

  // 2. Sin cache -> intentar SerpAPI
  try {
    const apiKey = await getRedisKey('SERPAPI_KEY');
    if (!apiKey) return { success: false, source: 'no_key', estimated: true };

    // Query: "nombre crypto" da mejores resultados que solo el nombre
    const query = `${name} crypto`;
    const r = await axios.get('https://serpapi.com/search', {
      params: {
        engine:    'google_trends',
        q:         query,
        data_type: 'TIMESERIES',
        date:      'now 7-d',   // ultimos 7 dias -- ventana corta, relevante para el ciclo
        api_key:   apiKey
      },
      timeout: 8000
    });

    const timelineData = r.data?.interest_over_time?.timeline_data || [];
    if (timelineData.length < 2) {
      return { success: false, source: 'no_data', estimated: true };
    }

    // Extraer valores de interes (0-100)
    const values = timelineData.map(d => {
      const v = d.values?.[0]?.extracted_value;
      return (v !== undefined && v !== null) ? Number(v) : 0;
    });

    const current   = values[values.length - 1];
    const first     = values[0];
    const average   = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
    const peak      = Math.max(...values);
    const trend     = current > first + 5 ? 'rising'
                    : current < first - 5 ? 'falling' : 'stable';
    const growthPct = first > 0 ? parseFloat(((current - first) / first * 100).toFixed(1)) : 0;

    const result = {
      success:         true,
      currentInterest: current,
      average,
      peak,
      trend,
      growthPercent:   growthPct,
      period:          'ultimos 7 dias',
      source:          'Google Trends (SerpAPI)',
      query,
      fetchedAt:       new Date().toISOString()
    };

    // Guardar en cache con TTL
    if (redis) {
      try { await redis.set(cacheKey, result, { ex: CACHE_TTL }); } catch(_) {}
    }

    return result;
  } catch(e) {
    console.warn(`[GoogleTrends] ${symbol}: ${e.response?.status || e.message}`);
    return { success: false, source: 'error', error: e.message, estimated: true };
  }
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

// ── Noticias filtradas por activo — con validación de relevancia y recencia ───
const NEWS_MAX_HOURS = 72; // solo noticias de las últimas 72h

async function getAssetNews(symbol, name) {
  const sym      = symbol.toUpperCase();
  const nameLow  = name.toLowerCase();
  const allRaw   = [];

  // ── Fuente 1: NewsAPI (más precisa — búsqueda por término exacto) ──────────
  try {
    const newsApiKey = await getRedisKey('NEWSAPI_KEY');
    if (newsApiKey) {
      // Búsqueda estricta: nombre del activo entre comillas para mayor precisión
      const query = `"${name}" OR "${sym}" cryptocurrency`;
      const r = await axios.get('https://newsapi.org/v2/everything', {
        timeout: 5000,
        params: { q: query, pageSize: 10, sortBy: 'publishedAt', language: 'en',
                  from: new Date(Date.now() - NEWS_MAX_HOURS * 3600000).toISOString(),
                  apiKey: newsApiKey }
      });
      if (r.data?.status === 'ok') {
        r.data.articles.forEach(a => {
          const text = (a.title || '') + ' ' + (a.description || '');
          if (isRelevantToAsset(text, sym, name) && isRecent(a.publishedAt, NEWS_MAX_HOURS)) {
            allRaw.push({ title: a.title, url: a.url, source: a.source?.name || 'NewsAPI',
              publishedAt: a.publishedAt, body: a.description || '',
              sentiment: analyzeSentiment(text, sym, name) });
          }
        });
      }
    }
  } catch(_) {}

  // ── Fuente 2: CryptoCompare — verificar que el artículo menciona el activo ─
  try {
    const key     = await getRedisKey('CRYPTOCOMPARE_API_KEY');
    const headers = key ? { authorization: `Apikey ${key}` } : {};
    const r = await axios.get(
      `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${sym}&lTs=0`,
      { headers, timeout: 5000 }
    );
    if (r.data?.Data?.length > 0) {
      r.data.Data.slice(0, 15).forEach(a => {
        const publishedAt = new Date(a.published_on * 1000).toISOString();
        const text        = (a.title || '') + ' ' + (a.body || '').slice(0, 500);
        // DOBLE FILTRO: recencia + mención explícita del activo en título o cuerpo
        if (isRecent(publishedAt, NEWS_MAX_HOURS) && isRelevantToAsset(text, sym, name)) {
          allRaw.push({ title: a.title, url: a.url, source: a.source_info?.name || a.source || 'CryptoCompare',
            publishedAt, body: (a.body || '').slice(0, 300),
            sentiment: analyzeSentiment(text, sym, name) });
        }
      });
    }
  } catch(_) {}

  // Deduplicar por título y ordenar por fecha desc
  const seen = new Set();
  const articles = allRaw
    .filter(a => { const k = a.title.slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 8);

  if (articles.length === 0) return { success: false, count: 0, articles: [], avgSentiment: 0 };

  const avgSentiment = articles.reduce((s, a) => s + a.sentiment.score, 0) / articles.length;
  return { success: true, count: articles.length, articles, avgSentiment,
           relevantCount: articles.filter(a => a.sentiment.relevant).length };
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

    // Filtrar posts: deben mencionar el activo y ser de las últimas 72h
    const REDDIT_MAX_HOURS = 96; // Reddit tiene menos frecuencia que news → 96h
    const validPosts = unique.filter(p => {
      const created = new Date(p.created_utc * 1000).toISOString();
      const text    = (p.title || '') + ' ' + (p.selftext || '').slice(0, 300);
      // Posts del subreddit propio del activo siempre son relevantes
      if (p.relevance === 'own') return isRecent(created, REDDIT_MAX_HOURS);
      // Posts de búsqueda: verificar que mencionan el activo
      return isRecent(created, REDDIT_MAX_HOURS) && isRelevantToAsset(text, sym, name);
    });

    if (validPosts.length === 0) {
      return { success: false, postCount: 0, totalScore: 0, avgSentiment: 0, posts: [] };
    }

    const posts = validPosts.map(p => ({
      title:     p.title,
      score:     p.ups || 0,
      comments:  p.num_comments || 0,
      subreddit: p.subreddit,
      relevance: p.relevance,
      url:       `https://reddit.com${p.permalink}`,
      created:   new Date(p.created_utc * 1000).toISOString(),
      sentiment: analyzeSentiment(p.title + ' ' + (p.selftext || '').slice(0, 300), sym, name)
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
app.get('/api/config', async (req, res) => {
  try {
    const mode = req.query?.mode || 'normal';
    res.json({ success: true, config: await getConfig(mode), mode });
  }
  catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ success: false, error: 'Se requiere "config"' });
    const v = algorithmConfig.validateConfig(config);
    if (!v.valid) return res.status(400).json({ success: false, errors: v.errors });
    const mode = req.query?.mode || config.modelType || 'normal';
    config.lastModified = new Date().toISOString();
    config.modelType    = mode;
    await redisSet(getConfigKey(mode), config);
    res.json({ success: true, config, mode });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/config/reset', async (req, res) => {
  try {
    const mode = req.query?.mode || 'normal';
    const config = { ...getDefaultConfig(mode), lastModified: new Date().toISOString() };
    await redisSet(getConfigKey(mode), config);
    res.json({ success: true, config, mode, message: `Config ${mode} reseteada a defaults` });
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
                     'WHALE_ALERT_API_KEY','LUNARCRUSH_API_KEY','SANTIMENT_API_KEY',
                     'GEMINI_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY','GROQ_API_KEY'];
    if (!allowed.includes(apiName)) return res.status(400).json({ success: false, error: 'API name no permitida' });
    await redisSet(`apikey:${apiName}`, apiKey?.trim() || '');
    res.json({ success: true, message: `Key guardada para ${apiName}` });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/config/api-keys', async (_req, res) => {
  try {
    const names = ['CRYPTOCOMPARE_API_KEY','NEWSAPI_KEY','GITHUB_TOKEN','TELEGRAM_BOT_TOKEN',
                   'SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY',
                   'WHALE_ALERT_API_KEY','LUNARCRUSH_API_KEY','SANTIMENT_API_KEY',
                   'GEMINI_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY','GROQ_API_KEY'];
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
const SPECULATIVE_VOL_MAX = 200_000_000;  // $200M volumen máximo (ampliado)

app.get('/api/crypto', async (req, res) => {
  try {
    const mode   = req.query.mode || 'normal'; // ?mode=speculative
    const config = await getConfig(mode);

    // Normal: 2 páginas x 250 = 500 activos (top large/mid caps)
    // Especulativo: 4 páginas x 250 = 1000 activos (universo completo de small-caps)
    const pages = mode === 'speculative' ? [1, 2, 3, 4] : [1, 2];
    const cgBase = 'https://api.coingecko.com/api/v3/coins/markets' +
      '?vs_currency=usd&order=market_cap_desc&per_page=250' +
      '&sparkline=false&price_change_percentage=24h,7d';

    const [fgRes, newsRes, ...pageResults] = await Promise.allSettled([
      getFearGreedIndex(),
      getMarketNews(10),
      ...pages.map(p => axios.get(`${cgBase}&page=${p}`, { timeout: 15000 }))
    ]);

    // Necesitamos al menos la primera página
    if (pageResults[0].status === 'rejected')
      throw new Error('CoinGecko no disponible: ' + pageResults[0].reason?.message);

    const fg   = fgRes.status === 'fulfilled'  ? fgRes.value  : { success: false };
    const news = newsRes.status === 'fulfilled' ? newsRes.value : { success: false, count: 0, articles: [], avgSentiment: 0 };

    const externalData = {
      fearGreed:  fg.success   ? fg   : null,
      marketNews: news.success ? news : null,
      assetNews:   null,
      assetReddit: null
    };

    // Combinar todas las páginas (descartar fallidas, deduplicar por id)
    const seen = new Set();
    let rawCryptos = pageResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value.data || [])
      .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });

    if (mode === 'speculative') {
      rawCryptos = rawCryptos.filter(c =>
        (c.market_cap  || 0) >= 1_000_000 &&
        (c.market_cap  || 0) <= SPECULATIVE_CAP_MAX &&
        (c.total_volume || 0) <= SPECULATIVE_VOL_MAX
      );
      // Ordenar por ratio volumen/mcap desc (más actividad relativa primero)
      rawCryptos.sort((a, b) =>
        (b.total_volume / Math.max(b.market_cap, 1)) - (a.total_volume / Math.max(a.market_cap, 1))
      );
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
    const calibratedCryptos = await applyCalibrationToSnapshot(cryptosWithBoost);

    res.json({
      success: true,
      data: calibratedCryptos,
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
    const mode   = req.query.mode || 'normal';
    const config = await getConfig(mode);
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
    const [newsRes, redditRes, coinDeskRes, coinTelRes, lunarRes, santRes, trendsRes] = await Promise.allSettled([
      getAssetNews(crypto.symbol, crypto.name),
      getAssetReddit(crypto.symbol, crypto.name, crypto.market_cap),
      getCoinDeskNews(crypto.symbol, crypto.name),
      getCoinTelegraphNews(crypto.symbol, crypto.name),
      getLunarCrushData(crypto.symbol),
      getSantimentData(crypto.symbol),
      getGoogleTrends(crypto.name, crypto.symbol)
    ]);

    const assetNews    = newsRes.status      === 'fulfilled' ? newsRes.value      : { success: false, count: 0, articles: [], avgSentiment: 0 };
    const assetReddit  = redditRes.status    === 'fulfilled' ? redditRes.value    : { success: false, postCount: 0, posts: [] };
    const coinDesk     = coinDeskRes.status  === 'fulfilled' ? coinDeskRes.value  : { success: false };
    const coinTel      = coinTelRes.status   === 'fulfilled' ? coinTelRes.value   : { success: false };
    const lunarCrush   = lunarRes.status     === 'fulfilled' ? lunarRes.value     : { success: false };
    const santiment    = santRes.status      === 'fulfilled' ? santRes.value      : { success: false };
    const googleTrends = trendsRes.status    === 'fulfilled' ? trendsRes.value    : { success: false };

    // Merge de artículos de todas las fuentes — ya filtrados por relevancia y recencia
    const allArticles = [
      ...(assetNews.articles || []),
      ...(coinDesk.articles  || []),
      ...(coinTel.articles   || [])
    ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Deduplicar por título
    const seenTitles = new Set();
    const dedupedArticles = allArticles.filter(a => {
      const k = (a.title || '').slice(0, 50);
      if (seenTitles.has(k)) return false; seenTitles.add(k); return true;
    });

    // Scoring ponderado: artículos que mencionan el activo valen 2x
    const mergedNews = dedupedArticles.length > 0 ? (() => {
      let weightedSum = 0, totalWeight = 0;
      dedupedArticles.forEach(a => {
        const w = a.sentiment?.relevant ? 2 : 1;  // doble peso si menciona el activo
        weightedSum += (a.sentiment?.score || 0) * w;
        totalWeight += w;
      });
      const specificCount = dedupedArticles.filter(a => a.sentiment?.relevant).length;
      return {
        success:        true,
        count:          dedupedArticles.length,
        specificCount,  // artículos que mencionan explícitamente el activo
        genericCount:   dedupedArticles.length - specificCount,
        articles:       dedupedArticles.slice(0, 10),
        avgSentiment:   totalWeight > 0 ? weightedSum / totalWeight : 0,
        rawAvgSentiment: dedupedArticles.reduce((s, a) => s + (a.sentiment?.score || 0), 0) / dedupedArticles.length,
        sources:        [assetNews.success && 'NewsAPI/CC', coinDesk.success && 'CoinDesk', coinTel.success && 'CoinTelegraph'].filter(Boolean)
      };
    })() : { success: false, count: 0, specificCount: 0, genericCount: 0, articles: [], avgSentiment: 0 };

    const externalData = {
      fearGreed:    fg.success            ? fg           : null,
      assetNews:    mergedNews.success    ? mergedNews   : (assetNews.success ? assetNews : null),
      assetReddit:  assetReddit.success   ? assetReddit  : null,
      lunarCrush:   lunarCrush.success    ? lunarCrush   : null,
      santiment:    santiment.success     ? santiment    : null,
      googleTrends: googleTrends.success  ? googleTrends : null,
      marketNews:   null
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
        news:       mergedNews.success  ? {
                      count:          mergedNews.count,
                      specificCount:  mergedNews.specificCount,   // mencionan el activo explícitamente
                      genericCount:   mergedNews.genericCount,    // no lo mencionan directamente
                      avgSentiment:   mergedNews.avgSentiment,    // ponderado por relevancia
                      rawAvgSentiment: mergedNews.rawAvgSentiment, // sin ponderar
                      articles:       mergedNews.articles,
                      sources:        mergedNews.sources
                    } : null,
        reddit:      assetReddit.success ? { postCount: assetReddit.postCount, avgSentiment: assetReddit.avgSentiment, posts: assetReddit.posts, subredditsSearched: assetReddit.subredditsSearched } : null,
        lunarCrush:  lunarCrush.success  ? lunarCrush : null,
        santiment:   santiment.success   ? santiment  : null,
        googleTrends: googleTrends.success ? {
                        currentInterest: googleTrends.currentInterest,
                        average:         googleTrends.average,
                        peak:            googleTrends.peak,
                        trend:           googleTrends.trend,
                        growthPercent:   googleTrends.growthPercent,
                        period:          googleTrends.period,
                        query:           googleTrends.query,
                        cached:          googleTrends.cached ?? false
                      } : null,
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
function analyzeSimulations(cycles, config, mode = 'normal') {
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
    // Filtrar excludedResults — no contar activos marcados como excluidos
    const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
    validResults.forEach(r => {
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
    mode,
    note: `Basado en ${significant.length} ciclos significativos (≥6h) del modelo '${mode}' con ${significant.reduce((s,c) => s+(c.results?.length||0),0)} predicciones totales.`
  };
}

app.get('/api/simulations/analysis', async (req, res) => {
  if (!redis) return res.json({ success: false, error: 'Redis no disponible' });
  try {
    const mode   = req.query?.mode || 'normal';
    const config = await getConfig(mode);
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const allCycles = await cyclesManager.getCyclesDetails(redis, ids);
    // Solo ciclos del mismo modo alimentan este análisis
    const cycles = allCycles.filter(cyc => (cyc.mode || 'normal') === mode);
    const result = analyzeSimulations(cycles, config, mode);
    res.json({ success: true, mode, cyclesTotal: allCycles.length, cyclesThisMode: cycles.length, ...result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// Aplicar configuración sugerida por el análisis
app.post('/api/simulations/apply-suggestion', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const mode   = req.body.mode || req.query.mode || 'normal';
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const allCycles = await cyclesManager.getCyclesDetails(redis, ids);
    const cycles = allCycles.filter(cyc => (cyc.mode || 'normal') === mode);
    const config = await getConfig(mode);
    const result = analyzeSimulations(cycles, config, mode);
    if (!result.hasSignificant) return res.status(400).json({ success: false, error: result.message });
    const newConfig = { ...result.suggestedConfig, modelType: mode, lastModified: new Date().toISOString(), version: '4.0-autocal' };
    await redisSet(getConfigKey(mode), newConfig);
    res.json({ success: true, applied: newConfig, mode, changes: result.recommendations });
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
    const mode   = req.body.mode || 'normal';
    const config = await getConfig(mode);

    // ── Enriquecer snapshot con Google Trends (con caché Redis 12h) ───────────
    // Se llama en paralelo por activo. La caché evita agotar el cupo de SerpAPI.
    // Solo los primeros 20 activos del snapshot para limitar llamadas.
    const TRENDS_LIMIT = 20;
    const assetsToEnrich = snapshot.slice(0, TRENDS_LIMIT);
    const trendsResults  = await Promise.allSettled(
      assetsToEnrich.map(a => getGoogleTrends(a.name, a.symbol))
    );

    const enrichedSnapshot = snapshot.map((asset, i) => {
      if (i >= TRENDS_LIMIT) return asset;
      const tr = trendsResults[i];
      const gt = (tr.status === 'fulfilled' && tr.value?.success) ? tr.value : null;
      return {
        ...asset,
        googleTrends: gt,
        // Actualizar indicators dentro del breakdown si existe
        breakdown: asset.breakdown ? {
          ...asset.breakdown,
          indicators: {
            ...(asset.breakdown.indicators || {}),
            trendsCurrentInterest: gt?.currentInterest ?? null,
            trendsAverage:         gt?.average ?? null,
            trendsPeak:            gt?.peak ?? null,
            trendsTrend:           gt?.trend ?? null,
            trendsGrowth:          gt?.growthPercent ?? null,
            trendsCached:          gt?.cached ?? false
          }
        } : asset.breakdown
      };
    });

    const cycle = await cyclesManager.createCycle(redis, enrichedSnapshot, config, finalDuration, mode);
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
    // Recuperar el ciclo para saber su modo antes de usar la config correcta
    const cycleData = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycleData) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });

    const cycleMode = cycleData.mode || req.body?.mode || 'normal';
    const config    = await getConfig(cycleMode);

    // Pedir precios exactos de los activos del snapshot en lugar de los top-N genéricos.
    // Esto garantiza que activos fuera del top-50 y micro-caps (modo especulativo) se encuentren.
    const snapshotIds = (cycleData.snapshot || []).map(a => a.id).filter(Boolean).join(',');
    const priceUrl = snapshotIds
      ? `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${snapshotIds}&per_page=250`
      : `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1`;

    const prices = await axios.get(priceUrl, { timeout: 12000 });

    if (!prices.data || prices.data.length === 0) {
      return res.status(503).json({ success: false, error: 'CoinGecko no devolvió precios. Espera un momento y vuelve a intentarlo.' });
    }

    const cycle = await cyclesManager.completeCycle(redis, req.params.cycleId, prices.data, config);
    res.json({ success: true, cycle: { id: cycle.id, metrics: cycle.metrics, completedAt: cycle.completedAt } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/cycles/:cycleId/revalidate ─────────────────────────────────────
// Recalcula los resultados de un ciclo ya completado volviendo a pedir precios
// a CoinGecko con los IDs exactos del snapshot.
// Útil para reparar ciclos guardados con results=[] por el bug del per_page=50.
app.post('/api/cycles/:cycleId/revalidate', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status !== 'completed') return res.status(400).json({ success: false, error: 'Solo se pueden revalidar ciclos completados' });
    if (!cycle.snapshot?.length) return res.status(400).json({ success: false, error: 'El ciclo no tiene snapshot' });

    // Pedir precios actuales de los IDs exactos del snapshot
    const snapshotIds = cycle.snapshot.map(a => a.id).filter(Boolean).join(',');
    const priceUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${snapshotIds}&per_page=250`;
    const prices = await axios.get(priceUrl, { timeout: 12000 });

    if (!prices.data || prices.data.length === 0) {
      return res.status(503).json({ success: false, error: 'CoinGecko no devolvió precios. Espera un momento y reintenta.' });
    }

    // Nota: para ciclos históricos se usan precios ACTUALES, no los del momento
    // de cierre (CoinGecko histórico requiere API Pro). Se registra este hecho.
    const cycleMode = cycle.mode || 'normal';
    const config    = await getConfig(cycleMode);

    const boostPowerCalc = require('./boost-power-calculator');
    const results = [];

    for (const asset of cycle.snapshot) {
      const current = prices.data.find(p => p.id === asset.id);
      if (!current) continue;

      const actualChange    = ((current.current_price - asset.current_price) / asset.current_price) * 100;
      const predictedChange = typeof asset.predictedChange === 'number'
        ? asset.predictedChange
        : parseFloat(asset.predictedChange || 0);
      const category = asset.classification || 'RUIDOSO';

      const validation = boostPowerCalc.validatePrediction(predictedChange, actualChange, category, config);

      results.push({
        id:               asset.id,
        symbol:           asset.symbol,
        name:             asset.name,
        snapshotPrice:    asset.current_price,
        currentPrice:     current.current_price,
        predictedChange:  predictedChange.toFixed(2),
        actualChange:     actualChange.toFixed(2),
        classification:   category,
        boostPower:       asset.boostPower,
        correct:          validation.correct,
        validationReason: validation.reason,
        error:            Math.abs(predictedChange - actualChange).toFixed(2),
        revalidated:      true  // marcar que estos precios son actuales, no del cierre
      });
    }

    if (results.length === 0) {
      return res.status(503).json({ success: false, error: `CoinGecko no devolvió precio para ninguno de los ${cycle.snapshot.length} activos. Puede que los IDs hayan cambiado.` });
    }

    // Guardar resultados recalculados
    cycle.results             = results;
    cycle.metrics             = cyclesManager.recalculateMetrics(results);
    cycle.revalidatedAt       = new Date().toISOString();
    cycle.revalidationNote    = 'Precios recalculados con cotizaciones actuales (no del momento de cierre)';

    // Persistir en Redis
    const { Redis } = require('@upstash/redis');
    await redis.set(cycle.id, cycle);

    res.json({
      success: true,
      cycleId: cycle.id,
      found:   results.length,
      total:   cycle.snapshot.length,
      metrics: cycle.metrics,
      revalidationNote: cycle.revalidationNote
    });
  } catch(e) {
    console.error('revalidate error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/cycles/revalidate-empty ────────────────────────────────────────
// Revalida en bloque todos los ciclos completados que tengan 0 resultados.
// Devuelve un resumen con los ciclos reparados y los que fallaron.
app.post('/api/cycles/revalidate-empty', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const ids       = await cyclesManager.getCompletedCycles(redis);
    const allCycles = await cyclesManager.getCyclesDetails(redis, ids);

    // Filtrar: completados con results vacío o nulo
    const empty = allCycles.filter(c =>
      c.status === 'completed' && (!c.results || c.results.length === 0)
    );

    if (empty.length === 0) {
      return res.json({ success: true, message: 'No hay ciclos con datos vacíos. Todo está bien.', repaired: 0, failed: 0, details: [] });
    }

    const boostPowerCalc = require('./boost-power-calculator');
    const details = [];

    for (const cycle of empty) {
      // Pequeña pausa para no saturar CoinGecko (rate limit)
      await new Promise(r => setTimeout(r, 1200));

      try {
        const snapshotIds = (cycle.snapshot || []).map(a => a.id).filter(Boolean).join(',');
        if (!snapshotIds) {
          details.push({ id: cycle.id, status: 'skipped', reason: 'snapshot vacío' });
          continue;
        }

        const priceUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${snapshotIds}&per_page=250`;
        const prices   = await axios.get(priceUrl, { timeout: 12000 });

        if (!prices.data?.length) {
          details.push({ id: cycle.id, status: 'failed', reason: 'CoinGecko sin precios' });
          continue;
        }

        const cycleMode = cycle.mode || 'normal';
        const config    = await getConfig(cycleMode);
        const results   = [];

        for (const asset of cycle.snapshot) {
          const current = prices.data.find(p => p.id === asset.id);
          if (!current) continue;
          const actualChange    = ((current.current_price - asset.current_price) / asset.current_price) * 100;
          const predictedChange = typeof asset.predictedChange === 'number' ? asset.predictedChange : parseFloat(asset.predictedChange || 0);
          const category        = asset.classification || 'RUIDOSO';
          const validation      = boostPowerCalc.validatePrediction(predictedChange, actualChange, category, config);
          results.push({
            id: asset.id, symbol: asset.symbol, name: asset.name,
            snapshotPrice: asset.current_price, currentPrice: current.current_price,
            predictedChange: predictedChange.toFixed(2), actualChange: actualChange.toFixed(2),
            classification: category, boostPower: asset.boostPower,
            correct: validation.correct, validationReason: validation.reason,
            error: Math.abs(predictedChange - actualChange).toFixed(2),
            revalidated: true
          });
        }

        if (results.length === 0) {
          details.push({ id: cycle.id, status: 'failed', reason: 'ningún ID encontrado en CoinGecko' });
          continue;
        }

        cycle.results          = results;
        cycle.metrics          = cyclesManager.recalculateMetrics(results);
        cycle.revalidatedAt    = new Date().toISOString();
        cycle.revalidationNote = 'Precios recalculados con cotizaciones actuales';
        await redis.set(cycle.id, cycle);

        details.push({ id: cycle.id, status: 'repaired', found: results.length, total: cycle.snapshot.length, successRate: cycle.metrics.successRate });

      } catch(err) {
        details.push({ id: cycle.id, status: 'failed', reason: err.message });
      }
    }

    const repaired = details.filter(d => d.status === 'repaired').length;
    const failed   = details.filter(d => d.status === 'failed').length;

    res.json({ success: true, total: empty.length, repaired, failed, details });
  } catch(e) {
    console.error('revalidate-empty error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/history', async (req, res) => {
  if (!redis) return res.json({ success: true, cycles: [], mode: 'all' });
  try {
    const mode   = req.query?.mode || 'all';  // 'all', 'normal', 'speculative'
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const allCycles = await cyclesManager.getCyclesDetails(redis, ids);
    const cycles = mode === 'all'
      ? allCycles
      : allCycles.filter(c => (c.mode || 'normal') === mode);
    res.json({ success: true, cycles, mode, totalCycles: allCycles.length });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/cycles/stats/global', async (req, res) => {
  if (!redis) return res.json({ success: true, stats: { totalCycles: 0, totalPredictions: 0, avgSuccessRate: '0.00' }, mode: 'all' });
  try {
    const mode   = req.query?.mode || 'all';
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const allCycles = await cyclesManager.getCyclesDetails(redis, ids);
    const cycles = mode === 'all'
      ? allCycles
      : allCycles.filter(c => (c.mode || 'normal') === mode);
    
    // Recalcular stats solo con los ciclos del modo seleccionado
    let totalCorrect = 0, totalPredictions = 0;
    cycles.forEach(c => {
      if (c.status === 'completed' && c.metrics) {
        const validResults = (c.results || []).filter(r => !(c.excludedResults || []).includes(r.id));
        totalPredictions += validResults.length;
        totalCorrect += validResults.filter(r => r.correct).length;
      }
    });
    const avgSuccessRate = totalPredictions > 0 ? (totalCorrect / totalPredictions * 100).toFixed(2) : '0.00';
    
    const stats = { totalCycles: cycles.length, totalPredictions, avgSuccessRate, mode };
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
// ── GET /api/cycles/:cycleId/enhanced-report ───────────────────────────────
// Informe paramétrico completo: factores por activo, predicción vs real,
// contexto de mercado, tendencias, parámetros compra/venta y conclusiones LLM
app.get('/api/cycles/:cycleId/enhanced-report', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycle)                       return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status !== 'completed') return res.status(400).json({ success: false, error: 'Ciclo aún no completado' });

    const mode   = cycle.mode || 'normal';
    const config = await getConfig(mode);

    // API keys de LLMs (para "Los 3 Sabios" dentro del informe)
    const apiKeys = {
      gemini:   await getRedisKey('GEMINI_API_KEY'),
      claude:   await getRedisKey('ANTHROPIC_API_KEY'),
      openai:   await getRedisKey('OPENAI_API_KEY'),
      groq:     await getRedisKey('GROQ_API_KEY'),
      mistral:  await getRedisKey('MISTRAL_API_KEY'),
      cohere:   await getRedisKey('COHERE_API_KEY'),
      cerebras: await getRedisKey('CEREBRAS_API_KEY'),
    };

    // Configuración del módulo de inversión durante el ciclo
    const investConfig = await getInvestConfig();

    // generateEnhancedReport ahora es async (llama a LLMs internamente)
    const doc    = await enhancedReportGen.generateEnhancedReport(
      cycle,
      cycle.fullSnapshot || cycle.snapshot,
      config,
      apiKeys,
      investConfig
    );
    const buffer = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=Informe_${mode}_${req.params.cycleId}.docx`);
    res.send(buffer);
  } catch(e) {
    console.error('enhanced-report error:', e.message, e.stack);
    res.status(500).json({ success: false, error: e.message });
  }
});
// ════════════════════════════════════════════════════════════════════════════
// INSIGHTS CON 4 LLMs — "3 Sabios Recomiendan"
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/insights/keys-status ────────────────────────────────────────────
app.get('/api/insights/keys-status', async (_req, res) => {
  try {
    const keys = {
      gemini: !!(await getRedisKey('GEMINI_API_KEY')),
      claude: !!(await getRedisKey('ANTHROPIC_API_KEY')),
      openai: !!(await getRedisKey('OPENAI_API_KEY')),
      groq:   !!(await getRedisKey('GROQ_API_KEY'))
    };
    const configured = Object.values(keys).filter(Boolean).length;
    res.json({ success: true, keys, configured, total: 4 });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/insights/analyze ───────────────────────────────────────────────
// Analiza N ciclos con hasta 7 LLMs — ANÁLISIS DUAL: clasificación + trading
app.post('/api/insights/analyze', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const { cycleIds, mode } = req.body;
    const cycleMode = mode || 'normal';

    // Cargar ciclos seleccionados (o todos los significativos si no se especifican)
    const allCycles = await cyclesManager.listCycles(redis, cycleMode);
    const cycles = cycleIds && cycleIds.length > 0
      ? allCycles.filter(c => cycleIds.includes(c.id) && c.status === 'completed')
      : allCycles.filter(c => c.status === 'completed' && c.isSignificant);

    if (cycles.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No hay ciclos completados disponibles para analizar.'
      });
    }

    // Config del algoritmo de clasificación
    const config = await getConfig(cycleMode);

    // API keys de todos los LLMs configurados
    const apiKeys = {
      gemini:   await getRedisKey('GEMINI_API_KEY'),
      claude:   await getRedisKey('ANTHROPIC_API_KEY'),
      openai:   await getRedisKey('OPENAI_API_KEY'),
      groq:     await getRedisKey('GROQ_API_KEY'),
      mistral:  await getRedisKey('MISTRAL_API_KEY'),
      cohere:   await getRedisKey('COHERE_API_KEY'),
      cerebras: await getRedisKey('CEREBRAS_API_KEY'),
    };

    const activeKeys = Object.values(apiKeys).filter(Boolean).length;
    if (activeKeys < 2) {
      return res.status(400).json({
        success: false,
        error: 'Configure al menos 2 LLMs en la pestaña APIs.'
      });
    }

    // Cargar investConfig y posiciones cerradas para análisis dual
    const investConfig    = await getInvestConfig();
    const allPositions    = await getPositions();
    const closedPositions = allPositions.filter(p => p.status === 'closed');

    // Analizar con LLMs — análisis dual clasificación + trading (30-90s)
    const responses = await llmInsights.analyzeWithLLMs(
      cycles,
      config,
      cycleMode,
      apiKeys,
      investConfig,
      closedPositions
    );

    // Calcular consenso dual
    const consensusResult = llmInsights.calculateConsensus(responses);

    res.json({
      success:         true,
      cyclesAnalyzed:  cycles.length,
      closedPositions: closedPositions.length,
      mode:            cycleMode,
      responses,
      consensus:       consensusResult,
      analyzedAt:      new Date().toISOString(),
    });

  } catch (e) {
    console.error('insights/analyze error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/insights/apply-consensus ───────────────────────────────────────
// Aplicar ajustes del consenso — actualiza clasificación Y config de trading
app.post('/api/insights/apply-consensus', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const { consensus, mode } = req.body;
    if (!consensus) {
      return res.status(400).json({ success: false, error: 'consensus object requerido' });
    }

    const cycleMode = mode || 'normal';

    // ── 1. Actualizar config del algoritmo de clasificación ───────────────────
    const current = await getConfig(cycleMode);
    const updated = JSON.parse(JSON.stringify(current));

    if (consensus.metaWeights)        Object.assign(updated.metaWeights,        consensus.metaWeights);
    if (consensus.classification)     Object.assign(updated.classification,     consensus.classification);
    if (consensus.prediction)         Object.assign(updated.prediction,         consensus.prediction);
    if (consensus.potentialWeights)   Object.assign(updated.potentialWeights,   consensus.potentialWeights);
    if (consensus.resistanceWeights)  Object.assign(updated.resistanceWeights,  consensus.resistanceWeights);

    updated.lastModified = new Date().toISOString();
    updated.source       = 'llm-consensus-dual';

    const configKey = cycleMode === 'speculative' ? 'algorithm-config:speculative' : 'algorithm-config:normal';
    await redisSet(configKey, updated);

    // ── 2. Actualizar investConfig con ajustes de trading del consenso ────────
    let investUpdated = null;
    const tradingConfig = consensus.tradingConfig || {};
    const hasTradingAdjustments = Object.keys(tradingConfig).some(
      k => tradingConfig[k] !== null && tradingConfig[k] !== undefined
    );

    if (hasTradingAdjustments) {
      const currentInvest = await getInvestConfig();
      investUpdated = { ...currentInvest };

      // Aplicar solo valores en rangos seguros
      const safeApply = (field, min, max) => {
        const val = Number(tradingConfig[field]);
        if (!isNaN(val) && val >= min && val <= max) investUpdated[field] = val;
      };

      safeApply('takeProfitPct', 2,  50);   // Entre 2% y 50%
      safeApply('stopLossPct',   1,  25);   // Entre 1% y 25%
      safeApply('maxHoldCycles', 1,  20);   // Entre 1 y 20 ciclos

      investUpdated.lastModified = new Date().toISOString();
      investUpdated.source       = 'llm-consensus-dual';

      await redisSet(INVEST_CONFIG_KEY, investUpdated);
    }

    res.json({
      success:               true,
      mode:                  cycleMode,
      classificationApplied: updated,
      tradingApplied:        investUpdated,
      message: investUpdated
        ? `Clasificación y trading actualizados con consenso de LLMs (${cycleMode})`
        : `Clasificación actualizada con consenso de LLMs (${cycleMode}) — sin ajustes de trading`,
    });

  } catch (e) {
    console.error('insights/apply-consensus error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});



// ════════════════════════════════════════════════════════════════════════════
// MÓDULO DE INVERSIÓN v4
// ════════════════════════════════════════════════════════════════════════════

// ── Helpers de Redis para inversión ──────────────────────────────────────────
const INVEST_CONFIG_KEY  = 'invest-config';
const POSITIONS_KEY      = 'invest-positions';
const INVEST_LOG_KEY     = 'invest-cycle-log';
const PRICE_CACHE_KEY    = 'invest-price-cache';
const PRICE_STALE_MAX_MS = 4 * 60 * 60 * 1000; // 4h
const INVEST_ROUNDS_KEY  = 'invest-rounds';       // historial de rondas
const CURR_ROUND_KEY     = 'invest-current-round'; // ronda activa

// ── Caché de precios ─────────────────────────────────────────────────────────
// REGLA: nunca se persiste un precio 0, null o NaN.
async function getPriceCache() {
  const v = await redisGet(PRICE_CACHE_KEY);
  if (v && typeof v === 'object') return v;
  if (v && typeof v === 'string') { try { return JSON.parse(v); } catch(_){} }
  return {};
}
async function savePriceCache(cache) { await redisSet(PRICE_CACHE_KEY, cache); }

async function fetchAndCachePrices(assetIds, symbolMap = {}) {
  const cache   = await getPriceCache();
  const now     = Date.now();
  const prices  = {};
  const pending = [...assetIds];
  let   source  = 'none';

  // Fuente 1: CoinGecko
  if (pending.length > 0) {
    try {
      const pRes = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${pending.join(',')}&vs_currencies=usd`,
        { timeout: 8000 }
      );
      const data = pRes.data || {};
      for (const id of [...pending]) {
        const p = data[id]?.usd;
        if (p && p > 0 && isFinite(p)) {
          prices[id] = { price: p, source: 'coingecko', updatedAt: now, isStale: false };
          pending.splice(pending.indexOf(id), 1);
        }
      }
      if (Object.keys(prices).length > 0) source = 'coingecko';
    } catch (e) { console.warn('[price-cache] CoinGecko falló:', e.message); }
  }

  // Fuente 2: CryptoCompare
  // FIX: Solo activos con ticker real en symbolMap. CoinGecko usa IDs largos ("bitcoin"),
  // CryptoCompare usa tickers ("BTC"). Usar symbolMap[id] || id enviaría "BITCOIN" como
  // símbolo, asignando precios de cryptos incorrectas o datos inválidos.
  if (pending.length > 0) {
    try {
      const pendingCC = pending.filter(id => symbolMap[id] && symbolMap[id].trim().length > 0);
      if (pendingCC.length === 0) {
        console.warn('[price-cache] CryptoCompare: ningún activo tiene ticker en symbolMap → saltando');
      } else {
        const syms    = [...new Set(pendingCC.map(id => symbolMap[id].toUpperCase()))].join(',');
        const ccKey   = process.env.CRYPTOCOMPARE_API_KEY || await getRedisKey('CRYPTOCOMPARE_API_KEY') || '';
        const headers = ccKey ? { authorization: `Apikey ${ccKey}` } : {};
        const pRes    = await axios.get(
          `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${syms}&tsyms=USD`,
          { timeout: 7000, headers }
        );
        const data    = pRes.data || {};
        // Mapa inverso TICKER → CoinGeckoId (solo activos con ticker válido)
        const idBySym = {};
        pendingCC.forEach(id => { idBySym[symbolMap[id].toUpperCase()] = id; });
        for (const [sym, vals] of Object.entries(data)) {
          const id = idBySym[sym.toUpperCase()];
          const p  = vals?.USD;
          if (id && p && p > 0 && isFinite(p)) {
            prices[id] = { price: p, source: 'cryptocompare', updatedAt: now, isStale: false };
            pending.splice(pending.indexOf(id), 1);
            if (source === 'none') source = 'cryptocompare';
          }
        }
      }
    } catch (e) { console.warn('[price-cache] CryptoCompare falló:', e.message); }
  }

  // Fuente 3: Binance
  // FIX: Igual que CryptoCompare — solo usar el ticker del symbolMap, nunca el CoinGecko ID.
  if (pending.length > 0) {
    try {
      const pRes    = await axios.get('https://api.binance.com/api/v3/ticker/price', { timeout: 6000 });
      const tickers = {};
      (pRes.data || []).forEach(t => { tickers[t.symbol] = parseFloat(t.price); });
      for (const id of [...pending]) {
        const rawSym = symbolMap[id];
        if (!rawSym) {
          // Sin ticker conocido → no podemos construir el par USDT correcto
          console.warn(`[price-cache] Binance: sin ticker en symbolMap para ${id} → saltando`);
          continue;
        }
        const sym = rawSym.toUpperCase() + 'USDT';
        const p   = tickers[sym];
        if (p && p > 0 && isFinite(p)) {
          prices[id] = { price: p, source: 'binance', updatedAt: now, isStale: false };
          pending.splice(pending.indexOf(id), 1);
          if (source === 'none') source = 'binance';
        }
      }
    } catch (e) { console.warn('[price-cache] Binance falló:', e.message); }
  }

  // Fuente 4: stale (último precio conocido)
  const failedIds = [];
  const staleIds  = [];
  for (const id of pending) {
    const cached = cache[id];
    if (cached?.price && cached.price > 0 && isFinite(cached.price)) {
      const ageMs = now - (cached.updatedAt || 0);
      prices[id]  = { price: cached.price, source: 'stale', updatedAt: cached.updatedAt, isStale: true, staleSinceMs: ageMs };
      staleIds.push(id);
    } else {
      failedIds.push(id);
      console.error(`[price-cache] Sin precio para ${id} y sin historial`);
    }
  }

  // Actualizar caché (solo precios frescos)
  const updatedCache = { ...cache };
  for (const [id, info] of Object.entries(prices)) {
    if (!info.isStale) updatedCache[id] = { price: info.price, source: info.source, updatedAt: now, attempts: 0 };
    else if (updatedCache[id]) updatedCache[id].attempts = (updatedCache[id].attempts || 0) + 1;
  }
  try { await savePriceCache(updatedCache); } catch (_) {}

  return {
    prices,
    meta: { source, fetchedCount: Object.values(prices).filter(p => !p.isStale).length,
            staleCount: staleIds.length, failedIds, staleIds,
            updatedAt: now, updatedAtISO: new Date(now).toISOString() }
  };
}

async function getSafePrice(assetId, symbol) {
  const { prices } = await fetchAndCachePrices([assetId], { [assetId]: symbol });
  return prices[assetId] || null;
}

async function getInvestConfig() {
  const stored = await redisGet(INVEST_CONFIG_KEY);
  let cfg = null;
  if (stored && typeof stored === 'object') cfg = stored;
  else if (stored) { try { cfg = JSON.parse(stored); } catch(_){} }
  return cfg || { ...investManager.DEFAULT_INVEST_CONFIG };
}

async function getPositions() {
  const stored = await redisGet(POSITIONS_KEY);
  if (stored && Array.isArray(stored)) return stored;
  if (stored && typeof stored === 'string') { try { return JSON.parse(stored); } catch(_){} }
  return [];
}

async function savePositions(positions) {
  await redisSet(POSITIONS_KEY, positions);
}

// ── Calibración online de predicciones ───────────────────────────────────────
async function getPredictionCalibration() {
  const stored = await redisGet(predCalibration.CALIBRATION_KEY);
  if (stored && typeof stored === 'object') return stored;
  if (stored && typeof stored === 'string') { try { return JSON.parse(stored); } catch(_){} }
  return predCalibration.emptyCalibration();
}
async function savePredictionCalibration(cal) { await redisSet(predCalibration.CALIBRATION_KEY, cal); }

async function onPositionClosed(position) {
  if (!position?.classification || getClassificationStr(position) === 'RUIDOSO') return;
  if (position.predictedChange == null || position.realizedPnLPct == null) return;
  try {
    const cal    = await getPredictionCalibration();
    const newCal = predCalibration.updateCalibration(cal, {
      classification:  position.classification,
      boostPower:      position.boostPower       || 0,
      predictedChange: position.predictedChange  || 0,
      realizedPnLPct:  position.realizedPnLPct   || 0,
      symbol:          position.symbol,
      closedAt:        position.closedAt || new Date().toISOString(),
    });
    await savePredictionCalibration(newCal);
  } catch(e) { console.warn('[calibration] Error actualizando:', e.message); }
}

async function applyCalibrationToSnapshot(snapshotAssets) {
  let cal;
  try { cal = await getPredictionCalibration(); } catch(_) { return snapshotAssets; }
  return snapshotAssets.map(asset => {
    const cat = asset.classification;
    if (!cat || cat === 'RUIDOSO' || !asset.predictedChange) return asset;
    const factors = predCalibration.getCorrectionFactors(cal, cat, asset.boostPower);
    if (!factors) return asset;
    const raw      = asset.basePrediction || asset.predictedChange;
    let   calPred  = (raw - factors.biasCorrection) * factors.scaleCorrection;
    calPred = Math.max(0.5, parseFloat(calPred.toFixed(2)));
    return {
      ...asset,
      basePrediction:     raw,
      predictedChange:    calPred,
      calibrationApplied: true,
      calibrationFactors: { confidence: factors.confidence, samples: factors.samples, source: factors.source }
    };
  });
}

// ── Rondas de inversión ───────────────────────────────────────────────────────
async function getRounds() {
  const stored = await redisGet(INVEST_ROUNDS_KEY);
  if (stored && Array.isArray(stored)) return stored;
  if (stored && typeof stored === 'string') { try { return JSON.parse(stored); } catch(_){} }
  return [];
}
async function saveRounds(rounds) { await redisSet(INVEST_ROUNDS_KEY, rounds); }

async function getCurrentRound() {
  const stored = await redisGet(CURR_ROUND_KEY);
  if (stored && typeof stored === 'object') return stored;
  if (stored && typeof stored === 'string') { try { return JSON.parse(stored); } catch(_){} }
  return null;
}
async function saveCurrentRound(round) { await redisSet(CURR_ROUND_KEY, round); }

async function getInvestLog() {
  const stored = await redisGet(INVEST_LOG_KEY);
  if (stored && Array.isArray(stored)) return stored;
  if (stored && typeof stored === 'string') { try { return JSON.parse(stored); } catch(_){} }
  return [];
}

async function appendInvestLog(entry) {
  const log = await getInvestLog();
  // Añadir metadatos comunes de auditoría a cada entrada
  entry._logId   = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  entry._version = 2; // versión del schema de log
  log.unshift(entry); // más reciente primero
  await redisSet(INVEST_LOG_KEY, log.slice(0, 200)); // max 200 entradas (subido de 50)
}

// Obtener keys de exchange desde Redis
async function getExchangeKeys(exchange) {
  if (exchange === 'binance') {
    return {
      apiKey: await getRedisKey('BINANCE_API_KEY'),
      secret: await getRedisKey('BINANCE_SECRET_KEY')
    };
  } else if (exchange === 'coinbase') {
    return {
      apiKey: await getRedisKey('COINBASE_API_KEY'),
      secret: await getRedisKey('COINBASE_SECRET_KEY')
    };
  }
  return {};
}

// ── GET /api/invest/config ───────────────────────────────────────────────────
app.get('/api/invest/config', async (_req, res) => {
  try {
    const cfg = await getInvestConfig();
    res.json({ success: true, config: cfg, defaults: investManager.DEFAULT_INVEST_CONFIG });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/config ──────────────────────────────────────────────────
app.post('/api/invest/config', async (req, res) => {
  try {
    const current = await getInvestConfig();
    const updated = { ...current, ...req.body, lastModified: new Date().toISOString() };
    await redisSet(INVEST_CONFIG_KEY, updated);
    res.json({ success: true, config: updated });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/invest/exchange/ping ────────────────────────────────────────────
app.get('/api/invest/exchange/ping', async (_req, res) => {
  try {
    const cfg       = await getInvestConfig();
    const keys      = await getExchangeKeys(cfg.exchange);
    const isTestnet = cfg.mode !== 'real';
    const result    = await exchangeConnector.pingExchange(cfg.exchange, keys, isTestnet);
    res.json({ success: true, exchange: cfg.exchange, mode: cfg.mode, ...result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/invest/positions ────────────────────────────────────────────────
app.get('/api/invest/positions', async (_req, res) => {
  try {
    const positions = await getPositions();
    const cfg       = await getInvestConfig();
    const open      = positions.filter(p => p.status === 'open');
    const closed    = positions.filter(p => p.status === 'closed');
    const available = investManager.calculateAvailableCapital(positions, cfg.capitalTotal);

    // Actualizar precios con fetchAndCachePrices — nunca devuelve 0
    let priceMeta = { source: 'none', fetchedCount: 0, staleCount: 0, failedIds: [], updatedAt: null };
    if (open.length > 0) {
      const assetIds  = [...new Set(open.map(p => p.assetId))];
      const symbolMap = {};
      open.forEach(p => { symbolMap[p.assetId] = p.symbol; });
      const { prices, meta } = await fetchAndCachePrices(assetIds, symbolMap);
      priceMeta = meta;
      open.forEach(p => {
        const info = prices[p.assetId];
        if (!info?.price || info.price <= 0) return;
        p.currentPrice      = info.price;
        p.priceSource       = info.source;
        p.priceUpdatedAt    = info.isStale ? info.updatedAt : meta.updatedAt;
        p.priceIsStale      = info.isStale || false;
        p.unrealizedPnL     = parseFloat(((info.price - p.entryPrice) * p.units).toFixed(4));
        p.unrealizedPnLPct  = parseFloat(((info.price - p.entryPrice) / p.entryPrice * 100).toFixed(2));
      });
    }

    // Enriquecer posiciones abiertas con datos temporales de su ciclo
    if (open.length > 0) {
      try {
        // Recuperar IDs activos + completados y cargar sus objetos completos
        const activeIds    = await cyclesManager.getActiveCycles(redis);     // array de IDs
        const completedIds = await cyclesManager.getCompletedCycles(redis);  // array de IDs
        const allIds       = [...new Set([...activeIds, ...completedIds])];

        // Cargar objetos completos de todos los ciclos relevantes
        const allCycleObjs = await cyclesManager.getCyclesDetails(redis, allIds);
        const cycleMap     = {};
        allCycleObjs.forEach(cyc => { if (cyc && cyc.id) cycleMap[cyc.id] = cyc; });

        const now = Date.now();
        open.forEach(p => {
          const cyc = p.cycleId ? cycleMap[p.cycleId] : null;
          if (cyc) {
            const total     = cyc.durationMs || Math.max(cyc.endTime - cyc.startTime, 1);
            const elapsed   = now - cyc.startTime;
            const remaining = Math.max(0, cyc.endTime - now);
            const pct       = Math.min(100, Math.round(elapsed / total * 100));
            p.cycleInfo = {
              cycleId:          cyc.id,
              startTime:        cyc.startTime,
              endTime:          cyc.endTime,
              durationMs:       total,
              elapsedMs:        elapsed,
              remainingMs:      remaining,
              progressPct:      pct,
              isCompleted:      cyc.status === 'completed',
              currentIteration: (p.holdCycles || 0) + 1,
              totalIterations:  p.maxHoldCycles || 3,
              iterationsLeft:   Math.max(0, (p.maxHoldCycles || 3) - (p.holdCycles || 0))
            };
          } else {
            // Fallback: calcular desde openedAt si no se encuentra el ciclo
            // Para posiciones manual_, cycleDurationMs está guardado directamente en la posición
            const openedMs   = p.openedAt ? new Date(p.openedAt).getTime() : now;
            const cycleDurMs = p.cycleDurationMs || null;
            const endTimeFb  = cycleDurMs ? openedMs + cycleDurMs : null;
            const elapsed    = now - openedMs;
            const remaining  = endTimeFb ? Math.max(0, endTimeFb - now) : null;
            const pct        = (cycleDurMs && cycleDurMs > 0)
                                 ? Math.min(100, Math.round(elapsed / cycleDurMs * 100))
                                 : null;
            p.cycleInfo = {
              cycleId:          p.cycleId || null,
              startTime:        openedMs,
              endTime:          endTimeFb,
              durationMs:       cycleDurMs,
              elapsedMs:        elapsed,
              remainingMs:      remaining,
              progressPct:      pct,
              isCompleted:      false,
              currentIteration: (p.holdCycles || 0) + 1,
              totalIterations:  p.maxHoldCycles || 3,
              iterationsLeft:   Math.max(0, (p.maxHoldCycles || 3) - (p.holdCycles || 0))
            };
          }
        });
      } catch(enrichErr) {
        console.error('[invest/positions] Error enriqueciendo cycleInfo:', enrichErr.message);
      }
    }

    // BUG FIX: ordenar por closedAt DESC para que las más recientes lleguen primero.
    // Anteriormente slice(0,20) devolvía las 20 MÁS ANTIGUAS (las posiciones nuevas
    // se añaden al final del array y quedaban fuera del límite).
    // También: incluir SIEMPRE las posiciones de la ronda activa aunque superen el límite.
    const currentRoundForPositions = await getCurrentRound();
    const roundActiveStart = currentRoundForPositions?.status === 'active' && currentRoundForPositions.openedAt
      ? new Date(currentRoundForPositions.openedAt).getTime()
      : null;

    const closedSorted = [...closed].sort((a, b) => {
      const ta = a.closedAt ? new Date(a.closedAt).getTime() : 0;
      const tb = b.closedAt ? new Date(b.closedAt).getTime() : 0;
      return tb - ta; // más reciente primero
    });

    // Siempre incluir las de la ronda activa + las 50 más recientes en total
    const closedForResponse = roundActiveStart
      ? closedSorted.filter(p => {
          const openedAt = p.openedAt ? new Date(p.openedAt).getTime() : 0;
          return openedAt >= roundActiveStart;
        }).concat(
          closedSorted.filter(p => {
            const openedAt = p.openedAt ? new Date(p.openedAt).getTime() : 0;
            return openedAt < roundActiveStart;
          }).slice(0, 20) // máx 20 históricas de rondas previas
        )
      : closedSorted.slice(0, 50);

    res.json({
      success: true,
      summary: {
        capitalTotal:     cfg.capitalTotal,
        capitalAvailable: parseFloat(available.toFixed(2)),
        capitalInvested:  parseFloat((cfg.capitalTotal - available).toFixed(2)),
        openPositions:    open.length,
        closedPositions:  closed.length,
        totalUnrealizedPnL: parseFloat(open.reduce((s,p) => s + (p.unrealizedPnL||0), 0).toFixed(4)),
        totalRealizedPnL:   parseFloat(closed.reduce((s,p) => s + (p.realizedPnL||0), 0).toFixed(4))
      },
      priceUpdate: {
        source:       priceMeta.source,
        updatedAt:    priceMeta.updatedAtISO || null,
        fetchedCount: priceMeta.fetchedCount,
        staleCount:   priceMeta.staleCount,
        failedIds:    priceMeta.failedIds || [],
        hasStale:     (priceMeta.staleCount || 0) > 0,
        hasFailed:    (priceMeta.failedIds?.length || 0) > 0,
      },
      open,
      closed: closedForResponse
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/decide ──────────────────────────────────────────────────
// Analiza el snapshot actual y decide dónde invertir (sin ejecutar)
app.post('/api/invest/decide', async (req, res) => {
  try {
    const cfg          = await getInvestConfig();
    const positions    = await getPositions();
    const snapshot     = req.body.snapshot || [];
    // FIX: leer el modo del snapshot enviado por el frontend (currentMode del monitor)
    // Antes se usaba cfg.mode que es siempre 'simulated' → algoMode nunca era 'speculative'
    const snapshotMode = req.body.mode || null;

    if (!snapshot.length) return res.status(400).json({ success: false, error: 'Snapshot vacío' });

    // ── Sincronizar umbral con el Algoritmo A ─────────────────────────────────
    // El snapshot viene clasificado por el Algoritmo A con su propio umbral
    // (algoConfig.classification.invertibleMinBoost). Para que "Analizar & Decidir"
    // sea coherente con lo que el monitor muestra, leemos ese umbral y lo
    // pasamos a selectInvestmentTargets vía _syncedMinBoostPower.
    // Así ambos algoritmos comparten el mismo criterio de clasificación.
    let algoMinBP = null;
    try {
      // FIX: usar snapshotMode con prioridad sobre cfg.mode
      // cfg.mode = 'simulated' siempre → sin este fix algoMode era siempre 'normal'
      // aunque el snapshot viniera de activos especulativos (small-caps)
      const algoMode = snapshotMode === 'speculative'
        ? 'speculative'
        : (cfg.mode === 'speculative' ? 'speculative' : 'normal');
      const algoConfig = await getConfig(algoMode);
      algoMinBP = algoConfig?.classification?.invertibleMinBoost ?? null;
      if (algoMinBP != null && algoMinBP > 0) {
        cfg._syncedMinBoostPower = algoMinBP;
        // Si el invest config tiene un umbral MÁS ALTO que el clasificador,
        // bajarlo al del clasificador para no descartar activos ya validados.
        if (cfg.minBoostPower > algoMinBP) {
          cfg.minBoostPower = algoMinBP;
        }
      }
    } catch(_) { /* Si falla, continúa con cfg.minBoostPower original */ }
    // ─────────────────────────────────────────────────────────────────────────

    const decision  = investManager.selectInvestmentTargets(snapshot, cfg, positions);
    const available = investManager.calculateAvailableCapital(positions, cfg.capitalTotal);

    // Diagnóstico de filtrado detallado — pre-computar por cada filtro
    const invertiblesInSnapshot = snapshot.filter(a => getClassificationStr(a) === 'INVERTIBLE');
    const failingPred  = invertiblesInSnapshot.filter(a => {
      const pred = typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0);
      return pred < (cfg.minPredictedChange || 0);
    });
    const passingAll   = invertiblesInSnapshot.filter(a => {
      const pred = typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0);
      return pred >= (cfg.minPredictedChange || 0);
    });

    res.json({
      success:                    true,
      shouldInvest:               decision.shouldInvest,
      reason:                     decision.reason,
      capitalAvailable:           parseFloat(available.toFixed(2)),
      targets:                    decision.selected,
      allCandidates:              decision.allCandidates || [],
      cycleCapital:               decision.cycleCapital,
      // snapshotHasPredictedChange: cuántos activos tienen pred > 0 (calculado en investment-manager)
      snapshotHasPredictedChange: decision.snapshotHasPredictedChange ?? null,
      mode:             snapshotMode || (cfg.mode === 'speculative' ? 'speculative' : 'normal'),
      snapshotMode:     snapshotMode,
      exchange:         cfg.exchange,
      takeProfitPct:    cfg.takeProfitPct,
      stopLossPct:      cfg.stopLossPct,
      _debug: {
        snapshotTotal:                snapshot.length,
        invertiblesInSnapshot:        invertiblesInSnapshot.length,
        invertiblesFailingPredFilter: failingPred.length,
        invertiblesPassingAll:        passingAll.length,
        minBoostApplied:              cfg.minBoostPower,
        minBoostFromAlgoA:            algoMinBP,
        minSignalsRequired:           cfg.minSignals,
        minPredictedChange:           cfg.minPredictedChange || 0,
        snapshotMode:                 snapshotMode,
        snapshotHasPredictedChange:   decision.snapshotHasPredictedChange ?? null,
        // topInvertibles ordenados por predictedChange DESC para que el diagnóstico sea coherente
        topInvertibles: [...invertiblesInSnapshot]
          .sort((a, b) => {
            const pa = typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0);
            const pb = typeof b.predictedChange === 'number' ? b.predictedChange : parseFloat(b.predictedChange || 0);
            return pb - pa;
          })
          .slice(0, 8)
          .map(a => ({
            symbol:     a.symbol,
            boostPower: parseFloat((a.boostPower || 0).toFixed(3)),
            predicted:  typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0),
            failsPred:  (typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0)) < (cfg.minPredictedChange || 0),
          })),
      }
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/execute ─────────────────────────────────────────────────
// Ejecuta las inversiones decididas (simuladas o reales)
app.post('/api/invest/execute', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const { snapshot, cycleId } = req.body;
    const snapshotMode = req.body.mode || null;  // modo del monitor al ejecutar el ciclo

    if (!snapshot?.length) return res.status(400).json({ success: false, error: 'Snapshot requerido' });

    // Solo ejecutar en ciclos significativos (≥12h)
    if (cycleId) {
      const cycle = await cyclesManager.getCycle(redis, cycleId);
      if (cycle && (cycle.durationMs || 0) < 12 * 3600000) {
        return res.status(400).json({ success: false, error: 'Solo se opera en ciclos ≥12 horas' });
      }
    }

    const available = investManager.calculateAvailableCapital(positions, cfg.capitalTotal);
    if (available < 10) {
      return res.status(400).json({ success: false, error: `Capital disponible insuficiente: $${available.toFixed(2)}` });
    }

    // ── Sincronizar umbral con el Algoritmo A (mismo fix que /api/invest/decide) ─
    try {
      // FIX: usar snapshotMode con prioridad (cfg.mode es siempre 'simulated'/'real', nunca 'speculative')
      const algoMode = snapshotMode === 'speculative' ? 'speculative'
                     : (cfg.mode === 'speculative' ? 'speculative' : 'normal');
      const algoConfig = await getConfig(algoMode);
      const algoMinBP  = algoConfig?.classification?.invertibleMinBoost ?? null;
      if (algoMinBP != null && algoMinBP > 0) {
        cfg._syncedMinBoostPower = algoMinBP;
        if (cfg.minBoostPower > algoMinBP) cfg.minBoostPower = algoMinBP;
      }
    } catch(_) {}
    // ─────────────────────────────────────────────────────────────────────────

    const decision = investManager.selectInvestmentTargets(snapshot, cfg, positions);
    if (!decision.shouldInvest) {
      // === LOG DETALLADO: no_invest ===
      const _allPos = await getPositions();
      const logEntry = {
        type:      'no_invest',
        subtype:   'decision',
        cycleId:   cycleId || null,
        timestamp: new Date().toISOString(),
        config: {
          mode:            cfg.mode,
          exchange:        cfg.exchange,
          capitalTotal:    cfg.capitalTotal,
          capitalPerCycle: cfg.capitalPerCycle,
          maxPositions:    cfg.maxPositions,
          minBoostPower:   cfg.minBoostPower,
          minSignals:      cfg.minSignals,
          takeProfitPct:   cfg.takeProfitPct,
          stopLossPct:     cfg.stopLossPct,
          maxHoldCycles:   cfg.maxHoldCycles,
        },
        capital: {
          total:          cfg.capitalTotal,
          available:      parseFloat(available.toFixed(2)),
          invested:       parseFloat((cfg.capitalTotal - available).toFixed(2)),
          utilizationPct: parseFloat(((cfg.capitalTotal - available) / cfg.capitalTotal * 100).toFixed(1)),
          openPositions:  _allPos.filter(p => p.status === 'open').length,
        },
        snapshot: {
          totalAssets:        snapshot.length,
          invertibles:        snapshot.filter(a => getClassificationStr(a) === 'INVERTIBLE').length,
          apalancados:        snapshot.filter(a => getClassificationStr(a) === 'APALANCADO').length,
          ruidosos:           snapshot.filter(a => getClassificationStr(a) === 'RUIDOSO').length,
          candidatesEval:     snapshot.filter(a => getClassificationStr(a) === 'INVERTIBLE' && (a.boostPower||0) > 0).length,
          topBoostPower:      snapshot.length ? parseFloat(Math.max(...snapshot.map(a => a.boostPower || 0)).toFixed(3)) : 0,
          avgPredictedChange: snapshot.length ? parseFloat((snapshot.reduce((s,a) => s + (a.predictedChange||0), 0) / snapshot.length).toFixed(2)) : 0,
        },
        decision: {
          shouldInvest:       false,
          reason:             decision.reason,
          candidatesFound:    decision.selected?.length || 0,
          minSignalsRequired: cfg.minSignals,
          minBoostRequired:   cfg.minBoostPower,
          // Ordenar por predictedChange DESC (criterio de selección real del algoritmo)
          topCandidates: snapshot
            .filter(a => getClassificationStr(a) === 'INVERTIBLE')
            .map(a => ({
              symbol:          a.symbol,
              boostPower:      parseFloat((a.boostPower||0).toFixed(3)),
              boostPowerPct:   parseFloat(((a.boostPower||0)*100).toFixed(1)),
              predictedChange: typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0),
              classification:  getClassificationStr(a),
              meetsThreshold:  (a.boostPower||0) >= cfg.minBoostPower,
            }))
            .sort((a, b) => b.predictedChange - a.predictedChange)
            .slice(0, 5),
        },
      };
      await appendInvestLog(logEntry);
      return res.json({ success: true, invested: false, reason: decision.reason, capitalAvailable: available });
    }

    const keys   = await getExchangeKeys(cfg.exchange);
    const orders = [];
    const newPositions = [];

    // BUG FIX: leer la ronda activa para enlazar posiciones con la ronda
    const currentRoundExec = await getCurrentRound();
    const activeRoundId    = currentRoundExec?.status === 'active' ? currentRoundExec.id : null;

    for (const target of decision.selected) {
      // Ejecutar orden (simulada o real)
      const order = await exchangeConnector.placeOrder(target.symbol, 'BUY', target.capitalUSD, cfg, keys);
      const position = investManager.createPosition(target, cycleId || `manual_${Date.now()}`, cfg);
      position.exchangeOrderId = order.orderId || position.exchangeOrderId;
      position.orderDetails    = order;
      position.executedAt      = new Date().toISOString();
      // BUG FIX: guardar roundId en la posición para poder reconstruir la ronda sin depender de timestamps
      if (activeRoundId) position.roundId = activeRoundId;
      newPositions.push(position);
      orders.push({ symbol: target.symbol, order, position: position.id });
    }

    // Guardar nuevas posiciones
    const allPositions = [...positions, ...newPositions];
    await savePositions(allPositions);

    // BUG FIX: actualizar positionIds de la ronda activa
    if (activeRoundId && currentRoundExec && newPositions.length > 0) {
      const updatedRound = { ...currentRoundExec };
      updatedRound.positionIds = [
        ...(updatedRound.positionIds || []),
        ...newPositions.map(p => p.id),
      ];
      await saveCurrentRound(updatedRound);
    }

    // === LOG DETALLADO: invest ===
    const _capitalAfter = investManager.calculateAvailableCapital([...positions, ...newPositions], cfg.capitalTotal);
    const investLogEntry = {
      type:      'invest',
      subtype:   'execution',
      cycleId:   cycleId || null,
      timestamp: new Date().toISOString(),
      config: {
        mode:            cfg.mode,
        exchange:        cfg.exchange,
        capitalTotal:    cfg.capitalTotal,
        capitalPerCycle: cfg.capitalPerCycle,
        maxPositions:    cfg.maxPositions,
        minBoostPower:   cfg.minBoostPower,
        takeProfitPct:   cfg.takeProfitPct,
        stopLossPct:     cfg.stopLossPct,
        maxHoldCycles:   cfg.maxHoldCycles,
        feePct:          cfg.feePct,
        diversification: cfg.diversification,
      },
      capital: {
        before: {
          available: parseFloat(available.toFixed(2)),
          invested:  parseFloat((cfg.capitalTotal - available).toFixed(2)),
        },
        after: {
          available: parseFloat(_capitalAfter.toFixed(2)),
          invested:  parseFloat((cfg.capitalTotal - _capitalAfter).toFixed(2)),
        },
        deployedThisCycle: parseFloat(newPositions.reduce((s,p) => s + p.capitalUSD, 0).toFixed(2)),
        utilizationPct:    parseFloat(((cfg.capitalTotal - _capitalAfter) / cfg.capitalTotal * 100).toFixed(1)),
      },
      snapshot: {
        totalAssets:    snapshot.length,
        invertibles:    snapshot.filter(a => getClassificationStr(a) === 'INVERTIBLE').length,
        apalancados:    snapshot.filter(a => getClassificationStr(a) === 'APALANCADO').length,
        ruidosos:       snapshot.filter(a => getClassificationStr(a) === 'RUIDOSO').length,
        candidatesEval: decision.selected?.length || 0,
      },
      execution: {
        positionsOpened:  newPositions.length,
        totalInvestedUSD: parseFloat(newPositions.reduce((s,p) => s + p.capitalUSD, 0).toFixed(2)),
        totalFeesEstUSD:  parseFloat(newPositions.reduce((s,p) => s + (p.entryFeeUSD||0), 0).toFixed(4)),
        ordersPlaced:     orders.length,
        allOrdersOk:      orders.every(o => o.order?.success !== false),
      },
      positions: newPositions.map((p, i) => ({
        id:              p.id,
        symbol:          p.symbol,
        name:            p.name,
        assetId:         p.assetId,
        capitalUSD:      p.capitalUSD,
        units:           p.units,
        entryPrice:      p.entryPrice,
        takeProfitPrice: p.takeProfitPrice,
        stopLossPrice:   p.stopLossPrice,
        boostPower:      parseFloat((p.boostPower||0).toFixed(3)),
        boostPowerPct:   parseFloat(((p.boostPower||0)*100).toFixed(1)),
        predictedChange: p.predictedChange,
        entryFeeUSD:     p.entryFeeUSD,
        orderSimulated:  cfg.mode === 'simulated',
        openedAt:        p.openedAt,
        maxHoldCycles:   p.maxHoldCycles,
        selectionRank:   i + 1,
      })),
      decisionReason: decision.reason,
    };
    await appendInvestLog(investLogEntry);

    res.json({
      success:          true,
      invested:         true,
      mode:             cfg.mode,
      exchange:         cfg.exchange,
      positionsOpened:  newPositions.length,
      totalInvestedUSD: parseFloat(newPositions.reduce((s,p) => s + p.capitalUSD, 0).toFixed(2)),
      positions:        newPositions,
      orders
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/evaluate ────────────────────────────────────────────────
// Al completar un ciclo: evalúa posiciones abiertas y decide vender/mantener
app.post('/api/invest/evaluate', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const { cycleId } = req.body;

    const openPositions = positions.filter(p => p.status === 'open');
    if (!openPositions.length) return res.json({ success: true, evaluations: [], message: 'Sin posiciones abiertas' });

    // Obtener precios actuales reales de CoinGecko
    const ids    = [...new Set(openPositions.map(p => p.assetId))].join(',');
    let prices = {};
    try {
      const pRes = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
        { timeout: 6000 }
      );
      prices = pRes.data || {};
    } catch(_) {}

    const evaluations = [];
    const keys = await getExchangeKeys(cfg.exchange);

    for (const position of openPositions) {
      const currentPrice = prices[position.assetId]?.usd || position.currentPrice;
      const evaluation   = investManager.evaluatePosition(position, currentPrice, cycleId, cfg);
      const result = { positionId: position.id, symbol: position.symbol, ...evaluation, currentPrice };

      if (evaluation.decision === 'sell') {
        // Ejecutar venta
        const order = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);
        const closedPos = investManager.closePosition(position, currentPrice, evaluation.reason, cfg);
        Object.assign(position, closedPos);
        await onPositionClosed(position);
        position.exchangeCloseOrderId = order.orderId;
        result.sold    = true;
        result.orderOk = order.success;

        // Log de retroalimentación si fue pérdida
        if (evaluation.algorithmFeedback && !evaluation.algorithmFeedback.predictionCorrect) {
          result.feedback = evaluation.algorithmFeedback;
        }
      } else {
        result.sold = false;
        result.holdCycles = position.holdCycles;
      }
      evaluations.push(result);
    }

    // Guardar estado actualizado
    await savePositions(positions);

    const summary = investManager.buildCycleSummary(positions, cycleId, cfg);

    // === LOG DETALLADO: evaluate ===
    const _soldEvals  = evaluations.filter(e => e.sold);
    const _winsEvals  = _soldEvals.filter(e => (e.pnlPct||0) > 0);
    const evalLogEntry = {
      type:      'evaluate',
      subtype:   'cycle_evaluation',
      cycleId:   cycleId || null,
      timestamp: new Date().toISOString(),
      config: {
        mode:          cfg.mode,
        exchange:      cfg.exchange,
        takeProfitPct: cfg.takeProfitPct,
        stopLossPct:   cfg.stopLossPct,
        maxHoldCycles: cfg.maxHoldCycles,
        feePct:        cfg.feePct,
      },
      summary: {
        evaluated:    evaluations.length,
        sells:        _soldEvals.length,
        holds:        evaluations.filter(e => !e.sold).length,
        wins:         _winsEvals.length,
        losses:       _soldEvals.filter(e => (e.pnlPct||0) <= 0).length,
        netReturnUSD: summary.netReturnUSD,
        netReturnPct: summary.netReturnPct,
        totalPnLUSD:  summary.totalPnLUSD,
        totalFeesUSD: summary.totalFeesUSD,
        winRate:      _soldEvals.length > 0 ? parseFloat((_winsEvals.length / _soldEvals.length * 100).toFixed(1)) : null,
      },
      capital: {
        total:        cfg.capitalTotal,
        available:    parseFloat(investManager.calculateAvailableCapital(positions, cfg.capitalTotal).toFixed(2)),
        openRemaining: positions.filter(p => p.status === 'open').length,
      },
      evaluations: evaluations.map(e => {
        const pos = openPositions.find(p => p.id === e.positionId) || {};
        return {
          positionId:        e.positionId,
          symbol:            e.symbol,
          assetId:           pos.assetId,
          entryPrice:        pos.entryPrice,
          currentPrice:      e.currentPrice,
          takeProfitPrice:   pos.takeProfitPrice,
          stopLossPrice:     pos.stopLossPrice,
          pnlPct:            e.pnlPct,
          pnlUSD:            e.pnlUSD,
          netPnL:            e.netPnL,
          exitFeeUSD:        e.exitFeeUSD,
          decision:          e.decision,
          reason:            e.reason,
          sold:              e.sold,
          holdCycles:        e.holdCycles || pos.holdCycles,
          maxHoldCycles:     pos.maxHoldCycles,
          predictedChange:   pos.predictedChange,
          boostPower:        pos.boostPower,
          algorithmFeedback: e.feedback || null,
          predictionCorrect: e.feedback?.predictionCorrect ?? null,
          predictionError:   e.feedback?.errorMagnitude ?? null,
          orderOk:           e.orderOk,
        };
      }),
      algorithmFeedback: evaluations.filter(e => e.feedback).map(e => ({
        symbol:            e.symbol,
        predictionCorrect: e.feedback.predictionCorrect,
        predictedChange:   e.feedback.predictedChange,
        actualChange:      e.feedback.actualChange,
        errorMagnitude:    e.feedback.errorMagnitude,
        closeReason:       e.feedback.closeReason,
        suggestion:        e.feedback.suggestion,
      })),
    };
    await appendInvestLog(evalLogEntry);

    res.json({
      success: true,
      evaluations,
      summary,
      algorithmFeedback: evaluations.filter(e => e.feedback).map(e => e.feedback)
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/positions/close-orphaned ────────────────────────────────
// Cierra todas las posiciones abiertas que quedaron huérfanas (sin ronda activa).
// Permite desbloquear la apertura de una nueva ronda de inversión.
// ⚠️ DEBE ir ANTES de /:id/close para que Express no interprete 'close-orphaned' como un :id
app.post('/api/invest/positions/close-orphaned', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const openPos   = positions.filter(p => p.status === 'open');

    if (openPos.length === 0)
      return res.json({ success: true, closedCount: 0, message: 'Sin posiciones huérfanas' });

    const keys    = await getExchangeKeys(cfg.exchange);
    const results = [];

    for (const position of openPos) {
      try {
        // Precio actual con fallback en cadena
        let currentPrice = position.currentPrice || position.entryPrice;
        try {
          const pRes = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${position.assetId}&vs_currencies=usd`,
            { timeout: 5000 }
          );
          currentPrice = pRes.data?.[position.assetId]?.usd || currentPrice;
        } catch (_) {}

        const evaluation  = investManager.evaluatePosition(position, currentPrice, 'orphan_close', cfg);
        evaluation.reason = 'orphan_close: cierre de posición huérfana';

        const order = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);

        const closedPos = investManager.closePosition(position, currentPrice, evaluation.reason, cfg);
        Object.assign(position, closedPos);
        await onPositionClosed(position);
        position.exchangeCloseOrderId = order.orderId;

        results.push({ symbol: position.symbol, success: true, pnlPct: evaluation.pnlPct, pnlUSD: evaluation.pnlUSD });

      } catch (e) {
        // Si el exchange falla, forzar cierre en Redis igualmente para no quedar bloqueados
        position.status      = 'closed';
        position.closeReason = 'orphan_force_close: ' + e.message;
        position.closedAt    = new Date().toISOString();
        position.exitPrice   = position.currentPrice || position.entryPrice;
        const grossPnL = (position.exitPrice - position.entryPrice) * (position.units || 0);
        position.realizedPnL    = parseFloat(grossPnL.toFixed(4));
        position.realizedPnLPct = parseFloat(((grossPnL / (position.capitalUSD || 1)) * 100).toFixed(2));
        results.push({ symbol: position.symbol, success: false, forced: true, error: e.message });
      }
    }

    await savePositions(positions);
    await appendInvestLog({
      type:       'orphan_close',
      subtype:    'system_action',
      timestamp:  new Date().toISOString(),
      closedCount: results.length,
      results,
    });

    res.json({ success: true, closedCount: results.length, results });
  } catch(e) {
    console.error('[positions/close-orphaned] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/invest/positions/:id/close ─────────────────────────────────────
// Cerrar manualmente una posición
app.post('/api/invest/positions/:id/close', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const position  = positions.find(p => p.id === req.params.id);
    if (!position) return res.status(404).json({ success: false, error: 'Posición no encontrada' });
    if (position.status !== 'open') return res.status(400).json({ success: false, error: 'Posición ya cerrada' });

    // Precio actual real
    let currentPrice = position.currentPrice;
    try {
      const pRes = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${position.assetId}&vs_currencies=usd`,
        { timeout: 5000 }
      );
      currentPrice = pRes.data?.[position.assetId]?.usd || currentPrice;
    } catch(_) {}

    const evaluation = investManager.evaluatePosition(position, currentPrice, 'manual', cfg);
    evaluation.reason = 'manual: cierre manual del usuario';
    const keys = await getExchangeKeys(cfg.exchange);
    const order = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);
    const closedPos = investManager.closePosition(position, currentPrice, evaluation.reason, cfg);
    Object.assign(position, closedPos);
    await onPositionClosed(position);
    await savePositions(positions);

    // === LOG DETALLADO: manual_close ===
    const _holdMs = position.openedAt ? Date.now() - new Date(position.openedAt).getTime() : null;
    await appendInvestLog({
      type:      'manual_close',
      subtype:   'user_action',
      cycleId:   position.cycleId || null,
      timestamp: new Date().toISOString(),
      config: { mode: cfg.mode, exchange: cfg.exchange },
      capital: {
        total:     cfg.capitalTotal,
        available: parseFloat(investManager.calculateAvailableCapital(positions, cfg.capitalTotal).toFixed(2)),
      },
      position: {
        id:              position.id,
        symbol:          position.symbol,
        name:            position.name,
        assetId:         position.assetId,
        capitalUSD:      position.capitalUSD,
        units:           position.units,
        entryPrice:      position.entryPrice,
        exitPrice:       currentPrice,
        takeProfitPrice: position.takeProfitPrice,
        stopLossPrice:   position.stopLossPrice,
        openedAt:        position.openedAt,
        closedAt:        new Date().toISOString(),
        holdDurationMs:  _holdMs,
        holdDurationHrs: _holdMs ? parseFloat((_holdMs / 3600000).toFixed(2)) : null,
        holdCycles:      position.holdCycles,
        boostPower:      position.boostPower,
        predictedChange: position.predictedChange,
      },
      result: {
        pnlPct:            evaluation.pnlPct,
        pnlUSD:            evaluation.pnlUSD,
        netPnL:            evaluation.netPnL,
        exitFeeUSD:        evaluation.exitFeeUSD,
        totalFees:         (position.entryFeeUSD||0) + (evaluation.exitFeeUSD||0),
        isProfit:          (evaluation.pnlUSD||0) > 0,
        closeReason:       'manual',
        reason:            'Cierre manual por el usuario',
        predictionCorrect: (position.predictedChange||0) > 0 && (evaluation.pnlPct||0) > 0,
        algorithmFeedback: evaluation.algorithmFeedback,
      },
    });

    res.json({ success: true, position, evaluation, order });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/buy-manual ─────────────────────────────────────────────
// Lanza una orden de compra manual desde el Detector de Especulaciones Externas
// El activo entra directamente en el algoritmo de inversión (posición abierta)
app.post('/api/invest/buy-manual', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    let { assetData, capitalUSD: overrideCapital, cycleDurationMs } = req.body;

    // Normalizar assetData: puede llegar con 'assetId' en vez de 'id' (objetos del detector PUMP)
    if (assetData && !assetData.id && assetData.assetId) assetData.id = assetData.assetId;
    if (assetData && !assetData.symbol && assetData.id)  assetData.symbol = assetData.id;

    if (!assetData?.id || !assetData?.symbol) {
      return res.status(400).json({ success: false, error: 'assetData con id y symbol requerido', received: JSON.stringify(assetData) });
    }

    const cfg       = await getInvestConfig();
    const positions = await getPositions();

    // Verificar que no hay posición abierta ya para este activo
    const alreadyOpen = positions.find(p => p.assetId === assetData.id && p.status === 'open');
    if (alreadyOpen) {
      return res.status(400).json({ success: false, error: `Ya existe una posición abierta para ${assetData.symbol.toUpperCase()}` });
    }

    // Capital disponible
    const available = investManager.calculateAvailableCapital(positions, cfg.capitalTotal);
    if (available <= 0) {
      return res.status(400).json({ success: false, error: 'Sin capital disponible. Cierra alguna posición primero.' });
    }

    // Capital a asignar: override manual o capital por posición calculado
    const cycleCapital = cfg.capitalTotal * cfg.capitalPerCycle;
    const defaultCapital = cfg.diversification ? cycleCapital / cfg.maxPositions : cycleCapital;
    const capitalToUse = Math.min(
      overrideCapital ? parseFloat(overrideCapital) : defaultCapital,
      available
    );

    if (capitalToUse < 1) {
      return res.status(400).json({ success: false, error: 'Capital insuficiente (mínimo $1)' });
    }

    // Obtener precio actual — nunca usar 0 ni null
    let entryPrice = assetData.current_price;
    if (!entryPrice || entryPrice <= 0 || !isFinite(entryPrice)) {
      const priceInfo = await getSafePrice(assetData.id, assetData.symbol);
      if (priceInfo?.price && priceInfo.price > 0) entryPrice = priceInfo.price;
      else return res.status(400).json({ success: false, error: `Precio no disponible para ${assetData.symbol.toUpperCase()}. Reintenta en unos segundos.` });
    } else {
      try {
        const priceInfo = await getSafePrice(assetData.id, assetData.symbol);
        if (priceInfo?.price && priceInfo.price > 0) entryPrice = priceInfo.price;
      } catch (_) {}
    }

    // Construir objeto target compatible con createPosition
    const target = {
      assetId:         assetData.id,
      symbol:          assetData.symbol,
      name:            assetData.name || assetData.symbol,
      boostPower:      assetData.boostPower || 0,
      boostPowerPct:   assetData.boostPowerPercent || Math.round((assetData.boostPower || 0) * 100),
      classification:  typeof assetData.classification === 'object'
                         ? assetData.classification?.category || 'PUMP'
                         : assetData.classification || 'PUMP',
      entryPrice,
      predictedChange: assetData.predictedChange || 0,
      capitalUSD:      parseFloat(capitalToUse.toFixed(2)),
      weight:          parseFloat((capitalToUse / cfg.capitalTotal * 100).toFixed(1)),
      rank:            1,
      takeProfitPrice: parseFloat((entryPrice * (1 + cfg.takeProfitPct / 100)).toFixed(8)),
      stopLossPrice:   parseFloat((entryPrice * (1 - cfg.stopLossPct   / 100)).toFixed(8)),
      expectedFeeUSD:  parseFloat((capitalToUse * cfg.feePct / 100).toFixed(4)),
    };

    // Ejecutar orden en exchange (simulada/testnet/real según config)
    const keys  = await getExchangeKeys(cfg.exchange);
    const order = await exchangeConnector.placeOrder(target.symbol, 'BUY', target.capitalUSD, cfg, keys);

    // Crear posición con cycleId especial para identificar origen PUMP
    const cycleId  = `pump_manual_${Date.now()}`;
    const position = investManager.createPosition(target, cycleId, cfg);
    position.exchangeOrderId  = order.orderId || position.exchangeOrderId;
    position.orderDetails     = order;
    position.executedAt       = new Date().toISOString();
    position.source           = 'pump_detector';
    position.cycleDurationMs  = cycleDurationMs || 43200000;

    // BUG FIX: enlazar con la ronda activa si existe
    const currentRoundBuyManual = await getCurrentRound();
    const activeRoundIdBM       = currentRoundBuyManual?.status === 'active' ? currentRoundBuyManual.id : null;
    if (activeRoundIdBM) position.roundId = activeRoundIdBM;

    const allPositions = [...positions, position];
    await savePositions(allPositions);

    // BUG FIX: actualizar positionIds de la ronda activa
    if (activeRoundIdBM && currentRoundBuyManual) {
      const updatedRoundBM = { ...currentRoundBuyManual };
      updatedRoundBM.positionIds = [...(updatedRoundBM.positionIds || []), position.id];
      await saveCurrentRound(updatedRoundBM);
    }

    // Log de la operación
    await appendInvestLog({
      type:      'invest',
      subtype:   'pump_manual_buy',
      cycleId,
      timestamp: new Date().toISOString(),
      config:    { mode: cfg.mode, exchange: cfg.exchange },
      capital: {
        total:     cfg.capitalTotal,
        before:    parseFloat(available.toFixed(2)),
        after:     parseFloat(investManager.calculateAvailableCapital(allPositions, cfg.capitalTotal).toFixed(2)),
        used:      target.capitalUSD,
      },
      position: {
        id:              position.id,
        symbol:          position.symbol,
        name:            position.name,
        assetId:         position.assetId,
        source:          'pump_detector',
        capitalUSD:      position.capitalUSD,
        units:           position.units,
        entryPrice:      position.entryPrice,
        takeProfitPrice: position.takeProfitPrice,
        stopLossPrice:   position.stopLossPrice,
        boostPower:      position.boostPower,
        predictedChange: position.predictedChange,
        classification:  target.classification,
      },
      order: { success: order.success, orderId: order.orderId, simulated: cfg.mode === 'simulated' },
    });

    res.json({
      success:  true,
      position,
      order,
      capitalRemaining: parseFloat(investManager.calculateAvailableCapital(allPositions, cfg.capitalTotal).toFixed(2)),
      message: `✅ Orden de compra ejecutada: ${target.capitalUSD.toFixed(2)} USD en ${position.symbol.toUpperCase()} · TP: $${target.takeProfitPrice} · SL: $${target.stopLossPrice}`
    });

  } catch(e) {
    console.error('buy-manual error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/invest/log ──────────────────────────────────────────────────────
app.get('/api/invest/log', async (_req, res) => {
  try {
    const log = await getInvestLog();
    res.json({ success: true, log });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/log/analyze ────────────────────────────────────────────
// Envía el log completo + posiciones + performance a los N Sabios para análisis
app.post('/api/invest/log/analyze', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const { limit = 50 } = req.body;
    const [log, positions, cfg] = await Promise.all([getInvestLog(), getPositions(), getInvestConfig()]);

    if (!log.length) return res.status(400).json({ success: false, error: 'El log está vacío. Sin datos para analizar.' });

    const apiKeys = {
      gemini:   await getRedisKey('GEMINI_API_KEY'),
      claude:   await getRedisKey('ANTHROPIC_API_KEY'),
      openai:   await getRedisKey('OPENAI_API_KEY'),
      groq:     await getRedisKey('GROQ_API_KEY'),
      mistral:  await getRedisKey('MISTRAL_API_KEY'),
      cohere:   await getRedisKey('COHERE_API_KEY'),
      cerebras: await getRedisKey('CEREBRAS_API_KEY'),
    };
    if (!Object.values(apiKeys).filter(Boolean).length) {
      return res.status(400).json({ success: false, error: 'No hay API keys de LLMs configuradas. Configura al menos 1 en la pestaña APIs.' });
    }

    const closed  = positions.filter(p => p.status === 'closed');
    const open    = positions.filter(p => p.status === 'open');
    const recent  = log.slice(0, Math.min(limit, log.length));

    const totalInvested = closed.reduce((s,p) => s + (p.capitalUSD||0), 0);
    // realizedPnL ya es NETO de fees — netReturn = totalPnL directamente, sin restar fees de nuevo
    const totalPnL      = closed.reduce((s,p) => s + (p.realizedPnL||0), 0);
    const totalFees     = closed.reduce((s,p) => s + (p.totalFeesUSD||0), 0); // solo informativo
    const netReturn     = totalPnL;  // FIX: realizedPnL ya incluye el descuento de fees
    const wins          = closed.filter(p => (p.realizedPnL||0) > 0);
    const closeReasons  = {};
    closed.forEach(p => { const r = p.closeReason || 'unknown'; closeReasons[r] = (closeReasons[r]||0) + 1; });
    const badPreds      = closed.filter(p => p.algorithmFeedback && !p.algorithmFeedback.predictionCorrect);

    const performance = {
      totalOperations:   closed.length,
      openPositions:     open.length,
      totalInvestedUSD:  parseFloat(totalInvested.toFixed(2)),
      totalPnLUSD:       parseFloat(totalPnL.toFixed(4)),
      totalFeesUSD:      parseFloat(totalFees.toFixed(4)),
      netReturnUSD:      parseFloat(netReturn.toFixed(4)),
      netReturnPct:      totalInvested > 0 ? parseFloat((netReturn/totalInvested*100).toFixed(2)) : 0,
      winCount:          wins.length,
      lossCount:         closed.length - wins.length,
      winRate:           closed.length > 0 ? parseFloat((wins.length/closed.length*100).toFixed(1)) : null,
      closeReasons,
      badPredictions:    badPreds.length,
      badPredictionRate: closed.length > 0 ? parseFloat((badPreds.length/closed.length*100).toFixed(1)) : 0,
    };

    const prompt = `Eres un experto analista cuantitativo de trading de criptomonedas.
Analiza el rendimiento del módulo de inversión automático y proporciona un análisis pormenorizado.
Responde EXCLUSIVAMENTE con JSON válido (sin markdown, sin texto extra) con esta estructura:
{
  "overallAssessment": "Evaluación global (2-3 párrafos)",
  "strengths": ["punto fuerte 1", "..."],
  "weaknesses": ["debilidad 1", "..."],
  "keyFindings": [{"finding": "...", "evidence": "...", "impact": "high|medium|low"}],
  "parameterRecommendations": {
    "takeProfitPct":  {"current": ${cfg.takeProfitPct},  "suggested": null, "reason": ""},
    "stopLossPct":    {"current": ${cfg.stopLossPct},    "suggested": null, "reason": ""},
    "minBoostPower":  {"current": ${cfg.minBoostPower},  "suggested": null, "reason": ""},
    "maxHoldCycles":  {"current": ${cfg.maxHoldCycles},  "suggested": null, "reason": ""},
    "capitalPerCycle":{"current": ${cfg.capitalPerCycle},"suggested": null, "reason": ""},
    "minSignals":     {"current": ${cfg.minSignals},     "suggested": null, "reason": ""}
  },
  "riskAssessment": "Evaluación del riesgo",
  "actionPlan": ["Acción 1", "Acción 2", "Acción 3"],
  "predictionQuality": "Análisis de la calidad predictiva del BoostPower",
  "summary": "Conclusión en 1 párrafo"
}

=== CONFIG ===
${JSON.stringify({mode:cfg.mode,exchange:cfg.exchange,capitalTotal:cfg.capitalTotal,capitalPerCycle:cfg.capitalPerCycle,maxPositions:cfg.maxPositions,minBoostPower:cfg.minBoostPower,minSignals:cfg.minSignals,takeProfitPct:cfg.takeProfitPct,stopLossPct:cfg.stopLossPct,maxHoldCycles:cfg.maxHoldCycles})}

=== MÉTRICAS GLOBALES ===
${JSON.stringify(performance)}

=== LOG RECIENTE (${recent.length} entradas) ===
${JSON.stringify(recent)}

=== POSICIONES CERRADAS ===
${JSON.stringify(closed.slice(0,30).map(p=>({symbol:p.symbol,capitalUSD:p.capitalUSD,entryPrice:p.entryPrice,exitPrice:p.currentPrice,pnlPct:p.realizedPnLPct,pnlUSD:p.realizedPnL,fees:p.totalFeesUSD,closeReason:p.closeReason,holdCycles:p.holdCycles,boostPower:p.boostPower,predictedChange:p.predictedChange,predictionCorrect:p.algorithmFeedback?.predictionCorrect})))}

=== POSICIONES ABIERTAS ===
${JSON.stringify(open.map(p=>({symbol:p.symbol,capitalUSD:p.capitalUSD,entryPrice:p.entryPrice,currentPrice:p.currentPrice,unrealizedPnLPct:p.unrealizedPnLPct,holdCycles:p.holdCycles,maxHoldCycles:p.maxHoldCycles})))}`;

    // Llamar a LLMs en paralelo con axios directamente
    async function callLLM(name, fn) {
      try { return await fn(); }
      catch(e) { return { success: false, model: name, error: e.message }; }
    }
    function parseResp(text, model) {
      try {
        const clean = text.trim().replace(/```json[\r\n]?/g,'').replace(/```[\r\n]?/g,'').trim();
        const parsed = JSON.parse(clean);
        return { success: true, model, data: parsed, rawResponse: text.slice(0,200) };
      } catch(e) { return { success: false, model, error: `Parse failed: ${e.message}`, rawResponse: text.slice(0,300) }; }
    }

    const llmCalls = [];
    if (apiKeys.gemini) llmCalls.push(callLLM('Gemini', async () => {
      for (const m of ['gemini-2.0-flash','gemini-1.5-flash-latest']) {
        try {
          const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKeys.gemini}`,
            { contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.3,maxOutputTokens:2048} }, {timeout:30000});
          const t = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const res = parseResp(t, 'Gemini'); if (res.success) { res.modelUsed=m; return res; }
        } catch(e) { if (e.response?.status===404) continue; throw e; }
      }
      return { success:false, model:'Gemini', error:'No model available' };
    }));
    if (apiKeys.claude) llmCalls.push(callLLM('Claude', async () => {
      for (const m of ['claude-sonnet-4-5','claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022']) {
        try {
          const r = await axios.post('https://api.anthropic.com/v1/messages',
            { model:m, max_tokens:2048, temperature:0.3, messages:[{role:'user',content:prompt}] },
            { headers:{'x-api-key':apiKeys.claude,'anthropic-version':'2023-06-01','content-type':'application/json'}, timeout:30000 });
          const t = r.data?.content?.[0]?.text || '';
          const res = parseResp(t, 'Claude'); if (res.success) { res.modelUsed=m; return res; }
        } catch(e) { if (e.response?.status===400) continue; throw e; }
      }
      return { success:false, model:'Claude', error:'No model available' };
    }));
    if (apiKeys.openai) llmCalls.push(callLLM('OpenAI', async () => {
      for (const m of ['gpt-4o','gpt-4o-mini']) {
        try {
          const r = await axios.post('https://api.openai.com/v1/chat/completions',
            { model:m, messages:[{role:'user',content:prompt}], temperature:0.3, max_tokens:2048 },
            { headers:{'Authorization':`Bearer ${apiKeys.openai}`,'Content-Type':'application/json'}, timeout:30000 });
          const t = r.data?.choices?.[0]?.message?.content || '';
          const res = parseResp(t, 'OpenAI'); if (res.success) { res.modelUsed=m; return res; }
        } catch(e) { if ([429,404].includes(e.response?.status)) continue; throw e; }
      }
      return { success:false, model:'OpenAI', error:'No quota' };
    }));
    if (apiKeys.groq) llmCalls.push(callLLM('Llama', async () => {
      const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
        { model:'llama-3.3-70b-versatile', messages:[{role:'user',content:prompt}], temperature:0.3, max_tokens:2048 },
        { headers:{'Authorization':`Bearer ${apiKeys.groq}`,'Content-Type':'application/json'}, timeout:30000 });
      const t = r.data?.choices?.[0]?.message?.content || '';
      return parseResp(t, 'Llama');
    }));
    if (apiKeys.mistral) llmCalls.push(callLLM('Mistral', async () => {
      const r = await axios.post('https://api.mistral.ai/v1/chat/completions',
        { model:'mistral-small-latest', messages:[{role:'user',content:prompt}], temperature:0.3, max_tokens:2048 },
        { headers:{'Authorization':`Bearer ${apiKeys.mistral}`,'Content-Type':'application/json'}, timeout:30000 });
      const t = r.data?.choices?.[0]?.message?.content || '';
      return parseResp(t, 'Mistral');
    }));
    if (apiKeys.cerebras) llmCalls.push(callLLM('Cerebras', async () => {
      const r = await axios.post('https://api.cerebras.ai/v1/chat/completions',
        { model:'llama-3.3-70b', messages:[{role:'user',content:prompt}], temperature:0.3, max_tokens:2048 },
        { headers:{'Authorization':`Bearer ${apiKeys.cerebras}`,'Content-Type':'application/json'}, timeout:20000 });
      const t = r.data?.choices?.[0]?.message?.content || '';
      return parseResp(t, 'Cerebras');
    }));

    const llmResults = {};
    const results = await Promise.allSettled(llmCalls);
    results.forEach(r => {
      const val = r.status === 'fulfilled' ? r.value : { success:false, error:'Promise rejected' };
      llmResults[val.model || 'unknown'] = val;
    });

    // Consenso básico de parámetros
    const successful = Object.values(llmResults).filter(r => r.success);
    const paramKeys  = ['takeProfitPct','stopLossPct','minBoostPower','maxHoldCycles','capitalPerCycle','minSignals'];
    const paramConsensus = {};
    paramKeys.forEach(param => {
      const suggestions = successful.map(r => r.data?.parameterRecommendations?.[param]?.suggested).filter(v => v !== null && v !== undefined);
      if (suggestions.length > 0) {
        paramConsensus[param] = {
          suggestions,
          avg:   parseFloat((suggestions.reduce((s,v) => s+parseFloat(v),0)/suggestions.length).toFixed(3)),
          agree: suggestions.length >= 2 && (Math.max(...suggestions)-Math.min(...suggestions)) < Math.max(...suggestions)*0.15,
        };
      }
    });

    res.json({
      success:         true,
      analyzedEntries: recent.length,
      performance,
      llmResults,
      consensus: {
        respondedCount:           successful.length,
        totalCalled:              Object.keys(llmResults).length,
        models:                   successful.map(r => r.model || r.modelUsed),
        parameterRecommendations: paramConsensus,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch(e) {
    console.error('invest/log/analyze error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/invest/log/export ───────────────────────────────────────────────
app.get('/api/invest/log/export', async (_req, res) => {
  try {
    const [log, positions, cfg] = await Promise.all([getInvestLog(), getPositions(), getInvestConfig()]);
    const closed = positions.filter(p => p.status === 'closed');
    const exportData = {
      exportedAt:    new Date().toISOString(),
      schemaVersion: 2,
      config:        cfg,
      summary: {
        totalLogEntries:  log.length,
        totalPositions:   positions.length,
        openPositions:    positions.filter(p => p.status === 'open').length,
        closedPositions:  closed.length,
        totalNetPnL:      parseFloat(closed.reduce((s,p) => s+(p.realizedPnL||0),0).toFixed(4)),
        totalFees:        parseFloat(closed.reduce((s,p) => s+(p.totalFeesUSD||0),0).toFixed(4)),
      },
      log,
      positions,
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=invest-log-${new Date().toISOString().slice(0,10)}.json`);
    res.json(exportData);
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/invest/performance ──────────────────────────────────────────────
app.get('/api/invest/performance', async (_req, res) => {
  try {
    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const closed    = positions.filter(p => p.status === 'closed');
    const open      = positions.filter(p => p.status === 'open');

    const totalInvested  = closed.reduce((s,p) => s + (p.capitalUSD||0), 0);
    // realizedPnL ya es NETO de fees — netReturn = totalPnL directamente, sin restar fees de nuevo
    const totalPnL       = closed.reduce((s,p) => s + (p.realizedPnL||0), 0);
    const totalFees      = closed.reduce((s,p) => s + (p.totalFeesUSD||0), 0); // solo informativo
    const netReturn      = totalPnL;  // FIX: realizedPnL ya incluye el descuento de fees
    const wins           = closed.filter(p => (p.realizedPnL||0) > 0);
    const losses         = closed.filter(p => (p.realizedPnL||0) <= 0);
    const available      = investManager.calculateAvailableCapital(positions, cfg.capitalTotal);

    // Breakdown por razón de cierre
    const closeReasons = {};
    closed.forEach(p => {
      const r = p.closeReason || 'unknown';
      closeReasons[r] = (closeReasons[r] || 0) + 1;
    });

    // Feedback del algoritmo (cuántas predicciones fueron malas)
    const badPredictions = closed.filter(p => p.algorithmFeedback && !p.algorithmFeedback.predictionCorrect);

    res.json({
      success: true,
      mode:    cfg.mode,
      exchange: cfg.exchange,
      capital: {
        total:     cfg.capitalTotal,
        available: parseFloat(available.toFixed(2)),
        invested:  parseFloat((cfg.capitalTotal - available).toFixed(2)),
        unrealizedPnL: parseFloat(open.reduce((s,p) => s + (p.unrealizedPnL||0), 0).toFixed(4))
      },
      performance: {
        totalOperations:  closed.length,
        openPositions:    open.length,
        totalInvestedUSD: parseFloat(totalInvested.toFixed(2)),
        totalPnLUSD:      parseFloat(totalPnL.toFixed(4)),
        totalFeesUSD:     parseFloat(totalFees.toFixed(4)),
        netReturnUSD:     parseFloat(netReturn.toFixed(4)),
        netReturnPct:     totalInvested > 0 ? parseFloat((netReturn/totalInvested*100).toFixed(2)) : 0,
        winRate:          closed.length > 0 ? parseFloat((wins.length/closed.length*100).toFixed(1)) : null,
        avgWinPct:        wins.length   > 0 ? parseFloat((wins.reduce((s,p)=>s+(p.realizedPnLPct||0),0)/wins.length).toFixed(2)) : null,
        avgLossPct:       losses.length > 0 ? parseFloat((losses.reduce((s,p)=>s+(p.realizedPnLPct||0),0)/losses.length).toFixed(2)) : null,
        closeReasons,
        badPredictions:   badPredictions.length,
        badPredictionRate: closed.length > 0 ? parseFloat((badPredictions.length/closed.length*100).toFixed(1)) : 0
      }
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/api-key ─────────────────────────────────────────────────
// Guardar keys de exchange en Redis
app.post('/api/invest/api-key', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  const { keyName, keyValue } = req.body;
  const allowed = ['BINANCE_API_KEY','BINANCE_SECRET_KEY','COINBASE_API_KEY','COINBASE_SECRET_KEY'];
  if (!allowed.includes(keyName)) return res.status(400).json({ success: false, error: 'Key no permitida' });
  if (!keyValue?.trim()) return res.status(400).json({ success: false, error: 'Valor requerido' });
  try {
    await redisSet(`apikey:${keyName}`, keyValue.trim());
    res.json({ success: true, saved: keyName });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// DETECTOR DE PUMP COORDINADO
// ════════════════════════════════════════════════════════════════════════════

const PUMP_SCAN_KEY       = 'pump:last-scan';
const PUMP_HISTORY_KEY    = 'pump:history';
const PUMP_EMAIL_CFG_KEY  = 'pump:email-config';
const PUMP_SETTINGS_KEY   = 'pump:settings';

const DEFAULT_PUMP_SETTINGS = {
  enabled:        true,
  intervalHours:  6,             // escaneo cada N horas
  minScoreAlert:  4,             // score mínimo para enviar email
  emailEnabled:   false,
  lastScanAt:     null
};

async function getPumpSettings() {
  const stored = await redisGet(PUMP_SETTINGS_KEY);
  if (stored && typeof stored === 'object') return { ...DEFAULT_PUMP_SETTINGS, ...stored };
  return { ...DEFAULT_PUMP_SETTINGS };
}

async function getPumpEmailCfg() {
  const stored = await redisGet(PUMP_EMAIL_CFG_KEY);
  if (stored && typeof stored === 'object') return stored;
  return {};
}

// Helper: pasar getRedisKey al pump-detector
async function _getRedisKey(name) { return getRedisKey(name); }

// ── Ejecutar escaneo y guardar resultados ─────────────────────────────────
async function executePumpScan() {
  const result = await pumpDetector.runPumpScan(redis, _getRedisKey);
  if (!result.success) return result;

  // Guardar último escaneo
  await redisSet(PUMP_SCAN_KEY, result);

  // Añadir al historial (max 50 entradas con detecciones relevantes)
  if (result.detections.length > 0) {
    let history = [];
    try { const h = await redisGet(PUMP_HISTORY_KEY); history = Array.isArray(h) ? h : []; } catch(_) {}
    history.unshift({ scannedAt: result.scannedAt, detections: result.detections.slice(0, 5) });
    await redisSet(PUMP_HISTORY_KEY, history.slice(0, 50));
  }

  // Enviar alertas por email si hay detecciones con score suficiente
  const settings  = await getPumpSettings();
  const emailCfg  = await getPumpEmailCfg();
  if (settings.emailEnabled && emailCfg.user && emailCfg.to) {
    const toAlert = result.detections.filter(d => d.totalScore >= settings.minScoreAlert);
    for (const det of toAlert) {
      await alertService.sendPumpAlert(det, emailCfg);
      await new Promise(r => setTimeout(r, 500)); // throttle
    }
  }

  // Actualizar lastScanAt
  await redisSet(PUMP_SETTINGS_KEY, { ...settings, lastScanAt: result.scannedAt });

  return result;
}

// ── Scheduler en memoria (para desarrollo local) ───────────────────────────
let pumpSchedulerTimer = null;
async function startPumpScheduler() {
  if (pumpSchedulerTimer) clearInterval(pumpSchedulerTimer);
  const settings = await getPumpSettings();
  if (!settings.enabled) return;
  const ms = (settings.intervalHours || 6) * 3600000;
  pumpSchedulerTimer = setInterval(async () => {
    try { await executePumpScan(); } catch(e) { console.error('[PumpDetector] Error:', e.message); }
  }, ms);
  console.log(`[PumpDetector] Scheduler activo — cada ${settings.intervalHours}h`);
}

// Arrancar scheduler al iniciar si Redis disponible
if (redis) { setTimeout(() => startPumpScheduler().catch(()=>{}), 5000); }

// ── GET /api/pump/scan ─────────────────────────────────────────────────────
// Último resultado guardado (sin re-escanear)
app.get('/api/pump/scan', async (_req, res) => {
  try {
    const last = await redisGet(PUMP_SCAN_KEY);
    if (last) return res.json({ success: true, cached: true, ...last });
    res.json({ success: true, cached: false, detections: [], message: 'Sin escaneos previos. Ejecuta /api/pump/run-scan para escanear.' });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/pump/run-scan ───────────────────────────────────────────────
// Forzar escaneo ahora (puede tardar 20-40s)
app.post('/api/pump/run-scan', async (_req, res) => {
  try {
    res.json({ success: true, message: 'Escaneo iniciado en background. Consulta /api/pump/scan en ~30s.' });
    // Ejecutar de forma asíncrona sin bloquear la respuesta
    setImmediate(() => executePumpScan().catch(e => console.error('[PumpScan] Error:', e.message)));
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/pump/scan-sync ──────────────────────────────────────────────
// Escaneo síncrono para UI con feedback directo (timeout 60s)
app.post('/api/pump/scan-sync', async (_req, res) => {
  try {
    const result = await executePumpScan();
    res.json(result);
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/pump/history ─────────────────────────────────────────────────
app.get('/api/pump/history', async (_req, res) => {
  try {
    let history = [];
    try { const h = await redisGet(PUMP_HISTORY_KEY); history = Array.isArray(h) ? h : []; } catch(_) {}
    res.json({ success: true, history });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});
// ── GET /api/pump/asset/:id ──────────────────────────────────────────────────
// Retorna análisis completo del activo: datos de pump + scoring del algoritmo
app.get('/api/pump/asset/:id', async (req, res) => {
  try {
    const mode   = req.query.mode || 'speculative'; // pumps son small-caps
    const config = await getConfig(mode);
    const { id } = req.params;

    // Obtener datos del activo desde CoinGecko
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

    if (detail?.market_data) {
      crypto.price_change_percentage_30d = detail.market_data.price_change_percentage_30d;
      crypto.price_change_percentage_7d_in_currency = detail.market_data.price_change_percentage_7d_in_currency?.usd;
      crypto.circulating_supply = detail.market_data.circulating_supply;
      crypto.total_supply       = detail.market_data.total_supply;
      crypto.max_supply         = detail.market_data.max_supply;
    }

    // Análisis de pump (mismo que el scan)
    const pumpAnalysis = await pumpDetector.analyzePumpForAsset(crypto, getRedisKey);

    // Datos cualitativos: noticias, reddit, etc
    const [newsRes, redditRes, coinDeskRes, coinTelRes, lunarRes, santRes, trendsRes] = await Promise.allSettled([
      getAssetNews(crypto.symbol, crypto.name),
      getAssetReddit(crypto.symbol, crypto.name, crypto.market_cap),
      getCoinDeskNews(crypto.symbol, crypto.name),
      getCoinTelegraphNews(crypto.symbol, crypto.name),
      getLunarCrushData(crypto.symbol),
      getSantimentData(crypto.symbol),
      getGoogleTrends(crypto.name, crypto.symbol)
    ]);

    const assetNews    = newsRes.status      === 'fulfilled' ? newsRes.value      : { success: false, count: 0, articles: [], avgSentiment: 0 };
    const assetReddit  = redditRes.status    === 'fulfilled' ? redditRes.value    : { success: false, postCount: 0, posts: [] };
    const coinDesk     = coinDeskRes.status  === 'fulfilled' ? coinDeskRes.value  : { success: false };
    const coinTel      = coinTelRes.status   === 'fulfilled' ? coinTelRes.value   : { success: false };
    const lunarCrush   = lunarRes.status     === 'fulfilled' ? lunarRes.value     : { success: false };
    const santiment    = santRes.status      === 'fulfilled' ? santRes.value      : { success: false };
    const googleTrends = trendsRes.status    === 'fulfilled' ? trendsRes.value    : { success: false };

    const allArticles = [
      ...(assetNews.articles || []),
      ...(coinDesk.articles  || []),
      ...(coinTel.articles   || [])
    ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const seenTitles = new Set();
    const dedupedArticles = allArticles.filter(a => {
      const k = (a.title || '').slice(0, 50);
      if (seenTitles.has(k)) return false; seenTitles.add(k); return true;
    });
    const mergedNews = dedupedArticles.length > 0 ? (() => {
      let weightedSum = 0, totalWeight = 0;
      dedupedArticles.forEach(a => {
        const w = a.sentiment?.relevant ? 2 : 1;
        weightedSum += (a.sentiment?.score || 0) * w;
        totalWeight += w;
      });
      const specificCount = dedupedArticles.filter(a => a.sentiment?.relevant).length;
      return {
        success: true, count: dedupedArticles.length, specificCount, genericCount: dedupedArticles.length - specificCount,
        articles: dedupedArticles.slice(0, 10), avgSentiment: totalWeight > 0 ? weightedSum / totalWeight : 0,
        rawAvgSentiment: dedupedArticles.reduce((s, a) => s + (a.sentiment?.score || 0), 0) / dedupedArticles.length,
        sources: [assetNews.success && 'NewsAPI/CC', coinDesk.success && 'CoinDesk', coinTel.success && 'CoinTelegraph'].filter(Boolean)
      };
    })() : { success: false, count: 0, specificCount: 0, genericCount: 0, articles: [], avgSentiment: 0 };

    const externalData = {
      fearGreed:    fg.success            ? fg           : null,
      assetNews:    mergedNews.success    ? mergedNews   : (assetNews.success ? assetNews : null),
      assetReddit:  assetReddit.success   ? assetReddit  : null,
      lunarCrush:   lunarCrush.success    ? lunarCrush   : null,
      santiment:    santiment.success     ? santiment    : null,
      googleTrends: googleTrends.success  ? googleTrends : null,
      marketNews:   null
    };

    // Análisis del algoritmo principal (boostPower, clasificación, predicción)
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
        // Análisis del algoritmo
        boostPower:         result.boostPower,
        boostPowerPercent:  result.boostPowerPercent,
        predictedChange:    result.predictedChange,
        classification:     result.classification,
        breakdown:          result.breakdown,
        summary,
        // Análisis de pump
        pumpAnalysis: pumpAnalysis || { totalScore: 0, riskLevel: 'Normal', riskColor: 'text-gray-400', evidence: [] },
        // Datos cualitativos
        news:        mergedNews.success  ? { count: mergedNews.count, specificCount: mergedNews.specificCount, genericCount: mergedNews.genericCount,
                       avgSentiment: mergedNews.avgSentiment, rawAvgSentiment: mergedNews.rawAvgSentiment,
                       articles: mergedNews.articles, sources: mergedNews.sources } : null,
        reddit:      assetReddit.success ? { postCount: assetReddit.postCount, avgSentiment: assetReddit.avgSentiment,
                       posts: assetReddit.posts, subredditsSearched: assetReddit.subredditsSearched } : null,
        lunarCrush:  lunarCrush.success  ? lunarCrush  : null,
        santiment:   santiment.success   ? santiment   : null,
        googleTrends: googleTrends.success ? {
                        currentInterest: googleTrends.currentInterest,
                        average:         googleTrends.average,
                        peak:            googleTrends.peak,
                        trend:           googleTrends.trend,
                        growthPercent:   googleTrends.growthPercent,
                        period:          googleTrends.period,
                        query:           googleTrends.query,
                        cached:          googleTrends.cached ?? false
                      } : null,
        fearGreed:   fg.success          ? { value: fg.value, classification: fg.classification } : null
      }
    });
  } catch(e) {
    console.error('/api/pump/asset/:id error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});


// ── GET /api/pump/settings ────────────────────────────────────────────────

// ── POST /api/cycles/add-asset ───────────────────────────────────────────────
// Añade un activo manualmente a un ciclo activo o crea nuevo ciclo si no existe
app.post('/api/cycles/add-asset', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const { assetId, mode } = req.body;
    if (!assetId) return res.status(400).json({ success: false, error: 'assetId requerido' });

    const cycleMode = mode || 'speculative'; // pumps detectados son especulativos por defecto
    const config    = await getConfig(cycleMode);

    // Obtener datos del activo
    const r = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${assetId}` +
      `&order=market_cap_desc&per_page=1&sparkline=false&price_change_percentage=24h,7d,30d`,
      { timeout: 6000 }
    );
    const crypto = r.data?.[0];
    if (!crypto) return res.status(404).json({ success: false, error: `Activo ${assetId} no encontrado` });

    // Obtener noticias y reddit básicos para el análisis
    const [newsRes, redditRes, fgRes, trendsRes] = await Promise.allSettled([
      getAssetNews(crypto.symbol, crypto.name),
      getAssetReddit(crypto.symbol, crypto.name, crypto.market_cap),
      getFearGreedIndex(),
      getGoogleTrends(crypto.name, crypto.symbol)
    ]);
    const assetNews    = newsRes.status === 'fulfilled'   ? newsRes.value   : { success: false, count: 0 };
    const assetReddit  = redditRes.status === 'fulfilled' ? redditRes.value : { success: false, postCount: 0 };
    const fg           = fgRes.status === 'fulfilled'     ? fgRes.value     : { success: false };
    const googleTrends = trendsRes.status === 'fulfilled' ? trendsRes.value : { success: false };

    const externalData = {
      fearGreed:    fg.success           ? fg           : null,
      assetNews:    assetNews.success    ? assetNews    : null,
      assetReddit:  assetReddit.success  ? assetReddit  : null,
      googleTrends: googleTrends.success ? googleTrends : null,
      marketNews:   null
    };

    // Calcular boostPower y clasificación
    const result = boostPowerCalc.calculateBoostPower(crypto, config, externalData);
    const assetData = {
      id:                          crypto.id,
      symbol:                      crypto.symbol,
      name:                        crypto.name,
      current_price:               crypto.current_price,
      market_cap:                  crypto.market_cap,
      total_volume:                crypto.total_volume,
      price_change_percentage_24h: crypto.price_change_percentage_24h,
      ath:                         crypto.ath,
      atl:                         crypto.atl,
      boostPower:                  result.boostPower,
      boostPowerPercent:           result.boostPowerPercent,
      classification:              result.classification.category,
      predictedChange:             result.predictedChange,
      breakdown:                   result.breakdown,           // incluye indicators con trends
      googleTrends:                googleTrends.success ? googleTrends : null,
      manuallyAdded:               true,  // marcar que fue añadido manual
      addedAt:                     new Date().toISOString()
    };

    // Buscar ciclo activo del mismo modo
    const activeIds = await cyclesManager.getActiveCycles(redis);
    const activeCycles = await cyclesManager.getCyclesDetails(redis, activeIds);
    let targetCycle = activeCycles.find(c => (c.mode || 'normal') === cycleMode && c.status === 'active');

    if (targetCycle) {
      // Añadir al ciclo existente
      const existing = targetCycle.snapshot.find(a => a.id === assetId);
      if (existing) {
        return res.status(400).json({ success: false, error: 'Activo ya presente en el ciclo activo' });
      }
      targetCycle.snapshot.push(assetData);
      await redisSet(targetCycle.id, targetCycle);
      res.json({ success: true, message: `Activo añadido al ciclo activo ${targetCycle.id}`, cycleId: targetCycle.id, asset: assetData });
    } else {
      // No hay ciclo activo → crear uno nuevo con duración 12h
      const durationMs = 12 * 3600000;
      const snapshot   = [assetData];
      const cycle      = await cyclesManager.createCycle(redis, snapshot, config, durationMs, cycleMode);
      res.json({ success: true, message: `Nuevo ciclo ${cycle.id} creado con el activo`, cycleId: cycle.id, asset: assetData, newCycle: true });
    }
  } catch(e) {
    console.error('add-asset error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/pump/settings', async (_req, res) => {
  try {
    const settings = await getPumpSettings();
    const emailCfg = await getPumpEmailCfg();
    res.json({ success: true, settings, emailConfigured: !!(emailCfg.user && emailCfg.to) });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/pump/settings ───────────────────────────────────────────────
app.post('/api/pump/settings', async (req, res) => {
  try {
    const current  = await getPumpSettings();
    const updated  = { ...current, ...req.body, lastScanAt: current.lastScanAt };
    await redisSet(PUMP_SETTINGS_KEY, updated);
    // Reiniciar scheduler si cambió el intervalo
    if (req.body.intervalHours || req.body.enabled !== undefined) {
      if (pumpSchedulerTimer) clearInterval(pumpSchedulerTimer);
      if (updated.enabled) startPumpScheduler().catch(()=>{});
    }
    res.json({ success: true, settings: updated });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/pump/email-config ───────────────────────────────────────────
app.post('/api/pump/email-config', async (req, res) => {
  try {
    const { host, port, user, pass, to } = req.body;
    if (!user || !to) return res.status(400).json({ success: false, error: 'user y to son requeridos' });
    const cfg = { host: host || 'smtp.gmail.com', port: port || 587, user, pass, to };
    await redisSet(PUMP_EMAIL_CFG_KEY, cfg);
    res.json({ success: true, configured: true, to, user });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/pump/test-email ─────────────────────────────────────────────
app.post('/api/pump/test-email', async (_req, res) => {
  try {
    const emailCfg = await getPumpEmailCfg();
    if (!emailCfg.user || !emailCfg.to) return res.status(400).json({ success: false, error: 'Email no configurado' });
    // Crear detección de prueba
    const testDet = {
      name: 'TEST COIN', symbol: 'TEST', market_cap: 50_000_000, total_volume: 5_000_000,
      totalScore: 5, riskLevel: 'SOSPECHOSO', riskColor: 'orange', riskEmoji: '⚠️',
      detectedAt: new Date().toISOString(),
      breakdown: { socialSpike:{score:2,max:4}, volumeAnomaly:{score:2,max:2}, vacuousNews:{score:1,max:2}, whaleActivity:{score:0,max:2}, lunarCrush:{score:0,max:2}, timingSync:{score:0,max:1} },
      evidence: ['Este es un email de prueba del sistema CryptoDetector', 'Confirma que las alertas funcionan correctamente'],
      flaggedNews: [], clonedSignals: []
    };
    const result = await alertService.sendPumpAlert(testDet, emailCfg);
    res.json({ success: result.success, ...result });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/pump/cron ────────────────────────────────────────────────────
// Endpoint para cron externo (Vercel Cron, cron-job.org, etc.)
// Llamar cada 6h desde vercel.json: { "crons": [{ "path": "/api/pump/cron", "schedule": "0 */6 * * *" }] }
app.get('/api/pump/cron', async (req, res) => {
  // Autenticación básica por header para cron externo
  const authHeader = req.headers['x-cron-secret'];
  const cronSecret = await getRedisKey('CRON_SECRET');
  if (cronSecret && authHeader !== cronSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    res.json({ success: true, message: 'Cron iniciado' });
    setImmediate(() => executePumpScan().catch(e => console.error('[Cron] Error:', e.message)));
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/watchdog ─────────────────────────────────────────────────
// Watchdog automático SL/TP — llamado cada 30 min desde el frontend.
// Usa precios almacenados en la posición (takeProfitPrice / stopLossPrice),
// NO recalcula desde cfg para evitar que cambios retroactivos afecten posiciones.
// No incrementa holdCycles — eso solo ocurre al completar ciclos.
app.post('/api/invest/watchdog', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const open      = positions.filter(p => p.status === 'open');

    if (!open.length) return res.json({ success: true, checked: 0, actions: [], holds: 0, sells: 0, errors: 0, staleIds: [], priceSource: 'none', message: 'Sin posiciones abiertas' });

    const assetIds  = [...new Set(open.map(p => p.assetId))];
    const symbolMap = {};
    open.forEach(p => { symbolMap[p.assetId] = p.symbol; });

    const { prices, meta } = await fetchAndCachePrices(assetIds, symbolMap);

    const actions    = [];
    const checked    = [];
    const keys       = await getExchangeKeys(cfg.exchange);
    let   posChanged = false;

    for (const position of open) {
      const priceInfo    = prices[position.assetId];
      const currentPrice = priceInfo?.price; // FIX: fetchAndCachePrices usa .price, nunca .usd

      if (!currentPrice) {
        checked.push({ assetId: position.assetId, symbol: position.symbol, status: 'no_price' });
        continue;
      }

      const isStale = priceInfo?.isStale === true;
      const pnlPct  = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

      // Usar precios fijados al abrir (no recalcular desde cfg)
      const tpPrice = position.takeProfitPrice;
      const slPrice = position.stopLossPrice;
      const tpPct   = tpPrice ? ((tpPrice - position.entryPrice) / position.entryPrice) * 100 : cfg.takeProfitPct;
      const slPct   = slPrice ? ((position.entryPrice - slPrice) / position.entryPrice) * 100 : cfg.stopLossPct;

      const hitTP = !isStale && (tpPrice ? currentPrice >= tpPrice : pnlPct >= tpPct);
      const hitSL = slPrice ? currentPrice <= slPrice : pnlPct <= -slPct;

      // Criterio adicional: predicción del ciclo alcanzada (dispara aunque sea < TP)
      const predictedTarget = parseFloat(position.predictedChange || 0);
      const hitPred = !isStale && predictedTarget > 0 && pnlPct > 0 && pnlPct >= predictedTarget;

      const checkEntry = {
        positionId: position.id, assetId: position.assetId, symbol: position.symbol,
        entryPrice: position.entryPrice, currentPrice,
        takeProfitPrice: tpPrice, stopLossPrice: slPrice,
        pnlPct: parseFloat(pnlPct.toFixed(2)), hitTP, hitSL, hitPred, isStale,
        priceSource: priceInfo?.source || meta.source,
        action: (hitTP || hitSL || hitPred) ? 'sell' : 'hold',
      };

      if (hitTP || hitSL || hitPred) {
        const reason = hitSL
          ? `watchdog_stop_loss: ${pnlPct.toFixed(2)}% ≤ −${slPct.toFixed(2)}%`
          : (hitPred && !hitTP)
          ? `watchdog_predicted_target: +${pnlPct.toFixed(2)}% ≥ predicción +${predictedTarget.toFixed(2)}%`
          : `watchdog_take_profit: +${pnlPct.toFixed(2)}% ≥ +${tpPct.toFixed(2)}%`;
        try {
          const order = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);

          // FIX: usar investManager.closePosition() → campos estándar (realizedPnL neto de fees,
          // exitPrice, grossPnL, totalFeesUSD) — igual que round_close, manual_close, evaluate
          const closedPos = investManager.closePosition(position, currentPrice, reason, cfg);
          Object.assign(position, closedPos);
          position.closeReason          = hitSL ? 'watchdog_stop_loss'
                                        : (hitPred && !hitTP) ? 'watchdog_predicted_target'
                                        : 'watchdog_take_profit';
          position.exchangeCloseOrderId = order.orderId;

          // FIX: actualizar calibración de predicciones (faltaba en watchdog)
          await onPositionClosed(position);

          const pnlUSD = (position.grossPnL != null) ? position.grossPnL
                       : position.realizedPnL + (position.totalFeesUSD || 0);
          const netPnL = position.realizedPnL;

          posChanged = true;
          actions.push({ ...checkEntry, sold: true, reason, pnlUSD: parseFloat(pnlUSD.toFixed(4)), netPnL: parseFloat(netPnL.toFixed(4)), order });

          const _wdHoldMs  = position.openedAt ? Date.now() - new Date(position.openedAt).getTime() : null;
          const _predicted = position.predictedChange || 0;
          const _pnlPctF   = position.realizedPnLPct || parseFloat(pnlPct.toFixed(2));
          await appendInvestLog({
            type:      'watchdog_close',
            subtype:   hitSL ? 'stop_loss' : (hitPred && !hitTP) ? 'predicted_target' : 'take_profit',
            cycleId:   position.cycleId || null,
            timestamp: new Date().toISOString(),
            origin:    'frontend_watchdog',
            config: {
              mode: cfg.mode, exchange: cfg.exchange,
              takeProfitPct: cfg.takeProfitPct, stopLossPct: cfg.stopLossPct,
            },
            position: {
              id: position.id, symbol: position.symbol, name: position.name || position.symbol,
              assetId: position.assetId, capitalUSD: position.capitalUSD, units: position.units,
              entryPrice: position.entryPrice, exitPrice: position.exitPrice || currentPrice,
              takeProfitPrice: tpPrice, stopLossPrice: slPrice,
              pnlPct: _pnlPctF, pnlUSD: parseFloat(pnlUSD.toFixed(4)),
              netPnL: parseFloat(netPnL.toFixed(4)),
              exitFeeUSD:  position.exitFeeUSD  || 0,
              totalFeesUSD: position.totalFeesUSD || 0,
              priceSource: priceInfo?.source || meta.source,
            },
            holdInfo: {
              openedAt:        position.openedAt || null,
              closedAt:        position.closedAt,
              holdDurationMs:  _wdHoldMs,
              holdDurationHrs: _wdHoldMs ? parseFloat((_wdHoldMs / 3600000).toFixed(2)) : null,
              holdCycles:      position.holdCycles || 0,
            },
            prediction: {
              predictedChangePct: _predicted,
              actualChangePct:    _pnlPctF,
              deviationPct:       parseFloat((_pnlPctF - _predicted).toFixed(2)),
              correct: _predicted !== 0
                ? ((_predicted > 0 && _pnlPctF > 0) || (_predicted < 0 && _pnlPctF < 0))
                : null,
              boostPower: position.boostPower || null,
            },
            levels: {
              tpPct:    parseFloat(tpPct.toFixed(2)),
              slPct:    parseFloat(slPct.toFixed(2)),
              distToTP: tpPrice ? parseFloat(((currentPrice - tpPrice) / tpPrice * 100).toFixed(2)) : null,
              distToSL: slPrice ? parseFloat(((currentPrice - slPrice) / slPrice * 100).toFixed(2)) : null,
            },
            trigger: hitSL ? 'stop_loss' : (hitPred && !hitTP) ? 'predicted_target' : 'take_profit',
            reason,
            order: order ? { orderId: order.orderId, status: order.status } : null,
          });
        } catch (sellErr) {
          console.error(`[watchdog] Error cerrando ${position.symbol}:`, sellErr.message);
          actions.push({ ...checkEntry, sold: false, error: sellErr.message });
        }
      } else {
        checked.push(checkEntry);
      }
    }

    if (posChanged) await savePositions(positions);

    const _wdSellsCount  = actions.filter(a => a.sold).length;
    const _wdErrorsCount = actions.filter(a => !a.sold && a.error).length;
    const _wdHoldsCount  = checked.length;

    // ── Snapshot de posiciones en hold para trazabilidad ─────────────────
    const _wdHoldSnapshot = checked.map(c => {
      const pos      = open.find(p => p.assetId === c.assetId);
      const pred     = pos?.predictedChange || 0;
      const pnlF     = c.pnlPct ?? 0;
      const holdMs   = pos?.openedAt ? Date.now() - new Date(pos.openedAt).getTime() : null;
      const distToTP = c.takeProfitPrice && c.currentPrice
        ? parseFloat(((c.takeProfitPrice - c.currentPrice) / c.currentPrice * 100).toFixed(2)) : null;
      const distToSL = c.stopLossPrice && c.currentPrice
        ? parseFloat(((c.currentPrice - c.stopLossPrice) / c.stopLossPrice * 100).toFixed(2)) : null;
      return {
        symbol:          c.symbol,
        assetId:         c.assetId,
        entryPrice:      c.entryPrice,
        currentPrice:    c.currentPrice,
        pnlPct:          pnlF,
        predictedPct:    pred,
        deviationPct:    parseFloat((pnlF - pred).toFixed(2)),
        distToTP,
        distToSL,
        holdDurationHrs: holdMs ? parseFloat((holdMs / 3600000).toFixed(1)) : null,
        holdCycles:      pos?.holdCycles || 0,
        boostPower:      pos?.boostPower || null,
        priceSource:     c.priceSource,
        isStale:         c.isStale || false,
      };
    });

    // ── PnL acumulado de este scan ───────────────────────────────────────
    const _soldActs   = actions.filter(a => a.sold);
    const _scanPnlUSD = _soldActs.reduce((acc, a) => acc + (a.pnlUSD  || 0), 0);
    const _scanNetPnL = _soldActs.reduce((acc, a) => acc + (a.netPnL  || 0), 0);

    // ── Registrar el scan SIEMPRE (haya o no ventas) ─────────────────────
    await appendInvestLog({
      type:      'watchdog_scan',
      timestamp: new Date().toISOString(),
      trigger:   'frontend_timer',
      config: {
        mode: cfg.mode, exchange: cfg.exchange,
        takeProfitPct: cfg.takeProfitPct, stopLossPct: cfg.stopLossPct,
      },
      summary: {
        checked:     open.length,
        sells:       _wdSellsCount,
        holds:       _wdHoldsCount,
        errors:      _wdErrorsCount,
        staleCount:  meta.staleIds?.length  || 0,
        failedCount: meta.failedIds?.length || 0,
        priceSource: meta.source,
        scanPnlUSD:  parseFloat(_scanPnlUSD.toFixed(4)),
        scanNetPnL:  parseFloat(_scanNetPnL.toFixed(4)),
      },
      holdSnapshot: _wdHoldSnapshot,
      staleIds:  meta.staleIds  || [],
      failedIds: meta.failedIds || [],
    });

    res.json({
      success: true, timestamp: new Date().toISOString(),
      checked: open.length, priceSource: meta.source,
      staleIds: meta.staleIds || [], failedIds: meta.failedIds || [],
      sells:   _wdSellsCount,
      holds:   _wdHoldsCount,
      errors:  _wdErrorsCount,
      actions,
      checkedDetails: checked,
    });
  } catch(e) {
    console.error('[watchdog] error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/invest/prices/status ────────────────────────────────────────────
app.get('/api/invest/prices/status', async (_req, res) => {
  try {
    const cache     = await getPriceCache();
    const positions = await getPositions();
    const open      = positions.filter(p => p.status === 'open');
    const now       = Date.now();
    const entries   = Object.entries(cache).map(([id, v]) => {
      const ageMs = now - (v.updatedAt || 0);
      return { assetId: id, price: v.price, source: v.source,
               updatedAt: v.updatedAt ? new Date(v.updatedAt).toISOString() : null,
               ageMinutes: Math.round(ageMs / 60000), isStale: ageMs > PRICE_STALE_MAX_MS, attempts: v.attempts || 0 };
    });
    const openWithIssues = open.filter(p => { const c = cache[p.assetId]; return !c?.price || c.price <= 0; })
                               .map(p => ({ assetId: p.assetId, symbol: p.symbol, issue: 'sin precio en caché' }));
    res.json({ success: true, cacheSize: entries.length,
      freshCount: entries.filter(e => !e.isStale).length,
      staleCount: entries.filter(e => e.isStale).length,
      openPositions: open.length, openWithIssues,
      lastUpdated: entries.length ? new Date(Math.max(...entries.map(e => cache[e.assetId]?.updatedAt || 0))).toISOString() : null,
      entries: entries.sort((a,b) => (b.updatedAt||'') > (a.updatedAt||'') ? 1 : -1) });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/prices/refresh ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// RONDAS DE INVERSIÓN
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /api/invest/rounds ────────────────────────────────────────────────────
// Lista el historial de rondas cerradas + la ronda activa si existe
app.get('/api/invest/rounds', async (_req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const rounds = await getRounds();
    const current = await getCurrentRound();
    res.json({ success: true, rounds, current, total: rounds.length });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/rounds/open ─────────────────────────────────────────────
// Abre una nueva ronda. Recibe config de inversión, guarda como ronda activa.
app.post('/api/invest/rounds/open', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const positions = await getPositions();
    const open      = positions.filter(p => p.status === 'open');
    if (open.length > 0) {
      return res.status(400).json({ success: false, error: `Hay ${open.length} posiciones abiertas. Cierra la ronda actual antes de abrir una nueva.` });
    }

    const existing = await getCurrentRound();
    if (existing && existing.status === 'active') {
      return res.status(400).json({ success: false, error: 'Ya hay una ronda activa. Ciérrala primero.' });
    }

    // Config recibida del usuario (merge con defaults)
    const {
      capitalTotal, capitalPerCycle, maxPositions, minBoostPower,
      takeProfitPct, stopLossPct, maxHoldCycles, feePct,
      mode, exchange, minSignals, diversification, minPredictedChange
    } = req.body;

    const currentCfg = await getInvestConfig();
    const newCfg = {
      ...currentCfg,
      ...(capitalTotal       != null && { capitalTotal:       parseFloat(capitalTotal)       }),
      ...(capitalPerCycle    != null && { capitalPerCycle:    parseFloat(capitalPerCycle)    }),
      ...(maxPositions       != null && { maxPositions:       parseInt(maxPositions)         }),
      ...(minBoostPower      != null && { minBoostPower:      parseFloat(minBoostPower)      }),
      ...(takeProfitPct      != null && { takeProfitPct:      parseFloat(takeProfitPct)      }),
      ...(stopLossPct        != null && { stopLossPct:        parseFloat(stopLossPct)        }),
      ...(maxHoldCycles      != null && { maxHoldCycles:      parseInt(maxHoldCycles)        }),
      ...(feePct             != null && { feePct:             parseFloat(feePct)             }),
      ...(mode               != null && { mode                                               }),
      ...(exchange           != null && { exchange                                           }),
      ...(minSignals         != null && { minSignals:         parseInt(minSignals)           }),
      ...(diversification    != null && { diversification:    !!diversification              }),
      ...(minPredictedChange != null && { minPredictedChange: parseFloat(minPredictedChange) }),
    };
    await redisSet(INVEST_CONFIG_KEY, newCfg);

    // Obtener número de ronda siguiente
    const rounds = await getRounds();
    const roundNumber = rounds.length + 1;

    // Obtener config de algoritmo vigente para recomendaciones
    const algoMode = newCfg.mode === 'speculative' ? 'speculative' : 'normal';
    let algoConfig = null;
    try { algoConfig = await getConfig(algoMode); } catch(_) {}

    const newRound = {
      id:           `round_${Date.now()}`,
      roundNumber,
      status:       'active',
      openedAt:     new Date().toISOString(),
      closedAt:     null,
      durationMs:   null,
      config:       { ...newCfg },
      algoConfig:   algoConfig || {},
      report:       null,
      positionIds:  [],  // se irán añadiendo
    };

    await saveCurrentRound(newRound);
    await appendInvestLog({ type: 'round_open', subtype: 'user_action', roundId: newRound.id, roundNumber, timestamp: new Date().toISOString(), config: newCfg });

    res.json({ success: true, round: newRound, config: newCfg });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/rounds/close ────────────────────────────────────────────
// Cierra la ronda actual: fuerza el cierre de todas las posiciones y genera informe
app.post('/api/invest/rounds/close', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg        = await getInvestConfig();
    const positions  = await getPositions();
    const openPos    = positions.filter(p => p.status === 'open');
    const currentRound = await getCurrentRound();
    const now        = Date.now();

    // Cerrar todas las posiciones abiertas
    const keys = await getExchangeKeys(cfg.exchange);
    const closeResults = [];

    if (openPos.length > 0) {
      // Obtener precios actuales
      const assetIds  = [...new Set(openPos.map(p => p.assetId))];
      const symbolMap = {};
      openPos.forEach(p => { symbolMap[p.assetId] = p.symbol; });
      const { prices } = await fetchAndCachePrices(assetIds, symbolMap);

      for (const position of openPos) {
        const priceInfo    = prices[position.assetId];
        const currentPrice = priceInfo?.price || position.currentPrice || position.entryPrice;
        const evaluation   = investManager.evaluatePosition(position, currentPrice, 'round_close', cfg);
        evaluation.reason  = 'round_close: cierre de ronda';
        const order = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);
        const closedPos = investManager.closePosition(position, currentPrice, evaluation.reason, cfg);
        Object.assign(position, closedPos);
        await onPositionClosed(position);
        position.exchangeCloseOrderId = order.orderId;
        closeResults.push({ symbol: position.symbol, pnlPct: evaluation.pnlPct, pnlUSD: evaluation.pnlUSD });
      }
      await savePositions(positions);
    }

    // Recoger TODAS las posiciones de esta ronda (abiertas que acabamos de cerrar + cerradas previas)
    const roundId    = currentRound?.id;
    const roundStart = currentRound?.openedAt ? new Date(currentRound.openedAt).getTime() : null;

    // Todas las posiciones cerradas dentro de la ventana de la ronda
    const allClosed  = positions.filter(p => p.status === 'closed');
    const roundPositions = roundStart
      ? allClosed.filter(p => {
          const closedAt = p.closedAt ? new Date(p.closedAt).getTime() : 0;
          const openedAt = p.openedAt ? new Date(p.openedAt).getTime() : 0;
          return openedAt >= roundStart || closedAt >= roundStart;
        })
      : allClosed;

    // ── Construir informe de ronda ─────────────────────────────────────────
    const totalInvested  = roundPositions.reduce((s, p) => s + (p.capitalUSD || 0), 0);
    // grossPnL: variación de precio × unidades sin fees (campo añadido en closePosition)
    // Si no existe (posiciones antiguas), se recalcula como realizedPnL + totalFeesUSD
    const totalGrossPnL  = roundPositions.reduce((s, p) => s + (p.grossPnL ?? (p.realizedPnL || 0) + (p.totalFeesUSD || 0)), 0);
    // realizedPnL ya es NETO de fees — netReturn = suma de realizedPnL directamente
    const totalPnL       = roundPositions.reduce((s, p) => s + (p.realizedPnL || 0), 0);
    const entryFees      = roundPositions.reduce((s, p) => s + (p.entryFeeUSD || 0), 0);
    const exitFees       = roundPositions.reduce((s, p) => s + (p.exitFeeUSD  || 0), 0);
    const apiCosts       = roundPositions.reduce((s, p) => s + (p.apiCostUSD  || 0), 0);
    const totalFees      = entryFees + exitFees + apiCosts;
    const netReturn      = totalPnL;  // FIX: realizedPnL ya incluye el descuento de fees — no restar de nuevo
    const wins           = roundPositions.filter(p => (p.realizedPnL || 0) > 0);
    const losses         = roundPositions.filter(p => (p.realizedPnL || 0) <= 0);

    const sortedByPnl    = [...roundPositions].sort((a, b) => (b.realizedPnLPct || 0) - (a.realizedPnLPct || 0));
    const top5Wins       = sortedByPnl.slice(0, 5).filter(p => (p.realizedPnL || 0) > 0).map(p => ({
      symbol: p.symbol, name: p.name, pnlPct: p.realizedPnLPct, pnlUSD: p.realizedPnL,
      capitalUSD: p.capitalUSD, entryPrice: p.entryPrice, exitPrice: p.exitPrice || p.currentPrice,
      closeReason: p.closeReason, openedAt: p.openedAt, closedAt: p.closedAt,
    }));
    const top5Losses     = sortedByPnl.slice(-5).reverse().filter(p => (p.realizedPnL || 0) <= 0).map(p => ({
      symbol: p.symbol, name: p.name, pnlPct: p.realizedPnLPct, pnlUSD: p.realizedPnL,
      capitalUSD: p.capitalUSD, entryPrice: p.entryPrice, exitPrice: p.exitPrice || p.currentPrice,
      closeReason: p.closeReason, openedAt: p.openedAt, closedAt: p.closedAt,
    }));

    const closeReasonBreakdown = {};
    roundPositions.forEach(p => {
      const r = (p.closeReason || 'unknown').split(':')[0];
      closeReasonBreakdown[r] = (closeReasonBreakdown[r] || 0) + 1;
    });

    const durationMs     = roundStart ? (now - roundStart) : null;
    const durationHrs    = durationMs ? parseFloat((durationMs / 3600000).toFixed(2)) : null;

    // Context de mercado: movimiento promedio de los activos en la ronda
    const avgMarketPnl   = roundPositions.length > 0
      ? parseFloat((roundPositions.reduce((s, p) => s + (p.realizedPnLPct || 0), 0) / roundPositions.length).toFixed(2))
      : 0;

    const algoConfig = currentRound?.algoConfig || {};

    const report = {
      roundId:       roundId || `round_${now}`,
      roundNumber:   currentRound?.roundNumber || 1,
      openedAt:      currentRound?.openedAt || null,
      closedAt:      new Date(now).toISOString(),
      durationMs,
      durationHrs,
      // Resultados
      totalOperations:   roundPositions.length,
      forcedCloses:      closeResults.length,
      totalInvestedUSD:  parseFloat(totalInvested.toFixed(2)),
      totalPnLUSD:       parseFloat(totalGrossPnL.toFixed(4)),  // bruto antes de fees (para desglose)
      totalFeesUSD:      parseFloat(totalFees.toFixed(4)),
      netReturnUSD:      parseFloat(netReturn.toFixed(4)),       // neto real = suma de realizedPnL
      netReturnPct:      totalInvested > 0 ? parseFloat((netReturn / totalInvested * 100).toFixed(2)) : 0,
      winRate:           roundPositions.length > 0 ? parseFloat((wins.length / roundPositions.length * 100).toFixed(1)) : null,
      winsCount:         wins.length,
      lossesCount:       losses.length,
      top5Wins,
      top5Losses,
      feeBreakdown:      { entryFees: parseFloat(entryFees.toFixed(4)), exitFees: parseFloat(exitFees.toFixed(4)), apiCosts: parseFloat(apiCosts.toFixed(4)), total: parseFloat(totalFees.toFixed(4)) },
      closeReasonBreakdown,
      marketContext:     { avgMarketPnl, bestSymbol: top5Wins[0]?.symbol || null, worstSymbol: top5Losses[0]?.symbol || null },
      // Configuraciones usadas
      tradingConfig: {
        takeProfitPct:   cfg.takeProfitPct,
        stopLossPct:     cfg.stopLossPct,
        maxHoldCycles:   cfg.maxHoldCycles,
        capitalTotal:    cfg.capitalTotal,
        capitalPerCycle: cfg.capitalPerCycle,
        maxPositions:    cfg.maxPositions,
        mode:            cfg.mode,
        exchange:        cfg.exchange,
        feePct:          cfg.feePct,
      },
      algoConfig: {
        invertibleMinBoost: algoConfig.classification?.invertibleMinBoost,
        invertibleTarget:   algoConfig.prediction?.invertibleTarget,
        metaWeights:        algoConfig.metaWeights,
        potentialWeights:   algoConfig.potentialWeights,
        resistanceWeights:  algoConfig.resistanceWeights,
      },
    };

    // Guardar ronda en historial
    // FIX: incluir las posiciones completas en el objeto de ronda para que el
    // informe Word y la vista de historial funcionen incluso después de purgar
    // las posiciones del array principal
    const closedRound = {
      ...(currentRound || {}),
      status:   'closed',
      closedAt: report.closedAt,
      durationMs,
      report,
      positionIds: roundPositions.map(p => p.id),
      positions:   roundPositions,  // FIX: posiciones completas embebidas en la ronda
    };

    const rounds = await getRounds();
    rounds.unshift(closedRound); // más reciente primero
    await saveRounds(rounds.slice(0, 50)); // max 50 rondas en historial

    // Limpiar ronda activa
    await saveCurrentRound(null);

    // FIX: purgar posiciones de la ronda cerrada del array principal para evitar
    // que el array crezca indefinidamente y provoque que las nuevas rondas queden
    // fuera del slice al llamar a GET /api/invest/positions
    const roundPosIds = new Set(roundPositions.map(p => p.id));
    const remainingPositions = positions.filter(p => !roundPosIds.has(p.id));
    await savePositions(remainingPositions);
    console.log(`[round/close] 🗂 Purgadas ${roundPositions.length} posiciones del array principal (quedan ${remainingPositions.length})`);

    await appendInvestLog({ type: 'round_close', subtype: 'user_action', roundId: report.roundId, roundNumber: report.roundNumber, timestamp: new Date().toISOString(), report: { netReturnPct: report.netReturnPct, totalOperations: report.totalOperations, forcedCloses: closeResults.length } });

    // ── Actualizar capitalTotal con el resultado neto de la ronda ────────────
    const newCapitalTotal = parseFloat((cfg.capitalTotal + (report.netReturnUSD || 0)).toFixed(2));
    const capitalSnapshot = {
      before:      parseFloat(cfg.capitalTotal.toFixed(2)),
      after:       newCapitalTotal,
      netChange:   parseFloat((report.netReturnUSD || 0).toFixed(2)),
      roundId:     report.roundId,
      roundNumber: report.roundNumber,
      updatedAt:   new Date().toISOString(),
    };
    // Guardar capitalSnapshot en la ronda cerrada (ya está en historial)
    const roundsAfterClose = await getRounds();
    if (roundsAfterClose.length > 0 && roundsAfterClose[0].id === closedRound.id) {
      roundsAfterClose[0].capitalSnapshot = capitalSnapshot;
      await saveRounds(roundsAfterClose);
    }
    // Actualizar config con nuevo capital total
    const cfgHistory = Array.isArray(cfg._capitalHistory) ? cfg._capitalHistory.slice(-19) : [];
    await redisSet(INVEST_CONFIG_KEY, {
      ...cfg,
      capitalTotal:    newCapitalTotal,
      _capitalHistory: [...cfgHistory, capitalSnapshot],
    });

    res.json({ success: true, report, forcedCloses: closeResults, positionsClosed: closeResults.length, capitalSnapshot });
  } catch(e) {
    console.error('[round/close] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── GET /api/invest/rounds/:roundId/report.docx ──────────────────────────────
// Genera y descarga el informe Word completo de una ronda cerrada
app.get('/api/invest/rounds/:roundId/report.docx', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const { roundId } = req.params;
    const rounds    = await getRounds();

    // Buscar la ronda por id o por roundNumber
    const round = rounds.find(r => r.id === roundId || String(r.roundNumber) === roundId);
    if (!round) return res.status(404).json({ success: false, error: `Ronda ${roundId} no encontrada` });
    if (round.status !== 'closed') return res.status(400).json({ success: false, error: 'Solo se pueden generar informes de rondas cerradas' });

    // FIX: usar posiciones embebidas en la ronda (disponibles desde que se añadió round.positions)
    // Si no existen (rondas antiguas), caer al array principal filtrado por openedAt
    const allPositions = await getPositions();
    const roundPositionsForReport = (round.positions && round.positions.length > 0)
      ? round.positions
      : (() => {
          const rStart = round.openedAt ? new Date(round.openedAt).getTime() : 0;
          const rEnd   = round.closedAt ? new Date(round.closedAt).getTime() : Date.now();
          return allPositions.filter(p => {
            const t = p.openedAt ? new Date(p.openedAt).getTime() : 0;
            return rStart > 0 && t >= rStart && t <= rEnd;
          });
        })();

    const doc     = await roundReportGen.generateRoundReport(round, roundPositionsForReport, round.capitalSnapshot || null);
    const buffer  = await Packer.toBuffer(doc);
    const filename = `informe-ronda-${round.roundNumber}-${new Date(round.closedAt || Date.now()).toISOString().slice(0,10)}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch(e) {
    console.error('[round/report.docx] Error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/invest/rounds/recommendations ───────────────────────────────────
// Devuelve recomendaciones de config para la nueva ronda basadas en historial
app.post('/api/invest/rounds/recommendations', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cfg    = await getInvestConfig();
    const rounds = await getRounds();
    const mode   = req.body?.mode || cfg.mode || 'normal';

    const algoMode  = mode === 'speculative' ? 'speculative' : 'normal';
    let algoConfig  = null;
    try { algoConfig = await getConfig(algoMode); } catch(_) {}

    const suggestions = {
      takeProfitPct:   cfg.takeProfitPct,
      stopLossPct:     cfg.stopLossPct,
      maxHoldCycles:   cfg.maxHoldCycles,
      capitalTotal:    cfg.capitalTotal,
      capitalPerCycle: cfg.capitalPerCycle,
      maxPositions:    cfg.maxPositions,
      minBoostPower:   cfg.minBoostPower,
      feePct:          cfg.feePct,
      mode:            cfg.mode,
      exchange:        cfg.exchange,
    };

    // Analizar rondas previas para ajustar sugerencias
    const reasonedAdjustments = [];
    if (rounds.length > 0) {
      const recentRounds = rounds.slice(0, 5);
      const avgNetPct = recentRounds.reduce((s, r) => s + (r.report?.netReturnPct || 0), 0) / recentRounds.length;
      const avgWinRate = recentRounds.reduce((s, r) => s + (r.report?.winRate || 0), 0) / recentRounds.length;

      // Si muchas stop losses → subir TP, bajar SL ligeramente (más espacio)
      const slHeavy = recentRounds.filter(r => (r.report?.closeReasonBreakdown?.stop_loss || 0) > (r.report?.totalOperations || 1) * 0.4);
      if (slHeavy.length >= 2) {
        suggestions.stopLossPct = Math.max(3, cfg.stopLossPct - 1);
        reasonedAdjustments.push({ param: 'stopLossPct', from: cfg.stopLossPct, to: suggestions.stopLossPct, reason: 'Exceso de stop losses en rondas recientes — reducir umbral para dar más margen' });
      }

      // Si win rate < 40% → ser más selectivo (subir minBoostPower)
      if (avgWinRate < 40 && rounds.length >= 2) {
        suggestions.minBoostPower = Math.min(0.85, cfg.minBoostPower + 0.05);
        reasonedAdjustments.push({ param: 'minBoostPower', from: cfg.minBoostPower, to: suggestions.minBoostPower, reason: `Win rate promedio ${avgWinRate.toFixed(1)}% — ser más selectivo con el umbral de entrada` });
      }

      // Si retorno neto positivo consistente → aumentar capital por ciclo
      if (avgNetPct > 3 && rounds.length >= 3) {
        suggestions.capitalPerCycle = Math.min(0.5, cfg.capitalPerCycle + 0.05);
        reasonedAdjustments.push({ param: 'capitalPerCycle', from: cfg.capitalPerCycle, to: suggestions.capitalPerCycle, reason: `Retorno promedio +${avgNetPct.toFixed(1)}% — aumentar exposición por ciclo` });
      }

      // Si retorno neto negativo → reducir capital por ciclo
      if (avgNetPct < -2 && rounds.length >= 2) {
        suggestions.capitalPerCycle = Math.max(0.1, cfg.capitalPerCycle - 0.05);
        reasonedAdjustments.push({ param: 'capitalPerCycle', from: cfg.capitalPerCycle, to: suggestions.capitalPerCycle, reason: `Retorno promedio ${avgNetPct.toFixed(1)}% — reducir exposición hasta mejorar el modelo` });
      }
    }

    res.json({
      success: true,
      suggestions,
      reasonedAdjustments,
      algoConfig: algoConfig ? {
        invertibleMinBoost: algoConfig.classification?.invertibleMinBoost,
        invertibleTarget:   algoConfig.prediction?.invertibleTarget,
        metaWeights:        algoConfig.metaWeights,
      } : null,
      basedOnRounds: rounds.length,
      currentConfig: cfg,
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});


// ── GET /api/invest/prediction-calibration ────────────────────────────────────
app.get('/api/invest/prediction-calibration', async (_req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cal    = await getPredictionCalibration();
    const report = predCalibration.buildCalibrationReport(cal);
    res.json({ success: true, report });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/prediction-calibration/rebuild ───────────────────────────
app.post('/api/invest/prediction-calibration/rebuild', async (_req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const positions = await getPositions();
    const closed    = positions.filter(p =>
      p.status === 'closed' && p.predictedChange != null && p.realizedPnLPct != null &&
      ['INVERTIBLE', 'APALANCADO'].includes(p.classification)
    );
    if (closed.length === 0) return res.json({ success: true, message: 'Sin datos', samples: 0 });
    const newCal = predCalibration.rebuildCalibration(closed);
    await savePredictionCalibration(newCal);
    const report = predCalibration.buildCalibrationReport(newCal);
    res.json({ success: true, samplesProcessed: closed.length, report });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/invest/prediction-calibration/reset ────────────────────────────
app.post('/api/invest/prediction-calibration/reset', async (_req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    await savePredictionCalibration(predCalibration.emptyCalibration());
    res.json({ success: true, message: 'Calibración reseteada' });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/invest/prices/refresh', async (_req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const positions = await getPositions();
    const open      = positions.filter(p => p.status === 'open');
    if (!open.length) return res.json({ success: true, message: 'Sin posiciones abiertas', fetchedCount: 0, staleCount: 0, failedIds: [], source: 'none', updatedAt: null });
    const assetIds  = [...new Set(open.map(p => p.assetId))];
    const symbolMap = {};
    open.forEach(p => { symbolMap[p.assetId] = p.symbol; });
    const { prices, meta } = await fetchAndCachePrices(assetIds, symbolMap);
    const updated = open.map(p => {
      const info = prices[p.assetId];
      if (!info?.price || info.price <= 0) return { assetId: p.assetId, symbol: p.symbol, status: 'failed' };
      return { assetId: p.assetId, symbol: p.symbol, price: info.price, source: info.source,
               isStale: info.isStale, pnlPct: parseFloat(((info.price - p.entryPrice) / p.entryPrice * 100).toFixed(2)),
               status: info.isStale ? 'stale' : 'fresh' };
    });
    res.json({ success: true, fetchedCount: meta.fetchedCount, staleCount: meta.staleCount,
               failedIds: meta.failedIds, source: meta.source, updatedAt: meta.updatedAtISO, positions: updated });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/cycles/:cycleId/iterate ────────────────────────────────────────
app.post('/api/cycles/:cycleId/iterate', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.loadCycle(redis, req.params.cycleId);
    if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status === 'completed') return res.status(400).json({ success: false, error: 'Ciclo ya completado' });
    const positions    = await getPositions();
    const investConfig = await getInvestConfig();
    const apiKeys      = { cryptocompare: process.env.CRYPTOCOMPARE_API_KEY || '' };
    const result       = await iterationEngine.executeIteration(redis, req.params.cycleId, cyclesManager, positions, investConfig, apiKeys);
    const sellResults  = [];
    if (result.toSell?.length > 0) {
      const allPositions = await getPositions();
      const cfg  = investConfig;
      const keys = await getExchangeKeys(cfg.exchange);
      for (const { position, currentPrice, decision } of result.toSell) {
        try {
          const order  = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);
          const pos    = allPositions.find(p => p.id === position.id);
          if (pos) {
            const pnlUSD = (currentPrice - pos.entryPrice) * pos.units;
            const exitFee = pos.capitalUSD * (cfg.feePct || 0.10) / 100;
            pos.status    = 'closed'; pos.closedAt = new Date().toISOString();
            pos.currentPrice = currentPrice; pos.realizedPnL = parseFloat(pnlUSD.toFixed(4));
            pos.realizedPnLPct = parseFloat(decision.pnlPct.toFixed(2));
            pos.exitFeeUSD = parseFloat(exitFee.toFixed(4));
            pos.closeReason = decision.reason.split(':')[0];
            pos.exchangeCloseOrderId = order.orderId;
          }
          sellResults.push({ assetId: position.assetId, symbol: position.symbol, price: currentPrice, pnlPct: decision.pnlPct, closed: true });
        } catch (err) { sellResults.push({ assetId: position.assetId, symbol: position.symbol, closed: false, error: err.message }); }
      }
      await savePositions(allPositions);
    }
    res.json({ success: true, cycleId: result.cycleId, iterationNumber: result.iterationNumber,
               totalIterations: result.totalIterations, isLastIteration: result.isLastIteration,
               assetsCount: result.assetsCount, fetchedCount: result.fetchedCount,
               failedCount: result.failedCount, staleCount: result.staleCount,
               priceSource: result.priceSource, sellsExecuted: sellResults.length, sellResults,
               shouldComplete: result.isLastIteration });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/cycles/:cycleId/iterations ──────────────────────────────────────
app.get('/api/cycles/:cycleId/iterations', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.loadCycle(redis, req.params.cycleId);
    if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    const durationMs = cycle.durationMs || 43200000;
    const schedule   = iterationEngine.getIterationSchedule(cycle.startTime, durationMs);
    const iterations = cycle.iterations || [];
    const enriched   = iterations.map((iter, idx) => ({ ...iter, scheduledTime: schedule[idx] || null, delayMs: schedule[idx] ? iter.timestamp - schedule[idx] : 0 }));
    const pending    = schedule.slice(iterations.length).map((ts, i) => ({ iterationNumber: iterations.length + i + 1, scheduledTime: ts, status: ts <= Date.now() ? 'due' : 'upcoming' }));
    res.json({ success: true, cycleId: cycle.id, status: cycle.status, durationMs,
               startTime: cycle.startTime, endTime: cycle.endTime,
               totalScheduled: schedule.length, completedCount: iterations.length, pendingCount: pending.length,
               nextIterationAt: iterationEngine.getNextIterationTime(cycle),
               iterations: enriched, pending });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── POST /api/cycles/run-pending-iterations ───────────────────────────────────
app.post('/api/cycles/run-pending-iterations', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const activeIds = await cyclesManager.getActiveCycles(redis);
    if (!activeIds.length) return res.json({ success: true, message: 'No hay ciclos activos', processed: [] });
    const cycles       = await cyclesManager.getCyclesDetails(redis, activeIds);
    const positions    = await getPositions();
    const investConfig = await getInvestConfig();
    const apiKeys      = { cryptocompare: process.env.CRYPTOCOMPARE_API_KEY || '' };
    const processed    = [];
    for (const cycle of cycles) {
      if (cycle.status === 'completed') continue;
      if (!iterationEngine.hasIterationDue(cycle)) continue;
      try {
        const result = await iterationEngine.executeIteration(redis, cycle.id, cyclesManager, positions, investConfig, apiKeys);
        processed.push({ cycleId: cycle.id, iterationNumber: result.iterationNumber, fetchedCount: result.fetchedCount, sellsTriggered: result.toSell?.length || 0, isLastIteration: result.isLastIteration });
        await new Promise(r => setTimeout(r, 1500));
      } catch(err) { processed.push({ cycleId: cycle.id, error: err.message }); }
    }
    res.json({ success: true, processed, count: processed.length });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER SERVER-SIDE — Iteraciones + Watchdog SL/TP
// Corre en Node.js independientemente del navegador.
// Si el usuario cierra la app, los ciclos y el WD siguen activos.
// ═══════════════════════════════════════════════════════════════════════════════

const SCHED_ITER_KEY        = 'scheduler:last_iteration_run';
const SCHED_WD_KEY          = 'scheduler:last_watchdog_run';
const SCHED_ITER_LOCK       = 'scheduler:iter_lock';
const SCHED_WD_LOCK         = 'scheduler:wd_lock';
const SCHED_ITER_INTERVAL_MS = 5  * 60 * 1000; // 5 min
const SCHED_WD_INTERVAL_MS   = 30 * 60 * 1000; // 30 min
const SCHED_LOCK_TTL_S       = 120;             // lock expira en 2 min

async function serverRunPendingIterations() {
  if (!redis) return;
  try {
    const lockOk = await redis.set(SCHED_ITER_LOCK, '1', { NX: true, EX: SCHED_LOCK_TTL_S });
    if (!lockOk) return; // otro proceso ya está ejecutando

    const activeIds = await cyclesManager.getActiveCycles(redis);
    if (!activeIds.length) { await redis.del(SCHED_ITER_LOCK); return; }

    const cycles       = await cyclesManager.getCyclesDetails(redis, activeIds);
    const positions    = await getPositions();
    const investConfig = await getInvestConfig();
    const apiKeys      = { cryptocompare: process.env.CRYPTOCOMPARE_API_KEY || '' };
    let   totalProcessed = 0;

    for (const cycle of cycles) {
      if (cycle.status === 'completed') continue;
      if (!iterationEngine.hasIterationDue(cycle)) continue;
      try {
        const result = await iterationEngine.executeIteration(redis, cycle.id, cyclesManager, positions, investConfig, apiKeys);
        totalProcessed++;
        console.log(`[server-sched] Iter ${result.iterationNumber} — ciclo ${cycle.id.slice(0,8)} · ${result.fetchedCount} activos · lastIter=${result.isLastIteration}`);
        await new Promise(r => setTimeout(r, 1500));
      } catch(err) { console.error(`[server-sched] Error ciclo ${cycle.id}:`, err.message); }
    }

    await redisSet(SCHED_ITER_KEY, { runAt: Date.now(), processed: totalProcessed });
    await redis.del(SCHED_ITER_LOCK);
    if (totalProcessed > 0) console.log(`[server-sched] ✅ ${totalProcessed} iteraciones ejecutadas`);
  } catch(err) {
    console.error('[server-sched] Error en serverRunPendingIterations:', err.message);
    try { await redis.del(SCHED_ITER_LOCK); } catch(_) {}
  }
}

async function serverWatchdog(source = 'internal') {
  if (!redis) return;
  try {
    const lockOk = await redis.set(SCHED_WD_LOCK, '1', { NX: true, EX: 180 });
    if (!lockOk) {
      console.log(`[server-wd] ⏭ Skip — lock activo (fuente: ${source})`);
      return;
    }

    const cfg       = await getInvestConfig();
    const positions = await getPositions();
    const open      = positions.filter(p => p.status === 'open');

    if (!open.length) {
      // Registrar el run igualmente para que el cooldown del pinger funcione
      await redisSet(SCHED_WD_KEY, { runAt: Date.now(), checked: 0, sells: 0, holds: 0, source });
      await redis.del(SCHED_WD_LOCK);
      console.log(`[server-wd] 💤 Sin posiciones abiertas (fuente: ${source})`);
      return;
    }

    const assetIds  = [...new Set(open.map(p => p.assetId))];
    const symbolMap = {};
    open.forEach(p => { symbolMap[p.assetId] = p.symbol; });

    const { prices, meta } = await fetchAndCachePrices(assetIds, symbolMap);
    let sells = 0; let holds = 0; let posChanged = false;
    const _svCloses = [];
    const _svHolds  = [];

    for (const position of open) {
      const priceInfo    = prices[position.assetId];
      const currentPrice = priceInfo?.price;
      if (!currentPrice) continue;

      const isStale = priceInfo?.isStale === true;
      const pnlPct  = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      const tpPrice = position.takeProfitPrice;
      const slPrice = position.stopLossPrice;
      const tpPct   = tpPrice ? ((tpPrice - position.entryPrice) / position.entryPrice) * 100 : cfg.takeProfitPct;
      const slPct   = slPrice ? ((position.entryPrice - slPrice) / position.entryPrice) * 100 : cfg.stopLossPct;
      const hitTP   = !isStale && (tpPrice ? currentPrice >= tpPrice : pnlPct >= tpPct);
      const hitSL   = !isStale && (slPrice ? currentPrice <= slPrice : pnlPct <= -Math.abs(slPct));

      // Criterio adicional: predicción del ciclo alcanzada
      const _svPredTarget = parseFloat(position.predictedChange || 0);
      const hitPred = !isStale && _svPredTarget > 0 && pnlPct > 0 && pnlPct >= _svPredTarget;

      if (hitTP || hitSL || hitPred) {
        const _svReason = hitSL
          ? `watchdog_stop_loss: ${pnlPct.toFixed(2)}% ≤ −${slPct.toFixed(2)}%`
          : (hitPred && !hitTP)
          ? `watchdog_predicted_target: +${pnlPct.toFixed(2)}% ≥ predicción +${_svPredTarget.toFixed(2)}%`
          : `watchdog_take_profit: +${pnlPct.toFixed(2)}% ≥ +${tpPct.toFixed(2)}%`;

        // FIX: usar investManager.closePosition() → campos estándar (realizedPnL, exitPrice, etc.)
        const closedPos = investManager.closePosition(position, currentPrice, _svReason, cfg);
        Object.assign(position, closedPos);
        position.closeReason = hitSL ? 'stopLoss_server_wd'
                             : (hitPred && !hitTP) ? 'predictedTarget_server_wd'
                             : 'takeProfit_server_wd';

        // FIX: actualizar calibración de predicciones (faltaba en server watchdog)
        await onPositionClosed(position);

        const _svPnlUSD  = position.grossPnL != null ? position.grossPnL
                         : position.realizedPnL + (position.totalFeesUSD || 0);
        const _svNetPnL  = position.realizedPnL;
        const _svPnlF    = position.realizedPnLPct || parseFloat(pnlPct.toFixed(2));
        const _svHoldMs  = position.openedAt ? Date.now() - new Date(position.openedAt).getTime() : null;
        const _svPred    = position.predictedChange || 0;

        sells++; posChanged = true;

        _svCloses.push({
          type:      'watchdog_close',
          subtype:   hitSL ? 'stop_loss' : (hitPred && !hitTP) ? 'predicted_target' : 'take_profit',
          cycleId:   position.cycleId || null,
          timestamp: new Date().toISOString(),
          origin:    'server_watchdog',
          trigger:   source,
          config: {
            mode: cfg.mode, exchange: cfg.exchange,
            takeProfitPct: cfg.takeProfitPct, stopLossPct: cfg.stopLossPct,
          },
          position: {
            id: position.id, symbol: position.symbol, name: position.name || position.symbol,
            assetId: position.assetId, capitalUSD: position.capitalUSD, units: position.units,
            entryPrice: position.entryPrice, exitPrice: position.exitPrice || currentPrice,
            takeProfitPrice: tpPrice, stopLossPrice: slPrice,
            pnlPct: _svPnlF, pnlUSD: parseFloat(_svPnlUSD.toFixed(4)),
            netPnL: parseFloat(_svNetPnL.toFixed(4)),
            exitFeeUSD:  position.exitFeeUSD  || 0,
            totalFeesUSD: position.totalFeesUSD || 0,
            priceSource: priceInfo?.source || source,
          },
          holdInfo: {
            openedAt:        position.openedAt || null,
            closedAt:        position.closedAt,
            holdDurationMs:  _svHoldMs,
            holdDurationHrs: _svHoldMs ? parseFloat((_svHoldMs / 3600000).toFixed(2)) : null,
            holdCycles:      position.holdCycles || 0,
          },
          prediction: {
            predictedChangePct: _svPred,
            actualChangePct:    _svPnlF,
            deviationPct:       parseFloat((_svPnlF - _svPred).toFixed(2)),
            correct: _svPred !== 0
              ? ((_svPred > 0 && _svPnlF > 0) || (_svPred < 0 && _svPnlF < 0))
              : null,
            boostPower: position.boostPower || null,
          },
          levels: {
            tpPct:    parseFloat(tpPct.toFixed(2)),
            slPct:    parseFloat(slPct.toFixed(2)),
            distToTP: tpPrice ? parseFloat(((currentPrice - tpPrice) / tpPrice * 100).toFixed(2)) : null,
            distToSL: slPrice ? parseFloat(((currentPrice - slPrice) / slPrice * 100).toFixed(2)) : null,
          },
        });
        console.log(`[server-wd] 🔔 ${hitTP ? 'TP' : hitPred ? 'PRED' : 'SL'} — ${position.symbol} · ${_svPnlF >= 0 ? '+' : ''}${_svPnlF}% · pred:${_svPred >= 0 ? '+' : ''}${_svPred}% dev:${parseFloat((_svPnlF - _svPred).toFixed(2))}% · ${source}`);
      } else {
        // Hold snapshot
        const _svHoldMs2 = position.openedAt ? Date.now() - new Date(position.openedAt).getTime() : null;
        const _svPred2   = position.predictedChange || 0;
        const _svPnlF2   = parseFloat(pnlPct.toFixed(2));
        _svHolds.push({
          symbol:          position.symbol,
          assetId:         position.assetId,
          pnlPct:          _svPnlF2,
          predictedPct:    _svPred2,
          deviationPct:    parseFloat((_svPnlF2 - _svPred2).toFixed(2)),
          distToTP: tpPrice ? parseFloat(((tpPrice - currentPrice) / currentPrice * 100).toFixed(2)) : null,
          distToSL: slPrice ? parseFloat(((currentPrice - slPrice) / slPrice * 100).toFixed(2)) : null,
          holdDurationHrs: _svHoldMs2 ? parseFloat((_svHoldMs2 / 3600000).toFixed(1)) : null,
          holdCycles:      position.holdCycles || 0,
          boostPower:      position.boostPower || null,
          priceSource:     priceInfo?.source || source,
        });
        holds++;
      }
    }

    if (posChanged) await savePositions(positions);

    // Registrar cada cierre individual en el log
    for (const _svEntry of _svCloses) await appendInvestLog(_svEntry);

    // Registrar el scan completo (siempre, haya o no ventas)
    const _svScanPnl = _svCloses.reduce((acc, e) => acc + (e.position?.pnlUSD || 0), 0);
    const _svScanNet = _svCloses.reduce((acc, e) => acc + (e.position?.netPnL  || 0), 0);
    await appendInvestLog({
      type:      'watchdog_scan',
      timestamp: new Date().toISOString(),
      trigger:   source,
      config: {
        mode: cfg.mode, exchange: cfg.exchange,
        takeProfitPct: cfg.takeProfitPct, stopLossPct: cfg.stopLossPct,
      },
      summary: {
        checked:     open.length,
        sells:       sells,
        holds:       holds,
        errors:      0,
        staleCount:  meta?.staleIds?.length || 0,
        priceSource: meta?.source || source,
        scanPnlUSD:  parseFloat(_svScanPnl.toFixed(4)),
        scanNetPnL:  parseFloat(_svScanNet.toFixed(4)),
      },
      holdSnapshot: _svHolds,
    });

    await redisSet(SCHED_WD_KEY, { runAt: Date.now(), checked: open.length, sells, holds, source: meta?.source || source });
    await redis.del(SCHED_WD_LOCK);
    console.log(`[server-wd] ✅ ${open.length} pos. · ${sells} ventas · ${holds} hold · fuente: ${source}`);
  } catch(err) {
    console.error('[server-wd] Error:', err.message);
    try { await redis.del(SCHED_WD_LOCK); } catch(_) {}
  }
}

// ── GET /api/watchdog/ping ────────────────────────────────────────────────────
// Llamar cada 5 min desde UptimeRobot / BetterUptime / GitHub Actions / QStash.
// Solo ejecuta el WD si han pasado ≥28 min desde el último run (idempotente).
// Responde siempre 200 para que el monitor no lo marque como caído.
const WD_PING_COOLDOWN_MS   = 28 * 60 * 1000; // 28 min (margen 2 min antes de los 30)
const ITER_PING_COOLDOWN_MS =  4 * 60 * 1000; //  4 min (margen 1 min antes de los 5)

function _validatePingToken(req) {
  const token    = req.query.token || req.headers['x-watchdog-token'];
  const expected = process.env.WATCHDOG_PING_TOKEN;
  if (!expected) return true; // sin token configurado → abierto (configúralo en producción)
  return token === expected;
}

app.get('/api/watchdog/ping', async (req, res) => {
  if (!redis) return res.json({ success: false, skipped: true, reason: 'redis_unavailable' });
  if (!_validatePingToken(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const wdState   = await redisGet(SCHED_WD_KEY);
    const lastRunAt = wdState?.runAt || 0;
    const elapsed   = Date.now() - lastRunAt;

    if (elapsed < WD_PING_COOLDOWN_MS) {
      const remainingMin = Math.ceil((WD_PING_COOLDOWN_MS - elapsed) / 60000);
      return res.json({ success: true, skipped: true, reason: 'not_due_yet',
        lastRunAt, nextRunIn: `${remainingMin}min`, elapsedMin: Math.floor(elapsed / 60000) });
    }

    // Responder ANTES de ejecutar — evita timeout del pinger en caso de lentitud
    res.json({ success: true, skipped: false, triggered: true,
      lastRunAt, elapsedMin: Math.floor(elapsed / 60000) });

    setImmediate(() => serverWatchdog('external_ping'));

  } catch(e) {
    console.error('[watchdog-ping] Error:', e.message);
    if (!res.headersSent) res.json({ success: false, error: e.message });
  }
});

// ── GET /api/scheduler/ping ───────────────────────────────────────────────────
// Ping para iteraciones de ciclos — mismo patrón que /api/watchdog/ping
app.get('/api/scheduler/ping', async (req, res) => {
  if (!redis) return res.json({ success: false, skipped: true, reason: 'redis_unavailable' });
  if (!_validatePingToken(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });

  try {
    const iterState = await redisGet(SCHED_ITER_KEY);
    const lastRunAt = iterState?.runAt || 0;
    const elapsed   = Date.now() - lastRunAt;

    if (elapsed < ITER_PING_COOLDOWN_MS) {
      return res.json({ success: true, skipped: true, reason: 'not_due_yet',
        nextRunIn: `${Math.ceil((ITER_PING_COOLDOWN_MS - elapsed) / 60000)}min` });
    }

    res.json({ success: true, triggered: true, elapsedMin: Math.floor(elapsed / 60000) });
    setImmediate(() => serverRunPendingIterations());

  } catch(e) {
    if (!res.headersSent) res.json({ success: false, error: e.message });
  }
});

// Endpoint para que el frontend sincronice su widget con el último run del servidor
app.get('/api/scheduler/status', async (_req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const iterState = await redisGet(SCHED_ITER_KEY);
    const wdState   = await redisGet(SCHED_WD_KEY);
    res.json({
      success:    true,
      iterations: { lastRunAt: iterState?.runAt || null, lastRunAgo: iterState?.runAt ? Date.now() - iterState.runAt : null, lastProcessed: iterState?.processed || 0 },
      watchdog:   { lastRunAt: wdState?.runAt   || null, lastRunAgo: wdState?.runAt   ? Date.now() - wdState.runAt   : null, lastSells: wdState?.sells || 0, lastSource: wdState?.source || null },
    });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Arrancar schedulers ───────────────────────────────────────────────────────
// En LOCAL: setInterval como siempre.
// En VERCEL: los setInterval no persisten entre invocaciones serverless.
//            El pinger externo (UptimeRobot/QStash) llama a /api/watchdog/ping
//            cada 5 min y es el único mecanismo fiable.
//            Configura WATCHDOG_PING_TOKEN en Vercel → Environment Variables.
if (redis) {
  const isVercel = !!process.env.VERCEL;

  if (!isVercel) {
    // ── Entorno local (npm run dev / node api/index.js) ─────────────────
    setTimeout(() => {
      setInterval(serverRunPendingIterations, SCHED_ITER_INTERVAL_MS);
      setTimeout(serverRunPendingIterations, 10000);
      console.log('[server-sched] ✅ LOCAL — Scheduler iteraciones activo (cada 5min)');

      setInterval(() => serverWatchdog('local_interval'), SCHED_WD_INTERVAL_MS);
      setTimeout(() => serverWatchdog('local_startup'), 25000);
      console.log('[server-sched] ✅ LOCAL — Scheduler watchdog activo (cada 30min)');
    }, 8000);
  } else {
    // ── Vercel (producción) ──────────────────────────────────────────────
    // setInterval muere con cada función serverless → usamos pinger externo.
    // Setup: UptimeRobot (gratis) → GET /api/watchdog/ping?token=TU_TOKEN cada 5 min
    console.log('[server-sched] ☁️  VERCEL — Modo pinger externo activo (sin setInterval)');
    if (!process.env.WATCHDOG_PING_TOKEN) {
      console.warn('[server-sched] ⚠️  WATCHDOG_PING_TOKEN no configurado — endpoint /api/watchdog/ping abierto');
    }
  }
}

// ── Escenarios alternativos (simulación de duraciones + configs de trading) ───
scenariosEndpoint(
  app,
  redis,
  cyclesManager,
  getInvestConfig,
  async (limit = 20) => {
    const ids = await cyclesManager.getCompletedCycles(redis);
    return cyclesManager.getCyclesDetails(redis, ids.slice(0, limit));
  }
);

// ── Arranque local ────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}

module.exports = app;
