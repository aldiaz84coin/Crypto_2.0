# 📋 CHANGELOG - Versión 3.1.1 (Fixed)

## 🐛 v3.1.1 (16 Feb 2026) - Bug Fix

### Correcciones
- 🐛 **Fix crítico:** Eliminado código duplicado en `index.js` que causaba error 500
- 🐛 **Fix:** `module.exports` movido al final del archivo
- ✨ **Mejora:** Añadidos métodos `get()` y `set()` genéricos en `kv-helpers.js`
- ✅ **Testeo:** Verificado funcionamiento completo

### Archivos Modificados
- `api/index.js` - Eliminadas líneas 820-940 (código duplicado)
- `api/kv-helpers.js` - Añadidos métodos get/set para configuración

---

## 🆕 v3.1.0 (16 Feb 2026) - Sistema Avanzado

### Novedades Principales

#### 1. Sistema de Pesos Configurables
- ✅ 2 meta-pesos ajustables (Cuanti vs Cuali)
- ✅ 8 pesos de factores individuales
- ✅ 13 umbrales configurables
- ✅ Guardado en Vercel KV
- ✅ Total: 23 parámetros configurables

#### 2. Breakdown Detallado de BoostPower
Ahora muestra contribución de cada factor:
```
BoostPower: 0.78
├─ Cuantitativos: 0.82 (60%)
│  ├─ Volume: 0.90 (10%)
│  ├─ Market Cap: 0.85 (8%)
│  └─ ...
└─ Cualitativos: 0.70 (40%)
   ├─ Fear & Greed: 0.95 (2%)
   └─ ...
```

#### 3. Nuevos Endpoints API
- `GET /api/config` - Obtener configuración
- `POST /api/config` - Guardar configuración
- `POST /api/config/reset` - Resetear a valores por defecto
- `GET /api/config/metadata` - Metadata de factores

#### 4. Módulos Backend Nuevos
- `algorithm-config-advanced.js` (1.2 KB)
- `boost-power-calculator.js` (7.3 KB)
- `config-endpoints.js` (9.6 KB)

---

## 📊 Factores Implementados

### Actual (v3.1)
1. ✅ Volumen 24h
2. ✅ Market Cap Ratio
3. ✅ Volatilidad
4. ✅ Historical Low
5. ✅ Google Trends
6. ✅ Fear & Greed Index
7. ✅ News Volume & Sentiment
8. ✅ News Count

### Próximamente (Fases 2-4)
9. ⏳ Twitter Sentiment
10. ⏳ Reddit Sentiment
11. ⏳ Telegram Activity
12. ⏳ TikTok Mentions
13. ⏳ Media Coverage Quality
14. ⏳ Developer Activity (GitHub)
15-19. ⏳ Más métricas on-chain

---

## 🔄 Migración desde v3.0

Completamente retrocompatible ✅

```bash
tar -xzf crypto-detector-ADVANCED-FIXED.tar.gz
cp -r crypto-detector-ADVANCED/* tu-proyecto/
cd tu-proyecto
npm install
git add .
git commit -m "Upgrade to v3.1.1"
git push
```

---

## 📦 Tamaño

- v3.1.1: 40 KB comprimido
- v3.0: 32 KB comprimido
- Diferencia: +8 KB (nuevos módulos)

---

## ⚠️ Versiones

### ✅ USAR:
- `crypto-detector-ADVANCED-FIXED.tar.gz` (v3.1.1)

### ❌ NO USAR:
- `crypto-detector-ADVANCED.tar.gz` (v3.1.0 - tiene bug)

---

## 🎯 Roadmap

### v3.2 (Social Media)
- [ ] Twitter API + VADER NLP
- [ ] Reddit API
- [ ] Telegram Bot API
- [ ] TikTok Research API

### v3.3 (On-Chain)
- [ ] Glassnode integration
- [ ] CryptoQuant flows
- [ ] Whale tracking

### v3.4 (UI Avanzada)
- [ ] Visual config editor
- [ ] Breakdown charts
- [ ] A/B testing

---

Ver **BUGFIX-v3.1.1.md** para detalles del fix.
