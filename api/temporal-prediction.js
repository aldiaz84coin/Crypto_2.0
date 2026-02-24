// temporal-prediction.js — Modelo de predicción temporal NO-LINEAL
// v1.0 — Reemplaza el escalado lineal de cycles-manager.js
//
// FUNDAMENTO MATEMÁTICO:
// Los criptoactivos NO tienen comportamiento lineal en el tiempo.
// A 12h: momentum activo        → predicción base
// A 24h: momentum parcialmente   → log-scaling
// A 48h: mean-reversion inicia   → amortiguación
// A 72h+: vol compounding > señal → ruido dominante
//
// Modelo base: pred(t) = basePred * Φ(t, class, mode)
// Donde Φ es la función de transferencia temporal que combina:
//   - Fase de momentum (0..12h): lineal-ish
//   - Fase de transición (12h..36h): logarítmica amortiguada
//   - Fase de reversión (36h+): decay exponencial hacia 0
'use strict';

// ─── Constantes ───────────────────────────────────────────────────────────────

const BASE_DURATION_MS  = 12 * 3600000; // 12h = referencia canónica

// Parámetros empíricos por tipo de activo (calibrables con datos históricos)
// Basados en volatility clustering típica de crypto:
//   INVERTIBLE (small/micro-cap): momentum fuerte, reversión más rápida
//   APALANCADO (lev tokens): se desintegran rápido, momentum ≤8h
//   RUIDOSO: predicción 0 siempre
const TEMPORAL_PARAMS = {
  // { momentumHalfLife, logAlpha, reversionStart, maxMultiplier }
  INVERTIBLE: { momentumHalfLife: 18, logAlpha: 0.55, reversionStart: 36, maxMultiplier: 2.8 },
  APALANCADO: { momentumHalfLife: 10, logAlpha: 0.40, reversionStart: 20, maxMultiplier: 1.5 },
  RUIDOSO:    { momentumHalfLife: 6,  logAlpha: 0.30, reversionStart: 12, maxMultiplier: 1.0 },
};

// Parámetros ajustados por modo de ejecución
const MODE_MODIFIERS = {
  normal:      { alpha: 1.0,  reversionBoost: 1.0  }, // large-caps: más estables, reversión más lenta
  speculative: { alpha: 1.15, reversionBoost: 1.35 }, // micro-caps: más volátiles, reversión más rápida
};

// ─── Función de transferencia temporal principal ──────────────────────────────

/**
 * Calcula el factor de escala temporal no-lineal Φ(t, class, mode).
 *
 * @param {number} targetDurationMs - Duración objetivo en ms
 * @param {string} classification   - INVERTIBLE | APALANCADO | RUIDOSO
 * @param {string} mode             - normal | speculative
 * @returns {number} scaleFactor    - Multiplicador a aplicar sobre la predicción base (12h)
 */
function computeTemporalScale(targetDurationMs, classification = 'RUIDOSO', mode = 'normal') {
  if (classification === 'RUIDOSO') return 0;

  const targetH = targetDurationMs / 3600000; // ms → horas
  const baseH   = BASE_DURATION_MS  / 3600000; // = 12

  const params   = TEMPORAL_PARAMS[classification] || TEMPORAL_PARAMS.RUIDOSO;
  const modeMod  = MODE_MODIFIERS[mode] || MODE_MODIFIERS.normal;

  // ── Fase 1: momentum (<= momentumHalfLife) ──────────────────────────────
  // Comportamiento quasi-lineal con ligero boost en primeras horas
  // (el momentum de señal tarda en materializarse)
  if (targetH <= params.momentumHalfLife) {
    const raw = targetH / baseH; // lineal base
    // Boost leve en las primeras horas para reflejar momentum inicial
    const boost = 1 + 0.08 * Math.sin(Math.PI * targetH / params.momentumHalfLife);
    return Math.min(raw * boost * modeMod.alpha, params.maxMultiplier);
  }

  // ── Fase 2: transición logarítmica (momentumHalfLife..reversionStart) ──
  // El momentum se desacelera: cada hora adicional aporta menos
  if (targetH <= params.reversionStart) {
    const atHalfLife = (params.momentumHalfLife / baseH) * 1.08 * modeMod.alpha;
    const progress   = (targetH - params.momentumHalfLife) /
                       (params.reversionStart - params.momentumHalfLife);
    // Logarítmico: crece poco a poco hasta el pico
    const peakValue  = atHalfLife * (1 + params.logAlpha * Math.log2(1 + progress));
    return Math.min(peakValue, params.maxMultiplier);
  }

  // ── Fase 3: reversión exponencial (> reversionStart) ────────────────────
  // Mean-reversion: la señal original se diluye, el precio tiende a equilibrio
  // Se calcula el valor en el punto de inicio de reversión y se decae desde ahí
  const atRevStart = computeTemporalScale(params.reversionStart * 3600000, classification, mode);
  const decay      = Math.exp(
    -0.045 * modeMod.reversionBoost * (targetH - params.reversionStart)
  );
  // No decae a cero: hay un piso mínimo del 40% del valor base (mercado nunca olvida del todo)
  const floor      = (baseH / targetH) * 0.40;
  return Math.max(atRevStart * decay, floor);
}

/**
 * Aplica el modelo temporal a un snapshot completo de activos.
 *
 * @param {Array}  snapshot       - Array de activos con basePrediction y classification
 * @param {number} targetDurationMs
 * @param {string} mode
 * @returns {Array} snapshot enriquecido con predictedChange no-lineal
 */
function applyTemporalModel(snapshot, targetDurationMs, mode = 'normal') {
  return snapshot.map(asset => {
    const basePred = typeof asset.basePrediction === 'number'
      ? asset.basePrediction
      : parseFloat(asset.predictedChange || 0);

    const classification = asset.classification || 'RUIDOSO';

    if (classification === 'RUIDOSO' || basePred === 0) {
      return {
        ...asset,
        basePrediction:      basePred,
        predictedChange:     0,
        temporalScaleFactor: 0,
        temporalModel:       'non-linear-v1',
      };
    }

    const scaleFactor    = computeTemporalScale(targetDurationMs, classification, mode);
    const scaledPred     = parseFloat((basePred * scaleFactor).toFixed(2));

    return {
      ...asset,
      basePrediction:      basePred,
      predictedChange:     scaledPred,
      temporalScaleFactor: parseFloat(scaleFactor.toFixed(4)),
      temporalModel:       'non-linear-v1',
    };
  });
}

/**
 * Genera el perfil temporal completo de un activo para múltiples ventanas.
 * Útil para mostrar en el frontend la curva de predicción.
 *
 * @param {number} basePrediction  - Predicción a 12h (canónica)
 * @param {string} classification
 * @param {string} mode
 * @param {Array}  windowsHours    - Array de ventanas en horas
 * @returns {Array} [{ hours, durationMs, scaleFactor, predictedChange }]
 */
function buildTemporalProfile(basePrediction, classification, mode = 'normal', windowsHours = [6, 12, 18, 24, 30, 36, 48, 72]) {
  return windowsHours.map(h => {
    const durationMs    = h * 3600000;
    const scaleFactor   = computeTemporalScale(durationMs, classification, mode);
    const predictedChange = classification === 'RUIDOSO'
      ? 0
      : parseFloat((basePrediction * scaleFactor).toFixed(2));

    return {
      hours:          h,
      durationMs,
      scaleFactor:    parseFloat(scaleFactor.toFixed(4)),
      predictedChange,
    };
  });
}

/**
 * Calibra los parámetros del modelo a partir de datos históricos de ciclos cerrados.
 * Compara las predicciones reescaladas vs los cambios reales para múltiples duraciones.
 *
 * @param {Array} closedCycles - Ciclos cerrados con results y durationMs
 * @returns {Object} calibrationReport
 */
function calibrateFromHistory(closedCycles) {
  if (!closedCycles || closedCycles.length < 3) {
    return { status: 'insufficient_data', minCycles: 3, available: closedCycles?.length || 0 };
  }

  const byClassAndDuration = {};

  closedCycles.forEach(cycle => {
    const durationH   = Math.round((cycle.durationMs || 43200000) / 3600000);
    const mode        = cycle.mode || 'normal';
    const results     = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));

    results.forEach(r => {
      const classification = r.classification || 'RUIDOSO';
      if (classification === 'RUIDOSO') return;

      const basePred   = parseFloat(r.basePrediction || r.predictedChange || 0);
      const actualChg  = parseFloat(r.actualChange || 0);
      if (basePred === 0) return;

      const key = `${classification}_${durationH}h`;
      if (!byClassAndDuration[key]) {
        byClassAndDuration[key] = { classification, durationH, mode, errors: [], ratios: [] };
      }

      const scaleFactor = computeTemporalScale(durationH * 3600000, classification, mode);
      const predicted   = basePred * scaleFactor;
      const error       = Math.abs(predicted - actualChg);
      const ratio       = basePred !== 0 ? actualChg / basePred : null;

      byClassAndDuration[key].errors.push(error);
      if (ratio !== null) byClassAndDuration[key].ratios.push(ratio);
    });
  });

  const summary = Object.entries(byClassAndDuration).map(([key, data]) => {
    const avgError = data.errors.reduce((s, e) => s + e, 0) / data.errors.length;
    const avgRatio = data.ratios.length > 0
      ? data.ratios.reduce((s, r) => s + r, 0) / data.ratios.length
      : null;
    const modelFactor = computeTemporalScale(data.durationH * 3600000, data.classification, data.mode);

    return {
      key,
      classification:  data.classification,
      durationH:       data.durationH,
      sampleCount:     data.errors.length,
      avgPredictionError: parseFloat(avgError.toFixed(2)),
      avgActualRatio:  avgRatio !== null ? parseFloat(avgRatio.toFixed(3)) : null,
      currentModelFactor: parseFloat(modelFactor.toFixed(4)),
      // Si el ratio real es significativamente diferente al modelo, sugerir ajuste
      suggestedAdjustment: avgRatio !== null && Math.abs(avgRatio - modelFactor) > 0.15
        ? parseFloat(avgRatio.toFixed(4))
        : null,
    };
  });

  return {
    status:       'calibrated',
    cyclesUsed:   closedCycles.length,
    calibratedAt: new Date().toISOString(),
    summary,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  computeTemporalScale,
  applyTemporalModel,
  buildTemporalProfile,
  calibrateFromHistory,
  BASE_DURATION_MS,
  TEMPORAL_PARAMS,
};
