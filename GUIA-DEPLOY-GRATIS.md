# 🚀 GUÍA COMPLETA: DESPLEGAR CRYPTO DETECTOR GRATIS ONLINE

## 📋 Tabla de Contenidos

1. [Opción 1: Vercel (Recomendada) - Más Fácil](#opción-1-vercel-recomendada)
2. [Opción 2: Railway - Backend + Frontend](#opción-2-railway)
3. [Opción 3: Render - Gratuito con limitaciones](#opción-3-render)
4. [Opción 4: Netlify + Heroku](#opción-4-netlify--heroku)
5. [Configuración Final](#configuración-final)

---

# OPCIÓN 1: VERCEL (Recomendada) ⭐

**Ideal para**: Deploy más rápido, frontend + backend en un solo lugar
**Gratis**: Sí, 100% gratis con límites generosos
**Tiempo**: 10-15 minutos

## 🎯 PASO 1: Preparar el Proyecto

### 1.1 Crear estructura para Vercel

Primero, necesitamos reorganizar un poco el proyecto:

```bash
# Extraer el proyecto
tar -xzf crypto-detector-project.tar.gz
cd crypto-detector-project

# Crear carpetas necesarias
mkdir -p api public
```

### 1.2 Mover archivos a sus lugares

```bash
# Backend va a /api
mv server.js api/index.js

# Frontend va a /public
mv crypto-detector-real-api.jsx public/app.jsx

# Crear archivo HTML principal
cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crypto Detector - Detecta Oportunidades de Inversión</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💰</text></svg>">
</head>
<body class="m-0 p-0">
    <div id="root"></div>
    <script type="text/babel" src="app.jsx"></script>
    <script type="text/babel">
        ReactDOM.createRoot(document.getElementById('root')).render(<CryptoDetectorApp />);
    </script>
</body>
</html>
EOF
```

### 1.3 Crear archivo vercel.json

```bash
cat > vercel.json << 'EOF'
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    },
    {
      "src": "public/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ],
  "env": {
    "NODE_ENV": "production"
  }
}
EOF
```

### 1.4 Ajustar el backend para Vercel

Edita `api/index.js` y cambia las primeras líneas:

```javascript
// api/index.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// IMPORTANTE: Vercel maneja el puerto automáticamente
// No uses app.listen() al final

// ... resto del código igual ...

// AL FINAL DEL ARCHIVO, REEMPLAZA app.listen() con:
module.exports = app;
```

### 1.5 Actualizar URLs en el frontend

Edita `public/app.jsx` y busca todas las URLs del backend:

```javascript
// Busca líneas como:
// const response = await fetch('http://localhost:3001/api/...');

// Reemplázalas por URLs relativas:
const response = await fetch('/api/crypto/market');
const response = await fetch('/api/trends/${symbol}');
// etc...
```

## 🎯 PASO 2: Crear Cuenta en Vercel

### 2.1 Registro
1. Ve a https://vercel.com
2. Click en **"Sign Up"**
3. Elige **"Continue with GitHub"** (recomendado)
4. Autoriza Vercel en tu GitHub

### 2.2 Instalar Vercel CLI (Opcional)
```bash
npm install -g vercel
```

## 🎯 PASO 3: Subir a GitHub

### 3.1 Crear repositorio
```bash
# Inicializar git
git init

# Crear .gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.DS_Store
*.log
EOF

# Hacer commit
git add .
git commit -m "Initial commit - Crypto Detector"
```

### 3.2 Crear repo en GitHub
1. Ve a https://github.com/new
2. Nombre: `crypto-detector`
3. Público o Privado (tu elección)
4. NO añadas README ni .gitignore
5. Click en **"Create repository"**

### 3.3 Push al repositorio
```bash
# Reemplaza 'tu-usuario' con tu usuario de GitHub
git remote add origin https://github.com/tu-usuario/crypto-detector.git
git branch -M main
git push -u origin main
```

## 🎯 PASO 4: Desplegar en Vercel

### Opción A: Desde el Dashboard de Vercel

1. Ve a https://vercel.com/dashboard
2. Click en **"Add New..."** → **"Project"**
3. Busca tu repo `crypto-detector`
4. Click en **"Import"**
5. Configuración:
   - **Framework Preset**: Other
   - **Root Directory**: ./
   - **Build Command**: (dejar vacío)
   - **Output Directory**: public
6. **Environment Variables** (click en "Add"):
   ```
   SERPAPI_KEY=tu_key_aqui (opcional)
   CRYPTOCOMPARE_KEY=tu_key_aqui (opcional)
   ```
7. Click en **"Deploy"**

### Opción B: Desde la terminal

```bash
# Si instalaste Vercel CLI
vercel login
vercel

# Sigue las instrucciones:
# - Set up and deploy? Y
# - Which scope? (tu usuario)
# - Link to existing project? N
# - What's your project's name? crypto-detector
# - In which directory? ./
# - Override settings? N
```

## 🎯 PASO 5: Configurar Variables de Entorno

1. En el dashboard de Vercel, ve a tu proyecto
2. Click en **"Settings"**
3. Click en **"Environment Variables"**
4. Añadir:
   ```
   SERPAPI_KEY = tu_clave_de_serpapi
   CRYPTOCOMPARE_KEY = tu_clave_de_cryptocompare
   ```
5. Click en **"Save"**
6. Ve a **"Deployments"** → Click en los 3 puntos → **"Redeploy"**

## ✅ LISTO!

Tu app estará disponible en: `https://crypto-detector-xxx.vercel.app`

---

# OPCIÓN 2: RAILWAY 🚂

**Ideal para**: Backend robusto con base de datos
**Gratis**: $5 de crédito mensual (suficiente para hobby)
**Tiempo**: 15 minutos

## 🎯 PASO 1: Preparar Proyecto para Railway

### 1.1 Crear Dockerfile
```bash
cat > Dockerfile << 'EOF'
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
EOF
```

### 1.2 Crear railway.json
```bash
cat > railway.json << 'EOF'
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node server.js",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
EOF
```

### 1.3 Actualizar server.js
```javascript
// Cambiar el puerto para Railway
const PORT = process.env.PORT || 3001;

// Al final
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
```

## 🎯 PASO 2: Desplegar en Railway

1. Ve a https://railway.app
2. **Sign up with GitHub**
3. Click en **"New Project"**
4. **"Deploy from GitHub repo"**
5. Selecciona tu repositorio `crypto-detector`
6. Railway detectará el Dockerfile automáticamente
7. Click en **"Deploy"**

## 🎯 PASO 3: Configurar Variables

1. En tu proyecto Railway, click en **"Variables"**
2. Añadir:
   ```
   SERPAPI_KEY=tu_key
   CRYPTOCOMPARE_KEY=tu_key
   NODE_ENV=production
   ```
3. El deploy se reiniciará automáticamente

## 🎯 PASO 4: Obtener URL Pública

1. Click en **"Settings"**
2. En **"Domains"**, click en **"Generate Domain"**
3. Obtendrás algo como: `crypto-detector.up.railway.app`

## 🎯 PASO 5: Desplegar Frontend (Vercel o Netlify)

Usa Vercel (Opción 1) solo para el frontend, apuntando al backend de Railway:

En `public/app.jsx`:
```javascript
const API_URL = 'https://crypto-detector.up.railway.app';
const response = await fetch(`${API_URL}/api/crypto/market`);
```

---

# OPCIÓN 3: RENDER 🎨

**Ideal para**: Simplicidad total
**Gratis**: Sí, pero con spin-down después de 15 min inactivo
**Tiempo**: 10 minutos

## 🎯 PASO 1: Preparar para Render

### 1.1 Crear render.yaml
```bash
cat > render.yaml << 'EOF'
services:
  - type: web
    name: crypto-detector-backend
    env: node
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: SERPAPI_KEY
        sync: false
      - key: CRYPTOCOMPARE_KEY
        sync: false
EOF
```

## 🎯 PASO 2: Desplegar

1. Ve a https://render.com
2. **Sign up with GitHub**
3. Click en **"New +"** → **"Web Service"**
4. Conecta tu repo de GitHub
5. Configuración:
   - **Name**: crypto-detector
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free
6. **Environment Variables**:
   ```
   SERPAPI_KEY=tu_key
   CRYPTOCOMPARE_KEY=tu_key
   ```
7. Click en **"Create Web Service"**

## 🎯 PASO 3: URL Pública

Obtendrás: `https://crypto-detector.onrender.com`

⚠️ **NOTA**: Render gratuito entra en "sleep" después de 15 minutos sin uso. La primera petición tomará ~30 segundos en despertar.

---

# OPCIÓN 4: NETLIFY (Frontend) + RAILWAY (Backend) 🔗

## 🎯 Backend en Railway (Ver Opción 2)

## 🎯 Frontend en Netlify

### PASO 1: Preparar para Netlify
```bash
cat > netlify.toml << 'EOF'
[build]
  publish = "public"

[[redirects]]
  from = "/api/*"
  to = "https://tu-backend.up.railway.app/api/:splat"
  status = 200
  force = true
EOF
```

### PASO 2: Desplegar
1. Ve a https://netlify.com
2. **Sign up with GitHub**
3. **"Add new site"** → **"Import an existing project"**
4. Selecciona tu repo
5. Configuración:
   - **Build command**: (vacío)
   - **Publish directory**: public
6. Click en **"Deploy"**

### PASO 3: Actualizar netlify.toml
Reemplaza la URL del backend con la real de Railway:
```toml
to = "https://crypto-detector.up.railway.app/api/:splat"
```

Commit y push:
```bash
git add netlify.toml
git commit -m "Update backend URL"
git push
```

Netlify redesplegará automáticamente.

---

# CONFIGURACIÓN FINAL 🎯

## 1️⃣ Actualizar CORS en el Backend

En `server.js` o `api/index.js`:

```javascript
const cors = require('cors');

// Permitir tu dominio de producción
app.use(cors({
  origin: [
    'https://crypto-detector-xxx.vercel.app',
    'https://tu-sitio.netlify.app',
    'http://localhost:3000', // Para desarrollo
  ],
  credentials: true
}));
```

## 2️⃣ Verificar Variables de Entorno

Asegúrate de tener configuradas:
- `SERPAPI_KEY` (opcional)
- `CRYPTOCOMPARE_KEY` (opcional)
- `PORT` (automático en la mayoría de plataformas)

## 3️⃣ Configurar Dominio Personalizado (Opcional)

### En Vercel:
1. Ve a tu proyecto → **"Settings"** → **"Domains"**
2. Añade tu dominio: `crypto-detector.tudominio.com`
3. Configura el DNS según las instrucciones

### En Netlify:
1. **"Domain settings"** → **"Add custom domain"**
2. Sigue las instrucciones de DNS

---

# RESUMEN COMPARATIVO 📊

| Plataforma | Velocidad Deploy | Gratis | Limitaciones | Mejor Para |
|------------|------------------|--------|--------------|------------|
| **Vercel** | ⚡⚡⚡ | ✅ | 100GB bandwidth/mes | Full-stack simple |
| **Railway** | ⚡⚡ | ✅ ($5 crédito) | $5/mes crédito | Backend robusto |
| **Render** | ⚡⚡ | ✅ | Sleep después 15min | Proyectos básicos |
| **Netlify** | ⚡⚡⚡ | ✅ | 100GB bandwidth/mes | Solo frontend |

---

# MI RECOMENDACIÓN 🌟

## Para empezar rápido:
**VERCEL** - Todo en uno, más fácil, deploy en 5 minutos

## Para producción seria:
**RAILWAY (Backend) + VERCEL (Frontend)** - Mejor rendimiento y control

## Paso a paso para Vercel (lo más fácil):

```bash
# 1. Preparar proyecto
mkdir -p api public
mv server.js api/index.js
mv crypto-detector-real-api.jsx public/app.jsx

# 2. Crear vercel.json (ver arriba)
# 3. Crear public/index.html (ver arriba)
# 4. Actualizar URLs en app.jsx a rutas relativas
# 5. Subir a GitHub
# 6. Conectar con Vercel
# 7. ¡Deploy automático!
```

**URL final**: `https://crypto-detector-xxx.vercel.app` ✨

---

# TROUBLESHOOTING 🔧

## Error: "Cannot GET /"
→ Verifica que `public/index.html` existe

## Error: "API not responding"
→ Revisa que las URLs en el frontend sean correctas

## Error: "CORS blocked"
→ Configura CORS en el backend con tu dominio

## Error: "Module not found"
→ Asegúrate de hacer `npm install` en el deploy

## Backend lento en Render
→ Normal en plan gratuito (15 min sleep). Usa Railway o Vercel.

---

# MONITOREO 📊

## Vercel Analytics
1. Ve a tu proyecto en Vercel
2. Click en **"Analytics"**
3. Ve métricas de uso en tiempo real (gratis)

## Railway Metrics
1. En tu proyecto Railway
2. Click en **"Metrics"**
3. Ve CPU, RAM, Network (gratis)

---

# PRÓXIMOS PASOS 🚀

1. ✅ Desplegar online
2. 📱 Compartir URL con usuarios
3. 🔑 Añadir API keys cuando sea necesario
4. 📊 Monitorear uso y performance
5. 🎯 Mejorar con feedback de usuarios

---

**¡Tu Crypto Detector está listo para el mundo! 🌍💰**
