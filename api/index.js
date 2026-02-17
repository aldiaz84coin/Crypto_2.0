// api/index.js - Backend Crypto Detector v3.2 (CORREGIDO)
'use strict';

const express = require('express');
const cors    = require('axios');   // placeholder — se sobreescribe abajo
const axios   = require('axios');
const { Packer } = require('docx');

const app = express();
app.use(require('cors')());
app.use(express.json({ limit: '5mb' }));

// ─── Redis ──────────────────────────────────────────────────────────────────
let redis = null;
try {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url, token });
    console.log('✅ Redis conectado');
  } else {
    console.warn('⚠️  Redis: KV_REST_API_URL / KV_REST_API_TOKEN no definidos');
  }
} catch (e) {
  console.error('⚠️  Redis init error:', e.message);
}

// ─── Módulos propios ────────────────────────────────────────────────────────
const algorithmConfig  = require('./algorithm-config');
const boostPowerCalc   = require('./boost-power-calculator');
const cyclesManager    = require('./cycles-manager');
const reportGenerator  = require('./report-generator');
const apiHealthCheck   = require('./api-health-check');

const DEFAULT_CONFIG = algorithmConfig.DEFAULT_CONFIG;

// ─── Helpers inline (reemplazan data-sources.js) ────────────────────────────

async function getFearGreedIndex() {
  try {
    const r = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 4000 });
    const d = r.data?.data?.[0];
    if (d) return { success: true, value: parseInt(d.value), classification: d.value_classification };
  } catch (_) {}
  return { success: false };
}

function analyzeSentimentInline(text) {
  const t = (text || '').toLowerCase();
  const pos = ['surge','gain','rise','bullish','adoption','partnership','upgrade','success',
               'growth','rally','recovery','innovation','launch','profit','momentum','all-time high'];
  const neg = ['crash','drop','decline','bearish','hack','scam','ban','lawsuit','loss',
               'collapse','warning','fear','correction','fraud','exploit','plunge'];
  let score = 0;
  pos.forEach(w => { if (t.includes(w)) score++; });
  neg.forEach(w => { if (t.includes(w)) score--; });
  const normalized = Math.max(-1, Math.min(1, score / 3));
  return { score: normalized, label: normalized > 0.2 ? 'positive' : normalized < -0.2 ? 'negative' : 'neutral' };
}

async function getCryptoNews(symbol = '', limit = 5) {
  try {
    // Intentar primero con key de env, luego con key guardada en Redis
    let key = process.env.CRYPTOCOMPARE_API_KEY || '';
    if (!key && redis) {
      const stored = await redis.get('apikey:CRYPTOCOMPARE_API_KEY');
      if (stored && typeof stored === 'string') key = stored.trim();
    }
    const headers = key ? { authorization: `Apikey ${key}` } : {};
    const r = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN', {
      headers, timeout: 4000
    });
    if (r.data?.Data) {
      const articles = r.data.Data.slice(0, limit).map(a => ({
        ...a,
        sentiment: analyzeSentimentInline(a.title + ' ' + (a.body || ''))
      }));
      return { success: true, count: articles.length, articles };
    }
  } catch (_) {}
  return { success: false, count: 0, articles: [] };
}

function analyzeSentiment(text) {
  const t = text.toLowerCase();
  const pos = ['surge','gain','rise','bullish','adoption','partnership','upgrade','growth','rally','recovery'].filter(w => t.includes(w)).length;
  const neg = ['crash','drop','decline','bearish','hack','ban','lawsuit','loss','collapse','fraud'].filter(w => t.includes(w)).length;
  const score = Math.max(-1, Math.min(1, (pos - neg) / 3));
  return { score, label: score > 0.3 ? 'positive' : score < -0.3 ? 'negative' : 'neutral' };
}

// ─── Helpers de Redis (con manejo de errores) ────────────────────────────────

// Upstash serializa/deserializa automáticamente — pasar objetos directamente
async function redisGet(key) {
  if (!redis) return null;
  try {
    return await redis.get(key) ?? null;
  } catch (e) {
    console.error(`Redis GET ${key}:`, e.message);
    return null;
  }
}

async function redisSet(key, value) {
  if (!redis) throw new Error('Redis no disponible');
  try {
    await redis.set(key, value);
    return true;
  } catch (e) {
    console.error(`Redis SET ${key}:`, e.message);
    throw e;
  }
}

async function getConfig() {
  const stored = await redisGet('algorithm-config');
  if (stored && typeof stored === 'object') return stored;
  if (stored && typeof stored === 'string') { try { return JSON.parse(stored); } catch(_){} }
  return { ...DEFAULT_CONFIG };
}

// ════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '3.2.1',
    redis: redis ? 'connected' : 'not available',
    timestamp: new Date().toISOString()
  });
});

// ── Debug Redis (para diagnosticar problemas en Vercel) ─────────────────────
app.get('/api/debug/redis', async (_req, res) => {
  if (!redis) return res.json({ success: false, error: 'Redis no configurado' });
  try {
    const testKey = '_debug_test';
    await redisSet(testKey, { ok: true, ts: Date.now() });
    const back = await redisGet(testKey);
    const activeCycles = await redisGet('active_cycles');
    res.json({
      success: true,
      writeRead: !!back,
      activeCycles: Array.isArray(activeCycles) ? activeCycles : (activeCycles ? activeCycles : []),
      env: {
        hasUrl:   !!process.env.KV_REST_API_URL,
        hasToken: !!process.env.KV_REST_API_TOKEN
      }
    });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// ── Debug ciclos (flujo completo) ───────────────────────────────────────────
app.get('/api/debug/cycles', async (_req, res) => {
  if (!redis) return res.json({ success: false, error: 'Redis no configurado' });
  try {
    // 1. Leer active_cycles directamente
    const raw = await redis.get('active_cycles');
    const activeIds = await cyclesManager.getActiveCycles(redis);

    // 2. Leer el primer ciclo activo si existe
    let firstCycle = null;
    if (activeIds.length > 0) {
      firstCycle = await cyclesManager.getCycle(redis, activeIds[0]);
    }

    res.json({
      success: true,
      rawActiveValue: raw,
      rawType: typeof raw,
      activeIds,
      firstCycle: firstCycle ? {
        id: firstCycle.id,
        status: firstCycle.status,
        startTime: firstCycle.startTime,
        endTime: firstCycle.endTime,
        assetsCount: firstCycle.snapshot?.length
      } : null
    });
  } catch(e) {
    res.json({ success: false, error: e.message, stack: e.stack });
  }
});

// ── Config ──────────────────────────────────────────────────────────────────
app.get('/api/config', async (_req, res) => {
  try {
    res.json({ success: true, config: await getConfig() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ success: false, error: 'Se requiere "config"' });

    const validation = algorithmConfig.validateConfig(config);
    if (!validation.valid) return res.status(400).json({ success: false, errors: validation.errors });

    config.lastModified = new Date().toISOString();
    config.version = '3.2.1';
    await redisSet('algorithm-config', config);
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/config/reset', async (_req, res) => {
  try {
    const config = { ...DEFAULT_CONFIG, lastModified: new Date().toISOString() };
    await redisSet('algorithm-config', config);
    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/config/metadata', (_req, res) => {
  try {
    res.json({ success: true, metadata: algorithmConfig.getFactorMetadata() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Datos de mercado ─────────────────────────────────────────────────────────
app.get('/api/crypto', async (_req, res) => {
  try {
    const config = await getConfig();

    const [marketRes, fearGreed, news] = await Promise.allSettled([
      axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage_24h=true', { timeout: 8000 }),
      getFearGreedIndex(),
      getCryptoNews('', 5)
    ]);

    if (marketRes.status === 'rejected') throw new Error('CoinGecko no disponible: ' + marketRes.reason?.message);

    const fgData   = fearGreed.status === 'fulfilled' ? fearGreed.value : { success: false };
    const newsData = news.status      === 'fulfilled' ? news.value      : { success: false, count: 0 };

    const externalData = {
      fearGreed: fgData.success ? fgData : null,
      news:      newsData.success ? newsData : null
    };

    const cryptosWithBoost = marketRes.value.data.map(crypto => {
      const { boostPower, breakdown } = boostPowerCalc.calculateBoostPower(crypto, config, externalData);
      const classification = boostPowerCalc.classifyAsset(boostPower, config.boostPowerThreshold);
      return {
        id:                          crypto.id,
        symbol:                      crypto.symbol,
        name:                        crypto.name,
        image:                       crypto.image,
        current_price:               crypto.current_price,
        market_cap:                  crypto.market_cap,
        market_cap_rank:             crypto.market_cap_rank,
        total_volume:                crypto.total_volume,
        price_change_percentage_24h: crypto.price_change_percentage_24h,
        ath:                         crypto.ath,
        atl:                         crypto.atl,
        boostPower,
        boostPowerPercent: Math.round(boostPower * 100),
        breakdown,
        classification: classification.category,
        color:          classification.color,
        recommendation: classification.recommendation,
        predictedChange: parseFloat(((boostPower - 0.5) * 30).toFixed(2))
      };
    });

    cryptosWithBoost.sort((a, b) => b.boostPower - a.boostPower);

    res.json({
      success: true,
      data: cryptosWithBoost,
      externalData: {
        fearGreed: fgData.success ? { value: fgData.value, classification: fgData.classification } : null,
        newsCount: newsData.count || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('/api/crypto error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Estado completo de APIs ──────────────────────────────────────────────────
app.get('/api/status/complete', async (_req, res) => {
  try {
    const status = await apiHealthCheck.checkAllAPIs(redis);
    res.json({ success: true, ...status });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Guardar API key desde la UI ──────────────────────────────────────────────
// Almacena la key en Redis (las vars de entorno de Vercel no se pueden
// modificar en runtime; usamos Redis como almacén de keys de usuario)
app.post('/api/config/api-key', async (req, res) => {
  try {
    const { apiName, apiKey } = req.body;
    const allowed = ['CRYPTOCOMPARE_API_KEY','NEWSAPI_KEY','GITHUB_TOKEN','TELEGRAM_BOT_TOKEN','SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY','WHALE_ALERT_API_KEY'];
    if (!allowed.includes(apiName)) return res.status(400).json({ success: false, error: 'API name no permitida' });
    if (!apiKey || apiKey.trim() === '') {
      await redisSet(`apikey:${apiName}`, '');
    } else {
      await redisSet(`apikey:${apiName}`, apiKey.trim());
    }
    res.json({ success: true, message: `Key guardada para ${apiName}` });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/config/api-keys', async (_req, res) => {
  try {
    const names = ['CRYPTOCOMPARE_API_KEY','NEWSAPI_KEY','GITHUB_TOKEN','TELEGRAM_BOT_TOKEN','SERPAPI_KEY','TWITTER_BEARER_TOKEN','GLASSNODE_API_KEY','CRYPTOQUANT_API_KEY','WHALE_ALERT_API_KEY'];
    const keys = {};
    for (const n of names) {
      const v = await redisGet(`apikey:${n}`);
      keys[n] = v && v !== '""' && v !== '' ? '••••••' : ''; // Ocultar valor real
    }
    res.json({ success: true, keys });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CICLOS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/cycles/start', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible. Configura KV_REST_API_URL y KV_REST_API_TOKEN en Vercel.' });

  const { snapshot, durationMs } = req.body;
  if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
    return res.status(400).json({ success: false, error: 'Se requiere "snapshot" con al menos 1 activo' });
  }

  const dur = parseInt(durationMs);
  const finalDuration = (!isNaN(dur) && dur >= 60000 && dur <= 7 * 86400000) ? dur : 43200000;

  try {
    const config = await getConfig();
    const cycle  = await cyclesManager.createCycle(redis, snapshot, config, finalDuration);
    res.json({
      success: true,
      cycle: { id: cycle.id, startTime: cycle.startTime, endTime: cycle.endTime, durationMs: cycle.durationMs, assetsCount: cycle.snapshot.length }
    });
  } catch (e) {
    console.error('cycles/start error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/active', async (_req, res) => {
  if (!redis) return res.json({ success: true, cycles: [] });
  try {
    const ids    = await cyclesManager.getActiveCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, ids);
    const now    = Date.now();
    cycles.forEach(c => {
      c.timeRemaining  = Math.max(0, c.endTime - now);
      c.hoursRemaining = (c.timeRemaining / 3600000).toFixed(1);
    });
    res.json({ success: true, cycles });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/pending', async (_req, res) => {
  if (!redis) return res.json({ success: true, cycles: [] });
  try {
    const pending = await cyclesManager.detectPendingCycles(redis);
    res.json({ success: true, cycles: pending });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/cycles/:cycleId/complete', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const prices = await axios.get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1', { timeout: 8000 });
    const cycle  = await cyclesManager.completeCycle(redis, req.params.cycleId, prices.data);
    res.json({ success: true, cycle: { id: cycle.id, metrics: cycle.metrics, completedAt: cycle.completedAt } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/history', async (_req, res) => {
  if (!redis) return res.json({ success: true, cycles: [] });
  try {
    const ids    = await cyclesManager.getCompletedCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, ids);
    res.json({ success: true, cycles });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/stats/global', async (_req, res) => {
  if (!redis) return res.json({ success: true, stats: { totalCycles: 0, totalPredictions: 0, avgSuccessRate: 0 } });
  try {
    const stats = await cyclesManager.getGlobalStats(redis);
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/cycles/:cycleId', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    res.json({ success: true, cycle });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/cycles/:cycleId/results/:assetId/toggle-exclude', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  const { cycleId, assetId } = req.params;
  try {
    const cycle = await cyclesManager.getCycle(redis, cycleId);
    if (!cycle)                        return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status !== 'completed')  return res.status(400).json({ success: false, error: 'Ciclo no completado' });

    const excluded = cycle.excludedResults || [];
    const idx = excluded.indexOf(assetId);
    if (idx === -1) excluded.push(assetId); else excluded.splice(idx, 1);
    cycle.excludedResults = excluded;
    cycle.metrics = cyclesManager.recalculateMetrics(cycle.results.filter(r => !excluded.includes(r.id)));

    await redisSet(cycleId, cycle);
    res.json({ success: true, excluded, metrics: cycle.metrics, isExcluded: excluded.includes(assetId) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Informe Word ─────────────────────────────────────────────────────────────
app.get('/api/cycles/:cycleId/report', async (req, res) => {
  if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
  try {
    const cycle = await cyclesManager.getCycle(redis, req.params.cycleId);
    if (!cycle)                       return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });
    if (cycle.status !== 'completed') return res.status(400).json({ success: false, error: 'El ciclo aún no está completado' });

    const doc    = reportGenerator.generateCycleReport(cycle);
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=Informe_${req.params.cycleId}.docx`);
    res.send(buffer);
  } catch (e) {
    console.error('report error:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Arranque local ──────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}

module.exports = app;
