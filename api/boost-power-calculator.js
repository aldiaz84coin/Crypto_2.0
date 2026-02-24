// boost-power-calculator.js — v3.0
// BoostPower = Potencial - Resistencia
// Predicciones MULTI-SEÑAL: cada activo recibe una predicción única
// Soporte para calibración online desde ejecuciones reales
//
// CAMBIOS v2 → v3:
//  - buildPrediction reemplazada: ya no usa solo boostPower como escalar
//  - Predicción basada en volatilidad individual del activo + señales independientes
//  - Soporte para calibrationFactors externos (aprendizaje desde posiciones cerradas)
//  - basePrediction añadido al resultado para análisis de calibración

'use strict';

const { normalize } = require('./algorithm-config');

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

function calculateBoostPower(crypto, config, externalData = {}, calibrationFactors = null) {
  const { potentialWeights, resistanceWeights, thresholds } = config;

  // ── BLOQUE POTENCIAL ────────────────────────────────────────────────────────
  const potentialFactors = {
    atlProximity:    calcAtlProximity(crypto),
    volumeSurge:     calcVolumeSurge(crypto, thresholds),
    socialMomentum:  calcSocialMomentum(crypto, externalData),
    newsSentiment:   calcNewsSentiment(crypto, externalData),
    reboundRecency:  calcReboundRecency(crypto, thresholds)
  };

  const potential = weightedSum(potentialFactors, potentialWeights);

  // ── BLOQUE RESISTENCIA ──────────────────────────────────────────────────────
  const resistanceFactors = {
    leverageRatio:   calcLeverageRatio(crypto, thresholds),
    marketCapSize:   calcMarketCapSize(crypto, thresholds),
    volatilityNoise: calcVolatilityNoise(crypto),
    fearOverlap:     calcFearOverlap(externalData)
  };

  const resistance = weightedSum(resistanceFactors, resistanceWeights);

  // ── BOOST POWER NETO ────────────────────────────────────────────────────────
  const mp = config.metaWeights?.potential  ?? 0.60;
  const mr = config.metaWeights?.resistance ?? 0.40;

  const raw = (potential * mp) - (resistance * mr);
  // raw ∈ [-0.4, 0.6] → normalizar a [0, 1]
  const boostPower = Math.min(1, Math.max(0, (raw + 0.4) / 1.0));

  // ── CLASIFICACIÓN ────────────────────────────────────────────────────────────
  const classification = classifyAsset(boostPower, crypto, config);

  // ── PREDICCIÓN MULTI-SEÑAL ───────────────────────────────────────────────────
  // v3: cada activo recibe una predicción específica basada en sus factores individuales
  // y el historial de calibración del modelo
  const predictedChange = buildPrediction(
    boostPower,
    classification.category,
    config,
    { potentialFactors, resistanceFactors },
    crypto,
    calibrationFactors
  );

  return {
    boostPower,
    boostPowerPercent: Math.round(boostPower * 100),
    predictedChange,
    basePrediction:    predictedChange, // antes de calibración externa; se sobreescribe en index.js
    classification,
    breakdown: {
      potential: {
        score:    round(potential),
        weighted: round(potential * mp),
        factors:  roundAll(potentialFactors)
      },
      resistance: {
        score:    round(resistance),
        weighted: round(resistance * mr),
        factors:  roundAll(resistanceFactors)
      },
      indicators: buildIndicators(crypto, externalData, thresholds)
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PREDICCIÓN MULTI-SEÑAL — v3
// ══════════════════════════════════════════════════════════════════════════════
//
// Modelo basado en 4 componentes independientes:
//
//  [1] BANDA DE VOLATILIDAD  — magnitud esperada según historial del activo
//  [2] SEÑAL DIRECCIONAL     — composición de momentum precio + social + estructural
//  [3] CONFIRMACIÓN VOLUMEN  — confirma o debilita la señal
//  [4] CALIBRACIÓN ONLINE    — corrección aprendida de ejecuciones reales
//
// Ref: CryptoPulse (arXiv 2502.19349), XGBoost multifeature (arXiv 2407.11786)
// ══════════════════════════════════════════════════════════════════════════════

function buildPrediction(boostPower, category, config, factors, crypto, calibrationFactors) {
  const pr = config.prediction || {};

  if (category === 'RUIDOSO') return 0;

  // Graceful fallback si no se pasan factores (retrocompatibilidad)
  if (!factors || !crypto) {
    const target = pr.invertibleTarget ?? 15;
    const factor = normalize(boostPower, 0.65, 1.0);
    return parseFloat((target * 0.5 + factor * target * 0.5).toFixed(2));
  }

  const { potentialFactors = {}, resistanceFactors = {} } = factors;

  const {
    atlProximity    = 0.4,
    volumeSurge     = 0.3,
    socialMomentum  = 0.3,
    newsSentiment   = 0.3,
    reboundRecency  = 0.3,
  } = potentialFactors;

  const {
    volatilityNoise = 0.3,
    fearOverlap     = 0.3,
  } = resistanceFactors;

  // ──────────────────────────────────────────────────────────────────────────
  // [1] BANDA DE VOLATILIDAD — magnitud base del movimiento esperado
  // ──────────────────────────────────────────────────────────────────────────
  // La predicción debe ser coherente con la volatilidad real del activo.
  // Un activo con ±2%/día no puede predecirse a ±30% en 12h.
  // Usamos el movimiento reciente como proxy de volatilidad implícita.

  const chg24      = crypto.price_change_percentage_24h ?? null;
  const chg7d      = crypto.price_change_percentage_7d_in_currency ?? null;
  const vol24      = chg24 !== null ? Math.abs(chg24) : null;
  const vol7dDaily = chg7d !== null ? Math.abs(chg7d) / 7 : null;

  // Combinación ponderada de métricas de volatilidad disponibles
  let dailyVolProxy;
  if (vol24 !== null && vol7dDaily !== null) {
    dailyVolProxy = vol24 * 0.70 + vol7dDaily * 0.30; // más peso a dato reciente
  } else if (vol24 !== null) {
    dailyVolProxy = vol24;
  } else if (vol7dDaily !== null) {
    dailyVolProxy = vol7dDaily;
  } else {
    // Sin datos de precio: usar target config como referencia
    dailyVolProxy = category === 'INVERTIBLE'
      ? (pr.invertibleTarget ?? 15) / 2
      : (pr.apalancadoTarget  ??  8) / 2;
  }

  // Para horizonte ~12h: usamos 60% de la volatilidad diaria como banda base
  const targetCap      = category === 'INVERTIBLE'
    ? (pr.invertibleTarget ?? 15) * 2
    : (pr.apalancadoTarget  ??  8) * 2;

  const volatilityBand = Math.max(1.0, Math.min(dailyVolProxy * 0.60, targetCap));

  // ──────────────────────────────────────────────────────────────────────────
  // [2] SEÑAL DIRECCIONAL COMPUESTA ∈ [-1, +1]
  // ──────────────────────────────────────────────────────────────────────────
  // Cada fuente contribuye de forma independiente.

  // A) Momentum de precio — señal más predictiva a corto plazo
  //    tanh/12 normaliza el change diario a [-1,+1] suavizado
  const priceMomentumSignal = chg24 !== null ? Math.tanh(chg24 / 12) : 0;

  // B) Posición estructural — espacio de subida vs historial
  //    atlProximity ∈ [0,1]: 0.5 = medio rango → señal neutral → [-0.5, +0.5]
  const structuralSignal   = atlProximity - 0.5;

  // C) Momentum social y noticias — rescalado desde neutral 0.3
  const socialSignal       = socialMomentum - 0.3;   // [-0.3, +0.7]
  const sentimentSignal    = newsSentiment  - 0.3;   // [-0.3, +0.7]
  const reboundSignal      = reboundRecency - 0.3;   // [-0.3, +0.7]

  // Composición ponderada (pesos calibrados para relevancia en horizonte 12h)
  const directionComposite = (
    priceMomentumSignal * 0.40 +  // precio: señal más fiable en corto plazo
    structuralSignal    * 0.25 +  // posición histórica: contexto fundamental
    socialSignal        * 0.20 +  // momentum social: confirma o contradice precio
    sentimentSignal     * 0.10 +  // noticias: complementario al social
    reboundSignal       * 0.05    // rebote técnico: señal secundaria
  );

  // ──────────────────────────────────────────────────────────────────────────
  // [3] CONFIRMACIÓN DE VOLUMEN — amplifica o debilita la señal
  // ──────────────────────────────────────────────────────────────────────────
  // volumeSurge ∈ [0,1] → multiplicador ∈ [0.5, 1.5]
  const volumeMultiplier = 0.5 + volumeSurge * 1.0;

  // Penalización por ruido elevado (alta volatilityNoise + fearOverlap)
  const noisePenalty = 1 - (volatilityNoise * 0.20 + fearOverlap * 0.10); // ∈ [0.7, 1.0]

  // ──────────────────────────────────────────────────────────────────────────
  // COMBINACIÓN DE TODOS LOS COMPONENTES
  // ──────────────────────────────────────────────────────────────────────────
  // La señal direccional se convierte en un multiplicador de magnitud positivo
  // (para INVERTIBLE/APALANCADO solo invertimos cuando hay señal positiva)
  const signalMagnitude = 0.3 + Math.max(0, directionComposite) * 1.2; // ∈ [0.3, 1.74]

  // BoostPower como factor de confianza del clasificador
  const bpMin            = category === 'INVERTIBLE' ? 0.65 : 0.40;
  const bpConfidence     = normalize(boostPower, bpMin, 1.0);
  const confidenceMult   = 0.6 + bpConfidence * 0.8; // ∈ [0.6, 1.4]

  let prediction = volatilityBand
    * signalMagnitude
    * volumeMultiplier
    * noisePenalty
    * confidenceMult;

  prediction = Math.max(0.5, prediction);

  // ──────────────────────────────────────────────────────────────────────────
  // [4] CALIBRACIÓN ONLINE — corrección aprendida de ejecuciones reales
  // ──────────────────────────────────────────────────────────────────────────
  if (calibrationFactors && calibrationFactors.confidence > 0.1) {
    const { biasCorrection = 0, scaleCorrection = 1.0 } = calibrationFactors;

    prediction = prediction - biasCorrection;

    if (scaleCorrection > 0 && scaleCorrection < 5) {
      prediction = prediction * scaleCorrection;
    }
  }

  // Clamp final
  prediction = Math.max(0.5, Math.min(targetCap, prediction));

  return parseFloat(prediction.toFixed(2));
}

// ══════════════════════════════════════════════════════════════════════════════
// CLASIFICACIÓN
// ══════════════════════════════════════════════════════════════════════════════

function classifyAsset(boostPower, crypto, config) {
  const cl = config.classification || {};
  const invertibleMinBoost  = cl.invertibleMinBoost  ?? 0.65;
  const apalancadoMinBoost  = cl.apalancadoMinBoost  ?? 0.40;
  const invertibleMaxMarketCap = cl.invertibleMaxMarketCap ?? 500e6;
  const invertibleMinAtlProx   = cl.invertibleMinAtlProx   ?? 0.60;

  const mcap     = crypto.market_cap || 0;
  const atlProx  = calcAtlProximity(crypto);
  const price    = crypto.current_price || 0;
  const ath      = crypto.ath || price;

  if (boostPower >= invertibleMinBoost) {
    // Verificar condiciones estructurales adicionales para INVERTIBLE
    const capOk = mcap <= invertibleMaxMarketCap || invertibleMaxMarketCap === 0;
    const atlOk = atlProx >= invertibleMinAtlProx;

    if (capOk && atlOk) {
      return {
        category:       'INVERTIBLE',
        color:          'green',
        confidence:     boostPower >= 0.80 ? 'HIGH' : 'MEDIUM',
        reason:         `BoostPower ${(boostPower * 100).toFixed(0)}% — señal sólida, cerca de ATL, cap favorable`,
        recommendation: 'INVERTIR'
      };
    }

    // Cumple BP pero no condiciones estructurales → APALANCADO
    const structureReason = !capOk
      ? `Cap $${fmt(mcap)} supera límite — momentum sin estructura`
      : `Posición alejada del ATL (${(atlProx * 100).toFixed(0)}%) — menos potencial de rebote`;

    return {
      category:       'APALANCADO',
      color:          'yellow',
      confidence:     'MEDIUM',
      reason:         `BP alto pero ${structureReason}`,
      recommendation: 'VIGILAR'
    };
  }

  if (boostPower >= apalancadoMinBoost) {
    const nearAth = (price / (ath || 1)) > 0.80;
    return {
      category:       'APALANCADO',
      color:          'yellow',
      confidence:     'MEDIUM',
      reason:         nearAth
        ? `Señal social positiva pero precio cercano a ATH — presión vendedora alta`
        : `Momentum moderado, capitalización media — subida limitada por resistencia`,
      recommendation: 'VIGILAR'
    };
  }

  return {
    category:       'RUIDOSO',
    color:          'gray',
    confidence:     'LOW',
    reason:         `Sin señal clara de impulso — sin catalizador identificado`,
    recommendation: 'IGNORAR'
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE PREDICCIONES (para cycles-manager)
// ══════════════════════════════════════════════════════════════════════════════

function validatePrediction(predictedChange, actualChange, category, config) {
  const pr  = config?.prediction || {};
  const tol = pr.magnitudeTolerance ?? 5;

  if (category === 'RUIDOSO' || predictedChange === 0) {
    return {
      correct: Math.abs(actualChange) <= tol,
      method:  'noise_check',
      reason:  `Movimiento ${actualChange.toFixed(2)}% ${Math.abs(actualChange) <= tol ? '≤' : '>'} umbral de ruido ±${tol}%`
    };
  }

  const sameDirection = (predictedChange > 0 && actualChange > 0) ||
                        (predictedChange < 0 && actualChange < 0);

  if (!sameDirection) {
    return {
      correct: false,
      method:  'direction',
      reason:  `Dirección incorrecta: predicho ${predictedChange > 0 ? '+' : ''}${predictedChange.toFixed(2)}%, real ${actualChange > 0 ? '+' : ''}${actualChange.toFixed(2)}%`
    };
  }

  const error   = Math.abs(predictedChange - actualChange);
  const correct = error <= tol * 2;

  return {
    correct,
    method: 'direction_magnitude',
    reason: correct
      ? `✓ Dirección correcta, error de magnitud: ${error.toFixed(2)}%`
      : `Dirección correcta pero magnitud muy alejada: predicho ${predictedChange.toFixed(2)}%, real ${actualChange.toFixed(2)}% (error ${error.toFixed(2)}%)`
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTORES DE POTENCIAL
// ══════════════════════════════════════════════════════════════════════════════

function calcAtlProximity(crypto) {
  const price = crypto.current_price || 0;
  const atl   = crypto.atl || price;
  const ath   = crypto.ath || price;
  if (ath <= atl || price <= 0) return 0.3;
  const positionPct = (price - atl) / (ath - atl);
  if (positionPct < 0.15) return 1.0;
  if (positionPct < 0.30) return 0.85;
  if (positionPct < 0.50) return 0.65;
  if (positionPct < 0.70) return 0.35;
  return 0.15;
}

function calcVolumeSurge(crypto, thresholds) {
  const vol  = crypto.total_volume || 0;
  const mcap = crypto.market_cap   || 1;
  if (vol <= 0) return 0.2;
  const ratio = vol / mcap;
  if (ratio > 0.20) return 1.0;
  if (ratio > 0.10) return 0.80;
  if (ratio > 0.05) return 0.60;
  if (ratio > 0.02) return 0.40;
  return 0.20;
}

function calcSocialMomentum(crypto, externalData) {
  let score = 0.3;

  const assetNews = externalData.assetNews;
  if (assetNews && assetNews.count > 0) {
    const specificCount = assetNews.specificCount ?? assetNews.count;
    if (specificCount >= 5) score += 0.20;
    else if (specificCount >= 2) score += 0.10;

    const sentiment = assetNews.avgSentiment ?? 0;
    score += sentiment * 0.20;
  }

  const assetReddit = externalData.assetReddit;
  if (assetReddit && assetReddit.postCount > 0) {
    if (assetReddit.postCount >= 10) score += 0.15;
    else if (assetReddit.postCount >= 3) score += 0.08;
    if (assetReddit.sentiment && assetReddit.sentiment > 0.1) score += 0.10;
  }

  const gt = externalData.googleTrends;
  if (gt && gt.success) {
    const growth = gt.growthPercent ?? 0;
    if (growth > 50) score += 0.15;
    else if (growth > 20) score += 0.08;
    else if (growth < -20) score -= 0.05;
    if (gt.trend === 'rising') score += 0.05;
    else if (gt.trend === 'falling') score -= 0.05;
  }

  return Math.min(1, Math.max(0, score));
}

function calcNewsSentiment(crypto, externalData) {
  const assetNews = externalData.assetNews;
  if (!assetNews || assetNews.count === 0) return 0.3;

  const sentiment = assetNews.avgSentiment ?? 0;
  if (sentiment > 0.5)  return 0.9;
  if (sentiment > 0.2)  return 0.7;
  if (sentiment > 0)    return 0.55;
  if (sentiment > -0.2) return 0.40;
  if (sentiment > -0.5) return 0.25;
  return 0.10;
}

function calcReboundRecency(crypto, thresholds) {
  const chg7d  = crypto.price_change_percentage_7d_in_currency || 0;
  const chg24  = crypto.price_change_percentage_24h || 0;

  // Señal de rebote: bajó mucho esta semana pero sube hoy
  if (chg7d < -15 && chg24 > 3) return 0.85;
  if (chg7d < -10 && chg24 > 1) return 0.70;
  if (chg7d < -5  && chg24 > 0) return 0.55;
  if (chg7d > 10  && chg24 > 5) return 0.40; // ya subió mucho: menos potencial
  return 0.30;
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTORES DE RESISTENCIA
// ══════════════════════════════════════════════════════════════════════════════

function calcLeverageRatio(crypto, thresholds) {
  const price = crypto.current_price || 0;
  const atl   = crypto.atl || price;
  if (atl <= 0) return 0.3;
  const ratio = price / atl;
  if (ratio > 10) return 0.9;
  if (ratio > 5)  return 0.7;
  if (ratio > 2)  return 0.5;
  if (ratio > 1.5) return 0.3;
  return 0.1;
}

function calcMarketCapSize(crypto, thresholds) {
  const mcap = crypto.market_cap || 0;
  if (mcap > 10e9)  return 0.9;  // >10B: muy difícil mover
  if (mcap > 1e9)   return 0.7;  // 1-10B: difícil
  if (mcap > 200e6) return 0.5;  // 200M-1B: medio
  if (mcap > 50e6)  return 0.3;  // 50-200M: fácil de mover
  return 0.1;                     // <50M: micro-cap, muy volátil pero movible
}

function calcVolatilityNoise(crypto) {
  const chg24 = Math.abs(crypto.price_change_percentage_24h || 0);
  if (chg24 > 30) return 0.9;
  if (chg24 > 20) return 0.7;
  if (chg24 > 10) return 0.5;
  if (chg24 > 5)  return 0.3;
  return 0.1;
}

function calcFearOverlap(externalData) {
  const fgi = externalData.fearGreed?.value ?? null;
  if (fgi === null) return 0.3;
  if (fgi >= 80) return 0.9;  // Avaricia extrema: riesgo de techo
  if (fgi >= 65) return 0.6;
  if (fgi >= 45) return 0.3;  // Neutral: baja resistencia emocional
  if (fgi >= 25) return 0.2;  // Miedo: contrarian — potencial de rebote
  return 0.1;                  // Miedo extremo: fuerte señal contrarian
}

// ══════════════════════════════════════════════════════════════════════════════
// INDICADORES DERIVADOS (para UI)
// ══════════════════════════════════════════════════════════════════════════════

function buildIndicators(crypto, externalData, thresholds) {
  const price  = crypto.current_price || 0;
  const atl    = crypto.atl  || price;
  const ath    = crypto.ath  || price;
  const mcap   = crypto.market_cap || 0;
  const vol    = crypto.total_volume || 0;
  const chg24  = crypto.price_change_percentage_24h || 0;
  const chg7d  = crypto.price_change_percentage_7d_in_currency || null;

  const atlPos   = ath > atl ? ((price - atl) / (ath - atl) * 100) : 50;
  const volRatio = mcap > 0 ? vol / mcap : 0;
  const fgi      = externalData.fearGreed?.value ?? null;
  const assetNews = externalData.assetNews;
  const gt        = externalData.googleTrends;

  return {
    atlProximityPct:   round(atlPos),
    priceVsAth:        round(price / (ath||1) * 100),
    priceVsAtl:        round(price / (atl||1) * 100),
    capEfficiency:     round(volRatio * 100),
    marketCapM:        Math.round(mcap / 1e6),
    volumeM:           Math.round(vol / 1e6),
    change24h:         round(chg24),
    change7d:          chg7d !== null ? round(chg7d) : null,
    atlDaysAgo:        calcDaysSinceAtl(crypto),
    fearGreedIndex:    fgi,
    fearGreedLabel:    fgiLabel(fgi),
    newsCount:         assetNews?.count ?? 0,
    newsSentiment:     assetNews?.avgSentiment !== undefined ? round(assetNews.avgSentiment, 2) : null,
    newsSentimentLabel: sentimentLabel(assetNews?.avgSentiment),
    redditPosts:       externalData.assetReddit?.postCount ?? null,
    redditSentiment:   externalData.assetReddit?.sentiment ?? null,
    trendsCurrentInterest: gt?.success ? (gt.currentInterest ?? null) : null,
    trendsAverage:         gt?.success ? (gt.average ?? null)         : null,
    trendsPeak:            gt?.success ? (gt.peak ?? null)            : null,
    trendsTrend:           gt?.success ? (gt.trend ?? null)           : null,
    trendsGrowth:          gt?.success ? round(gt.growthPercent ?? 0) : null,
    trendsSource:          gt?.source  ?? null,
    trendsCached:          gt?.cached  ?? false
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// RESUMEN TEXTUAL
// ══════════════════════════════════════════════════════════════════════════════

function generateSummary(crypto, boostResult, externalData) {
  const ind   = boostResult.breakdown.indicators;
  const cat   = boostResult.classification.category;
  const bp    = boostResult.boostPowerPercent;
  const price = crypto.current_price?.toLocaleString('en-US', { style:'currency', currency:'USD', maximumFractionDigits:4 }) ?? '?';

  const posText   = ind.atlProximityPct < 30 ? 'muy cerca de su mínimo histórico'
                  : ind.atlProximityPct < 55 ? 'en zona de oportunidad histórica'
                  : ind.atlProximityPct < 75 ? 'a precio medio histórico'
                  : 'cerca de sus máximos históricos';

  const volText   = ind.capEfficiency > 15 ? 'volumen inusualmente alto'
                  : ind.capEfficiency > 7  ? 'volumen activo'
                  : 'volumen bajo';

  const fgiText   = ind.fearGreedIndex !== null
    ? `El mercado global muestra ${ind.fearGreedLabel.toLowerCase()} (FGI: ${ind.fearGreedIndex}).`
    : '';

  const newsText  = ind.newsCount > 0
    ? `Hay ${ind.newsCount} noticia${ind.newsCount > 1 ? 's' : ''} reciente${ind.newsCount > 1 ? 's' : ''} con sentimiento ${ind.newsSentimentLabel}.`
    : 'Sin noticias recientes identificadas.';

  const trendsText = ind.trendsCurrentInterest !== null
    ? (() => {
        const lvl  = ind.trendsCurrentInterest > 75 ? 'muy alto'
                   : ind.trendsCurrentInterest > 50 ? 'elevado'
                   : ind.trendsCurrentInterest > 25 ? 'moderado' : 'bajo';
        const grow = ind.trendsGrowth > 20
          ? ` (búsquedas +${ind.trendsGrowth}% en 7 días)`
          : ind.trendsGrowth < -20
            ? ` (búsquedas cayendo ${Math.abs(ind.trendsGrowth)}% en 7 días)`
            : '';
        return `Interés en buscadores ${lvl}${grow}.`;
      })()
    : '';

  const catText = cat === 'INVERTIBLE'
    ? `Con BoostPower ${bp}%, se clasifica como INVERTIBLE — señal fuerte de entrada.`
    : cat === 'APALANCADO'
    ? `Con BoostPower ${bp}%, señal moderada — posición APALANCADO.`
    : `BoostPower ${bp}% — sin señal clara.`;

  return `${crypto.name} cotiza a ${price}, ${posText}, con ${volText}. ${fgiText} ${newsText} ${trendsText} ${catText}`.replace(/\s{2,}/g, ' ').trim();
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function weightedSum(factors, weights) {
  let sum = 0, totalW = 0;
  for (const [key, score] of Object.entries(factors)) {
    const w = weights[key] ?? 0;
    sum    += score * w;
    totalW += w;
  }
  return totalW > 0 ? sum / totalW : 0;
}

function round(v, decimals = 2) {
  return parseFloat((v ?? 0).toFixed(decimals));
}

function roundAll(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = round(v);
  return out;
}

function fmt(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(0) + 'M';
  return n.toFixed(0);
}

function calcDaysSinceAtl(crypto) {
  if (!crypto.atl_date) return null;
  return Math.round((Date.now() - new Date(crypto.atl_date).getTime()) / 86400000);
}

function fgiLabel(v) {
  if (v === null || v === undefined) return 'Sin datos';
  if (v < 25) return 'Miedo Extremo';
  if (v < 45) return 'Miedo';
  if (v < 55) return 'Neutral';
  if (v < 75) return 'Avaricia';
  return 'Avaricia Extrema';
}

function sentimentLabel(v) {
  if (v === null || v === undefined) return 'sin datos';
  if (v > 0.3)   return 'positivo';
  if (v > 0.05)  return 'levemente positivo';
  if (v < -0.3)  return 'negativo';
  if (v < -0.05) return 'levemente negativo';
  return 'neutral';
}

module.exports = {
  calculateBoostPower,
  classifyAsset,
  validatePrediction,
  generateSummary,
  buildIndicators
};
