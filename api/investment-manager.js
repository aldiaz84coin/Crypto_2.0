// api/investment-manager.js — Motor de inversión Crypto Detector v4
'use strict';

// ─── Defaults de configuración ────────────────────────────────────────────────
const DEFAULT_INVEST_CONFIG = {
  mode:               'simulated',  // 'simulated' | 'real'
  exchange:           'binance',    // 'binance' | 'coinbase'
  capitalTotal:       1000,         // USD disponible total para invertir
  capitalPerCycle:    0.30,         // fracción del capital que se mueve por ciclo (30%)
  maxPositions:       3,            // N recomendaciones máximas por ciclo
  minBoostPower:      0.65,         // solo INVERTIBLE con BP >= este umbral
  minCycleHours:      12,           // solo ciclos >= 12h para operar
  takeProfitPct:      10,           // vender si ganancia >= 10%
  stopLossPct:        5,            // vender si pérdida >= 5%
  maxHoldCycles:      3,            // vender tras N ciclos si no hay ganancia
  stableCoin:         'USDT',       // moneda de refugio cuando no hay señales
  diversification:    true,         // repartir capital entre las N posiciones
  minSignals:         2,            // mínimo de INVERTIBLES para operar (si hay menos → no invertir)
  feePct:             0.10,         // comisión de exchange por operación (%)
  apiCostPerCycle:    0.02,         // coste estimado de APIs por ciclo (USD)
};

// ─── Lógica de selección de activos ──────────────────────────────────────────
/**
 * Selecciona los N mejores activos en los que invertir dado un snapshot de ciclo.
 * Criterios: solo INVERTIBLE, boostPower >= minBoostPower, ordenados por BP desc.
 * Si hay menos de minSignals candidatos → devuelve [] (no invertir en este ciclo).
 */
function selectInvestmentTargets(snapshot, investConfig, existingPositions = []) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };

  // Candidatos: solo INVERTIBLE con BP suficiente
  const candidates = snapshot
    .filter(a =>
      a.classification === 'INVERTIBLE' &&
      (a.boostPower || 0) >= cfg.minBoostPower &&
      (a.predictedChange || 0) > 0
    )
    .sort((a, b) => (b.boostPower || 0) - (a.boostPower || 0));

  // Sin señales suficientes → no invertir
  if (candidates.length < cfg.minSignals) {
    return {
      selected:    [],
      reason:      `Solo ${candidates.length} candidatos INVERTIBLE (mínimo: ${cfg.minSignals}). Capital a USDT.`,
      shouldInvest: false
    };
  }

  // Tomar los N mejores, excluyendo activos ya en posición abierta
  const openIds  = new Set((existingPositions || []).filter(p => p.status === 'open').map(p => p.assetId));
  const filtered = candidates.filter(a => !openIds.has(a.id));
  const selected = filtered.slice(0, cfg.maxPositions);

  if (selected.length === 0) {
    return { selected: [], reason: 'Todos los candidatos tienen posición abierta.', shouldInvest: false };
  }

  // Calcular capital a asignar por posición
  const cycleCapital = cfg.capitalTotal * cfg.capitalPerCycle;
  const perPosition  = cfg.diversification
    ? cycleCapital / selected.length
    : cycleCapital;  // toda la apuesta en el mejor si no hay diversificación

  const targets = selected.map((a, i) => ({
    assetId:        a.id,
    symbol:         a.symbol,
    name:           a.name,
    boostPower:     a.boostPower,
    boostPowerPct:  a.boostPowerPercent,
    classification: a.classification,
    entryPrice:     a.current_price,
    predictedChange: a.predictedChange,
    capitalUSD:     parseFloat(perPosition.toFixed(2)),
    weight:         parseFloat((perPosition / cycleCapital * 100).toFixed(1)),  // % del capital del ciclo
    rank:           i + 1,
    takeProfitPrice: parseFloat((a.current_price * (1 + cfg.takeProfitPct / 100)).toFixed(6)),
    stopLossPrice:   parseFloat((a.current_price * (1 - cfg.stopLossPct   / 100)).toFixed(6)),
    expectedFeeUSD:  parseFloat((perPosition * cfg.feePct / 100).toFixed(4))
  }));

  return {
    selected:     targets,
    reason:       `${selected.length} activos seleccionados con BP ≥ ${(cfg.minBoostPower*100).toFixed(0)}%`,
    shouldInvest: true,
    cycleCapital: parseFloat(cycleCapital.toFixed(2))
  };
}

// ─── Crear posición ───────────────────────────────────────────────────────────
function createPosition(target, cycleId, investConfig) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const now = Date.now();
  const positionId = `pos_${now}_${target.assetId}`;
  return {
    id:              positionId,
    cycleId,                          // ciclo que abrió la posición
    assetId:         target.assetId,
    symbol:          target.symbol,
    name:            target.name,
    status:          'open',          // open | closed | holding
    mode:            cfg.mode,        // simulated | real
    exchange:        cfg.exchange,
    entryPrice:      target.entryPrice,
    currentPrice:    target.entryPrice,  // se actualiza con el precio actual
    capitalUSD:      target.capitalUSD,
    units:           parseFloat((target.capitalUSD / target.entryPrice).toFixed(8)),
    takeProfitPrice: target.takeProfitPrice,
    stopLossPrice:   target.stopLossPrice,
    predictedChange: target.predictedChange,
    boostPower:      target.boostPower,
    openedAt:        new Date(now).toISOString(),
    closedAt:        null,
    holdCycles:      0,              // cuántos ciclos lleva abierta
    maxHoldCycles:   cfg.maxHoldCycles,
    // P&L
    unrealizedPnL:   0,
    unrealizedPnLPct: 0,
    realizedPnL:     null,
    realizedPnLPct:  null,
    // Costes
    entryFeeUSD:     target.expectedFeeUSD,
    exitFeeUSD:      null,
    totalFeesUSD:    target.expectedFeeUSD,
    apiCostUSD:      cfg.apiCostPerCycle,
    // Orden de exchange (simulada o real)
    exchangeOrderId: cfg.mode === 'simulated' ? `SIM_${positionId}` : null,
    closeReason:     null,           // take_profit | stop_loss | max_cycles | manual | weak_signal
    // Retroalimentación al algoritmo
    algorithmFeedback: null
  };
}

// ─── Evaluar posición al completar un ciclo ───────────────────────────────────
function evaluatePosition(position, currentPrice, cycleId, investConfig) {
  const cfg     = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const entry   = position.entryPrice;
  const pnlPct  = ((currentPrice - entry) / entry) * 100;
  const pnlUSD  = (currentPrice - entry) * position.units;
  const exitFee = position.capitalUSD * cfg.feePct / 100;
  const netPnL  = pnlUSD - exitFee;

  position.currentPrice      = currentPrice;
  position.unrealizedPnL     = parseFloat(pnlUSD.toFixed(4));
  position.unrealizedPnLPct  = parseFloat(pnlPct.toFixed(2));
  position.holdCycles        += 1;

  let decision = 'hold';
  let reason   = '';

  const predictedTarget = (position.predictedChange || 0);
  const hitPredictionTarget = predictedTarget > 0
    && pnlPct > 0
    && pnlPct >= predictedTarget
    && pnlPct < cfg.takeProfitPct; // solo si NO alcanzó ya el TP configurado

  if (pnlPct >= cfg.takeProfitPct) {
    decision = 'sell';
    reason   = `take_profit: +${pnlPct.toFixed(2)}% ≥ umbral ${cfg.takeProfitPct}%`;
  } else if (hitPredictionTarget) {
    decision = 'sell';
    reason   = `prediction_target: +${pnlPct.toFixed(2)}% ≥ predicción +${predictedTarget.toFixed(2)}%`;
  } else if (pnlPct <= -cfg.stopLossPct) {
    decision = 'sell';
    reason   = `stop_loss: ${pnlPct.toFixed(2)}% ≤ −${cfg.stopLossPct}%`;
  } else if (position.holdCycles >= cfg.maxHoldCycles) {
    if (pnlPct > 0) {
      decision = 'sell';
      reason   = `max_cycles_profit: ${position.holdCycles} ciclos — +${pnlPct.toFixed(2)}%`;
    } else {
      decision = 'sell';
      reason   = `max_cycles_loss: ${position.holdCycles} ciclos — ${pnlPct.toFixed(2)}%`;
    }
  } else {
    decision = 'hold';
    reason   = `hold: ${pnlPct.toFixed(2)}% en ciclo ${position.holdCycles}/${cfg.maxHoldCycles}`;
  }

  // Retroalimentación al algoritmo si la predicción fue incorrecta
  let algorithmFeedback = null;
  if (decision === 'sell') {
    const predictedOk = (position.predictedChange || 0) > 0 && pnlPct > 0;
    const errorMag    = Math.abs(pnlPct - (position.predictedChange || 0));
    algorithmFeedback = {
      predictionCorrect: predictedOk,
      predictedChange:   position.predictedChange,
      actualChange:      parseFloat(pnlPct.toFixed(2)),
      errorMagnitude:    parseFloat(errorMag.toFixed(2)),
      closeReason:       reason.split(':')[0],
      suggestion:        errorMag > 15
        ? 'Revisar pesos del algoritmo para este nivel de capitalización'
        : predictedOk ? null : 'Ajustar umbral de boostPower mínimo'
    };
  }

  return {
    decision,
    reason,
    pnlPct:            parseFloat(pnlPct.toFixed(2)),
    pnlUSD:            parseFloat(pnlUSD.toFixed(4)),
    netPnL:            parseFloat(netPnL.toFixed(4)),
    exitFeeUSD:        parseFloat(exitFee.toFixed(4)),
    algorithmFeedback
  };
}

// ─── Cerrar posición ──────────────────────────────────────────────────────────
// exitPrice: precio real de salida (requerido para calcular PnL correcto en reportes)
function closePosition(position, evaluation, exitPrice) {
  const now = Date.now();
  const resolvedExitPrice  = exitPrice || position.currentPrice || position.entryPrice;
  position.status          = 'closed';
  position.closedAt        = new Date(now).toISOString();
  position.currentPrice    = resolvedExitPrice;   // precio real de salida (antes era no-op)
  position.exitPrice       = resolvedExitPrice;   // campo explícito para reportes y UI
  position.realizedPnL     = evaluation.pnlUSD;
  position.realizedPnLPct  = evaluation.pnlPct;
  position.exitFeeUSD      = evaluation.exitFeeUSD;
  position.totalFeesUSD    = (position.entryFeeUSD || 0) + evaluation.exitFeeUSD + (position.apiCostUSD || 0);
  position.closeReason     = evaluation.reason.split(':')[0];
  position.algorithmFeedback = evaluation.algorithmFeedback;
  return position;
}

// ─── Resumen de ciclo de inversión ────────────────────────────────────────────
function buildCycleSummary(positions, cycleId, investConfig) {
  const cfg     = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const closed  = positions.filter(p => p.status === 'closed' && p.cycleId === cycleId);
  const open    = positions.filter(p => p.status === 'open');

  const totalInvested  = closed.reduce((s, p) => s + p.capitalUSD, 0);
  const totalPnL       = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
  const totalFees      = closed.reduce((s, p) => s + (p.totalFeesUSD || 0), 0);
  const netReturn      = totalPnL - totalFees;
  const pnlPct         = totalInvested > 0 ? (netReturn / totalInvested) * 100 : 0;
  const wins           = closed.filter(p => (p.realizedPnL || 0) > 0).length;
  const apiCost        = cfg.apiCostPerCycle * (closed.length + open.length);

  return {
    cycleId,
    closedPositions:  closed.length,
    openPositions:    open.length,
    totalInvestedUSD: parseFloat(totalInvested.toFixed(2)),
    totalPnLUSD:      parseFloat(totalPnL.toFixed(4)),
    totalFeesUSD:     parseFloat(totalFees.toFixed(4)),
    apiCostUSD:       parseFloat(apiCost.toFixed(4)),
    netReturnUSD:     parseFloat(netReturn.toFixed(4)),
    netReturnPct:     parseFloat(pnlPct.toFixed(2)),
    winRate:          closed.length > 0 ? parseFloat((wins/closed.length*100).toFixed(1)) : null,
    mode:             cfg.mode,
    exchange:         cfg.exchange,
    positions:        closed
  };
}

// ─── Calcular capital disponible ──────────────────────────────────────────────
function calculateAvailableCapital(positions, totalCapital) {
  const inOpenPositions = positions
    .filter(p => p.status === 'open')
    .reduce((s, p) => s + p.capitalUSD, 0);
  return Math.max(0, totalCapital - inOpenPositions);
}

module.exports = {
  DEFAULT_INVEST_CONFIG,
  selectInvestmentTargets,
  createPosition,
  evaluatePosition,
  closePosition,
  buildCycleSummary,
  calculateAvailableCapital
};
