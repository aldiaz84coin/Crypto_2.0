# 🚀 Crypto Detector - Versión Avanzada con Sistema de Pesos

## ✨ Nuevas Características v3.1

### 🎯 Sistema Avanzado de Clasificación

**19 Factores Configurables:**
- 🔢 **9 Factores Cuantitativos** (Volumen, Market Cap, Volatilidad, etc.)
- 💭 **10 Factores Cualitativos** (Sentiment, Noticias, Social Media, etc.)

**61 Parámetros Ajustables:**
- Meta-pesos (Cuanti vs Cuali)
- 19 pesos individuales de factores
- 40 umbrales configurables

**Ventajas:**
- ✅ Control total sobre el algoritmo
- ✅ Ajuste fino por tipo de mercado
- ✅ Entrenamiento optimiza TODOS los parámetros
- ✅ Breakdown detallado de cada predicción

---

## 📊 Factores Implementados (Fase 1)

### Cuantitativos (Ya Disponibles):
1. ✅ **Volumen 24h** - Trading volume
2. ✅ **Market Cap Ratio** - vs Bitcoin
3. ✅ **Volatilidad** - Price movement
4. ✅ **Historical Low** - % sobre ATL
5. ✅ **Google Trends** - Search interest

### Cualitativos (Ya Disponibles):
6. ✅ **Fear & Greed Index** - Market sentiment
7. ✅ **News Volume** - Cantidad + sentiment
8. ✅ **News Count** - Número de noticias

### Próximamente (Fase 2-3):
9. ⏳ Twitter Sentiment
10. ⏳ Reddit Sentiment
11. ⏳ Telegram Activity
12. ⏳ TikTok Mentions
13. ⏳ Media Coverage Quality
14. ⏳ Developer Activity (GitHub)
15. ⏳ On-Chain Metrics (Glassnode)
16. ⏳ Whale Activity
17. ⏳ Exchange Flow
18. ⏳ Network Growth

---

## 🎛️ Configuración del Algoritmo

### Meta-Pesos (Cuantitativos vs Cualitativos)

```javascript
{
  quantitative: 0.60,  // 60% del peso total
  qualitative: 0.40    // 40% del peso total
}
```

### Pesos de Factores Individuales

```javascript
{
  // Cuantitativos
  volume: 0.10,          // 10%
  marketCap: 0.08,       // 8%
  volatility: 0.07,      // 7%
  historicalLow: 0.05,   // 5%
  googleTrends: 0.10,    // 10%
  
  // Cualitativos
  fearGreedIndex: 0.02,  // 2%
  newsVolume: 0.12,      // 12%
  newsCount: 0.08        // 8%
}
```

### Umbrales Configurables

```javascript
{
  volumeMin: 100000000,        // $100M
  volumeMax: 10000000000,      // $10B
  marketCapRatioMin: 0.001,    // 0.1% de BTC
  marketCapRatioMax: 0.5,      // 50% de BTC
  volatilityMin: 0.05,         // 5%
  volatilityMax: 0.50,         // 50%
  historicalLowPercentile: 25, // 25%
  searchIncreaseMin: 50,       // 50%
  searchIncreaseMax: 300,      // 300%
  fearGreedOptimalMin: 20,     // Comprar en miedo
  fearGreedOptimalMax: 45,
  newsCountMin: 3,
  newsCountMax: 100,
  newsSentimentMin: 0.2
}
```

---

## 🆕 Nuevos Endpoints API

### GET /api/config
Obtener configuración actual del algoritmo

```bash
curl https://tu-app.vercel.app/api/config
```

Respuesta:
```json
{
  "success": true,
  "config": {
    "metaWeights": {...},
    "factorWeights": {...},
    "thresholds": {...}
  }
}
```

### POST /api/config
Guardar nueva configuración

```bash
curl -X POST https://tu-app.vercel.app/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "metaWeights": {"quantitative": 0.65, "qualitative": 0.35},
      "factorWeights": {...},
      "thresholds": {...}
    }
  }'
```

### POST /api/config/reset
Resetear a valores por defecto

```bash
curl -X POST https://tu-app.vercel.app/api/config/reset
```

### GET /api/config/metadata
Obtener metadata de factores (para UI)

```bash
curl https://tu-app.vercel.app/api/config/metadata
```

---

## 📦 Instalación

### Requisitos
- Vercel Hobby Plan (gratis)
- Vercel KV (gratis)
- Node.js 18+

### Pasos

```bash
# 1. Extraer
tar -xzf crypto-detector-ADVANCED.tar.gz

# 2. Reemplazar proyecto
cp -r crypto-detector-ADVANCED/* tu-proyecto/
cd tu-proyecto

# 3. Instalar
npm install

# 4. Configurar Vercel KV
# (ver INSTRUCCIONES.md)

# 5. Deploy
git add .
git commit -m "Deploy Advanced v3.1"
git push
```

---

## 🎨 Nueva UI (Próximamente)

La UI incluirá:

### Pestaña "Configuración Avanzada"
- 🎛️ Sliders para meta-pesos
- 📊 Sliders para cada factor
- 🔢 Inputs para umbrales
- 💾 Guardar configuración
- 🔄 Resetear a default
- 📈 Preview del impacto

### Breakdown Detallado
```
Bitcoin (BTC)
BoostPower: 0.78 (Alto)

Cuantitativos (0.65): ████████░░
├─ Volumen:       0.85 ████████░░ (10%)
├─ Market Cap:    0.92 █████████░ (8%)
├─ Volatilidad:   0.45 ████░░░░░░ (7%)
├─ Historical:    0.30 ███░░░░░░░ (5%)
└─ Trends:        0.88 ████████░░ (10%)

Cualitativos (0.72): ███████░░░
├─ Fear & Greed:  0.95 █████████░ (2%)
├─ News Volume:   0.65 ██████░░░░ (12%)
└─ News Count:    0.78 ███████░░░ (8%)

Clasificación: INVERTIBLE ✓
```

---

## 🧠 Entrenamiento Mejorado

El algoritmo de entrenamiento ahora optimiza:
- ✅ 2 meta-pesos
- ✅ 8 pesos de factores (activos)
- ✅ 13 umbrales (activos)

**Total: 23 parámetros actualmente**
**Futuro: 61 parámetros con todas las APIs**

---

## 🔌 Integración de APIs (Fases)

### Fase 1 (Actual) ✅
- CoinGecko (precios, volumen, market cap)
- Fear & Greed Index
- Google Trends (SerpAPI)
- CryptoCompare (noticias)

### Fase 2 (Social Media)
- Twitter API + VADER NLP
- Reddit API
- GitHub API
- Telegram Bot API

### Fase 3 (On-Chain)
- Glassnode (métricas on-chain)
- CryptoQuant (exchange flows)
- Dune Analytics (patrones)

### Fase 4 (Premium)
- LunarCrush (social aggregated)
- Santiment (advanced sentiment)
- Messari (professional data)

---

## 📊 Comparación de Versiones

| Característica | v2.0 | v3.0 | v3.1 (Esta) |
|----------------|------|------|-------------|
| Factores | 5 fijos | 8 fijos | 8 configurables |
| Pesos | Fijos | Fijos | Ajustables (61) |
| Umbrales | 5 | 10 | 13 configurables |
| Breakdown | No | Básico | Detallado |
| Guardado Config | No | No | ✅ Sí (KV) |
| Entrenamiento | 5 params | 10 params | 23 params |

---

## 💡 Casos de Uso

### 1. Trading Agresivo
```javascript
{
  metaWeights: {
    quantitative: 0.70,  // Más peso a números
    qualitative: 0.30
  },
  factorWeights: {
    volume: 0.15,        // Mayor peso a volumen
    volatility: 0.10     // Mayor peso a volatilidad
  }
}
```

### 2. Inversión Conservadora
```javascript
{
  metaWeights: {
    quantitative: 0.50,
    qualitative: 0.50    // Más peso a sentiment
  },
  factorWeights: {
    newsVolume: 0.15,    // Mayor peso a noticias
    fearGreedIndex: 0.05 // Comprar en miedo
  }
}
```

### 3. Análisis Técnico Puro
```javascript
{
  metaWeights: {
    quantitative: 0.85,  // Casi todo cuantitativo
    qualitative: 0.15
  },
  factorWeights: {
    volume: 0.15,
    marketCap: 0.12,
    volatility: 0.12
  }
}
```

---

## 🎯 Próximos Pasos

1. **Implementar UI avanzada**
   - Sliders para todos los parámetros
   - Visualización de breakdown
   - Comparación de configuraciones

2. **Integrar APIs sociales**
   - Twitter Sentiment
   - Reddit Analysis
   - GitHub Activity

3. **Añadir métricas on-chain**
   - Glassnode integration
   - CryptoQuant flows
   - Dune patterns

4. **Optimizar entrenamiento**
   - Genetic Algorithm
   - Cross-validation
   - Backtesting

---

## 📖 Documentación Completa

Ver **INSTRUCCIONES-ADVANCED.md** para:
- Instalación paso a paso
- Configuración de APIs
- Uso de nuevos endpoints
- Troubleshooting

---

## 🎉 ¡Listo para Usar!

Esta versión funciona 100% con los recursos actuales y está preparada para integrar nuevas APIs gradualmente.

**Compatibilidad:**
- ✅ Vercel Hobby Plan (gratis)
- ✅ Sin cron job
- ✅ Vercel KV para persistencia
- ✅ Retrocompatible con v3.0

¡Empieza a experimentar con diferentes configuraciones! 🚀
