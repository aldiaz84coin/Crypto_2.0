# 🚀 DEPLOY EN 5 MINUTOS - GUÍA RÁPIDA

## ⚡ OPCIÓN MÁS RÁPIDA: VERCEL (Recomendada)

### 📋 ANTES DE EMPEZAR

Necesitas:
- ✅ Cuenta de GitHub (gratis) → https://github.com/signup
- ✅ Cuenta de Vercel (gratis) → https://vercel.com/signup

---

## 🎯 MÉTODO 1: AUTOMÁTICO (5 minutos)

### Paso 1: Extraer y configurar

```bash
# Extraer el proyecto
tar -xzf crypto-detector-project.tar.gz
cd crypto-detector-project

# Ejecutar script automático
chmod +x setup-vercel.sh
./setup-vercel.sh
```

El script hará TODA la configuración automáticamente ✨

### Paso 2: Subir a GitHub

```bash
# Inicializar Git
git init
git add .
git commit -m "Initial commit"

# Crear repo en GitHub y luego:
git remote add origin https://github.com/TU-USUARIO/crypto-detector.git
git push -u origin main
```

### Paso 3: Desplegar en Vercel

1. Ve a https://vercel.com/dashboard
2. Click **"Add New..."** → **"Project"**
3. Selecciona tu repo **crypto-detector**
4. Click **"Deploy"**

### ✅ ¡LISTO! Tu app estará en: `https://crypto-detector-xxx.vercel.app`

---

## 🎯 MÉTODO 2: MANUAL (10 minutos)

### Paso 1: Preparar archivos

```bash
# Extraer
tar -xzf crypto-detector-project.tar.gz
cd crypto-detector-project

# Crear carpetas
mkdir -p api public

# Mover archivos
cp server.js api/index.js
cp crypto-detector-real-api.jsx public/app.jsx
cp index.html public/
```

### Paso 2: Actualizar URLs en el frontend

Edita `public/app.jsx` y busca todas las líneas con `http://localhost:3001`

**Reemplaza:**
```javascript
// ANTES
const response = await fetch('http://localhost:3001/api/crypto/market');

// DESPUÉS
const response = await fetch('/api/crypto/market');
```

Haz esto para TODAS las URLs del backend.

### Paso 3: Crear vercel.json

Crea un archivo `vercel.json` en la raíz:

```json
{
  "version": 2,
  "builds": [
    {"src": "api/index.js", "use": "@vercel/node"},
    {"src": "public/**", "use": "@vercel/static"}
  ],
  "routes": [
    {"src": "/api/(.*)", "dest": "/api/index.js"},
    {"src": "/(.*)", "dest": "/public/$1"}
  ]
}
```

### Paso 4: Git y GitHub

```bash
git init
git add .
git commit -m "Setup for Vercel"

# Crear repo en GitHub, luego:
git remote add origin https://github.com/TU-USUARIO/crypto-detector.git
git push -u origin main
```

### Paso 5: Deploy en Vercel

1. https://vercel.com/dashboard
2. **"New Project"**
3. Importar tu repo
4. **"Deploy"**

---

## 🎯 MÉTODO 3: SOLO FRONTEND (2 minutos)

Si solo quieres probar el frontend rápidamente:

### Usar directamente desde archivo HTML

1. Extrae el proyecto
2. Abre `crypto-detector-real-api.jsx` en un editor
3. Cambia todas las URLs a usar la API pública de CoinGecko
4. Abre `index.html` en tu navegador

**Limitación**: Solo funcionará con datos de CoinGecko (sin tendencias ni noticias)

---

## 🔑 CONFIGURAR API KEYS (Opcional)

### En Vercel (después del deploy):

1. Ve a tu proyecto en Vercel
2. Click **"Settings"** → **"Environment Variables"**
3. Añadir:

```
SERPAPI_KEY = tu_clave_aqui
CRYPTOCOMPARE_KEY = tu_clave_aqui
```

4. **"Save"**
5. En **"Deployments"**, redeploy el proyecto

### Obtener API Keys GRATIS:

**SerpAPI** (Google Trends):
1. https://serpapi.com/users/sign_up
2. Regístrate gratis
3. Copia tu API key
4. 100 búsquedas/mes gratis

**CryptoCompare** (Noticias):
1. https://www.cryptocompare.com/cryptopian/api-keys
2. Crea cuenta
3. "Create New API Key"
4. 100,000 llamadas/mes gratis

---

## 🐛 SOLUCIÓN DE PROBLEMAS

### ❌ "Cannot GET /"
→ Verifica que `public/index.html` existe

### ❌ "API not found"
→ Revisa que `api/index.js` existe y `vercel.json` está configurado

### ❌ "CORS error"
→ Las URLs en el frontend deben ser relativas (`/api/...`) no absolutas

### ❌ El build falla en Vercel
→ Asegúrate de que `package.json` tiene todas las dependencias

### ❌ Variables de entorno no funcionan
→ Después de añadirlas en Vercel, haz un redeploy

---

## 📊 ALTERNATIVAS A VERCEL

### Railway (Backend más robusto)

```bash
# 1. Subir a GitHub (igual que antes)

# 2. Ve a https://railway.app
# 3. "New Project" → "Deploy from GitHub"
# 4. Selecciona tu repo
# 5. Railway detectará Node.js automáticamente
```

**Obtendrás**: `https://crypto-detector.up.railway.app`

### Netlify (Solo Frontend)

```bash
# 1. Subir a GitHub

# 2. Ve a https://netlify.com
# 3. "Add new site" → "Import from GitHub"
# 4. Build settings:
#    - Build command: (vacío)
#    - Publish directory: public
```

---

## 🎉 CHECKLIST FINAL

Antes de compartir tu app, verifica:

- [ ] ✅ La app carga en la URL de Vercel
- [ ] ✅ Los datos de criptomonedas se muestran
- [ ] ✅ El botón "Actualizar" funciona
- [ ] ✅ Puedes ejecutar ciclos de 12h
- [ ] ✅ Las API keys están configuradas (si las tienes)
- [ ] ✅ No hay errores en la consola del navegador (F12)

---

## 💡 CONSEJOS PRO

### 1. Dominio Personalizado (Opcional)

En Vercel:
- Settings → Domains → Add Domain
- Configura tu DNS según las instrucciones
- `crypto-detector.tudominio.com` ✨

### 2. Monitoreo

Vercel incluye analytics gratuitos:
- Analytics → Ver visitantes, performance, etc.

### 3. Logs en Tiempo Real

En Vercel:
- Deployments → [tu deploy] → "Runtime Logs"
- Ve errores del backend en tiempo real

### 4. Webhook para Auto-Deploy

Cada vez que hagas `git push`:
- Vercel detecta el cambio
- Hace deploy automático
- Tu app se actualiza sola ✨

---

## 📱 COMPARTIR TU APP

Una vez online, comparte:

```
🚀 Mi Crypto Detector está online!

🔗 https://crypto-detector-xxx.vercel.app

✨ Características:
• Análisis en tiempo real de 100+ cryptos
• Clasificación automática (Invertible/Apalancado/Ruidoso)
• Algoritmo de aprendizaje automático
• Datos de CoinGecko, Binance y más

¡Pruébalo y dame feedback!
```

---

## 🚀 SIGUIENTES PASOS

Después del deploy:

1. **Testear todo** - Prueba todas las funciones
2. **Añadir API keys** - Para datos completos
3. **Compartir** - Envía el link a amigos
4. **Iterar** - Mejora basado en feedback
5. **Monetizar** (opcional) - Añade suscripciones premium

---

## 📞 ¿NECESITAS AYUDA?

### Recursos útiles:
- Documentación Vercel: https://vercel.com/docs
- Soporte Vercel: https://vercel.com/support
- Tutorial video: https://www.youtube.com/watch?v=... (buscar "deploy react vercel")

### Logs para debugging:
```bash
# En tu proyecto local
vercel logs

# O en el dashboard de Vercel
# Deployments → [tu deploy] → Logs
```

---

## ✅ RESUMEN SUPER RÁPIDO

```bash
# 1. Extraer y configurar
tar -xzf crypto-detector-project.tar.gz
cd crypto-detector-project
./setup-vercel.sh

# 2. Git
git init && git add . && git commit -m "Initial"

# 3. GitHub (crear repo primero)
git remote add origin https://github.com/USER/crypto-detector.git
git push -u origin main

# 4. Vercel
# → https://vercel.com/dashboard
# → "New Project" → Importar repo → Deploy

# 5. ✅ Listo!
```

**Tiempo total: 5 minutos** ⚡

---

**¡Tu Crypto Detector estará online y funcionando! 🎉💰**
