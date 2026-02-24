// api/iteration-engine.js — Motor de Iteraciones de Ciclo · Crypto Detector v4
//
// RESPONSABILIDADES:
//   1. Obtener precios actuales con retry + 3 fuentes de respaldo
//   2. Evaluar criterios de venta por posición e iteración
//   3. Registrar cada iteración en el ciclo (precios + decisiones)
//   4. Calcular métricas parciales intermedias
//
// FLUJO DE PRECIOS (cascada):
//   CoinGecko → CryptoCompare → Binance Public API
//   Si todas fallan: usa el último precio conocido + marca como "stale"
'use strict';

const axios = require('axios');

// ─── Configuración de iteraciones ─────────────────────────────────────────────
const ITERATION_CONFIG = {
  // Intervalos predeterminados según duración del ciclo
  intervalByDuration: {
    3600000:   600000,   // 1h  → cada 10 min  → 6 iter
    7200000:   900000,   // 2h  → cada 15 min  → 8 iter
    14400000:  1800000,  // 4h  → cada 30 min  → 8 iter
    21600000:  3600000,  // 6h  → cada 1h      → 6 iter
    43200000:  3600000,  // 12h → cada 1h      → 12 iter
    86400000:  7200000,  // 24h → cada 2h      → 12 iter
    172800000: 14400000, // 48h → cada 4h      → 12 iter
    259200000: 21600000, // 72h → cada 6h      → 12 iter
  },
  defaultInterval:  3600000,  // 1h por defecto
  retryDelayMs:     5000,     // esperar 5s entre reintentos
  maxRetries:       3,        // máximo de reintentos por fuente
  staleThresholdMs: 1800000,  // precio "stale" si tiene > 30 min de antigüedad
};

// ─── Fuentes de precios ────────────────────────────────────────────────────────

/**
 * CoinGecko: fuente principal
 * Devuelve Map<assetId, price>
 */
async function fetchFromCoinGecko(assetIds) {
  const ids = assetIds.join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const res = await axios.get(url, { timeout: 10000 });
  const data = res.data || {};
  const result = new Map();
  for (const id of assetIds) {
    if (data[id]?.usd) {
      result.set(id, { price: data[id].usd, change24h: data[id].usd_24h_change || 0, source: 'coingecko' });
    }
  }
  return result;
}

/**
 * CryptoCompare: fuente de respaldo #1
 * Convierte CoinGecko IDs a símbolos usando el snapshot del ciclo
 */
async function fetchFromCryptoCompare(assetIds, symbolMap, apiKey) {
  const symbols = assetIds.map(id => symbolMap[id]).filter(Boolean);
  if (symbols.length === 0) return new Map();

  const fsyms = [...new Set(symbols.map(s => s.toUpperCase()))].join(',');
  const headers = apiKey ? { authorization: `Apikey ${apiKey}` } : {};
  const url = `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${fsyms}&tsyms=USD`;
  const res = await axios.get(url, { timeout: 10000, headers });
  const raw = res.data?.RAW || {};

  // Invertir symbolMap para lookup por símbolo
  const idBySymbol = {};
  for (const [id, sym] of Object.entries(symbolMap)) idBySymbol[sym.toUpperCase()] = id;

  const result = new Map();
  for (const [sym, data] of Object.entries(raw)) {
    const id = idBySymbol[sym];
    if (id && data.USD?.PRICE) {
      result.set(id, { price: data.USD.PRICE, change24h: data.USD.CHANGEPCT24HOUR || 0, source: 'cryptocompare' });
    }
  }
  return result;
}

/**
 * Binance Public API: fuente de respaldo #2
 * Solo funciona para pares con USDT, útil para la mayoría de tops
 */
async function fetchFromBinance(assetIds, symbolMap) {
  const url = 'https://api.binance.com/api/v3/ticker/price';
  const res = await axios.get(url, { timeout: 10000 });
  const tickers = res.data || [];
  const tickerMap = {};
  for (const t of tickers) tickerMap[t.symbol] = parseFloat(t.price);

  const result = new Map();
  for (const id of assetIds) {
    const sym = symbolMap[id];
    if (!sym) continue;
    const binanceSym = sym.toUpperCase() + 'USDT';
    if (tickerMap[binanceSym]) {
      result.set(id, { price: tickerMap[binanceSym], change24h: 0, source: 'binance' });
    }
  }
  return result;
}

/**
 * Obtiene precios con cascada de fuentes y reintentos.
 * Nunca falla silenciosamente: siempre devuelve el último precio conocido para
 * activos que no se pudieron obtener, marcados como "stale".
 *
 * @param {string[]} assetIds - Lista de IDs de CoinGecko
 * @param {Object} symbolMap  - Map<assetId, symbol> para usar en fuentes alternativas
 * @param {Object} lastKnown  - Map<assetId, {price, timestamp}> — últimos precios guardados
 * @param {Object} apiKeys    - { cryptocompare?: string }
 * @returns {Object} { prices: Map<id, priceInfo>, failedIds: string[], stats }
 */
async function fetchPricesWithFallback(assetIds, symbolMap = {}, lastKnown = {}, apiKeys = {}) {
  if (!assetIds || assetIds.length === 0) return { prices: new Map(), failedIds: [], stats: {} };

  const results   = new Map();
  const failedIds = [...assetIds];
  const stats     = { source: null, retries: 0, staleCount: 0, fetchedCount: 0 };

  const sources = [
    { name: 'coingecko',     fn: () => fetchFromCoinGecko(assetIds) },
    { name: 'cryptocompare', fn: () => fetchFromCryptoCompare(assetIds, symbolMap, apiKeys.cryptocompare) },
    { name: 'binance',       fn: () => fetchFromBinance(assetIds, symbolMap) },
  ];

  for (const source of sources) {
    if (failedIds.length === 0) break; // ya tenemos todo

    let attempt = 0;
    while (attempt < ITERATION_CONFIG.maxRetries && failedIds.length > 0) {
      attempt++;
      if (attempt > 1) {
        console.log(`[iter-engine] Reintento ${attempt} con ${source.name}...`);
        await new Promise(r => setTimeout(r, ITERATION_CONFIG.retryDelayMs * attempt));
      }

      try {
        const fetched = await source.fn();
        for (const id of [...failedIds]) {
          if (fetched.has(id)) {
            results.set(id, fetched.get(id));
            failedIds.splice(failedIds.indexOf(id), 1);
          }
        }
        stats.retries += attempt - 1;
        if (results.size > 0 && !stats.source) stats.source = source.name;
        break; // esta fuente funcionó, pasar a siguiente en failedIds
      } catch (err) {
        console.warn(`[iter-engine] ${source.name} attempt ${attempt} failed: ${err.message}`);
      }
    }
  }

  // Para los que aún fallan → usar último precio conocido como "stale"
  for (const id of failedIds) {
    const known = lastKnown[id];
    if (known?.price) {
      const ageMs = Date.now() - (known.timestamp || 0);
      results.set(id, {
        price:    known.price,
        change24h: 0,
        source:   'stale',
        staleMs:  ageMs,
        isStale:  true,
      });
      stats.staleCount++;
      console.warn(`[iter-engine] Usando precio stale para ${id} (${Math.round(ageMs/60000)}min de antigüedad)`);
    } else {
      // Sin precio en absoluto — no podemos evaluar este activo
      console.error(`[iter-engine] Sin precio para ${id} y sin histórico. Se omite de la iteración.`);
    }
  }

  stats.fetchedCount = results.size;
  return { prices: results, failedIds: failedIds.filter(id => !results.has(id)), stats };
}

// ─── Lógica de decisión de venta ──────────────────────────────────────────────

/**
 * Evalúa si una posición debe venderse en esta iteración.
 * @param {Object} position       - Posición abierta del invest-manager
 * @param {number} currentPrice   - Precio actual del activo
 * @param {Object} investConfig   - Configuración del módulo de inversión
 * @param {number} iterationIndex - Número de iteración actual (0-based)
 * @param {number} totalIterations - Total de iteraciones del ciclo
 * @returns {Object} { action: 'sell'|'hold', reason, urgency: 'high'|'medium'|'low' }
 */
function evaluateSellDecision(position, currentPrice, investConfig, iterationIndex, totalIterations) {
  const cfg = investConfig || {};
  const takeProfitPct = cfg.takeProfitPct || 10;
  const stopLossPct   = cfg.stopLossPct   || 5;
  const maxHoldCycles = cfg.maxHoldCycles || 3;

  const entryPrice  = position.entryPrice || currentPrice;
  const pnlPct      = ((currentPrice - entryPrice) / entryPrice) * 100;
  const isLastIter  = iterationIndex >= totalIterations - 1;
  const holdRatio   = iterationIndex / Math.max(totalIterations - 1, 1); // 0 a 1

  // ── Stop Loss ──────────────────────────────────────────────────────────────
  if (pnlPct <= -stopLossPct) {
    return {
      action:    'sell',
      reason:    `Stop Loss activado: ${pnlPct.toFixed(2)}% (umbral: -${stopLossPct}%)`,
      urgency:   'high',
      pnlPct,
    };
  }

  // ── Take Profit ────────────────────────────────────────────────────────────
  if (pnlPct >= takeProfitPct) {
    return {
      action:    'sell',
      reason:    `Take Profit alcanzado: +${pnlPct.toFixed(2)}% (objetivo: +${takeProfitPct}%)`,
      urgency:   'high',
      pnlPct,
    };
  }

  // ── Predicción del algoritmo alcanzada (aunque sea menor que el TP) ────────
  const predictedTarget = position.predictedChange || 0;
  if (predictedTarget > 0 && pnlPct > 0 && pnlPct >= predictedTarget) {
    return {
      action:  'sell',
      reason:  `Predicción alcanzada: +${pnlPct.toFixed(2)}% ≥ predicción +${predictedTarget.toFixed(2)}%`,
      urgency: 'medium',
      pnlPct,
    };
  }

  // ── Última iteración: cierre obligatorio si no hay ganancia ───────────────
  if (isLastIter) {
    if (pnlPct <= 0) {
      return {
        action:  'sell',
        reason:  `Cierre de ciclo: fin de duración con PnL ${pnlPct.toFixed(2)}%`,
        urgency: 'medium',
        pnlPct,
      };
    } else {
      return {
        action:  'sell',
        reason:  `Cierre de ciclo con ganancia: +${pnlPct.toFixed(2)}%`,
        urgency: 'low',
        pnlPct,
      };
    }
  }

  // ── Take Profit parcial (75%+ del ciclo transcurrido, ganancia > 5%) ──────
  if (holdRatio >= 0.75 && pnlPct >= takeProfitPct * 0.5) {
    return {
      action:  'sell',
      reason:  `Take Profit anticipado: +${pnlPct.toFixed(2)}% con ${Math.round(holdRatio*100)}% del ciclo transcurrido`,
      urgency: 'medium',
      pnlPct,
    };
  }

  // ── Hold ───────────────────────────────────────────────────────────────────
  return {
    action:  'hold',
    reason:  `Mantener: PnL ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% (TP: +${takeProfitPct}% / SL: -${stopLossPct}%)`,
    urgency: 'low',
    pnlPct,
  };
}

// ─── Cálculo de intervalo óptimo ──────────────────────────────────────────────

/**
 * Devuelve el intervalo entre iteraciones para una duración dada.
 * Garantiza entre 6 y 24 iteraciones por ciclo.
 */
function getIterationInterval(durationMs) {
  const intervals = ITERATION_CONFIG.intervalByDuration;
  // Buscar el intervalo más cercano
  const key = Object.keys(intervals)
    .map(Number)
    .sort((a, b) => Math.abs(a - durationMs) - Math.abs(b - durationMs))[0];
  return intervals[key] || ITERATION_CONFIG.defaultInterval;
}

/**
 * Calcula el número de iteraciones para un ciclo dado su duración.
 */
function getIterationCount(durationMs) {
  const interval = getIterationInterval(durationMs);
  return Math.max(2, Math.round(durationMs / interval));
}

/**
 * Devuelve los timestamps esperados de iteración para un ciclo.
 */
function getIterationSchedule(startTime, durationMs) {
  const interval = getIterationInterval(durationMs);
  const count    = getIterationCount(durationMs);
  const schedule = [];
  for (let i = 1; i <= count; i++) {
    schedule.push(startTime + interval * i);
  }
  // Asegurar que la última iteración coincide exactamente con el fin del ciclo
  schedule[schedule.length - 1] = startTime + durationMs;
  return schedule;
}

// ─── Ejecución de una iteración ───────────────────────────────────────────────

/**
 * Ejecuta una iteración completa de un ciclo activo.
 * Obtiene precios, evalúa posiciones y registra el resultado.
 *
 * @param {Object} redis         - Instancia de Redis (@upstash/redis)
 * @param {string} cycleId       - ID del ciclo
 * @param {Object} cyclesManager - Módulo cycles-manager.js
 * @param {Object} positions     - Posiciones abiertas del invest-manager
 * @param {Object} investConfig  - Configuración del módulo de inversión
 * @param {Object} apiKeys       - Claves de APIs externas
 * @returns {Object} { iterationIndex, timestamp, prices, decisions, stats, toSell[] }
 */
async function executeIteration(redis, cycleId, cyclesManager, positions, investConfig, apiKeys = {}) {
  const cycle = await cyclesManager.loadCycle(redis, cycleId);
  if (!cycle) throw new Error(`Ciclo ${cycleId} no encontrado`);
  if (cycle.status === 'completed') throw new Error(`Ciclo ${cycleId} ya completado`);

  const now           = Date.now();
  const durationMs    = cycle.durationMs || 43200000;
  const iterations    = cycle.iterations || [];
  const iterIdx       = iterations.length; // 0-based: esta es la iteración N
  const totalIter     = getIterationCount(durationMs);
  const isLastIter    = now >= cycle.endTime || iterIdx >= totalIter - 1;

  // Construir symbolMap y lastKnown desde snapshot
  const symbolMap = {};
  const lastKnown = {};
  for (const asset of cycle.snapshot || []) {
    symbolMap[asset.id] = asset.symbol;
    lastKnown[asset.id] = { price: asset.current_price, timestamp: cycle.startTime };
  }
  // Añadir precios de iteraciones previas al lastKnown
  for (const prevIter of iterations) {
    for (const [id, info] of Object.entries(prevIter.prices || {})) {
      if (info.price) lastKnown[id] = { price: info.price, timestamp: prevIter.timestamp };
    }
  }

  const assetIds = (cycle.snapshot || []).map(a => a.id).filter(Boolean);

  // ── Obtener precios con fallback ─────────────────────────────────────────
  const { prices, failedIds, stats: fetchStats } = await fetchPricesWithFallback(
    assetIds, symbolMap, lastKnown, apiKeys
  );

  // ── Evaluar posiciones relevantes a este ciclo ───────────────────────────
  const cyclePositions = (positions || []).filter(
    p => p.status === 'open' && p.cycleId === cycleId
  );

  const decisions = {};
  const toSell    = [];

  for (const position of cyclePositions) {
    const priceInfo = prices.get(position.assetId);
    if (!priceInfo) {
      decisions[position.assetId] = {
        action:  'hold',
        reason:  'Sin precio disponible — manteniendo por precaución',
        urgency: 'low',
        pnlPct:  null,
        noPrice: true,
      };
      continue;
    }

    const decision = evaluateSellDecision(
      position, priceInfo.price, investConfig, iterIdx, totalIter
    );
    decisions[position.assetId] = { ...decision, priceSource: priceInfo.source };

    if (decision.action === 'sell') {
      toSell.push({ position, currentPrice: priceInfo.price, decision });
    }
  }

  // ── Construir objeto de iteración ────────────────────────────────────────
  const pricesObj = {};
  for (const [id, info] of prices.entries()) pricesObj[id] = info;

  const iterationRecord = {
    iterationIndex: iterIdx,
    iterationNumber: iterIdx + 1,
    timestamp:   now,
    isLast:      isLastIter,
    prices:      pricesObj,
    decisions,
    failedIds,
    fetchStats,
    assetsCount:  assetIds.length,
    fetchedCount: prices.size,
    staleCount:   fetchStats.staleCount || 0,
  };

  // ── Persistir iteración en el ciclo ─────────────────────────────────────
  cycle.iterations = [...iterations, iterationRecord];
  cycle.lastIterationAt = now;
  if (isLastIter) cycle.iterationsComplete = true;
  await cyclesManager.saveCycle(redis, cycle);

  return {
    cycleId,
    iterationIndex: iterIdx,
    iterationNumber: iterIdx + 1,
    totalIterations: totalIter,
    isLastIteration: isLastIter,
    timestamp:   now,
    assetsCount: assetIds.length,
    fetchedCount: prices.size,
    failedCount:  failedIds.length,
    staleCount:   fetchStats.staleCount || 0,
    priceSource:  fetchStats.source || 'none',
    decisions,
    toSell,
  };
}

// ─── Scheduler de iteraciones pendientes ─────────────────────────────────────

/**
 * Determina si un ciclo tiene una iteración pendiente de ejecutar ahora.
 * Devuelve true si ha pasado el tiempo esperado para la siguiente iteración.
 */
function hasIterationDue(cycle) {
  const now      = Date.now();
  const duration = cycle.durationMs || 43200000;
  const schedule = getIterationSchedule(cycle.startTime, duration);
  const done     = (cycle.iterations || []).length;

  if (done >= schedule.length) return false; // todas ejecutadas
  const nextDue = schedule[done];
  return now >= nextDue;
}

/**
 * Devuelve el timestamp de la próxima iteración pendiente.
 */
function getNextIterationTime(cycle) {
  const duration = cycle.durationMs || 43200000;
  const schedule = getIterationSchedule(cycle.startTime, duration);
  const done     = (cycle.iterations || []).length;
  if (done >= schedule.length) return null;
  return schedule[done];
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  fetchPricesWithFallback,
  evaluateSellDecision,
  executeIteration,
  getIterationInterval,
  getIterationCount,
  getIterationSchedule,
  hasIterationDue,
  getNextIterationTime,
};
