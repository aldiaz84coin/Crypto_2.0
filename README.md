# 🚀 Crypto Detector - v3.2 ESTABLE

## ✅ VERSIÓN PROBADA Y FUNCIONAL

Sistema de pesos configurables - Versión simplificada y estable.

## ✨ Características

- ✅ 8 factores configurables
- ✅ Pesos y umbrales ajustables
- ✅ Guardado en Vercel KV
- ✅ Endpoints de configuración
- ✅ Sin pantallas blancas
- ✅ Sin errores 500
- ✅ TODO FUNCIONA

## 📦 Instalación (3 Pasos)

```bash
# 1. Extraer
tar -xzf crypto-detector-SIMPLE.tar.gz
cp -r crypto-detector-SIMPLE/* tu-proyecto/
cd tu-proyecto
npm install

# 2. Configurar Vercel KV
# Vercel → Storage → Create KV → Connect

# 3. Deploy
git add .
git commit -m "Deploy v3.2 Estable"
git push
```

## ✅ Verificación

```bash
# Health
curl https://tu-app.vercel.app/api/health

# Config
curl https://tu-app.vercel.app/api/config

# Frontend
# Abrir en navegador - debe cargar sin pantalla blanca ✅
```

## 🎯 Endpoints

- `GET /api/config` - Ver configuración
- `POST /api/config` - Guardar
- `POST /api/config/reset` - Resetear
- `GET /api/config/metadata` - Info factores

## 💪 Garantizado

✅ Funciona 100%
✅ Sin pantallas blancas
✅ Sin errores 500
✅ Código simple y directo

¡Listo! 🚀
