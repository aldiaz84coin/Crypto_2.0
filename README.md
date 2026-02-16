# 🚀 Crypto Detector - VERSIÓN MÍNIMA

## ✅ ULTRA SIMPLE - DEBE FUNCIONAR SÍ O SÍ

Solo lo básico:
- ✅ Backend con 2 endpoints
- ✅ Frontend que funciona
- ✅ Sin complejidades

---

## 📦 ARCHIVOS (5 en total)

```
crypto-detector-MINIMAL/
├── package.json       ← Solo 3 dependencias
├── vercel.json        ← Config mínima
├── api/
│   └── index.js       ← Backend (50 líneas)
└── public/
    └── index.html     ← Frontend (100 líneas)
```

---

## 🚀 DEPLOY (2 PASOS)

### Paso 1: Copiar y Deploy
```bash
# Extraer
tar -xzf crypto-detector-MINIMAL.tar.gz

# Ir a tu proyecto
cd tu-proyecto

# BORRAR TODO
rm -rf *

# Copiar
cp -r /ruta/crypto-detector-MINIMAL/* .

# Instalar
npm install

# Deploy
git init
git add .
git commit -m "Versión mínima"
git push vercel main
```

### Paso 2: Verificar

Abrir: `https://tu-app.vercel.app`

**Debes ver:**
- Título "Crypto Detector"
- Botón "Test Backend" (verde si funciona)
- Botón "Cargar Criptos"
- Click "Cargar Criptos" → Ver 20 criptomonedas

---

## ✅ ENDPOINTS

```bash
# Health
curl https://tu-app.vercel.app/api/health

# Criptos
curl https://tu-app.vercel.app/api/crypto
```

---

## 💡 QUÉ HACE

1. **Backend:**
   - GET /api/health → Test
   - GET /api/crypto → Obtiene 100 criptos de CoinGecko

2. **Frontend:**
   - Botón para probar backend
   - Botón para cargar criptos
   - Muestra las primeras 20

---

## 🆘 SI NO FUNCIONA

1. **Ver logs:**
   ```
   Vercel → Deployments → Runtime Logs
   ```

2. **Verificar archivos:**
   ```bash
   ls -la
   # Debe haber: api/, public/, package.json, vercel.json
   ```

3. **Reinstalar:**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   git add .
   git commit -m "reinstall"
   git push
   ```

---

## 🎯 ESTO DEBE FUNCIONAR

**Si esta versión no funciona, el problema es:**
- ❌ Git no configurado
- ❌ Vercel no conectado
- ❌ Archivos no copiados

**NO es problema del código.**

---

Una vez que esto funcione, puedes añadir más funcionalidades gradualmente.

¡Suerte! 🚀
