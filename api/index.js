// api/index.js - Backend con Upstash Redis
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

// ============================================
// CONEXIÓN A UPSTASH REDIS
// ============================================

let redis = null;

// Intentar conectar a Upstash Redis si las variables están disponibles
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    console.log('✅ Upstash Redis conectado');
  } else {
    console.log('⚠️ Variables de Redis no encontradas - funcionará sin persistencia');
  }
} catch (error) {
  console.log('⚠️ Redis no disponible:', error.message);
}

// ============================================
// MÓDULOS DE ALGORITMO (ITERACIÓN 2)
// ============================================

const algorithmConfig = require('./algorithm-config');
const boostPowerCalc = require('./boost-power-calculator');

// Usar config por defecto del módulo
const DEFAULT_CONFIG = algorithmConfig.DEFAULT_CONFIG;

// ============================================
// ENDPOINTS BÁSICOS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: '3.1-iter1-upstash',
    timestamp: new Date().toISOString(),
    redis: redis ? 'connected' : 'not available'
  });
});

// ============================================
// ENDPOINTS DE CONFIGURACIÓN
// ============================================

/**
 * GET /api/config
 * Obtener configuración actual
 */
app.get('/api/config', async (req, res) => {
  try {
    let config = { ...DEFAULT_CONFIG };
    
    // Intentar cargar desde Redis si está disponible
    if (redis) {
      try {
        const stored = await redis.get('algorithm-config');
        if (stored) {
          config = typeof stored === 'string' ? JSON.parse(stored) : stored;
        }
      } catch (error) {
        console.log('No se pudo cargar config de Redis, usando default');
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
      error: 'Error al obtener configuración',
      message: error.message
    });
  }
});

/**
 * POST /api/config
 * Guardar configuración
 */
app.post('/api/config', async (req, res) => {
  try {
    const { config } = req.body;
    
    if (!config) {
      return res.status(400).json({
        success: false,
        error: 'Se requiere objeto "config" en el body'
      });
    }
    
    // Validar usando el módulo
    const validation = algorithmConfig.validateConfig(config);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: 'Validación fallida',
        errors: validation.errors
      });
    }
    
    // Añadir metadata
    config.lastModified = new Date().toISOString();
    config.version = '3.1-iter1';
    
    // Guardar en Redis si está disponible
    if (redis) {
      try {
        await redis.set('algorithm-config', JSON.stringify(config));
        console.log('✅ Config guardada en Redis');
      } catch (error) {
        console.error('Error guardando en Redis:', error);
        return res.status(503).json({
          success: false,
          error: 'Redis no disponible para guardar',
          message: 'Configura Upstash Redis en Vercel'
        });
      }
    } else {
      return res.status(503).json({
        success: false,
        error: 'Redis no disponible',
        message: 'Configura Upstash Redis en Vercel Integrations'
      });
    }
    
    res.json({
      success: true,
      message: 'Configuración guardada correctamente',
      config: config
    });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al guardar configuración',
      message: error.message
    });
  }
});

/**
 * POST /api/config/reset
 * Resetear configuración a valores por defecto
 */
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
        console.error('Error resetting in Redis:', error);
      }
    }
    
    res.json({
      success: true,
      message: 'Configuración reseteada a valores por defecto',
      config: config
    });
  } catch (error) {
    console.error('Error resetting config:', error);
    res.status(500).json({
      success: false,
      error: 'Error al resetear configuración',
      message: error.message
    });
  }
});

// ============================================
// ENDPOINT DE CRIPTOS (con BoostPower - ITERACIÓN 2)
// ============================================

app.get('/api/crypto', async (req, res) => {
  try {
    // Obtener config actual
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
    
    // Obtener datos de CoinGecko
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage_24h=true'
    );
    
    // Calcular BoostPower para cada activo
    const cryptosWithBoost = response.data.map(crypto => {
      const { boostPower, breakdown } = boostPowerCalc.calculateBoostPower(crypto, config);
      const classification = boostPowerCalc.classifyAsset(boostPower, config.boostPowerThreshold);
      
      return {
        ...crypto,
        boostPower: boostPower,
        boostPowerPercent: Math.round(boostPower * 100),
        breakdown: breakdown,
        classification: classification.category,
        color: classification.color,
        recommendation: classification.recommendation
      };
    });
    
    // Ordenar por BoostPower descendente
    cryptosWithBoost.sort((a, b) => b.boostPower - a.boostPower);
    
    res.json({
      success: true,
      data: cryptosWithBoost,
      timestamp: new Date().toISOString(),
      config: {
        version: config.version,
        threshold: config.boostPowerThreshold
      }
    });
  } catch (error) {
    console.error('Error fetching crypto data:', error.message);
    res.status(500).json({
      success: false,
      error: 'Error al obtener datos de criptos',
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
// ENDPOINT DE METADATA (ITERACIÓN 2)
// ============================================

/**
 * GET /api/config/metadata
 * Obtener información de factores para UI
 */
app.get('/api/config/metadata', (req, res) => {
  try {
    const metadata = algorithmConfig.getFactorMetadata();
    res.json({
      success: true,
      metadata: metadata
    });
  } catch (error) {
    console.error('Error getting metadata:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener metadata'
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
