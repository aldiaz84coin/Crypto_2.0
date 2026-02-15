// kv-helpers.js - Helpers para Vercel KV (Base de Datos)
// Instalación requerida: npm install @vercel/kv

const { kv } = require('@vercel/kv');

// ============================================
// CYCLES - Gestión de Ciclos
// ============================================

/**
 * Crear un nuevo ciclo
 */
async function createCycle(cycleData) {
  const cycleId = `cycle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const cycle = {
    id: cycleId,
    startTime: Date.now(),
    endTime: Date.now() + (12 * 60 * 60 * 1000), // 12 horas
    status: 'pending',
    emailSent: false,
    ...cycleData
  };

  // Guardar el ciclo
  await kv.set(`cycles:${cycleId}`, cycle);
  
  // Añadir a la lista de ciclos activos
  await kv.sadd('cycles:active', cycleId);
  
  // Añadir al historial
  await kv.zadd('cycles:history', {
    score: cycle.startTime,
    member: cycleId
  });

  return cycle;
}

/**
 * Obtener un ciclo por ID
 */
async function getCycle(cycleId) {
  return await kv.get(`cycles:${cycleId}`);
}

/**
 * Actualizar un ciclo
 */
async function updateCycle(cycleId, updates) {
  const cycle = await getCycle(cycleId);
  if (!cycle) return null;

  const updated = { ...cycle, ...updates };
  await kv.set(`cycles:${cycleId}`, updated);
  
  return updated;
}

/**
 * Completar un ciclo
 */
async function completeCycle(cycleId, results) {
  const cycle = await getCycle(cycleId);
  if (!cycle) return null;

  const completed = {
    ...cycle,
    status: 'completed',
    completedAt: Date.now(),
    results,
    emailSent: false
  };

  await kv.set(`cycles:${cycleId}`, completed);
  
  // Remover de activos
  await kv.srem('cycles:active', cycleId);

  return completed;
}

/**
 * Marcar email como enviado
 */
async function markEmailSent(cycleId) {
  return await updateCycle(cycleId, { emailSent: true });
}

/**
 * Obtener ciclos activos
 */
async function getActiveCycles() {
  const cycleIds = await kv.smembers('cycles:active');
  if (!cycleIds || cycleIds.length === 0) return [];

  const cycles = await Promise.all(
    cycleIds.map(id => getCycle(id))
  );

  return cycles.filter(c => c !== null);
}

/**
 * Obtener ciclos pendientes (pasaron 12h pero no completados)
 */
async function getPendingCycles() {
  const activeCycles = await getActiveCycles();
  const now = Date.now();

  return activeCycles.filter(cycle => 
    cycle.status === 'pending' && 
    now >= cycle.endTime
  );
}

/**
 * Obtener histórico de ciclos
 */
async function getCycleHistory(limit = 20) {
  // Obtener IDs ordenados por timestamp (más recientes primero)
  const cycleIds = await kv.zrange('cycles:history', -limit, -1, { rev: true });
  
  if (!cycleIds || cycleIds.length === 0) return [];

  const cycles = await Promise.all(
    cycleIds.map(id => getCycle(id))
  );

  return cycles.filter(c => c !== null);
}

/**
 * Obtener ciclos completados para entrenamiento
 */
async function getCompletedCycles(limit = 20) {
  const history = await getCycleHistory(limit * 2); // Obtener más para filtrar
  
  return history
    .filter(cycle => cycle.status === 'completed' && cycle.results)
    .slice(0, limit);
}

/**
 * Eliminar un ciclo (cancelar)
 */
async function deleteCycle(cycleId) {
  await kv.del(`cycles:${cycleId}`);
  await kv.srem('cycles:active', cycleId);
  await kv.zrem('cycles:history', cycleId);
}

/**
 * Limpiar ciclos antiguos (más de 30 días)
 */
async function cleanOldCycles() {
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  
  // Obtener todos los ciclos del historial
  const allCycleIds = await kv.zrange('cycles:history', 0, -1);
  
  let cleaned = 0;
  for (const cycleId of allCycleIds) {
    const cycle = await getCycle(cycleId);
    if (cycle && cycle.startTime < thirtyDaysAgo) {
      await deleteCycle(cycleId);
      cleaned++;
    }
  }

  return cleaned;
}

// ============================================
// STATS - Estadísticas
// ============================================

/**
 * Obtener estadísticas generales
 */
async function getStats() {
  const activeCycles = await getActiveCycles();
  const completedCycles = await getCompletedCycles(100);

  const totalCycles = completedCycles.length;
  const totalPredictions = completedCycles.reduce((sum, cycle) => 
    sum + (cycle.results?.length || 0), 0
  );
  const correctPredictions = completedCycles.reduce((sum, cycle) => 
    sum + (cycle.results?.filter(r => r.correct).length || 0), 0
  );

  const successRate = totalPredictions > 0 
    ? (correctPredictions / totalPredictions) * 100 
    : 0;

  return {
    activeCycles: activeCycles.length,
    completedCycles: totalCycles,
    totalPredictions,
    correctPredictions,
    successRate: successRate.toFixed(2)
  };
}

module.exports = {
  createCycle,
  getCycle,
  updateCycle,
  completeCycle,
  markEmailSent,
  getActiveCycles,
  getPendingCycles,
  getCycleHistory,
  getCompletedCycles,
  deleteCycle,
  cleanOldCycles,
  getStats
};
