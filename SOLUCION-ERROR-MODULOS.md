# 🔧 SOLUCIÓN RÁPIDA: Error "Cannot find module"

## ❌ Error que estás viendo:

```
Cannot find module './report-generator'
Require stack:
- /var/task/api/index.js
```

## ✅ SOLUCIÓN INMEDIATA

### Opción 1: Reconfigurar el Proyecto (RECOMENDADO)

```bash
# 1. En tu carpeta del proyecto local
./setup-vercel.sh

# 2. Verificar que se crearon estos archivos:
ls api/
# Deberías ver:
# - index.js
# - report-generator.js
# - email-service.js

# 3. Subir cambios a GitHub
git add .
git commit -m "Fix: Añadir módulos a carpeta api"
git push

# 4. Vercel redesplegará automáticamente
```

### Opción 2: Copiar Manualmente

Si el script no funciona:

```bash
# Crear carpeta api si no existe
mkdir -p api

# Copiar archivos necesarios
cp server.js api/index.js
cp report-generator.js api/
cp email-service.js api/

# Subir a GitHub
git add .
git commit -m "Fix: Estructura correcta para Vercel"
git push
```

---

## 📁 ESTRUCTURA CORRECTA DEL PROYECTO

Tu proyecto debe verse así ANTES de subir a GitHub:

```
crypto-detector/
├── api/
│   ├── index.js              ← Servidor backend
│   ├── report-generator.js   ← Generador de informes
│   └── email-service.js      ← Servicio de email
├── public/
│   ├── index.html
│   └── app.jsx
├── package.json
├── vercel.json
├── .env.example
├── .gitignore
└── README.md
```

---

## 🔍 VERIFICAR QUE ESTÁ CORRECTO

### En Local:

```bash
# Verificar estructura
tree -L 2

# O simplemente
ls api/
# Debe mostrar: index.js, report-generator.js, email-service.js

ls public/
# Debe mostrar: index.html, app.jsx
```

### En GitHub:

1. Ve a tu repositorio en GitHub
2. Verifica que la carpeta `api/` existe
3. Verifica que tiene los 3 archivos:
   - index.js
   - report-generator.js
   - email-service.js

---

## 🚀 REDESPLEGAR EN VERCEL

### Opción A: Automático (si ya hiciste git push)

Vercel detecta cambios automáticamente y redespliega.

1. Ve a: https://vercel.com/tu-usuario/crypto-detector
2. Pestaña **"Deployments"**
3. Espera a que aparezca el nuevo deployment
4. Debería completarse sin errores

### Opción B: Manual (forzar redeploy)

1. Ve a tu proyecto en Vercel
2. Pestaña **"Deployments"**
3. Click en el último deployment
4. Click en los 3 puntos **"..."**
5. **"Redeploy"**
6. Confirmar

---

## 🧪 VERIFICAR QUE FUNCIONA

Una vez redesplegado:

```bash
# Reemplaza con tu URL real
curl https://tu-app.vercel.app/api/health

# Debe responder sin errores
# Si ves JSON con "status": "healthy" → ✅ Funciona
```

---

## 🆘 SI SIGUE SIN FUNCIONAR

### Verificar Logs en Vercel:

1. Ve a tu proyecto en Vercel
2. **Deployments** → Click en el último
3. **"Runtime Logs"**
4. Busca el error específico

### Errores Comunes:

#### Error: "Cannot find module 'docx'"
**Solución:**
```bash
# Asegúrate que package.json tiene:
"dependencies": {
  "docx": "^8.5.0",
  "nodemailer": "^6.9.7"
}

# Y haz git push de nuevo
```

#### Error: "ReportGenerator is not a constructor"
**Solución:**
Verifica que `report-generator.js` esté en `api/`

#### Error: "EmailService is not a constructor"
**Solución:**
Verifica que `email-service.js` esté en `api/`

---

## 📝 CHECKLIST DE SOLUCIÓN

- [ ] ✅ Ejecuté `./setup-vercel.sh`
- [ ] ✅ Carpeta `api/` existe
- [ ] ✅ `api/index.js` existe
- [ ] ✅ `api/report-generator.js` existe
- [ ] ✅ `api/email-service.js` existe
- [ ] ✅ Carpeta `public/` existe
- [ ] ✅ `public/index.html` existe
- [ ] ✅ `public/app.jsx` existe
- [ ] ✅ `git add .` ejecutado
- [ ] ✅ `git commit` ejecutado
- [ ] ✅ `git push` ejecutado
- [ ] ✅ Vercel redesplegó automáticamente
- [ ] ✅ No hay errores en Vercel logs

---

## 💡 EXPLICACIÓN DEL PROBLEMA

### ¿Por qué pasó esto?

Vercel usa **serverless functions**. Cada función (endpoint del backend) se ejecuta en un contenedor aislado.

Cuando el código hace:
```javascript
const ReportGenerator = require('./report-generator');
```

Busca `report-generator.js` en la MISMA carpeta que `index.js`.

### Antes (❌ Incorrecto):
```
/
├── server.js
├── report-generator.js  ← Backend busca aquí
└── api/
    └── index.js          ← Pero se ejecuta aquí
```

### Ahora (✅ Correcto):
```
/api/
├── index.js
├── report-generator.js  ← ¡Ahora está en el mismo lugar!
└── email-service.js
```

---

## 🎯 COMANDOS RÁPIDOS DE RECUPERACIÓN

Copia y pega estos comandos en orden:

```bash
# 1. Verificar ubicación actual
pwd

# 2. Reorganizar archivos (si no usaste el script)
mkdir -p api public
cp server.js api/index.js
cp report-generator.js api/
cp email-service.js api/
cp crypto-detector-real-api.jsx public/app.jsx
cp index.html public/

# 3. Subir cambios
git add .
git commit -m "Fix: Reorganizar para Vercel serverless"
git push origin main

# 4. Esperar 2-3 minutos y verificar
curl https://TU-URL.vercel.app/api/health
```

---

## ✅ CONFIRMACIÓN DE ÉXITO

Sabrás que está funcionando cuando:

1. **En Vercel:**
   - Deployment muestra "Ready" ✅
   - No hay errores en "Runtime Logs"

2. **En tu navegador:**
   - `https://tu-app.vercel.app/api/health` responde con JSON
   - La app carga correctamente
   - Los botones funcionan

3. **Probando funcionalidades:**
   - "Actualizar" carga datos ✅
   - "Ejecutar Ciclo 12h" funciona ✅
   - "Descargar Informe" genera .docx ✅
   - "Enviar Email" envía correctamente ✅

---

**¡Problema resuelto! 🎉**

Si sigues teniendo problemas, comparte:
1. Los logs completos de Vercel
2. La estructura de tu carpeta (comando `tree` o `ls -R`)
