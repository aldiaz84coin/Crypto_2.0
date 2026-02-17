// api/index.js - Backend Completo Iteración 3
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Packer } = require('docx');

const app = express();

app.use(cors());
app.use(express.json());

// ============================================
// CONEXIÓN REDIS
// ============================================

let redis = null;

try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    console.log('✅ Upstash Redis conectado');
  } else {
    console.log('⚠️ Redis no disponible');
  }
} catch (error) {
  console.log('⚠️ Redis error:', error.message);
}

// ============================================
// MÓDULOS
// ============================================

const algorithmConfig = require('./algorithm-config');
const boostPowerCalc = require('./boost-power-calculator');
const dataSources = require('./data-sources');
const cyclesManager = require('./cycles-manager');
const reportGenerator = require('./report-generator');

const DEFAULT_CONFIG = algorithmConfig.DEFAULT_CONFIG;

// ============================================
// ENDPOINTS BÁSICOS
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: '3.2-final',
    timestamp: new Date().toISOString(),
    redis: redis ? 'connected' : 'not available'
  });
});

// ============================================
// ENDPOINT DE STATUS COMPLETO (NUEVO)
// ============================================

const apiHealthCheck = require('./api-health-check');

/**
 * GET /api/status/complete
 * Estado completo de todas las APIs y fuentes de datos
 */
app.get('/api/status/complete', async (req, res) => {
  try {
    const status = await apiHealthCheck.checkAllAPIs();
    
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    console.error('Error checking APIs:', error);
    res.status(500).json({
      success: false,
      error: 'Error al verificar estado de APIs',
      message: error.message
    });
  }
});

// ============================================
// ENDPOINTS DE CONFIGURACIÓN
// ============================================

app.get('/api/config', async (req, res) => {
  try {
    let config = { ...DEFAULT_CONFIG };
    
    if (redis) {
      try {
        const stored = await redis.get('algorithm-config');
        if (stored) {
          config = typeof stored === 'string' ? JSON.parse(stored) : stored;
        }
      } catch (error) {
        console.log('Usando config por defecto');
      }
    }
    
    res.json({
      success: true,
      config: config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener configuración'
    });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere objeto "config"'
      });
    }
    
    const validation = algorithmConfig.validateConfig(config);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        errors: validation.errors
      });
    }
    
    config.lastModified = new Date().toISOString();
    config.version = '3.1-iter3';
    
    if (redis) {
      try {
        await redis.set('algorithm-config', JSON.stringify(config));
      } catch (error) {
        return res.status(503).json({
          success: false,
          error: 'Redis no disponible'
        });
      }
    } else {
      return res.status(503).json({
        success: false,
        error: 'Redis no disponible'
      });
    }
    
    res.json({
      success: true,
      message: 'Configuración guardada',
      config: config
    });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({
      success: false,
      error: 'Error al guardar configuración'
    });
  }
});

app.post('/api/config/reset', async (req, res) => {
  try {
    const config = { 
      ...DEFAULT_CONFIG,
      lastModified: new Date().toISOString()
    };
    
    if (redis) {
      try {
        await redis.set('algorithm-config', JSON.stringify(config));
      } catch (error) {
        console.error('Error resetting:', error);
      }
    }
    
    res.json({
      success: true,
      message: 'Configuración reseteada',
      config: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al resetear'
    });
  }
});

app.get('/api/config/metadata', (req, res) => {
  try {
    const metadata = algorithmConfig.getFactorMetadata();
    res.json({
      success: true,
      metadata: metadata
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener metadata'
    });
  }
});

// ============================================
// ENDPOINTS DE DATOS
// ============================================

app.get('/api/crypto', async (req, res) => {
  try {
    let config = { ...DEFAULT_CONFIG };
    if (redis) {
      try {
        const stored = await redis.get('algorithm-config');
        if (stored) {
          config = typeof stored === 'string' ? JSON.parse(stored) : stored;
        }
      } catch (error) {}
    }
    
    // Obtener datos de CoinGecko
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage_24h=true'
    );
    
    // Obtener datos externos (Fear & Greed, News)
    const fearGreed = await dataSources.getFearGreedIndex();
    const news = await dataSources.getCryptoNews('', 5);
    
    const externalData = {
      fearGreed: fearGreed.success ? fearGreed : null,
      news: news.success ? news : null
    };
    
    // Calcular BoostPower con datos reales
    const cryptosWithBoost = response.data.map(crypto => {
      const { boostPower, breakdown } = boostPowerCalc.calculateBoostPower(crypto, config, externalData);
      const classification = boostPowerCalc.classifyAsset(boostPower, config.boostPowerThreshold);
      
      return {
        ...crypto,
        boostPower: boostPower,
        boostPowerPercent: Math.round(boostPower * 100),
        breakdown: breakdown,
        classification: classification.category,
        color: classification.color,
        recommendation: classification.recommendation,
        predictedChange: (boostPower - 0.5) * 30 // Predicción simple basada en BoostPower
      };
    });
    
    cryptosWithBoost.sort((a, b) => b.boostPower - a.boostPower);
    
    res.json({
      success: true,
      data: cryptosWithBoost,
      externalData: {
        fearGreed: fearGreed.success ? { value: fearGreed.value, classification: fearGreed.classification } : null,
        newsCount: news.success ? news.count : 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching crypto:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener datos'
    });
  }
});

app.get('/api/data/sources-status', async (req, res) => {
  try {
    const status = await dataSources.checkAPIsStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al verificar APIs'
    });
  }
});

// ============================================
// ENDPOINTS DE CICLOS
// ============================================

app.post('/api/cycles/start', async (req, res) => {
  try {
    if (!redis) {
      return res.status(503).json({
        success: false,
        error: 'Redis no disponible. Configura Upstash Redis.'
      });
    }
    
    const { snapshot } = req.body;
    
    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere array "snapshot" con datos de activos'
      });
    }
    
    // Obtener config actual
    let config = { ...DEFAULT_CONFIG };
    try {
      const stored = await redis.get('algorithm-config');
      if (stored) {
        config = typeof stored === 'string' ? JSON.parse(stored) : stored;
      }
    } catch (error) {}
    
    // Crear ciclo
    const cycle = await cyclesManager.createCycle(redis, snapshot, config);
    
    res.json({
      success: true,
      message: 'Ciclo iniciado correctamente',
      cycle: {
        id: cycle.id,
        startTime: cycle.startTime,
        endTime: cycle.endTime,
        assetsCount: snapshot.length
      }
    });
  } catch (error) {
    console.error('Error starting cycle:', error);
    res.status(500).json({
      success: false,
      error: 'Error al iniciar ciclo',
      message: error.message
    });
  }
});

app.get('/api/cycles/active', async (req, res) => {
  try {
    if (!redis) {
      return res.json({ success: true, cycles: [] });
    }
    
    const cycleIds = await cyclesManager.getActiveCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, cycleIds);
    
    // Añadir tiempo restante
    const now = Date.now();
    cycles.forEach(cycle => {
      cycle.timeRemaining = Math.max(0, cycle.endTime - now);
      cycle.hoursRemaining = (cycle.timeRemaining / (1000 * 60 * 60)).toFixed(1);
    });
    
    res.json({
      success: true,
      cycles
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener ciclos activos'
    });
  }
});

app.get('/api/cycles/pending', async (req, res) => {
  try {
    if (!redis) {
      return res.json({ success: true, cycles: [] });
    }
    
    const pending = await cyclesManager.detectPendingCycles(redis);
    
    res.json({
      success: true,
      cycles: pending
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener ciclos pendientes'
    });
  }
});

app.post('/api/cycles/:cycleId/complete', async (req, res) => {
  try {
    if (!redis) {
      return res.status(503).json({
        success: false,
        error: 'Redis no disponible'
      });
    }
    
    const { cycleId } = req.params;
    
    // Obtener precios actuales
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1'
    );
    
    const cycle = await cyclesManager.completeCycle(redis, cycleId, response.data);
    
    res.json({
      success: true,
      message: 'Ciclo completado',
      cycle: {
        id: cycle.id,
        metrics: cycle.metrics,
        completedAt: cycle.completedAt
      }
    });
  } catch (error) {
    console.error('Error completing cycle:', error);
    res.status(500).json({
      success: false,
      error: 'Error al completar ciclo',
      message: error.message
    });
  }
});

app.get('/api/cycles/history', async (req, res) => {
  try {
    if (!redis) {
      return res.json({ success: true, cycles: [] });
    }
    
    const cycleIds = await cyclesManager.getCompletedCycles(redis);
    const cycles = await cyclesManager.getCyclesDetails(redis, cycleIds);
    
    res.json({
      success: true,
      cycles
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener historial'
    });
  }
});

app.get('/api/cycles/:cycleId', async (req, res) => {
  try {
    if (!redis) {
      return res.status(503).json({
        success: false,
        error: 'Redis no disponible'
      });
    }
    
    const { cycleId } = req.params;
    const cycle = await cyclesManager.getCycle(redis, cycleId);
    
    if (!cycle) {
      return res.status(404).json({
        success: false,
        error: 'Ciclo no encontrado'
      });
    }
    
    res.json({
      success: true,
      cycle
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener ciclo'
    });
  }
});

app.get('/api/cycles/stats/global', async (req, res) => {
  try {
    if (!redis) {
      return res.json({ 
        success: true, 
        stats: { totalCycles: 0, totalPredictions: 0, avgSuccessRate: 0 } 
      });
    }
    
    const stats = await cyclesManager.getGlobalStats(redis);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al obtener estadísticas'
    });
  }
});

// ============================================
// ENDPOINT DE INFORMES
// ============================================

app.get('/api/cycles/:cycleId/report', async (req, res) => {
  try {
    if (!redis) {
      return res.status(503).json({
        success: false,
        error: 'Redis no disponible'
      });
    }
    
    const { cycleId } = req.params;
    const cycle = await cyclesManager.getCycle(redis, cycleId);
    
    if (!cycle) {
      return res.status(404).json({
        success: false,
        error: 'Ciclo no encontrado'
      });
    }
    
    if (cycle.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: 'El ciclo aún no está completado'
      });
    }
    
    // Generar documento Word
    const doc = reportGenerator.generateCycleReport(cycle);
    
    // Convertir a buffer
    const buffer = await Packer.toBuffer(doc);
    
    // Enviar como descarga
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=Informe_Ciclo_${cycleId}.docx`);
    res.send(buffer);
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({
      success: false,
      error: 'Error al generar informe',
      message: error.message
    });
  }
});

// ============================================
// DESARROLLO LOCAL
// ============================================

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Redis: ${redis ? 'Connected' : 'Not available'}`);
  });
}

// ============================================
// EXPORTAR PARA VERCEL
// ============================================

module.exports = app;
