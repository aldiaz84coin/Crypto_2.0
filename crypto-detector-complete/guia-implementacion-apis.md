# Guía de Implementación - Detector de Criptoactivos con APIs Reales

## 📊 Estado Actual de Integración

### ✅ APIs Integradas:
- **CoinGecko API** (Gratuita) - Completamente funcional
  - Precios en tiempo real de 100+ criptomonedas
  - Capitalización de mercado
  - Volumen 24h
  - Cambios de precio 24h y 7d
  - Datos históricos (sparkline)
  - All Time High (ATH)

### ⚠️ APIs Simuladas (Requieren Implementación):
- **Google Trends** - Tendencias de búsqueda
- **CryptoCompare / NewsAPI** - Noticias y sentimiento

---

## 🔌 APIs Recomendadas para Completar la Integración

### 1. Google Trends - Tendencias de Búsqueda

#### Opción A: SerpAPI (Recomendada - Más fácil)
```javascript
const fetchGoogleTrends = async (keyword) => {
  const apiKey = 'TU_SERPAPI_KEY';
  const response = await fetch(
    `https://serpapi.com/search.json?engine=google_trends&q=${keyword}&api_key=${apiKey}`
  );
  const data = await response.json();
  return data.interest_over_time;
};
```

**Características:**
- ✓ API REST simple
- ✓ 100 búsquedas gratis/mes
- ✓ Datos en JSON
- 💰 Plan Pro: $50/mes (5,000 búsquedas)
- 🌐 Website: https://serpapi.com

#### Opción B: pytrends (Requiere backend Python)
```python
from pytrends.request import TrendReq
import json

pytrends = TrendReq(hl='en-US', tz=360)
pytrends.build_payload(['bitcoin'], timeframe='now 1-d')
interest = pytrends.interest_over_time()

# Calcular incremento
trend_increase = ((interest['bitcoin'].iloc[-1] - interest['bitcoin'].iloc[0]) / 
                  interest['bitcoin'].iloc[0]) * 100
```

**Características:**
- ✓ Gratuita
- ✓ Sin límites estrictos
- ⚠ Requiere backend Python
- ⚠ Rate limits de Google

---

### 2. CryptoCompare API - Noticias y Sentimiento

```javascript
const fetchCryptoNews = async (symbol) => {
  const apiKey = 'TU_CRYPTOCOMPARE_KEY';
  const response = await fetch(
    `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${symbol}&api_key=${apiKey}`
  );
  const data = await response.json();
  
  return {
    newsCount: data.Data.length,
    sentiment: calculateSentiment(data.Data) // Analizar títulos
  };
};

// Función para calcular sentimiento
const calculateSentiment = (newsArticles) => {
  const positiveWords = ['surge', 'rally', 'bullish', 'gain', 'rise', 'breakthrough'];
  const negativeWords = ['crash', 'fall', 'bearish', 'drop', 'decline', 'dump'];
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  newsArticles.forEach(article => {
    const text = (article.title + ' ' + article.body).toLowerCase();
    positiveWords.forEach(word => {
      if (text.includes(word)) positiveCount++;
    });
    negativeWords.forEach(word => {
      if (text.includes(word)) negativeCount++;
    });
  });
  
  const total = positiveCount + negativeCount;
  return total > 0 ? positiveCount / total : 0.5;
};
```

**Características:**
- ✓ 100,000 llamadas gratis/mes
- ✓ Noticias en tiempo real
- ✓ Datos históricos
- 💰 Plan Pro: $30/mes
- 🌐 Website: https://www.cryptocompare.com/api

---

### 3. Alternative.me Crypto Fear & Greed Index

```javascript
const fetchFearGreedIndex = async () => {
  const response = await fetch('https://api.alternative.me/fng/?limit=1');
  const data = await response.json();
  return {
    value: data.data[0].value, // 0-100
    classification: data.data[0].value_classification // Extreme Fear, Fear, Neutral, Greed, Extreme Greed
  };
};
```

**Características:**
- ✓ Completamente gratuita
- ✓ Sin API key necesaria
- ✓ Indicador del sentimiento del mercado
- 🌐 Website: https://alternative.me/crypto/fear-and-greed-index/

---

### 4. Reddit / Twitter API - Sentimiento Social

#### Reddit API (Pushshift)
```javascript
const fetchRedditSentiment = async (cryptoSymbol) => {
  const subreddit = 'CryptoCurrency';
  const response = await fetch(
    `https://api.pushshift.io/reddit/search/submission/?subreddit=${subreddit}&q=${cryptoSymbol}&size=100`
  );
  const data = await response.json();
  
  return {
    mentions: data.data.length,
    avgScore: data.data.reduce((sum, post) => sum + post.score, 0) / data.data.length
  };
};
```

#### Twitter API (Requiere cuenta developer)
```javascript
const fetchTwitterMentions = async (cryptoSymbol) => {
  const apiKey = 'TU_TWITTER_API_KEY';
  const response = await fetch(
    `https://api.twitter.com/2/tweets/counts/recent?query=${cryptoSymbol}`,
    {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }
  );
  const data = await response.json();
  return data.meta.total_tweet_count;
};
```

---

## 🏗️ Arquitectura Recomendada

```
┌─────────────────┐
│  React Frontend │
│   (Tu App JSX)  │
└────────┬────────┘
         │
         ├──────────► CoinGecko API (Directo desde navegador)
         │
         ├──────────► Alternative.me (Directo desde navegador)
         │
         └──────────► Backend/Proxy
                      ├──► Google Trends (SerpAPI o pytrends)
                      ├──► CryptoCompare
                      ├──► Reddit API
                      └──► Twitter API
```

---

## 🚀 Implementación Paso a Paso

### Paso 1: Registrar APIs

1. **CoinGecko** (Ya integrada)
   - No requiere API key para uso básico
   - Límite: 50 llamadas/minuto

2. **SerpAPI** para Google Trends
   - Registrarse en https://serpapi.com
   - Obtener API key gratuita
   - 100 búsquedas/mes gratis

3. **CryptoCompare**
   - Registrarse en https://www.cryptocompare.com
   - Crear API key gratuita
   - 100k llamadas/mes gratis

### Paso 2: Crear Backend Simple (Node.js/Express)

```javascript
// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// Endpoint para Google Trends
app.get('/api/trends/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get(
      `https://serpapi.com/search.json?engine=google_trends&q=${symbol}&api_key=${process.env.SERPAPI_KEY}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para noticias
app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await axios.get(
      `https://min-api.cryptocompare.com/data/v2/news/?categories=${symbol}&api_key=${process.env.CRYPTOCOMPARE_KEY}`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3001, () => console.log('Backend running on port 3001'));
```

### Paso 3: Actualizar Frontend para usar Backend

```javascript
// En tu componente React
const fetchSearchTrend = async (symbol) => {
  try {
    const response = await fetch(`http://localhost:3001/api/trends/${symbol}`);
    const data = await response.json();
    
    // Procesar datos de tendencia
    const trendData = data.interest_over_time?.timeline_data || [];
    if (trendData.length < 2) return 0;
    
    const latest = trendData[trendData.length - 1].values[0].extracted_value;
    const previous = trendData[0].values[0].extracted_value;
    
    return ((latest - previous) / previous) * 100;
  } catch (error) {
    console.error('Error fetching trends:', error);
    return 0;
  }
};

const fetchCryptoNews = async (symbol) => {
  try {
    const response = await fetch(`http://localhost:3001/api/news/${symbol}`);
    const data = await response.json();
    
    const articles = data.Data || [];
    const newsCount = articles.length;
    
    // Calcular sentimiento
    const sentiment = calculateSentiment(articles);
    
    return { newsCount, sentiment };
  } catch (error) {
    console.error('Error fetching news:', error);
    return { newsCount: 0, sentiment: 0.5 };
  }
};
```

---

## 📊 Optimizaciones para Reducir Llamadas API

### 1. Caché en Redis
```javascript
const redis = require('redis');
const client = redis.createClient();

// Cachear datos por 5 minutos
app.get('/api/trends/:symbol', async (req, res) => {
  const cacheKey = `trends:${req.params.symbol}`;
  
  // Intentar obtener del caché
  const cached = await client.get(cacheKey);
  if (cached) {
    return res.json(JSON.parse(cached));
  }
  
  // Si no está en caché, obtener de API
  const data = await fetchFromAPI(req.params.symbol);
  
  // Guardar en caché por 5 minutos
  await client.setEx(cacheKey, 300, JSON.stringify(data));
  
  res.json(data);
});
```

### 2. Batch Processing
```javascript
// Procesar múltiples símbolos en lotes
const processBatch = async (symbols) => {
  const batchSize = 10;
  const results = [];
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(symbol => fetchCryptoNews(symbol))
    );
    results.push(...batchResults);
    
    // Esperar 1 segundo entre lotes para respetar rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
};
```

### 3. Priorización Inteligente
```javascript
// Solo analizar en detalle los activos más prometedores
const smartAnalysis = async (cryptos) => {
  // Fase 1: Análisis rápido (solo CoinGecko)
  const quickFiltered = cryptos.filter(c => 
    Math.abs(c.priceChange24h) > 10 || c.volume24h / c.marketCap > 0.3
  );
  
  // Fase 2: Análisis profundo (con tendencias y noticias)
  const deepAnalysis = await Promise.all(
    quickFiltered.slice(0, 20).map(async crypto => ({
      ...crypto,
      trends: await fetchSearchTrend(crypto.symbol),
      news: await fetchCryptoNews(crypto.symbol)
    }))
  );
  
  return deepAnalysis;
};
```

---

## 🎯 Mejoras Adicionales Sugeridas

### 1. Análisis de Volumen en Exchanges
```javascript
// Binance API - Volumen por exchange
const fetchExchangeVolume = async (symbol) => {
  const response = await fetch(
    `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}USDT`
  );
  const data = await response.json();
  return {
    volume: data.volume,
    quoteVolume: data.quoteVolume,
    priceChange: data.priceChangePercent
  };
};
```

### 2. On-Chain Metrics (The Graph)
```javascript
const fetchOnChainData = async (tokenAddress) => {
  const query = `
    {
      token(id: "${tokenAddress}") {
        txCount
        totalLiquidity
        derivedETH
      }
    }
  `;
  
  const response = await fetch('https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  
  return await response.json();
};
```

### 3. Whale Watching (Etherscan API)
```javascript
const detectWhaleMovements = async (tokenAddress) => {
  const apiKey = 'TU_ETHERSCAN_KEY';
  const response = await fetch(
    `https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=100&sort=desc&apikey=${apiKey}`
  );
  const data = await response.json();
  
  // Detectar transacciones grandes (> $100k)
  const whaleTransactions = data.result.filter(tx => 
    parseInt(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)) > 100000
  );
  
  return {
    whaleCount: whaleTransactions.length,
    totalVolume: whaleTransactions.reduce((sum, tx) => 
      sum + parseInt(tx.value) / Math.pow(10, parseInt(tx.tokenDecimal)), 0
    )
  };
};
```

---

## 💰 Costos Estimados

### Plan Gratuito (Limitado)
- CoinGecko: ✓ Gratis (50 req/min)
- Alternative.me: ✓ Gratis
- SerpAPI: 100 búsquedas/mes
- CryptoCompare: 100k llamadas/mes
- **Total: $0/mes**

### Plan Starter (Recomendado)
- CoinGecko: Gratis
- SerpAPI: $50/mes (5k búsquedas)
- CryptoCompare: $30/mes
- Redis Cloud: $10/mes
- **Total: ~$90/mes**

### Plan Professional
- CoinGecko Pro: $129/mes
- SerpAPI Pro: $150/mes
- CryptoCompare Pro: $80/mes
- AWS/DigitalOcean: $50/mes
- **Total: ~$400/mes**

---

## 🔐 Seguridad y Mejores Prácticas

1. **Variables de Entorno**
```bash
# .env
SERPAPI_KEY=tu_clave_aqui
CRYPTOCOMPARE_KEY=tu_clave_aqui
TWITTER_BEARER_TOKEN=tu_token_aqui
REDIS_URL=redis://localhost:6379
```

2. **Rate Limiting**
```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100 // límite de requests
});

app.use('/api/', limiter);
```

3. **Error Handling**
```javascript
const withRetry = async (fn, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
};
```

---

## 📚 Recursos Adicionales

- **CoinGecko Docs**: https://www.coingecko.com/api/documentation
- **SerpAPI Docs**: https://serpapi.com/google-trends-api
- **CryptoCompare Docs**: https://min-api.cryptocompare.com/documentation
- **Alternative.me API**: https://alternative.me/crypto/fear-and-greed-index/
- **Binance API**: https://binance-docs.github.io/apidocs/spot/en/

---

## 🎓 Próximos Pasos

1. ✅ Registrar en SerpAPI y CryptoCompare
2. ✅ Crear backend simple con Express
3. ✅ Implementar caché con Redis
4. ✅ Actualizar funciones en el frontend
5. ✅ Testear con datos reales
6. ✅ Monitorear rate limits
7. ✅ Optimizar y escalar

¡Tu aplicación estará lista para detectar oportunidades reales de inversión en criptoactivos!
