# 🚀 PROYECTO: DETECTOR DE CRIPTOACTIVOS INVERTIBLES

## 📁 Estructura del Proyecto

```
crypto-detector-project/
│
├── 📱 FRONTEND
│   └── crypto-detector-real-api.jsx    # Aplicación React completa
│
├── 🔧 BACKEND  
│   ├── server.js                       # Servidor Express con API endpoints
│   ├── package.json                    # Dependencias Node.js
│   └── .env.example                    # Plantilla de configuración
│
└── 📚 DOCUMENTACIÓN
    ├── README.md                       # Guía completa de instalación y uso
    └── guia-implementacion-apis.md     # Documentación técnica de APIs
```

---

## ⚡ INICIO RÁPIDO (3 minutos)

### 1️⃣ Extraer el proyecto
```bash
tar -xzf crypto-detector-project.tar.gz
cd crypto-detector-project
```

### 2️⃣ Instalar dependencias
```bash
npm install
```

### 3️⃣ Iniciar servidor
```bash
npm start
```

✅ **¡Listo!** El backend estará corriendo en `http://localhost:3001`

---

## 🎯 CARACTERÍSTICAS PRINCIPALES

### 🧠 Sistema Inteligente
- **Algoritmo de clasificación automática** de criptoactivos
- **Aprendizaje automático** que mejora con cada ciclo
- **Objetivo**: >85% de tasa de acierto en predicciones

### 📊 Clasificaciones
1. **🟢 INVERTIBLE** - Alta probabilidad de +30% en 12h
2. **🟡 APALANCADO** - Volatilidad alta con riesgo
3. **⚪ RUIDOSO** - Sin tendencia clara
4. **🔵 OTROS** - No observable

### 📡 Fuentes de Datos en Tiempo Real
- ✅ **CoinGecko** - Precios y capitalización (FUNCIONANDO)
- ✅ **Binance** - Datos de exchange (FUNCIONANDO)
- ✅ **Fear & Greed Index** - Sentimiento del mercado (FUNCIONANDO)
- ⚠️ **Google Trends** - Requiere API key (opcional)
- ⚠️ **CryptoCompare** - Requiere API key (opcional)

### 🔍 Indicador Propietario: Boost-Power
Combina múltiples factores:
- Tendencias de búsqueda
- Cobertura de noticias
- Sentimiento social
- Volumen de trading
- Volatilidad del precio

---

## 🔑 CONFIGURACIÓN OPCIONAL (APIs Gratuitas)

### Para activar Google Trends:
1. Regístrate en https://serpapi.com (100 búsquedas/mes gratis)
2. Copia tu API key
3. Edita `.env`: `SERPAPI_KEY=tu_key_aqui`

### Para activar Noticias:
1. Regístrate en https://www.cryptocompare.com (100k llamadas/mes gratis)
2. Ve a API Keys → Create New
3. Edita `.env`: `CRYPTOCOMPARE_KEY=tu_key_aqui`

**Sin API keys**: El sistema funciona con CoinGecko + datos simulados para desarrollo

---

## 🖥️ ENDPOINTS DEL BACKEND

```bash
# Datos de mercado (100 cryptos)
GET http://localhost:3001/api/crypto/market

# Tendencias de búsqueda
GET http://localhost:3001/api/trends/:symbol

# Noticias y sentimiento
GET http://localhost:3001/api/news/:symbol

# Datos de exchange
GET http://localhost:3001/api/exchange/:symbol

# Índice Fear & Greed
GET http://localhost:3001/api/fear-greed

# Análisis completo
POST http://localhost:3001/api/analyze
Body: {"symbols": ["BTC", "ETH", "SOL"]}

# Estado del servidor
GET http://localhost:3001/api/health
```

---

## 🎮 CÓMO USAR LA INTERFAZ

### 1. Monitor en Tiempo Real
- Ver Top 20 activos observables
- Clasificados por Boost-Power
- Datos actualizados automáticamente

### 2. Ejecutar Ciclo de 12h
1. Click en "Ejecutar Ciclo 12h"
2. El sistema toma snapshot de activos
3. Simula espera de 12 horas
4. Verifica predicciones vs realidad
5. Ajusta algoritmo automáticamente

### 3. Ajustar Parámetros
- Umbral de incremento de búsquedas
- Número mínimo de noticias
- Valor Boost-Power para invertible
- Ratio de apalancamiento

### 4. Revisar Historial
- Todas las predicciones pasadas
- Comparación predicción vs realidad
- Tasa de acierto global

---

## 📈 ARQUITECTURA TÉCNICA

```
┌──────────────┐
│ React (JSX)  │ ←→ Usuario
└──────┬───────┘
       │ HTTP
       ↓
┌──────────────┐
│ Express.js   │ ←→ Cache + Rate Limiting
└──────┬───────┘
       │
       ├→ CoinGecko API (precios)
       ├→ SerpAPI (tendencias)
       ├→ CryptoCompare (noticias)
       ├→ Alternative.me (sentimiento)
       └→ Binance API (exchange)
```

---

## 💡 CASOS DE USO

### Trader Activo
- Detectar oportunidades intradía
- Configurar alertas de Boost-Power alto
- Verificar tendencias antes de operar

### Inversor
- Identificar activos con momentum
- Evitar activos sobreapalancados
- Hacer DCA en momentos óptimos

### Investigador
- Analizar correlación tendencias-precio
- Estudiar efectividad de indicadores
- Mejorar algoritmo de predicción

---

## 🚀 MEJORAS FUTURAS

### Próximas Implementaciones
- [ ] Notificaciones push/email
- [ ] Trading automático
- [ ] Machine Learning avanzado
- [ ] App móvil
- [ ] Bot de Telegram

### En Consideración
- [ ] Análisis on-chain
- [ ] Social trading
- [ ] Soporte DeFi/NFTs
- [ ] Backtesting histórico

---

## 📊 COSTOS OPERACIONALES

### Gratis (Limitado)
- CoinGecko: 50 req/min
- SerpAPI: 100 búsquedas/mes
- CryptoCompare: 100k llamadas/mes
- **Total: $0/mes**

### Plan Starter
- SerpAPI Pro: $50/mes
- CryptoCompare: $30/mes
- Hosting: $10/mes
- **Total: ~$90/mes**

---

## 🔒 SEGURIDAD

- ✅ Rate limiting implementado
- ✅ Variables de entorno para API keys
- ✅ CORS configurado
- ✅ Manejo de errores robusto
- ✅ Cache para optimizar llamadas

---

## 📞 SOPORTE

### Problemas comunes:
1. **Puerto ocupado**: Cambia PORT en .env
2. **CORS errors**: Verifica URL del backend en JSX
3. **Rate limits**: Reinicia servidor o ajusta límites
4. **APIs no responden**: Verifica API keys en .env

### Logs útiles:
```bash
# Ver todo el output del servidor
npm run dev

# Verificar salud del backend
curl http://localhost:3001/api/health
```

---

## 📝 LICENCIA

MIT License - Uso libre en proyectos personales y comerciales

---

## 🎯 VERSIÓN

**v1.0.0** - Febrero 2026
- ✅ Integración CoinGecko completa
- ✅ Sistema de clasificación funcional
- ✅ Algoritmo de aprendizaje automático
- ✅ Backend con caché y rate limiting
- ✅ Interfaz React moderna

---

## 🙏 CRÉDITOS

Desarrollado con:
- React 18
- Express 4
- Tailwind CSS
- Lucide Icons
- CoinGecko API
- Y muchas horas de análisis de mercados crypto 🚀

---

**¿Listo para detectar oportunidades de inversión?**

```bash
npm install && npm start
```

**¡Buena suerte en tus trades! 📈💰**
