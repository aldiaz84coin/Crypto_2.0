// llm-insights.js — FIXED: modelos actualizados + retry en 429
// Cambios vs original:
//   Gemini:  gemini-1.5-flash           → gemini-2.0-flash  (1.5-flash deprecado → 404)
//   Claude:  claude-sonnet-4-20250514   → claude-sonnet-4-5  (nombre incorrecto → 400)
//   OpenAI:  gpt-4o sin retry           → gpt-4o-mini con retry en 429
//   Llama:   sin cambios (funcionaba)

const axios = require('axios');

/**
 * Generar prompt estructurado con datos de ciclos
 */
function generateAnalysisPrompt(cycles, currentConfig, mode) {
  const modeLabel = mode === 'speculative' ? 'Especulativo (micro-caps)' : 'Generalista (alta cap)';
  
  let totalPredictions = 0, totalCorrect = 0;
  const categoryStats = { INVERTIBLE: {total: 0, correct: 0}, APALANCADO: {total: 0, correct: 0}, RUIDOSO: {total: 0, correct: 0} };
  
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

Analiza estos resultados y sugiere ajustes específicos a los parámetros del algoritmo para mejorar el accuracy.

**IMPORTANTE:** Responde SOLO con un objeto JSON válido sin markdown, con esta estructura exacta:

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

// ── GEMINI ────────────────────────────────────────────────────────────────────
// FIX: gemini-1.5-flash estaba deprecado → 404. Usar gemini-2.0-flash.
// Fallback a gemini-1.5-flash-latest si 2.0 no está disponible en la key.

async function callGemini(prompt, apiKey) {
  const MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash-latest', 'gemini-1.5-flash-002'];

  for (const model of MODELS) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
        },
        { timeout: 30000 }
      );
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const result = parseJSONResponse(text, 'Gemini');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      // 404 = modelo no disponible → probar siguiente
      if (status === 404) {
        console.warn(`[Gemini] Modelo ${model} no disponible (404), probando siguiente...`);
        continue;
      }
      // Cualquier otro error → fallar inmediatamente
      console.error(`[Gemini] Error con ${model}:`, error.response?.data?.error?.message || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        model: 'Gemini',
        modelTried: model,
        statusCode: status
      };
    }
  }

  return { success: false, error: 'Ningún modelo Gemini disponible (404 en todos los intentos)', model: 'Gemini' };
}

// ── CLAUDE ────────────────────────────────────────────────────────────────────
// FIX: 'claude-sonnet-4-20250514' no existe → 400 "model not found"
// Modelos válidos actuales: claude-sonnet-4-5, claude-3-5-sonnet-20241022

async function callClaude(prompt, apiKey) {
  const MODELS = [
    'claude-sonnet-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022'
  ];

  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: 2048,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }]
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          timeout: 30000
        }
      );
      const text = response.data?.content?.[0]?.text || '';
      const result = parseJSONResponse(text, 'Claude');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      const errMsg = error.response?.data?.error?.message || error.message;
      // 400 con "model" en el mensaje = modelo no encontrado → probar siguiente
      if (status === 400 && (errMsg.toLowerCase().includes('model') || errMsg.toLowerCase().includes('not found'))) {
        console.warn(`[Claude] Modelo ${model} no válido (400), probando siguiente...`);
        continue;
      }
      // 401 = API key inválida
      if (status === 401) {
        return { success: false, error: 'API key inválida o sin permisos', model: 'Claude', statusCode: 401 };
      }
      console.error(`[Claude] Error con ${model}:`, errMsg);
      return { success: false, error: errMsg, model: 'Claude', modelTried: model, statusCode: status };
    }
  }

  return { success: false, error: 'Ningún modelo Claude disponible', model: 'Claude' };
}

// ── OPENAI ────────────────────────────────────────────────────────────────────
// FIX: 429 = sin créditos / rate limit en gpt-4o
// Estrategia: intentar gpt-4o → si 429, usar gpt-4o-mini (mucho más barato)
// gpt-4o-mini cuesta ~15x menos y es suficiente para análisis de configuración

async function callOpenAI(prompt, apiKey) {
  const MODELS = [
    { id: 'gpt-4o-mini', fallbackReason: null },         // primero el más barato / sin límite
    { id: 'gpt-4o',      fallbackReason: 'primary' },   // si mini falla, intentar 4o
  ];

  // Intentar primero gpt-4o; si falla con 429 (sin créditos/rate limit), caer a mini
  const orderedModels = [
    { id: 'gpt-4o' },
    { id: 'gpt-4o-mini' }
  ];

  for (const { id: model } of orderedModels) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
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
      const result = parseJSONResponse(text, 'OpenAI');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      const errMsg = error.response?.data?.error?.message || error.message;

      if (status === 429) {
        // Rate limit o sin créditos → probar modelo más barato
        console.warn(`[OpenAI] Rate limit / sin créditos en ${model} (429), probando siguiente...`);
        continue;
      }
      if (status === 401) {
        return { success: false, error: 'API key de OpenAI inválida', model: 'OpenAI', statusCode: 401 };
      }
      if (status === 404) {
        console.warn(`[OpenAI] Modelo ${model} no disponible (404), probando siguiente...`);
        continue;
      }
      console.error(`[OpenAI] Error con ${model}:`, errMsg);
      return { success: false, error: errMsg, model: 'OpenAI', modelTried: model, statusCode: status };
    }
  }

  return {
    success: false,
    error: 'Sin créditos disponibles en OpenAI (429). Recarga en platform.openai.com/usage',
    model: 'OpenAI',
    statusCode: 429
  };
}

// ── GROQ / LLAMA ──────────────────────────────────────────────────────────────
// Sin cambios — funcionaba correctamente

async function callLlamaGroq(prompt, apiKey) {
  const MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama3-70b-8192'];

  for (const model of MODELS) {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
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
      const result = parseJSONResponse(text, 'Llama');
      if (result.success) result.modelUsed = model;
      return result;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404 || status === 400) {
        console.warn(`[Groq] Modelo ${model} no disponible, probando siguiente...`);
        continue;
      }
      console.error('[Groq] Error:', error.response?.data?.error?.message || error.message);
      return { success: false, error: error.response?.data?.error?.message || error.message, model: 'Llama', statusCode: status };
    }
  }

  return { success: false, error: 'Ningún modelo Llama/Groq disponible', model: 'Llama' };
}

// ── PARSER ────────────────────────────────────────────────────────────────────

function parseJSONResponse(text, modelName) {
  try {
    let cleaned = text.trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.suggestedAdjustments) throw new Error('Missing suggestedAdjustments');
    return {
      success: true,
      model: modelName,
      assessment: parsed.overallAssessment || '',
      adjustments: parsed.suggestedAdjustments,
      reasoning: parsed.reasoning || '',
      expectedImpact: parsed.expectedImpact || ''
    };
  } catch (error) {
    return { success: false, model: modelName, error: `JSON parse failed: ${error.message}`, rawResponse: text.slice(0, 500) };
  }
}

// ── ANÁLISIS PARALELO ─────────────────────────────────────────────────────────

async function analyzeWithLLMs(cycles, currentConfig, mode, apiKeys) {
  const prompt = generateAnalysisPrompt(cycles, currentConfig, mode);
  
  const [geminiRes, claudeRes, openaiRes, llamaRes] = await Promise.allSettled([
    apiKeys.gemini ? callGemini(prompt, apiKeys.gemini)       : Promise.resolve({ success: false, model: 'Gemini', error: 'API key not configured' }),
    apiKeys.claude ? callClaude(prompt, apiKeys.claude)       : Promise.resolve({ success: false, model: 'Claude', error: 'API key not configured' }),
    apiKeys.openai ? callOpenAI(prompt, apiKeys.openai)       : Promise.resolve({ success: false, model: 'OpenAI', error: 'API key not configured' }),
    apiKeys.groq   ? callLlamaGroq(prompt, apiKeys.groq)      : Promise.resolve({ success: false, model: 'Llama',  error: 'API key not configured' })
  ]);
  
  return {
    gemini: geminiRes.status === 'fulfilled' ? geminiRes.value : { success: false, model: 'Gemini', error: 'Promise rejected' },
    claude: claudeRes.status === 'fulfilled' ? claudeRes.value : { success: false, model: 'Claude', error: 'Promise rejected' },
    openai: openaiRes.status === 'fulfilled' ? openaiRes.value : { success: false, model: 'OpenAI', error: 'Promise rejected' },
    llama:  llamaRes.status  === 'fulfilled' ? llamaRes.value  : { success: false, model: 'Llama',  error: 'Promise rejected' }
  };
}

// ── CONSENSO ──────────────────────────────────────────────────────────────────

function calculateConsensus(responses) {
  const successful = Object.values(responses).filter(r => r.success);
  if (successful.length < 2) {
    return { hasConsensus: false, message: 'Necesitas al menos 2 modelos exitosos para calcular consenso' };
  }
  
  const consensus = { metaWeights: {}, classification: {}, prediction: {}, potentialWeights: {}, resistanceWeights: {} };
  const categories = ['metaWeights', 'classification', 'prediction', 'potentialWeights', 'resistanceWeights'];
  
  categories.forEach(category => {
    const allKeys = new Set();
    successful.forEach(r => { if (r.adjustments?.[category]) Object.keys(r.adjustments[category]).forEach(k => allKeys.add(k)); });
    allKeys.forEach(key => {
      const values = successful.map(r => r.adjustments?.[category]?.[key]).filter(v => v !== undefined && !isNaN(v));
      if (values.length >= 2) consensus[category][key] = Math.round(values.reduce((s, v) => s + v, 0) / values.length * 100) / 100;
    });
  });
  
  return { hasConsensus: true, consensus, modelsUsed: successful.length, message: `Consenso de ${successful.length} modelos` };
}

module.exports = { analyzeWithLLMs, calculateConsensus };
