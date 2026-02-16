# 📖 INSTRUCCIONES DE DESPLIEGUE - Versión Avanzada

## 🚀 Despliegue Rápido (3 Pasos - 10 minutos)

---

### PASO 1: Reemplazar Proyecto (3 min)

```bash
# 1. Extraer el paquete
tar -xzf crypto-detector-ADVANCED.tar.gz

# 2. Backup opcional de tu proyecto actual
cp -r tu-proyecto tu-proyecto-backup

# 3. Reemplazar TODO
cp -r crypto-detector-ADVANCED/* tu-proyecto/

# 4. Entrar al proyecto
cd tu-proyecto

# 5. Instalar dependencias
npm install
```

---

### PASO 2: Configurar Vercel KV (5 min)

#### 2.1 Ir a Vercel
https://vercel.com/dashboard

#### 2.2 Crear KV
1. Click **"Storage"** (menú lateral)
2. Click **"Create Database"**
3. Seleccionar **"KV"**
4. Nombre: `crypto-detector-kv`
5. Region: La más cercana a ti
6. Click **"Create"**

#### 2.3 Conectar al Proyecto
1. Click **"Connect Project"**
2. Seleccionar tu proyecto: `crypto-detector`
3. Click **"Connect"**

✅ **Las variables KV se añaden automáticamente**

Verifica que aparezcan en Settings → Environment Variables:
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

---

### PASO 3: Deploy (2 min)

```bash
# 1. Añadir archivos
git add .

# 2. Commit
git commit -m "Deploy: Sistema Avanzado de Pesos v3.1

- 8 factores configurables
- 23 parámetros ajustables
- Endpoints de configuración
- Breakdown detallado de BoostPower
- Compatible con Hobby Plan
"

# 3. Push
git push origin main
```

**Esperar 2-3 minutos** → Deploy completo ✅

---

## ✅ Verificación

### Test 1: Backend Básico
```bash
curl https://tu-app.vercel.app/api/health
```
Debe responder JSON ✅

### Test 2: Configuración
```bash
curl https://tu-app.vercel.app/api/config
```
Debe devolver la configuración por defecto:
```json
{
  "success": true,
  "config": {
    "metaWeights": {
      "quantitative": 0.60,
      "qualitative": 0.40
    },
    "factorWeights": {...},
    "thresholds": {...}
  }
}
```

### Test 3: Metadata
```bash
curl https://tu-app.vercel.app/api/config/metadata
```
Debe devolver información de los factores ✅

### Test 4: Frontend
1. Abrir: `https://tu-app.vercel.app`
2. Debe cargar normalmente
3. Click "Actualizar"
4. Ver datos de criptos

---

## 🎯 Usando el Sistema Avanzado

### 1. Ver Configuración Actual

Desde el navegador o terminal:
```bash
curl https://tu-app.vercel.app/api/config | jq
```

### 2. Modificar Configuración

```bash
curl -X POST https://tu-app.vercel.app/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "metaWeights": {
        "quantitative": 0.65,
        "qualitative": 0.35
      },
      "factorWeights": {
        "volume": 0.12,
        "marketCap": 0.10,
        "volatility": 0.08,
        "historicalLow": 0.05,
        "googleTrends": 0.12,
        "fearGreedIndex": 0.03,
        "newsVolume": 0.15,
        "newsCount": 0.10
      },
      "thresholds": {
        "volumeMin": 150000000,
        "volumeMax": 15000000000,
        "marketCapRatioMin": 0.002,
        "marketCapRatioMax": 0.6,
        "volatilityMin": 0.06,
        "volatilityMax": 0.55,
        "historicalLowPercentile": 30,
        "searchIncreaseMin": 60,
        "searchIncreaseMax": 350,
        "fearGreedOptimalMin": 18,
        "fearGreedOptimalMax": 42,
        "newsCountMin": 4,
        "newsCountMax": 120,
        "newsSentimentMin": 0.25
      }
    }
  }'
```

### 3. Resetear a Default

```bash
curl -X POST https://tu-app.vercel.app/api/config/reset
```

---

## 🔧 Configuraciones Predefinidas

### Agresivo (High Risk/High Reward)

```bash
curl -X POST https://tu-app.vercel.app/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "metaWeights": {
        "quantitative": 0.70,
        "qualitative": 0.30
      },
      "factorWeights": {
        "volume": 0.15,
        "marketCap": 0.05,
        "volatility": 0.12,
        "historicalLow": 0.08,
        "googleTrends": 0.15,
        "fearGreedIndex": 0.02,
        "newsVolume": 0.10,
        "newsCount": 0.08
      },
      "thresholds": {
        "volumeMin": 50000000,
        "volumeMax": 5000000000,
        "volatilityMin": 0.10,
        "volatilityMax": 0.80,
        "searchIncreaseMin": 100,
        "searchIncreaseMax": 500
      }
    }
  }'
```

### Conservador (Estabilidad)

```bash
curl -X POST https://tu-app.vercel.app/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "metaWeights": {
        "quantitative": 0.50,
        "qualitative": 0.50
      },
      "factorWeights": {
        "volume": 0.08,
        "marketCap": 0.12,
        "volatility": 0.05,
        "historicalLow": 0.05,
        "googleTrends": 0.08,
        "fearGreedIndex": 0.05,
        "newsVolume": 0.15,
        "newsCount": 0.12
      },
      "thresholds": {
        "volumeMin": 200000000,
        "volumeMax": 20000000000,
        "volatilityMin": 0.03,
        "volatilityMax": 0.30,
        "marketCapRatioMin": 0.005,
        "newsCountMin": 5
      }
    }
  }'
```

---

## 📊 Entrenamiento con Nueva Configuración

Una vez que tengas ciclos completados:

```bash
# Entrenar con los últimos 5 ciclos
curl -X POST https://tu-app.vercel.app/api/algorithm/train \
  -H "Content-Type: application/json" \
  -d '{"cycleCount": 5}'
```

El sistema optimizará automáticamente los 23 parámetros activos.

---

## 🆘 Troubleshooting

### Error: "Config inválida"
**Causa:** Meta-weights no suman 1.0
**Solución:**
```javascript
// Asegúrate que:
quantitative + qualitative = 1.0
// Ejemplo:
"quantitative": 0.60,
"qualitative": 0.40
// Suma = 1.0 ✓
```

### Error: "KV no disponible"
**Causa:** Vercel KV no conectado
**Solución:**
1. Ve a Storage → tu KV
2. Click "Connect Project"
3. Reconectar
4. Redeploy: `git commit --allow-empty -m "reconnect" && git push`

### Configuración no se guarda
**Causa:** KV no configurado o error de conexión
**Solución:**
1. Verifica variables KV en Settings → Environment Variables
2. Deben existir 4 variables: KV_URL, KV_REST_API_URL, etc.
3. Si no existen, reconectar KV al proyecto

### Los pesos no suman 1.0
**Solución automática:**
El sistema normaliza automáticamente, pero es mejor que sumen ~1.0:
```javascript
// Ejemplo correcto:
volume: 0.10 +
marketCap: 0.08 +
volatility: 0.07 +
historicalLow: 0.05 +
googleTrends: 0.10 +
fearGreedIndex: 0.02 +
newsVolume: 0.12 +
newsCount: 0.08
= 0.62 ✓ (cercano a 1.0, se normaliza internamente)
```

---

## 📈 Monitoreo de Performance

### Ver impacto de configuración

1. **Antes de cambiar:**
```bash
curl https://tu-app.vercel.app/api/cycles/stats
# Anotar successRate actual
```

2. **Cambiar configuración** (ver ejemplos arriba)

3. **Ejecutar nuevo ciclo:**
   - En la app: Click "Ejecutar Ciclo 12h"
   - Esperar 12h
   - Volver y ver resultados

4. **Comparar:**
```bash
curl https://tu-app.vercel.app/api/cycles/history?limit=2
# Comparar último ciclo vs anterior
```

---

## 🎯 Mejores Prácticas

### 1. Experimentar Gradualmente
- Cambiar 1-2 parámetros a la vez
- Ejecutar ciclo
- Evaluar impacto
- Iterar

### 2. Documentar Configuraciones
- Guardar configs que funcionan bien
- Anotar en qué condiciones de mercado

### 3. Usar Entrenamiento
- Acumular al menos 5 ciclos
- Ejecutar entrenamiento
- Aplicar parámetros sugeridos
- Evaluar mejora

### 4. Adaptar a Mercado
- **Mercado alcista:** ↑ peso a volumen y trends
- **Mercado bajista:** ↑ peso a fear&greed y noticias
- **Mercado lateral:** ↑ peso a volatilidad

---

## 🔄 Actualizar a Futuras Versiones

Cuando se añadan nuevas APIs (Twitter, Reddit, etc.):

```bash
# 1. Pull nueva versión
git pull origin main

# 2. Reinstalar dependencias
npm install

# 3. Redeploy
git push
```

Tu configuración guardada en KV se mantendrá y se extenderá con los nuevos factores.

---

## 🎉 ¡Todo Listo!

Ahora tienes:
- ✅ Sistema de pesos configurables
- ✅ 8 factores ajustables (13 con APIs futuras)
- ✅ Breakdown detallado por factor
- ✅ Configuración guardada en KV
- ✅ Entrenamiento optimiza TODO
- ✅ Compatible con Hobby Plan (gratis)

**Próximos pasos sugeridos:**
1. Ejecutar 1-2 ciclos con config default
2. Ver qué factores tienen más impacto
3. Ajustar pesos según tu estrategia
4. Entrenar con histórico
5. Iterar y mejorar

¡Disfruta del control total sobre tu algoritmo! 🚀
