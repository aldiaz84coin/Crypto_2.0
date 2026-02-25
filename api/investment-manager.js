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
// Filtros: clasificación INVERTIBLE + BP >= minBoostPower + pred >= minPredictedChange.
function selectInvestmentTargets(snapshot, investConfig, existingPositions = []) {
  const cfg = { ...DEFAULT_INVEST_CONFIG, ...investConfig };

  const candidates = snapshot
    .filter(a => {
      const cat  = getClassificationStr(a);
      const bp   = a.boostPower || 0;
      const pred = a.predictedChange || 0;
      return (
        cat === 'INVERTIBLE' &&
        bp  >= cfg.minBoostPower &&
        pred >= (cfg.minPredictedChange || 0)
      );
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
                     ` (pred ≥ ${cfg.minPredictedChange || 0}%,` +
                     ` BP ≥ ${(cfg.minBoostPower * 100).toFixed(0)}%)` +
                     ` — mínimo requerido: ${cfg.minSignals}.`,
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
};
