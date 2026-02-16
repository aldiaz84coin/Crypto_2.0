// algorithm-config.js - Configuración Expandida (Iteración 2)

/**
 * CONFIGURACIÓN POR DEFECTO - ITERACIÓN 2
 * 
 * Expandida con:
 * - 2 meta-pesos (cuantitativo/cualitativo)
 * - 8 pesos de factores individuales
 * - 6 umbrales básicos
 */

const DEFAULT_CONFIG = {
  version: '3.1-iter2',
  
  // Meta-pesos (deben sumar 1.0)
  metaWeights: {
    quantitative: 0.60,  // 60% a factores cuantitativos
    qualitative: 0.40    // 40% a factores cualitativos
  },
  
  // Pesos de factores individuales
  factorWeights: {
    // Cuantitativos (deben sumar ~1.0 dentro de su categoría)
    volume: 0.10,           // Volumen 24h
    marketCap: 0.08,        // Market Cap ratio vs BTC
    volatility: 0.07,       // Volatilidad 7 días
    historicalLow: 0.05,    // Distancia desde ATL
    googleTrends: 0.10,     // Tendencias de búsqueda
    
    // Cualitativos (deben sumar ~1.0 dentro de su categoría)
    fearGreedIndex: 0.02,   // Índice Fear & Greed
    newsVolume: 0.12,       // Volumen de noticias
    newsCount: 0.08         // Cantidad de noticias
  },
  
  // Umbrales básicos (6 umbrales críticos)
  thresholds: {
    // Volumen
    volumeMin: 100000000,      // $100M mínimo
    volumeMax: 10000000000,    // $10B máximo
    
    // Volatilidad
    volatilityMin: 0.05,       // 5% mínimo
    volatilityMax: 0.50,       // 50% máximo
    
    // Noticias
    newsCountMin: 3,           // Mínimo 3 noticias
    newsCountMax: 100          // Máximo 100 noticias
  },
  
  // Umbral de clasificación
  boostPowerThreshold: 0.40,
  
  // Metadata
  lastModified: null,
  modifiedBy: 'system'
};

/**
 * Validar configuración expandida
 */
function validateConfig(config) {
  const errors = [];
  
  // Validar meta-pesos
  if (!config.metaWeights) {
    errors.push('Faltan metaWeights');
    return { valid: false, errors };
  }
  
  const { quantitative, qualitative } = config.metaWeights;
  
  if (typeof quantitative !== 'number' || quantitative < 0 || quantitative > 1) {
    errors.push('metaWeights.quantitative debe estar entre 0 y 1');
  }
  
  if (typeof qualitative !== 'number' || qualitative < 0 || qualitative > 1) {
    errors.push('metaWeights.qualitative debe estar entre 0 y 1');
  }
  
  const metaSum = quantitative + qualitative;
  if (Math.abs(metaSum - 1.0) > 0.01) {
    errors.push(`Meta-pesos deben sumar 1.0 (actual: ${metaSum.toFixed(2)})`);
  }
  
  // Validar pesos de factores
  if (!config.factorWeights) {
    errors.push('Faltan factorWeights');
    return { valid: false, errors };
  }
  
  const requiredFactors = [
    'volume', 'marketCap', 'volatility', 'historicalLow', 'googleTrends',
    'fearGreedIndex', 'newsVolume', 'newsCount'
  ];
  
  for (const factor of requiredFactors) {
    const weight = config.factorWeights[factor];
    if (typeof weight !== 'number' || weight < 0 || weight > 1) {
      errors.push(`factorWeights.${factor} debe estar entre 0 y 1`);
    }
  }
  
  // Validar umbrales
  if (!config.thresholds) {
    errors.push('Faltan thresholds');
    return { valid: false, errors };
  }
  
  const { thresholds } = config;
  
  if (thresholds.volumeMin >= thresholds.volumeMax) {
    errors.push('volumeMin debe ser menor que volumeMax');
  }
  
  if (thresholds.volatilityMin >= thresholds.volatilityMax) {
    errors.push('volatilityMin debe ser menor que volatilityMax');
  }
  
  if (thresholds.newsCountMin >= thresholds.newsCountMax) {
    errors.push('newsCountMin debe ser menor que newsCountMax');
  }
  
  // Validar threshold de clasificación
  if (typeof config.boostPowerThreshold !== 'number' || 
      config.boostPowerThreshold < 0.30 || 
      config.boostPowerThreshold > 0.50) {
    errors.push('boostPowerThreshold debe estar entre 0.30 y 0.50');
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Normalizar un valor a rango 0-1
 */
function normalize(value, min, max) {
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

/**
 * Obtener metadata de factores (para UI)
 */
function getFactorMetadata() {
  return {
    quantitative: [
      { id: 'volume', name: 'Volumen 24h', description: 'Liquidez del activo' },
      { id: 'marketCap', name: 'Market Cap', description: 'Capitalización vs BTC' },
      { id: 'volatility', name: 'Volatilidad', description: 'Movimiento de precio' },
      { id: 'historicalLow', name: 'Desde ATL', description: 'Distancia del mínimo' },
      { id: 'googleTrends', name: 'Google Trends', description: 'Interés de búsqueda' }
    ],
    qualitative: [
      { id: 'fearGreedIndex', name: 'Fear & Greed', description: 'Sentimiento de mercado' },
      { id: 'newsVolume', name: 'Volumen Noticias', description: 'Cantidad + sentimiento' },
      { id: 'newsCount', name: 'Cantidad Noticias', description: 'Número de artículos' }
    ]
  };
}

module.exports = {
  DEFAULT_CONFIG,
  validateConfig,
  normalize,
  getFactorMetadata
};
