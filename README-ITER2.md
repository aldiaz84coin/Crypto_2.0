# 🚀 Crypto Detector v3.1 - ITERACIÓN 2
## Sistema de Pesos Completo + Umbrales

---

## ✅ VALIDACIÓN PREVIA

✓ Iteración 1 funciona correctamente  
✓ Upstash Redis conectado  
✓ Configuración básica operativa

---

## ✨ NUEVAS FUNCIONALIDADES (Iteración 2)

### Backend:
1. ✅ **algorithm-config.js** (expandido)
   - 2 meta-pesos (cuanti/cuali)
   - 8 pesos de factores individuales
   - 6 umbrales básicos
   
2. ✅ **boost-power-calculator.js** (NUEVO)
   - Cálculo de BoostPower usando configuración
   - Clasificación automática (INVERTIBLE/APALANCADO/RUIDOSO)
   - Breakdown detallado por factor

3. ✅ **Endpoints actualizados:**
   - GET /api/crypto ahora calcula BoostPower real
   - GET /api/config/metadata - Info de factores
   - POST /api/config validación completa

### Frontend:
1. ✅ **Tab Configuración expandida**
   - Sliders para 2 meta-pesos
   - Sliders para 8 factores (divididos cuanti/cuali)
   - Inputs para 6 umbrales
   - Slider para umbral INVERTIBLE

2. ✅ **Tab Monitor mejorado**
   - Estadísticas por categoría
   - Cards con BoostPower calculado
   - Clasificación coloreada

---

## 📊 PARÁMETROS CONFIGURABLES (16 en total)

### Meta-Pesos (2):
| Parámetro | Rango | Default |
|-----------|-------|---------|
| Cuantitativo | 0-100% | 60% |
| Cualitativo | 0-100% | 40% |

### Pesos de Factores (8):
| Factor | Rango | Default |
|--------|-------|---------|
| Volume | 0-30% | 10% |
| Market Cap | 0-30% | 8% |
| Volatility | 0-30% | 7% |
| Historical Low | 0-30% | 5% |
| Google Trends | 0-30% | 10% |
| Fear & Greed | 0-30% | 2% |
| News Volume | 0-30% | 12% |
| News Count | 0-30% | 8% |

### Umbrales (6):
| Umbral | Rango | Default |
|--------|-------|---------|
| Volume Min | $1M-$1B | $100M |
| Volume Max | $1B-$100B | $10B |
| Volatility Min | 0-20% | 5% |
| Volatility Max | 20-100% | 50% |
| News Count Min | 1-10 | 3 |
| News Count Max | 50-500 | 100 |

---

## 🚀 INSTALACIÓN

```bash
# Extraer
tar -xzf crypto-detector-v3.1-ITER2.tar.gz
cd crypto-detector-v3.1-ITER2

# Instalar
npm install

# Deploy
git add .
git commit -m "Iteración 2: Pesos completos"
git push
```

**IMPORTANTE:** Upstash Redis debe estar configurado (de Iteración 1)

---

## ✅ VALIDACIÓN

### Backend:
```bash
# Test 1: Health
curl https://tu-app.vercel.app/api/health

# Test 2: Config (debe devolver 8 factores + 6 umbrales)
curl https://tu-app.vercel.app/api/config

# Test 3: Metadata
curl https://tu-app.vercel.app/api/config/metadata

# Test 4: Crypto (debe incluir boostPower)
curl https://tu-app.vercel.app/api/crypto
```

### Frontend:
1. ✅ Tab Monitor → Cargar Datos
2. ✅ Debe mostrar 4 stats (INVERTIBLES, APALANCADOS, RUIDOSOS, TOTAL)
3. ✅ Cada card debe mostrar BoostPower %
4. ✅ Cards con borde coloreado según clasificación

5. ✅ Tab Configuración → Ver 8 sliders de factores
6. ✅ Mover sliders → Cambiar valores
7. ✅ Guardar → Mensaje verde
8. ✅ Recargar → Valores persisten
9. ✅ Monitor → Cargar datos → BoostPower reflejan config

---

## 🎯 PRUEBA COMPLETA

### Escenario: Configuración Agresiva

1. Tab Configuración
2. Meta-peso Cuantitativo: 70%
3. Volume: 15%
4. Volatility: 12%
5. Google Trends: 15%
6. Guardar
7. Tab Monitor → Cargar Datos
8. Verificar que activos volátiles tienen mayor BoostPower

---

## 📁 ARCHIVOS NUEVOS/MODIFICADOS

### Nuevos:
- `api/algorithm-config.js` ⭐
- `api/boost-power-calculator.js` ⭐

### Modificados:
- `api/index.js` - Usa módulos nuevos
- `public/index.html` - UI expandida

### Sin cambios:
- `package.json`
- `vercel.json`

---

## 🔄 DIFERENCIAS vs Iteración 1

| Aspecto | Iteración 1 | Iteración 2 |
|---------|-------------|-------------|
| **Parámetros** | 3 | 16 |
| **Factores** | - | 8 individuales |
| **Umbrales** | 1 | 6 |
| **BoostPower** | No calculado | Calculado real |
| **Clasificación** | Manual | Automática |
| **Breakdown** | No | Por factor |

---

## 🆘 TROUBLESHOOTING

### Config no se guarda
**Error:** "Meta-pesos deben sumar 1.0"  
**Solución:** Ajustar sliders cuanti/cuali (automático en UI)

### BoostPower siempre 50%
**Causa:** Factores no implementados (Google Trends, News, etc.)  
**OK:** Normal por ahora. Factores usan score 0.5 (neutral)

### No aparecen INVERTIBLES
**Causa:** Umbral muy alto  
**Solución:** Bajar umbral INVERTIBLE a 30-35%

---

## 🎯 PRÓXIMA ITERACIÓN (Iteración 3)

En Iteración 3 añadiremos:
- ✨ Breakdown visible en cards (expandible)
- ✨ Entrenamiento básico del algoritmo
- ✨ Optimización de pesos

---

**Versión:** 3.1-iter2  
**Estado:** Lista para Deploy

¡Despliega y valida antes de continuar con Iteración 3!
