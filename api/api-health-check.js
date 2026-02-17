// api-health-check.js - Health Check Completo de Todas las APIs

const axios = require('axios');

/**
 * Verificar estado de TODAS las APIs
 */
async function checkAllAPIs() {
  const timestamp = new Date().toISOString();
  
  const results = {
    timestamp,
    summary: {
      total: 13,
      available: 0,
      configured: 0,
      errors: 0
    },
    apis: {}
  };
  
  // ============================================
  // TIER FREE (Sin configuración)
  // ============================================
  
  // 1. CoinGecko
  results.apis.coingecko = await checkCoinGecko();
  
  // 2. Alternative.me (Fear & Greed)
  results.apis.alternative = await checkAlternative();
  
  // 3. Reddit
  results.apis.reddit = await checkReddit();
  
  // 4. Blockchain.info
  results.apis.blockchain = await checkBlockchain();
  
  // ============================================
  // TIER FREEMIUM (Con API key)
  // ============================================
  
  // 5. CryptoCompare
  results.apis.cryptocompare = await checkCryptoCompare();
  
  // 6. NewsAPI
  results.apis.newsapi = await checkNewsAPI();
  
  // 7. GitHub
  results.apis.github = await checkGitHub();
  
  // 8. Telegram
  results.apis.telegram = await checkTelegram();
  
  // ============================================
  // TIER PAID
  // ============================================
  
  // 9. SerpAPI (Google Trends)
  results.apis.serpapi = await checkSerpAPI();
  
  // 10. Twitter
  results.apis.twitter = await checkTwitter();
  
  // ============================================
  // TIER PREMIUM
  // ============================================
  
  // 11. Glassnode
  results.apis.glassnode = await checkGlassnode();
  
  // 12. CryptoQuant
  results.apis.cryptoquant = await checkCryptoQuant();
  
  // 13. Whale Alert
  results.apis.whaleAlert = await checkWhaleAlert();
  
  // Calcular summary
  Object.values(results.apis).forEach(api => {
    if (api.available) results.summary.available++;
    if (api.configured) results.summary.configured++;
    if (api.status === 'error') results.summary.errors++;
  });
  
  return results;
}

// ============================================
// FUNCIONES DE CHECK INDIVIDUALES
// ============================================

async function checkCoinGecko() {
  const api = {
    name: 'CoinGecko',
    tier: 'free',
    configured: true,
    available: false,
    status: 'checking',
    message: '',
    responseTime: 0,
    factors: ['Volume 24h', 'Market Cap', 'Volatilidad', 'ATL'],
    lastCheck: new Date().toISOString()
  };
  
  try {
    const start = Date.now();
    const response = await axios.get('https://api.coingecko.com/api/v3/ping', {
      timeout: 5000
    });
    api.responseTime = Date.now() - start;
    
    if (response.status === 200) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
  }
  
  return api;
}

async function checkAlternative() {
  const api = {
    name: 'Alternative.me',
    tier: 'free',
    configured: true,
    available: false,
    status: 'checking',
    message: '',
    responseTime: 0,
    factors: ['Fear & Greed Index'],
    lastCheck: new Date().toISOString()
  };
  
  try {
    const start = Date.now();
    const response = await axios.get('https://api.alternative.me/fng/?limit=1', {
      timeout: 5000
    });
    api.responseTime = Date.now() - start;
    
    if (response.data && response.data.data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
      api.currentValue = `FGI: ${response.data.data[0].value} (${response.data.data[0].value_classification})`;
    }
  } catch (error) {
    api.status = 'error';
    api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
  }
  
  return api;
}

async function checkReddit() {
  const api = {
    name: 'Reddit',
    tier: 'free',
    configured: true,
    available: false,
    status: 'checking',
    message: '',
    responseTime: 0,
    factors: ['Reddit Sentiment'],
    lastCheck: new Date().toISOString()
  };
  
  try {
    const start = Date.now();
    const response = await axios.get('https://www.reddit.com/r/cryptocurrency/hot.json?limit=1', {
      timeout: 5000,
      headers: {
        'User-Agent': 'CryptoDetector/1.0'
      }
    });
    api.responseTime = Date.now() - start;
    
    if (response.data && response.data.data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
  }
  
  return api;
}

async function checkBlockchain() {
  const api = {
    name: 'Blockchain.info',
    tier: 'free',
    configured: true,
    available: false,
    status: 'checking',
    message: '',
    responseTime: 0,
    factors: ['Transacciones BTC'],
    lastCheck: new Date().toISOString()
  };
  
  try {
    const start = Date.now();
    const response = await axios.get('https://blockchain.info/q/24hrtransactioncount', {
      timeout: 5000
    });
    api.responseTime = Date.now() - start;
    
    if (response.data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
      api.currentValue = `${parseInt(response.data).toLocaleString()} tx/24h`;
    }
  } catch (error) {
    api.status = 'error';
    api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
  }
  
  return api;
}

async function checkCryptoCompare() {
  const api = {
    name: 'CryptoCompare',
    tier: 'freemium',
    configured: !!process.env.CRYPTOCOMPARE_API_KEY,
    available: false,
    status: 'not_configured',
    message: 'API key no configurada',
    responseTime: 0,
    factors: ['News Volume', 'News Sentiment'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://www.cryptocompare.com/cryptopian/api-keys'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    const response = await axios.get('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&limit=1', {
      timeout: 5000,
      headers: {
        'authorization': `Apikey ${process.env.CRYPTOCOMPARE_API_KEY}`
      }
    });
    api.responseTime = Date.now() - start;
    
    if (response.data && response.data.Data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'API key inválida';
    } else if (error.response?.status === 429) {
      api.message = 'Rate limit excedido';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

async function checkNewsAPI() {
  const api = {
    name: 'NewsAPI',
    tier: 'freemium',
    configured: !!process.env.NEWSAPI_KEY,
    available: false,
    status: 'not_configured',
    message: 'API key no configurada',
    responseTime: 0,
    factors: ['Media Coverage', 'Breaking News'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://newsapi.org/register'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    const response = await axios.get('https://newsapi.org/v2/everything', {
      timeout: 5000,
      params: {
        q: 'bitcoin',
        pageSize: 1,
        apiKey: process.env.NEWSAPI_KEY
      }
    });
    api.responseTime = Date.now() - start;
    
    if (response.data && response.data.status === 'ok') {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'API key inválida';
    } else if (error.response?.status === 429) {
      api.message = 'Rate limit excedido (100/día en free tier)';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

async function checkGitHub() {
  const api = {
    name: 'GitHub',
    tier: 'freemium',
    configured: !!process.env.GITHUB_TOKEN,
    available: false,
    status: api.configured ? 'checking' : 'limited',
    message: api.configured ? '' : 'Sin token (60 req/hora)',
    responseTime: 0,
    factors: ['Developer Activity'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://github.com/settings/tokens'
  };
  
  try {
    const start = Date.now();
    const headers = api.configured ? { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};
    const response = await axios.get('https://api.github.com/rate_limit', {
      timeout: 5000,
      headers
    });
    api.responseTime = Date.now() - start;
    
    if (response.data) {
      api.available = true;
      api.status = 'operational';
      const limit = response.data.rate.limit;
      const remaining = response.data.rate.remaining;
      api.message = `OK (${remaining}/${limit} requests restantes)`;
      
      if (!api.configured) {
        api.message += ' - Considera añadir token';
      }
    }
  } catch (error) {
    api.status = 'error';
    api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
  }
  
  return api;
}

async function checkTelegram() {
  const api = {
    name: 'Telegram Bot',
    tier: 'free',
    configured: !!process.env.TELEGRAM_BOT_TOKEN,
    available: false,
    status: 'not_configured',
    message: 'Bot token no configurado',
    responseTime: 0,
    factors: ['Telegram Activity'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'Buscar @BotFather en Telegram'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    const response = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
      { timeout: 5000 }
    );
    api.responseTime = Date.now() - start;
    
    if (response.data && response.data.ok) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (Bot: ${response.data.result.username})`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'Token inválido';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

async function checkSerpAPI() {
  const api = {
    name: 'SerpAPI (Google Trends)',
    tier: 'paid',
    configured: !!process.env.SERPAPI_KEY,
    available: false,
    status: 'not_configured',
    message: 'API key no configurada',
    cost: '$50/mes',
    responseTime: 0,
    factors: ['Google Trends'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://serpapi.com/'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    const response = await axios.get('https://serpapi.com/account', {
      timeout: 5000,
      params: {
        api_key: process.env.SERPAPI_KEY
      }
    });
    api.responseTime = Date.now() - start;
    
    if (response.data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${response.data.total_searches_left || '?'} búsquedas restantes)`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'API key inválida';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

async function checkTwitter() {
  const api = {
    name: 'Twitter API v2',
    tier: 'paid',
    configured: !!process.env.TWITTER_BEARER_TOKEN,
    available: false,
    status: 'not_configured',
    message: 'Bearer token no configurado',
    cost: '$100/mes',
    responseTime: 0,
    factors: ['Twitter Sentiment'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://developer.twitter.com/'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    // Test simple endpoint
    const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
      timeout: 5000,
      headers: {
        'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
      },
      params: {
        query: 'bitcoin',
        max_results: 10
      }
    });
    api.responseTime = Date.now() - start;
    
    if (response.data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'Bearer token inválido';
    } else if (error.response?.status === 429) {
      api.message = 'Rate limit excedido';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

async function checkGlassnode() {
  const api = {
    name: 'Glassnode',
    tier: 'premium',
    configured: !!process.env.GLASSNODE_API_KEY,
    available: false,
    status: 'not_configured',
    message: 'API key no configurada',
    cost: '$29-799/mes',
    responseTime: 0,
    factors: ['Unique Addresses', 'Network Growth'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://glassnode.com/'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    const response = await axios.get(
      'https://api.glassnode.com/v1/metrics/addresses/active_count',
      {
        timeout: 5000,
        params: {
          a: 'BTC',
          api_key: process.env.GLASSNODE_API_KEY,
          i: '24h',
          c: 'native'
        }
      }
    );
    api.responseTime = Date.now() - start;
    
    if (response.data) {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'API key inválida';
    } else if (error.response?.status === 402) {
      api.message = 'Plan insuficiente o expirado';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

async function checkCryptoQuant() {
  const api = {
    name: 'CryptoQuant',
    tier: 'premium',
    configured: !!process.env.CRYPTOQUANT_API_KEY,
    available: false,
    status: 'not_configured',
    message: 'API key no configurada',
    cost: '$49-899/mes',
    responseTime: 0,
    factors: ['Exchange Net Flow'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://cryptoquant.com/'
  };
  
  if (!api.configured) return api;
  
  api.status = 'unknown';
  api.message = 'Endpoint de verificación no disponible - configurar manualmente';
  
  return api;
}

async function checkWhaleAlert() {
  const api = {
    name: 'Whale Alert',
    tier: 'premium',
    configured: !!process.env.WHALE_ALERT_API_KEY,
    available: false,
    status: 'not_configured',
    message: 'API key no configurada',
    cost: '$49/mes',
    responseTime: 0,
    factors: ['Whale Activity'],
    lastCheck: new Date().toISOString(),
    configInstructions: 'https://whale-alert.io/'
  };
  
  if (!api.configured) return api;
  
  try {
    const start = Date.now();
    const response = await axios.get('https://api.whale-alert.io/v1/status', {
      timeout: 5000,
      params: {
        api_key: process.env.WHALE_ALERT_API_KEY
      }
    });
    api.responseTime = Date.now() - start;
    
    if (response.data && response.data.status === 'success') {
      api.available = true;
      api.status = 'operational';
      api.message = `OK (${api.responseTime}ms)`;
    }
  } catch (error) {
    api.status = 'error';
    if (error.response?.status === 401) {
      api.message = 'API key inválida';
    } else {
      api.message = error.code === 'ECONNABORTED' ? 'Timeout' : error.message;
    }
  }
  
  return api;
}

module.exports = {
  checkAllAPIs
};
