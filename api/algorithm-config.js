// algorithm-config.js — v4.0 — Modelos separados por modo de ejecución
// Modelo Normal (generalista) y Modelo Especulativo tienen pesos y configs independientes.
// Sus datos de entrenamiento, análisis y calibración son completamente separados.
'use strict';

// ─── MODELO GENERALISTA (modo: normal) ────────────────────────────────────────
// Activos top por market cap, liquidez alta, comportamiento predecible.
// Prima la resistencia y la solidez sobre el potencial de rebote.
const DEFAULT_CONFIG_NORMAL = {
  version:     '4.0-normal',
  modelType:   'normal',
  description: 'Algoritmo generalista — activos de alta capitalización y liquidez',

  metaWeights: {
    potential:  0.55,  // menor peso al potencial (activos más maduros)
    resistance: 0.45
  },

  potentialWeights: {
    atlProximity:   0.25,  // ATL menos relevante en large-caps (raro que lleguen)
    volumeSurge:    0.25,  // volumen sí importa — liquidez real
    socialMomentum: 0.20,  // señal más débil (más ruido en grandes)
    newsSentiment:  0.20,  // noticias más consistentes en grandes
    reboundRecency: 0.10   // rebotes desde ATL menos frecuentes
  },

  resistanceWeights: {
    leverageRatio:   0.35,
    marketCapSize:   0.35,  // más peso: activos grandes son difíciles de mover
    volatilityNoise: 0.20,
    fearOverlap:     0.10
  },

  classification: {
    invertibleMinBoost:      0.68,  // umbral más exigente (menos falsos positivos)
    apalancadoMinBoost:      0.42,
    invertibleMaxMarketCap:  2000000000,  // hasta $2B (large-caps incluidos)
    invertibleMinAtlProx:    0.50,
    invertibleMinVolSurge:   1.15,
    invertibleMinSocial:     0.45
  },

  prediction: {
    invertibleTarget:    15,   // objetivo conservador (activos estables)
    apalancadoTarget:     6,
    ruidosoTarget:        0,
    directionOnly:       false,
    magnitudeTolerance:   7    // tolerancia algo mayor (predicciones en large-cap son imprecisas)
  },

  thresholds: {
    volumeMin:        100000000,   // $100M mínimo — solo activos líquidos
    volumeMax:        10000000000,
    volume7dAvgMin:   20000000,
    marketCapSmall:   500000000,
    marketCapMid:     5000000000,
    marketCapLarge:   20000000000,
    atlProxHigh:      0.20,
    atlProxMid:       0.45,
    reboundDaysMax:   180,
    newsCountMin:     2,
    newsCountMax:     100,
    fgiExtremeFear:   25,
    fgiNeutral:       50,
    fgiGreed:         70
  },

  lastModified: null,
  modifiedBy:   'system'
};

// ─── MODELO ESPECULATIVO (modo: speculative) ──────────────────────────────────
// Small/micro-caps (≤$200M cap, ≤$50M volumen).
// Prima el potencial de rebote fuerte y la proximidad al ATL.
// Tolerancia mayor a la volatilidad (es intrínseca al segmento).
const DEFAULT_CONFIG_SPECULATIVE = {
  version:     '4.0-speculative',
  modelType:   'speculative',
  description: 'Algoritmo especulativo — micro-caps con alto potencial y alta volatilidad',

  metaWeights: {
    potential:  0.70,  // mucho más peso al potencial (es donde está la oportunidad)
    resistance: 0.30
  },

  potentialWeights: {
    atlProximity:   0.35,  // proximidad al ATL es la señal más fuerte en micro-caps
    volumeSurge:    0.25,  // volumen repentino en micro-cap = señal muy clara
    socialMomentum: 0.20,  // comunidades pequeñas reaccionan rápido
    newsSentiment:  0.10,  // noticias menos consistentes en micro-caps
    reboundRecency: 0.10   // rebotes recientes frecuentes
  },

  resistanceWeights: {
    leverageRatio:   0.40,
    marketCapSize:   0.20,  // menos peso: ya son pequeños por definición
    volatilityNoise: 0.30,  // volatilidad más alta pero tolerable
    fearOverlap:     0.10
  },

  classification: {
    invertibleMinBoost:      0.60,  // umbral más bajo (activos especulativos fluctúan más)
    apalancadoMinBoost:      0.35,
    invertibleMaxMarketCap:  200000000,  // solo small-caps (≤$200M)
    invertibleMinAtlProx:    0.65,       // más cerca del ATL = más potencial
    invertibleMinVolSurge:   1.30,       // surge más pronunciado requerido
    invertibleMinSocial:     0.40
  },

  prediction: {
    invertibleTarget:    40,   // objetivo ambicioso (micro-caps pueden x2-x5)
    apalancadoTarget:    15,
    ruidosoTarget:        0,
    directionOnly:       false,
    magnitudeTolerance:  10    // tolerancia mayor (volatilidad inherente)
  },

  thresholds: {
    volumeMin:        500000,      // $500K mínimo — micro-caps tienen poco volumen
    volumeMax:        500000000,   // cap en $500M para evitar mid-caps
    volume7dAvgMin:   100000,
    marketCapSmall:   10000000,    // < $10M = nano-cap (máximo potencial)
    marketCapMid:     50000000,    // $10M-$50M = micro-cap
    marketCapLarge:   200000000,   // > $50M hasta $200M = small-cap
    atlProxHigh:      0.30,        // < 30% del rango = muy cerca ATL
    atlProxMid:       0.60,
    reboundDaysMax:   90,          // ventana más corta (micro-caps olvidan rápido)
    newsCountMin:     1,
    newsCountMax:     30,
    fgiExtremeFear:   30,
    fgiNeutral:       50,
    fgiGreed:         65
  },

  lastModified: null,
  modifiedBy:   'system'
};

// ─── Keys de Redis por modelo ─────────────────────────────────────────────────
const CONFIG_KEYS = {
  normal:      'algorithm-config:normal',
  speculative: 'algorithm-config:speculative'
};

// ─── Accessor de defaults ─────────────────────────────────────────────────────
function getDefaultConfig(mode) {
  return mode === 'speculative'
    ? { ...DEFAULT_CONFIG_SPECULATIVE }
    : { ...DEFAULT_CONFIG_NORMAL };
}

function getConfigKey(mode) {
  return CONFIG_KEYS[mode] || CONFIG_KEYS.normal;
}

// ─── Validación (común a ambos modelos) ──────────────────────────────────────
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

  const pr = config.prediction || {};
  if (pr.invertibleTarget < 0 || pr.invertibleTarget > 500)
    errors.push('invertibleTarget fuera de rango');
  if (pr.magnitudeTolerance < 1 || pr.magnitudeTolerance > 50)
    errors.push('magnitudeTolerance debe estar entre 1 y 50');

  return { valid: errors.length === 0, errors };
}

// ─── Normalización ────────────────────────────────────────────────────────────
function normalize(value, min, max) {
  if (max <= min) return 0.5;
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

// ─── Metadata para UI (idéntica en ambos — mismos factores, distintos pesos) ──
function getFactorMetadata() {
  return {
    potential: [
      { id: 'atlProximity',   name: 'Proximidad ATL',       description: 'Distancia al mínimo histórico — más cerca = más potencial de rebote' },
      { id: 'volumeSurge',    name: 'Surge de Volumen',     description: 'Volumen actual vs media 7d — >1.3x indica dinero entrando' },
      { id: 'socialMomentum', name: 'Momentum Social',      description: 'Actividad en Reddit y noticias recientes' },
      { id: 'newsSentiment',  name: 'Sentimiento Noticias', description: 'Tono de noticias recientes sobre el activo' },
      { id: 'reboundRecency', name: 'Recencia de ATL',      description: 'ATL reciente = rebote más probable en la ventana' }
    ],
    resistance: [
      { id: 'leverageRatio',   name: 'Ratio Apalancamiento', description: 'Precio vs histórico — holders en beneficio presionarán a la baja' },
      { id: 'marketCapSize',   name: 'Tamaño de Cap',        description: 'Cap grande = más difícil de mover significativamente' },
      { id: 'volatilityNoise', name: 'Ruido de Volatilidad', description: 'Volatilidad extrema indica ruido sin señal real' },
      { id: 'fearOverlap',     name: 'Solapamiento FGI',     description: 'FGI alto = euforia de mercado = techo cercano' }
    ]
  };
}

module.exports = {
  DEFAULT_CONFIG_NORMAL,
  DEFAULT_CONFIG_SPECULATIVE,
  // Backward compat — DEFAULT_CONFIG apunta al normal
  DEFAULT_CONFIG: DEFAULT_CONFIG_NORMAL,
  getDefaultConfig,
  getConfigKey,
  CONFIG_KEYS,
  validateConfig,
  normalize,
  getFactorMetadata
};
