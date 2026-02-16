# 🚀 Crypto Detector v3.1 - ITERACIÓN 1
## Sistema de Configuración Básico

---

## ✨ NUEVAS FUNCIONALIDADES

### Backend:
✅ **Módulo `algorithm-config.js`**
- Gestión de configuración con 3 parámetros básicos
- Validación de configuración
- Persistencia en Vercel KV

✅ **Nuevos Endpoints API:**
- `GET /api/config` - Obtener configuración actual
- `POST /api/config` - Guardar nueva configuración
- `POST /api/config/reset` - Resetear a valores por defecto

✅ **KV Helpers Mejorado:**
- Métodos `get()` y `set()` genéricos añadidos
- Soporte para cualquier clave/valor

### Frontend:
✅ **Nueva Tab "Configuración"**
- Slider para Peso Cuantitativo (0-100%)
- Display automático de Peso Cualitativo
- Slider para Umbral INVERTIBLE (30-50%)
- Botones Guardar y Resetear
- Mensajes de éxito/error

---

## 📊 PARÁMETROS CONFIGURABLES (Iteración 1)

| Parámetro | Rango | Default | Descripción |
|-----------|-------|---------|-------------|
| `quantitativeWeight` | 0.0 - 1.0 | 0.60 | Peso factores numéricos |
| `qualitativeWeight` | 0.0 - 1.0 | 0.40 | Peso factores sentimiento |
| `boostPowerThreshold` | 0.30 - 0.50 | 0.40 | Umbral INVERTIBLE |

**Validación:** quantitativeWeight + qualitativeWeight debe = 1.0

---

## 🚀 INSTALACIÓN Y DEPLOY

### Paso 1: Extraer
```bash
tar -xzf crypto-detector-v3.1-ITER1.tar.gz
cd crypto-detector-v3.1-ITER1
```

### Paso 2: Instalar dependencias
```bash
npm install
```

### Paso 3: Configurar Vercel KV (si no lo has hecho)
1. Vercel Dashboard → Storage → Create KV
2. Connect to project
3. Variables KV se añaden automáticamente

### Paso 4: Deploy
```bash
git init
git add .
git commit -m "Deploy Iteration 1: Config básico"
git push vercel main
```

---

## ✅ CHECKLIST DE VALIDACIÓN

Antes de pasar a Iteración 2, verificar:

### Backend:
- [ ] GET /api/health responde correctamente
- [ ] GET /api/config devuelve config por defecto
- [ ] POST /api/config guarda correctamente
- [ ] POST /api/config/reset resetea a default
- [ ] Validación rechaza configs inválidas

### Frontend:
- [ ] Página carga sin pantalla blanca
- [ ] Tab "Configuración" aparece y funciona
- [ ] Slider Cuantitativo ajusta valor correctamente
- [ ] Peso Cualitativo se calcula automáticamente
- [ ] Slider Umbral ajusta entre 30-50%
- [ ] Botón "Guardar" funciona (mensaje de éxito)
- [ ] Botón "Resetear" funciona
- [ ] No hay errores en consola del navegador

### Integración:
- [ ] Config guardada persiste al recargar página
- [ ] Sin Vercel KV, usa config por defecto

---

## 🧪 TESTS MANUALES

### Test 1: Guardar Configuración
```bash
# 1. Abrir https://tu-app.vercel.app
# 2. Ir a tab "Configuración"
# 3. Mover slider Cuantitativo a 70%
# 4. Mover slider Umbral a 45%
# 5. Click "Guardar Configuración"
# 6. Esperar mensaje "✅ Configuración guardada"
# 7. Recargar página (F5)
# 8. Verificar que sliders mantienen valores
```

### Test 2: Validación
```bash
curl -X POST https://tu-app.vercel.app/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "quantitativeWeight": 0.70,
      "qualitativeWeight": 0.20,
      "boostPowerThreshold": 0.40
    }
  }'

# Debe devolver error: Los pesos deben sumar 1.0
```

### Test 3: Resetear
```bash
curl -X POST https://tu-app.vercel.app/api/config/reset

# Debe devolver:
# {
#   "success": true,
#   "config": {
#     "quantitativeWeight": 0.60,
#     "qualitativeWeight": 0.40,
#     "boostPowerThreshold": 0.40
#   }
# }
```

---

## 📁 ARCHIVOS MODIFICADOS/NUEVOS

### Nuevos:
- `api/algorithm-config.js` ⭐ Módulo de configuración

### Modificados:
- `api/index.js` - Añadidos 3 endpoints de config
- `api/kv-helpers.js` - Añadidos métodos get/set
- `public/index.html` - Nueva tab Config + estado + funciones

### Sin Cambios:
- `api/cycles-endpoints.js`
- `api/algorithm-training.js`
- `api/report-generator.js`
- `api/email-service.js`
- `package.json`
- `vercel.json`

---

## 🎯 PRÓXIMA ITERACIÓN (Iteración 2)

En la Iteración 2 añadiremos:
- ✨ 8 pesos de factores individuales (volume, marketCap, etc.)
- ✨ 6 umbrales básicos (volumeMin/Max, etc.)
- ✨ Calculador de BoostPower mejorado que usa los pesos
- ✨ Frontend expandido con más controles

---

## 🆘 TROUBLESHOOTING

### Error: "Los pesos deben sumar 1.0"
**Causa:** quantitativeWeight + qualitativeWeight ≠ 1.0  
**Solución:** Ajustar valores. En el frontend, esto es automático.

### Config no se guarda
**Causa:** Vercel KV no configurado  
**Solución:**
1. Vercel → Storage → Connect KV to project
2. Redeploy

### Tab Config no aparece
**Causa:** Error en JavaScript  
**Solución:**
1. F12 → Console
2. Verificar errores
3. Verificar que todos los archivos se subieron

---

## 📞 VALIDACIÓN ANTES DE CONTINUAR

**🟢 CONTINUAR A ITERACIÓN 2 SI:**
- ✅ Todos los checkboxes marcados
- ✅ Tests manuales pasan
- ✅ No hay errores en consola
- ✅ Deploy exitoso sin 500

**🔴 DETENERSE Y CORREGIR SI:**
- ❌ Pantalla blanca
- ❌ Error 500 en algún endpoint
- ❌ Config no persiste
- ❌ Errores en consola

---

**Versión:** 3.1-iter1  
**Fecha:** Febrero 2026  
**Estado:** ✅ Lista para Validación

---

Una vez validada esta iteración, procederemos con **Iteración 2: Pesos Completos**.
