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
  minPredictedChange: 0,            // subida mínima prevista (%) para incluir el activo
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
 * Selecciona los N mejores activos priorizando MAYOR PREDICCIÓN DE CRECIMIENTO.
 * Orden de prioridad: predictedChange DESC (primero los de mayor subida prevista).
 * Filtros: solo INVERTIBLE, boostPower >= minBoostPower, predictedChange >= minPredictedChange.
 * Si hay menos de minSignals candidatos → devuelve [] (no invertir en este ciclo).
 */
function selectInvestmentTargets(snapshot, investConfig, existingPositions = []) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };

  // ── Candidatos: INVERTIBLE + umbral BP + umbral predicción mínima ─────────
  const candidates = snapshot
    .filter(a =>
      a.classification === 'INVERTIBLE' &&
      (a.boostPower || 0) >= cfg.minBoostPower &&
      (a.predictedChange || 0) >= (cfg.minPredictedChange || 0)
    )
    // PRIORIDAD: mayor predicción de crecimiento primero
    // Desempate: mayor boostPower cuando predicciones son iguales
    .sort((a, b) => {
      const predDiff = (b.predictedChange || 0) - (a.predictedChange || 0);
      if (Math.abs(predDiff) > 0.01) return predDiff;
      return (b.boostPower || 0) - (a.boostPower || 0);
    });

  // Sin señales suficientes → no invertir
  if (candidates.length < cfg.minSignals) {
    return {
      selected:     [],
      reason:       `Solo ${candidates.length} candidatos INVERTIBLE con pred ≥ ${cfg.minPredictedChange || 0}% y BP ≥ ${(cfg.minBoostPower * 100).toFixed(0)}% (mínimo: ${cfg.minSignals}).`,
      shouldInvest: false,
      allCandidates: candidates,
    };
  }

  // Excluir activos ya en posición abierta
  const openIds  = new Set((existingPositions || []).filter(p => p.status === 'open').map(p => p.assetId));
  const filtered = candidates.filter(a => !openIds.has(a.id));
  const selected = filtered.slice(0, cfg.maxPositions);

  if (selected.length === 0) {
    return {
      selected:     [],
      reason:       'Todos los candidatos tienen posición abierta.',
      shouldInvest: false,
      allCandidates: candidates,
    };
  }

  // Calcular capital a asignar por posición
  const cycleCapital = cfg.capitalTotal * cfg.capitalPerCycle;
  const perPosition  = cfg.diversification
    ? cycleCapital / selected.length
    : cycleCapital;  // toda la apuesta en el mejor si no hay diversificación

  const targets = selected.map((a, i) => ({
    assetId:         a.id,
    symbol:          a.symbol,
    name:            a.name,
    boostPower:      a.boostPower,
    boostPowerPct:   a.boostPowerPercent,
    classification:  a.classification,
    entryPrice:      a.current_price,
    predictedChange: a.predictedChange,
    capitalUSD:      parseFloat(perPosition.toFixed(2)),
    weight:          parseFloat((perPosition / cycleCapital * 100).toFixed(1)),
    rank:            i + 1,
    takeProfitPrice: parseFloat((a.current_price * (1 + cfg.takeProfitPct / 100)).toFixed(6)),
    stopLossPrice:   parseFloat((a.current_price * (1 - cfg.stopLossPct   / 100)).toFixed(6)),
    expectedFeeUSD:  parseFloat((perPosition * cfg.feePct / 100).toFixed(4)),
  }));

  const minPredLabel = cfg.minPredictedChange > 0
    ? ` · pred ≥ ${cfg.minPredictedChange}%`
    : '';
  const topPred = selected[0]?.predictedChange?.toFixed(1) ?? '?';

  return {
    selected,
    reason:          `${selected.length} activos por mayor potencial de crecimiento (top: +${topPred}% previsto)${minPredLabel}`,
    shouldInvest:    true,
    cycleCapital:    parseFloat(cycleCapital.toFixed(2)),
    allCandidates:   candidates,    // lista completa ordenada para mostrar en UI
    sortedBy:        'predictedChange',
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
    exchangeOrderId: cfg.mode === 'simulated'
      ? `sim_${positionId}`
      : null,
  };
}

// ─── Actualizar P&L de posición ───────────────────────────────────────────────
function updatePositionPnL(position, currentPrice) {
  const p = { ...position };
  p.currentPrice     = currentPrice;
  p.unrealizedPnL    = parseFloat(((currentPrice - p.entryPrice) * p.units - (p.totalFeesUSD || 0)).toFixed(4));
  p.unrealizedPnLPct = parseFloat((((currentPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(2));
  return p;
}

// ─── Cerrar posición ──────────────────────────────────────────────────────────
function closePosition(position, exitPrice, reason, investConfig) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const p   = { ...position };
  const exitFee = parseFloat((p.capitalUSD * cfg.feePct / 100).toFixed(4));

  p.status        = 'closed';
  p.closedAt      = new Date().toISOString();
  p.closeReason   = reason;
  p.exitPrice     = exitPrice;
  p.exitFeeUSD    = exitFee;
  p.totalFeesUSD  = parseFloat(((p.entryFeeUSD || 0) + exitFee).toFixed(4));

  const grossPnL   = (exitPrice - p.entryPrice) * p.units;
  p.realizedPnL    = parseFloat((grossPnL - p.totalFeesUSD).toFixed(4));
  p.realizedPnLPct = parseFloat((((exitPrice - p.entryPrice) / p.entryPrice) * 100).toFixed(2));

  return p;
}

// ─── Evaluar condiciones de cierre (watchdog) ─────────────────────────────────
function evaluateCloseConditions(position, currentPrice, investConfig) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };
  const pct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

  if (pct >= cfg.takeProfitPct)  return { shouldClose: true,  reason: 'take_profit' };
  if (pct <= -cfg.stopLossPct)   return { shouldClose: true,  reason: 'stop_loss'   };
  if ((position.holdCycles || 0) >= cfg.maxHoldCycles)
                                  return { shouldClose: true,  reason: 'max_hold'    };
  return { shouldClose: false };
}

module.exports = {
  DEFAULT_INVEST_CONFIG,
  selectInvestmentTargets,
  calculateAvailableCapital,
  createPosition,
  updatePositionPnL,
  closePosition,
  evaluateCloseConditions,
};
