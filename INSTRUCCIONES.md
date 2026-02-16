# 📖 DESPLIEGUE SIMPLIFICADO - PLAN HOBBY

## 🎯 Despliegue en 3 Pasos (8 minutos)

---

### PASO 1: Reemplazar Proyecto (2 min)

```bash
# Extraer
tar -xzf crypto-detector-HOBBY-PLAN.tar.gz

# Reemplazar TODO tu proyecto
cp -r crypto-detector-HOBBY-PLAN/* tu-proyecto-actual/

# Entrar
cd tu-proyecto-actual

# Instalar
npm install
```

---

### PASO 2: Configurar Vercel KV (5 min)

#### 2.1 Ir a Vercel
https://vercel.com/dashboard

#### 2.2 Storage
Click **"Storage"** (menú lateral)

#### 2.3 Crear KV
1. **Create Database**
2. Seleccionar **KV**
3. Nombre: `crypto-detector-kv`
4. Region: Más cercana
5. **Create**

#### 2.4 Conectar
1. **Connect Project**
2. Seleccionar: `crypto-detector`
3. **Connect**

✅ **Listo** - Variables añadidas automáticamente

---

### PASO 3: Deploy (1 min)

```bash
git add .
git commit -m "Deploy Hobby Plan - Sin cron"
git push
```

Esperar 2-3 minutos → **Ready** ✅

---

## ✅ Verificar

```bash
# Test 1
curl https://tu-app.vercel.app/api/health

# Test 2
curl https://tu-app.vercel.app/api/cycles/stats
```

Ambos deben responder JSON ✅

---

## 🧪 Probar Ciclo

1. Abre: `https://tu-app.vercel.app`
2. Click: **"Actualizar"**
3. Click: **"Ejecutar Ciclo 12h"**
4. Confirmar
5. **Cerrar la app** (puedes irte)
6. Volver después de 12h
7. **Sistema auto-completa** ✅
8. Ver resultados

---

## ❓ Preguntas Frecuentes

### ¿Necesito configurar CRON_SECRET?
❌ NO - Esta versión no usa cron

### ¿Cuándo se completa el ciclo?
Cuando abres la app después de 12h

### ¿Recibo email automáticamente?
✅ SÍ - Cuando abres la app después de 12h (si configuraste email)

### ¿Funciona gratis?
✅ SÍ - 100% gratis en Vercel Hobby Plan

### ¿Qué pasa si no abro la app después de 12h?
El ciclo queda pendiente hasta que abras la app. Cuando la abras, se completa automáticamente.

---

## 🔧 Variables Necesarias

### Obligatorias (Auto-generadas por KV):
- ✅ KV_URL
- ✅ KV_REST_API_URL  
- ✅ KV_REST_API_TOKEN
- ✅ KV_REST_API_READ_ONLY_TOKEN

### Opcionales (Mejoran precisión):
- SERPAPI_KEY
- CRYPTOCOMPARE_KEY
- SENDGRID_API_KEY
- REPORT_RECIPIENT_EMAIL

---

## 🆘 Solución de Problemas

### Error: "KV is not defined"
1. Ve a Storage → tu KV
2. Click "Connect Project"
3. Reconectar
4. Redeploy

### Ciclo no se completa
1. Asegúrate de haber pasado 12h
2. Abre la app (o llama a /api/cycles/active)
3. El sistema auto-completa en ese momento

### Email no llega
1. Configura SENDGRID_API_KEY y REPORT_RECIPIENT_EMAIL
2. El email se envía cuando se completa el ciclo
3. Es decir, cuando abres la app después de 12h

---

## 🎉 ¡Eso es todo!

Tu app funciona 100% gratis en Vercel Hobby Plan.

**No necesitas:**
- ❌ Cron job
- ❌ Plan Pro
- ❌ CRON_SECRET
- ❌ Configuraciones complejas

**Solo necesitas:**
- ✅ Vercel KV (gratis)
- ✅ Hacer push

¡Listo! 🚀
