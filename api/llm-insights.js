// llm-insights.js — 7 LLMs: Gemini + Claude + OpenAI + Llama/Groq (pago/futuro)
//                            + Mistral + Cohere + Cerebras (GRATUITOS, activos)
//
// v2 — ANÁLISIS DUAL: Algoritmo de Clasificación (BoostPower) + Algoritmo de Trading
//   · Breakdown de factores por activo incorrecto
//   · Datos reales de posiciones cerradas (PnL, closeReason, holdCycles)
//   · Correlación cruzada clasificación ↔ trading
//   · Nueva estructura JSON de respuesta con secciones separadas

const axios = require('axios');

// ═══════════════════════════════════════════════════════════════════
// PREPARACIÓN DE DATOS — pre-prompt
// ═══════════════════════════════════════════════════════════════════

/**
 * Extrae y cruza datos de ciclos + posiciones cerradas para construir
 * el contexto completo que los LLMs necesitan para el análisis dual.
 */
function prepareAnalysisData(cycles, investConfig, closedPositions) {
  let totalPredictions = 0, totalCorrect = 0;

  const categoryStats = {
    INVERTIBLE: { total: 0, correct: 0, boostPowerSum: 0, errors: [] },
    APALANCADO: { total: 0, correct: 0, boostPowerSum: 0, errors: [] },
    RUIDOSO:    { total: 0, correct: 0, boostPowerSum: 0, errors: [] },
  };

  // Acumuladores de factores para identificar cuáles fallan más
  const factorErrorScores = {
    atlProximity: [], volumeSurge: [], socialMomentum: [],
    newsSentiment: [], reboundRecency: [],
    leverageRatio: [], marketCapSize: [], volatilityNoise: [], fearOverlap: [],
  };

  // Detalle de activos incorrectos (máx 20 para no inflar el prompt)
  const incorrectAssets = [];

  // Activos que se movieron positivo pero no fueron clasificados INVERTIBLE
  const missedInvertibles = [];

  cycles.forEach(cycle => {
    const excluded    = cycle.excludedResults || [];
    const validResults = (cycle.results || []).filter(r => !excluded.includes(r.id));

    validResults.forEach(r => {
      totalPredictions++;
      if (r.correct) totalCorrect++;

      const cat = r.classification || 'RUIDOSO';
      if (categoryStats[cat]) {
        categoryStats[cat].total++;
        if (r.correct) categoryStats[cat].correct++;
        categoryStats[cat].boostPowerSum += (r.boostPower || 0);
      }

      // Errores con breakdown de factores
      if (!r.correct) {
        const potFactors = r.breakdown?.potential?.factors  || {};
        const resFactors = r.breakdown?.resistance?.factors || {};

        // Acumular scores de factores en incorrectos para detectar patrones
        Object.keys(factorErrorScores).forEach(f => {
          const v = potFactors[f] ?? resFactors[f];
          if (v !== undefined) factorErrorScores[f].push(Number(v));
        });

        if (incorrectAssets.length < 20) {
          incorrectAssets.push({
            symbol:      r.symbol,
            category:    cat,
            boostPower:  Math.round((r.boostPower || 0) * 100),
            predicted:   r.predictedChange,
            actual:      r.actualChange,
            errorMag:    Math.abs((r.actualChange || 0) - (r.predictedChange || 0)).toFixed(1),
            wrongDir:    (r.predictedChange > 0 && r.actualChange < 0) || (r.predictedChange < 0 && r.actualChange > 0),
            potFactors:  roundFactors(potFactors),
            resFactors:  roundFactors(resFactors),
          });
        }
      }

      // Perdidos: no fueron INVERTIBLE pero se movieron >5% positivo
      if (cat !== 'INVERTIBLE' && (r.actualChange || 0) > 5) {
        missedInvertibles.push({
          symbol:     r.symbol,
          category:   cat,
          boostPower: Math.round((r.boostPower || 0) * 100),
          actual:     r.actualChange,
          potFactors: roundFactors(r.breakdown?.potential?.factors || {}),
          resFactors: roundFactors(r.breakdown?.resistance?.factors || {}),
        });
      }
    });
  });

  // Calcular factor promedio en incorrectos (para detectar factores problemáticos)
  const factorAvgInErrors = {};
  Object.entries(factorErrorScores).forEach(([f, vals]) => {
    if (vals.length > 0) {
      factorAvgInErrors[f] = parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3));
    }
  });

  // Stats de categorías finales
  const overallAcc = totalPredictions > 0
    ? (totalCorrect / totalPredictions * 100).toFixed(1) : 0;

  const categoryAccuracy = {};
  const categoryBoostAvg = {};
  Object.entries(categoryStats).forEach(([cat, s]) => {
    categoryAccuracy[cat] = s.total > 0 ? (s.correct / s.total * 100).toFixed(1) : 0;
    categoryBoostAvg[cat] = s.total > 0 ? Math.round(s.boostPowerSum / s.total * 100) : 0;
  });

  // ── Datos de trading (posiciones cerradas) ──────────────────────────────────
  const tradingData = prepareTradingData(closedPositions);

  return {
    totalPredictions,
    totalCorrect,
    overallAcc,
    categoryStats,
    categoryAccuracy,
    categoryBoostAvg,
    incorrectAssets,
    missedInvertibles: missedInvertibles.slice(0, 10),
    factorAvgInErrors,
    tradingData,
  };
}

function prepareTradingData(closedPositions) {
  if (!closedPositions || closedPositions.length === 0) {
    return { hasData: false, summary: 'Sin posiciones cerradas disponibles' };
  }

  const wins   = closedPositions.filter(p => (p.realizedPnLPct || 0) > 0);
  const losses = closedPositions.filter(p => (p.realizedPnLPct || 0) <= 0);

  const avgWinPnl  = wins.length  > 0 ? avg(wins.map(p => p.realizedPnLPct  || 0)) : 0;
  const avgLossPnl = losses.length > 0 ? avg(losses.map(p => p.realizedPnLPct || 0)) : 0;
  const avgHold    = avg(closedPositions.map(p => p.holdCycles || 1));

  const closeReasons = {};
  closedPositions.forEach(p => {
    const r = (p.closeReason || 'unknown').split(':')[0].trim();
    closeReasons[r] = (closeReasons[r] || 0) + 1;
  });

  // Correlación: rendimiento por categoría de clasificación
  const byCategory = {};
  closedPositions.forEach(p => {
    const cat = p.classificationAtEntry || 'UNKNOWN';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, wins: 0, totalPnl: 0 };
    byCategory[cat].count++;
    byCategory[cat].totalPnl += p.realizedPnLPct || 0;
    if ((p.realizedPnLPct || 0) > 0) byCategory[cat].wins++;
  });

  const byCategoryFormatted = {};
  Object.entries(byCategory).forEach(([cat, d]) => {
    byCategoryFormatted[cat] = {
      count:   d.count,
      winRate: d.count > 0 ? (d.wins / d.count * 100).toFixed(1) : 0,
      avgPnl:  d.count > 0 ? (d.totalPnl / d.count).toFixed(2) : 0,
    };
  });

  // Detalle de últimas posiciones (máx 15)
  const details = closedPositions.slice(-15).map(p => ({
    symbol:        p.symbol,
    category:      p.classificationAtEntry || '?',
    boostPower:    p.boostPowerAtEntry !== undefined ? Math.round(p.boostPowerAtEntry * 100) : '?',
    pnlPct:        (p.realizedPnLPct || 0).toFixed(2),
    holdCycles:    p.holdCycles || 1,
    closeReason:   (p.closeReason || 'unknown').split(':')[0],
  }));

  return {
    hasData:       true,
    totalClosed:   closedPositions.length,
    winRate:       closedPositions.length > 0 ? (wins.length / closedPositions.length * 100).toFixed(1) : 0,
    avgWinPnl:     avgWinPnl.toFixed(2),
    avgLossPnl:    avgLossPnl.toFixed(2),
    avgHoldCycles: avgHold.toFixed(1),
    closeReasons,
    byCategory:    byCategoryFormatted,
    details,
  };
}

function roundFactors(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => { out[k] = parseFloat(Number(v).toFixed(3)); });
  return out;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ═══════════════════════════════════════════════════════════════════
// PROMPT — ANÁLISIS DUAL
// ═══════════════════════════════════════════════════════════════════

function generateAnalysisPrompt(cycles, currentConfig, mode, investConfig, closedPositions) {
  const modeLabel = mode === 'speculative' ? 'Especulativo (micro-caps)' : 'Generalista (alta cap)';
  const data      = prepareAnalysisData(cycles, investConfig, closedPositions);
  const cfg       = currentConfig || {};
  const pw        = cfg.potentialWeights  || {};
  const rw        = cfg.resistanceWeights || {};
  const mw        = cfg.metaWeights       || {};
  const cl        = cfg.classification    || {};
  const pr        = cfg.prediction        || {};
  const ic        = investConfig          || {};

  return `Eres un experto en análisis cuantitativo de algoritmos de predicción y trading de activos cripto.
Analiza el rendimiento de DOS algoritmos interdependientes y proporciona recomendaciones de ajuste conjunto.

════════════════════════════════════════════════════════════════
CONTEXTO GENERAL
════════════════════════════════════════════════════════════════
Modo operativo: ${modeLabel}
Ciclos analizados: ${cycles.length}
Total predicciones: ${data.totalPredictions}
Accuracy global: ${data.overallAcc}%

Accuracy por categoría:
  - INVERTIBLE:  ${data.categoryAccuracy.INVERTIBLE}%  (${data.categoryStats.INVERTIBLE.total} activos, BoostPower promedio: ${data.categoryBoostAvg.INVERTIBLE}%)
  - APALANCADO:  ${data.categoryAccuracy.APALANCADO}%  (${data.categoryStats.APALANCADO.total} activos, BoostPower promedio: ${data.categoryBoostAvg.APALANCADO}%)
  - RUIDOSO:     ${data.categoryAccuracy.RUIDOSO}%  (${data.categoryStats.RUIDOSO.total} activos, BoostPower promedio: ${data.categoryBoostAvg.RUIDOSO}%)

════════════════════════════════════════════════════════════════
ALGORITMO A — CLASIFICACIÓN (BoostPower)
════════════════════════════════════════════════════════════════

## Configuración actual de pesos

Meta-pesos:
  potential (score potencial)  = ${mw.potential ?? 0.60}
  resistance (score resistencia) = ${mw.resistance ?? 0.40}

Factores de POTENCIAL (impulso alcista):
  atlProximity    = ${pw.atlProximity    ?? '?'}  → % cerca del mínimo histórico (ATL)
  volumeSurge     = ${pw.volumeSurge     ?? '?'}  → volumen relativo vs market cap
  socialMomentum  = ${pw.socialMomentum  ?? '?'}  → reddit + noticias del activo
  newsSentiment   = ${pw.newsSentiment   ?? '?'}  → tono de noticias recientes
  reboundRecency  = ${pw.reboundRecency  ?? '?'}  → ATL reciente (mayor prob. rebote)

Factores de RESISTENCIA (presión vendedora):
  leverageRatio   = ${rw.leverageRatio   ?? '?'}  → precio vs histórico (holders en beneficio)
  marketCapSize   = ${rw.marketCapSize   ?? '?'}  → capitalización grande = más difícil mover
  volatilityNoise = ${rw.volatilityNoise ?? '?'}  → volatilidad extrema = ruido sin señal
  fearOverlap     = ${rw.fearOverlap     ?? '?'}  → Fear & Greed alto = euforia = techo cercano

Umbrales de clasificación:
  INVERTIBLE mínimo BoostPower: ${cl.invertibleMinBoost ?? 0.65}
  APALANCADO mínimo BoostPower: ${cl.apalancadoMinBoost ?? 0.40}
  Condiciones estructurales INVERTIBLE:
    maxMarketCap:  $${((cl.invertibleMaxMarketCap ?? 500e6) / 1e6).toFixed(0)}M
    minAtlProx:    ${cl.invertibleMinAtlProx ?? 0.60} (cerca del ATL)

Target de predicción:
  invertibleTarget:   +${pr.invertibleTarget ?? 30}%
  magnitudeTolerance: ±${pr.magnitudeTolerance ?? 5}%

## Activos clasificados incorrectamente (con scores de factores)
${data.incorrectAssets.length > 0
  ? JSON.stringify(data.incorrectAssets, null, 2)
  : 'Sin datos de incorrectos.'}

## Puntuación promedio de factores en activos INCORRECTOS
(Factores con score muy alto o bajo en errores indican sobreestimación/subestimación)
${JSON.stringify(data.factorAvgInErrors, null, 2)}

## INVERTIBLEs perdidos (se movieron >5% pero no se clasificaron como INVERTIBLE)
${data.missedInvertibles.length > 0
  ? JSON.stringify(data.missedInvertibles, null, 2)
  : 'Ninguno detectado.'}

════════════════════════════════════════════════════════════════
ALGORITMO B — TRADING (Compra/Venta)
════════════════════════════════════════════════════════════════

## Configuración actual
  takeProfitPct:   ${ic.takeProfitPct  ?? 10}%
  stopLossPct:     ${ic.stopLossPct    ?? 5}%
  maxHoldCycles:   ${ic.maxHoldCycles  ?? 3}
  capitalPerTrade: ${ic.capitalPerTrade ? (ic.capitalPerTrade * 100).toFixed(0) + '%' : '?'} del capital total
  feePct:          ${ic.feePct ?? 0.1}%

## Resultados de posiciones cerradas
${data.tradingData.hasData ? `
  Posiciones cerradas: ${data.tradingData.totalClosed}
  Win rate real: ${data.tradingData.winRate}%
  PnL promedio en wins:   +${data.tradingData.avgWinPnl}%
  PnL promedio en losses: ${data.tradingData.avgLossPnl}%
  Ciclos promedio en posición: ${data.tradingData.avgHoldCycles}

  Razones de cierre:
${Object.entries(data.tradingData.closeReasons).map(([r, n]) => `    ${r}: ${n} veces`).join('\n')}

  Rendimiento por categoría de clasificación:
${JSON.stringify(data.tradingData.byCategory, null, 2)}

  Detalle últimas posiciones:
${JSON.stringify(data.tradingData.details, null, 2)}
` : '  Sin posiciones cerradas disponibles aún.'}

════════════════════════════════════════════════════════════════
ANÁLISIS REQUERIDO
════════════════════════════════════════════════════════════════

Responde SOLO con un objeto JSON válido sin markdown ni texto adicional.
Analiza ambos algoritmos como sistema conjunto:

1. ¿Qué factores del BoostPower están sobreestimando o subestimando señales?
2. ¿El umbral INVERTIBLE es demasiado exigente (pierde oportunidades) o demasiado permisivo (genera falsos positivos)?
3. ¿El takeProfitPct está alineado con el invertibleTarget del clasificador?
4. ¿El stopLossPct es adecuado para la volatilidad típica de los activos clasificados?
5. ¿Los activos APALANCADO valen la pena tradear o generan más pérdidas?
6. ¿Qué ajuste conjunto maximizaría tanto la precision de clasificación como el PnL real?

{
  "overallAssessment": "Evaluación global de ambos algoritmos en 2-3 líneas",

  "classificationAlgorithm": {
    "assessment": "Evaluación específica del clasificador BoostPower en 2 líneas",
    "mainIssues": ["problema1", "problema2"],
    "boostpowerDiagnosis": "Qué factores específicos están mal calibrados y por qué",
    "falsePositivePattern": "Patrón de falsos positivos INVERTIBLE si existe",
    "missedPattern": "Patrón de INVERTIBLEs perdidos si existe",
    "suggestedWeightAdjustments": {
      "metaWeights": { "potential": 0.00, "resistance": 0.00 },
      "potentialWeights": { "atlProximity": 0.00, "volumeSurge": 0.00, "socialMomentum": 0.00, "newsSentiment": 0.00, "reboundRecency": 0.00 },
      "resistanceWeights": { "leverageRatio": 0.00, "marketCapSize": 0.00, "volatilityNoise": 0.00, "fearOverlap": 0.00 }
    },
    "suggestedThresholds": {
      "invertibleMinBoost": 0.00,
      "apalancadoMinBoost": 0.00,
      "invertibleTarget": 0,
      "magnitudeTolerance": 0
    }
  },

  "tradingAlgorithm": {
    "assessment": "Evaluación específica del algoritmo de compra/venta en 2 líneas",
    "mainIssues": ["problema1", "problema2"],
    "stopLossDiagnosis": "¿El SL es demasiado ajustado o amplio para la volatilidad observada?",
    "takeProfitDiagnosis": "¿El TP está alineado con el invertibleTarget del clasificador?",
    "apalancadoViability": "¿Vale la pena tradear APALANCADO según los datos? ¿Con qué condiciones?",
    "suggestedConfig": {
      "takeProfitPct": 0,
      "stopLossPct": 0,
      "maxHoldCycles": 0
    }
  },

  "jointAnalysis": {
    "classificationToTradingCorrelation": "¿Los INVERTIBLEs bien clasificados generan buenos trades? Datos concretos.",
    "keyInsight": "La observación más importante sobre la relación entre ambos algoritmos",
    "suggestedOperationalStrategy": "Recomendación conjunta: qué clasificar, cuándo entrar, cuándo salir",
    "priorityAction": "El único cambio más impactante a implementar ahora mismo"
  },

  "reasoning": "Explicación de 3-4 líneas de por qué estos ajustes específicos, basada en los datos",
  "expectedImpact": "Mejora esperada en accuracy y/o PnL si se aplican los ajustes"
}`;
}

// ═══════════════════════════════════════════════════════════════════
// PARSER — maneja la nueva estructura dual
// ═══════════════════════════════════════════════════════════════════

function parseJSONResponse(text, modelName) {
  try {
    let cleaned = text.trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    // Soporte para nueva estructura dual Y estructura legacy
    const hasDual   = parsed.classificationAlgorithm && parsed.tradingAlgorithm;
    const hasLegacy = parsed.suggestedAdjustments;

    if (!hasDual && !hasLegacy) throw new Error('Estructura inválida: falta classificationAlgorithm o suggestedAdjustments');

    if (hasDual) {
      // NUEVA estructura
      const ca = parsed.classificationAlgorithm || {};
      const ta = parsed.tradingAlgorithm || {};
      const ja = parsed.jointAnalysis || {};

      // Normalizar adjustments para mantener compatibilidad con calculateConsensus
      const adjustments = {
        metaWeights:       ca.suggestedWeightAdjustments?.metaWeights       || {},
        classification:    ca.suggestedThresholds                            || {},
        prediction: {
          invertibleTarget:   ca.suggestedThresholds?.invertibleTarget   ?? null,
          magnitudeTolerance: ca.suggestedThresholds?.magnitudeTolerance ?? null,
        },
        potentialWeights:  ca.suggestedWeightAdjustments?.potentialWeights  || {},
        resistanceWeights: ca.suggestedWeightAdjustments?.resistanceWeights || {},
        tradingConfig:     ta.suggestedConfig || {},
      };

      return {
        success:              true,
        model:                modelName,
        assessment:           parsed.overallAssessment || '',
        adjustments,
        // Secciones enriquecidas
        classificationAlgorithm: ca,
        tradingAlgorithm:         ta,
        jointAnalysis:            ja,
        reasoning:                parsed.reasoning      || '',
        expectedImpact:           parsed.expectedImpact || '',
        isDualResponse:           true,
      };
    }

    // LEGACY — estructura anterior (backward compatible)
    return {
      success:        true,
      model:          modelName,
      assessment:     parsed.overallAssessment || '',
      adjustments:    parsed.suggestedAdjustments,
      reasoning:      parsed.reasoning      || '',
      expectedImpact: parsed.expectedImpact || '',
      isDualResponse: false,
    };

  } catch (error) {
    return {
      success:     false,
      model:       modelName,
      error:       `JSON parse failed: ${error.message}`,
      rawResponse: text.slice(0, 500),
    };
  }
}

// Extraer mensaje de error legible de una respuesta axios
function extractErrorMsg(error) {
  return error.response?.data?.error?.message
    || error.response?.data?.message
    || error.response?.data?.detail
    || error.message;
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS — Gemini
// ═══════════════════════════════════════════════════════════════════

async function callGemini(prompt, apiKey) {
  const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash-002'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 3000 } },
        { timeout: 40000 }
      );
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const result = parseJSONResponse(text, 'Gemini');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      if (error.response?.status === 404) { console.warn(`[Gemini] ${model} no disponible, probando siguiente...`); continue; }
      return { success: false, error: extractErrorMsg(error), model: 'Gemini', statusCode: error.response?.status };
    }
  }
  return { success: false, error: 'Ningún modelo Gemini disponible', model: 'Gemini' };
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS — Claude
// ═══════════════════════════════════════════════════════════════════

async function callClaude(prompt, apiKey) {
  const MODELS = ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        { model, max_tokens: 3000, temperature: 0.3, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 40000 }
      );
      const text = response.data?.content?.[0]?.text || '';
      const result = parseJSONResponse(text, 'Claude');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      const msg = extractErrorMsg(error);
      if (status === 400 && (msg.toLowerCase().includes('model') || msg.toLowerCase().includes('not found'))) {
        console.warn(`[Claude] ${model} no válido, probando siguiente...`); continue;
      }
      if (status === 401) return { success: false, error: 'API key inválida', model: 'Claude', statusCode: 401 };
      return { success: false, error: msg, model: 'Claude', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Claude disponible', model: 'Claude' };
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS — OpenAI
// ═══════════════════════════════════════════════════════════════════

async function callOpenAI(prompt, apiKey) {
  for (const model of ['gpt-4o', 'gpt-4o-mini']) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 3000 },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 40000 }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const result = parseJSONResponse(text, 'OpenAI');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 429 || status === 404) { console.warn(`[OpenAI] ${model} falló (${status}), probando siguiente...`); continue; }
      if (status === 401) return { success: false, error: 'API key de OpenAI inválida', model: 'OpenAI', statusCode: 401 };
      return { success: false, error: extractErrorMsg(error), model: 'OpenAI', statusCode: status };
    }
  }
  return { success: false, error: 'Sin créditos disponibles. Recarga en platform.openai.com/usage', model: 'OpenAI', statusCode: 429 };
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS — Llama / Groq
// ═══════════════════════════════════════════════════════════════════

async function callLlamaGroq(prompt, apiKey) {
  for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192']) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 3000 },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const result = parseJSONResponse(text, 'Llama');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 400) { console.warn(`[Groq] ${model} no disponible, probando siguiente...`); continue; }
      return { success: false, error: extractErrorMsg(error), model: 'Llama', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Llama/Groq disponible', model: 'Llama' };
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS GRATUITOS — Mistral
// ═══════════════════════════════════════════════════════════════════

async function callMistral(prompt, apiKey) {
  const MODELS = ['mistral-small-latest', 'mistral-small-2503', 'open-mistral-7b'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 3000 },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const result = parseJSONResponse(text, 'Mistral');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 422) { console.warn(`[Mistral] ${model} no disponible, probando siguiente...`); continue; }
      if (status === 401) return { success: false, error: 'API key de Mistral inválida. Obtén una en console.mistral.ai', model: 'Mistral', statusCode: 401 };
      if (status === 429) return { success: false, error: 'Rate limit Mistral (1 req/s en free tier). Reintenta en unos segundos.', model: 'Mistral', statusCode: 429 };
      return { success: false, error: extractErrorMsg(error), model: 'Mistral', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Mistral disponible', model: 'Mistral' };
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS GRATUITOS — Cohere
// ═══════════════════════════════════════════════════════════════════

async function callCohere(prompt, apiKey) {
  const MODELS = ['command-r', 'command-r-plus', 'command'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.cohere.com/v1/chat',
        {
          model,
          message: prompt,
          temperature: 0.3,
          max_tokens: 3000,
          preamble: 'Eres un experto en análisis cuantitativo. Responde siempre en JSON válido sin markdown.',
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-Client-Name': 'crypto-detector',
          },
          timeout: 30000,
        }
      );
      const text = response.data?.text || response.data?.message || '';
      const result = parseJSONResponse(text, 'Cohere');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404) { console.warn(`[Cohere] ${model} no disponible, probando siguiente...`); continue; }
      if (status === 401) return { success: false, error: 'API key de Cohere inválida. Obtén una en dashboard.cohere.com', model: 'Cohere', statusCode: 401 };
      if (status === 429) return { success: false, error: 'Rate limit Cohere (20 req/min). Espera un momento.', model: 'Cohere', statusCode: 429 };
      return { success: false, error: extractErrorMsg(error), model: 'Cohere', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Cohere disponible', model: 'Cohere' };
}

// ═══════════════════════════════════════════════════════════════════
// MODELOS GRATUITOS — Cerebras
// ═══════════════════════════════════════════════════════════════════

async function callCerebras(prompt, apiKey) {
  const MODELS = ['llama-3.3-70b', 'llama3.1-70b', 'llama3.1-8b'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.cerebras.ai/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 3000 },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const result = parseJSONResponse(text, 'Cerebras');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 400) { console.warn(`[Cerebras] ${model} no disponible, probando siguiente...`); continue; }
      if (status === 401) return { success: false, error: 'API key de Cerebras inválida. Obtén una en cloud.cerebras.ai', model: 'Cerebras', statusCode: 401 };
      if (status === 429) return { success: false, error: 'Rate limit Cerebras (30 req/min). Reintenta en unos segundos.', model: 'Cerebras', statusCode: 429 };
      return { success: false, error: extractErrorMsg(error), model: 'Cerebras', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Cerebras disponible', model: 'Cerebras' };
}

// ═══════════════════════════════════════════════════════════════════
// ANÁLISIS PARALELO — todos los modelos
// Firma extendida: acepta investConfig y closedPositions
// ═══════════════════════════════════════════════════════════════════

async function analyzeWithLLMs(cycles, currentConfig, mode, apiKeys, investConfig = {}, closedPositions = []) {
  const prompt = generateAnalysisPrompt(cycles, currentConfig, mode, investConfig, closedPositions);

  const [geminiRes, claudeRes, openaiRes, llamaRes, mistralRes, cohereRes, cerebrasRes] =
    await Promise.allSettled([
      apiKeys.gemini   ? callGemini(prompt,     apiKeys.gemini)   : Promise.resolve({ success: false, model: 'Gemini',   error: 'API key no configurada' }),
      apiKeys.claude   ? callClaude(prompt,     apiKeys.claude)   : Promise.resolve({ success: false, model: 'Claude',   error: 'API key no configurada' }),
      apiKeys.openai   ? callOpenAI(prompt,     apiKeys.openai)   : Promise.resolve({ success: false, model: 'OpenAI',   error: 'API key no configurada' }),
      apiKeys.groq     ? callLlamaGroq(prompt,  apiKeys.groq)     : Promise.resolve({ success: false, model: 'Llama',    error: 'API key no configurada' }),
      apiKeys.mistral  ? callMistral(prompt,    apiKeys.mistral)  : Promise.resolve({ success: false, model: 'Mistral',  error: 'API key no configurada' }),
      apiKeys.cohere   ? callCohere(prompt,     apiKeys.cohere)   : Promise.resolve({ success: false, model: 'Cohere',   error: 'API key no configurada' }),
      apiKeys.cerebras ? callCerebras(prompt,   apiKeys.cerebras) : Promise.resolve({ success: false, model: 'Cerebras', error: 'API key no configurada' }),
    ]);

  const unwrap = (res, fallbackModel) =>
    res.status === 'fulfilled' ? res.value : { success: false, model: fallbackModel, error: 'Promise rejected' };

  return {
    gemini:   unwrap(geminiRes,   'Gemini'),
    claude:   unwrap(claudeRes,   'Claude'),
    openai:   unwrap(openaiRes,   'OpenAI'),
    llama:    unwrap(llamaRes,    'Llama'),
    mistral:  unwrap(mistralRes,  'Mistral'),
    cohere:   unwrap(cohereRes,   'Cohere'),
    cerebras: unwrap(cerebrasRes, 'Cerebras'),
  };
}

// ═══════════════════════════════════════════════════════════════════
// CONSENSO — calcula sobre hasta 7 modelos, soporta estructura dual
// ═══════════════════════════════════════════════════════════════════

function calculateConsensus(responses) {
  const successful = Object.values(responses).filter(r => r.success);
  if (successful.length < 2) {
    return { hasConsensus: false, message: 'Se necesitan al menos 2 modelos exitosos para calcular consenso' };
  }

  // ── Consenso de pesos de clasificación ─────────────────────────────────────
  const consensus = {
    metaWeights:       {},
    classification:    {},
    prediction:        {},
    potentialWeights:  {},
    resistanceWeights: {},
    tradingConfig:     {},
  };

  // Categorías de adjustments a promediar
  const adjCategories = ['metaWeights', 'classification', 'prediction', 'potentialWeights', 'resistanceWeights', 'tradingConfig'];

  adjCategories.forEach(category => {
    const allKeys = new Set();
    successful.forEach(r => {
      if (r.adjustments?.[category]) Object.keys(r.adjustments[category]).forEach(k => allKeys.add(k));
    });
    allKeys.forEach(key => {
      const values = successful
        .map(r => r.adjustments?.[category]?.[key])
        .filter(v => v !== undefined && v !== null && !isNaN(Number(v)) && Number(v) !== 0);
      if (values.length >= 2) {
        consensus[category][key] = Math.round(
          values.reduce((s, v) => s + Number(v), 0) / values.length * 1000
        ) / 1000;
      }
    });
  });

  // ── Consenso de diagnósticos de texto (mayoría) ────────────────────────────
  const dualResponses = successful.filter(r => r.isDualResponse);

  const jointInsights = dualResponses
    .map(r => r.jointAnalysis?.priorityAction)
    .filter(Boolean);

  const tradingIssues = dualResponses
    .flatMap(r => r.tradingAlgorithm?.mainIssues || [])
    .filter(Boolean);

  const classificationIssues = dualResponses
    .flatMap(r => r.classificationAlgorithm?.mainIssues || [])
    .filter(Boolean);

  return {
    hasConsensus:          true,
    consensus,
    modelsUsed:            successful.length,
    modelNames:            successful.map(r => r.model),
    dualResponseCount:     dualResponses.length,
    priorityActions:       [...new Set(jointInsights)],
    topTradingIssues:      [...new Set(tradingIssues)].slice(0, 5),
    topClassIssues:        [...new Set(classificationIssues)].slice(0, 5),
    message:               `Consenso dual calculado de ${successful.length} modelo(s): ${successful.map(r => r.model).join(', ')}`,
  };
}

module.exports = { analyzeWithLLMs, calculateConsensus };
