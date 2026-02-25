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

// ─── Lógica de selección de activos ──────────────────────────────────────────
// Prioriza activos por MAYOR PREDICCIÓN DE CRECIMIENTO (predictedChange DESC).
// Desempate: boostPower DESC.
//
// REGLA DE FILTRADO:
//   Si el activo YA viene clasificado como INVERTIBLE por el Algoritmo A,
//   confiamos en esa clasificación sin re-aplicar el umbral de BP del investConfig.
//   El Algoritmo A ya lo validó con su propio invertibleMinBoost.
//   Solo se aplica cfg.minPredictedChange como filtro adicional de trading.
//
//   Si el investConfig incluye _syncedMinBoostPower (inyectado por el endpoint),
//   se usa ese umbral sincronizado en lugar del default.
function selectInvestmentTargets(snapshot, investConfig, existingPositions = []) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };

  const candidates = snapshot
    .filter(a => {
      const cat  = getClassificationStr(a);
      const bp   = a.boostPower || 0;
      const pred = typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0);

      // El activo debe estar clasificado como INVERTIBLE por el Algoritmo A.
      if (cat !== 'INVERTIBLE') return false;

      // Solo aplicar filtro de BP si el activo NO tiene clasificación previa
      // (snapshot sin clasificar) o si el endpoint sincronizó el umbral.
      // Si viene con classification='INVERTIBLE', el Algoritmo A ya lo validó.
      const alreadyValidatedByAlgoA = typeof a.classification === 'string'
        ? a.classification.toUpperCase() === 'INVERTIBLE'
        : (a.classification?.category || '').toUpperCase() === 'INVERTIBLE';

      if (!alreadyValidatedByAlgoA) {
        // Snapshot sin clasificar — aplicar umbral propio del invest config
        if (bp < cfg.minBoostPower) return false;
      }
      // Si ya fue validado por Algo A, no re-filtrar por BP (evita la rotura)

      // Filtro de predicción mínima de trading (siempre aplica)
      if (pred < (cfg.minPredictedChange || 0)) return false;

      return true;
    })
    .sort((a, b) => {
      const diff = (b.predictedChange || 0) - (a.predictedChange || 0);
      if (Math.abs(diff) > 0.01) return diff;
      return (b.boostPower || 0) - (a.boostPower || 0);
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
      allCandidates: candidates,
    };
  }

  const openIds  = new Set((existingPositions || []).filter(p => p.status === 'open').map(p => p.assetId));
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
    boostPowerPct:   a.boostPowerPercent ?? Math.round((a.boostPower || 0) * 100),
    classification:  getClassificationStr(a),   // siempre string normalizado
    entryPrice:      a.current_price,
    predictedChange: a.predictedChange,
    capitalUSD:      parseFloat(perPosition.toFixed(2)),
    weight:          parseFloat((perPosition / cycleCapital * 100).toFixed(1)),
    rank:            i + 1,
    takeProfitPrice: parseFloat((a.current_price * (1 + cfg.takeProfitPct / 100)).toFixed(6)),
    stopLossPrice:   parseFloat((a.current_price * (1 - cfg.stopLossPct   / 100)).toFixed(6)),
    expectedFeeUSD:  parseFloat((perPosition * cfg.feePct / 100).toFixed(4)),
  }));

  const minPredLabel = cfg.minPredictedChange > 0 ? ` · pred ≥ ${cfg.minPredictedChange}%` : '';
  const topPred      = selected[0]?.predictedChange?.toFixed(1) ?? '?';

  return {
    selected,
    reason:        `${selected.length} activos por mayor potencial (+${topPred}% previsto)${minPredLabel}`,
    shouldInvest:  true,
    cycleCapital:  parseFloat(cycleCapital.toFixed(2)),
    allCandidates: candidates,
    sortedBy:      'predictedChange',
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
    units:           parseFloat((target.capitalUSD / target.entryPrice).toFixed(8)),
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
  const gross     = (exitPrice - p.entryPrice) * p.units;
  p.realizedPnL    = parseFloat((gross - p.totalFeesUSD).toFixed(4));
  p.realizedPnLPct = parseFloat((((exitPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(2));
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
