# 🚀 Crypto Detector v3.1 - Con Upstash Redis

## ⚠️ CAMBIO IMPORTANTE: Upstash Redis en lugar de Vercel KV

Vercel KV está deprecado. Esta versión usa **Upstash Redis** correctamente.

---

## ✨ FUNCIONALIDADES

### Backend:
- ✅ Conexión a Upstash Redis (sin @vercel/kv deprecado)
- ✅ 3 endpoints de configuración
- ✅ Endpoint /api/crypto para obtener datos
- ✅ Validación completa de configuración

### Frontend:
- ✅ 2 tabs: Monitor y Configuración
- ✅ Sliders para ajustar pesos
- ✅ Guardar/Resetear configuración
- ✅ Vista de criptos

---

## 🚀 INSTALACIÓN Y DEPLOY

### Paso 1: Extraer
```bash
tar -xzf crypto-detector-v3.1-ITER1-UPSTASH.tar.gz
cd crypto-detector-v3.1-ITER1-UPSTASH
```

### Paso 2: Configurar Upstash Redis en Vercel

#### CRÍTICO: Ya NO uses "Create KV". Ahora es así:

1. Ve a **Vercel Dashboard**
2. Tu proyecto → **Integrations**
3. Busca "**Upstash Redis**" en Marketplace
4. Click **Add Integration**
5. Selecciona tu proyecto
6. Autoriza la integración
7. Vercel añadirá automáticamente las variables:
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`

**NO NECESITAS** crear nada manualmente. La integración lo hace todo.

### Paso 3: Deploy
```bash
npm install

git init
git add .
git commit -m "Deploy v3.1 con Upstash Redis"
git push origin main
```

---

## ✅ VERIFICACIÓN

### 1. Backend
```bash
curl https://tu-app.vercel.app/api/health

# Debe devolver:
# {
#   "status": "ok",
#   "redis": "connected"  ← IMPORTANTE: debe decir "connected"
# }
```

### 2. Configuración
```bash
curl https://tu-app.vercel.app/api/config

# Debe devolver la config por defecto
```

### 3. Frontend
1. Abrir: https://tu-app.vercel.app
2. Tab "Monitor" → Click "Cargar Datos"
3. Tab "Configuración" → Mover sliders → Guardar
4. Debe aparecer "✅ Guardado correctamente"
5. Recargar página (F5)
6. Verificar que sliders mantienen valores

---

## 📊 PARÁMETROS

| Parámetro | Rango | Default |
|-----------|-------|---------|
| Peso Cuantitativo | 0-100% | 60% |
| Peso Cualitativo | 0-100% | 40% |
| Umbral INVERTIBLE | 30-50% | 40% |

---

## 🆘 TROUBLESHOOTING

### Error: "redis: 'not available'"
**Causa:** Upstash Redis no configurado  
**Solución:**
1. Vercel → Integrations
2. Añadir "Upstash Redis"
3. Conectar a tu proyecto
4. Redeploy

### Config no se guarda
**Causa:** Redis no conectado  
**Verificar:** `/api/health` debe mostrar `"redis": "connected"`

### Pantalla blanca
**Causa:** Error en JavaScript  
**Solución:**
1. F12 → Console
2. Ver errores
3. Vercel → Deployments → Runtime Logs

---

## 📦 DEPENDENCIAS

```json
{
  "express": "^4.18.2",
  "axios": "^1.6.0",
  "cors": "^2.8.5",
  "@upstash/redis": "^1.28.0"  ← Nueva dependencia (NO @vercel/kv)
}
```

---

## 🎯 DIFERENCIAS vs Versión Anterior

| Aspecto | Anterior | Nueva (Upstash) |
|---------|----------|-----------------|
| Dependencia | `@vercel/kv` | `@upstash/redis` |
| Configuración | Vercel KV Storage | Vercel Integration |
| Setup | Manual | Automático |
| Estado | Deprecado ⚠️ | Soportado ✅ |

---

## ✅ CHECKLIST DE VALIDACIÓN

- [ ] `npm install` sin warnings de deprecación
- [ ] `/api/health` responde `"redis": "connected"`
- [ ] GET /api/config funciona
- [ ] POST /api/config guarda correctamente
- [ ] Frontend carga sin pantalla blanca
- [ ] Tab Config funciona
- [ ] Config persiste al recargar

---

## 🚀 PRÓXIMOS PASOS

Una vez validada esta versión, continuaremos con:
- **Iteración 2:** 8 pesos de factores + 6 umbrales

---

**Versión:** 3.1-iter1-upstash  
**Estado:** Lista para Deploy con Upstash Redis
