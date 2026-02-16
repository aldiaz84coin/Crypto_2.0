// data-sources.js - Integración de Fuentes de Datos Reales (Iteración 3)

const axios = require('axios');

/**
 * FEAR & GREED INDEX
 * API: Alternative.me (gratuita, sin API key)
 */
async function getFearGreedIndex() {
  try {
    const response = await axios.get('https://api.alternative.me/fng/?limit=1');
    
    if (response.data && response.data.data && response.data.data[0]) {
      const fgi = response.data.data[0];
      return {
        success: true,
        value: parseInt(fgi.value),
        classification: fgi.value_classification,
        timestamp: fgi.timestamp
      };
    }
    
    return { success: false, error: 'No data' };
  } catch (error) {
    console.error('Error fetching Fear & Greed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * CRYPTOCOMPARE NEWS
 * API: CryptoCompare (gratuita con límites)
 * Requiere API key (opcional, funciona sin ella con límites menores)
 */
async function getCryptoNews(symbol = '', limit = 10) {
  try {
    const apiKey = process.env.CRYPTOCOMPARE_API_KEY || '';
    const headers = apiKey ? { 'authorization': `Apikey ${apiKey}` } : {};
    
    let url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN`;
    if (symbol) {
      url += `&categories=${symbol}`;
    }
    
    const response = await axios.get(url, { headers });
    
    if (response.data && response.data.Data) {
      const articles = response.data.Data.slice(0, limit);
      
      return {
        success: true,
        count: articles.length,
        articles: articles.map(article => ({
          id: article.id,
          title: article.title,
          body: article.body,
          url: article.url,
          source: article.source,
          published: article.published_on,
          categories: article.categories,
          sentiment: analyzeSentiment(article.title + ' ' + article.body)
        }))
      };
    }
    
    return { success: false, error: 'No data' };
  } catch (error) {
    console.error('Error fetching news:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Análisis de sentimiento simple basado en palabras clave
 */
function analyzeSentiment(text) {
  const textLower = text.toLowerCase();
  
  const positiveWords = [
    'surge', 'gain', 'rise', 'bullish', 'breakthrough', 'adoption', 
    'partnership', 'upgrade', 'success', 'positive', 'growth', 
    'milestone', 'rally', 'recovery', 'innovation'
  ];
  
  const negativeWords = [
    'crash', 'drop', 'decline', 'bearish', 'concern', 'risk', 
    'hack', 'scam', 'investigation', 'ban', 'lawsuit', 'loss',
    'collapse', 'fail', 'negative', 'warning'
  ];
  
  let score = 0;
  
  positiveWords.forEach(word => {
    if (textLower.includes(word)) score += 1;
  });
  
  negativeWords.forEach(word => {
    if (textLower.includes(word)) score -= 1;
  });
  
  // Normalizar a -1 a +1
  const normalized = Math.max(-1, Math.min(1, score / 3));
  
  return {
    score: normalized,
    label: normalized > 0.3 ? 'positive' : 
           normalized < -0.3 ? 'negative' : 'neutral'
  };
}

/**
 * COINGECKO - Datos mejorados con históricos
 */
async function getCoinGeckoDataEnhanced(coinId) {
  try {
    // Obtener datos básicos
    const marketResponse = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );
    
    // Obtener histórico 7 días
    const historyResponse = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=7`
    );
    
    const data = marketResponse.data;
    const history = historyResponse.data;
    
    // Calcular volatilidad real
    const prices = history.prices.map(p => p[1]);
    const volatility = calculateVolatility(prices);
    
    return {
      success: true,
      data: {
        id: data.id,
        symbol: data.symbol,
        name: data.name,
        current_price: data.market_data.current_price.usd,
        market_cap: data.market_data.market_cap.usd,
        total_volume: data.market_data.total_volume.usd,
        price_change_24h: data.market_data.price_change_percentage_24h,
        price_change_7d: data.market_data.price_change_percentage_7d,
        ath: data.market_data.ath.usd,
        atl: data.market_data.atl.usd,
        ath_date: data.market_data.ath_date.usd,
        atl_date: data.market_data.atl_date.usd,
        volatility_7d: volatility,
        prices_7d: prices
      }
    };
  } catch (error) {
    console.error('Error fetching enhanced CoinGecko data:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Calcular volatilidad (desviación estándar de retornos)
 */
function calculateVolatility(prices) {
  if (prices.length < 2) return 0;
  
  // Calcular retornos logarítmicos
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  
  // Media de retornos
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  
  // Desviación estándar
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  return stdDev * 100; // En porcentaje
}

/**
 * Obtener datos agregados para un activo
 */
async function getAggregatedData(crypto) {
  const results = {
    crypto: crypto,
    fearGreed: null,
    news: null,
    enhanced: null,
    timestamp: new Date().toISOString()
  };
  
  // Fear & Greed (global, no por activo)
  results.fearGreed = await getFearGreedIndex();
  
  // News específicas del activo
  results.news = await getCryptoNews(crypto.symbol.toUpperCase(), 5);
  
  // Datos mejorados (si tenemos el ID)
  if (crypto.id) {
    results.enhanced = await getCoinGeckoDataEnhanced(crypto.id);
  }
  
  return results;
}

/**
 * Verificar disponibilidad de APIs
 */
async function checkAPIsStatus() {
  const status = {
    fearGreed: { available: false, message: '' },
    cryptoCompare: { available: false, message: '' },
    coinGecko: { available: false, message: '' }
  };
  
  // Test Fear & Greed
  try {
    const fgi = await getFearGreedIndex();
    status.fearGreed.available = fgi.success;
    status.fearGreed.message = fgi.success ? 'OK' : fgi.error;
  } catch (error) {
    status.fearGreed.message = error.message;
  }
  
  // Test CryptoCompare
  try {
    const news = await getCryptoNews('', 1);
    status.cryptoCompare.available = news.success;
    status.cryptoCompare.message = news.success ? 'OK' : news.error;
  } catch (error) {
    status.cryptoCompare.message = error.message;
  }
  
  // Test CoinGecko
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/ping');
    status.coinGecko.available = response.status === 200;
    status.coinGecko.message = 'OK';
  } catch (error) {
    status.coinGecko.message = error.message;
  }
  
  return status;
}

module.exports = {
  getFearGreedIndex,
  getCryptoNews,
  getCoinGeckoDataEnhanced,
  getAggregatedData,
  checkAPIsStatus,
  analyzeSentiment,
  calculateVolatility
};
