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
// CONFIGURACIÓN POR DEFECTO
// ============================================

const DEFAULT_CONFIG = {
  version: '3.1-iter1',
  quantitativeWeight: 0.60,
  qualitativeWeight: 0.40,
  boostPowerThreshold: 0.40,
  lastModified: null
};

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
    
    // Validar
    const errors = [];
    
    if (typeof config.quantitativeWeight !== 'number' || 
        config.quantitativeWeight < 0 || config.quantitativeWeight > 1) {
      errors.push('quantitativeWeight debe estar entre 0 y 1');
    }
    
    if (typeof config.qualitativeWeight !== 'number' || 
        config.qualitativeWeight < 0 || config.qualitativeWeight > 1) {
      errors.push('qualitativeWeight debe estar entre 0 y 1');
    }
    
    const sum = config.quantitativeWeight + config.qualitativeWeight;
    if (Math.abs(sum - 1.0) > 0.01) {
      errors.push(`Los pesos deben sumar 1.0 (actual: ${sum.toFixed(2)})`);
    }
    
    if (typeof config.boostPowerThreshold !== 'number' || 
        config.boostPowerThreshold < 0.30 || config.boostPowerThreshold > 0.50) {
      errors.push('boostPowerThreshold debe estar entre 0.30 y 0.50');
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validación fallida',
        errors: errors
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
// ENDPOINT DE CRIPTOS (básico)
// ============================================

app.get('/api/crypto', async (req, res) => {
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false'
    );
    
    res.json({
      success: true,
      data: response.data,
      timestamp: new Date().toISOString()
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
// EXPORTAR PARA VERCEL
// ============================================

module.exports = app;
