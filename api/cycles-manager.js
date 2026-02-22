// cycles-manager.js — serialización compatible con @upstash/redis
//
// REGLA CRÍTICA con @upstash/redis:
//   - redis.set(key, objeto_js)  → Upstash serializa internamente
//   - redis.get(key)             → devuelve ya el objeto JS, NO un string
//   → NUNCA usar JSON.stringify al guardar ni JSON.parse al leer

// ── helpers de bajo nivel ────────────────────────────────────────────────────

async function rGet(redis, key) {
  const v = await redis.get(key);
  // Upstash devuelve null si no existe, o el valor ya deserializado
  return v ?? null;
}

async function rSet(redis, key, value) {
  // Pasar el valor directamente; Upstash lo serializa
  await redis.set(key, value);
}

// ── listas de IDs ────────────────────────────────────────────────────────────

async function getActiveIds(redis) {
  const v = await rGet(redis, 'active_cycles');
  if (!v) return [];
  // Por si viene como string de migración anterior
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
}

async function setActiveIds(redis, ids) {
  await rSet(redis, 'active_cycles', ids);
}

async function getCompletedIds(redis) {
  const v = await rGet(redis, 'completed_cycles');
  if (!v) return [];
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v : [];
}

async function setCompletedIds(redis, ids) {
  await rSet(redis, 'completed_cycles', ids);
}

// ── ciclo individual ─────────────────────────────────────────────────────────

async function saveCycle(redis, cycle) {
  await rSet(redis, cycle.id, cycle);
}

async function loadCycle(redis, cycleId) {
  const v = await rGet(redis, cycleId);
  if (!v) return null;
  // Compatibilidad: si viene como string (versión anterior)
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

// ── API pública ──────────────────────────────────────────────────────────────

async function createCycle(redis, snapshot, config, durationMs, mode = 'normal') {
  if (!redis) throw new Error('Redis no disponible');

  // Solo campos esenciales — evitar objetos grandes que superen el límite de Upstash
  // Escalar la predicción a la ventana temporal del ciclo
  // La predicción base del algoritmo asume 12h (43200000ms)
  // Pro-rata: si el ciclo es de 6h, la predicción se ajusta x0.5
  const BASE_DURATION_MS = 43200000; // 12h
  const dur = (typeof durationMs === 'number' && durationMs >= 60000) ? durationMs : 43200000;
  const scaleFactor = Math.min(2.0, Math.max(0.1, dur / BASE_DURATION_MS));
  const isSignificant = dur >= 6 * 3600000; // ≥6h = significativo

  const cleanSnapshot = snapshot.map(a => {
    const basePred = typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0);
    // Solo escalar si no es RUIDOSO (RUIDOSO siempre predice 0)
    const scaledPred = (a.classification === 'RUIDOSO' || basePred === 0) ? 0 : parseFloat((basePred * scaleFactor).toFixed(2));
    return {
      id:                          a.id,
      symbol:                      a.symbol,
      name:                        a.name,
      current_price:               a.current_price,
      market_cap:                  a.market_cap,
      total_volume:                a.total_volume,
      price_change_percentage_24h: a.price_change_percentage_24h,
      ath:                         a.ath,
      atl:                         a.atl,
      boostPower:                  a.boostPower,
      boostPowerPercent:           a.boostPowerPercent,
      classification:              a.classification,
      predictedChange:             scaledPred,
      basePrediction:              basePred,   // guardar predicción base (12h)
      predictionScaleFactor:       scaleFactor
    };
  });

  const cycleId   = `cycle_${Date.now()}`;
  const startTime = Date.now();

  const cycle = {
    id:              cycleId,
    startTime,
    endTime:         startTime + dur,
    durationMs:      dur,
    isSignificant,   // ≥6h
    mode:            mode === 'speculative' ? 'speculative' : 'normal',  // ← separación de modelos
    predictionScaleFactor: scaleFactor,
    status:          'active',
    snapshot:        cleanSnapshot,
    config:          { boostPowerThreshold: config.boostPowerThreshold, modelType: mode },
    results:         null,
    metrics:         null,
    completedAt:     null,
    excludedResults: []
  };

  // Guardar ciclo
  await saveCycle(redis, cycle);

  // Añadir a lista de activos
  const ids = await getActiveIds(redis);
  if (!ids.includes(cycleId)) ids.push(cycleId);
  await setActiveIds(redis, ids);

  return cycle;
}

async function getActiveCycles(redis) {
  if (!redis) return [];
  return getActiveIds(redis);
}

async function getCycle(redis, cycleId) {
  if (!redis) return null;
  return loadCycle(redis, cycleId);
}

async function getCyclesDetails(redis, cycleIds) {
  const out = [];
  for (const id of cycleIds) {
    const c = await loadCycle(redis, id);
    if (c) out.push(c);
  }
  return out;
}

async function detectPendingCycles(redis) {
  if (!redis) return [];
  const ids = await getActiveIds(redis);
  const now = Date.now();
  const pending = [];
  for (const id of ids) {
    const c = await loadCycle(redis, id);
    if (c && c.status === 'active' && now >= c.endTime) pending.push(c);
  }
  return pending;
}

async function completeCycle(redis, cycleId, currentPrices, config) {
  if (!redis) throw new Error('Redis no disponible');

  const cycle = await loadCycle(redis, cycleId);
  if (!cycle) throw new Error(`Ciclo ${cycleId} no encontrado`);
  if (cycle.status === 'completed') return cycle; // idempotente

  // Validación honesta: usa validatePrediction del nuevo algoritmo
  const boostPowerCalc = require('./boost-power-calculator');
  const cfg = config || {};

  const results = [];
  let correct = 0;

  for (const asset of cycle.snapshot) {
    const current = currentPrices.find(p => p.id === asset.id);
    if (!current) continue;

    const actualChange    = ((current.current_price - asset.current_price) / asset.current_price) * 100;
    const predictedChange = typeof asset.predictedChange === 'number'
      ? asset.predictedChange
      : parseFloat(asset.predictedChange || 0);
    const category = asset.classification || 'RUIDOSO';

    // Validación rigurosa: dirección + tolerancia configurada (no ±15% fijo)
    const validation = boostPowerCalc.validatePrediction(predictedChange, actualChange, category, cfg);
    if (validation.correct) correct++;

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
      error:            Math.abs(predictedChange - actualChange).toFixed(2)
    });
  }

  // Guardia: no guardar un ciclo "completado" con 0 resultados.
  // Ocurre cuando CoinGecko no devuelve precios para ningún activo del snapshot
  // (rate-limit, error de red, o IDs incorrectos). Lanzar error para que el
  // endpoint devuelva 503 y el usuario pueda reintentar sin corromper el historial.
  if (results.length === 0) {
    throw new Error(
      `No se encontraron precios actuales para ninguno de los ${cycle.snapshot.length} activos del snapshot. ` +
      `Espera 1 minuto y vuelve a completar el ciclo.`
    );
  }

  cycle.status      = 'completed';
  cycle.results     = results;
  cycle.metrics     = buildMetrics(results);
  cycle.completedAt = Date.now();

  // Guardar ciclo actualizado
  await saveCycle(redis, cycle);

  // Quitar de activos
  const activeIds = await getActiveIds(redis);
  await setActiveIds(redis, activeIds.filter(id => id !== cycleId));

  // Añadir a historial
  const completedIds = await getCompletedIds(redis);
  if (!completedIds.includes(cycleId)) completedIds.unshift(cycleId);
  await setCompletedIds(redis, completedIds.slice(0, 50));

  return cycle;
}

async function getCompletedCycles(redis) {
  if (!redis) return [];
  return getCompletedIds(redis);
}

async function getGlobalStats(redis) {
  const ids    = await getCompletedIds(redis);
  const cycles = await getCyclesDetails(redis, ids);

  if (cycles.length === 0) {
    return { totalCycles: 0, totalPredictions: 0, avgSuccessRate: '0.00', bestCycle: null, worstCycle: null };
  }

  const totalPredictions = cycles.reduce((s, c) => s + (c.metrics?.total || 0), 0);
  const rates            = cycles.map(c => parseFloat(c.metrics?.successRate || 0));
  const avgSuccessRate   = (rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(2);
  const sorted           = [...cycles].sort((a, b) =>
    parseFloat(b.metrics?.successRate || 0) - parseFloat(a.metrics?.successRate || 0)
  );

  return {
    totalCycles: cycles.length,
    totalPredictions,
    avgSuccessRate,
    bestCycle: sorted[0] ? {
      id: sorted[0].id,
      successRate: sorted[0].metrics.successRate,
      date: new Date(sorted[0].completedAt).toLocaleDateString()
    } : null,
    worstCycle: sorted[sorted.length - 1] ? {
      id: sorted[sorted.length - 1].id,
      successRate: sorted[sorted.length - 1].metrics.successRate,
      date: new Date(sorted[sorted.length - 1].completedAt).toLocaleDateString()
    } : null
  };
}

function recalculateMetrics(results) {
  return buildMetrics(results || []);
}

// ── helpers de métricas ──────────────────────────────────────────────────────

function buildMetrics(results) {
  if (!results || results.length === 0) {
    return { total: 0, correct: 0, successRate: '0.00', avgError: '0.00', maxError: '0.00',
      invertible: { total:0, correct:0, successRate:'0.00' },
      apalancado:  { total:0, correct:0, successRate:'0.00' },
      ruidoso:     { total:0, correct:0, successRate:'0.00' } };
  }
  const correct = results.filter(r => r.correct).length;
  return {
    total:       results.length,
    correct,
    successRate: (correct / results.length * 100).toFixed(2),
    invertible:  catMetrics(results, 'INVERTIBLE'),
    apalancado:  catMetrics(results, 'APALANCADO'),
    ruidoso:     catMetrics(results, 'RUIDOSO'),
    avgError:    avgErr(results),
    maxError:    maxErr(results)
  };
}

function catMetrics(results, cat) {
  const sub = results.filter(r => r.classification === cat);
  if (!sub.length) return { total: 0, correct: 0, successRate: '0.00' };
  const ok = sub.filter(r => r.correct).length;
  return { total: sub.length, correct: ok, successRate: (ok / sub.length * 100).toFixed(2) };
}

function avgErr(results) {
  if (!results.length) return '0.00';
  return (results.reduce((s, r) => s + parseFloat(r.error), 0) / results.length).toFixed(2);
}

function maxErr(results) {
  if (!results.length) return '0.00';
  return Math.max(...results.map(r => parseFloat(r.error))).toFixed(2);
}

module.exports = {
  createCycle,
  getActiveCycles,
  getCycle,
  getCyclesDetails,
  detectPendingCycles,
  completeCycle,
  getCompletedCycles,
  getGlobalStats,
  recalculateMetrics
};
