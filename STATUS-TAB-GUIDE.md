# 🔌 Guía de la Pestaña de Estado de APIs

## 📊 Información General

La pestaña **Estado APIs** proporciona visibilidad completa sobre la conectividad y configuración de todas las fuentes de datos del sistema.

---

## ✨ Características

### **1. Verificación en Tiempo Real**
- ✅ Prueba la conectividad de cada API
- ✅ Mide tiempos de respuesta
- ✅ Detecta errores de configuración
- ✅ Valida API keys

### **2. Organización por Tiers**
Las APIs se muestran agrupadas por nivel:
- 🟢 **FREE:** Sin configuración necesaria
- 🟡 **FREEMIUM:** Requieren API key gratuita
- 🟠 **PAID:** Requieren suscripción de pago
- 🔴 **PREMIUM:** Servicios profesionales

### **3. Información Detallada por API**
Cada tarjeta muestra:
- Estado operacional (✅/❌/⚪)
- Mensaje de estado o error
- Tiempo de respuesta en ms
- Factores que proporciona
- Si está configurada o no
- Costo mensual (si aplica)
- Link para obtener API key

### **4. Resumen Global**
Dashboard con 4 métricas:
- **Total APIs:** 13 integradas
- **Operacionales:** Funcionando correctamente
- **Configuradas:** Con API key añadida
- **Con Errores:** Requieren atención

---

## 🎯 Estados Posibles

| Estado | Icono | Color | Significado |
|--------|-------|-------|-------------|
| **operational** | ✅ | Verde | Funcionando correctamente |
| **error** | ❌ | Rojo | Error de conexión o API key |
| **not_configured** | ⚪ | Gris | API key no configurada |
| **limited** | ⚠️ | Amarillo | Funciona con limitaciones |
| **checking** | 🔄 | Azul | Verificando estado... |
| **unknown** | ❓ | Gris | Estado desconocido |

---

## 📋 Ejemplo de Visualización

### **Tier FREE (Sin configuración)**
```
✅ CoinGecko
   ├─ Volume 24h, Market Cap, Volatilidad, ATL
   ├─ ✓ Configurada
   └─ OK (245ms)

✅ Alternative.me
   ├─ Fear & Greed Index
   ├─ ✓ Configurada
   ├─ OK (189ms)
   └─ FGI: 35 (Fear)

✅ Reddit
   ├─ Reddit Sentiment
   ├─ ✓ Configurada
   └─ OK (512ms)

✅ Blockchain.info
   ├─ Transacciones BTC
   ├─ ✓ Configurada
   ├─ OK (301ms)
   └─ 342,581 tx/24h
```

### **Tier FREEMIUM (Con API key)**
```
✅ CryptoCompare
   ├─ News Volume, News Sentiment
   ├─ ✓ Configurada
   └─ OK (423ms)

❌ NewsAPI
   ├─ Media Coverage, Breaking News
   ├─ ✓ Configurada
   └─ Rate limit excedido (100/día en free tier)

⚪ GitHub
   ├─ Developer Activity
   ├─ ○ No configurada
   ├─ Sin token (60 req/hora)
   └─ → Obtener API key
```

### **Tier PAID**
```
⚪ SerpAPI (Google Trends)
   ├─ Google Trends
   ├─ ○ No configurada
   ├─ $50/mes
   ├─ API key no configurada
   └─ → Obtener API key

⚪ Twitter API v2
   ├─ Twitter Sentiment
   ├─ ○ No configurada
   ├─ $100/mes
   ├─ Bearer token no configurado
   └─ → Obtener API key
```

### **Tier PREMIUM**
```
⚪ Glassnode
   ├─ Unique Addresses, Network Growth
   ├─ ○ No configurada
   ├─ $29-799/mes
   ├─ API key no configurada
   └─ → Obtener API key

⚪ CryptoQuant
   ├─ Exchange Net Flow
   ├─ ○ No configurada
   ├─ $49-899/mes
   └─ API key no configurada

⚪ Whale Alert
   ├─ Whale Activity
   ├─ ○ No configurada
   ├─ $49/mes
   └─ API key no configurada
```

---

## 🔧 Solución de Problemas

### **❌ "API key inválida"**
```
Problema: La API key configurada no es válida
Solución:
1. Verificar que la key fue copiada correctamente (sin espacios)
2. Verificar que no haya expirado
3. Regenerar la key en el dashboard del proveedor
4. Actualizar en Vercel Environment Variables
5. Redeploy
```

### **❌ "Rate limit excedido"**
```
Problema: Has alcanzado el límite de requests del tier gratuito
Soluciones:
a) Esperar 24 horas (para límites diarios)
b) Espaciar más los análisis
c) Upgrade al tier de pago
d) El sistema seguirá funcionando sin esa API
```

### **❌ "Timeout"**
```
Problema: La API no responde en 5 segundos
Causas posibles:
- API temporalmente lenta o down
- Problema de red
Solución:
- Esperar unos minutos y refrescar
- Si persiste, verificar status de la API en su website
```

### **⚪ "No configurada" pero la añadí**
```
Problema: Variable de entorno no se cargó
Solución:
1. Vercel → Settings → Environment Variables
2. Verificar nombre EXACTO (case-sensitive):
   - CRYPTOCOMPARE_API_KEY (no cryptocompare_api_key)
   - NEWSAPI_KEY (no newsapi_key)
3. Git push (forzar redeploy)
4. Esperar 2-3 minutos
5. Refrescar estado
```

---

## 💡 Interpretación del Dashboard

### **Escenario 1: Setup Básico**
```
Total: 13  |  Operacionales: 4  |  Configuradas: 4  |  Errores: 0

Interpretación:
✅ 4 APIs gratuitas funcionando (CoinGecko, Alternative, Reddit, Blockchain)
✅ 8 factores activos (42%)
✅ Suficiente para empezar
➡️  Siguiente paso: Añadir APIs freemium
```

### **Escenario 2: Freemium Configurado**
```
Total: 13  |  Operacionales: 7  |  Configuradas: 7  |  Errores: 0

Interpretación:
✅ 4 gratuitas + 3 freemium funcionando
✅ 12 factores activos (63%)
✅ Configuración óptima sin costo
➡️  Validar accuracy antes de pagar
```

### **Escenario 3: Setup Completo**
```
Total: 13  |  Operacionales: 9  |  Configuradas: 9  |  Errores: 0

Interpretación:
✅ Freemium + SerpAPI + Twitter
✅ 14 factores activos (74%)
✅ Alta precisión esperada
➡️  Monitorear ROI
```

### **Escenario 4: Error de Configuración**
```
Total: 13  |  Operacionales: 3  |  Configuradas: 7  |  Errores: 4

Interpretación:
⚠️  4 APIs configuradas pero con error
❌ Verificar API keys
❌ Revisar mensajes de error específicos
➡️  Corregir configuración
```

---

## 🔄 Actualización Automática

### **Cuándo se Actualiza:**
- Al abrir la pestaña "Estado APIs"
- Al hacer click en "🔄 Actualizar"
- Las verificaciones toman ~10-15 segundos

### **Qué se Verifica:**
- Conectividad de endpoint
- Validez de API key
- Rate limits actuales
- Tiempos de respuesta
- Valores actuales (cuando aplica)

---

## 📊 Métricas y Valores Actuales

Algunas APIs muestran valores en tiempo real:

### **Alternative.me:**
```
FGI: 35 (Fear)
↑ Valor actual del índice
```

### **Blockchain.info:**
```
342,581 tx/24h
↑ Transacciones Bitcoin en últimas 24h
```

### **GitHub (con token):**
```
OK (4,823/5,000 requests restantes)
↑ Rate limit disponible
```

### **SerpAPI (configurado):**
```
OK (4,547 búsquedas restantes)
↑ Créditos disponibles en el mes
```

---

## 🎯 Uso Recomendado

### **Al Desplegar por Primera Vez:**
1. ✅ Abrir pestaña "Estado APIs"
2. ✅ Verificar que 4 APIs gratuitas estén en verde
3. ✅ Si alguna está en rojo, investigar
4. ✅ Tomar decisión sobre APIs freemium

### **Al Configurar APIs Nuevas:**
1. ✅ Añadir API key en Vercel
2. ✅ Hacer redeploy
3. ✅ Abrir pestaña Estado
4. ✅ Click "Actualizar"
5. ✅ Verificar que cambie de ⚪ a ✅

### **Mantenimiento Regular:**
1. ✅ Revisar semanalmente
2. ✅ Verificar que no haya errores nuevos
3. ✅ Monitorear rate limits
4. ✅ Renovar APIs que expiren

### **Antes de Upgrade:**
1. ✅ Verificar accuracy actual (tab Validación)
2. ✅ Ver qué APIs faltan (tab Estado)
3. ✅ Priorizar según impacto esperado
4. ✅ Configurar y validar mejora

---

## 🆘 FAQ

### **¿Por qué algunas APIs muestran "unknown"?**
Algunas APIs no tienen endpoint público de verificación de estado. El sistema indica "unknown" pero pueden funcionar correctamente cuando se usen.

### **¿Las verificaciones consumen mi rate limit?**
Sí, minimamente. Cada verificación hace 1 request simple. Se recomienda no actualizar constantemente.

### **¿Puedo usar el sistema si algunas APIs están en rojo?**
Sí, absolutamente. El sistema usa solo las APIs disponibles. Más APIs = mejor precisión, pero funciona con lo que tengas.

### **¿Cuántas APIs necesito mínimo?**
4 gratuitas son suficientes para empezar (42% factores). Recomendamos 7 con freemium (63% factores).

### **¿Cómo sé qué APIs priorizar?**
1. Freemium primero (gratis, buen impacto)
2. SerpAPI si accuracy >65% (Google Trends importante)
3. Premium solo si ROI justifica el costo

---

## 📞 Links Útiles

- **Vercel Environment Variables:** Dashboard → Settings → Environment Variables
- **API Keys Management:** Ver API-GUIDE.md para links de cada proveedor
- **Troubleshooting:** README.md sección "Troubleshooting"

---

**¡La pestaña de Estado te da visibilidad completa sobre tu configuración!** 🔌
