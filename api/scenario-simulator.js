// scenario-simulator.js — Motor de simulación de escenarios alternativos
// v1.0
//
// Para un ciclo COMPLETADO, simula cómo habría ido con:
//   A) Diferentes duraciones: 6h, 12h, 24h, 30h... hasta la duración real
//   B) Diferentes configuraciones de compraventa: conservador / medio / agresivo
//
// Fuentes de precio disponibles (en orden de precisión):
//   1. cycle.iterations[].prices  → precios reales en cada iteración (más preciso)
//   2. Interpolación lineal entre snapshotPrice y endPrice (fallback)
//
// IMPORTANTE: No usamos proporciones lineales entre duraciones.
// El movimiento de precio en el ciclo real se usa como "ground truth"
// y se interpola/extrapola según los datos disponibles.
'use strict';

const { computeTemporalScale } = require('./temporal-prediction');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIONES CANDIDATAS DEL ALGORITMO DE TRADING
// ═══════════════════════════════════════════════════════════════════════════════

const TRADING_CONFIGS = {
  conservative: {
    label:         'Conservador',
    emoji:         '🛡️',
    description:   'Protección máxima del capital. TP bajo, SL ajustado, pocas iteraciones.',
    takeProfitPct: 5,
    stopLossPct:   3,
    maxHoldCycles: 2,
    color:         '#22c55e', // green
  },
  moderate: {
    label:         'Moderado',
    emoji:         '⚖️',
    description:   'Equilibrio riesgo/recompensa. Parámetros típicos de mercado.',
    takeProfitPct: 10,
    stopLossPct:   5,
    maxHoldCycles: 3,
    color:         '#f59e0b', // yellow
  },
  aggressive: {
    label:         'Agresivo',
    emoji:         '🚀',
    description:   'Maximizar rendimiento. TP alto, SL amplio, muchas iteraciones.',
    takeProfitPct: 18,
    stopLossPct:   9,
    maxHoldCycles: 6,
    color:         '#ef4444', // red
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// RECONSTRUCCIÓN DEL PATH DE PRECIO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reconstruye el path de precio para un activo a partir de las iteraciones del ciclo.
 * Si no hay iteraciones suficientes, usa interpolación entre snapshot y precio final.
 *
 * @param {Object} cycle       - Ciclo completo
 * @param {string} assetId     - ID del activo
 * @returns {Array}            - [{ timestamp, price, source }] cronológico
 */
function buildPricePath(cycle, assetId) {
  const snapAsset = (cycle.snapshot || []).find(a => a.id === assetId);
  const result    = (cycle.results || []).find(r => r.id === assetId);

  if (!snapAsset) return [];

  const startPrice = snapAsset.current_price || snapAsset.price || 0;
  const endPrice   = result?.currentPrice || result?.actualPrice || startPrice;
  const startTime  = cycle.startTime;
  const endTime    = cycle.endTime || (cycle.startTime + (cycle.durationMs || 43200000));

  const path = [{ timestamp: startTime, price: startPrice, source: 'snapshot' }];

  // Intentar usar datos reales de iteraciones
  const iterations = cycle.iterations || [];
  for (const iter of iterations) {
    const priceInfo = iter.prices?.[assetId];
    if (priceInfo?.price && priceInfo.price > 0) {
      path.push({
        timestamp: iter.timestamp,
        price:     priceInfo.price,
        source:    priceInfo.source || 'iteration',
      });
    }
  }

  // Si solo tenemos snapshot + iteraciones pero no el precio final de cierre
  if (endPrice && endPrice !== startPrice) {
    // Solo añadir si el último punto no es ya el endTime
    const lastPoint = path[path.length - 1];
    if (lastPoint.timestamp < endTime - 60000) { // margen de 1 minuto
      path.push({ timestamp: endTime, price: endPrice, source: 'result' });
    }
  }

  return path.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Interpola el precio de un activo en un timestamp específico
 * usando su path de precio (interpolación lineal entre los puntos más cercanos).
 */
function interpolatePrice(pricePath, targetTimestamp) {
  if (!pricePath || pricePath.length === 0) return null;
  if (pricePath.length === 1) return pricePath[0].price;

  // Fuera del rango izquierdo
  if (targetTimestamp <= pricePath[0].timestamp) return pricePath[0].price;

  // Fuera del rango derecho
  if (targetTimestamp >= pricePath[pricePath.length - 1].timestamp) {
    return pricePath[pricePath.length - 1].price;
  }

  // Buscar los dos puntos que rodean targetTimestamp
  for (let i = 0; i < pricePath.length - 1; i++) {
    const p1 = pricePath[i];
    const p2 = pricePath[i + 1];

    if (targetTimestamp >= p1.timestamp && targetTimestamp <= p2.timestamp) {
      const t = (targetTimestamp - p1.timestamp) / (p2.timestamp - p1.timestamp);
      return p1.price + t * (p2.price - p1.price);
    }
  }

  return pricePath[pricePath.length - 1].price;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULACIÓN DE ESCENARIOS POR DURACIÓN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simula cómo habría ido el ciclo si hubiera durado `targetDurationMs`.
 * Usa los precios reales de las iteraciones cuando están disponibles.
 *
 * @param {Object} cycle             - Ciclo completado
 * @param {number} targetDurationMs  - Duración alternativa a simular
 * @returns {Object} scenarioResult
 */
function simulateDuration(cycle, targetDurationMs) {
  const actualDurationMs = cycle.durationMs || 43200000;
  const mode             = cycle.mode || 'normal';
  const startTime        = cycle.startTime;
  const targetEndTime    = startTime + targetDurationMs;

  // No simular duraciones superiores a la real (no tenemos datos futuros)
  if (targetDurationMs > actualDurationMs * 1.05) {
    return {
      durationMs:     targetDurationMs,
      durationH:      targetDurationMs / 3600000,
      status:         'beyond_actual',
      reason:         'Duración mayor a la real — sin datos disponibles',
      results:        [],
      metrics:        null,
    };
  }

  const validResults = (cycle.results || []).filter(
    r => !(cycle.excludedResults || []).includes(r.id)
  );

  const simulatedResults = validResults.map(result => {
    const snapAsset    = (cycle.snapshot || []).find(a => a.id === result.id);
    if (!snapAsset) return null;

    const pricePath    = buildPricePath(cycle, result.id);
    const startPrice   = snapAsset.current_price || snapAsset.price || 0;
    const simEndPrice  = interpolatePrice(pricePath, targetEndTime);

    if (!simEndPrice || startPrice === 0) return null;

    const actualChangeSim = ((simEndPrice - startPrice) / startPrice) * 100;

    // La predicción para esta duración alternativa usa el modelo temporal no-lineal
    const basePred     = parseFloat(snapAsset.basePrediction || result.predictedChange || 0);
    const scaleFactor  = computeTemporalScale(targetDurationMs, result.classification, mode);
    const predictedSim = basePred * scaleFactor;

    // Evaluar si la predicción habría sido correcta con la duración alternativa
    const sameDirection = (predictedSim >= 0 && actualChangeSim >= 0) ||
                          (predictedSim < 0 && actualChangeSim < 0);
    const magnitudeDiff = Math.abs(predictedSim - actualChangeSim);
    const correctSim    = predictedSim === 0
      ? Math.abs(actualChangeSim) < 5 // RUIDOSO: correcto si movimiento < 5%
      : sameDirection && magnitudeDiff < 15;

    return {
      id:              result.id,
      symbol:          result.symbol,
      classification:  result.classification,
      startPrice,
      simEndPrice:     parseFloat(simEndPrice.toFixed(6)),
      actualChangeSim: parseFloat(actualChangeSim.toFixed(2)),
      predictedSim:    parseFloat(predictedSim.toFixed(2)),
      magnitudeDiff:   parseFloat(magnitudeDiff.toFixed(2)),
      correct:         correctSim,
      pricePath:       pricePath.length > 2 ? 'real_iterations' : 'interpolated',
    };
  }).filter(Boolean);

  // Métricas del escenario
  const metrics = buildScenarioMetrics(simulatedResults);
  const dataQuality = (cycle.iterations || []).length >= 2 ? 'high' : 'estimated';

  return {
    durationMs:   targetDurationMs,
    durationH:    targetDurationMs / 3600000,
    label:        formatDuration(targetDurationMs),
    status:       'simulated',
    dataQuality,  // 'high' si hay iteraciones reales, 'estimated' si interpolado
    isActual:     Math.abs(targetDurationMs - actualDurationMs) < 600000, // ±10min
    results:      simulatedResults,
    metrics,
  };
}

/**
 * Genera todos los escenarios de duración en bloques de 6h hasta la duración real.
 */
function simulateAllDurations(cycle) {
  const actualDurationMs = cycle.durationMs || 43200000;
  const actualDurationH  = actualDurationMs / 3600000;

  // Bloques de 6h: 6, 12, 18, 24... hasta la duración real
  const windowsH = [];
  for (let h = 6; h <= Math.ceil(actualDurationH); h += 6) {
    windowsH.push(Math.min(h, actualDurationH));
  }

  // Asegurar que la duración real siempre esté incluida
  if (!windowsH.includes(actualDurationH)) {
    windowsH.push(actualDurationH);
  }

  // Eliminar duplicados y ordenar
  const uniqueWindows = [...new Set(windowsH)].sort((a, b) => a - b);

  return uniqueWindows.map(h => simulateDuration(cycle, h * 3600000));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULACIÓN DE ESCENARIOS POR CONFIGURACIÓN DE TRADING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simula el comportamiento del algoritmo de trading con una configuración alternativa.
 * Recorre el path de precios de cada activo y aplica la lógica TP/SL/maxHold.
 *
 * @param {Object} cycle            - Ciclo completado
 * @param {Object} tradingConfig    - { takeProfitPct, stopLossPct, maxHoldCycles }
 * @param {string} configLabel      - Nombre para identificar este escenario
 * @returns {Object} tradingScenario
 */
function simulateTradingConfig(cycle, tradingConfig, configLabel = 'custom') {
  const { takeProfitPct, stopLossPct, maxHoldCycles } = tradingConfig;
  const durationMs   = cycle.durationMs || 43200000;
  const iterInterval = durationMs / Math.max(maxHoldCycles, 1);

  const validResults = (cycle.results || []).filter(r => {
    if ((cycle.excludedResults || []).includes(r.id)) return false;
    // Solo simular posiciones que habrían sido abiertas (clasificación INVERTIBLE o APALANCADO)
    return ['INVERTIBLE', 'APALANCADO'].includes(r.classification);
  });

  const positions = validResults.map(result => {
    const snapAsset  = (cycle.snapshot || []).find(a => a.id === result.id);
    if (!snapAsset) return null;

    const pricePath   = buildPricePath(cycle, result.id);
    const entryPrice  = pricePath[0]?.price || snapAsset.current_price || 0;
    if (entryPrice === 0) return null;

    const tpPrice = entryPrice * (1 + takeProfitPct / 100);
    const slPrice = entryPrice * (1 - stopLossPct / 100);

    let exitPrice    = null;
    let exitReason   = 'max_hold'; // default: terminó el ciclo sin TP/SL
    let exitTime     = cycle.endTime || (cycle.startTime + durationMs);
    let holdCycles   = 0;
    let exitPnlPct   = null;

    // Simular iteraciones según maxHoldCycles
    for (let i = 1; i <= maxHoldCycles; i++) {
      const iterTime   = cycle.startTime + i * iterInterval;
      const iterPrice  = interpolatePrice(pricePath, iterTime);

      if (!iterPrice) continue;
      holdCycles = i;

      if (iterPrice >= tpPrice) {
        exitPrice  = iterPrice;
        exitReason = 'take_profit';
        exitTime   = iterTime;
        break;
      }
      if (iterPrice <= slPrice) {
        exitPrice  = iterPrice;
        exitReason = 'stop_loss';
        exitTime   = iterTime;
        break;
      }

      // Última iteración: cierre por tiempo
      if (i === maxHoldCycles) {
        exitPrice  = iterPrice;
        exitReason = 'max_hold';
        exitTime   = iterTime;
      }
    }

    // Si no se determinó precio de salida (path muy corto), usar precio final
    if (!exitPrice) {
      exitPrice  = pricePath[pricePath.length - 1]?.price || entryPrice;
      exitReason = 'max_hold';
    }

    exitPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    return {
      id:           result.id,
      symbol:       result.symbol,
      classification: result.classification,
      entryPrice,
      exitPrice:    parseFloat(exitPrice.toFixed(6)),
      tpPrice:      parseFloat(tpPrice.toFixed(6)),
      slPrice:      parseFloat(slPrice.toFixed(6)),
      exitReason,
      exitTime,
      holdCycles,
      pnlPct:       parseFloat(exitPnlPct.toFixed(2)),
      won:          exitPnlPct > 0,
    };
  }).filter(Boolean);

  // Agregados del escenario
  const totalPnl     = positions.reduce((s, p) => s + p.pnlPct, 0);
  const avgPnl       = positions.length > 0 ? totalPnl / positions.length : 0;
  const wins         = positions.filter(p => p.won);
  const losses       = positions.filter(p => !p.won);
  const tpHits       = positions.filter(p => p.exitReason === 'take_profit');
  const slHits       = positions.filter(p => p.exitReason === 'stop_loss');
  const maxHoldHits  = positions.filter(p => p.exitReason === 'max_hold');
  const winRate      = positions.length > 0 ? (wins.length / positions.length) * 100 : 0;
  const avgWinPnl    = wins.length > 0 ? wins.reduce((s, p) => s + p.pnlPct, 0) / wins.length : 0;
  const avgLossPnl   = losses.length > 0 ? losses.reduce((s, p) => s + p.pnlPct, 0) / losses.length : 0;

  // Score compuesto para comparar escenarios (mayor = mejor)
  // Combina: winRate (peso 0.4) + avgPnl normalizado (peso 0.4) + consistencia (peso 0.2)
  const consistencyBonus = slHits.length === 0 ? 1.1 : (1 - slHits.length / Math.max(positions.length, 1) * 0.3);
  const compositeScore   = (
    (winRate / 100) * 0.4 +
    Math.min(Math.max(avgPnl / 20, -1), 1) * 0.5 * 0.4 + 0.2 +
    consistencyBonus * 0.2
  ) * 100;

  return {
    configKey:    configLabel,
    config:       tradingConfig,
    label:        TRADING_CONFIGS[configLabel]?.label || configLabel,
    emoji:        TRADING_CONFIGS[configLabel]?.emoji || '📊',
    description:  TRADING_CONFIGS[configLabel]?.description || '',
    color:        TRADING_CONFIGS[configLabel]?.color || '#6b7280',
    simulated:    true,
    positions,
    summary: {
      totalPositions: positions.length,
      wins:           wins.length,
      losses:         losses.length,
      winRate:        parseFloat(winRate.toFixed(1)),
      avgPnlPct:      parseFloat(avgPnl.toFixed(2)),
      avgWinPnl:      parseFloat(avgWinPnl.toFixed(2)),
      avgLossPnl:     parseFloat(avgLossPnl.toFixed(2)),
      tpHits:         tpHits.length,
      slHits:         slHits.length,
      maxHoldHits:    maxHoldHits.length,
      compositeScore: parseFloat(compositeScore.toFixed(1)),
    },
  };
}

/**
 * Simula los 3 perfiles de trading (conservador, moderado, agresivo) + el actual.
 *
 * @param {Object} cycle        - Ciclo completado
 * @param {Object} actualConfig - Config actual del sistema { takeProfitPct, stopLossPct, maxHoldCycles }
 * @returns {Object} { conservative, moderate, aggressive, actual, bestConfig }
 */
function simulateAllTradingConfigs(cycle, actualConfig = {}) {
  const results = {};

  // 3 perfiles predefinidos
  for (const [key, config] of Object.entries(TRADING_CONFIGS)) {
    results[key] = simulateTradingConfig(cycle, config, key);
  }

  // Config actual del sistema (si se proporciona)
  if (actualConfig && Object.keys(actualConfig).length > 0) {
    results.actual = simulateTradingConfig(cycle, {
      takeProfitPct: actualConfig.takeProfitPct  || 10,
      stopLossPct:   actualConfig.stopLossPct    || 5,
      maxHoldCycles: actualConfig.maxHoldCycles  || 3,
      label:         'Actual',
      emoji:         '📍',
      description:   'Configuración actualmente en uso',
    }, 'actual');
    results.actual.label = 'Actual (en uso)';
    results.actual.emoji = '📍';
    results.actual.color = '#8b5cf6';
  }

  // Determinar el mejor escenario por compositeScore
  const ranked = Object.entries(results)
    .map(([k, v]) => ({ key: k, score: v.summary?.compositeScore || 0 }))
    .sort((a, b) => b.score - a.score);

  const bestKey = ranked[0]?.key;

  return {
    ...results,
    ranking:   ranked,
    bestConfig: bestKey,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANÁLISIS COMPLETO DE ESCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Genera el análisis completo de escenarios para un ciclo.
 * Combina duración alternativa + configuración de trading.
 *
 * @param {Object} cycle         - Ciclo completado con iterations
 * @param {Object} actualConfig  - Configuración actual del módulo de inversión
 * @returns {Object} Full scenario analysis
 */
function generateScenarioAnalysis(cycle, actualConfig = {}) {
  const startTs = Date.now();

  const durationScenarios = simulateAllDurations(cycle);
  const tradingScenarios  = simulateAllTradingConfigs(cycle, actualConfig);

  // Mejor duración = la que maximiza el accuracy del clasificador
  const bestDuration = durationScenarios
    .filter(s => s.status === 'simulated')
    .sort((a, b) => (b.metrics?.successRate || 0) - (a.metrics?.successRate || 0))[0];

  // Resumen para alimentar el algoritmo de mejora
  const optimizationFeed = {
    bestDurationMs:       bestDuration?.durationMs,
    bestDurationH:        bestDuration?.durationH,
    bestDurationAccuracy: bestDuration?.metrics?.successRate,
    bestTradingConfig:    tradingScenarios.bestConfig,
    bestTradingScore:     tradingScenarios[tradingScenarios.bestConfig]?.summary?.compositeScore,
    recommendedParams:    tradingScenarios[tradingScenarios.bestConfig]?.config || null,
    generatedAt:          new Date().toISOString(),
    computedInMs:         Date.now() - startTs,
  };

  return {
    cycleId:          cycle.id,
    actualDurationMs: cycle.durationMs || 43200000,
    mode:             cycle.mode || 'normal',
    dataQuality: {
      hasIterations:   (cycle.iterations || []).length > 0,
      iterationCount:  (cycle.iterations || []).length,
      interpolatedPct: 100 - Math.min(100, ((cycle.iterations || []).length / Math.max(1, (cycle.durationMs || 43200000) / 3600000)) * 100),
    },
    durationScenarios,
    tradingScenarios,
    optimizationFeed,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildScenarioMetrics(results) {
  if (!results || results.length === 0) return null;
  const correct = results.filter(r => r.correct).length;

  const byClass = {};
  for (const r of results) {
    const c = r.classification || 'RUIDOSO';
    if (!byClass[c]) byClass[c] = { total: 0, correct: 0 };
    byClass[c].total++;
    if (r.correct) byClass[c].correct++;
  }

  const classMetrics = {};
  for (const [c, data] of Object.entries(byClass)) {
    classMetrics[c] = {
      total:       data.total,
      correct:     data.correct,
      successRate: parseFloat((data.correct / data.total * 100).toFixed(1)),
    };
  }

  return {
    total:       results.length,
    correct,
    successRate: parseFloat((correct / results.length * 100).toFixed(1)),
    byClass:     classMetrics,
  };
}

function formatDuration(ms) {
  const h = ms / 3600000;
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  generateScenarioAnalysis,
  simulateDuration,
  simulateAllDurations,
  simulateTradingConfig,
  simulateAllTradingConfigs,
  buildPricePath,
  interpolatePrice,
  TRADING_CONFIGS,
};
