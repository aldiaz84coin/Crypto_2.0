# 📖 INSTRUCCIONES DE DESPLIEGUE - PASO A PASO

## 🎯 LO QUE TIENES

Un paquete completo con:
- ✅ Backend con ciclos de 12h
- ✅ Entrenamiento de algoritmo  
- ✅ Frontend con debug
- ✅ Todo integrado y listo para usar

---

## 🚀 DESPLIEGUE EN 5 PASOS (15 minutos)

### PASO 1: Reemplazar tu Proyecto (2 min)

```bash
# 1. Hacer backup de tu proyecto actual (opcional)
cp -r tu-proyecto-actual tu-proyecto-backup

# 2. Extraer el paquete
unzip crypto-detector-FINAL.tar.gz

# 3. Copiar TODO el contenido sobre tu proyecto
cp -r crypto-detector-FINAL/* tu-proyecto-actual/

# 4. Ir al proyecto
cd tu-proyecto-actual

# 5. Instalar dependencias
npm install
```

**Deberías ver que instala @vercel/kv**

---

### PASO 2: Configurar Vercel KV (5 min)

#### 2.1 Ir a Vercel
1. https://vercel.com/dashboard
2. Click en **Storage** (menú lateral)

#### 2.2 Crear KV
1. Click **"Create Database"**
2. Seleccionar **"KV"**
3. Nombre: `crypto-detector-kv`
4. Region: La más cercana (ej: Frankfurt)
5. Click **"Create"**

#### 2.3 Conectar
1. Click **"Connect Project"**
2. Selecciona: `crypto-detector` (tu proyecto)
3. Click **"Connect"**

✅ **Las variables KV se añaden automáticamente**

---

### PASO 3: Configurar CRON_SECRET (2 min)

#### 3.1 Generar el Secret

**En tu terminal:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copiar el resultado (algo como: `a8f5c2e9d1b4a7c3f6e8...`)

#### 3.2 Añadir en Vercel

1. Tu proyecto → **Settings** → **Environment Variables**
2. Click **"Add New"**
3. Completar:
   - **Name:** `CRON_SECRET`
   - **Value:** [pegar el valor generado]
   - Marcar: ✅ Production ✅ Preview ✅ Development
4. Click **"Save"**

---

### PASO 4: Deploy (3 min)

```bash
# 1. Añadir archivos
git add .

# 2. Commit
git commit -m "Deploy: Ciclos 12h + Entrenamiento IA completo"

# 3. Push
git push origin main
```

#### Esperar Deploy
- Ve a Vercel → **Deployments**
- Espera 2-3 minutos
- Debe decir **"Ready"** ✅

---

### PASO 5: Verificar (3 min)

#### Test 1: Backend
```bash
curl https://tu-app.vercel.app/api/health
```

Debe responder JSON ✅

#### Test 2: Ciclos
```bash
curl https://tu-app.vercel.app/api/cycles/stats
```

Debe responder:
```json
{
  "success": true,
  "stats": {
    "activeCycles": 0,
    "completedCycles": 0,
    ...
  }
}
```

#### Test 3: Cron Job
1. Vercel → tu proyecto → **Deployments**
2. Tab **"Cron"**
3. Ver ejecuciones cada minuto
4. Estado: **200 OK** ✅

#### Test 4: Frontend
1. Abrir: `https://tu-app.vercel.app`
2. Debe cargar la app
3. Debe tener 4 pestañas: Monitor, Parámetros, Historial, Debug

---

## ✅ CHECKLIST FINAL

- [ ] Archivos reemplazados
- [ ] `npm install` ejecutado
- [ ] Vercel KV creado y conectado
- [ ] Variables KV visibles en Settings
- [ ] CRON_SECRET generado y configurado
- [ ] Git push completado
- [ ] Deploy en estado "Ready"
- [ ] `/api/health` responde
- [ ] `/api/cycles/stats` responde
- [ ] Cron tab muestra ejecuciones
- [ ] App carga en navegador

---

## 🎉 ¡LISTO!

Tu app ahora tiene:
- ✅ Ciclos de 12h reales
- ✅ Email automático
- ✅ Entrenamiento de algoritmo
- ✅ Base de datos persistente
- ✅ Todo funcionando 100%

---

## 🧪 PROBAR FUNCIONALIDAD

### Probar Ciclo Manual (Testing Rápido)

```bash
# Crear ciclo de prueba
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

# Copiar el "id" del ciclo de la respuesta

# Completar inmediatamente (para testing)
curl -X POST https://tu-app.vercel.app/api/cycles/TU_CYCLE_ID/complete

# Ver resultado
curl https://tu-app.vercel.app/api/cycles/TU_CYCLE_ID
```

### Probar Desde la App

1. Click **"Actualizar"** (carga datos)
2. Click **"Ejecutar Ciclo 12h"**
3. Confirmar
4. Ver countdown en tiempo real
5. Esperar o completar manualmente

---

## 🆘 SOLUCIÓN DE PROBLEMAS

### Error: "KV is not defined"
**Solución:**
1. Vercel → Storage → tu KV → "Connect Project"
2. Reconectar
3. Redeploy

### Error: "Unauthorized" en cron
**Solución:**
1. Verificar CRON_SECRET en Environment Variables
2. Debe ser el mismo valor
3. Redeploy

### Cron no ejecuta
**Solución:**
1. Esperar 2-3 minutos después del deploy
2. Los crons tardan en activarse
3. Verificar vercel.json tiene la sección "crons"

---

## 📞 SOPORTE

Si algo no funciona:
1. Revisa los logs: Vercel → Deployments → último deploy → Runtime Logs
2. Busca errores en rojo
3. Verifica que todas las variables estén configuradas

**Variables mínimas requeridas:**
- ✅ KV_URL
- ✅ KV_REST_API_URL
- ✅ KV_REST_API_TOKEN
- ✅ KV_REST_API_READ_ONLY_TOKEN
- ✅ CRON_SECRET

---

¡Todo debería funcionar perfectamente! 🚀
