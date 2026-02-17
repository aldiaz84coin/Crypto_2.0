// cycles-manager.js - Gestión de Ciclos con duración variable (CORREGIDO)

/**
 * Crear un nuevo ciclo de predicción
 * @param {Object} redis
 * @param {Array}  snapshot - activos con datos completos
 * @param {Object} config   - configuración del algoritmo
 * @param {number} durationMs - duración en ms (default 12h)
 */
async function createCycle(redis, snapshot, config, durationMs) {
  if (!redis) throw new Error('Redis no disponible');

  // Limpiar snapshot: solo guardar campos esenciales para no saturar Redis
  const cleanSnapshot = snapshot.map(a => ({
    id:                       a.id,
    symbol:                   a.symbol,
    name:                     a.name,
    current_price:            a.current_price,
    market_cap:               a.market_cap,
    total_volume:             a.total_volume,
    price_change_percentage_24h: a.price_change_percentage_24h,
    ath:                      a.ath,
    atl:                      a.atl,
    boostPower:               a.boostPower,
    boostPowerPercent:        a.boostPowerPercent,
    classification:           a.classification,
    predictedChange:          a.predictedChange
  }));

  const cycleId   = `cycle_${Date.now()}`;
  const startTime = Date.now();
  const endTime   = startTime + (durationMs || 12 * 60 * 60 * 1000);

  const cycle = {
    id: cycleId,
    startTime,
    endTime,
    durationMs: durationMs || 12 * 60 * 60 * 1000,
    status:      'active',
    snapshot:    cleanSnapshot,
    config:      { version: config.version, boostPowerThreshold: config.boostPowerThreshold },
    results:     null,
    metrics:     null,
    completedAt: null,
    // Para seguimiento de selección manual de resultados
    excludedResults: []
  };

  await redis.set(cycleId, JSON.stringify(cycle));

  const activeCycles = await getActiveCycles(redis);
  activeCycles.push(cycleId);
  await redis.set('active_cycles', JSON.stringify(activeCycles));

  return cycle;
}

/**
 * Obtener ciclos activos
 */
async function getActiveCycles(redis) {
  if (!redis) return [];
  
  try {
    const stored = await redis.get('active_cycles');
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

/**
 * Obtener un ciclo por ID
 */
async function getCycle(redis, cycleId) {
  if (!redis) return null;
  
  try {
    const stored = await redis.get(cycleId);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Detectar ciclos pendientes que ya cumplieron 12h
 */
async function detectPendingCycles(redis) {
  if (!redis) return [];
  
  const activeCycles = await getActiveCycles(redis);
  const now = Date.now();
  const pending = [];
  
  for (const cycleId of activeCycles) {
    const cycle = await getCycle(redis, cycleId);
    if (cycle && cycle.status === 'active' && now >= cycle.endTime) {
      pending.push(cycle);
    }
  }
  
  return pending;
}

/**
 * Completar un ciclo con resultados
 */
async function completeCycle(redis, cycleId, currentPrices) {
  if (!redis) {
    throw new Error('Redis no disponible');
  }
  
  const cycle = await getCycle(redis, cycleId);
  if (!cycle) {
    throw new Error('Ciclo no encontrado');
  }
  
  // Calcular resultados
  const results = [];
  let correct = 0;
  
  for (const asset of cycle.snapshot) {
    const current = currentPrices.find(c => c.id === asset.id);
    
    if (current) {
      const actualChange = ((current.current_price - asset.current_price) / asset.current_price) * 100;
      const predictedChange = asset.predictedChange || 0;
      
      // Validar predicción
      const sameDirection = (predictedChange >= 0 && actualChange >= 0) || 
                           (predictedChange < 0 && actualChange < 0);
      const magnitudeSimilar = Math.abs(predictedChange - actualChange) < 15;
      const isCorrect = sameDirection && magnitudeSimilar;
      
      if (isCorrect) correct++;
      
      results.push({
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        snapshotPrice: asset.current_price,
        currentPrice: current.current_price,
        predictedChange: predictedChange.toFixed(2),
        actualChange: actualChange.toFixed(2),
        classification: asset.classification,
        boostPower: asset.boostPower,
        correct: isCorrect,
        error: Math.abs(predictedChange - actualChange).toFixed(2)
      });
    }
  }
  
  // Calcular métricas
  const metrics = {
    total: results.length,
    correct,
    successRate: results.length > 0 ? (correct / results.length * 100).toFixed(2) : 0,
    
    // Por categoría
    invertible: calculateCategoryMetrics(results, 'INVERTIBLE'),
    apalancado: calculateCategoryMetrics(results, 'APALANCADO'),
    ruidoso: calculateCategoryMetrics(results, 'RUIDOSO'),
    
    // Errores
    avgError: calculateAvgError(results),
    maxError: calculateMaxError(results)
  };
  
  // Actualizar ciclo
  cycle.status = 'completed';
  cycle.results = results;
  cycle.metrics = metrics;
  cycle.completedAt = Date.now();
  
  await redis.set(cycleId, JSON.stringify(cycle));
  
  // Remover de activos
  let activeCycles = await getActiveCycles(redis);
  activeCycles = activeCycles.filter(id => id !== cycleId);
  await redis.set('active_cycles', JSON.stringify(activeCycles));
  
  // Añadir a historial
  const history = await getCompletedCycles(redis);
  history.unshift(cycleId);
  await redis.set('completed_cycles', JSON.stringify(history.slice(0, 50))); // Max 50
  
  return cycle;
}

/**
 * Calcular métricas por categoría
 */
function calculateCategoryMetrics(results, category) {
  const filtered = results.filter(r => r.classification === category);
  if (filtered.length === 0) return { total: 0, correct: 0, successRate: 0 };
  
  const correct = filtered.filter(r => r.correct).length;
  return {
    total: filtered.length,
    correct,
    successRate: (correct / filtered.length * 100).toFixed(2)
  };
}

/**
 * Calcular error promedio
 */
function calculateAvgError(results) {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + parseFloat(r.error), 0);
  return (sum / results.length).toFixed(2);
}

/**
 * Calcular error máximo
 */
function calculateMaxError(results) {
  if (results.length === 0) return 0;
  return Math.max(...results.map(r => parseFloat(r.error))).toFixed(2);
}

/**
 * Obtener historial de ciclos completados
 */
async function getCompletedCycles(redis) {
  if (!redis) return [];
  
  try {
    const stored = await redis.get('completed_cycles');
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

/**
 * Obtener detalles de múltiples ciclos
 */
async function getCyclesDetails(redis, cycleIds) {
  const cycles = [];
  
  for (const cycleId of cycleIds) {
    const cycle = await getCycle(redis, cycleId);
    if (cycle) {
      cycles.push(cycle);
    }
  }
  
  return cycles;
}

/**
 * Calcular estadísticas globales
 */
async function getGlobalStats(redis) {
  const completedIds = await getCompletedCycles(redis);
  const cycles = await getCyclesDetails(redis, completedIds);
  
  if (cycles.length === 0) {
    return {
      totalCycles: 0,
      totalPredictions: 0,
      avgSuccessRate: 0,
      bestCycle: null,
      worstCycle: null
    };
  }
  
  const totalPredictions = cycles.reduce((sum, c) => sum + (c.metrics?.total || 0), 0);
  const successRates = cycles.map(c => parseFloat(c.metrics?.successRate || 0));
  const avgSuccessRate = (successRates.reduce((sum, r) => sum + r, 0) / successRates.length).toFixed(2);
  
  const sorted = [...cycles].sort((a, b) => 
    parseFloat(b.metrics?.successRate || 0) - parseFloat(a.metrics?.successRate || 0)
  );
  
  return {
    totalCycles: cycles.length,
    totalPredictions,
    avgSuccessRate,
    bestCycle: sorted[0] ? {
      id: sorted[0].id,
      successRate: sorted[0].metrics.successRate,
      date: new Date(sorted[0].completedAt).toLocaleDateString()
    } : null,
    worstCycle: sorted[sorted.length - 1] ? {
      id: sorted[sorted.length - 1].id,
      successRate: sorted[sorted.length - 1].metrics.successRate,
      date: new Date(sorted[sorted.length - 1].completedAt).toLocaleDateString()
    } : null
  };
}

/**
 * Recalcular métricas con un subconjunto de resultados (excluidos fuera)
 */
function recalculateMetrics(results) {
  if (!results || results.length === 0) {
    return { total: 0, correct: 0, successRate: '0.00', avgError: '0.00', maxError: '0.00', invertible: { total: 0, correct: 0, successRate: '0.00' }, apalancado: { total: 0, correct: 0, successRate: '0.00' }, ruidoso: { total: 0, correct: 0, successRate: '0.00' } };
  }
  const correct = results.filter(r => r.correct).length;
  return {
    total: results.length,
    correct,
    successRate: (correct / results.length * 100).toFixed(2),
    invertible: calculateCategoryMetrics(results, 'INVERTIBLE'),
    apalancado: calculateCategoryMetrics(results, 'APALANCADO'),
    ruidoso: calculateCategoryMetrics(results, 'RUIDOSO'),
    avgError: calculateAvgError(results),
    maxError: calculateMaxError(results)
  };
}

module.exports = {
  createCycle,
  getActiveCycles,
  getCycle,
  detectPendingCycles,
  completeCycle,
  getCompletedCycles,
  getCyclesDetails,
  getGlobalStats,
  recalculateMetrics
};
