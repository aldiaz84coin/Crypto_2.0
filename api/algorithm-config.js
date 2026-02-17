// algorithm-config.js — v2.0
// Configuración completa con umbrales configurables

const DEFAULT_CONFIG = {
  version: '3.2-v2',

  // ── Meta-pesos ─────────────────────────────────────────────────────────────
  metaWeights: {
    potential:   0.60,   // peso del bloque "Potencial"
    resistance:  0.40    // peso del bloque "Resistencia"
  },

  // ── Pesos de factores de POTENCIAL ─────────────────────────────────────────
  potentialWeights: {
    atlProximity:    0.30,  // Espacio para subir desde ATL
    volumeSurge:     0.20,  // Volumen actual vs media 7d
    socialMomentum:  0.20,  // Reddit + noticias positivas
    newsSentiment:   0.15,  // Sentimiento de noticias
    reboundRecency:  0.15   // ATL reciente (últimos 6 meses)
  },

  // ── Pesos de factores de RESISTENCIA ───────────────────────────────────────
  resistanceWeights: {
    leverageRatio:   0.40,  // Cap alta = mucha presión vendedora
    marketCapSize:   0.30,  // Grande = difícil de mover
    volatilityNoise: 0.20,  // Volatilidad extrema = ruido
    fearOverlap:     0.10   // FGI alto = euforia = techo cercano
  },

  // ── Umbrales de clasificación ──────────────────────────────────────────────
  classification: {
    invertibleMinBoost:   0.65,   // BoostPower mínimo para INVERTIBLE
    apalancadoMinBoost:   0.40,   // BoostPower mínimo para APALANCADO
    // Condiciones DURAS para INVERTIBLE (todas deben cumplirse)
    invertibleMaxMarketCap: 500000000,   // $500M máximo (configurable)
    invertibleMinAtlProx:   0.60,        // 60% del rango hacia ATL
    invertibleMinVolSurge:  1.20,        // volumen 20% sobre la media
    invertibleMinSocial:    0.50         // score social mínimo
  },

  // ── Objetivo de predicción ─────────────────────────────────────────────────
  prediction: {
    invertibleTarget:   30,   // % objetivo de subida para INVERTIBLE (configurable)
    apalancadoTarget:   10,   // % objetivo de subida para APALANCADO
    ruidosoTarget:      0,    // RUIDOSO: sin predicción de dirección
    // Ventana de validación: ¿cuándo se considera "acertado"?
    // directionOnly: solo importa la dirección (sube/baja)
    // magnitudeTolerance: tolerancia en puntos porcentuales
    directionOnly:          false,
    magnitudeTolerance:     5     // ±5 puntos porcentuales (no ±15%)
  },

  // ── Umbrales técnicos ──────────────────────────────────────────────────────
  thresholds: {
    volumeMin:        50000000,    // $50M mínimo de volumen
    volumeMax:        5000000000,  // $5B máximo
    volume7dAvgMin:   10000000,    // mínimo para calcular surge
    marketCapSmall:   200000000,   // < $200M = micro-cap (máximo potencial)
    marketCapMid:     2000000000,  // $200M-$2B = mid-cap
    marketCapLarge:   10000000000, // > $2B = large-cap (máxima resistencia)
    atlProxHigh:      0.25,        // < 25% del rango = muy cerca de ATL
    atlProxMid:       0.50,        // 25-50% = zona de oportunidad
    reboundDaysMax:   180,         // ATL en últimos 6 meses = rebote reciente
    newsCountMin:     2,
    newsCountMax:     50,
    fgiExtremeFear:   25,          // < 25 = miedo extremo = oportunidad contrarian
    fgiNeutral:       50,
    fgiGreed:         70
  },

  lastModified: null,
  modifiedBy:   'system'
};

// ── Validación ─────────────────────────────────────────────────────────────

function validateConfig(config) {
  const errors = [];

  const mw = config.metaWeights || {};
  if (Math.abs((mw.potential||0) + (mw.resistance||0) - 1.0) > 0.01)
    errors.push('metaWeights.potential + resistance deben sumar 1.0');

  const pw = config.potentialWeights || {};
  const pwSum = Object.values(pw).reduce((s,v) => s+v, 0);
  if (Math.abs(pwSum - 1.0) > 0.05)
    errors.push(`potentialWeights deben sumar ~1.0 (actual: ${pwSum.toFixed(2)})`);

  const rw = config.resistanceWeights || {};
  const rwSum = Object.values(rw).reduce((s,v) => s+v, 0);
  if (Math.abs(rwSum - 1.0) > 0.05)
    errors.push(`resistanceWeights deben sumar ~1.0 (actual: ${rwSum.toFixed(2)})`);

  const cl = config.classification || {};
  if (cl.invertibleMinBoost <= cl.apalancadoMinBoost)
    errors.push('invertibleMinBoost debe ser mayor que apalancadoMinBoost');
  if (cl.invertibleMaxMarketCap < 1000000)
    errors.push('invertibleMaxMarketCap demasiado bajo (mínimo $1M)');

  const pr = config.prediction || {};
  if (pr.invertibleTarget < 0 || pr.invertibleTarget > 200)
    errors.push('invertibleTarget debe estar entre 0 y 200');
  if (pr.magnitudeTolerance < 1 || pr.magnitudeTolerance > 50)
    errors.push('magnitudeTolerance debe estar entre 1 y 50');

  return { valid: errors.length === 0, errors };
}

// ── Normalización ──────────────────────────────────────────────────────────

function normalize(value, min, max) {
  if (max <= min) return 0.5;
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

// ── Metadata para UI ───────────────────────────────────────────────────────

function getFactorMetadata() {
  return {
    potential: [
      { id: 'atlProximity',   name: 'Proximidad ATL',    description: 'Distancia al mínimo histórico — más cerca = más potencial' },
      { id: 'volumeSurge',    name: 'Surge de Volumen',  description: 'Volumen actual vs media 7d — >1.3x indica dinero entrando' },
      { id: 'socialMomentum', name: 'Momentum Social',   description: 'Actividad en Reddit y noticias recientes' },
      { id: 'newsSentiment',  name: 'Sentimiento Noticias', description: 'Tono de noticias recientes sobre el activo' },
      { id: 'reboundRecency', name: 'Recencia de ATL',   description: 'ATL reciente = rebote más probable' }
    ],
    resistance: [
      { id: 'leverageRatio',   name: 'Ratio Apalancamiento', description: 'Cap alta vs histórico — holders en beneficio venderán' },
      { id: 'marketCapSize',   name: 'Tamaño de Cap',        description: 'Cap grande = difícil de mover significativamente' },
      { id: 'volatilityNoise', name: 'Ruido de Volatilidad', description: 'Volatilidad extrema indica ruido sin señal real' },
      { id: 'fearOverlap',     name: 'Solapamiento FGI',     description: 'FGI alto = euforia = techo cercano' }
    ]
  };
}

module.exports = { DEFAULT_CONFIG, validateConfig, normalize, getFactorMetadata };
