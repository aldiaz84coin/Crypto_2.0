// boost-power-calculator.js - Cálculo avanzado de Boost-Power

const { normalize } = require('./algorithm-config-advanced');

/**
 * Calcular Boost-Power con el nuevo sistema de pesos
 */
function calculateAdvancedBoostPower(asset, config) {
  const scores = {};
  const breakdown = {
    quantitative: {},
    qualitative: {}
  };

  // ============================================
  // FACTORES CUANTITATIVOS
  // ============================================

  // 1. Volumen
  if (asset.volume24h) {
    const volumeScore = normalize(
      asset.volume24h,
      config.thresholds.volumeMin,
      config.thresholds.volumeMax
    );
    scores.volume = volumeScore;
    breakdown.quantitative.volume = {
      score: volumeScore,
      value: asset.volume24h,
      weight: config.factorWeights.volume
    };
  }

  // 2. Market Cap Ratio
  if (asset.marketCap && asset.btcMarketCap) {
    const ratio = asset.marketCap / asset.btcMarketCap;
    const capScore = normalize(
      ratio,
      config.thresholds.marketCapRatioMin,
      config.thresholds.marketCapRatioMax
    );
    scores.marketCap = capScore;
    breakdown.quantitative.marketCap = {
      score: capScore,
      value: ratio,
      weight: config.factorWeights.marketCap
    };
  }

  // 3. Volatilidad
  if (asset.priceChange24h !== undefined) {
    const volatility = Math.abs(asset.priceChange24h) / 100;
    const volatilityScore = normalize(
      volatility,
      config.thresholds.volatilityMin,
      config.thresholds.volatilityMax
    );
    scores.volatility = volatilityScore;
    breakdown.quantitative.volatility = {
      score: volatilityScore,
      value: volatility,
      weight: config.factorWeights.volatility
    };
  }

  // 4. Historical Low (% sobre ATL)
  if (asset.price && asset.atl) {
    const percentAboveATL = ((asset.price - asset.atl) / (asset.ath - asset.atl)) * 100;
    const atlScore = percentAboveATL <= config.thresholds.historicalLowPercentile ? 1.0 : 
                     normalize(100 - percentAboveATL, 0, 100 - config.thresholds.historicalLowPercentile);
    scores.historicalLow = atlScore;
    breakdown.quantitative.historicalLow = {
      score: atlScore,
      value: percentAboveATL,
      weight: config.factorWeights.historicalLow
    };
  }

  // 5. Google Trends
  if (asset.searchTrend !== undefined) {
    const searchScore = normalize(
      asset.searchTrend,
      config.thresholds.searchIncreaseMin,
      config.thresholds.searchIncreaseMax
    );
    scores.googleTrends = searchScore;
    breakdown.quantitative.googleTrends = {
      score: searchScore,
      value: asset.searchTrend,
      weight: config.factorWeights.googleTrends
    };
  }

  // ============================================
  // FACTORES CUALITATIVOS
  // ============================================

  // 6. Fear & Greed Index (invertido: queremos comprar en miedo)
  if (asset.fearGreedIndex !== undefined) {
    // Invertir el índice y dar mayor score cuando está en la zona óptima
    const isInOptimalRange = asset.fearGreedIndex >= config.thresholds.fearGreedOptimalMin &&
                             asset.fearGreedIndex <= config.thresholds.fearGreedOptimalMax;
    const fgScore = isInOptimalRange ? 1.0 : 
                    1 - normalize(asset.fearGreedIndex, 0, 100);
    scores.fearGreedIndex = fgScore;
    breakdown.qualitative.fearGreedIndex = {
      score: fgScore,
      value: asset.fearGreedIndex,
      weight: config.factorWeights.fearGreedIndex,
      optimal: isInOptimalRange
    };
  }

  // 7. News Volume & Sentiment
  if (asset.newsCount !== undefined && asset.newsSentiment !== undefined) {
    const volumeScore = normalize(
      asset.newsCount,
      config.thresholds.newsCountMin,
      config.thresholds.newsCountMax
    );
    
    // Sentimiento: -1 a +1 normalizado a 0-1
    const sentimentScore = normalize(asset.newsSentiment, -1, 1);
    
    // Combinar volumen y sentimiento
    const newsScore = (volumeScore * 0.4 + sentimentScore * 0.6);
    
    scores.newsVolume = newsScore;
    breakdown.qualitative.newsVolume = {
      score: newsScore,
      value: {
        count: asset.newsCount,
        sentiment: asset.newsSentiment
      },
      weight: config.factorWeights.newsVolume
    };
  }

  // 8. News Count (como factor separado simple)
  if (asset.newsCount !== undefined) {
    const newsCountScore = normalize(
      asset.newsCount,
      config.thresholds.newsCountMin,
      config.thresholds.newsCountMax
    );
    scores.newsCount = newsCountScore;
    breakdown.qualitative.newsCount = {
      score: newsCountScore,
      value: asset.newsCount,
      weight: config.factorWeights.newsCount
    };
  }

  // ============================================
  // AGREGACIÓN CON PESOS
  // ============================================

  let quantitativeTotal = 0;
  let quantitativeWeightSum = 0;
  let qualitativeTotal = 0;
  let qualitativeWeightSum = 0;

  // Sumar cuantitativos
  ['volume', 'marketCap', 'volatility', 'historicalLow', 'googleTrends'].forEach(factor => {
    if (scores[factor] !== undefined) {
      const weight = config.factorWeights[factor];
      quantitativeTotal += scores[factor] * weight;
      quantitativeWeightSum += weight;
    }
  });

  // Sumar cualitativos
  ['fearGreedIndex', 'newsVolume', 'newsCount'].forEach(factor => {
    if (scores[factor] !== undefined) {
      const weight = config.factorWeights[factor];
      qualitativeTotal += scores[factor] * weight;
      qualitativeWeightSum += weight;
    }
  });

  // Normalizar por pesos reales usados
  const quantitativeScore = quantitativeWeightSum > 0 ? 
    quantitativeTotal / quantitativeWeightSum : 0;
  
  const qualitativeScore = qualitativeWeightSum > 0 ? 
    qualitativeTotal / qualitativeWeightSum : 0;

  // Combinar con meta-pesos
  const totalBoostPower = (
    quantitativeScore * config.metaWeights.quantitative +
    qualitativeScore * config.metaWeights.qualitative
  );

  return {
    total: totalBoostPower,
    quantitative: quantitativeScore,
    qualitative: qualitativeScore,
    breakdown,
    factorsUsed: Object.keys(scores).length,
    availableFactors: [
      'volume', 'marketCap', 'volatility', 'historicalLow', 'googleTrends',
      'fearGreedIndex', 'newsVolume', 'newsCount'
    ].length
  };
}

/**
 * Clasificar activo basado en Boost-Power
 */
function classifyAsset(boostPower, config) {
  // Umbrales de clasificación (pueden ser configurables también)
  const thresholds = {
    invertible: config.boostPowerThreshold || 0.40,
    apalancado: (config.boostPowerThreshold || 0.40) * 0.7
  };

  if (boostPower >= thresholds.invertible) {
    return 'invertible';
  } else if (boostPower >= thresholds.apalancado) {
    return 'apalancado';
  } else {
    return 'ruidoso';
  }
}

/**
 * Calcular BoostPower para múltiples activos
 */
function calculateBoostPowerBatch(assets, config) {
  return assets.map(asset => {
    const result = calculateAdvancedBoostPower(asset, config);
    const classification = classifyAsset(result.total, config);
    
    return {
      ...asset,
      boostPower: result.total,
      boostPowerBreakdown: result,
      classification
    };
  });
}

module.exports = {
  calculateAdvancedBoostPower,
  classifyAsset,
  calculateBoostPowerBatch
};
