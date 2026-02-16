// server.js - Backend para Detector de Criptoactivos
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ReportGenerator = require('./report-generator');
const EmailService = require('./email-service');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Inicializar servicios
const reportGenerator = new ReportGenerator();
const emailService = new EmailService();

// Middleware
app.use(cors());
app.use(express.json());

// Cache simple en memoria (en producción usar Redis)
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Función helper para cache
const getCached = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiry) {
    cache.delete(key);
    return null;
  }
  return item.data;
};

const setCache = (key, data) => {
  cache.set(key, {
    data,
    expiry: Date.now() + CACHE_DURATION
  });
};

// Rate limiting simple
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minuto
const RATE_LIMIT_MAX = 60;

const checkRateLimit = (ip) => {
  const now = Date.now();
  const userRequests = requestCounts.get(ip) || [];
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT_MAX) {
    return false;
  }
  
  recentRequests.push(now);
  requestCounts.set(ip, recentRequests);
  return true;
};

// Middleware de rate limiting
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
});

// ============================================
// ENDPOINTS - CoinGecko (ya funciona directo)
// ============================================

// Endpoint para obtener datos de CoinGecko con cache
app.get('/api/crypto/market', async (req, res) => {
  try {
    const cacheKey = 'coingecko_market';
    const cached = getCached(cacheKey);
    
    if (cached) {
      return res.json({ data: cached, source: 'cache' });
    }

    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets',
      {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 100,
          page: 1,
          sparkline: true,
          price_change_percentage: '24h,7d'
        }
      }
    );

    setCache(cacheKey, response.data);
    res.json({ data: response.data, source: 'api' });
  } catch (error) {
    console.error('CoinGecko API Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

// ============================================
// ENDPOINTS - Google Trends (SerpAPI)
// ============================================

app.get('/api/trends/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `trends_${symbol}`;
    const cached = getCached(cacheKey);
    
    if (cached) {
      return res.json({ data: cached, source: 'cache' });
    }

    if (!process.env.SERPAPI_KEY) {
      // Modo simulado si no hay API key
      const simulatedTrend = Math.random() * 300;
      return res.json({ 
        data: { trend: simulatedTrend, simulated: true },
        source: 'simulated'
      });
    }

    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        engine: 'google_trends',
        q: `${symbol} cryptocurrency`,
        data_type: 'TIMESERIES',
        api_key: process.env.SERPAPI_KEY
      }
    });

    const timelineData = response.data.interest_over_time?.timeline_data || [];
    
    if (timelineData.length < 2) {
      return res.json({ 
        data: { trend: 0, message: 'Not enough data' },
        source: 'api'
      });
    }

    // Calcular incremento porcentual
    const latest = timelineData[timelineData.length - 1].values[0].extracted_value;
    const previous = timelineData[Math.floor(timelineData.length / 2)].values[0].extracted_value;
    const trendIncrease = previous > 0 ? ((latest - previous) / previous) * 100 : 0;

    const result = {
      trend: trendIncrease,
      latest,
      previous,
      dataPoints: timelineData.length
    };

    setCache(cacheKey, result);
    res.json({ data: result, source: 'api' });
  } catch (error) {
    console.error('Google Trends API Error:', error.message);
    
    // NO usar datos simulados - devolver error
    res.status(503).json({ 
      error: 'Google Trends API no disponible',
      message: error.message,
      configured: !!process.env.SERPAPI_KEY,
      source: 'error'
    });
  }
});

// ============================================
// ENDPOINTS - CryptoCompare News
// ============================================

app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `news_${symbol}`;
    const cached = getCached(cacheKey);
    
    if (cached) {
      return res.json({ data: cached, source: 'cache' });
    }

    if (!process.env.CRYPTOCOMPARE_KEY) {
      return res.status(503).json({ 
        error: 'CryptoCompare API no configurada',
        message: 'Se requiere CRYPTOCOMPARE_KEY en variables de entorno',
        configured: false,
        source: 'error'
      });
    }

    const response = await axios.get('https://min-api.cryptocompare.com/data/v2/news/', {
      params: {
        lang: 'EN',
        categories: symbol,
        api_key: process.env.CRYPTOCOMPARE_KEY
      }
    });

    const articles = response.data.Data || [];
    
    // Calcular sentimiento simple
    const sentiment = calculateSentiment(articles);
    
    const result = {
      count: articles.length,
      sentiment,
      articles: articles.slice(0, 5).map(a => ({
        title: a.title,
        url: a.url,
        source: a.source,
        published: a.published_on
      }))
    };

    setCache(cacheKey, result);
    res.json({ data: result, source: 'api' });
  } catch (error) {
    console.error('CryptoCompare API Error:', error.message);
    
    // Fallback
    const simulatedNews = {
      count: Math.floor(Math.random() * 20),
      sentiment: Math.random(),
      simulated: true,
      error: error.message
    };
    res.json({ data: simulatedNews, source: 'fallback' });
  }
});

// ============================================
// ENDPOINTS - Fear & Greed Index
// ============================================

app.get('/api/fear-greed', async (req, res) => {
  try {
    const cacheKey = 'fear_greed';
    const cached = getCached(cacheKey);
    
    if (cached) {
      return res.json({ data: cached, source: 'cache' });
    }

    const response = await axios.get('https://api.alternative.me/fng/?limit=1');
    const data = response.data.data[0];
    
    const result = {
      value: parseInt(data.value),
      classification: data.value_classification,
      timestamp: data.timestamp
    };

    setCache(cacheKey, result);
    res.json({ data: result, source: 'api' });
  } catch (error) {
    console.error('Fear & Greed API Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch fear & greed index' });
  }
});

// ============================================
// ENDPOINTS - Binance Exchange Data (OPCIONAL)
// ============================================
// NOTA: Binance puede estar bloqueado geográficamente (error 451)
// El sistema funciona perfectamente sin Binance usando solo CoinGecko

app.get('/api/exchange/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const tradingPair = `${symbol.toUpperCase()}USDT`;
    const cacheKey = `exchange_${tradingPair}`;
    const cached = getCached(cacheKey);
    
    if (cached) {
      return res.json({ data: cached, source: 'cache' });
    }

    const response = await axios.get(`https://api.binance.com/api/v3/ticker/24hr`, {
      params: { symbol: tradingPair },
      timeout: 5000
    });

    const result = {
      symbol: response.data.symbol,
      volume: parseFloat(response.data.volume),
      quoteVolume: parseFloat(response.data.quoteVolume),
      priceChange: parseFloat(response.data.priceChangePercent),
      trades: response.data.count
    };

    setCache(cacheKey, result);
    res.json({ data: result, source: 'api' });
  } catch (error) {
    console.error('Binance API Error:', error.message);
    
    // Error 451 = Restricción geográfica (bloqueado en tu región)
    // Esto NO es crítico - CoinGecko ya proporciona volumen de trading
    const isGeoBlocked = error.response?.status === 451;
    
    res.status(503).json({ 
      error: isGeoBlocked ? 'Binance bloqueado geográficamente' : 'Binance API error',
      message: error.message,
      note: 'No es crítico - El sistema usa volumen de CoinGecko',
      geoBlocked: isGeoBlocked,
      source: 'error'
    });
  }
});

// ============================================
// ENDPOINTS - Análisis Completo
// ============================================

app.post('/api/analyze', async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Invalid symbols array' });
    }

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const [trends, news, exchange] = await Promise.all([
            axios.get(`http://localhost:${PORT}/api/trends/${symbol}`).catch(() => ({ data: { data: { trend: 0, simulated: true }}})),
            axios.get(`http://localhost:${PORT}/api/news/${symbol}`).catch(() => ({ data: { data: { count: 0, sentiment: 0.5, simulated: true }}})),
            axios.get(`http://localhost:${PORT}/api/exchange/${symbol}`).catch(() => ({ data: { data: null }}))
          ]);

          return {
            symbol,
            trends: trends.data.data,
            news: news.data.data,
            exchange: exchange.data.data,
            analyzed: true
          };
        } catch (error) {
          return {
            symbol,
            error: error.message,
            analyzed: false
          };
        }
      })
    );

    res.json({ results, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Analysis Error:', error.message);
    res.status(500).json({ error: 'Failed to complete analysis' });
  }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateSentiment(articles) {
  if (!articles || articles.length === 0) return 0.5;

  const positiveWords = ['surge', 'rally', 'bullish', 'gain', 'rise', 'breakthrough', 
                         'soar', 'boom', 'growth', 'profit', 'success', 'milestone',
                         'adoption', 'partnership', 'upgrade', 'innovation'];
  
  const negativeWords = ['crash', 'fall', 'bearish', 'drop', 'decline', 'dump',
                         'plunge', 'collapse', 'loss', 'fraud', 'hack', 'scam',
                         'warning', 'risk', 'concern', 'regulation'];

  let positiveCount = 0;
  let negativeCount = 0;
  let totalWords = 0;

  articles.forEach(article => {
    const text = `${article.title} ${article.body || ''}`.toLowerCase();
    
    positiveWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        positiveCount += matches.length;
        totalWords += matches.length;
      }
    });

    negativeWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) {
        negativeCount += matches.length;
        totalWords += matches.length;
      }
    });
  });

  if (totalWords === 0) return 0.5;
  
  // Retorna valor entre 0 (muy negativo) y 1 (muy positivo)
  return positiveCount / (positiveCount + negativeCount);
}

// ============================================
// ENDPOINTS - Generación y Envío de Informes
// ============================================

// Generar informe de iteración
app.post('/api/reports/generate', async (req, res) => {
  try {
    const iterationData = req.body;
    
    if (!iterationData || !iterationData.results || !iterationData.algorithm) {
      return res.status(400).json({ 
        error: 'Missing required iteration data' 
      });
    }

    // Generar el informe en Word
    const reportBuffer = await reportGenerator.generateReport(iterationData);
    
    // Enviar como descarga
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename=Informe-Iteracion-${iterationData.iterationNumber}.docx`);
    res.send(reportBuffer);
    
  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ 
      error: 'Failed to generate report',
      details: error.message 
    });
  }
});

// Generar y enviar informe por email
app.post('/api/reports/send', async (req, res) => {
  try {
    const { 
      iterationData, 
      recipientEmail, 
      ccEmails 
    } = req.body;
    
    if (!iterationData || !iterationData.results) {
      return res.status(400).json({ 
        error: 'Missing required iteration data' 
      });
    }

    // Usar email de las variables de entorno si no se proporciona
    const recipient = recipientEmail || process.env.REPORT_RECIPIENT_EMAIL;
    
    if (!recipient) {
      return res.status(400).json({ 
        error: 'No recipient email provided' 
      });
    }

    // Generar el informe
    const reportBuffer = await reportGenerator.generateReport(iterationData);
    
    // Preparar datos para envío
    const emailData = {
      reportBuffer,
      iterationNumber: iterationData.iterationNumber,
      timestamp: iterationData.timestamp,
      successRate: iterationData.successRate,
      recipientEmail: recipient,
      ccEmails: ccEmails || (process.env.REPORT_CC_EMAILS ? process.env.REPORT_CC_EMAILS.split(',') : []),
      results: iterationData.results
    };

    // Enviar email
    const result = await emailService.sendIterationReport(emailData);
    
    if (result.success) {
      res.json({ 
        success: true,
        message: 'Report generated and sent successfully',
        messageId: result.messageId,
        mode: result.mode
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'Failed to send email',
        details: result.error 
      });
    }
    
  } catch (error) {
    console.error('Error sending report:', error);
    res.status(500).json({ 
      error: 'Failed to send report',
      details: error.message 
    });
  }
});

// Enviar email de prueba
app.post('/api/email/test', async (req, res) => {
  try {
    const { recipientEmail } = req.body;
    
    const recipient = recipientEmail || process.env.REPORT_RECIPIENT_EMAIL;
    
    if (!recipient) {
      return res.status(400).json({ 
        error: 'No recipient email provided' 
      });
    }

    const result = await emailService.sendTestEmail(recipient);
    
    if (result.success) {
      res.json({ 
        success: true,
        message: 'Test email sent successfully',
        messageId: result.messageId 
      });
    } else {
      res.status(500).json({ 
        success: false,
        error: 'Failed to send test email',
        details: result.error 
      });
    }
    
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ 
      error: 'Failed to send test email',
      details: error.message 
    });
  }
});

// Verificar configuración de email
app.get('/api/email/verify', async (req, res) => {
  try {
    const isValid = await emailService.verify();
    
    res.json({
      configured: isValid,
      hasRecipient: !!process.env.REPORT_RECIPIENT_EMAIL,
      provider: process.env.SENDGRID_API_KEY ? 'SendGrid' : 
                process.env.GMAIL_USER ? 'Gmail' : 
                process.env.SMTP_HOST ? 'SMTP' : 'None'
    });
  } catch (error) {
    res.json({
      configured: false,
      error: error.message
    });
  }
});

// ============================================
// ENDPOINTS - Health & Status
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    cache_size: cache.size,
    apis: {
      serpapi: !!process.env.SERPAPI_KEY,
      cryptocompare: !!process.env.CRYPTOCOMPARE_KEY
    },
    email: {
      configured: !!(process.env.SENDGRID_API_KEY || process.env.GMAIL_USER || process.env.SMTP_HOST),
      recipient: !!process.env.REPORT_RECIPIENT_EMAIL,
      provider: process.env.SENDGRID_API_KEY ? 'SendGrid' : 
                process.env.GMAIL_USER ? 'Gmail' : 
                process.env.SMTP_HOST ? 'SMTP' : 'None'
    }
  });
});

// Endpoint de debug completo
app.get('/api/debug', async (req, res) => {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform
    },
    cache: {
      size: cache.size,
      keys: Array.from(cache.keys())
    },
    apis: {
      serpapi: {
        configured: !!process.env.SERPAPI_KEY,
        keyPresent: !!process.env.SERPAPI_KEY,
        keyLength: process.env.SERPAPI_KEY ? process.env.SERPAPI_KEY.length : 0
      },
      cryptocompare: {
        configured: !!process.env.CRYPTOCOMPARE_KEY,
        keyPresent: !!process.env.CRYPTOCOMPARE_KEY,
        keyLength: process.env.CRYPTOCOMPARE_KEY ? process.env.CRYPTOCOMPARE_KEY.length : 0
      },
      coingecko: {
        configured: true,
        type: 'public',
        note: 'No requiere API key'
      },
      binance: {
        configured: true,
        type: 'public',
        note: 'No requiere API key'
      },
      fearGreed: {
        configured: true,
        type: 'public',
        note: 'No requiere API key'
      }
    },
    email: {
      configured: !!(process.env.SENDGRID_API_KEY || process.env.GMAIL_USER || process.env.SMTP_HOST),
      provider: process.env.SENDGRID_API_KEY ? 'SendGrid' : 
                process.env.GMAIL_USER ? 'Gmail' : 
                process.env.SMTP_HOST ? 'SMTP' : 'None',
      recipient: !!process.env.REPORT_RECIPIENT_EMAIL
    }
  };

  // Probar conectividad con cada API
  const connectivity = {};

  // Test CoinGecko
  try {
    const cgResponse = await axios.get('https://api.coingecko.com/api/v3/ping', { timeout: 5000 });
    connectivity.coingecko = { 
      status: 'online', 
      response: cgResponse.data,
      latency: cgResponse.headers['x-response-time'] || 'N/A'
    };
  } catch (error) {
    connectivity.coingecko = { 
      status: 'error', 
      error: error.message 
    };
  }

  // Test Binance (OPCIONAL - puede estar bloqueado geográficamente)
  try {
    const binanceResponse = await axios.get('https://api.binance.com/api/v3/ping', { timeout: 5000 });
    connectivity.binance = { 
      status: 'online',
      latency: 'OK',
      note: 'Opcional - CoinGecko proporciona volumen'
    };
  } catch (error) {
    const isGeoBlocked = error.response?.status === 451;
    connectivity.binance = { 
      status: isGeoBlocked ? 'geo_blocked' : 'error',
      error: error.message,
      geoBlocked: isGeoBlocked,
      note: isGeoBlocked 
        ? 'Bloqueado geográficamente - No afecta funcionalidad (usamos CoinGecko)'
        : 'Error de conexión - No es crítico'
    };
  }

  // Test Fear & Greed
  try {
    const fgResponse = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 });
    connectivity.fearGreed = { 
      status: 'online',
      currentIndex: fgResponse.data.data[0].value,
      classification: fgResponse.data.data[0].value_classification
    };
  } catch (error) {
    connectivity.fearGreed = { 
      status: 'error', 
      error: error.message 
    };
  }

  // Test SerpAPI (solo si está configurado)
  if (process.env.SERPAPI_KEY) {
    try {
      const serpResponse = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: 'test',
          api_key: process.env.SERPAPI_KEY
        },
        timeout: 5000
      });
      connectivity.serpapi = { 
        status: 'online',
        accountType: serpResponse.data.search_metadata?.account_type || 'unknown',
        totalSearches: serpResponse.data.search_metadata?.total_searches_left || 'unknown'
      };
    } catch (error) {
      connectivity.serpapi = { 
        status: 'error', 
        error: error.message,
        configured: true
      };
    }
  } else {
    connectivity.serpapi = { 
      status: 'not_configured',
      message: 'SERPAPI_KEY no encontrada en variables de entorno'
    };
  }

  // Test CryptoCompare (solo si está configurado)
  if (process.env.CRYPTOCOMPARE_KEY) {
    try {
      const ccResponse = await axios.get('https://min-api.cryptocompare.com/data/v2/news/', {
        params: {
          lang: 'EN',
          api_key: process.env.CRYPTOCOMPARE_KEY
        },
        timeout: 5000
      });
      connectivity.cryptocompare = { 
        status: 'online',
        newsCount: ccResponse.data.Data?.length || 0,
        rateLimit: ccResponse.headers['x-ratelimit-remaining'] || 'unknown'
      };
    } catch (error) {
      connectivity.cryptocompare = { 
        status: 'error', 
        error: error.message,
        configured: true
      };
    }
  } else {
    connectivity.cryptocompare = { 
      status: 'not_configured',
      message: 'CRYPTOCOMPARE_KEY no encontrada en variables de entorno'
    };
  }

  debugInfo.connectivity = connectivity;

  res.json(debugInfo);
});

app.get('/api/cache/clear', (req, res) => {
  cache.clear();
  res.json({ message: 'Cache cleared successfully', timestamp: new Date().toISOString() });
});

// ============================================
// ERROR HANDLERS
// ============================================

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================

// Para desarrollo local
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`
🚀 Crypto Detector Backend Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 Server running on: http://localhost:${PORT}
🔧 Environment: ${process.env.NODE_ENV || 'development'}

📊 Available APIs:
   ${process.env.SERPAPI_KEY ? '✅' : '❌'} Google Trends (SerpAPI)
   ${process.env.CRYPTOCOMPARE_KEY ? '✅' : '❌'} CryptoCompare News
   ✅ CoinGecko Market Data
   ✅ Fear & Greed Index
   ✅ Binance Exchange Data

📧 Email Service:
   ${process.env.SENDGRID_API_KEY || process.env.GMAIL_USER || process.env.SMTP_HOST ? '✅' : '❌'} Email Provider (${process.env.SENDGRID_API_KEY ? 'SendGrid' : process.env.GMAIL_USER ? 'Gmail' : process.env.SMTP_HOST ? 'SMTP' : 'None'})
   ${process.env.REPORT_RECIPIENT_EMAIL ? '✅' : '❌'} Recipient Email

🔗 Endpoints:
   GET  /api/crypto/market       - CoinGecko market data
   GET  /api/trends/:symbol      - Google Trends
   GET  /api/news/:symbol        - Crypto news & sentiment
   GET  /api/exchange/:symbol    - Binance exchange data
   GET  /api/fear-greed          - Market sentiment index
   POST /api/analyze             - Complete analysis
   POST /api/reports/generate    - Generate Word report
   POST /api/reports/send        - Generate & send report via email
   POST /api/email/test          - Send test email
   GET  /api/email/verify        - Verify email configuration
   GET  /api/health              - Health check
   GET  /api/debug               - Debug & connectivity status
   GET  /api/cache/clear         - Clear cache

💡 Tip: Configure email in .env file:
   SENDGRID_API_KEY=your_key_here (or GMAIL_USER/SMTP_HOST)
   REPORT_RECIPIENT_EMAIL=your@email.com
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
  });
}

// Exportar para Vercel serverless

// ============================================
// INTEGRACIÓN - CICLOS Y ENTRENAMIENTO
// ============================================

// Cargar KV helpers
let kvHelpers = null;
try {
  kvHelpers = require('./kv-helpers');
  console.log('✅ Vercel KV disponible');
} catch (error) {
  console.log('⚠️  Vercel KV no disponible');
}

if (kvHelpers) {
  // Cargar e inicializar los endpoints
  const initCyclesEndpoints = require('./cycles-endpoints');
  const initAlgorithmTraining = require('./algorithm-training');
  
  // Pasar las dependencias necesarias
  initCyclesEndpoints(app, kvHelpers, reportGenerator, emailService);
  initAlgorithmTraining(app, kvHelpers);
  
  console.log('✅ Endpoints de ciclos habilitados');
} else {
  // Endpoints deshabilitados
  const kvNotAvailable = (req, res) => {
    res.status(503).json({
      error: 'Vercel KV no configurado',
      message: 'Configura Vercel KV para usar ciclos de 12h',
      docs: 'Ver INSTRUCCIONES.md'
    });
  };
  
  app.post('/api/cycles/start', kvNotAvailable);
  app.get('/api/cycles/active', kvNotAvailable);
  app.get('/api/cycles/history', kvNotAvailable);
  app.post('/api/algorithm/train', kvNotAvailable);
}

// ============================================
// INTEGRACIÓN - CONFIGURACIÓN AVANZADA
// ============================================

// Cargar endpoints de configuración si KV está disponible
if (kvHelpers) {
  const initConfigEndpoints = require('./config-endpoints');
  initConfigEndpoints(app, kvHelpers);
  console.log('✅ Endpoints de configuración avanzada habilitados');
} else {
  // Endpoints básicos sin KV
  app.get('/api/config', (req, res) => {
    const { DEFAULT_ALGORITHM_CONFIG } = require('./algorithm-config-advanced');
    res.json({ success: true, config: DEFAULT_ALGORITHM_CONFIG });
  });
  
  app.post('/api/config', (req, res) => {
    res.status(503).json({
      error: 'KV no disponible',
      message: 'Configura Vercel KV para guardar configuraciones personalizadas'
    });
  });
}

// Endpoint de metadata siempre disponible
app.get('/api/config/metadata', (req, res) => {
  const metadata = {
    metaWeights: {
      quantitative: { name: 'Cuantitativos', min: 0, max: 1, step: 0.01 },
      qualitative: { name: 'Cualitativos', min: 0, max: 1, step: 0.01 }
    },
    factors: ['volume', 'marketCap', 'volatility', 'historicalLow', 'googleTrends',
              'fearGreedIndex', 'newsVolume', 'newsCount']
  };
  res.json({ success: true, metadata });
});

// Exportar para Vercel serverless (al final)
module.exports = app;
