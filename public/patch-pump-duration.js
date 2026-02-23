// public/patch-pump-duration.js
// Patch: Selector de duración en compra desde Pump Detector
//         + Visualización de iteraciones en ciclo activo
//         + Auto-runner de iteraciones pendientes
//
// INTEGRAR: añadir <script src="/patch-pump-duration.js"></script>
// en public/index.html, justo ANTES del cierre </body>
'use strict';

console.log('[PATCH] pump-duration + iteration-view ✅');

// ═══════════════════════════════════════════════════════════════════════════
// 1. SELECTOR DE DURACIÓN EN PUMP BUY MODAL
//    Intercepta renderPumpBuyModalBody (o openPumpBuyModal) para
//    inyectar un selector de duración del ciclo de compraventa.
// ═══════════════════════════════════════════════════════════════════════════

const CYCLE_DURATION_OPTIONS = [
  { label: '30 min',  ms: 1800000,   desc: 'Scalping rápido' },
  { label: '1 hora',  ms: 3600000,   desc: 'Corto plazo' },
  { label: '2 horas', ms: 7200000,   desc: 'Intradía corto' },
  { label: '4 horas', ms: 14400000,  desc: 'Intradía medio' },
  { label: '6 horas', ms: 21600000,  desc: 'Intradía largo' },
  { label: '12 horas', ms: 43200000, desc: 'Estándar ⭐' },
  { label: '24 horas', ms: 86400000, desc: 'Swing corto' },
  { label: '48 horas', ms: 172800000, desc: 'Swing medio' },
  { label: '72 horas', ms: 259200000, desc: 'Swing largo' },
];

const DEFAULT_CYCLE_DURATION_MS = 43200000; // 12h

// Variable para almacenar la duración seleccionada en el modal
window._selectedCycleDurationMs = DEFAULT_CYCLE_DURATION_MS;

/** Genera el HTML del selector de duración */
function buildDurationSelectorHTML(selectedMs = DEFAULT_CYCLE_DURATION_MS) {
  const options = CYCLE_DURATION_OPTIONS.map(opt => `
    <option value="${opt.ms}" ${opt.ms === selectedMs ? 'selected' : ''}>
      ${opt.label} — ${opt.desc}
    </option>
  `).join('');

  return `
    <div class="mt-4 border-t border-gray-700 pt-4">
      <label class="block text-sm font-semibold text-gray-300 mb-2">
        ⏱ Duración del ciclo de compraventa
      </label>
      <select
        id="pump-buy-cycle-duration"
        onchange="window._selectedCycleDurationMs = parseInt(this.value)"
        class="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
      >
        ${options}
      </select>
      <p class="text-xs text-gray-500 mt-1" id="pump-buy-duration-info">
        El algoritmo evaluará la posición cada hora dentro de este periodo.
      </p>
    </div>
  `;
}

/** Actualiza el texto descriptivo del selector */
function updateDurationInfo() {
  const sel  = document.getElementById('pump-buy-cycle-duration');
  const info = document.getElementById('pump-buy-duration-info');
  if (!sel || !info) return;
  const ms  = parseInt(sel.value);
  const opt = CYCLE_DURATION_OPTIONS.find(o => o.ms === ms);
  if (!opt) return;
  // Calcular iteraciones aproximadas
  const intervals = {
    1800000: 300000, 3600000: 600000, 7200000: 900000,
    14400000: 1800000, 21600000: 3600000, 43200000: 3600000,
    86400000: 7200000, 172800000: 14400000, 259200000: 21600000
  };
  const interval = intervals[ms] || 3600000;
  const nIter    = Math.round(ms / interval);
  info.textContent = `Se ejecutarán ~${nIter} iteraciones de evaluación. Stop Loss / Take Profit se comprueban en cada una.`;
}

// Interceptar la función de confirmación de compra para incluir cycleDurationMs
const _origConfirmPumpBuy = window.confirmPumpBuy;
window.confirmPumpBuy = async function(...args) {
  // Leer duración seleccionada del selector del modal
  const sel = document.getElementById('pump-buy-cycle-duration');
  if (sel) window._selectedCycleDurationMs = parseInt(sel.value);
  if (_origConfirmPumpBuy) return _origConfirmPumpBuy(...args);
};

// Interceptar openPumpBuyModal para inyectar el selector de duración
const _origOpenPumpBuyModal = window.openPumpBuyModal;
window.openPumpBuyModal = async function(assetId, symbol, price, preloadedAsset) {
  window._selectedCycleDurationMs = DEFAULT_CYCLE_DURATION_MS;
  if (_origOpenPumpBuyModal) await _origOpenPumpBuyModal(assetId, symbol, price, preloadedAsset);

  // Inyectar selector DESPUÉS de que el modal se haya renderizado
  requestAnimationFrame(() => {
    const body = document.getElementById('pump-buy-modal-body');
    if (!body) return;

    // Verificar si ya está el selector (evitar duplicados)
    if (body.querySelector('#pump-buy-cycle-duration')) return;

    // Inyectar el selector al final del contenido del modal
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildDurationSelectorHTML(DEFAULT_CYCLE_DURATION_MS);
    body.appendChild(wrapper.firstElementChild);

    // Añadir evento de cambio
    const sel = document.getElementById('pump-buy-cycle-duration');
    if (sel) sel.addEventListener('change', updateDurationInfo);
  });
};

// Interceptar la función de fetch de buy-manual para incluir cycleDurationMs
// Buscamos el fetch a /api/invest/buy-manual en la función existente
const _origFetch = window.fetch;
window.fetch = function(url, options, ...rest) {
  if (typeof url === 'string' && url.includes('/api/invest/buy-manual') && options?.method === 'POST') {
    try {
      const body = JSON.parse(options.body || '{}');
      body.cycleDurationMs = window._selectedCycleDurationMs || DEFAULT_CYCLE_DURATION_MS;
      options = { ...options, body: JSON.stringify(body) };
    } catch (_) {}
  }
  return _origFetch.call(this, url, options, ...rest);
};


// ═══════════════════════════════════════════════════════════════════════════
// 2. VISUALIZACIÓN DE ITERACIONES EN CICLOS ACTIVOS
//    Añade un botón "Ver Iteraciones" en las cards de ciclos activos y
//    un modal para mostrar el timeline de iteraciones.
// ═══════════════════════════════════════════════════════════════════════════

/** Formatea un timestamp como hora:minuto */
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

/** Formatea duración en ms a texto legible */
function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m > 0 ? m + 'm' : ''}`.trim();
  return `${m}m`;
}

/** Construye el HTML del modal de iteraciones */
function buildIterationsModalHTML(data) {
  const { cycleId, totalScheduled, completedCount, pendingCount, nextIterationAt, iterations, pending } = data;

  const completedRows = (iterations || []).map(iter => {
    const staleTag  = iter.staleCount > 0
      ? `<span class="text-yellow-400 text-xs ml-1">⚠️ ${iter.staleCount} stale</span>` : '';
    const failTag   = iter.failedCount > 0
      ? `<span class="text-red-400 text-xs ml-1">❌ ${iter.failedCount} sin precio</span>` : '';
    const sourceTag = `<span class="text-xs text-gray-500">[${iter.fetchStats?.source || '?'}]</span>`;

    const sellDecisions = Object.entries(iter.decisions || {})
      .filter(([, d]) => d.action === 'sell')
      .map(([id, d]) => `<div class="text-red-400 text-xs">🔴 ${id.toUpperCase()}: ${d.reason}</div>`)
      .join('');

    return `
      <div class="bg-gray-800 rounded-lg p-3 border border-gray-700">
        <div class="flex justify-between items-start mb-1">
          <span class="text-emerald-400 font-semibold text-sm">Iter. ${iter.iterationNumber}</span>
          <span class="text-gray-400 text-xs">${fmtTime(iter.timestamp)}</span>
        </div>
        <div class="flex flex-wrap gap-1 items-center text-xs mb-1">
          ${sourceTag}
          <span class="text-gray-300">${iter.fetchedCount || 0}/${iter.assetsCount || 0} activos</span>
          ${staleTag}${failTag}
        </div>
        ${sellDecisions ? `<div class="mt-1">${sellDecisions}</div>` : ''}
      </div>
    `;
  }).join('');

  const pendingRows = (pending || []).slice(0, 5).map(p => `
    <div class="bg-gray-900 rounded-lg p-3 border border-dashed border-gray-700 opacity-70">
      <div class="flex justify-between items-center">
        <span class="text-gray-400 text-sm">Iter. ${p.iterationNumber}</span>
        <span class="text-xs ${p.status === 'due' ? 'text-yellow-400 font-semibold' : 'text-gray-500'}">
          ${p.status === 'due' ? '⏰ Pendiente ahora' : fmtTime(p.scheduledTime)}
        </span>
      </div>
    </div>
  `).join('');

  const pendingMore = pendingCount > 5
    ? `<p class="text-xs text-gray-500 text-center mt-1">... y ${pendingCount - 5} más</p>` : '';

  return `
    <div class="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex justify-between items-center rounded-t-2xl z-10">
      <h3 class="text-lg font-bold text-emerald-400">📊 Iteraciones del Ciclo</h3>
      <button onclick="closeIterationsModal()" class="text-gray-500 hover:text-white text-2xl leading-none">×</button>
    </div>
    <div class="p-6">
      <!-- Resumen -->
      <div class="grid grid-cols-3 gap-3 mb-5">
        <div class="bg-gray-800 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold text-emerald-400">${completedCount}</div>
          <div class="text-xs text-gray-400">Completadas</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold text-yellow-400">${pendingCount}</div>
          <div class="text-xs text-gray-400">Pendientes</div>
        </div>
        <div class="bg-gray-800 rounded-lg p-3 text-center">
          <div class="text-2xl font-bold text-gray-300">${totalScheduled}</div>
          <div class="text-xs text-gray-400">Total planif.</div>
        </div>
      </div>

      ${nextIterationAt ? `
        <div class="bg-yellow-900/30 border border-yellow-700 rounded-lg p-3 mb-4 text-sm text-yellow-300">
          ⏰ Próxima iteración: <strong>${fmtTime(nextIterationAt)}</strong>
          ${nextIterationAt <= Date.now() ? ' — <span class="text-yellow-200 font-bold">Pendiente ahora</span>' : ''}
        </div>
      ` : ''}

      <!-- Botón de iteración manual -->
      <button onclick="runManualIteration('${cycleId}')"
        class="w-full bg-emerald-700 hover:bg-emerald-600 text-white py-2 px-4 rounded-lg text-sm font-semibold mb-5">
        ▶ Ejecutar iteración ahora
      </button>

      <!-- Completadas -->
      ${completedRows ? `
        <h4 class="text-sm font-semibold text-gray-300 mb-2">✅ Iteraciones completadas</h4>
        <div class="space-y-2 mb-4">${completedRows}</div>
      ` : '<p class="text-gray-500 text-sm mb-4">Aún no hay iteraciones ejecutadas.</p>'}

      <!-- Pendientes -->
      ${pendingRows ? `
        <h4 class="text-sm font-semibold text-gray-400 mb-2">🕐 Próximas iteraciones</h4>
        <div class="space-y-2">${pendingRows}</div>
        ${pendingMore}
      ` : ''}
    </div>
  `;
}

/** Abre el modal de iteraciones para un ciclo */
window.openIterationsModal = async function(cycleId) {
  let modal = document.getElementById('modal-iterations');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-iterations';
    modal.className = 'hidden fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto';
    modal.innerHTML = `
      <div class="bg-gray-900 rounded-2xl w-full max-w-2xl shadow-2xl my-8" id="modal-iterations-inner">
        <div class="p-6 text-center text-gray-400">⏳ Cargando iteraciones...</div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');

  try {
    const r = await fetch(`/api/cycles/${cycleId}/iterations`);
    const d = await r.json();
    if (!d.success) throw new Error(d.error);

    document.getElementById('modal-iterations-inner').innerHTML = buildIterationsModalHTML(d);
  } catch (e) {
    document.getElementById('modal-iterations-inner').innerHTML = `
      <div class="p-6 text-red-400 text-center">❌ Error: ${e.message}</div>
    `;
  }
};

window.closeIterationsModal = function() {
  const modal = document.getElementById('modal-iterations');
  if (modal) modal.classList.add('hidden');
};

/** Ejecuta una iteración manual para un ciclo */
window.runManualIteration = async function(cycleId) {
  const btn = document.querySelector('#modal-iterations-inner button[onclick*="runManualIteration"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ejecutando...'; }

  try {
    const r = await fetch(`/api/cycles/${cycleId}/iterate`, { method: 'POST' });
    const d = await r.json();

    if (d.success) {
      const sells = d.sellResults?.length ? ` | ${d.sellsExecuted} ventas ejecutadas` : '';
      alert(`✅ Iteración ${d.iterationNumber}/${d.totalIterations} completada.\n` +
            `Activos obtenidos: ${d.fetchedCount}/${d.assetsCount} | Fuente: ${d.priceSource}` +
            sells);
      // Recargar el modal
      await openIterationsModal(cycleId);
    } else {
      alert(`❌ ${d.error}`);
      if (btn) { btn.disabled = false; btn.textContent = '▶ Ejecutar iteración ahora'; }
    }
  } catch (e) {
    alert(`❌ ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '▶ Ejecutar iteración ahora'; }
  }
};


// ═══════════════════════════════════════════════════════════════════════════
// 3. PATCH: Añade botón "Iteraciones" a las cards de ciclos activos
//    Se ejecuta después de que loadValidation / loadActiveCycles rendericen
//    las cards.
// ═══════════════════════════════════════════════════════════════════════════

function injectIterationButtons() {
  const activeCyclesDiv = document.getElementById('active-cycles');
  if (!activeCyclesDiv) return;

  activeCyclesDiv.querySelectorAll('[data-cycle-id]').forEach(card => {
    if (card.querySelector('.btn-iterations')) return;
    const cycleId = card.dataset.cycleId;
    const btn = document.createElement('button');
    btn.className = 'btn-iterations bg-emerald-900 hover:bg-emerald-800 text-emerald-300 text-xs px-3 py-1.5 rounded-lg font-semibold mt-2';
    btn.innerHTML = '📊 Ver iteraciones';
    btn.onclick = () => openIterationsModal(cycleId);
    card.appendChild(btn);
  });
}

// Observar cambios en active-cycles para inyectar botones dinámicamente
const _observeActiveCycles = new MutationObserver(() => injectIterationButtons());
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('active-cycles');
  if (container) _observeActiveCycles.observe(container, { childList: true, subtree: true });
  injectIterationButtons();
});


// ═══════════════════════════════════════════════════════════════════════════
// 4. WATCHDOG DE STOP-LOSS / TAKE-PROFIT — cada 30 minutos
//    Comprueba TODAS las posiciones abiertas contra sus precios de TP/SL
//    almacenados en el momento de la apertura. Si se superan → vende.
//    Se ejecuta en background independientemente de la pestaña activa.
// ═══════════════════════════════════════════════════════════════════════════

let _watchdogInterval = null;
let _watchdogLastRun  = null;

async function runWatchdog() {
  try {
    const r = await fetch('/api/invest/watchdog', { method: 'POST' });
    const d = await r.json();
    _watchdogLastRun = new Date().toISOString();

    if (d.success) {
      if (d.sells > 0) {
        console.log(`[watchdog] ✅ ${d.sells} posición(es) cerrada(s):`,
          d.actions.filter(a => a.sold).map(a => `${a.symbol} ${a.pnlPct > 0 ? '+' : ''}${a.pnlPct?.toFixed?.(2) ?? '?'}%`).join(', ')
        );
        // Notificación visible si hay ventas
        const sells = d.actions.filter(a => a.sold);
        sells.forEach(s => {
          const emoji = s.pnlPct >= 0 ? '🟢' : '🔴';
          const type  = s.closeReason?.includes('stop') ? 'Stop Loss' : 'Take Profit';
          console.warn(`[watchdog] ${emoji} ${type}: ${s.symbol} ${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct?.toFixed?.(2) ?? '?'}% — Precio: $${s.currentPrice}`);
        });
        // Refrescar vista de posiciones si está visible
        if (typeof loadInvestPositions === 'function') loadInvestPositions().catch(() => {});
      } else {
        console.log(`[watchdog] 👁 ${d.checked} pos. revisadas · fuente: ${d.priceSource} · sin ventas`);
      }
    }
  } catch (e) {
    console.warn('[watchdog] Error:', e.message);
  }
}

function startWatchdog() {
  if (_watchdogInterval) return;
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
  _watchdogInterval = setInterval(runWatchdog, INTERVAL_MS);
  console.log('[watchdog] 🔔 Iniciado (cada 30 min). Primera comprobación en 10s...');
  setTimeout(runWatchdog, 10000); // primera ejecución a los 10s
}

// Indicador visual del watchdog en la UI
function injectWatchdogStatus() {
  // Buscar sección de inversión para añadir badge de estado
  const investSection = document.getElementById('content-invest') ||
                        document.querySelector('[data-tab="invest"]');
  if (!investSection || investSection.querySelector('.watchdog-badge')) return;

  const badge = document.createElement('div');
  badge.className = 'watchdog-badge fixed bottom-4 right-4 z-40 bg-gray-900 border border-emerald-700 rounded-xl px-3 py-2 text-xs text-emerald-400 shadow-lg cursor-pointer';
  badge.title = 'Watchdog SL/TP activo';
  badge.innerHTML = '🔔 Watchdog activo';
  badge.onclick = () => runWatchdog().then(() => {
    badge.innerHTML = '✅ Comprobado';
    setTimeout(() => { badge.innerHTML = '🔔 Watchdog activo'; }, 3000);
  });

  // Actualizar timestamp del último run
  setInterval(() => {
    if (_watchdogLastRun) {
      const mins = Math.round((Date.now() - new Date(_watchdogLastRun).getTime()) / 60000);
      badge.innerHTML = `🔔 SL/TP · hace ${mins}m`;
    }
  }, 60000);

  document.body.appendChild(badge);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. AUTO-RUNNER DE ITERACIONES — cada 5 minutos
//    Ejecuta iteraciones pendientes de ciclos activos.
// ═══════════════════════════════════════════════════════════════════════════

let _iterationRunnerInterval = null;

async function runPendingIterationsBackground() {
  try {
    const r = await fetch('/api/cycles/run-pending-iterations', { method: 'POST' });
    const d = await r.json();
    if (d.success && d.count > 0) {
      console.log(`[iter-runner] ${d.count} iteraciones ejecutadas:`, d.processed);
      const hasLastIter = d.processed.some(p => p.isLastIteration);
      if (hasLastIter && typeof loadValidation === 'function') await loadValidation();
    }
  } catch (e) {
    console.warn('[iter-runner] Error en background runner:', e.message);
  }
}

function startIterationRunner() {
  if (_iterationRunnerInterval) return;
  _iterationRunnerInterval = setInterval(runPendingIterationsBackground, 5 * 60 * 1000);
  console.log('[iter-runner] Auto-runner iniciado (cada 5 min)');
  setTimeout(runPendingIterationsBackground, 3000);
}

// Sobreescribir setTab para inyectar botones de iteraciones al entrar en Validación
const _origSetTabForIter = window.setTab;
window.setTab = function(tab) {
  if (_origSetTabForIter) _origSetTabForIter(tab);
  if (tab === 'validation') {
    startIterationRunner();
    setTimeout(injectIterationButtons, 800);
  }
};

// Arrancar todo al cargar
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    startWatchdog();
    startIterationRunner();
    injectWatchdogStatus();
  }, 5000);
});

