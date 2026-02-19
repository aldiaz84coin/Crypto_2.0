// llm-insights.js — 7 LLMs: Gemini + Claude + OpenAI + Llama/Groq (pago/futuro)
//                            + Mistral + Cohere + Cerebras (GRATUITOS, activos)
//
// Modelos gratuitos añadidos:
//   🔵 Mistral    mistral-small-latest  api.mistral.ai      FREE tier (sin tarjeta)
//   🟤 Cohere     command-r             api.cohere.com      FREE 1000 llamadas/mes
//   ⚡ Cerebras   llama-3.3-70b         api.cerebras.ai     FREE tier (~500 tok/s)

const axios = require('axios');

// ═══════════════════════════════════════════════════════════════════
// PROMPT
// ═══════════════════════════════════════════════════════════════════

function generateAnalysisPrompt(cycles, currentConfig, mode) {
  const modeLabel = mode === 'speculative' ? 'Especulativo (micro-caps)' : 'Generalista (alta cap)';

  let totalPredictions = 0, totalCorrect = 0;
  const categoryStats = {
    INVERTIBLE: { total: 0, correct: 0 },
    APALANCADO: { total: 0, correct: 0 },
    RUIDOSO:    { total: 0, correct: 0 }
  };

  cycles.forEach(cycle => {
    const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
    validResults.forEach(r => {
      totalPredictions++;
      if (r.correct) totalCorrect++;
      const cat = r.classification || 'RUIDOSO';
      if (categoryStats[cat]) {
        categoryStats[cat].total++;
        if (r.correct) categoryStats[cat].correct++;
      }
    });
  });

  const overallAcc = totalPredictions > 0 ? (totalCorrect / totalPredictions * 100).toFixed(1) : 0;
  const categoryAccuracy = {};
  Object.entries(categoryStats).forEach(([cat, stats]) => {
    categoryAccuracy[cat] = stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) : 0;
  });

  return `Eres un experto en análisis cuantitativo de algoritmos de predicción de activos cripto.

## CONTEXTO DEL MODELO

**Modo:** ${modeLabel}
**Ciclos analizados:** ${cycles.length}
**Predicciones totales:** ${totalPredictions}
**Accuracy general:** ${overallAcc}%

**Accuracy por categoría:**
- INVERTIBLE: ${categoryAccuracy.INVERTIBLE}% (${categoryStats.INVERTIBLE.correct}/${categoryStats.INVERTIBLE.total})
- APALANCADO: ${categoryAccuracy.APALANCADO}% (${categoryStats.APALANCADO.correct}/${categoryStats.APALANCADO.total})
- RUIDOSO: ${categoryAccuracy.RUIDOSO}% (${categoryStats.RUIDOSO.correct}/${categoryStats.RUIDOSO.total})

## CONFIGURACIÓN ACTUAL DEL ALGORITMO

**Meta-ponderaciones:**
- potential: ${currentConfig.metaWeights?.potential || 0.5}
- resistance: ${currentConfig.metaWeights?.resistance || 0.5}

**Clasificación:**
- invertibleMinBoost: ${currentConfig.classification?.invertibleMinBoost || 0.65}
- apalancadoMinBoost: ${currentConfig.classification?.apalancadoMinBoost || 0.55}

**Predicción:**
- invertibleTarget: ${currentConfig.prediction?.invertibleTarget || 30}%
- magnitudeTolerance: ${currentConfig.prediction?.magnitudeTolerance || 5}%

**Ponderaciones de Potencial:** ${JSON.stringify(currentConfig.potentialWeights || {})}
**Ponderaciones de Resistencia:** ${JSON.stringify(currentConfig.resistanceWeights || {})}

## TU TAREA

Analiza estos resultados y sugiere ajustes específicos para mejorar el accuracy.

**IMPORTANTE:** Responde SOLO con un objeto JSON válido sin markdown ni texto adicional:

{
  "overallAssessment": "Resumen de 1-2 líneas del estado del algoritmo",
  "suggestedAdjustments": {
    "metaWeights": { "potential": 0.XX, "resistance": 0.XX },
    "classification": { "invertibleMinBoost": 0.XX, "apalancadoMinBoost": 0.XX },
    "prediction": { "invertibleTarget": XX, "magnitudeTolerance": XX },
    "potentialWeights": { "atlProximity": 0.XX, "volumeSurge": 0.XX },
    "resistanceWeights": { "leverageRatio": 0.XX, "marketSaturation": 0.XX }
  },
  "reasoning": "Explicación breve de 2-3 líneas de por qué estos ajustes",
  "expectedImpact": "Predicción de mejora esperada (ej: +5% accuracy en INVERTIBLE)"
}`;
}

// ═══════════════════════════════════════════════════════════════════
// PARSER (compartido por todos los modelos)
// ═══════════════════════════════════════════════════════════════════

function parseJSONResponse(text, modelName) {
  try {
    let cleaned = text.trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.suggestedAdjustments) throw new Error('Missing suggestedAdjustments');
    return {
      success:        true,
      model:          modelName,
      assessment:     parsed.overallAssessment || '',
      adjustments:    parsed.suggestedAdjustments,
      reasoning:      parsed.reasoning || '',
      expectedImpact: parsed.expectedImpact || ''
    };
  } catch (error) {
    return {
      success:     false,
      model:       modelName,
      error:       `JSON parse failed: ${error.message}`,
      rawResponse: text.slice(0, 500)
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
// MODELOS DE PAGO (desactivados pero listos para suscripción futura)
// ═══════════════════════════════════════════════════════════════════

async function callGemini(prompt, apiKey) {
  const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash-002'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } },
        { timeout: 30000 }
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

async function callClaude(prompt, apiKey) {
  const MODELS = ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        { model, max_tokens: 2048, temperature: 0.3, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 30000 }
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

async function callOpenAI(prompt, apiKey) {
  for (const model of ['gpt-4o', 'gpt-4o-mini']) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 },
        { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
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

async function callLlamaGroq(prompt, apiKey) {
  for (const model of ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192']) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 },
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
// MODELOS GRATUITOS — NUEVOS
// ═══════════════════════════════════════════════════════════════════

/**
 * 🔵 MISTRAL — La Plateforme
 * FREE tier real, sin tarjeta de crédito requerida
 * Obtener key: https://console.mistral.ai/api-keys
 * Límites free: 1 req/s · 500K tokens/mes
 * Modelo: mistral-small-latest (7B, rápido y capaz)
 */
async function callMistral(prompt, apiKey) {
  const MODELS = ['mistral-small-latest', 'mistral-small-2503', 'open-mistral-7b'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.mistral.ai/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const result = parseJSONResponse(text, 'Mistral');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 422) {
        console.warn(`[Mistral] ${model} no disponible, probando siguiente...`); continue;
      }
      if (status === 401) return { success: false, error: 'API key de Mistral inválida. Obtén una en console.mistral.ai', model: 'Mistral', statusCode: 401 };
      if (status === 429) return { success: false, error: 'Rate limit Mistral (1 req/s en free tier). Reintenta en unos segundos.', model: 'Mistral', statusCode: 429 };
      return { success: false, error: extractErrorMsg(error), model: 'Mistral', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Mistral disponible', model: 'Mistral' };
}

/**
 * 🟤 COHERE — Command R
 * FREE trial key: 1000 llamadas/mes sin tarjeta
 * Obtener key: https://dashboard.cohere.com/api-keys
 * Límites free: 20 req/min · 1000 req/mes
 * Modelo: command-r (balanceado) o command-r-plus (más potente, mismo precio free)
 */
async function callCohere(prompt, apiKey) {
  const MODELS = ['command-r', 'command-r-plus', 'command'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.cohere.com/v1/chat',
        {
          model,
          message: prompt,           // Cohere usa "message" en lugar de messages[]
          temperature: 0.3,
          max_tokens: 2048,
          preamble: 'Eres un experto en análisis cuantitativo. Responde siempre en JSON válido sin markdown.'
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'X-Client-Name': 'crypto-detector'
          },
          timeout: 30000
        }
      );
      // Cohere devuelve el texto en response.data.text
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

/**
 * ⚡ CEREBRAS — Llama 3.3 70B ultra-rápido
 * FREE tier muy generoso (~30 req/min, miles de tokens/min)
 * Velocidad: ~500-2000 tokens/segundo (el más rápido disponible)
 * Obtener key: https://cloud.cerebras.ai/
 * Límites free: 30 req/min · 1M tokens/hora en capa gratuita
 */
async function callCerebras(prompt, apiKey) {
  const MODELS = ['llama-3.3-70b', 'llama3.1-70b', 'llama3.1-8b'];
  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.cerebras.ai/v1/chat/completions',
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2048
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 20000   // Cerebras es muy rápido, 20s es más que suficiente
        }
      );
      const text = response.data?.choices?.[0]?.message?.content || '';
      const result = parseJSONResponse(text, 'Cerebras');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 400) {
        console.warn(`[Cerebras] ${model} no disponible, probando siguiente...`); continue;
      }
      if (status === 401) return { success: false, error: 'API key de Cerebras inválida. Obtén una en cloud.cerebras.ai', model: 'Cerebras', statusCode: 401 };
      if (status === 429) return { success: false, error: 'Rate limit Cerebras (30 req/min). Reintenta en unos segundos.', model: 'Cerebras', statusCode: 429 };
      return { success: false, error: extractErrorMsg(error), model: 'Cerebras', statusCode: status };
    }
  }
  return { success: false, error: 'Ningún modelo Cerebras disponible', model: 'Cerebras' };
}

// ═══════════════════════════════════════════════════════════════════
// ANÁLISIS PARALELO — todos los modelos
// ═══════════════════════════════════════════════════════════════════

async function analyzeWithLLMs(cycles, currentConfig, mode, apiKeys) {
  const prompt = generateAnalysisPrompt(cycles, currentConfig, mode);

  // Ejecutar en paralelo: pago (si tienen key) + gratuitos (si tienen key)
  const [geminiRes, claudeRes, openaiRes, llamaRes, mistralRes, cohereRes, cerebrasRes] =
    await Promise.allSettled([
      apiKeys.gemini   ? callGemini(prompt, apiKeys.gemini)       : Promise.resolve({ success: false, model: 'Gemini',   error: 'API key no configurada' }),
      apiKeys.claude   ? callClaude(prompt, apiKeys.claude)       : Promise.resolve({ success: false, model: 'Claude',   error: 'API key no configurada' }),
      apiKeys.openai   ? callOpenAI(prompt, apiKeys.openai)       : Promise.resolve({ success: false, model: 'OpenAI',   error: 'API key no configurada' }),
      apiKeys.groq     ? callLlamaGroq(prompt, apiKeys.groq)      : Promise.resolve({ success: false, model: 'Llama',    error: 'API key no configurada' }),
      apiKeys.mistral  ? callMistral(prompt, apiKeys.mistral)     : Promise.resolve({ success: false, model: 'Mistral',  error: 'API key no configurada' }),
      apiKeys.cohere   ? callCohere(prompt, apiKeys.cohere)       : Promise.resolve({ success: false, model: 'Cohere',   error: 'API key no configurada' }),
      apiKeys.cerebras ? callCerebras(prompt, apiKeys.cerebras)   : Promise.resolve({ success: false, model: 'Cerebras', error: 'API key no configurada' }),
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
// CONSENSO — ahora calcula sobre hasta 7 modelos
// ═══════════════════════════════════════════════════════════════════

function calculateConsensus(responses) {
  const successful = Object.values(responses).filter(r => r.success);
  if (successful.length < 2) {
    return { hasConsensus: false, message: 'Se necesitan al menos 2 modelos exitosos para calcular consenso' };
  }

  const consensus = {
    metaWeights:       {},
    classification:    {},
    prediction:        {},
    potentialWeights:  {},
    resistanceWeights: {}
  };

  ['metaWeights', 'classification', 'prediction', 'potentialWeights', 'resistanceWeights'].forEach(category => {
    const allKeys = new Set();
    successful.forEach(r => {
      if (r.adjustments?.[category]) Object.keys(r.adjustments[category]).forEach(k => allKeys.add(k));
    });
    allKeys.forEach(key => {
      const values = successful
        .map(r => r.adjustments?.[category]?.[key])
        .filter(v => v !== undefined && v !== null && !isNaN(Number(v)));
      if (values.length >= 2) {
        consensus[category][key] = Math.round(values.reduce((s, v) => s + Number(v), 0) / values.length * 100) / 100;
      }
    });
  });

  return {
    hasConsensus: true,
    consensus,
    modelsUsed:   successful.length,
    modelNames:   successful.map(r => r.model),
    message:      `Consenso calculado de ${successful.length} modelo(s): ${successful.map(r => r.model).join(', ')}`
  };
}

module.exports = { analyzeWithLLMs, calculateConsensus };
