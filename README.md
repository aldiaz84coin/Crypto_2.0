# 🚀 Crypto Detector - Versión Completa

## ✨ Características

- ✅ Ciclos de 12h reales con email automático
- ✅ Entrenamiento de algoritmo con IA
- ✅ Base de datos Vercel KV
- ✅ Cron jobs automáticos
- ✅ Debug completo
- ✅ Sin datos simulados

## 📦 Instalación

1. Descomprimir este archivo
2. Reemplazar tu carpeta actual con estos archivos
3. Ejecutar: `npm install`
4. Seguir INSTRUCCIONES-DESPLIEGUE.md

## 📁 Estructura

```
crypto-detector/
├── api/
│   ├── index.js                 (Backend principal)
│   ├── kv-helpers.js           (Base de datos)
│   ├── cycles-endpoints.js     (Endpoints ciclos)
│   ├── algorithm-training.js   (Entrenamiento IA)
│   ├── report-generator.js     (Informes Word)
│   └── email-service.js        (Email)
├── public/
│   └── index.html              (Frontend completo)
├── package.json
├── vercel.json                 (con cron job)
└── .env.example
```

## 🔧 Variables de Entorno Requeridas

### Obligatorias:
- `CRON_SECRET` - Para cron job (generar con crypto.randomBytes)

### Auto-generadas por Vercel KV:
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`

### Opcionales:
- `SERPAPI_KEY` - Google Trends
- `CRYPTOCOMPARE_KEY` - Noticias
- `SENDGRID_API_KEY` - Email
- `REPORT_RECIPIENT_EMAIL` - Destinatario

## 🚀 Deploy Rápido

```bash
# 1. Instalar
npm install

# 2. Configurar Vercel KV (ver INSTRUCCIONES-DESPLIEGUE.md)

# 3. Deploy
git add .
git commit -m "Deploy completo v3"
git push
```

¡Listo!
