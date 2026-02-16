// boost-power-calculator.js - Calculador mejorado (Iteración 2)

const { normalize } = require('./algorithm-config');

/**
 * Calcular BoostPower de un activo usando configuración
 * 
 * @param {Object} crypto - Datos del activo
 * @param {Object} config - Configuración del algoritmo
 * @param {Object} externalData - Datos externos (fearGreed, news, etc.)
 * @returns {Object} - { boostPower, breakdown }
 */
function calculateBoostPower(crypto, config, externalData = {}) {
  const { metaWeights, factorWeights, thresholds } = config;
  
  // Calcular scores de cada factor
  const factorScores = {
    // Cuantitativos
    volume: calculateVolumeScore(crypto, thresholds),
    marketCap: calculateMarketCapScore(crypto),
    volatility: calculateVolatilityScore(crypto, thresholds),
    historicalLow: calculateHistoricalLowScore(crypto),
    googleTrends: calculateGoogleTrendsScore(crypto),
    
    // Cualitativos (ahora usan datos reales)
    fearGreedIndex: calculateFearGreedScore(crypto, externalData.fearGreed),
    newsVolume: calculateNewsVolumeScore(crypto, externalData.news, thresholds),
    newsCount: calculateNewsCountScore(crypto, externalData.news, thresholds)
  };
  
  // Calcular puntajes ponderados por categoría
  const quantitativeScore = (
    factorScores.volume * factorWeights.volume +
    factorScores.marketCap * factorWeights.marketCap +
    factorScores.volatility * factorWeights.volatility +
    factorScores.historicalLow * factorWeights.historicalLow +
    factorScores.googleTrends * factorWeights.googleTrends
  );
  
  const qualitativeScore = (
    factorScores.fearGreedIndex * factorWeights.fearGreedIndex +
    factorScores.newsVolume * factorWeights.newsVolume +
    factorScores.newsCount * factorWeights.newsCount
  );
  
  // Normalizar por suma de pesos en cada categoría
  const quantWeightsSum = 
    factorWeights.volume + factorWeights.marketCap + 
    factorWeights.volatility + factorWeights.historicalLow + 
    factorWeights.googleTrends;
  
  const qualWeightsSum = 
    factorWeights.fearGreedIndex + factorWeights.newsVolume + 
    factorWeights.newsCount;
  
  const quantNormalized = quantWeightsSum > 0 ? 
    quantitativeScore / quantWeightsSum : 0;
  const qualNormalized = qualWeightsSum > 0 ? 
    qualitativeScore / qualWeightsSum : 0;
  
  // Combinar con meta-pesos
  const boostPower = 
    quantNormalized * metaWeights.quantitative + 
    qualNormalized * metaWeights.qualitative;
  
  return {
    boostPower: Math.min(1.0, Math.max(0, boostPower)),
    breakdown: {
      quantitative: quantNormalized,
      qualitative: qualNormalized,
      factors: factorScores
    }
  };
}

/**
 * Calcular score de volumen
 */
function calculateVolumeScore(crypto, thresholds) {
  const volume = crypto.total_volume || 0;
  return normalize(volume, thresholds.volumeMin, thresholds.volumeMax);
}

/**
 * Calcular score de market cap
 */
function calculateMarketCapScore(crypto) {
  const marketCap = crypto.market_cap || 0;
  const btcMarketCap = 1000000000000; // Aproximado $1T para BTC
  const ratio = marketCap / btcMarketCap;
  
  // Preferimos mid-caps (0.001 a 0.1 del market cap de BTC)
  if (ratio < 0.001) return normalize(ratio, 0, 0.001);
  if (ratio > 0.1) return 1 - normalize(ratio, 0.1, 0.5);
  return 1.0; // Sweet spot
}

/**
 * Calcular score de volatilidad
 */
function calculateVolatilityScore(crypto, thresholds) {
  // Usar cambio de precio 24h como proxy de volatilidad
  const priceChange = Math.abs(crypto.price_change_percentage_24h || 0) / 100;
  
  // Volatilidad moderada es buena (5-15%)
  if (priceChange < thresholds.volatilityMin) {
    return normalize(priceChange, 0, thresholds.volatilityMin);
  }
  if (priceChange > 0.15) {
    return 1 - normalize(priceChange, 0.15, thresholds.volatilityMax);
  }
  return 1.0; // Sweet spot
}

/**
 * Calcular score de historical low
 */
function calculateHistoricalLowScore(crypto) {
  const price = crypto.current_price || 0;
  const atl = crypto.atl || price;
  const ath = crypto.ath || price;
  
  if (ath === atl) return 0.5;
  
  // Posición en el rango ATL-ATH
  const percentAboveATL = ((price - atl) / (ath - atl)) * 100;
  
  // Más cerca de ATL = mayor score (oportunidad de rebote)
  if (percentAboveATL < 25) return 1.0;
  if (percentAboveATL < 50) return 0.7;
  return 0.3;
}

/**
 * Calcular score de Google Trends
 */
function calculateGoogleTrendsScore(crypto) {
  // Usar interés de mercado como proxy (market cap rank)
  // Activos más conocidos tienen más búsquedas
  if (crypto.market_cap_rank) {
    const rank = crypto.market_cap_rank;
    if (rank <= 10) return 1.0;
    if (rank <= 50) return 0.8;
    if (rank <= 100) return 0.6;
    return 0.4;
  }
  return 0.5;
}

/**
 * Calcular score de Fear & Greed
 */
function calculateFearGreedScore(crypto, fearGreedData) {
  if (!fearGreedData || !fearGreedData.value) return 0.5;
  
  const fgi = fearGreedData.value; // 0-100
  
  // Estrategia contrarian: miedo = oportunidad
  // FGI bajo (miedo) = score alto
  if (fgi < 25) return 1.0;      // Miedo extremo = máxima oportunidad
  if (fgi < 45) return 0.8;      // Miedo = buena oportunidad
  if (fgi < 55) return 0.5;      // Neutral
  if (fgi < 75) return 0.3;      // Avaricia = precaución
  return 0.1;                     // Avaricia extrema = evitar
}

/**
 * Calcular score de volumen de noticias
 */
function calculateNewsVolumeScore(crypto, newsData, thresholds) {
  if (!newsData || !newsData.articles) return 0.5;
  
  const articles = newsData.articles;
  
  // Cantidad de noticias
  const count = articles.length;
  const countScore = normalize(count, thresholds.newsCountMin, thresholds.newsCountMax);
  
  // Sentimiento promedio
  const sentiments = articles.map(a => a.sentiment.score);
  const avgSentiment = sentiments.length > 0 
    ? sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length 
    : 0;
  
  // Score combinado (50% cantidad, 50% sentimiento)
  const sentimentNormalized = (avgSentiment + 1) / 2; // -1 a 1 → 0 a 1
  
  return (countScore * 0.5) + (sentimentNormalized * 0.5);
}

/**
 * Calcular score de cantidad de noticias
 */
function calculateNewsCountScore(crypto, newsData, thresholds) {
  if (!newsData || !newsData.count) return 0.5;
  
  return normalize(newsData.count, thresholds.newsCountMin, thresholds.newsCountMax);
}

/**
 * Clasificar activo según BoostPower
 */
function classifyAsset(boostPower, threshold) {
  if (boostPower >= threshold) {
    return {
      category: 'INVERTIBLE',
      color: 'green',
      recommendation: 'BUY'
    };
  } else if (boostPower >= threshold * 0.7) {
    return {
      category: 'APALANCADO',
      color: 'yellow',
      recommendation: 'CONSIDER'
    };
  } else {
    return {
      category: 'RUIDOSO',
      color: 'gray',
      recommendation: 'AVOID'
    };
  }
}

module.exports = {
  calculateBoostPower,
  classifyAsset
};
