// llm-insights.js - Integración con 4 LLMs para análisis de algoritmo

const axios = require('axios');

/**
 * Generar prompt estructurado con datos de ciclos
 */
function generateAnalysisPrompt(cycles, currentConfig, mode) {
  const modeLabel = mode === 'speculative' ? 'Especulativo (micro-caps)' : 'Generalista (alta cap)';
  
  // Resumir resultados agregados
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
- invertibleMaxMarketCap: $${((currentConfig.classification?.invertibleMaxMarketCap || 2e9) / 1e9).toFixed(1)}B
- apalancadoMinBoost: ${currentConfig.classification?.apalancadoMinBoost || 0.55}

**Predicción:**
- invertibleTarget: ${currentConfig.prediction?.invertibleTarget || 30}%
- apalancadoTarget: ${currentConfig.prediction?.apalancadoTarget || 15}%
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
    "potentialWeights": { "atlProximity": 0.XX, "volumeSurge": 0.XX, ... },
    "resistanceWeights": { "leverageRatio": 0.XX, "marketSaturation": 0.XX, ... }
  },
  "reasoning": "Explicación breve de 2-3 líneas de por qué estos ajustes",
  "expectedImpact": "Predicción de mejora esperada (ej: +5% accuracy en INVERTIBLE)"
}

Asegúrate de que TODOS los valores numéricos sean válidos y estén en los rangos correctos (0-1 para ponderaciones, porcentajes positivos para targets).`;
}

/**
 * Llamar a Gemini (Google AI)
 */
async function callGemini(prompt, apiKey) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048
        }
      },
      { timeout: 30000 }
    );
    
    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseJSONResponse(text, 'Gemini');
  } catch (error) {
    console.error('Gemini error:', error.message);
    return { success: false, error: error.message, model: 'Gemini' };
  }
}

/**
 * Llamar a Claude (Anthropic)
 */
async function callClaude(prompt, apiKey) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
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
    return parseJSONResponse(text, 'Claude');
  } catch (error) {
    console.error('Claude error:', error.message);
    return { success: false, error: error.message, model: 'Claude' };
  }
}

/**
 * Llamar a GPT-4 (OpenAI)
 */
async function callOpenAI(prompt, apiKey) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
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
    return parseJSONResponse(text, 'OpenAI');
  } catch (error) {
    console.error('OpenAI error:', error.message);
    return { success: false, error: error.message, model: 'OpenAI' };
  }
}

/**
 * Llamar a Llama via Groq
 */
async function callLlamaGroq(prompt, apiKey) {
  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
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
    return parseJSONResponse(text, 'Llama');
  } catch (error) {
    console.error('Llama/Groq error:', error.message);
    return { success: false, error: error.message, model: 'Llama' };
  }
}

/**
 * Parsear respuesta JSON de cualquier LLM (eliminar markdown si existe)
 */
function parseJSONResponse(text, modelName) {
  try {
    // Limpiar markdown code fences
    let cleaned = text.trim();
    cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    cleaned = cleaned.trim();
    
    const parsed = JSON.parse(cleaned);
    
    // Validar estructura
    if (!parsed.suggestedAdjustments) {
      throw new Error('Missing suggestedAdjustments');
    }
    
    return {
      success: true,
      model: modelName,
      assessment: parsed.overallAssessment || '',
      adjustments: parsed.suggestedAdjustments,
      reasoning: parsed.reasoning || '',
      expectedImpact: parsed.expectedImpact || ''
    };
  } catch (error) {
    console.error(`${modelName} JSON parse error:`, error.message);
    return {
      success: false,
      model: modelName,
      error: `JSON parse failed: ${error.message}`,
      rawResponse: text.slice(0, 500)
    };
  }
}

/**
 * Analizar con los 4 LLMs en paralelo
 */
async function analyzeWithLLMs(cycles, currentConfig, mode, apiKeys) {
  const prompt = generateAnalysisPrompt(cycles, currentConfig, mode);
  
  const [geminiRes, claudeRes, openaiRes, llamaRes] = await Promise.allSettled([
    apiKeys.gemini ? callGemini(prompt, apiKeys.gemini) : Promise.resolve({ success: false, model: 'Gemini', error: 'API key not configured' }),
    apiKeys.claude ? callClaude(prompt, apiKeys.claude) : Promise.resolve({ success: false, model: 'Claude', error: 'API key not configured' }),
    apiKeys.openai ? callOpenAI(prompt, apiKeys.openai) : Promise.resolve({ success: false, model: 'OpenAI', error: 'API key not configured' }),
    apiKeys.groq   ? callLlamaGroq(prompt, apiKeys.groq) : Promise.resolve({ success: false, model: 'Llama', error: 'API key not configured' })
  ]);
  
  return {
    gemini: geminiRes.status === 'fulfilled' ? geminiRes.value : { success: false, model: 'Gemini', error: 'Promise rejected' },
    claude: claudeRes.status === 'fulfilled' ? claudeRes.value : { success: false, model: 'Claude', error: 'Promise rejected' },
    openai: openaiRes.status === 'fulfilled' ? openaiRes.value : { success: false, model: 'OpenAI', error: 'Promise rejected' },
    llama:  llamaRes.status  === 'fulfilled' ? llamaRes.value  : { success: false, model: 'Llama', error: 'Promise rejected' }
  };
}

/**
 * Calcular consenso de ajustes (cuando 3+ modelos coinciden en dirección)
 */
function calculateConsensus(responses) {
  const successful = Object.values(responses).filter(r => r.success);
  if (successful.length < 2) {
    return { hasConsensus: false, message: 'Necesitas al menos 2 modelos exitosos para calcular consenso' };
  }
  
  const consensus = {
    metaWeights: {},
    classification: {},
    prediction: {},
    potentialWeights: {},
    resistanceWeights: {}
  };
  
  // Para cada parámetro, calcular promedio de los modelos que lo sugirieron
  const categories = ['metaWeights', 'classification', 'prediction', 'potentialWeights', 'resistanceWeights'];
  
  categories.forEach(category => {
    const allKeys = new Set();
    successful.forEach(r => {
      if (r.adjustments?.[category]) {
        Object.keys(r.adjustments[category]).forEach(k => allKeys.add(k));
      }
    });
    
    allKeys.forEach(key => {
      const values = successful
        .map(r => r.adjustments?.[category]?.[key])
        .filter(v => v !== undefined && v !== null && !isNaN(v));
      
      if (values.length >= 2) {  // Al menos 2 modelos sugieren este parámetro
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        consensus[category][key] = Math.round(avg * 100) / 100;  // 2 decimales
      }
    });
  });
  
  return {
    hasConsensus: true,
    consensus,
    modelsUsed: successful.length,
    message: `Consenso calculado de ${successful.length} modelos exitosos`
  };
}

module.exports = {
  analyzeWithLLMs,
  calculateConsensus
};
