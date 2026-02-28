// api/investment-manager.js — Motor de inversión Crypto Detector v4
'use strict';

// ─── Defaults de configuración ────────────────────────────────────────────────
const DEFAULT_INVEST_CONFIG = {
  mode:               'simulated',
  exchange:           'binance',
  capitalTotal:       1000,
  capitalPerCycle:    0.30,
  maxPositions:       3,
  minBoostPower:      0.65,
  minPredictedChange: 0,            // subida mínima prevista (%) para incluir activo
  minCycleHours:      12,
  takeProfitPct:      10,
  stopLossPct:        5,
  maxHoldCycles:      3,
  stableCoin:         'USDT',
  diversification:    true,
  minSignals:         2,
  feePct:             0.10,
  apiCostPerCycle:    0.02,
};

// ─── Helper: normalizar classification (string u objeto) ─────────────────────
// classification puede llegar como string 'INVERTIBLE' o como objeto
// { category: 'INVERTIBLE', color: 'green', reason: '...' }
// Esta función siempre devuelve el string en mayúsculas.
function getClassificationStr(asset) {
  const c = asset.classification;
  if (!c) return 'RUIDOSO';
  if (typeof c === 'string') return c.toUpperCase();
  if (typeof c === 'object') return (c.category || c.label || 'RUIDOSO').toUpperCase();
  return 'RUIDOSO';
}

// ─── Helper: precio multi-campo ──────────────────────────────────────────────
// El snapshot puede usar distintos nombres según la fuente (monitor, pump detector, etc.)
// Esta función prueba todos los posibles y devuelve el primero válido.
function getPriceFromAsset(a) {
  const v = a.current_price ?? a.price ?? a.snapshotPrice ?? a.entryPrice
          ?? a.lastPrice    ?? a.usd   ?? a.usd_price     ?? null;
  const n = parseFloat(v);
  return (n > 0) ? n : null;
}

// ─── Lógica de selección de activos ──────────────────────────────────────────
// Prioriza activos por MAYOR PREDICCIÓN DE CRECIMIENTO (predictedChange DESC).
// Desempate: boostPower DESC.
//
// REGLA DE FILTRADO:
//   Si el activo YA viene clasificado como INVERTIBLE por el Algoritmo A,
//   confiamos en esa clasificación sin re-aplicar el umbral de BP del investConfig.
//   El Algoritmo A ya lo validó con su propio invertibleMinBoost.
//   Solo se aplica cfg.minPredictedChange como filtro adicional de trading.
//   Si el investConfig incluye _syncedMinBoostPower (inyectado por el endpoint),
//   se usa ese umbral sincronizado en lugar del default.

// ─── Helper: parsear predictedChange de forma robusta ─────────────────────────
// Acepta número, string numérico, null, undefined → siempre devuelve número.
function parsePred(val) {
  if (typeof val === 'number' && !isNaN(val)) return val;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function selectInvestmentTargets(snapshot, investConfig, existingPositions = []) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };

  // Pre-normalizar snapshot: classification → string, predictedChange → número.
  // Esto garantiza que el sort sea siempre numérico y correcto,
  // independientemente de cómo lleguen los datos del frontend.
  const normalized = snapshot.map(a => ({
    ...a,
    classification:  getClassificationStr(a),          // siempre string
    predictedChange: parsePred(a.predictedChange        // siempre número
      ?? a.predicted_change
      ?? a.basePrediction),
    boostPower:      parseFloat(a.boostPower ?? a.boost_power ?? 0) || 0,
  }));

  const candidates = normalized
    .filter(a => {
      // El activo debe estar clasificado como INVERTIBLE por el Algoritmo A.
      if (a.classification !== 'INVERTIBLE') return false;

      // Solo aplicar filtro de BP si el activo NO tenía clasificación previa
      // (snapshot sin clasificar). El Algoritmo A ya validó los INVERTIBLE
      // con su propio invertibleMinBoost — no re-filtrar por BP aquí.
      const originalCls = snapshot.find(s => (s.id || s.symbol) === (a.id || a.symbol))?.classification;
      const alreadyValidatedByAlgoA =
        typeof originalCls === 'string'
          ? originalCls.toUpperCase() === 'INVERTIBLE'
          : (originalCls?.category || '').toUpperCase() === 'INVERTIBLE';

      if (!alreadyValidatedByAlgoA) {
        if (a.boostPower < cfg.minBoostPower) return false;
      }

      // Filtro de predicción mínima de trading (siempre aplica)
      if (a.predictedChange < (cfg.minPredictedChange || 0)) return false;

      return true;
    })
    .sort((a, b) => {
      // Ordenar por predictedChange DESC (ya son números garantizados).
      // Desempate: boostPower DESC.
      const diff = b.predictedChange - a.predictedChange;
      if (Math.abs(diff) > 0.001) return diff;
      return b.boostPower - a.boostPower;
    });

  if (candidates.length < cfg.minSignals) {
    return {
      selected:      [],
      reason:        `Solo ${candidates.length} candidatos INVERTIBLE` +
                     ` (pred ≥ ${cfg.minPredictedChange || 0}%` +
                     (cfg._syncedMinBoostPower
                       ? `, BP sincronizado con Algo A ≥ ${(cfg._syncedMinBoostPower * 100).toFixed(0)}%`
                       : `, BP ≥ ${(cfg.minBoostPower * 100).toFixed(0)}%`) +
                     `) — mínimo requerido: ${cfg.minSignals}.`,
      shouldInvest:  false,
      // allCandidates ya normalizados (classification string, predictedChange número)
      allCandidates: candidates,
      // Conteo de activos con predictedChange > 0 para diagnóstico en UI
      snapshotHasPredictedChange: normalized.filter(a => a.predictedChange > 0).length,
    };
  }

  const openIds  = new Set((existingPositions || []).filter(p => p.status === 'open').map(p => p.assetId));
  // filtered mantiene el orden ya ordenado por predictedChange DESC
  const filtered = candidates.filter(a => !openIds.has(a.id));
  const selected = filtered.slice(0, cfg.maxPositions);

  if (selected.length === 0) {
    return {
      selected:      [],
      reason:        'Todos los candidatos tienen posición abierta.',
      shouldInvest:  false,
      allCandidates: candidates,
    };
  }

  const cycleCapital = cfg.capitalTotal * cfg.capitalPerCycle;
  const perPosition  = cfg.diversification
    ? cycleCapital / selected.length
    : cycleCapital;

  const targets = selected.map((a, i) => ({
    assetId:         a.id,
    symbol:          a.symbol,
    name:            a.name,
    boostPower:      a.boostPower,
    boostPowerPct:   a.boostPowerPercent ?? Math.round(a.boostPower * 100),
    classification:  a.classification,                // ya es string normalizado
    entryPrice:      getPriceFromAsset(a) || 0,
    predictedChange: a.predictedChange,               // ya es número normalizado
    capitalUSD:      parseFloat(perPosition.toFixed(2)),
    weight:          parseFloat((perPosition / cycleCapital * 100).toFixed(1)),
    rank:            i + 1,
    takeProfitPrice: parseFloat(((getPriceFromAsset(a) || 0) * (1 + cfg.takeProfitPct / 100)).toFixed(6)),
    stopLossPrice:   parseFloat(((getPriceFromAsset(a) || 0) * (1 - cfg.stopLossPct   / 100)).toFixed(6)),
    expectedFeeUSD:  parseFloat((perPosition * cfg.feePct / 100).toFixed(4)),
  }));

  const minPredLabel = cfg.minPredictedChange > 0 ? ` · pred ≥ ${cfg.minPredictedChange}%` : '';
  const topPred      = selected[0]?.predictedChange?.toFixed(1) ?? '?';

  return {
    selected:      targets,
    reason:        `${targets.length} activos por mayor potencial (+${topPred}% previsto)${minPredLabel}`,
    shouldInvest:  true,
    cycleCapital:  parseFloat(cycleCapital.toFixed(2)),
    // allCandidates normalizado: classification string + predictedChange número, orden por pred DESC
    allCandidates: candidates,
    sortedBy:      'predictedChange',
    snapshotHasPredictedChange: normalized.filter(a => a.predictedChange > 0).length,
  };
}

// ─── Capital disponible ───────────────────────────────────────────────────────
function calculateAvailableCapital(positions, capitalTotal) {
  const invested = (positions || [])
    .filter(p => p.status === 'open')
    .reduce((sum, p) => sum + (p.capitalUSD || 0), 0);
  return Math.max(0, capitalTotal - invested);
}

// ─── Crear posición ───────────────────────────────────────────────────────────
function createPosition(target, cycleId, investConfig) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const now = Date.now();
  const positionId = `pos_${now}_${target.assetId}`;
  return {
    id:              positionId,
    cycleId,
    assetId:         target.assetId,
    symbol:          target.symbol,
    name:            target.name,
    status:          'open',
    mode:            cfg.mode,
    exchange:        cfg.exchange,
    entryPrice:      target.entryPrice,
    currentPrice:    target.entryPrice,
    capitalUSD:      target.capitalUSD,
    units:           target.entryPrice > 0
                       ? parseFloat((target.capitalUSD / target.entryPrice).toFixed(8))
                       : 0,
    takeProfitPrice: target.takeProfitPrice,
    stopLossPrice:   target.stopLossPrice,
    predictedChange: target.predictedChange,
    boostPower:      target.boostPower,
    classification:  target.classification,
    openedAt:        new Date(now).toISOString(),
    closedAt:        null,
    holdCycles:      0,
    maxHoldCycles:   cfg.maxHoldCycles,
    unrealizedPnL:   0,
    unrealizedPnLPct: 0,
    realizedPnL:     null,
    realizedPnLPct:  null,
    entryFeeUSD:     target.expectedFeeUSD,
    exitFeeUSD:      null,
    totalFeesUSD:    target.expectedFeeUSD,
    apiCostUSD:      cfg.apiCostPerCycle,
    exchangeOrderId: cfg.mode === 'simulated' ? `sim_${positionId}` : null,
  };
}

// ─── Actualizar P&L ───────────────────────────────────────────────────────────
function updatePositionPnL(position, currentPrice) {
  const p = { ...position };
  p.currentPrice     = currentPrice;
  p.unrealizedPnL    = parseFloat(((currentPrice - p.entryPrice) * p.units - (p.totalFeesUSD || 0)).toFixed(4));
  p.unrealizedPnLPct = parseFloat((((currentPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(2));
  return p;
}

// ─── Cerrar posición ──────────────────────────────────────────────────────────
function closePosition(position, exitPrice, reason, investConfig) {
  const cfg  = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const p    = { ...position };
  const fee  = parseFloat((p.capitalUSD * cfg.feePct / 100).toFixed(4));
  p.status        = 'closed';
  p.closedAt      = new Date().toISOString();
  p.closeReason   = reason;
  p.exitPrice     = exitPrice;
  p.exitFeeUSD    = fee;
  p.totalFeesUSD  = parseFloat(((p.entryFeeUSD || 0) + fee).toFixed(4));
  const gross      = (exitPrice - p.entryPrice) * p.units;
  p.grossPnL       = parseFloat(gross.toFixed(4));                             // bruto antes de fees (para informes de desglose)
  p.realizedPnL    = parseFloat((gross - p.totalFeesUSD).toFixed(4));          // neto real (fees ya incluidas)
  p.realizedPnLPct = parseFloat((p.realizedPnL / p.capitalUSD * 100).toFixed(2)); // retorno neto sobre capital invertido
  return p;
}

// ─── Evaluar posición completa (decide sell/hold + calcula PnL) ──────────────
// closeReasonContext: 'manual' | 'round_close' fuerzan venta; cualquier otro
// valor (cycleId, 'evaluate', etc.) deja que evaluateCloseConditions decida.
function evaluatePosition(position, currentPrice, closeReasonContext, investConfig) {
  const cfg  = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const pct  = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  const fee  = parseFloat((position.capitalUSD * cfg.feePct / 100).toFixed(4));
  const gross = (currentPrice - position.entryPrice) * position.units;

  const forceClose = ['manual', 'round_close'].includes(closeReasonContext);
  const closeCheck  = evaluateCloseConditions(position, currentPrice, investConfig);
  const shouldClose = forceClose || closeCheck.shouldClose;
  const reason      = closeCheck.reason || closeReasonContext || 'evaluate';

  // Retroalimentación al algoritmo cuando se cierra con predicción registrada
  let algorithmFeedback = null;
  if (shouldClose && position.predictedChange != null) {
    const predictionCorrect = pct >= (position.predictedChange || 0);
    algorithmFeedback = {
      predictionCorrect,
      predictedChange: position.predictedChange,
      actualChange:    parseFloat(pct.toFixed(2)),
      errorMagnitude:  parseFloat(Math.abs(pct - (position.predictedChange || 0)).toFixed(2)),
      closeReason:     reason,
      suggestion:      predictionCorrect
        ? 'Predicción correcta — mantener parámetros'
        : `Revisar predicción: esperado +${position.predictedChange?.toFixed(1)}%, obtenido ${pct.toFixed(1)}%`,
    };
  }

  return {
    decision:          shouldClose ? 'sell' : 'hold',
    reason,
    pnlPct:            parseFloat(pct.toFixed(2)),
    pnlUSD:            parseFloat(gross.toFixed(4)),
    netPnL:            parseFloat((gross - fee - (position.entryFeeUSD || 0)).toFixed(4)),
    exitFeeUSD:        fee,
    algorithmFeedback,
  };
}

// ─── Resumen de ciclo/ronda ───────────────────────────────────────────────────
function buildCycleSummary(positions, cycleId, investConfig) {
  const cfg    = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const closed = positions.filter(p =>
    p.status === 'closed' && (!cycleId || p.cycleId === cycleId)
  );
  const open = positions.filter(p => p.status === 'open');

  const totalPnLUSD  = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
  const totalFees    = closed.reduce((s, p) => s + (p.totalFeesUSD || 0), 0);
  const totalInvested = closed.reduce((s, p) => s + (p.capitalUSD || 0), 0);

  return {
    totalPositions: closed.length,
    openPositions:  open.length,
    totalPnLUSD:    parseFloat(totalPnLUSD.toFixed(4)),
    totalFeesUSD:   parseFloat(totalFees.toFixed(4)),
    netReturnUSD:   parseFloat(totalPnLUSD.toFixed(4)),
    netReturnPct:   totalInvested > 0
      ? parseFloat((totalPnLUSD / totalInvested * 100).toFixed(2))
      : 0,
    available:      parseFloat(calculateAvailableCapital(positions, cfg.capitalTotal).toFixed(2)),
  };
}

// ─── Evaluar cierre (watchdog) ────────────────────────────────────────────────
function evaluateCloseConditions(position, currentPrice, investConfig) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const pct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  if (pct >= cfg.takeProfitPct)                         return { shouldClose: true, reason: 'take_profit' };
  if (pct <= -cfg.stopLossPct)                          return { shouldClose: true, reason: 'stop_loss'   };
  if ((position.holdCycles || 0) >= cfg.maxHoldCycles)  return { shouldClose: true, reason: 'max_hold'    };
  return { shouldClose: false };
}

module.exports = {
  DEFAULT_INVEST_CONFIG,
  getClassificationStr,
  selectInvestmentTargets,
  calculateAvailableCapital,
  createPosition,
  updatePositionPnL,
  closePosition,
  evaluateCloseConditions,
  evaluatePosition,
  buildCycleSummary,
};
