// config-endpoints.js - Endpoints para gestionar configuración del algoritmo

const { DEFAULT_ALGORITHM_CONFIG } = require('./algorithm-config-advanced');

module.exports = function(app, kvHelpers) {

// ============================================
// ENDPOINTS DE CONFIGURACIÓN
// ============================================

/**
 * GET /api/config
 * Obtener configuración actual del algoritmo
 */
app.get('/api/config', async (req, res) => {
  try {
    const userId = 'default'; // Por ahora todos usan la misma config
    
    let config = DEFAULT_ALGORITHM_CONFIG;
    
    // Intentar cargar desde KV si está disponible
    if (kvHelpers) {
      try {
        const stored = await kvHelpers.get(`algorithm-config:${userId}`);
        if (stored && stored.value) {
          config = JSON.parse(stored.value);
        }
      } catch (error) {
        console.log('Using default config (KV error):', error.message);
      }
    }

    res.json({
      success: true,
      config
    });

  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({
      error: 'Error al obtener configuración',
      message: error.message
    });
  }
});

/**
 * POST /api/config
 * Guardar nueva configuración
 */
app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    const userId = 'default';

    if (!config) {
      return res.status(400).json({
        error: 'Configuración requerida'
      });
    }

    // Validar que tenga la estructura correcta
    if (!config.metaWeights || !config.factorWeights || !config.thresholds) {
      return res.status(400).json({
        error: 'Configuración incompleta',
        message: 'Debe incluir metaWeights, factorWeights y thresholds'
      });
    }

    // Validar que meta-weights sumen ~1.0
    const metaSum = config.metaWeights.quantitative + config.metaWeights.qualitative;
    if (Math.abs(metaSum - 1.0) > 0.01) {
      return res.status(400).json({
        error: 'Meta-weights inválidos',
        message: `Deben sumar 1.0 (actual: ${metaSum.toFixed(2)})`
      });
    }

    // Guardar en KV
    if (kvHelpers) {
      try {
        await kvHelpers.set(`algorithm-config:${userId}`, JSON.stringify(config));
      } catch (error) {
        console.error('Error saving to KV:', error);
        return res.status(500).json({
          error: 'Error al guardar configuración',
          message: error.message
        });
      }
    }

    res.json({
      success: true,
      message: 'Configuración guardada correctamente',
      config
    });

  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({
      error: 'Error al guardar configuración',
      message: error.message
    });
  }
});

/**
 * POST /api/config/reset
 * Resetear a configuración por defecto
 */
app.post('/api/config/reset', async (req, res) => {
  try {
    const userId = 'default';

    // Guardar config por defecto
    if (kvHelpers) {
      try {
        await kvHelpers.set(
          `algorithm-config:${userId}`,
          JSON.stringify(DEFAULT_ALGORITHM_CONFIG)
        );
      } catch (error) {
        console.error('Error resetting config:', error);
      }
    }

    res.json({
      success: true,
      message: 'Configuración reseteada a valores por defecto',
      config: DEFAULT_ALGORITHM_CONFIG
    });

  } catch (error) {
    console.error('Error resetting config:', error);
    res.status(500).json({
      error: 'Error al resetear configuración',
      message: error.message
    });
  }
});

/**
 * GET /api/config/metadata
 * Obtener metadata de factores (para UI)
 */
app.get('/api/config/metadata', (req, res) => {
  try {
    const metadata = {
      metaWeights: {
        quantitative: {
          name: 'Cuantitativos',
          description: 'Factores basados en datos numéricos y métricas',
          min: 0,
          max: 1,
          step: 0.01
        },
        qualitative: {
          name: 'Cualitativos',
          description: 'Factores basados en sentimiento y análisis cualitativo',
          min: 0,
          max: 1,
          step: 0.01
        }
      },
      factorWeights: {
        volume: {
          name: 'Volumen 24h',
          category: 'quantitative',
          description: 'Volumen de trading en 24 horas',
          available: true,
          min: 0,
          max: 0.3,
          step: 0.01
        },
        marketCap: {
          name: 'Market Cap Ratio',
          category: 'quantitative',
          description: 'Capitalización de mercado vs Bitcoin',
          available: true,
          min: 0,
          max: 0.2,
          step: 0.01
        },
        volatility: {
          name: 'Volatilidad',
          category: 'quantitative',
          description: 'Volatilidad del precio',
          available: true,
          min: 0,
          max: 0.2,
          step: 0.01
        },
        historicalLow: {
          name: 'Historical Low',
          category: 'quantitative',
          description: '% sobre mínimo histórico',
          available: true,
          min: 0,
          max: 0.15,
          step: 0.01
        },
        googleTrends: {
          name: 'Google Trends',
          category: 'quantitative',
          description: 'Tendencia de búsquedas en Google',
          available: true,
          min: 0,
          max: 0.2,
          step: 0.01
        },
        fearGreedIndex: {
          name: 'Fear & Greed',
          category: 'qualitative',
          description: 'Índice de miedo y avaricia del mercado',
          available: true,
          min: 0,
          max: 0.1,
          step: 0.01
        },
        newsVolume: {
          name: 'Volumen de Noticias',
          category: 'qualitative',
          description: 'Cantidad y sentimiento de noticias',
          available: true,
          min: 0,
          max: 0.25,
          step: 0.01
        },
        newsCount: {
          name: 'Cantidad de Noticias',
          category: 'qualitative',
          description: 'Número de noticias relevantes',
          available: true,
          min: 0,
          max: 0.15,
          step: 0.01
        }
      },
      thresholds: {
        volumeMin: {
          name: 'Volumen Mínimo',
          description: 'Volumen mínimo para puntuar',
          unit: 'USD',
          min: 1000000,
          max: 500000000,
          step: 1000000
        },
        volumeMax: {
          name: 'Volumen Máximo',
          description: 'Volumen máximo para normalización',
          unit: 'USD',
          min: 1000000000,
          max: 50000000000,
          step: 1000000000
        },
        marketCapRatioMin: {
          name: 'Market Cap Ratio Mín',
          description: 'Ratio mínimo vs BTC',
          unit: 'ratio',
          min: 0.0001,
          max: 0.01,
          step: 0.0001
        },
        marketCapRatioMax: {
          name: 'Market Cap Ratio Máx',
          description: 'Ratio máximo vs BTC',
          unit: 'ratio',
          min: 0.1,
          max: 1.0,
          step: 0.05
        },
        volatilityMin: {
          name: 'Volatilidad Mínima',
          description: 'Volatilidad mínima deseada',
          unit: '%',
          min: 0.01,
          max: 0.20,
          step: 0.01
        },
        volatilityMax: {
          name: 'Volatilidad Máxima',
          description: 'Volatilidad máxima tolerable',
          unit: '%',
          min: 0.30,
          max: 1.0,
          step: 0.05
        },
        historicalLowPercentile: {
          name: 'Percentil Historical Low',
          description: '% sobre mínimo para considerar oportunidad',
          unit: '%',
          min: 10,
          max: 50,
          step: 5
        },
        searchIncreaseMin: {
          name: 'Incremento Búsquedas Mín',
          description: 'Incremento mínimo de búsquedas',
          unit: '%',
          min: 10,
          max: 100,
          step: 10
        },
        searchIncreaseMax: {
          name: 'Incremento Búsquedas Máx',
          description: 'Incremento máximo de búsquedas',
          unit: '%',
          min: 200,
          max: 500,
          step: 50
        },
        fearGreedOptimalMin: {
          name: 'Fear & Greed Óptimo Mín',
          description: 'Inicio de zona óptima (miedo)',
          unit: '0-100',
          min: 0,
          max: 30,
          step: 5
        },
        fearGreedOptimalMax: {
          name: 'Fear & Greed Óptimo Máx',
          description: 'Fin de zona óptima (miedo moderado)',
          unit: '0-100',
          min: 35,
          max: 60,
          step: 5
        },
        newsCountMin: {
          name: 'Noticias Mínimas',
          description: 'Cantidad mínima de noticias',
          unit: 'count',
          min: 1,
          max: 10,
          step: 1
        },
        newsCountMax: {
          name: 'Noticias Máximas',
          description: 'Cantidad máxima para normalización',
          unit: 'count',
          min: 50,
          max: 200,
          step: 10
        },
        newsSentimentMin: {
          name: 'Sentimiento Mínimo',
          description: 'Sentimiento mínimo positivo deseado',
          unit: '-1 a +1',
          min: 0,
          max: 0.5,
          step: 0.1
        }
      }
    };

    res.json({
      success: true,
      metadata
    });

  } catch (error) {
    console.error('Error getting metadata:', error);
    res.status(500).json({
      error: 'Error al obtener metadata',
      message: error.message
    });
  }
});

};
