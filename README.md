# 🚀 Crypto Detector - Versión Plan Hobby (SIN Cron Job)

## ✨ Características

- ✅ Ciclos de 12h reales
- ✅ Base de datos Vercel KV
- ✅ Entrenamiento de algoritmo con IA
- ✅ **SIN cron job** (compatible con Vercel Hobby Plan)
- ✅ Auto-completado al abrir la app
- ✅ Email automático cuando usuario vuelve
- ✅ 100% GRATIS en Vercel Hobby

## 🔄 ¿Cómo Funciona Sin Cron?

### Sistema Inteligente de Auto-Completado:

```
1. Usuario inicia ciclo → Guarda en Vercel KV
2. Usuario puede cerrar la app
3. [Después de 12 horas]
4. Usuario vuelve a abrir la app
5. Sistema detecta ciclo pendiente automáticamente
6. Completa el ciclo
7. Envía email (si configurado)
8. Muestra resultados
```

**Ventajas:**
- ✅ No necesita cron job
- ✅ Compatible con Vercel Hobby (gratis)
- ✅ Funciona perfectamente
- ✅ Email automático cuando usuario vuelve

**Única diferencia vs versión con cron:**
- Con cron: Email llega EXACTAMENTE a las 12h
- Sin cron: Email llega cuando usuario abre la app después de 12h

---

## 📦 Instalación Rápida

```bash
# 1. Reemplazar proyecto
cp -r crypto-detector-HOBBY-PLAN/* tu-proyecto/
cd tu-proyecto

# 2. Instalar
npm install

# 3. Configurar Vercel KV (ver instrucciones abajo)

# 4. Deploy
git add .
git commit -m "Deploy Hobby Plan v3"
git push
```

---

## 🔧 Configuración Vercel KV

### Paso 1: Crear KV
1. Vercel Dashboard → **Storage**
2. **Create Database** → Seleccionar **KV**
3. Nombre: `crypto-detector-kv`
4. Region: La más cercana
5. **Create**

### Paso 2: Conectar
1. **Connect Project** → Seleccionar tu proyecto
2. **Connect**
3. ✅ Variables se añaden automáticamente

**NO necesitas:**
- ❌ CRON_SECRET (no hay cron)
- ❌ Configurar nada más

---

## 📊 Variables de Entorno

### Auto-generadas (NO tocar):
```bash
KV_URL=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...
```

### Opcionales:
```bash
# Mejoran precisión
SERPAPI_KEY=tu_key
CRYPTOCOMPARE_KEY=tu_key

# Email automático
SENDGRID_API_KEY=SG.xxx
EMAIL_FROM=noreply@tuapp.com
REPORT_RECIPIENT_EMAIL=tu@email.com
```

---

## ✅ Verificación Post-Deploy

```bash
# Test backend
curl https://tu-app.vercel.app/api/health

# Test ciclos
curl https://tu-app.vercel.app/api/cycles/stats

# Debe responder:
{
  "success": true,
  "stats": {
    "activeCycles": 0,
    "completedCycles": 0,
    ...
  }
}
```

---

## 🧪 Probar Ciclo

### Desde la App:
1. Abre `https://tu-app.vercel.app`
2. Click **"Actualizar"**
3. Click **"Ejecutar Ciclo 12h"**
4. Confirmar
5. Ver countdown
6. **Cerrar la app** (puedes irte tranquilo)
7. Volver después de 12h
8. **Sistema completa automáticamente** ✅
9. Ver resultados

### Desde API (Testing):
```bash
# Iniciar
curl -X POST https://tu-app.vercel.app/api/cycles/start \
  -H "Content-Type: application/json" \
  -d '{
    "snapshot": [{
      "id": "bitcoin",
      "symbol": "BTC",
      "price": 50000,
      "predictedChange": 5,
      "classification": "invertible"
    }]
  }'

# Ver activos (auto-completa pendientes)
curl https://tu-app.vercel.app/api/cycles/active

# Ver histórico (auto-completa pendientes)
curl https://tu-app.vercel.app/api/cycles/history
```

---

## 🎯 Flujo Completo de Uso

### Día 1 - 14:00
```
Usuario: Click "Ejecutar Ciclo 12h"
Sistema: ✅ Ciclo guardado en KV
Sistema: ID: cycle_123
Sistema: Finaliza: 16/02/2026 02:00
Usuario: Cierra la app
```

### Día 2 - 08:00 (14 horas después)
```
Usuario: Abre la app
Sistema: Detecta ciclo pendiente (pasaron >12h)
Sistema: Auto-completa el ciclo
Sistema: Consulta precios actuales
Sistema: Compara predicción vs realidad
Sistema: Envía email (si configurado)
Sistema: Muestra resultados en pantalla
Usuario: Ve tasa de acierto: 78%
```

---

## 💡 Ventajas de Esta Versión

✅ **100% Gratis** - Plan Hobby de Vercel
✅ **Sin limitaciones** - No necesita cron
✅ **Auto-completado** - Al abrir la app
✅ **Email automático** - Cuando usuario vuelve
✅ **Mismo frontend** - Debug completo
✅ **Mismas funciones** - Entrenamiento IA
✅ **Base de datos** - Vercel KV gratis

---

## 📁 Estructura

```
crypto-detector/
├── api/
│   ├── index.js                 (Backend principal)
│   ├── kv-helpers.js           (Base de datos)
│   ├── cycles-endpoints.js     (Auto-completado)
│   ├── algorithm-training.js   (Entrenamiento)
│   ├── report-generator.js     (Informes)
│   └── email-service.js        (Email)
├── public/
│   └── index.html              (Frontend completo)
├── package.json                (Con @vercel/kv)
├── vercel.json                 (SIN cron)
└── .env.example
```

---

## 🔄 Diferencias vs Versión con Cron

| Aspecto | Con Cron (Pro) | Sin Cron (Hobby) |
|---------|----------------|------------------|
| **Costo** | $20/mes | ✅ Gratis |
| **Completado** | Exacto a las 12h | Al abrir app >12h |
| **Email** | Exacto a las 12h | Al abrir app >12h |
| **Funcionamiento** | Automático 100% | Semi-automático |
| **Requisito** | CRON_SECRET | ❌ Ninguno extra |
| **Plan Vercel** | Pro | ✅ Hobby |

**Conclusión:** Para uso personal/testing → Esta versión es perfecta ✅

---

## 🎉 ¡Listo para Usar!

Este paquete funciona **100% gratis** en Vercel Hobby Plan.

**Solo necesitas:**
1. Configurar Vercel KV (5 min)
2. Hacer push (1 min)

¡Eso es todo! 🚀
