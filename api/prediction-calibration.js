// prediction-calibration.js — Sistema de Calibración Online de Predicciones
// v1.0
//
// FUNDAMENTO:
// El modelo de predicción acumula errores sistemáticos (bias) que se corrigen
// progresivamente con los resultados reales de las posiciones cerradas.
//
// Basado en principios de:
//  - Exponential Moving Average (EMA) para dar más peso a datos recientes
//  - Calibración por clase (INVERTIBLE/APALANCADO) y sub-rango de boostPower
//  - Detección de regímenes de mercado para ajuste contextual
//
// Los datos se persisten en Redis bajo la clave PREDICTION_CALIBRATION_KEY.
// Se actualiza automáticamente al cerrar cada posición.

'use strict';

const CALIBRATION_KEY = 'predict-calibration-v2';
const EMA_ALPHA       = 0.25;  // peso de cada nuevo dato (0.25 = ventana efectiva ~7 obs.)
const MIN_SAMPLES     = 3;     // mínimo de observaciones para aplicar calibración
const MAX_HISTORY     = 60;    // observaciones máximas almacenadas

// ── Estructura inicial de calibración por categoría ──────────────────────────
function emptyCalibration() {
  return {
    version:     2,
    updatedAt:   null,
    INVERTIBLE: {
      samples:        0,
      biasEMA:        0,      // error sistemático aditivo (predicted - actual promedio)
      scaleEMA:       1.0,    // ratio actual/predicted (factor multiplicativo)
      mae:            0,      // Mean Absolute Error promedio
      maeEMA:         0,
      history:        [],     // últimas N observaciones [{predicted, actual, symbol, ts}]
      byBoostRange:   {       // calibración por rango de boostPower
        '0.65-0.75': { n: 0, biasEMA: 0, scaleEMA: 1.0 },
        '0.75-0.85': { n: 0, biasEMA: 0, scaleEMA: 1.0 },
        '0.85-1.00': { n: 0, biasEMA: 0, scaleEMA: 1.0 },
      },
    },
    APALANCADO: {
      samples:        0,
      biasEMA:        0,
      scaleEMA:       1.0,
      mae:            0,
      maeEMA:         0,
      history:        [],
      byBoostRange:   {
        '0.40-0.55': { n: 0, biasEMA: 0, scaleEMA: 1.0 },
        '0.55-0.65': { n: 0, biasEMA: 0, scaleEMA: 1.0 },
      },
    },
  };
}

// ── Determinar rango de BP ────────────────────────────────────────────────────
function getBoostRange(boostPower, category) {
  if (category === 'INVERTIBLE') {
    if (boostPower < 0.75) return '0.65-0.75';
    if (boostPower < 0.85) return '0.75-0.85';
    return '0.85-1.00';
  }
  if (category === 'APALANCADO') {
    if (boostPower < 0.55) return '0.40-0.55';
    return '0.55-0.65';
  }
  return null;
}

// ── Actualizar calibración con un nuevo dato ──────────────────────────────────
/**
 * Registra el resultado de una posición cerrada y actualiza el modelo de calibración.
 *
 * @param {object} calibration  - Estado actual de calibración (de Redis)
 * @param {object} position     - Posición cerrada con campos: predictedChange, realizedPnLPct,
 *                                classification, boostPower, symbol, closedAt
 * @returns {object} calibration actualizada
 */
function updateCalibration(calibration, position) {
  const cat  = position.classification;
  if (!calibration[cat]) return calibration;   // RUIDOSO → ignorar

  const predicted = parseFloat(position.predictedChange  || 0);
  const actual    = parseFloat(position.realizedPnLPct   || 0);
  const bp        = parseFloat(position.boostPower       || 0);

  if (predicted === 0) return calibration; // sin predicción → no entrenar

  const entry = calibration[cat];
  const alpha  = EMA_ALPHA;

  // ── Error aditivo: cuánto se equivocó el modelo ─────────────────────────
  // bias > 0 → modelo sobreestima (predicted > actual)
  // bias < 0 → modelo subestima   (predicted < actual)
  const error    = predicted - actual;
  const absError = Math.abs(error);

  entry.biasEMA = entry.samples === 0
    ? error
    : entry.biasEMA * (1 - alpha) + error * alpha;

  // ── Factor de escala: cuánto del predicted se materializó ───────────────
  // scaleEMA > 1 → model subestima (actual/predicted > 1)
  // scaleEMA < 1 → model sobreestima
  const actualScale = predicted !== 0 ? actual / predicted : 1;
  // Clamp scale para evitar outliers extremos que distorsionen el modelo
  const clampedScale = Math.max(0.1, Math.min(5.0, actualScale));

  entry.scaleEMA = entry.samples === 0
    ? clampedScale
    : entry.scaleEMA * (1 - alpha) + clampedScale * alpha;

  // ── MAE (Error Absoluto Medio) ───────────────────────────────────────────
  entry.maeEMA = entry.samples === 0
    ? absError
    : entry.maeEMA * (1 - alpha) + absError * alpha;

  entry.samples++;

  // ── Historial reciente ───────────────────────────────────────────────────
  entry.history.unshift({
    symbol:    position.symbol,
    predicted: parseFloat(predicted.toFixed(2)),
    actual:    parseFloat(actual.toFixed(2)),
    error:     parseFloat(error.toFixed(2)),
    scale:     parseFloat(clampedScale.toFixed(3)),
    bp:        parseFloat(bp.toFixed(3)),
    ts:        position.closedAt || new Date().toISOString(),
  });
  entry.history = entry.history.slice(0, MAX_HISTORY);

  // ── Calibración por rango de BoostPower ──────────────────────────────────
  const range = getBoostRange(bp, cat);
  if (range && entry.byBoostRange[range]) {
    const r = entry.byBoostRange[range];
    r.biasEMA  = r.n === 0 ? error         : r.biasEMA  * (1 - alpha) + error         * alpha;
    r.scaleEMA = r.n === 0 ? clampedScale  : r.scaleEMA * (1 - alpha) + clampedScale  * alpha;
    r.n++;
  }

  calibration.updatedAt = new Date().toISOString();
  return calibration;
}

// ── Obtener factores de corrección para una categoría/BP ─────────────────────
/**
 * Devuelve los factores de corrección a aplicar sobre una predicción raw.
 * Devuelve null si no hay suficientes muestras.
 *
 * @param {object} calibration - Estado de calibración
 * @param {string} category    - INVERTIBLE | APALANCADO
 * @param {number} boostPower  - BoostPower del activo a predecir
 * @returns {{biasCorrection, scaleCorrection, confidence, samples} | null}
 */
function getCorrectionFactors(calibration, category, boostPower) {
  const entry = calibration?.[category];
  if (!entry || entry.samples < MIN_SAMPLES) return null;

  // Intentar usar corrección específica del rango de BP (más precisa)
  const range = getBoostRange(boostPower, category);
  const rangeEntry = range ? entry.byBoostRange[range] : null;

  // Usar rango específico si tiene mínimo 3 muestras, si no usar corrección global
  const useRange = rangeEntry && rangeEntry.n >= MIN_SAMPLES;
  const bias  = useRange ? rangeEntry.biasEMA  : entry.biasEMA;
  const scale = useRange ? rangeEntry.scaleEMA : entry.scaleEMA;

  // Confidence: más muestras = más confianza (satura a 1 en ~20 muestras)
  const confidence = Math.min(1, entry.samples / 20);

  // Dampen corrections cuando confianza es baja (no aplicar corrección completa
  // si solo tenemos 3-5 muestras)
  const dampedBias  = bias  * confidence;
  const dampedScale = 1 + (scale - 1) * confidence;

  return {
    biasCorrection:  parseFloat(dampedBias.toFixed(3)),
    scaleCorrection: parseFloat(dampedScale.toFixed(4)),
    confidence:      parseFloat(confidence.toFixed(3)),
    samples:         entry.samples,
    maeEMA:          entry.maeEMA,
    source:          useRange ? `range:${range}` : 'global',
  };
}

// ── Recalibrar desde cero usando historial de posiciones ─────────────────────
/**
 * Reconstruye la calibración completa a partir de un array de posiciones cerradas.
 * Útil para reconstruir si se corrompe o para el primer arranque.
 *
 * @param {Array} closedPositions - Posiciones cerradas con predictedChange y realizedPnLPct
 * @returns {object} calibración reconstruida
 */
function rebuildCalibration(closedPositions) {
  const cal = emptyCalibration();

  // Ordenar por fecha de cierre (más antiguo primero para EMA correcto)
  const sorted = [...closedPositions]
    .filter(p => p.predictedChange != null && p.realizedPnLPct != null)
    .filter(p => ['INVERTIBLE', 'APALANCADO'].includes(p.classification))
    .sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0));

  for (const pos of sorted) {
    updateCalibration(cal, pos);
  }

  return cal;
}

// ── Generar reporte de calibración (para UI) ──────────────────────────────────
function buildCalibrationReport(calibration) {
  if (!calibration) return { status: 'no_data' };

  const report = {
    version:   calibration.version,
    updatedAt: calibration.updatedAt,
    status:    'active',
    categories: {},
  };

  for (const cat of ['INVERTIBLE', 'APALANCADO']) {
    const e = calibration[cat];
    if (!e) continue;

    const hasEnough = e.samples >= MIN_SAMPLES;
    report.categories[cat] = {
      samples:   e.samples,
      hasEnough,
      bias:      parseFloat((e.biasEMA || 0).toFixed(2)),
      scale:     parseFloat((e.scaleEMA || 1).toFixed(3)),
      maeEMA:    parseFloat((e.maeEMA || 0).toFixed(2)),
      quality:   e.samples >= 10 ? 'good' : e.samples >= MIN_SAMPLES ? 'growing' : 'insufficient',
      diagnosis: buildDiagnosis(e),
      recentHistory: (e.history || []).slice(0, 10),
      byBoostRange: e.byBoostRange,
    };
  }

  return report;
}

function buildDiagnosis(entry) {
  if (!entry || entry.samples < MIN_SAMPLES) return 'Sin datos suficientes';

  const bias  = entry.biasEMA  || 0;
  const scale = entry.scaleEMA || 1;
  const mae   = entry.maeEMA   || 0;

  const parts = [];

  if (Math.abs(bias) > 5) {
    parts.push(bias > 0
      ? `Sobreestimando ~${bias.toFixed(1)}% sistemáticamente`
      : `Subestimando ~${Math.abs(bias).toFixed(1)}% sistemáticamente`
    );
  }

  if (scale < 0.5) {
    parts.push(`Activos rinden solo ${(scale * 100).toFixed(0)}% de lo predicho en media`);
  } else if (scale > 2) {
    parts.push(`Activos rinden ${(scale * 100).toFixed(0)}% de lo predicho — modelo muy conservador`);
  }

  if (mae > 15) {
    parts.push(`Error medio alto (MAE ${mae.toFixed(1)}%) — alta incertidumbre en predicciones`);
  } else if (mae < 5) {
    parts.push(`Error medio bajo (MAE ${mae.toFixed(1)}%) — buena calibración`);
  }

  return parts.length > 0 ? parts.join('. ') : 'Calibración en rango normal';
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  CALIBRATION_KEY,
  MIN_SAMPLES,
  emptyCalibration,
  updateCalibration,
  getCorrectionFactors,
  rebuildCalibration,
  buildCalibrationReport,
};
