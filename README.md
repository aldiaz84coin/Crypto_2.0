# 🚀 Detector de Criptoactivos Invertibles

Sistema inteligente de detección de oportunidades de inversión en criptoactivos basado en análisis de tendencias, noticias y datos de mercado en tiempo real.

## 📋 Contenido

1. [Características](#características)
2. [Instalación](#instalación)
3. [Configuración](#configuración)
4. [Uso](#uso)
5. [Arquitectura](#arquitectura)
6. [APIs Utilizadas](#apis-utilizadas)

---

## ✨ Características

### 🧠 Algoritmo Inteligente
- **Clasificación automática** de criptoactivos:
  - 🟢 **Invertible**: Alta probabilidad de subida +30% en 12h
  - 🟡 **Apalancado**: Volatilidad alta con riesgo de corrección
  - ⚪ **Ruidoso**: Sin tendencia clara
  - 🔵 **Otros**: No cumple criterios de observación

### 📊 Métricas Avanzadas
- **Boost-Power**: Indicador propietario que combina:
  - Tendencias de búsqueda (Google Trends)
  - Cobertura de noticias
  - Sentimiento social
  - Volumen de trading
  - Volatilidad del precio

### 🔄 Aprendizaje Automático
- Sistema de retroalimentación que ajusta parámetros
- Validación de predicciones cada 12 horas
- Objetivo: >85% de tasa de acierto

### 📡 Datos en Tiempo Real
- Precios y capitalización (CoinGecko)
- Tendencias de búsqueda (Google Trends)
- Noticias y sentimiento (CryptoCompare)
- Índice Fear & Greed (Alternative.me)
- Datos de exchanges (Binance)

---

## 🛠️ Instalación

### Prerequisitos
- Node.js 16+ 
- npm o yarn
- Navegador moderno (Chrome, Firefox, Safari, Edge)

### Paso 1: Clonar o descargar los archivos

Necesitarás los siguientes archivos:
```
crypto-detector/
├── crypto-detector-real-api.jsx   # Frontend React
├── server.js                       # Backend Express
├── package.json                    # Dependencias
├── .env.example                    # Variables de entorno
└── README.md                       # Este archivo
```

### Paso 2: Instalar dependencias del backend

```bash
# Instalar dependencias
npm install

# O con yarn
yarn install
```

### Paso 3: Configurar variables de entorno

```bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar .env con tus API keys
nano .env  # o usa tu editor favorito
```

---

## ⚙️ Configuración

### 1. Obtener API Keys (Opcional pero recomendado)

#### SerpAPI (Google Trends)
1. Visita: https://serpapi.com
2. Regístrate gratis
3. Copia tu API key
4. Pégala en `.env` → `SERPAPI_KEY=tu_key_aqui`
5. **Gratis**: 100 búsquedas/mes

#### CryptoCompare (Noticias)
1. Visita: https://www.cryptocompare.com
2. Crea una cuenta
3. Ve a: API Keys → Create New API Key
4. Copia tu API key
5. Pégala en `.env` → `CRYPTOCOMPARE_KEY=tu_key_aqui`
6. **Gratis**: 100,000 llamadas/mes

### 2. Configurar el archivo .env

```env
PORT=3001
NODE_ENV=development

# API Keys
SERPAPI_KEY=tu_serpapi_key_aqui
CRYPTOCOMPARE_KEY=tu_cryptocompare_key_aqui

# Opcional: Configuración de caché y rate limiting
CACHE_DURATION=300000
RATE_LIMIT_MAX=60
```

**Nota**: Si no configuras las API keys, el sistema funcionará en modo simulado con datos aleatorios.

---

## 🚀 Uso

### Iniciar el Backend

```bash
# Modo producción
npm start

# Modo desarrollo (con auto-reload)
npm run dev
```

El servidor estará disponible en: `http://localhost:3001`

### Verificar que el Backend está funcionando

```bash
# Test de salud
curl http://localhost:3001/api/health

# Ver datos de mercado
curl http://localhost:3001/api/crypto/market
```

### Usar el Frontend

#### Opción 1: Integrado en un proyecto React

```jsx
// App.jsx
import CryptoDetectorApp from './crypto-detector-real-api';

function App() {
  return <CryptoDetectorApp />;
}

export default App;
```

#### Opción 2: Como página standalone

1. Crea un archivo HTML:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Crypto Detector</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" src="crypto-detector-real-api.jsx"></script>
  <script type="text/babel">
    ReactDOM.createRoot(document.getElementById('root')).render(<CryptoDetectorApp />);
  </script>
</body>
</html>
```

2. Abre el archivo HTML en tu navegador

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                      │
│  - Interfaz de usuario                                       │
│  - Visualización de datos                                    │
│  - Gestión de estado                                         │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP Requests
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND (Express/Node.js)                 │
│  - API Gateway                                               │
│  - Rate Limiting                                             │
│  - Cache en memoria                                          │
│  - Procesamiento de datos                                    │
└────┬─────────┬─────────┬──────────┬───────────┬────────────┘
     │         │         │          │           │
     ↓         ↓         ↓          ↓           ↓
┌─────────┐ ┌──────┐ ┌────────┐ ┌──────┐ ┌──────────┐
│CoinGecko│ │SerpAPI│ │Crypto  │ │Fear &│ │ Binance  │
│   API   │ │       │ │Compare │ │Greed │ │   API    │
└─────────┘ └───────┘ └────────┘ └──────┘ └──────────┘
```

### Flujo de Datos

1. **Frontend** solicita datos al backend
2. **Backend** verifica cache:
   - Si existe → retorna datos cacheados
   - Si no → consulta APIs externas
3. **APIs externas** retornan datos
4. **Backend** procesa y cachea resultados
5. **Frontend** recibe y visualiza datos

---

## 🔌 APIs Utilizadas

### 1. CoinGecko API
- **Propósito**: Precios, capitalización, volumen
- **Límite**: 50 req/minuto (gratis)
- **Documentación**: https://www.coingecko.com/api/documentation

### 2. SerpAPI (Google Trends)
- **Propósito**: Tendencias de búsqueda
- **Límite**: 100 búsquedas/mes (gratis)
- **Documentación**: https://serpapi.com/google-trends-api

### 3. CryptoCompare
- **Propósito**: Noticias y sentimiento
- **Límite**: 100,000 llamadas/mes (gratis)
- **Documentación**: https://min-api.cryptocompare.com/documentation

### 4. Alternative.me
- **Propósito**: Fear & Greed Index
- **Límite**: Sin límite
- **Documentación**: https://alternative.me/crypto/fear-and-greed-index/

### 5. Binance API
- **Propósito**: Datos de exchange en tiempo real
- **Límite**: 1200 req/minuto (público)
- **Documentación**: https://binance-docs.github.io/apidocs/spot/en/

---

## 📊 Endpoints del Backend

### GET `/api/crypto/market`
Obtiene datos de mercado de las top 100 criptomonedas

```bash
curl http://localhost:3001/api/crypto/market
```

### GET `/api/trends/:symbol`
Obtiene tendencias de búsqueda para un símbolo

```bash
curl http://localhost:3001/api/trends/BTC
```

### GET `/api/news/:symbol`
Obtiene noticias y sentimiento

```bash
curl http://localhost:3001/api/news/ETH
```

### GET `/api/exchange/:symbol`
Obtiene datos de exchange (Binance)

```bash
curl http://localhost:3001/api/exchange/BTC
```

### GET `/api/fear-greed`
Obtiene el índice Fear & Greed del mercado

```bash
curl http://localhost:3001/api/fear-greed
```

### POST `/api/analyze`
Análisis completo de múltiples símbolos

```bash
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["BTC", "ETH", "SOL"]}'
```

### GET `/api/health`
Estado del servidor

```bash
curl http://localhost:3001/api/health
```

### GET `/api/cache/clear`
Limpiar caché

```bash
curl http://localhost:3001/api/cache/clear
```

---

## 🎯 Uso del Sistema

### 1. Monitor en Tiempo Real

Visualiza los **Top 20 activos observables** clasificados por Boost-Power:

- 🟢 **Verde**: Invertibles - Alta probabilidad de ganancia
- 🟡 **Amarillo**: Apalancados - Alta volatilidad
- ⚪ **Gris**: Ruidosos - Sin tendencia clara

### 2. Ejecutar Ciclo de 12h

1. Click en **"Ejecutar Ciclo 12h"**
2. El sistema toma un snapshot de los activos
3. Espera 12 horas (simuladas en 5 segundos)
4. Verifica las predicciones contra datos reales
5. Ajusta automáticamente el algoritmo

### 3. Ajustar Parámetros

En la pestaña **"Parámetros del Algoritmo"**:

- **Umbral de Búsquedas**: % mínimo de incremento en Google Trends
- **Umbral de Noticias**: Número mínimo de noticias
- **Boost-Power**: Valor mínimo para clasificar como invertible
- **Ratio de Capitalización**: Umbral de apalancamiento

### 4. Revisar Historial

En **"Historial y Validación"**:

- Ver todas las predicciones pasadas
- Comparar predicción vs resultado real
- Analizar tasa de acierto por clasificación

---

## 📈 Interpretación de Métricas

### Boost-Power
Valor de 0 a 1 que indica el "empuje" del activo:

- **0.0 - 0.25**: Bajo - Sin momentum
- **0.25 - 0.40**: Medio - Observar
- **0.40 - 0.60**: Alto - Posible oportunidad
- **0.60 - 1.00**: Muy Alto - Fuerte momentum

### Clasificaciones

#### 🟢 Invertible
- Boost-Power > 0.40
- Bajo apalancamiento
- Tendencia positiva
- **Acción**: Considerar inversión

#### 🟡 Apalancado
- Alto ratio capitalización/volumen
- Precio muy bajo vs histórico
- Alta volatilidad
- **Acción**: Esperar confirmación

#### ⚪ Ruidoso
- Boost-Power < 0.25
- No cumple criterios
- **Acción**: Ignorar

---

## 🔧 Troubleshooting

### El backend no inicia
```bash
# Verificar que Node.js está instalado
node --version

# Reinstalar dependencias
rm -rf node_modules
npm install
```

### Errores de API
```bash
# Verificar que las API keys están configuradas
cat .env

# Ver logs del servidor
npm run dev
```

### CORS Errors en el frontend
Asegúrate de que el frontend esté apuntando al backend correcto:

```javascript
// En crypto-detector-real-api.jsx, busca:
const response = await fetch('http://localhost:3001/api/...');
```

### Rate Limiting
Si recibes errores 429 (Too Many Requests):

```bash
# Limpiar rate limits (reinicia el servidor)
npm start

# O aumentar el límite en .env
RATE_LIMIT_MAX=120
```

---

## 🚀 Mejoras Futuras

### Corto Plazo
- [ ] Implementar Redis para caché distribuido
- [ ] Agregar autenticación de usuarios
- [ ] Notificaciones push/email
- [ ] Exportar reportes en PDF

### Medio Plazo
- [ ] Machine Learning para predicciones
- [ ] Integración con exchanges (trading automático)
- [ ] App móvil (React Native)
- [ ] Dashboard de administración

### Largo Plazo
- [ ] Análisis de blockchain (on-chain metrics)
- [ ] Social trading (copiar estrategias)
- [ ] Bot de Telegram/Discord
- [ ] Soporte para DeFi y NFTs

---

## 📝 Licencia

MIT License - Úsalo libremente en tus proyectos

---

## 🙋 Soporte

Si tienes problemas o preguntas:

1. Revisa la sección de Troubleshooting
2. Verifica los logs del backend
3. Consulta la documentación de las APIs
4. Abre un issue en el repositorio

---

## 🎉 ¡Empieza a detectar oportunidades!

```bash
npm install
npm start
# Abre http://localhost:3001/api/health en tu navegador
# Luego abre tu frontend React
```

**¡Buena suerte en tus inversiones! 📈💰**
