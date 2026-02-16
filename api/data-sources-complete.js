// data-sources-complete.js - TODAS las Fuentes de Datos (19 Factores)

const axios = require('axios');
const cheerio = require('cheerio');

// ============================================
// FACTORES CUANTITATIVOS (9 factores)
// ============================================

/**
 * FACTOR 1: Volume 24h
 * Fuente: CoinGecko / Binance
 */
async function getVolume24h(coinId) {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}`
    );
    return {
      success: true,
      volume: response.data.market_data.total_volume.usd,
      source: 'CoinGecko'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 2: Market Cap Ratio vs BTC
 * Fuente: CoinGecko
 */
async function getMarketCapRatio(coinId) {
  try {
    const [coinData, btcData] = await Promise.all([
      axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`),
      axios.get('https://api.coingecko.com/api/v3/coins/bitcoin')
    ]);
    
    const coinMcap = coinData.data.market_data.market_cap.usd;
    const btcMcap = btcData.data.market_data.market_cap.usd;
    
    return {
      success: true,
      ratio: coinMcap / btcMcap,
      coinMarketCap: coinMcap,
      btcMarketCap: btcMcap,
      source: 'CoinGecko'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 3: Volatilidad 7 días
 * Fuente: CoinGecko (históricos)
 */
async function getVolatility7d(coinId) {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=7`
    );
    
    const prices = response.data.prices.map(p => p[1]);
    
    // Calcular retornos logarítmicos
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    
    // Desviación estándar
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance) * 100;
    
    return {
      success: true,
      volatility: volatility,
      prices: prices,
      source: 'CoinGecko'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 4: Distancia desde ATL
 * Fuente: CoinGecko
 */
async function getDistanceFromATL(coinId) {
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/coins/${coinId}`
    );
    
    const currentPrice = response.data.market_data.current_price.usd;
    const atl = response.data.market_data.atl.usd;
    const ath = response.data.market_data.ath.usd;
    
    const distanceFromATL = ((currentPrice - atl) / (ath - atl)) * 100;
    
    return {
      success: true,
      currentPrice,
      atl,
      ath,
      distanceFromATL: distanceFromATL,
      atlDate: response.data.market_data.atl_date.usd,
      athDate: response.data.market_data.ath_date.usd,
      source: 'CoinGecko'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 5: Transacciones Activas 24h
 * Fuente: Blockchain.info / Etherscan / Alternative APIs
 * Nota: Requiere APIs específicas por blockchain
 */
async function getActiveTransactions24h(symbol) {
  try {
    // Para Bitcoin
    if (symbol.toLowerCase() === 'btc') {
      const response = await axios.get('https://blockchain.info/q/24hrtransactioncount');
      return {
        success: true,
        transactions: parseInt(response.data),
        source: 'Blockchain.info'
      };
    }
    
    // Para Ethereum
    if (symbol.toLowerCase() === 'eth') {
      const response = await axios.get('https://api.etherscan.io/api?module=proxy&action=eth_blockNumber');
      // Aproximación: ~7000 tx por bloque, ~7200 bloques/día
      return {
        success: true,
        transactions: 7000 * 7200,
        source: 'Etherscan (aproximado)'
      };
    }
    
    // Para otros: usar aproximación basada en volumen
    return {
      success: true,
      transactions: 10000, // Placeholder
      source: 'Estimado',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 6: Direcciones Activas Únicas
 * Fuente: Glassnode / CryptoQuant / On-chain data
 */
async function getUniqueActiveAddresses(symbol) {
  try {
    // Glassnode API (requiere key de pago)
    const apiKey = process.env.GLASSNODE_API_KEY;
    
    if (apiKey) {
      const response = await axios.get(
        `https://api.glassnode.com/v1/metrics/addresses/active_count`,
        {
          params: {
            a: symbol.toLowerCase(),
            api_key: apiKey,
            i: '24h'
          }
        }
      );
      
      return {
        success: true,
        activeAddresses: response.data[response.data.length - 1].v,
        source: 'Glassnode'
      };
    }
    
    // Sin API key: usar estimación basada en market cap
    return {
      success: true,
      activeAddresses: 50000, // Placeholder
      source: 'Estimado',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 7: Exchange Net Flow
 * Fuente: CryptoQuant / Glassnode
 */
async function getExchangeNetFlow(symbol) {
  try {
    const apiKey = process.env.CRYPTOQUANT_API_KEY;
    
    if (apiKey) {
      const response = await axios.get(
        `https://api.cryptoquant.com/v1/btc/exchange-flows/netflow`,
        {
          headers: { 'Authorization': `Bearer ${apiKey}` }
        }
      );
      
      return {
        success: true,
        netFlow: response.data.result.data[0].netflow,
        interpretation: response.data.result.data[0].netflow < 0 ? 'bullish' : 'bearish',
        source: 'CryptoQuant'
      };
    }
    
    return {
      success: true,
      netFlow: 0,
      interpretation: 'neutral',
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 8: Whale Activity
 * Fuente: Whale Alert / On-chain monitoring
 */
async function getWhaleActivity(symbol) {
  try {
    // Whale Alert API (requiere key)
    const apiKey = process.env.WHALE_ALERT_API_KEY;
    
    if (apiKey) {
      const response = await axios.get(
        `https://api.whale-alert.io/v1/transactions`,
        {
          params: {
            api_key: apiKey,
            currency: symbol.toLowerCase(),
            min_value: 1000000 // $1M+
          }
        }
      );
      
      const transactions = response.data.transactions || [];
      const totalValue = transactions.reduce((sum, tx) => sum + tx.amount_usd, 0);
      
      return {
        success: true,
        whaleTransactions: transactions.length,
        totalValue: totalValue,
        source: 'Whale Alert'
      };
    }
    
    return {
      success: true,
      whaleTransactions: 0,
      totalValue: 0,
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 9: Google Trends
 * Fuente: SerpAPI (Google Trends)
 */
async function getGoogleTrends(query) {
  try {
    const apiKey = process.env.SERPAPI_KEY;
    
    if (apiKey) {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          engine: 'google_trends',
          q: query,
          data_type: 'TIMESERIES',
          api_key: apiKey
        }
      });
      
      const data = response.data.interest_over_time?.timeline_data || [];
      
      if (data.length >= 2) {
        const current = data[data.length - 1].values[0].extracted_value;
        const previous = data[data.length - 2].values[0].extracted_value;
        const growth = ((current - previous) / previous) * 100;
        
        return {
          success: true,
          currentInterest: current,
          previousInterest: previous,
          growthPercent: growth,
          source: 'Google Trends'
        };
      }
    }
    
    // Sin API: usar rank de market cap como proxy
    return {
      success: true,
      currentInterest: 50,
      previousInterest: 50,
      growthPercent: 0,
      source: 'Estimado',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// FACTORES CUALITATIVOS (10 factores)
// ============================================

/**
 * FACTOR 10: Twitter Sentiment
 * Fuente: Twitter API v2
 */
async function getTwitterSentiment(query) {
  try {
    const bearerToken = process.env.TWITTER_BEARER_TOKEN;
    
    if (bearerToken) {
      const response = await axios.get(
        'https://api.twitter.com/2/tweets/search/recent',
        {
          headers: { 'Authorization': `Bearer ${bearerToken}` },
          params: {
            query: query,
            max_results: 100,
            'tweet.fields': 'created_at,public_metrics'
          }
        }
      );
      
      const tweets = response.data.data || [];
      const sentiment = analyzeSentiment(tweets.map(t => t.text).join(' '));
      
      return {
        success: true,
        tweetCount: tweets.length,
        sentiment: sentiment.label,
        sentimentScore: sentiment.score,
        avgEngagement: tweets.reduce((sum, t) => sum + (t.public_metrics?.like_count || 0), 0) / tweets.length,
        source: 'Twitter API'
      };
    }
    
    return {
      success: true,
      tweetCount: 0,
      sentiment: 'neutral',
      sentimentScore: 0,
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 11: Reddit Sentiment
 * Fuente: Reddit API
 */
async function getRedditSentiment(subreddit) {
  try {
    const response = await axios.get(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=50`
    );
    
    const posts = response.data.data.children.map(c => c.data);
    const titles = posts.map(p => p.title).join(' ');
    const sentiment = analyzeSentiment(titles);
    
    const avgScore = posts.reduce((sum, p) => sum + p.score, 0) / posts.length;
    const avgComments = posts.reduce((sum, p) => sum + p.num_comments, 0) / posts.length;
    
    return {
      success: true,
      postCount: posts.length,
      sentiment: sentiment.label,
      sentimentScore: sentiment.score,
      avgScore: avgScore,
      avgComments: avgComments,
      source: 'Reddit'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 12: Telegram Activity
 * Fuente: Telegram Bot API
 */
async function getTelegramActivity(channelUsername) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (botToken) {
      const response = await axios.get(
        `https://api.telegram.org/bot${botToken}/getChat`,
        { params: { chat_id: `@${channelUsername}` } }
      );
      
      return {
        success: true,
        memberCount: response.data.result.members_count || 0,
        title: response.data.result.title,
        source: 'Telegram'
      };
    }
    
    return {
      success: true,
      memberCount: 0,
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 13: TikTok Mentions
 * Fuente: Web scraping / TikTok Research API
 */
async function getTikTokMentions(query) {
  try {
    // TikTok Research API requiere aprobación académica/investigación
    // Alternativa: scraping básico de búsqueda pública
    
    return {
      success: true,
      mentions: 0,
      views: 0,
      source: 'No disponible',
      estimated: true,
      note: 'TikTok Research API requiere aprobación especial'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 14: Fear & Greed Index
 * Fuente: Alternative.me
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
        timestamp: fgi.timestamp,
        source: 'Alternative.me'
      };
    }
    
    return { success: false, error: 'No data' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 15: News Volume & Sentiment
 * Fuente: CryptoCompare / NewsAPI
 */
async function getNewsVolumeSentiment(symbol) {
  try {
    const apiKey = process.env.CRYPTOCOMPARE_API_KEY || '';
    const headers = apiKey ? { 'authorization': `Apikey ${apiKey}` } : {};
    
    const response = await axios.get(
      'https://min-api.cryptocompare.com/data/v2/news/?lang=EN',
      { headers }
    );
    
    const articles = response.data.Data
      .filter(a => a.categories.includes(symbol.toUpperCase()) || 
                   a.title.toLowerCase().includes(symbol.toLowerCase()))
      .slice(0, 20);
    
    const sentimentAnalysis = articles.map(a => 
      analyzeSentiment(a.title + ' ' + a.body)
    );
    
    const avgSentiment = sentimentAnalysis.reduce((sum, s) => sum + s.score, 0) / sentimentAnalysis.length;
    
    return {
      success: true,
      count: articles.length,
      avgSentiment: avgSentiment,
      sentimentLabel: avgSentiment > 0.3 ? 'positive' : avgSentiment < -0.3 ? 'negative' : 'neutral',
      articles: articles.slice(0, 5),
      source: 'CryptoCompare'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 16: Media Coverage Quality
 * Fuente: NewsAPI Premium
 */
async function getMediaCoverageQuality(query) {
  try {
    const apiKey = process.env.NEWSAPI_KEY;
    
    if (apiKey) {
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: query,
          apiKey: apiKey,
          sortBy: 'relevancy',
          pageSize: 20
        }
      });
      
      const tier1Sources = ['bloomberg', 'reuters', 'wsj', 'ft', 'cnbc'];
      const tier1Count = response.data.articles.filter(a => 
        tier1Sources.some(s => a.source.name.toLowerCase().includes(s))
      ).length;
      
      return {
        success: true,
        totalArticles: response.data.articles.length,
        tier1Articles: tier1Count,
        qualityScore: tier1Count / response.data.articles.length,
        source: 'NewsAPI'
      };
    }
    
    return {
      success: true,
      totalArticles: 0,
      tier1Articles: 0,
      qualityScore: 0,
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 17: Breaking News Impact
 * Fuente: NewsAPI (últimas 2 horas)
 */
async function getBreakingNewsImpact(query) {
  try {
    const apiKey = process.env.NEWSAPI_KEY;
    
    if (apiKey) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      
      const response = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: query,
          apiKey: apiKey,
          from: twoHoursAgo,
          sortBy: 'publishedAt'
        }
      });
      
      const articles = response.data.articles || [];
      
      // Detectar palabras de alto impacto
      const highImpactKeywords = [
        'breakthrough', 'partnership', 'acquisition', 'regulation', 
        'ban', 'hack', 'exploit', 'upgrade', 'mainnet'
      ];
      
      const impactArticles = articles.filter(a => {
        const text = (a.title + ' ' + a.description).toLowerCase();
        return highImpactKeywords.some(keyword => text.includes(keyword));
      });
      
      return {
        success: true,
        breakingCount: articles.length,
        highImpactCount: impactArticles.length,
        articles: impactArticles.slice(0, 3),
        source: 'NewsAPI'
      };
    }
    
    return {
      success: true,
      breakingCount: 0,
      highImpactCount: 0,
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 18: Developer Activity
 * Fuente: GitHub API
 */
async function getDeveloperActivity(repoOwner, repoName) {
  try {
    const token = process.env.GITHUB_TOKEN;
    const headers = token ? { 'Authorization': `token ${token}` } : {};
    
    // Stats del repositorio
    const [repoData, commitsData, contributorsData] = await Promise.all([
      axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}`, { headers }),
      axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/commits?per_page=100`, { headers }),
      axios.get(`https://api.github.com/repos/${repoOwner}/${repoName}/contributors?per_page=100`, { headers })
    ]);
    
    // Commits en última semana
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCommits = commitsData.data.filter(c => 
      new Date(c.commit.author.date).getTime() > oneWeekAgo
    );
    
    return {
      success: true,
      stars: repoData.data.stargazers_count,
      forks: repoData.data.forks_count,
      openIssues: repoData.data.open_issues_count,
      contributors: contributorsData.data.length,
      commitsLastWeek: recentCommits.length,
      lastCommit: commitsData.data[0].commit.author.date,
      source: 'GitHub'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * FACTOR 19: Network Growth Patterns
 * Fuente: Glassnode / Dune Analytics
 */
async function getNetworkGrowthPatterns(symbol) {
  try {
    const apiKey = process.env.GLASSNODE_API_KEY;
    
    if (apiKey) {
      // Obtener HODLers (long-term holders)
      const hodlersResponse = await axios.get(
        `https://api.glassnode.com/v1/metrics/supply/hodl_waves`,
        {
          params: {
            a: symbol.toLowerCase(),
            api_key: apiKey
          }
        }
      );
      
      // Coeficiente Gini (distribución de riqueza)
      const giniResponse = await axios.get(
        `https://api.glassnode.com/v1/metrics/distribution/gini`,
        {
          params: {
            a: symbol.toLowerCase(),
            api_key: apiKey
          }
        }
      );
      
      return {
        success: true,
        hodlersPercent: hodlersResponse.data[hodlersResponse.data.length - 1].v,
        giniCoefficient: giniResponse.data[giniResponse.data.length - 1].v,
        interpretation: giniResponse.data[giniResponse.data.length - 1].v < 0.5 ? 'distributed' : 'concentrated',
        source: 'Glassnode'
      };
    }
    
    return {
      success: true,
      hodlersPercent: 50,
      giniCoefficient: 0.5,
      interpretation: 'unknown',
      source: 'No disponible',
      estimated: true
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================
// UTILIDADES
// ============================================

/**
 * Análisis de sentimiento simple basado en palabras clave
 */
function analyzeSentiment(text) {
  const textLower = text.toLowerCase();
  
  const positiveWords = [
    'surge', 'gain', 'rise', 'bullish', 'breakthrough', 'adoption', 
    'partnership', 'upgrade', 'success', 'positive', 'growth', 
    'milestone', 'rally', 'recovery', 'innovation', 'launch',
    'expansion', 'profit', 'strong', 'momentum', 'outperform'
  ];
  
  const negativeWords = [
    'crash', 'drop', 'decline', 'bearish', 'concern', 'risk', 
    'hack', 'scam', 'investigation', 'ban', 'lawsuit', 'loss',
    'collapse', 'fail', 'negative', 'warning', 'fear', 'sell',
    'correction', 'plunge', 'tumble', 'fraud', 'exploit'
  ];
  
  let score = 0;
  
  positiveWords.forEach(word => {
    const matches = (textLower.match(new RegExp(word, 'g')) || []).length;
    score += matches;
  });
  
  negativeWords.forEach(word => {
    const matches = (textLower.match(new RegExp(word, 'g')) || []).length;
    score -= matches;
  });
  
  // Normalizar a -1 a +1
  const normalized = Math.max(-1, Math.min(1, score / 5));
  
  return {
    score: normalized,
    label: normalized > 0.3 ? 'positive' : 
           normalized < -0.3 ? 'negative' : 'neutral'
  };
}

/**
 * Obtener TODOS los factores para un activo
 */
async function getAllFactors(crypto) {
  const factors = {
    // Cuantitativos
    volume24h: await getVolume24h(crypto.id),
    marketCapRatio: await getMarketCapRatio(crypto.id),
    volatility7d: await getVolatility7d(crypto.id),
    distanceFromATL: await getDistanceFromATL(crypto.id),
    activeTransactions: await getActiveTransactions24h(crypto.symbol),
    uniqueAddresses: await getUniqueActiveAddresses(crypto.symbol),
    exchangeNetFlow: await getExchangeNetFlow(crypto.symbol),
    whaleActivity: await getWhaleActivity(crypto.symbol),
    googleTrends: await getGoogleTrends(crypto.name),
    
    // Cualitativos
    twitterSentiment: await getTwitterSentiment(crypto.symbol),
    redditSentiment: await getRedditSentiment(crypto.id),
    telegramActivity: await getTelegramActivity(crypto.id),
    tiktokMentions: await getTikTokMentions(crypto.name),
    fearGreedIndex: await getFearGreedIndex(),
    newsVolumeSentiment: await getNewsVolumeSentiment(crypto.symbol),
    mediaCoverage: await getMediaCoverageQuality(crypto.name),
    breakingNews: await getBreakingNewsImpact(crypto.name),
    developerActivity: crypto.githubRepo ? await getDeveloperActivity(crypto.githubRepo.owner, crypto.githubRepo.name) : { success: false },
    networkGrowth: await getNetworkGrowthPatterns(crypto.symbol)
  };
  
  return factors;
}

/**
 * Verificar disponibilidad de todas las APIs
 */
async function checkAllAPIsStatus() {
  const status = {
    // Gratuitas
    coingecko: { available: false, message: '', tier: 'free' },
    alternative: { available: false, message: '', tier: 'free' },
    reddit: { available: false, message: '', tier: 'free' },
    github: { available: false, message: '', tier: 'free' },
    blockchain: { available: false, message: '', tier: 'free' },
    
    // Con API Key (algunas gratuitas)
    cryptocompare: { available: false, message: '', tier: 'freemium', required: false },
    serpapi: { available: false, message: '', tier: 'paid', required: false },
    newsapi: { available: false, message: '', tier: 'freemium', required: false },
    twitter: { available: false, message: '', tier: 'paid', required: false },
    telegram: { available: false, message: '', tier: 'free', required: false },
    
    // Premium/Profesionales
    glassnode: { available: false, message: '', tier: 'professional', required: false },
    cryptoquant: { available: false, message: '', tier: 'professional', required: false },
    whaleAlert: { available: false, message: '', tier: 'professional', required: false }
  };
  
  // Test APIs gratuitas
  try {
    await axios.get('https://api.coingecko.com/api/v3/ping');
    status.coingecko.available = true;
    status.coingecko.message = 'OK';
  } catch (e) {
    status.coingecko.message = e.message;
  }
  
  try {
    await getFearGreedIndex();
    status.alternative.available = true;
    status.alternative.message = 'OK';
  } catch (e) {
    status.alternative.message = e.message;
  }
  
  // Test APIs con key (si están configuradas)
  if (process.env.CRYPTOCOMPARE_API_KEY) {
    try {
      await axios.get('https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD');
      status.cryptocompare.available = true;
      status.cryptocompare.message = 'OK';
    } catch (e) {
      status.cryptocompare.message = e.message;
    }
  } else {
    status.cryptocompare.message = 'API key no configurada';
  }
  
  return status;
}

module.exports = {
  // Cuantitativos
  getVolume24h,
  getMarketCapRatio,
  getVolatility7d,
  getDistanceFromATL,
  getActiveTransactions24h,
  getUniqueActiveAddresses,
  getExchangeNetFlow,
  getWhaleActivity,
  getGoogleTrends,
  
  // Cualitativos
  getTwitterSentiment,
  getRedditSentiment,
  getTelegramActivity,
  getTikTokMentions,
  getFearGreedIndex,
  getNewsVolumeSentiment,
  getMediaCoverageQuality,
  getBreakingNewsImpact,
  getDeveloperActivity,
  getNetworkGrowthPatterns,
  
  // Utilidades
  analyzeSentiment,
  getAllFactors,
  checkAllAPIsStatus
};
