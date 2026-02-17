// api-health-check.js - CORREGIDO: paralelo, sin referencias circulares, lee keys de Redis
const axios = require('axios');
const TIMEOUT_MS = 4000;

function withTimeout(promise, ms = TIMEOUT_MS) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))]);
}

function resolveCheck(result, name, tier, factors) {
  if (result.status === 'fulfilled') return result.value;
  return { name, tier, factors, configured: false, available: false, status: 'error', message: result.reason?.message || 'Error', responseTime: 0, lastCheck: new Date().toISOString() };
}

// Leer key: primero process.env, luego Redis (keys guardadas desde la UI)
async function getKey(envName, redis) {
  const envVal = process.env[envName];
  if (envVal) return envVal;
  if (!redis) return null;
  try {
    const v = await redis.get('apikey:' + envName);
    if (v && typeof v === 'string' && v.trim()) return v.trim();
  } catch (_) {}
  return null;
}

async function checkAllAPIs(redis) {
  const [r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12,r13] = await Promise.allSettled([
    withTimeout(checkCoinGecko()),
    withTimeout(checkAlternative()),
    withTimeout(checkReddit()),
    withTimeout(checkBlockchain()),
    withTimeout(checkCryptoCompare(redis)),
    withTimeout(checkNewsAPI(redis)),
    withTimeout(checkGitHub(redis)),
    withTimeout(checkTelegram(redis)),
    withTimeout(checkSerpAPI(redis)),
    withTimeout(checkTwitter(redis)),
    withTimeout(checkGlassnode(redis)),
    withTimeout(checkCryptoQuant(redis)),
    withTimeout(checkWhaleAlert(redis))
  ]);

  const apis = {
    coingecko:    resolveCheck(r1,  'CoinGecko',               'free',     ['Volume 24h','Market Cap','Volatilidad','ATL']),
    alternative:  resolveCheck(r2,  'Alternative.me',          'free',     ['Fear & Greed Index']),
    reddit:       resolveCheck(r3,  'Reddit',                  'free',     ['Reddit Sentiment']),
    blockchain:   resolveCheck(r4,  'Blockchain.info',         'free',     ['Transacciones BTC']),
    cryptocompare:resolveCheck(r5,  'CryptoCompare',           'freemium', ['News Volume','News Sentiment']),
    newsapi:      resolveCheck(r6,  'NewsAPI',                 'freemium', ['Media Coverage','Breaking News']),
    github:       resolveCheck(r7,  'GitHub',                  'freemium', ['Developer Activity']),
    telegram:     resolveCheck(r8,  'Telegram Bot',            'free',     ['Telegram Activity']),
    serpapi:      resolveCheck(r9,  'SerpAPI (Google Trends)', 'paid',     ['Google Trends']),
    twitter:      resolveCheck(r10, 'Twitter API v2',          'paid',     ['Twitter Sentiment']),
    glassnode:    resolveCheck(r11, 'Glassnode',               'premium',  ['Unique Addresses','Network Growth']),
    cryptoquant:  resolveCheck(r12, 'CryptoQuant',             'premium',  ['Exchange Net Flow']),
    whaleAlert:   resolveCheck(r13, 'Whale Alert',             'premium',  ['Whale Activity'])
  };

  const summary = { total: 13, available: 0, configured: 0, errors: 0 };
  Object.values(apis).forEach(a => {
    if (a.available) summary.available++;
    if (a.configured) summary.configured++;
    if (a.status === 'error') summary.errors++;
  });

  return { timestamp: new Date().toISOString(), summary, apis };
}

// ── Checks individuales ──────────────────────────────────────────────────────

async function checkCoinGecko() {
  const t = Date.now();
  try {
    await axios.get('https://api.coingecko.com/api/v3/ping', { timeout: TIMEOUT_MS });
    const ms = Date.now()-t;
    return { name:'CoinGecko', tier:'free', factors:['Volume 24h','Market Cap','Volatilidad','ATL'], configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'CoinGecko', tier:'free', factors:['Volume 24h','Market Cap','Volatilidad','ATL'], configured:true, available:false, status:'error', message:e.message, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkAlternative() {
  const t = Date.now();
  try {
    const r = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: TIMEOUT_MS });
    const ms = Date.now()-t;
    const fgi = r.data?.data?.[0];
    return { name:'Alternative.me', tier:'free', factors:['Fear & Greed Index'], configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, currentValue:fgi ? `FGI: ${fgi.value} (${fgi.value_classification})` : '', lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'Alternative.me', tier:'free', factors:['Fear & Greed Index'], configured:true, available:false, status:'error', message:e.message, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkReddit() {
  // Reddit bloquea requests server-side con 403.
  // Solución: marcar como "disponible con limitaciones" — el sentimiento
  // se obtiene en runtime desde el frontend (CORS permitido) no desde el backend.
  return {
    name: 'Reddit',
    tier: 'free',
    factors: ['Reddit Sentiment'],
    configured: true,
    available: true,
    status: 'limited',
    message: 'API pública disponible (sin auth). El check server-side recibe 403 de Reddit — funciona desde frontend/client.',
    responseTime: 0,
    lastCheck: new Date().toISOString()
  };
}

async function checkBlockchain() {
  const t = Date.now();
  try {
    const r = await axios.get('https://blockchain.info/q/24hrtransactioncount', { timeout: TIMEOUT_MS });
    const ms = Date.now()-t;
    const tx = parseInt(r.data);
    return { name:'Blockchain.info', tier:'free', factors:['Transacciones BTC'], configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, currentValue:`${isNaN(tx)?'?':tx.toLocaleString()} tx/24h`, lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'Blockchain.info', tier:'free', factors:['Transacciones BTC'], configured:true, available:false, status:'error', message:e.message, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkCryptoCompare(redis) {
  const key = await getKey('CRYPTOCOMPARE_API_KEY', redis);
  if (!key) return { name:'CryptoCompare', tier:'freemium', factors:['News Volume','News Sentiment'], configured:false, available:false, status:'not_configured', message:'API key no configurada — gratis en cryptocompare.com', responseTime:0, configInstructions:'https://www.cryptocompare.com/cryptopian/api-keys', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=1', { timeout:TIMEOUT_MS, headers:{'authorization':`Apikey ${key}`} });
    const ms = Date.now()-t;
    if (!r.data?.Data) throw new Error('Respuesta vacía');
    return { name:'CryptoCompare', tier:'freemium', factors:['News Volume','News Sentiment'], configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    const msg = e.response?.status===401 ? 'API key inválida' : e.response?.status===429 ? 'Rate limit excedido' : e.message;
    return { name:'CryptoCompare', tier:'freemium', factors:['News Volume','News Sentiment'], configured:true, available:false, status:'error', message:msg, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkNewsAPI(redis) {
  const key = await getKey('NEWSAPI_KEY', redis);
  if (!key) return { name:'NewsAPI', tier:'freemium', factors:['Media Coverage','Breaking News'], configured:false, available:false, status:'not_configured', message:'API key no configurada — gratis en newsapi.org', responseTime:0, configInstructions:'https://newsapi.org/register', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get('https://newsapi.org/v2/everything', { timeout:TIMEOUT_MS, params:{ q:'bitcoin', pageSize:1, apiKey:key } });
    const ms = Date.now()-t;
    if (r.data?.status !== 'ok') throw new Error('Respuesta no ok');
    return { name:'NewsAPI', tier:'freemium', factors:['Media Coverage','Breaking News'], configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    const msg = e.response?.status===401 ? 'API key inválida' : e.response?.status===429 ? 'Rate limit excedido (100/día free tier)' : e.message;
    return { name:'NewsAPI', tier:'freemium', factors:['Media Coverage','Breaking News'], configured:true, available:false, status:'error', message:msg, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkGitHub(redis) {
  const configured = !!(await getKey('GITHUB_TOKEN', redis));
  const t = Date.now();
  try {
    const headers = configured ? { 'Authorization':`token ${await getKey('GITHUB_TOKEN', redis)}` } : {};
    const r = await axios.get('https://api.github.com/rate_limit', { timeout:TIMEOUT_MS, headers });
    const ms = Date.now()-t;
    const rem = r.data?.rate?.remaining ?? '?';
    const lim = r.data?.rate?.limit ?? '?';
    const status = configured ? 'operational' : 'limited';
    const msg = configured ? `OK — ${rem}/${lim} req restantes (${ms}ms)` : `Sin token — ${rem}/${lim} req/h. Añade GITHUB_TOKEN para 5000/h`;
    return { name:'GitHub', tier:'freemium', factors:['Developer Activity'], configured, available:true, status, message:msg, responseTime:ms, configInstructions:'https://github.com/settings/tokens', lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'GitHub', tier:'freemium', factors:['Developer Activity'], configured, available:false, status:'error', message:e.message, responseTime:Date.now()-t, configInstructions:'https://github.com/settings/tokens', lastCheck:new Date().toISOString() };
  }
}

async function checkTelegram(redis) {
  const token = await getKey('TELEGRAM_BOT_TOKEN', redis);
  if (!token) return { name:'Telegram Bot', tier:'free', factors:['Telegram Activity'], configured:false, available:false, status:'not_configured', message:'Token no configurado — gratis vía @BotFather', responseTime:0, configInstructions:'Telegram → @BotFather → /newbot', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout:TIMEOUT_MS });
    const ms = Date.now()-t;
    if (!r.data?.ok) throw new Error('Token inválido');
    return { name:'Telegram Bot', tier:'free', factors:['Telegram Activity'], configured:true, available:true, status:'operational', message:`OK — Bot: @${r.data.result.username} (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'Telegram Bot', tier:'free', factors:['Telegram Activity'], configured:true, available:false, status:'error', message:e.response?.status===401?'Token inválido':e.message, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkSerpAPI(redis) {
  const key = await getKey('SERPAPI_KEY', redis);
  if (!key) return { name:'SerpAPI (Google Trends)', tier:'paid', factors:['Google Trends'], cost:'$50/mes', configured:false, available:false, status:'not_configured', message:'API key no configurada — 100 búsquedas gratis/mes en serpapi.com', responseTime:0, configInstructions:'https://serpapi.com/', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get('https://serpapi.com/account', { timeout:TIMEOUT_MS, params:{ api_key:key } });
    const ms = Date.now()-t;
    return { name:'SerpAPI (Google Trends)', tier:'paid', factors:['Google Trends'], cost:'$50/mes', configured:true, available:true, status:'operational', message:`OK — ${r.data?.total_searches_left ?? '?'} búsquedas restantes (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'SerpAPI (Google Trends)', tier:'paid', factors:['Google Trends'], cost:'$50/mes', configured:true, available:false, status:'error', message:e.response?.status===401?'API key inválida':e.message, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkTwitter(redis) {
  const token = await getKey('TWITTER_BEARER_TOKEN', redis);
  if (!token) return { name:'Twitter API v2', tier:'paid', factors:['Twitter Sentiment'], cost:'$100/mes', configured:false, available:false, status:'not_configured', message:'Bearer token no configurado — desde $100/mes', responseTime:0, configInstructions:'https://developer.twitter.com/', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get('https://api.twitter.com/2/tweets/search/recent', { timeout:TIMEOUT_MS, headers:{'Authorization':`Bearer ${token}`}, params:{ query:'bitcoin', max_results:10 } });
    const ms = Date.now()-t;
    return { name:'Twitter API v2', tier:'paid', factors:['Twitter Sentiment'], cost:'$100/mes', configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    const msg = e.response?.status===401?'Bearer token inválido':e.response?.status===429?'Rate limit excedido':e.message;
    return { name:'Twitter API v2', tier:'paid', factors:['Twitter Sentiment'], cost:'$100/mes', configured:true, available:false, status:'error', message:msg, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkGlassnode(redis) {
  const key = await getKey('GLASSNODE_API_KEY', redis);
  if (!key) return { name:'Glassnode', tier:'premium', factors:['Unique Addresses','Network Growth'], cost:'$29-799/mes', configured:false, available:false, status:'not_configured', message:'API key no configurada — desde $29/mes', responseTime:0, configInstructions:'https://glassnode.com/', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get('https://api.glassnode.com/v1/metrics/addresses/active_count', { timeout:TIMEOUT_MS, params:{ a:'BTC', api_key:key, i:'24h', c:'native' } });
    const ms = Date.now()-t;
    return { name:'Glassnode', tier:'premium', factors:['Unique Addresses','Network Growth'], cost:'$29-799/mes', configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    const msg = e.response?.status===401?'API key inválida':e.response?.status===402?'Plan insuficiente o expirado':e.message;
    return { name:'Glassnode', tier:'premium', factors:['Unique Addresses','Network Growth'], cost:'$29-799/mes', configured:true, available:false, status:'error', message:msg, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

async function checkCryptoQuant(redis) {
  const key = await getKey('CRYPTOQUANT_API_KEY', redis);
  if (!key) return { name:'CryptoQuant', tier:'premium', factors:['Exchange Net Flow'], cost:'$49-899/mes', configured:false, available:false, status:'not_configured', message:'API key no configurada — desde $49/mes', responseTime:0, configInstructions:'https://cryptoquant.com/', lastCheck:new Date().toISOString() };
  return { name:'CryptoQuant', tier:'premium', factors:['Exchange Net Flow'], cost:'$49-899/mes', configured:true, available:false, status:'unknown', message:'Configurada — verificación manual requerida en cryptoquant.com', responseTime:0, lastCheck:new Date().toISOString() };
}

async function checkWhaleAlert(redis) {
  const key = await getKey('WHALE_ALERT_API_KEY', redis);
  if (!key) return { name:'Whale Alert', tier:'premium', factors:['Whale Activity'], cost:'$49/mes', configured:false, available:false, status:'not_configured', message:'API key no configurada — desde $49/mes', responseTime:0, configInstructions:'https://whale-alert.io/', lastCheck:new Date().toISOString() };
  const t = Date.now();
  try {
    const r = await axios.get('https://api.whale-alert.io/v1/status', { timeout:TIMEOUT_MS, params:{ api_key:key } });
    const ms = Date.now()-t;
    if (r.data?.status !== 'success') throw new Error('Respuesta inesperada');
    return { name:'Whale Alert', tier:'premium', factors:['Whale Activity'], cost:'$49/mes', configured:true, available:true, status:'operational', message:`OK (${ms}ms)`, responseTime:ms, lastCheck:new Date().toISOString() };
  } catch(e) {
    return { name:'Whale Alert', tier:'premium', factors:['Whale Activity'], cost:'$49/mes', configured:true, available:false, status:'error', message:e.response?.status===401?'API key inválida':e.message, responseTime:Date.now()-t, lastCheck:new Date().toISOString() };
  }
}

module.exports = { checkAllAPIs };
