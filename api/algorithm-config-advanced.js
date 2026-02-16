// algorithm-config-v2.js - Sistema de configuración avanzada del algoritmo

// Configuración por defecto con el nuevo sistema de pesos y umbrales

const DEFAULT_ALGORITHM_CONFIG = {
  // Meta-pesos: Cuantitativos vs Cualitativos
  metaWeights: {
    quantitative: 0.60,
    qualitative: 0.40
  },

  // Pesos de factores individuales
  factorWeights: {
    // CUANTITATIVOS
    volume: 0.10,
    marketCap: 0.08,
    volatility: 0.07,
    historicalLow: 0.05,
    googleTrends: 0.10,
    
    // CUALITATIVOS  
    fearGreedIndex: 0.02,
    newsVolume: 0.12,
    newsCount: 0.08
  },

  // Umbrales
  thresholds: {
    volumeMin: 100000000,
    volumeMax: 10000000000,
    marketCapRatioMin: 0.001,
    marketCapRatioMax: 0.5,
    volatilityMin: 0.05,
    volatilityMax: 0.50,
    historicalLowPercentile: 25,
    searchIncreaseMin: 50,
    searchIncreaseMax: 300,
    fearGreedOptimalMin: 20,
    fearGreedOptimalMax: 45,
    newsCountMin: 3,
    newsCountMax: 100,
    newsSentimentMin: 0.2
  }
};

function normalize(value, min, max) {
  if (max <= min) return 0;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));
}

module.exports = {
  DEFAULT_ALGORITHM_CONFIG,
  normalize
};
