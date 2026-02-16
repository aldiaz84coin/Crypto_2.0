# 📊 GUÍA COMPLETA DE APIs Y CONFIGURACIÓN
## Crypto Detector v3.2 FINAL

---

## 🎯 RESUMEN EJECUTIVO

El sistema soporta **4 modos de operación** según las APIs configuradas:
- 🟢 **Básico:** $0/mes → 8 factores (42%)
- 🟡 **Mejorado:** $0/mes → 12 factores (63%)
- 🟠 **Completo:** $150/mes → 14 factores (74%)
- 🔴 **Profesional:** $300-900/mes → 18 factores (95%)

---

## 📋 TABLA COMPLETA DE APIs

| # | API | Factor(es) | Tier | Costo/Mes | Límites Gratis | Estado | Link |
|---|-----|------------|------|-----------|----------------|--------|------|
| 1 | **CoinGecko** | Vol, MCap, Volatilidad, ATL | Free | $0 | 50 calls/min | ✅ Activo | coingecko.com |
| 2 | **Alternative.me** | Fear & Greed | Free | $0 | Ilimitado | ✅ Activo | alternative.me/crypto/fear-and-greed-index |
| 3 | **Reddit** | Reddit Sentiment | Free | $0 | 60/min sin auth | ✅ Activo | reddit.com/dev/api |
| 4 | **Blockchain.info** | Transacciones BTC | Free | $0 | Ilimitado | ✅ Activo | blockchain.com/api |
| 5 | **CryptoCompare** | News Volume & Sentiment | Freemium | $0 | 100K/mes | ✅ Activo | cryptocompare.com |
| 6 | **NewsAPI** | Media Coverage, Breaking | Freemium | $0 | 100/día | ⏳ Opcional | newsapi.org |
| 7 | **GitHub** | Developer Activity | Freemium | $0 | 5K/hora con token | ✅ Activo | github.com/settings/tokens |
| 8 | **Telegram** | Telegram Activity | Free | $0 | Ilimitado | ⏳ Opcional | t.me/botfather |
| 9 | **SerpAPI** | Google Trends | Paid | $50 | 100/mes gratis | ⏳ Opcional | serpapi.com |
| 10 | **Twitter API** | Twitter Sentiment | Paid | $100 | 0 (solo pago) | ⏳ Opcional | developer.twitter.com |
| 11 | **Glassnode** | Addresses, Network Growth | Premium | $29-799 | 0 (solo pago) | ⏳ Opcional | glassnode.com |
| 12 | **CryptoQuant** | Exchange Net Flow | Premium | $49-899 | 0 (solo pago) | ⏳ Opcional | cryptoquant.com |
| 13 | **Whale Alert** | Whale Activity | Premium | $49 | 0 (solo pago) | ⏳ Opcional | whale-alert.io |

---

## 🔧 CONFIGURACIÓN DETALLADA POR API

### 🟢 **TIER FREE (Sin configuración necesaria)**

#### **1. CoinGecko**
```
✅ Ya funciona sin configuración
Factores: Volume 24h, Market Cap, Volatilidad, Distancia ATL
Límites: 50 calls/minuto
Upgrade Pro: $129/mes (500 calls/min)
```

#### **2. Alternative.me (Fear & Greed)**
```
✅ Ya funciona sin configuración
Factor: Fear & Greed Index
Límites: Sin límites conocidos
Costo: Gratis siempre
```

#### **3. Reddit**
```
✅ Ya funciona sin configuración
Factor: Reddit Sentiment
Límites: 60 requests/minuto sin autenticación
Nota: Con OAuth (gratis) → 600/minuto
```

#### **4. Blockchain.info**
```
✅ Ya funciona sin configuración
Factor: Transacciones Activas (solo BTC)
Límites: Sin límites estrictos
Costo: Gratis siempre
```

---

### 🟡 **TIER FREEMIUM (Recomendado configurar)**

#### **5. CryptoCompare**
```
🔑 Requiere API Key (gratis)

Paso a paso:
1. Ir a: https://www.cryptocompare.com/cryptopian/api-keys
2. Crear cuenta (email + password)
3. Dashboard → "Create Your First Key"
4. Copiar key
5. En Vercel: CRYPTOCOMPARE_API_KEY=tu_key

Factores: News Volume, News Sentiment
Límites gratis: 100,000 calls/mes
Suficiente para: ~2,000 análisis/día
Upgrade: $24.99/mes (1M calls)
```

#### **6. NewsAPI**
```
🔑 Requiere API Key (gratis limitado)

Paso a paso:
1. Ir a: https://newsapi.org/register
2. Registrarse con email
3. Confirmar email
4. Copiar API key
5. En Vercel: NEWSAPI_KEY=tu_key

Factores: Media Coverage Quality, Breaking News
Límites gratis: 100 requests/día
Suficiente para: 5 análisis completos/día
Limitación: Solo noticias últimos 30 días en tier gratis
Upgrade: $449/mes (Business plan, sin límites)
```

#### **7. GitHub**
```
🔑 Requiere Token (gratis)

Paso a paso:
1. Ir a: https://github.com/settings/tokens
2. "Generate new token (classic)"
3. Permisos: public_repo
4. Copiar token (empieza con ghp_)
5. En Vercel: GITHUB_TOKEN=ghp_tu_token

Factor: Developer Activity
Límites sin token: 60/hora
Límites con token: 5,000/hora
Upgrade: No necesario (gratis es suficiente)
```

#### **8. Telegram Bot**
```
🔑 Requiere Bot Token (gratis)

Paso a paso:
1. Telegram → Buscar @BotFather
2. /newbot
3. Seguir instrucciones
4. Copiar token
5. En Vercel: TELEGRAM_BOT_TOKEN=tu_token

Factor: Telegram Activity
Límites: Sin límites (razonables)
Costo: Gratis siempre
```

---

### 🟠 **TIER PAID (Para uso serio)**

#### **9. SerpAPI (Google Trends)**
```
💰 Requiere pago ($50/mes)

Paso a paso:
1. Ir a: https://serpapi.com/
2. Crear cuenta
3. Plan Starter: 100 búsquedas/mes GRATIS
4. Upgrade a $50/mes para 5,000 búsquedas
5. Copiar API key
6. En Vercel: SERPAPI_KEY=tu_key

Factor: Google Trends real
Tier gratis: 100 búsquedas/mes
Plan Starter: $50/mes (5,000 búsquedas)
Suficiente para: 250 análisis completos/día
```

#### **10. Twitter API v2**
```
💰 Requiere pago ($100/mes)

Paso a paso:
1. Ir a: https://developer.twitter.com/
2. Solicitar acceso (puede tomar 1-3 días)
3. Plan Basic: $100/mes
4. Crear app y obtener Bearer Token
5. En Vercel: TWITTER_BEARER_TOKEN=tu_token

Factor: Twitter Sentiment
Límites Basic: 500,000 tweets/mes
Suficiente para: ~16,000 análisis/día
Upgrade: Enterprise (contactar para precio)
```

---

### 🔴 **TIER PREMIUM (Para profesionales)**

#### **11. Glassnode**
```
💰💰 Requiere suscripción premium

Planes:
- Starter: $29/mes (métricas básicas)
- Advanced: $99/mes (más métricas, menor delay)
- Professional: $799/mes (todas las métricas, real-time)

Paso a paso:
1. Ir a: https://glassnode.com/
2. Elegir plan
3. Dashboard → API → Copy API Key
4. En Vercel: GLASSNODE_API_KEY=tu_key

Factores: Unique Addresses, Network Growth Patterns
Recomendación: Advanced ($99) es el sweet spot
```

#### **12. CryptoQuant**
```
💰💰 Requiere suscripción premium

Planes:
- Starter: $49/mes
- Pro: $249/mes
- Premium: $899/mes

Paso a paso:
1. Ir a: https://cryptoquant.com/
2. Elegir plan Starter
3. Settings → API Management
4. En Vercel: CRYPTOQUANT_API_KEY=tu_key

Factor: Exchange Net Flow
Recomendación: Starter ($49) suficiente para inicio
```

#### **13. Whale Alert**
```
💰💰 Requiere suscripción

Plan único: $49/mes

Paso a paso:
1. Ir a: https://whale-alert.io/
2. Subscriptions → Basic ($49/mes)
3. Copiar API key
4. En Vercel: WHALE_ALERT_API_KEY=tu_key

Factor: Whale Activity
Límites: 1,000 calls/día
Suficiente para: 50 análisis completos/día
```

---

## 💰 ANÁLISIS DE COSTOS

### **Opción 1: Gratis Total**
```
APIs: CoinGecko, Alternative.me, Reddit, Blockchain.info
Costo: $0/mes
Factores activos: 8/19 (42%)
Pros: Sin costo, sin tarjeta de crédito
Contras: Datos limitados, menor precisión
Recomendado para: Aprendizaje, pruebas
```

### **Opción 2: Freemium Optimizada** ⭐
```
APIs: Opción 1 + CryptoCompare + NewsAPI + GitHub Token
Costo: $0/mes
Factores activos: 12/19 (63%)
Pros: Sin costo, buenos datos, 60% cobertura
Contras: Límites diarios (pero suficientes)
Recomendado para: Uso regular, trading amateur
```

### **Opción 3: Semi-Pro**
```
APIs: Opción 2 + SerpAPI ($50)
Costo: $50/mes
Factores activos: 13/19 (68%)
Pros: Google Trends real, bajo costo
Contras: Aún sin Twitter ni on-chain premium
Recomendado para: Trading serio, señales precisas
```

### **Opción 4: Completa**
```
APIs: Opción 3 + Twitter ($100)
Costo: $150/mes
Factores activos: 14/19 (74%)
Pros: Sentimiento completo, buena cobertura
Contras: Sin métricas on-chain profesionales
Recomendado para: Trading activo diario
```

### **Opción 5: Profesional Básica** ⭐
```
APIs: Opción 4 + Glassnode Advanced ($99)
Costo: $249/mes
Factores activos: 16/19 (84%)
Pros: Métricas on-chain profesionales
Contras: Costo mensual considerable
Recomendado para: Fondos pequeños, semi-institucional
```

### **Opción 6: Profesional Completa**
```
APIs: Opción 5 + CryptoQuant ($49) + Whale Alert ($49)
Costo: $347/mes
Factores activos: 18/19 (95%)
Pros: Casi todos los factores, máxima precisión
Contras: Costo alto
Recomendado para: Trading profesional, institucional
```

---

## 🎯 RECOMENDACIONES POR PERFIL

### **Principiante / Aprendiz**
```
Configuración: Gratis Total
Tiempo de setup: 0 minutos
Costo mensual: $0
Factores: 8/19 (42%)
Accuracy esperada: 55-60%

Siguiente paso:
Después de 1 mes → Añadir Freemium (CryptoCompare, NewsAPI)
```

### **Trader Amateur / Hobbyista**
```
Configuración: Freemium Optimizada ⭐ RECOMENDADO
Tiempo de setup: 15 minutos
Costo mensual: $0
Factores: 12/19 (63%)
Accuracy esperada: 60-65%

Siguiente paso:
Si accuracy > 65% consistentemente → Considerar SerpAPI
```

### **Trader Activo**
```
Configuración: Completa
Tiempo de setup: 30 minutos
Costo mensual: $150
Factores: 14/19 (74%)
Accuracy esperada: 65-72%
ROI break-even: ~5% mensual sobre capital

Siguiente paso:
Si ROI > 10% mensual → Añadir Glassnode
```

### **Profesional / Fondo**
```
Configuración: Profesional Completa
Tiempo de setup: 1 hora
Costo mensual: $347
Factores: 18/19 (95%)
Accuracy esperada: 70-78%
ROI break-even: ~2% mensual sobre capital

Siguiente paso:
Integración con exchanges, automatización completa
```

---

## 📊 ROADMAP DE IMPLEMENTACIÓN SUGERIDO

### **Semana 1: Base Gratuita**
- [ ] Setup Upstash Redis
- [ ] Verificar APIs gratuitas funcionan
- [ ] Ejecutar 3-5 ciclos de 12h
- [ ] Medir accuracy baseline

### **Semana 2-3: Optimización Gratis**
- [ ] Ajustar pesos de configuración
- [ ] Probar diferentes umbrales
- [ ] Documentar patrones que funcionan
- [ ] Target: Accuracy > 55%

### **Semana 4: Upgrade Freemium**
- [ ] Configurar CryptoCompare
- [ ] Configurar NewsAPI
- [ ] Configurar GitHub Token
- [ ] Ejecutar 5 ciclos
- [ ] Medir mejora: esperado +3-5% accuracy

### **Mes 2: Validación**
- [ ] 20+ ciclos con Freemium
- [ ] Documentar accuracy por categoría
- [ ] Validar hipótesis H1-H6
- [ ] Decidir: ¿Vale la pena escalar?

### **Mes 3: Scaling (Si ROI positivo)**
- [ ] Si accuracy > 65%: Añadir SerpAPI ($50)
- [ ] Si accuracy > 68%: Añadir Twitter ($100)
- [ ] Si ROI > 5%: Considerar Glassnode ($99)
- [ ] Automatizar ejecución

---

## 🔍 TROUBLESHOOTING

### **"API key no configurada" pero la añadí**
```
Solución:
1. Vercel → Settings → Environment Variables
2. Verificar que el nombre sea EXACTO (case-sensitive)
3. Redeploy: git push (force re-read de env vars)
4. Esperar 2-3 minutos
```

### **"Rate limit exceeded"**
```
Solución:
1. Verificar límites de la API
2. Si es CoinGecko: Espaciar calls más (50/min max)
3. Si es Twitter: Reducir cantidad de tweets analizados
4. Considerar upgrade si límite demasiado bajo
```

### **"No data available" para un factor**
```
Causas posibles:
1. API key incorrecta o expirada
2. API down temporalmente
3. Asset específico no soportado (ej: BTC para Glassnode)

Solución:
- Sistema funciona con factores disponibles
- No impide el cálculo de BoostPower
```

---

## 📞 SOPORTE

### **Documentación Oficial:**
- Este README
- .env.example (con comentarios)
- Cada API tiene su propia documentación oficial

### **Community:**
- GitHub Issues: Para bugs
- Reddit: r/algotrading para estrategias
- Discord: Varios servidores de crypto trading

---

**Última actualización:** Febrero 2026  
**Versión:** 3.2.0 FINAL  
**Mantenimiento:** Verificar precios de APIs trimestralmente

---

✅ **Sistema completo y documentado para cualquier nivel de usuario!**
