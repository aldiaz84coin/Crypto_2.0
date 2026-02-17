// boost-power-calculator.js — v2.0
// BoostPower = Potencial - Resistencia
// Predicciones coherentes con la categoría
// Validación honesta: dirección + tolerancia estrecha

const { normalize } = require('./algorithm-config');

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

function calculateBoostPower(crypto, config, externalData = {}) {
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
  // potential y resistance están en [0,1]
  // boostPower = potential * metaPotential - resistance * metaResistance
  // Escalar a [0,1]: desplazar +0.5 para centrar
  const mp = config.metaWeights?.potential  ?? 0.60;
  const mr = config.metaWeights?.resistance ?? 0.40;

  const raw = (potential * mp) - (resistance * mr);
  // raw ∈ [-0.4, 0.6] → normalizar a [0, 1]
  const boostPower = Math.min(1, Math.max(0, (raw + 0.4) / 1.0));

  // ── CLASIFICACIÓN ────────────────────────────────────────────────────────────
  const classification = classifyAsset(boostPower, crypto, config);

  // ── PREDICCIÓN COHERENTE ─────────────────────────────────────────────────────
  // La predicción refleja el objetivo de la categoría, NO una fórmula lineal ciega
  const predictedChange = buildPrediction(boostPower, classification.category, config);

  return {
    boostPower,
    boostPowerPercent: Math.round(boostPower * 100),
    predictedChange,
    classification,
    breakdown: {
      potential: {
        score: round(potential),
        weighted: round(potential * mp),
        factors: roundAll(potentialFactors)
      },
      resistance: {
        score: round(resistance),
        weighted: round(resistance * mr),
        factors: roundAll(resistanceFactors)
      },
      indicators: buildIndicators(crypto, externalData, thresholds)
    }
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTORES DE POTENCIAL
// ══════════════════════════════════════════════════════════════════════════════

// ATL Proximity: cuánto espacio de subida tiene hacia el ATH
// 1 = muy cerca del ATL (máximo potencial), 0 = en el ATH (sin espacio)
function calcAtlProximity(crypto) {
  const price = crypto.current_price || 0;
  const atl   = crypto.atl || price;
  const ath   = crypto.ath || price;
  if (ath <= atl || price <= 0) return 0.3;
  const positionPct = (price - atl) / (ath - atl); // 0=ATL, 1=ATH
  // Invertir: cerca de ATL = score alto
  // Bonus extra si está en el 25% inferior
  if (positionPct < 0.15) return 1.0;
  if (positionPct < 0.30) return 0.85;
  if (positionPct < 0.50) return 0.65;
  if (positionPct < 0.70) return 0.35;
  return 0.15; // cerca del ATH = poco espacio
}

// Volume Surge: volumen actual vs "esperado"
// Proxy: usamos market_cap como denominador cuando no tenemos media 7d
function calcVolumeSurge(crypto, thresholds) {
  const vol    = crypto.total_volume || 0;
  const mcap   = crypto.market_cap   || 1;
  if (vol <= 0) return 0.2;

  // Cap-to-volume ratio: vol/mcap > 0.10 = mucha actividad relativa
  const ratio = vol / mcap;
  if (ratio > 0.20) return 1.0;
  if (ratio > 0.10) return 0.80;
  if (ratio > 0.05) return 0.60;
  if (ratio > 0.02) return 0.40;
  return 0.20;
}

// Social Momentum: Reddit + noticias del activo
function calcSocialMomentum(crypto, externalData) {
  let score = 0.3; // base neutral

  // Noticias del activo específico
  const assetNews = externalData.assetNews;
  if (assetNews && assetNews.count > 0) {
    const countBonus = normalize(assetNews.count, 0, 10) * 0.3;
    score += countBonus;
  }

  // Sentimiento positivo en noticias
  const sentiment = externalData.assetNews?.avgSentiment ?? 0;
  if (sentiment > 0.3)       score += 0.25;
  else if (sentiment > 0)    score += 0.10;
  else if (sentiment < -0.3) score -= 0.15;

  // Reddit del activo
  const reddit = externalData.assetReddit;
  if (reddit) {
    if (reddit.postCount > 5)  score += 0.15;
    if (reddit.sentiment > 0)  score += 0.10;
  }

  return Math.min(1, Math.max(0, score));
}

// News Sentiment: tono de las noticias del activo
function calcNewsSentiment(crypto, externalData) {
  const assetNews = externalData.assetNews;
  if (!assetNews || assetNews.count === 0) {
    // Sin noticias: usar índice general muy suavizado
    const fgi = externalData.fearGreed?.value ?? 50;
    return fgi < 40 ? 0.55 : fgi < 60 ? 0.45 : 0.35;
  }

  const s = assetNews.avgSentiment ?? 0; // -1 a +1
  return Math.min(1, Math.max(0, (s + 1) / 2)); // normalizar a 0-1
}

// Rebound Recency: si el ATL fue reciente, rebote más probable
function calcReboundRecency(crypto, thresholds) {
  const atlDate = crypto.atl_date ? new Date(crypto.atl_date) : null;
  if (!atlDate) return 0.4;

  const daysSinceAtl = (Date.now() - atlDate.getTime()) / (1000 * 60 * 60 * 24);
  const maxDays = thresholds.reboundDaysMax || 180;

  if (daysSinceAtl < 30)  return 1.0;  // ATL en el último mes
  if (daysSinceAtl < 90)  return 0.80; // último trimestre
  if (daysSinceAtl < 180) return 0.60; // últimos 6 meses
  if (daysSinceAtl < 365) return 0.35; // último año
  return 0.15; // ATL muy antiguo
}

// ══════════════════════════════════════════════════════════════════════════════
// FACTORES DE RESISTENCIA
// ══════════════════════════════════════════════════════════════════════════════

// Leverage Ratio: cuántos holders están en beneficio y pueden vender
// Proxy: precio actual vs ATH — más cerca del ATH = más presión vendedora
function calcLeverageRatio(crypto, thresholds) {
  const price = crypto.current_price || 0;
  const ath   = crypto.ath || price;
  if (ath <= 0) return 0.5;

  const priceVsAth = price / ath; // 0=lejos del ATH, 1=en el ATH
  // Cerca del ATH = alta resistencia (muchos en beneficio quieren vender)
  if (priceVsAth > 0.85) return 1.0;
  if (priceVsAth > 0.65) return 0.75;
  if (priceVsAth > 0.45) return 0.50;
  if (priceVsAth > 0.25) return 0.25;
  return 0.10; // muy lejos del ATH = poca presión
}

// Market Cap Size: cuanto más grande, más difícil de mover
function calcMarketCapSize(crypto, thresholds) {
  const mcap = crypto.market_cap || 0;
  const small = thresholds.marketCapSmall || 200e6;
  const mid   = thresholds.marketCapMid   || 2e9;
  const large = thresholds.marketCapLarge || 10e9;

  if (mcap < small) return 0.10; // micro-cap: poca resistencia
  if (mcap < mid)   return 0.35; // mid-cap: resistencia moderada
  if (mcap < large) return 0.65; // large-cap: alta resistencia
  return 0.90; // mega-cap (BTC, ETH): máxima resistencia
}

// Volatility Noise: volatilidad extrema indica ruido (no señal)
function calcVolatilityNoise(crypto) {
  const chg = Math.abs(crypto.price_change_percentage_24h || 0);
  // Cambio < 3%: muy tranquilo, sin señal = algo de resistencia
  // Cambio 5-15%: zona ideal de movimiento
  // Cambio > 25%: ya muy volátil, ruido puro
  if (chg < 2)  return 0.30; // tranquilo pero sin impulso
  if (chg < 5)  return 0.15; // movimiento moderado-bajo: OK
  if (chg < 15) return 0.05; // rango ideal: mínima resistencia
  if (chg < 25) return 0.40; // demasiado volátil
  return 0.85; // extremamente volátil: puro ruido
}

// Fear Overlap: FGI alto = euforia = techo cercano
function calcFearOverlap(externalData) {
  const fgi = externalData.fearGreed?.value ?? 50;
  if (fgi > 80) return 0.90; // avaricia extrema = techo inminente
  if (fgi > 65) return 0.65; // avaricia
  if (fgi > 45) return 0.35; // neutral
  if (fgi > 25) return 0.15; // miedo = oportunidad
  return 0.05; // miedo extremo = mínima resistencia de euforia
}

// ══════════════════════════════════════════════════════════════════════════════
// CLASIFICACIÓN — Lógica con condiciones combinadas
// ══════════════════════════════════════════════════════════════════════════════

function classifyAsset(boostPower, crypto, config) {
  const cl = config.classification || {};
  const invertibleMin = cl.invertibleMinBoost   ?? 0.65;
  const apalancadoMin = cl.apalancadoMinBoost   ?? 0.40;
  const maxMcap       = cl.invertibleMaxMarketCap ?? 500e6;
  const minAtlProx    = cl.invertibleMinAtlProx   ?? 0.60;
  const minVolSurge   = cl.invertibleMinVolSurge  ?? 1.20;

  const mcap         = crypto.market_cap || 0;
  const price        = crypto.current_price || 0;
  const atl          = crypto.atl || price;
  const ath          = crypto.ath || price;
  const atlPos       = ath > atl ? (price - atl) / (ath - atl) : 0.5;
  const atlProxScore = 1 - atlPos; // 1 = cerca del ATL

  const volRatio     = (crypto.total_volume || 0) / (crypto.market_cap || 1);

  // INVERTIBLE: BoostPower alto + condiciones estructurales duras
  if (boostPower >= invertibleMin) {
    const smallCap   = mcap <= maxMcap;
    const nearAtl    = atlProxScore >= minAtlProx;
    const volSurging = volRatio >= (minVolSurge / 100); // normalizado

    if (smallCap && nearAtl) {
      return {
        category:      'INVERTIBLE',
        color:         'green',
        confidence:    volSurging ? 'HIGH' : 'MEDIUM',
        reason:        `Cap baja ($${fmt(mcap)}), cerca de ATL (${pct(atlPos)} del rango), potencial +${config.prediction?.invertibleTarget ?? 30}%`,
        recommendation: 'COMPRAR'
      };
    }
    // BP alto pero sin condiciones estructurales = forzar APALANCADO
    return {
      category:       'APALANCADO',
      color:          'yellow',
      confidence:     'MEDIUM',
      reason:         `Señal fuerte pero cap alta ($${fmt(mcap)}) o precio alejado del ATL — rebote con techo`,
      recommendation: 'CONSIDERAR con precaución'
    };
  }

  // APALANCADO: señal presente pero con resistencia estructural
  if (boostPower >= apalancadoMin) {
    const nearAth = price / (ath || price) > 0.55;
    return {
      category:       'APALANCADO',
      color:          'yellow',
      confidence:     'LOW',
      reason:         nearAth
        ? `Señal social positiva pero precio cercano a ATH — presión vendedora alta`
        : `Momentum moderado, capitalización media — subida limitada por resistencia`,
      recommendation: 'VIGILAR'
    };
  }

  // RUIDOSO
  return {
    category:       'RUIDOSO',
    color:          'gray',
    confidence:     'LOW',
    reason:         `Sin señal clara de impulso — sin catalizador identificado`,
    recommendation: 'IGNORAR'
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PREDICCIÓN COHERENTE CON LA CATEGORÍA
// ══════════════════════════════════════════════════════════════════════════════

function buildPrediction(boostPower, category, config) {
  const pr = config.prediction || {};

  if (category === 'INVERTIBLE') {
    // Predicción positiva escalada al target configurado
    // boostPower ∈ [0.65, 1.0] → predicción entre target/2 y target
    const target = pr.invertibleTarget ?? 30;
    const factor = normalize(boostPower, 0.65, 1.0);
    return parseFloat((target * 0.5 + factor * target * 0.5).toFixed(2));
  }

  if (category === 'APALANCADO') {
    // Predicción positiva pero limitada
    const target = pr.apalancadoTarget ?? 10;
    const factor = normalize(boostPower, 0.40, 0.65);
    return parseFloat((target * 0.3 + factor * target * 0.7).toFixed(2));
  }

  // RUIDOSO: predicción 0 (sin dirección — no apostar)
  return 0;
}

// ══════════════════════════════════════════════════════════════════════════════
// INDICADORES DERIVADOS (para mostrar en UI)
// ══════════════════════════════════════════════════════════════════════════════

function buildIndicators(crypto, externalData, thresholds) {
  const price  = crypto.current_price || 0;
  const atl    = crypto.atl  || price;
  const ath    = crypto.ath  || price;
  const mcap   = crypto.market_cap || 0;
  const vol    = crypto.total_volume || 0;
  const chg24  = crypto.price_change_percentage_24h || 0;
  const chg7d  = crypto.price_change_percentage_7d_in_currency || null;

  const atlPos = ath > atl ? ((price - atl) / (ath - atl) * 100) : 50;
  const volRatio = mcap > 0 ? vol / mcap : 0;
  const fgi    = externalData.fearGreed?.value ?? null;
  const assetNews = externalData.assetNews;

  return {
    // Cuantitativos
    atlProximityPct:   round(atlPos),           // % en rango ATL-ATH
    priceVsAth:        round(price / (ath||1) * 100), // % vs ATH
    priceVsAtl:        round(price / (atl||1) * 100), // % sobre ATL
    capEfficiency:     round(volRatio * 100),    // volumen/cap * 100
    marketCapM:        Math.round(mcap / 1e6),   // market cap en millones
    volumeM:           Math.round(vol / 1e6),    // volumen en millones
    change24h:         round(chg24),
    change7d:          chg7d !== null ? round(chg7d) : null,
    atlDaysAgo:        calcDaysSinceAtl(crypto),
    // Cualitativos
    fearGreedIndex:    fgi,
    fearGreedLabel:    fgiLabel(fgi),
    newsCount:         assetNews?.count ?? 0,
    newsSentiment:     assetNews?.avgSentiment !== undefined ? round(assetNews.avgSentiment, 2) : null,
    newsSentimentLabel: sentimentLabel(assetNews?.avgSentiment),
    redditPosts:       externalData.assetReddit?.postCount ?? null,
    redditSentiment:   externalData.assetReddit?.sentiment ?? null
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE PREDICCIONES (para cycles-manager)
// ══════════════════════════════════════════════════════════════════════════════

function validatePrediction(predictedChange, actualChange, category, config) {
  const pr = config?.prediction || {};
  const tol = pr.magnitudeTolerance ?? 5; // ±5 puntos por defecto

  // RUIDOSO predice 0 — se valida de forma diferente
  if (category === 'RUIDOSO' || predictedChange === 0) {
    // Correcto si el movimiento es menor al ruido esperado (±5%)
    return {
      correct: Math.abs(actualChange) <= tol,
      method:  'noise_check',
      reason:  `Movimiento ${actualChange.toFixed(2)}% ${Math.abs(actualChange) <= tol ? '≤' : '>'} umbral de ruido ±${tol}%`
    };
  }

  // Para INVERTIBLE y APALANCADO: validar dirección Y magnitud razonable
  const sameDirection = (predictedChange > 0 && actualChange > 0) ||
                        (predictedChange < 0 && actualChange < 0);

  if (!sameDirection) {
    return {
      correct: false,
      method:  'direction',
      reason:  `Dirección incorrecta: predicho ${predictedChange > 0 ? '+' : ''}${predictedChange.toFixed(2)}%, real ${actualChange > 0 ? '+' : ''}${actualChange.toFixed(2)}%`
    };
  }

  // Misma dirección: verificar que la magnitud no está demasiado lejos
  const error = Math.abs(predictedChange - actualChange);
  const correct = error <= tol * 2; // tolerancia doble para magnitud

  return {
    correct,
    method:  'direction_magnitude',
    reason:  correct
      ? `✓ Dirección correcta, error de magnitud: ${error.toFixed(2)}%`
      : `Dirección correcta pero magnitud muy alejada: predicho ${predictedChange.toFixed(2)}%, real ${actualChange.toFixed(2)}% (error ${error.toFixed(2)}%)`
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// RESUMEN TEXTUAL (template dinámico)
// ══════════════════════════════════════════════════════════════════════════════

function generateSummary(crypto, boostResult, externalData) {
  const ind   = boostResult.breakdown.indicators;
  const cat   = boostResult.classification.category;
  const bp    = boostResult.boostPowerPercent;
  const price = crypto.current_price?.toLocaleString('en-US', {style:'currency', currency:'USD', maximumFractionDigits:4}) ?? '?';

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

  const catText = {
    INVERTIBLE: `Clasificado como INVERTIBLE (BoostPower ${bp}%): bajo apalancamiento estructural, señal social activa y posición histórica favorable apuntan a potencial de subida de +${boostResult.predictedChange}% en el ciclo.`,
    APALANCADO: `Clasificado como APALANCADO (BoostPower ${bp}%): hay señal de subida pero la capitalización o posición de precio generará presión vendedora que limitará el recorrido (~+${boostResult.predictedChange}%).`,
    RUIDOSO:    `Clasificado como RUIDOSO (BoostPower ${bp}%): sin catalizador claro ni señal convergente. No se recomienda posición en este ciclo.`
  }[cat];

  return `${crypto.name} cotiza a ${price}, ${posText} (${ind.atlProximityPct.toFixed(0)}% del rango ATL-ATH). Presenta ${volText} (${ind.capEfficiency.toFixed(1)}% vol/cap). ${fgiText} ${newsText} ${catText}`;
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

function pct(v) { return (v * 100).toFixed(0) + '%'; }

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
  if (v > 0.3)  return 'positivo';
  if (v > 0.05) return 'levemente positivo';
  if (v < -0.3) return 'negativo';
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
