# 📋 CHANGELOG - Versión 3.1 (Advanced)

## 🆕 Novedades Principales

### 1. Sistema de Pesos Configurables
**Antes (v3.0):**
- Pesos fijos hardcodeados
- No se podían ajustar
- Mismo algoritmo para todos

**Ahora (v3.1):**
- ✅ 2 meta-pesos ajustables (Cuanti vs Cuali)
- ✅ 8 pesos de factores individuales
- ✅ 13 umbrales configurables
- ✅ Guardado en Vercel KV
- ✅ Diferentes configuraciones por usuario (futuro)

---

### 2. Breakdown Detallado de BoostPower
**Antes:**
```
BoostPower: 0.78
```

**Ahora:**
```
BoostPower: 0.78
├─ Cuantitativos: 0.82 (60%)
│  ├─ Volume: 0.90 (10%)
│  ├─ Market Cap: 0.85 (8%)
│  ├─ Volatility: 0.75 (7%)
│  └─ ...
└─ Cualitativos: 0.70 (40%)
   ├─ Fear & Greed: 0.95 (2%)
   ├─ News Volume: 0.65 (12%)
   └─ ...
```

---

### 3. Nuevos Endpoints API

#### GET /api/config
Obtener configuración actual

#### POST /api/config
Guardar nueva configuración

#### POST /api/config/reset
Resetear a valores por defecto

#### GET /api/config/metadata
Metadata de factores para UI

---

### 4. Módulos Backend Nuevos

#### `algorithm-config-advanced.js`
- Configuración por defecto
- Funciones de normalización
- Estructura de pesos y umbrales

#### `boost-power-calculator.js`
- Cálculo avanzado de BoostPower
- Separación Cuanti/Cuali
- Breakdown detallado por factor
- Aplicación de pesos configurables

#### `config-endpoints.js`
- Endpoints de configuración
- Validación de configs
- Guardado en KV
- Metadata para UI

---

## 📊 Comparación de Capacidades

| Característica | v2.0 | v3.0 | v3.1 Advanced |
|----------------|------|------|---------------|
| **Factores Totales** | 5 | 8 | 8 (19 futuro) |
| **Configurables** | 0 | 0 | 23 parámetros |
| **Meta-Pesos** | No | No | ✅ Sí |
| **Pesos Individuales** | Fijos | Fijos | ✅ Ajustables |
| **Umbrales** | 5 fijos | 10 fijos | ✅ 13 ajustables |
| **Guardado Config** | No | No | ✅ Sí (KV) |
| **Breakdown** | No | Básico | ✅ Detallado |
| **APIs** | 4 | 4 | 4 (19 futuro) |
| **Entrenamiento** | 5 params | 10 params | 23 params |

---

## 🎯 Factores Implementados

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
14. ⏳ Breaking News Impact
15. ⏳ Developer Activity (GitHub)
16. ⏳ Active Transactions
17. ⏳ Active Addresses
18. ⏳ Exchange Flow
19. ⏳ Whale Activity

---

## 🔧 Archivos Modificados/Nuevos

### Nuevos
```
api/
├── algorithm-config-advanced.js    (NUEVO - 1.2 KB)
├── boost-power-calculator.js      (NUEVO - 7.3 KB)
└── config-endpoints.js            (NUEVO - 9.6 KB)
```

### Modificados
```
api/
└── index.js                        (+ integración config endpoints)
```

### Sin Cambios
```
api/
├── kv-helpers.js                   (sin cambios)
├── cycles-endpoints.js             (sin cambios)
├── algorithm-training.js           (sin cambios)
├── report-generator.js             (sin cambios)
└── email-service.js                (sin cambios)

public/
└── index.html                      (sin cambios, UI futuro)

package.json                        (sin cambios)
vercel.json                         (sin cambios)
```

---

## 🚀 Mejoras de Performance

### Flexibilidad
- **Antes:** Algoritmo rígido, una configuración para todo
- **Ahora:** Adapta el algoritmo a tu estrategia

### Precisión
- **Antes:** ~70% tasa de acierto promedio
- **Ahora:** Posibilidad de optimizar para tu caso específico

### Entrenamiento
- **Antes:** Optimiza 10 parámetros
- **Ahora:** Optimiza 23 parámetros (más control)

---

## 📱 Próximas Actualizaciones UI

### Fase 1.1: UI Básica (Próxima)
- Tab "Configuración Avanzada"
- Sliders para meta-pesos
- Sliders para factores
- Inputs para umbrales
- Botón guardar/resetear

### Fase 1.2: UI Mejorada
- Preview en tiempo real
- Gráficos de impacto
- Comparación de configs
- Importar/exportar configs

### Fase 1.3: UI Avanzada
- Breakdown visual por factor
- Heatmap de contribución
- Timeline de evolución
- A/B testing de configs

---

## 🔄 Migración desde v3.0

### Completamente Retrocompatible ✅

```bash
# 1. Backup (opcional)
cp -r tu-proyecto tu-proyecto-v3.0

# 2. Extraer y reemplazar
tar -xzf crypto-detector-ADVANCED.tar.gz
cp -r crypto-detector-ADVANCED/* tu-proyecto/

# 3. Deploy
cd tu-proyecto
npm install  # Mismo package.json
git add .
git commit -m "Upgrade to v3.1 Advanced"
git push
```

**Sin cambios breaking:**
- ✅ Mismas APIs
- ✅ Mismos endpoints existentes
- ✅ Misma estructura de datos
- ✅ Solo AÑADE nuevos endpoints
- ✅ Config default = v3.0 behavior

---

## 🎓 Cómo Usar las Nuevas Funciones

### 1. Empezar con Default
```bash
# Ver config actual
curl https://tu-app.vercel.app/api/config

# Ejecutar ciclo con default
# (comportamiento idéntico a v3.0)
```

### 2. Experimentar con Pesos
```bash
# Aumentar peso de volumen
curl -X POST https://tu-app.vercel.app/api/config \
  -d '{"config": {"factorWeights": {"volume": 0.15}}}'

# Ejecutar ciclo
# Comparar resultados
```

### 3. Entrenar y Optimizar
```bash
# Después de 5+ ciclos
curl -X POST https://tu-app.vercel.app/api/algorithm/train \
  -d '{"cycleCount": 5}'

# Sistema sugiere mejores pesos
# Aplicar y volver a entrenar
```

---

## 🐛 Bug Fixes

### Ninguno (No hay bugs conocidos)
Esta es una release de nuevas funcionalidades sobre v3.0 estable.

---

## ⚠️ Breaking Changes

### Ninguno ✅
Totalmente retrocompatible con v3.0

---

## 📦 Tamaño del Paquete

```
v3.0:  32 KB
v3.1:  38 KB (+6 KB)

Nuevos archivos:
- algorithm-config-advanced.js:  1.2 KB
- boost-power-calculator.js:     7.3 KB
- config-endpoints.js:           9.6 KB

Total añadido: ~18 KB (comprimido: +6 KB)
```

---

## 🎯 Roadmap Futuro

### v3.2 (Social Media)
- [ ] Twitter API integration
- [ ] Reddit API integration
- [ ] Telegram Bot API
- [ ] Sentiment analysis (VADER)

### v3.3 (On-Chain)
- [ ] Glassnode integration
- [ ] CryptoQuant flows
- [ ] Dune Analytics patterns
- [ ] Whale tracking

### v3.4 (UI Avanzada)
- [ ] Visual config editor
- [ ] Breakdown charts
- [ ] A/B testing
- [ ] Config marketplace

### v3.5 (ML Avanzado)
- [ ] Genetic Algorithm
- [ ] Neural networks
- [ ] Ensemble methods
- [ ] Backtesting framework

---

## 📞 Soporte

**Documentación:**
- README.md - Visión general
- INSTRUCCIONES.md - Deploy paso a paso
- CHANGELOG.md - Este documento

**Ayuda:**
- GitHub Issues (si aplica)
- Documentación inline en código
- Comentarios detallados

---

## 🎉 Conclusión

v3.1 Advanced es una actualización significativa que te da control total sobre el algoritmo de clasificación, manteniendo 100% de compatibilidad con la versión anterior.

**Beneficios principales:**
1. ✅ Control granular (23 parámetros)
2. ✅ Adaptación a tu estrategia
3. ✅ Mejor performance potencial
4. ✅ Preparado para futuras APIs
5. ✅ Entrenamiento más efectivo

**Próximo paso:**
Deploy y experimenta con diferentes configuraciones para tu caso de uso específico.

¡Disfruta del upgrade! 🚀
