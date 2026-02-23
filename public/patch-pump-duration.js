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
// ═══════════════════════════════════════════════════════════════════════════

const _wd = {
  interval:   null,
  lastRunAt:  null,   // timestamp numérico del último run completado
  lastResult: null,   // último objeto de respuesta del backend
  nextRunAt:  null,   // timestamp del próximo run programado
  running:    false,
  INTERVAL_MS: 30 * 60 * 1000, // 30 min
};

// ── Widget ────────────────────────────────────────────────────────────────────

function _wdGetOrCreateWidget() {
  let w = document.getElementById('watchdog-widget');
  if (w) return w;

  w = document.createElement('div');
  w.id = 'watchdog-widget';
  // Posición: esquina inferior derecha, siempre visible
  w.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; z-index: 9999;
    background: #111827; border: 1px solid #065f46;
    border-radius: 12px; padding: 10px 14px;
    font-size: 11px; color: #6ee7b7;
    box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    cursor: pointer; min-width: 180px; max-width: 260px;
    font-family: ui-monospace, monospace;
    transition: border-color 0.3s;
  `;
  w.title = 'Watchdog SL/TP — click para ejecutar ahora';
  w.onclick = () => _wdRun(true);
  document.body.appendChild(w);
  return w;
}

function _wdRender() {
  const w = _wdGetOrCreateWidget();
  const now = Date.now();

  // Color del borde según estado
  if (_wd.running) {
    w.style.borderColor = '#ca8a04'; // amarillo — ejecutando
  } else if (_wd.lastResult?.sells > 0) {
    w.style.borderColor = '#16a34a'; // verde — tuvo ventas
  } else if (_wd.lastResult?.errors > 0) {
    w.style.borderColor = '#dc2626'; // rojo — errores
  } else {
    w.style.borderColor = '#065f46'; // verde oscuro — normal
  }

  // Texto de última ejecución
  let lastText = 'Nunca ejecutado';
  if (_wd.lastRunAt) {
    const secs = Math.floor((now - _wd.lastRunAt) / 1000);
    if (secs < 60)        lastText = `hace ${secs}s`;
    else if (secs < 3600) lastText = `hace ${Math.floor(secs/60)}m ${secs%60}s`;
    else                  lastText = `hace ${Math.floor(secs/3600)}h`;
  }

  // Texto del próximo run
  let nextText = '—';
  if (_wd.nextRunAt) {
    const secsNext = Math.floor((_wd.nextRunAt - now) / 1000);
    if (secsNext <= 0)        nextText = 'ahora';
    else if (secsNext < 60)   nextText = `en ${secsNext}s`;
    else if (secsNext < 3600) nextText = `en ${Math.floor(secsNext/60)}m`;
    else                      nextText = `en ${Math.floor(secsNext/3600)}h`;
  }

  // Resumen del último resultado
  let statusLine = '';
  if (_wd.running) {
    statusLine = `<div style="color:#fbbf24;margin-top:4px">⏳ Ejecutando...</div>`;
  } else if (_wd.lastResult) {
    const r = _wd.lastResult;
    const sellColor = r.sells > 0 ? '#4ade80' : '#9ca3af';
    const src = r.priceSource || '—';
    statusLine = `
      <div style="color:#9ca3af;margin-top:4px;line-height:1.6">
        <span>📊 ${r.checked ?? 0} pos. revisadas</span><br>
        <span style="color:${sellColor}">🔔 ${r.sells ?? 0} ventas · ${r.holds ?? 0} hold</span><br>
        <span style="color:#6b7280">🌐 ${src}</span>
        ${r.staleIds?.length ? `<br><span style="color:#f59e0b">⚠ ${r.staleIds.length} precio(s) stale</span>` : ''}
        ${r.errors > 0 ? `<br><span style="color:#f87171">❌ ${r.errors} error(es)</span>` : ''}
      </div>`;
  }

  w.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span style="font-weight:700;color:#34d399;font-size:12px">🔔 Watchdog SL/TP</span>
      <span style="color:#374151;font-size:10px">▼</span>
    </div>
    <div style="color:#6b7280;margin-top:3px;line-height:1.6">
      <span>🕐 Último: <span style="color:#d1fae5">${lastText}</span></span><br>
      <span>⏭ Próximo: <span style="color:#fef3c7">${nextText}</span></span>
    </div>
    ${statusLine}
    <div style="color:#374151;font-size:10px;margin-top:5px;text-align:center">click para ejecutar</div>
  `;
}

// ── Lógica de ejecución ───────────────────────────────────────────────────────

async function _wdRun(manual = false) {
  if (_wd.running) return;
  _wd.running = true;
  _wdRender();

  try {
    const r = await fetch('/api/invest/watchdog', { method: 'POST' });
    const d = await r.json();

    _wd.lastRunAt  = Date.now();
    _wd.lastResult = d.success ? d : { ...(d || {}), error: d.error };

    if (d.success) {
      if (d.sells > 0) {
        // Notificación toast para ventas
        _wdShowToast(d.actions.filter(a => a.sold));
        // Refrescar vista de posiciones
        if (typeof loadInvestPositions === 'function') loadInvestPositions().catch(() => {});
      }
      if (!manual) console.log(`[watchdog] ✅ ${d.checked} pos. · ${d.sells} ventas · ${d.priceSource}`);
    } else {
      console.warn('[watchdog] Error del backend:', d.error);
    }
  } catch (e) {
    _wd.lastResult = { error: e.message, sells: 0, checked: 0, holds: 0, errors: 1 };
    console.warn('[watchdog] Excepción:', e.message);
  } finally {
    _wd.running   = false;
    _wd.nextRunAt = Date.now() + _wd.INTERVAL_MS;
    _wdRender();
  }
}

function _wdShowToast(sells) {
  const existing = document.getElementById('watchdog-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'watchdog-toast';
  toast.style.cssText = `
    position:fixed; top:16px; right:16px; z-index:10000;
    background:#064e3b; border:1px solid #059669;
    border-radius:12px; padding:12px 16px;
    font-size:12px; color:#6ee7b7;
    box-shadow:0 4px 20px rgba(0,0,0,0.7);
    max-width:300px;
  `;

  const lines = sells.map(s => {
    const icon  = (s.pnlPct ?? 0) >= 0 ? '🟢' : '🔴';
    const type  = (s.closeReason || '').includes('stop') ? 'Stop Loss' : 'Take Profit';
    const pct   = typeof s.pnlPct === 'number' ? s.pnlPct.toFixed(2) : '?';
    return `${icon} <b>${s.symbol}</b> · ${type} · ${(s.pnlPct??0) >= 0 ? '+' : ''}${pct}%`;
  }).join('<br>');

  toast.innerHTML = `<div style="font-weight:700;margin-bottom:6px">🔔 Watchdog — ${sells.length} venta(s)</div>${lines}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

// ── Arranque ──────────────────────────────────────────────────────────────────

function startWatchdog() {
  if (_wd.interval) return;

  // Renderizar widget inmediatamente (antes del primer run)
  _wdGetOrCreateWidget();
  _wdRender();

  // Actualizar el widget cada segundo para que el contador sea fluido
  setInterval(_wdRender, 1000);

  // Programar runs cada 30 min
  _wd.interval  = setInterval(() => _wdRun(), _wd.INTERVAL_MS);
  _wd.nextRunAt = Date.now() + 15000; // primera ejecución en 15s

  // Primera ejecución a los 15s (dar tiempo a que la app cargue)
  setTimeout(() => _wdRun(), 15000);

  console.log('[watchdog] 🔔 Iniciado — widget visible · primera ejecución en 15s');
}


// ═══════════════════════════════════════════════════════════════════════════
// 5. AUTO-RUNNER DE ITERACIONES — cada 5 minutos
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
    console.warn('[iter-runner] Error:', e.message);
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

// Arrancar todo en cuanto el DOM esté listo (sin esperar al DOMContentLoaded si ya pasó)
function _initAll() {
  startWatchdog();
  startIterationRunner();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initAll);
} else {
  // DOM ya listo (script cargado después de DOMContentLoaded)
  _initAll();
}
