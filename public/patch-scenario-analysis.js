// public/patch-scenario-analysis.js
// Panel de análisis de escenarios para el detalle de cada ciclo completado.
//
// INTEGRAR: añadir al final de public/index.html (antes del cierre </body>):
//   <script src="/patch-scenario-analysis.js"></script>
//
// REQUIERE: patch-cycles-history.js (ya debe estar cargado)
'use strict';

console.log('[PATCH] scenario-analysis ✅');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. INYECCIÓN DEL BOTÓN "Escenarios" EN EL DETALLE DE CICLO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Intercepta la función que renderiza el detalle del ciclo para añadir
 * el botón "🔬 Escenarios" en el panel de acciones.
 */
(function patchCycleDetail() {
  // Esperar a que el DOM esté listo y los patches anteriores cargados
  const RETRY_INTERVAL = 800;
  let attempts = 0;

  function tryInject() {
    attempts++;
    // Buscar los contenedores de ciclos completados para añadir el botón
    const cycleCards = document.querySelectorAll('[data-cycle-id]');
    if (cycleCards.length === 0 && attempts < 15) {
      setTimeout(tryInject, RETRY_INTERVAL);
      return;
    }
    injectScenarioButtons();
  }

  setTimeout(tryInject, 1200);
})();

function injectScenarioButtons() {
  // Observar cambios en el DOM para detectar nuevos ciclos renderizados
  const observer = new MutationObserver(() => {
    document.querySelectorAll('[data-cycle-id]:not([data-scenario-btn])').forEach(card => {
      const cycleId  = card.dataset.cycleId;
      const status   = card.dataset.cycleStatus;
      if (status !== 'completed') return;

      card.dataset.scenarioBtn = 'true';

      // Buscar el contenedor de botones dentro de la card
      const btnContainer = card.querySelector('.cycle-actions, .flex.gap-2, .flex.gap-1');
      if (!btnContainer) return;

      const btn = document.createElement('button');
      btn.className  = 'btn-scenario-analysis text-xs px-2 py-1 rounded bg-purple-700 hover:bg-purple-600 text-white transition-colors';
      btn.innerHTML  = '🔬 Escenarios';
      btn.title      = 'Ver análisis de escenarios alternativos';
      btn.onclick    = (e) => { e.stopPropagation(); openScenarioModal(cycleId); };
      btnContainer.appendChild(btn);
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  // También procesar los existentes
  document.querySelectorAll('[data-cycle-id][data-cycle-status="completed"]:not([data-scenario-btn])').forEach(card => {
    card.dataset.scenarioBtn = 'true';
    const cycleId      = card.dataset.cycleId;
    const btnContainer = card.querySelector('.cycle-actions, .flex.gap-2, .flex.gap-1');
    if (!btnContainer) return;
    const btn          = document.createElement('button');
    btn.className      = 'text-xs px-2 py-1 rounded bg-purple-700 hover:bg-purple-600 text-white';
    btn.innerHTML      = '🔬 Escenarios';
    btn.onclick        = (e) => { e.stopPropagation(); openScenarioModal(cycleId); };
    btnContainer.appendChild(btn);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MODAL DE ANÁLISIS DE ESCENARIOS
// ═══════════════════════════════════════════════════════════════════════════════

// Insertar el modal en el DOM
document.addEventListener('DOMContentLoaded', () => {
  const el = document.createElement('div');
  el.id    = 'scenario-modal';
  el.style.display = 'none';
  el.innerHTML     = `
    <div class="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
         id="scenario-modal-backdrop"
         onclick="if(event.target===this) closeScenarioModal()">
      <div class="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
          <div>
            <h2 class="text-lg font-bold text-white">🔬 Análisis de Escenarios Alternativos</h2>
            <p class="text-xs text-gray-400 mt-0.5" id="scenario-cycle-label">Cargando...</p>
          </div>
          <button onclick="closeScenarioModal()" class="text-gray-400 hover:text-white text-2xl leading-none px-2">✕</button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b border-gray-700 flex-shrink-0 px-4 gap-1 pt-2">
          <button class="scenario-tab active" data-tab="duration" onclick="switchScenarioTab('duration')">
            ⏱ Duraciones
          </button>
          <button class="scenario-tab" data-tab="trading" onclick="switchScenarioTab('trading')">
            📊 Algoritmo Trading
          </button>
          <button class="scenario-tab" data-tab="temporal" onclick="switchScenarioTab('temporal')">
            📈 Modelo Temporal
          </button>
          <button class="scenario-tab" data-tab="best" onclick="switchScenarioTab('best')">
            🏆 Mejor Escenario
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-4" id="scenario-content">
          <div class="flex items-center justify-center h-32 text-gray-500">
            <div class="text-center">
              <div class="animate-spin text-2xl mb-2">⚙️</div>
              <div>Calculando escenarios...</div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="border-t border-gray-700 p-3 flex justify-between items-center flex-shrink-0 bg-gray-900/50">
          <div class="text-xs text-gray-500" id="scenario-data-quality"></div>
          <div class="flex gap-2">
            <button id="scenario-apply-btn"
                    class="hidden px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-sm text-white"
                    onclick="applyBestScenario()">
              ✅ Usar como referencia para optimización
            </button>
            <button onclick="closeScenarioModal()"
                    class="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-300">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  // Estilos para las tabs
  const style = document.createElement('style');
  style.textContent = `
    .scenario-tab {
      padding: 6px 14px;
      border-radius: 6px 6px 0 0;
      font-size: 0.75rem;
      color: #9ca3af;
      background: transparent;
      border: none;
      cursor: pointer;
      transition: all 0.15s;
    }
    .scenario-tab:hover { color: #e5e7eb; background: rgba(255,255,255,0.05); }
    .scenario-tab.active { color: #fff; background: rgba(139,92,246,0.25); border-bottom: 2px solid #8b5cf6; }
    .scenario-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 14px;
      transition: all 0.15s;
    }
    .scenario-card:hover { background: rgba(255,255,255,0.07); }
    .scenario-card.best-scenario { border-color: rgba(234,179,8,0.5); background: rgba(234,179,8,0.05); }
    .scenario-card.actual-scenario { border-color: rgba(139,92,246,0.4); }
    .metric-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 600;
    }
    .temporal-curve-point { transition: all 0.15s; }
    .win-indicator { color: #22c55e; }
    .loss-indicator { color: #ef4444; }
  `;
  document.head.appendChild(style);
});

// ─── Estado del modal ─────────────────────────────────────────────────────────

let _scenarioData   = null;
let _scenarioCycleId = null;
let _activeTab      = 'duration';

// ─── Abrir / Cerrar modal ─────────────────────────────────────────────────────

window.openScenarioModal = async function(cycleId) {
  _scenarioCycleId = cycleId;
  const modal = document.getElementById('scenario-modal');
  modal.style.display = 'block';
  setScenarioContent('<div class="flex items-center justify-center h-32 text-gray-500"><div class="text-center"><div class="animate-spin text-2xl mb-2">⚙️</div><div>Calculando escenarios...</div></div></div>');
  document.getElementById('scenario-cycle-label').textContent = `Ciclo: ${cycleId}`;

  try {
    const resp = await fetch(`/api/cycles/${cycleId}/scenarios`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { analysis } = await resp.json();
    _scenarioData = analysis;

    // Calidad de datos
    const q = analysis.dataQuality;
    document.getElementById('scenario-data-quality').textContent =
      `Iteraciones reales: ${q.iterationCount} | Calidad datos: ${q.hasIterations ? '✅ Alta (precios reales)' : '⚠️ Estimada (interpolación)'}`;

    // Mostrar botón de aplicar
    document.getElementById('scenario-apply-btn').classList.remove('hidden');

    // Renderizar la tab activa
    switchScenarioTab(_activeTab);
  } catch (err) {
    setScenarioContent(`<div class="text-red-400 p-4">❌ Error cargando escenarios: ${err.message}</div>`);
  }
};

window.closeScenarioModal = function() {
  document.getElementById('scenario-modal').style.display = 'none';
  _scenarioData    = null;
  _scenarioCycleId = null;
};

window.switchScenarioTab = function(tab) {
  _activeTab = tab;
  document.querySelectorAll('.scenario-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  if (!_scenarioData) return;

  switch (tab) {
    case 'duration': renderDurationScenarios(); break;
    case 'trading':  renderTradingScenarios();  break;
    case 'temporal': renderTemporalModel();     break;
    case 'best':     renderBestScenario();      break;
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TAB: DURACIONES ALTERNATIVAS
// ═══════════════════════════════════════════════════════════════════════════════

function renderDurationScenarios() {
  const d = _scenarioData;
  if (!d?.durationScenarios?.length) {
    setScenarioContent('<p class="text-gray-500 p-4">Sin datos de duraciones</p>');
    return;
  }

  const scenarios = d.durationScenarios.filter(s => s.status === 'simulated');
  const bestAcc   = Math.max(...scenarios.map(s => s.metrics?.successRate || 0));

  let html = `
    <div class="mb-3">
      <p class="text-sm text-gray-400">Simulación de cómo habría ido el ciclo con diferentes ventanas temporales.
      La predicción en cada ventana usa el <strong class="text-purple-400">modelo temporal no-lineal</strong>
      (momentum → logarítmica → reversión) según la clasificación del activo.</p>
    </div>

    <!-- Tabla resumen -->
    <div class="overflow-x-auto mb-4">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-500 border-b border-gray-700">
            <th class="pb-2 pr-4">Duración</th>
            <th class="pb-2 pr-4 text-center">Accuracy</th>
            <th class="pb-2 pr-4 text-center">INVERTIBLE</th>
            <th class="pb-2 pr-4 text-center">APALANCADO</th>
            <th class="pb-2 text-center">Datos</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const s of scenarios) {
    const isBest   = (s.metrics?.successRate || 0) === bestAcc;
    const isActual = s.isActual;
    const acc      = s.metrics?.successRate || 0;
    const invAcc   = s.metrics?.byClass?.INVERTIBLE?.successRate;
    const apalAcc  = s.metrics?.byClass?.APALANCADO?.successRate;

    html += `
      <tr class="border-b border-gray-800 ${isBest ? 'bg-yellow-900/20' : isActual ? 'bg-purple-900/10' : ''}">
        <td class="py-2 pr-4 font-semibold ${isActual ? 'text-purple-400' : 'text-gray-200'}">
          ${s.label} ${isBest ? '🏆' : ''} ${isActual ? '📍' : ''}
        </td>
        <td class="py-2 pr-4 text-center">
          <span class="metric-badge ${acc >= 65 ? 'bg-green-900 text-green-300' : acc >= 45 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'}">
            ${acc}%
          </span>
        </td>
        <td class="py-2 pr-4 text-center text-gray-300">${invAcc != null ? invAcc + '%' : '—'}</td>
        <td class="py-2 pr-4 text-center text-gray-300">${apalAcc != null ? apalAcc + '%' : '—'}</td>
        <td class="py-2 text-center">
          <span class="text-xs ${s.dataQuality === 'high' ? 'text-green-400' : 'text-yellow-500'}">
            ${s.dataQuality === 'high' ? '✅ Real' : '〜 Estimado'}
          </span>
        </td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  </div>

  <!-- Cards detalle -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
  `;

  for (const s of scenarios) {
    if (!s.metrics) continue;
    const isBest   = (s.metrics?.successRate || 0) === bestAcc;
    const isActual = s.isActual;
    const incorrect = s.results?.filter(r => !r.correct) || [];

    html += `
      <div class="scenario-card ${isBest ? 'best-scenario' : ''} ${isActual ? 'actual-scenario' : ''}">
        <div class="flex justify-between items-start mb-2">
          <div>
            <span class="font-bold text-white">${s.label}</span>
            ${isBest ? '<span class="ml-1 text-xs text-yellow-400">🏆 Mejor</span>' : ''}
            ${isActual ? '<span class="ml-1 text-xs text-purple-400">📍 Real</span>' : ''}
          </div>
          <span class="text-2xl font-bold ${s.metrics.successRate >= 65 ? 'text-green-400' : s.metrics.successRate >= 45 ? 'text-yellow-400' : 'text-red-400'}">
            ${s.metrics.successRate}%
          </span>
        </div>
        <div class="text-xs text-gray-400 grid grid-cols-3 gap-2 mb-2">
          <div>Total: <span class="text-white">${s.metrics.total}</span></div>
          <div>Correctos: <span class="text-green-400">${s.metrics.correct}</span></div>
          <div>Errores: <span class="text-red-400">${s.metrics.total - s.metrics.correct}</span></div>
        </div>
        ${incorrect.length > 0 ? `
          <div class="text-xs text-gray-500 mt-1">
            Fallos: ${incorrect.slice(0, 3).map(r => `<span class="text-red-400">${r.symbol}</span>`).join(', ')}
            ${incorrect.length > 3 ? `<span>+${incorrect.length - 3} más</span>` : ''}
          </div>
        ` : '<div class="text-xs text-green-400">✓ Sin fallos</div>'}
      </div>
    `;
  }

  html += `</div>`;
  setScenarioContent(html);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TAB: ALGORITMO DE TRADING
// ═══════════════════════════════════════════════════════════════════════════════

function renderTradingScenarios() {
  const ts = _scenarioData?.tradingScenarios;
  if (!ts) { setScenarioContent('<p class="text-gray-500 p-4">Sin datos</p>'); return; }

  const bestKey = ts.bestConfig;
  const configs = ['conservative', 'moderate', 'aggressive', 'actual']
    .filter(k => ts[k])
    .map(k => ({ key: k, ...ts[k] }));

  let html = `
    <div class="mb-3">
      <p class="text-sm text-gray-400">Simulación de cómo habrían funcionado las posiciones abiertas en este ciclo
      con tres perfiles de compraventa distintos. Usa los precios reales de las iteraciones cuando están disponibles.</p>
    </div>
  `;

  // Tabla comparativa
  html += `
    <div class="overflow-x-auto mb-4">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-gray-500 border-b border-gray-700">
            <th class="pb-2 pr-3">Configuración</th>
            <th class="pb-2 pr-3 text-center">TP / SL / Hold</th>
            <th class="pb-2 pr-3 text-center">Win Rate</th>
            <th class="pb-2 pr-3 text-center">PnL Medio</th>
            <th class="pb-2 pr-3 text-center">TP Hits</th>
            <th class="pb-2 text-center">Score</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const c of configs) {
    const isBest = c.key === bestKey;
    const s      = c.summary || {};
    html += `
      <tr class="border-b border-gray-800 ${isBest ? 'bg-yellow-900/20' : ''}">
        <td class="py-2 pr-3">
          <span>${c.emoji || '📊'} <strong>${c.label}</strong></span>
          ${isBest ? ' 🏆' : ''}
        </td>
        <td class="py-2 pr-3 text-center text-xs text-gray-400 font-mono">
          ${c.config?.takeProfitPct}% / ${c.config?.stopLossPct}% / ${c.config?.maxHoldCycles}x
        </td>
        <td class="py-2 pr-3 text-center">
          <span class="metric-badge ${s.winRate >= 60 ? 'bg-green-900 text-green-300' : s.winRate >= 40 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'}">
            ${s.winRate}%
          </span>
        </td>
        <td class="py-2 pr-3 text-center ${(s.avgPnlPct || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">
          ${(s.avgPnlPct || 0) >= 0 ? '+' : ''}${s.avgPnlPct}%
        </td>
        <td class="py-2 pr-3 text-center text-gray-300">${s.tpHits} / ${s.totalPositions}</td>
        <td class="py-2 text-center font-bold ${isBest ? 'text-yellow-400' : 'text-gray-300'}">
          ${s.compositeScore}
        </td>
      </tr>
    `;
  }

  html += `</tbody></table></div>`;

  // Cards detalle por config
  html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">`;

  for (const c of configs) {
    const isBest = c.key === bestKey;
    const s      = c.summary || {};
    const topWins   = (c.positions || []).filter(p => p.won).slice(0, 3);
    const topLosses = (c.positions || []).filter(p => !p.won).slice(0, 2);

    html += `
      <div class="scenario-card ${isBest ? 'best-scenario' : ''}">
        <div class="flex justify-between items-center mb-3">
          <div>
            <span class="text-lg">${c.emoji}</span>
            <span class="font-bold text-white ml-1">${c.label}</span>
            ${isBest ? '<span class="ml-2 text-xs text-yellow-400">🏆 Mejor score</span>' : ''}
          </div>
          <div class="text-right">
            <div class="text-xs text-gray-500">Score</div>
            <div class="font-bold text-lg ${isBest ? 'text-yellow-400' : 'text-gray-300'}">${s.compositeScore}</div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 text-xs mb-3">
          <div class="text-center p-2 bg-gray-800 rounded">
            <div class="text-gray-500">Take Profit</div>
            <div class="font-bold text-green-400">${c.config?.takeProfitPct}%</div>
          </div>
          <div class="text-center p-2 bg-gray-800 rounded">
            <div class="text-gray-500">Stop Loss</div>
            <div class="font-bold text-red-400">${c.config?.stopLossPct}%</div>
          </div>
          <div class="text-center p-2 bg-gray-800 rounded">
            <div class="text-gray-500">Max Hold</div>
            <div class="font-bold text-blue-400">${c.config?.maxHoldCycles}x</div>
          </div>
        </div>

        <div class="grid grid-cols-4 gap-2 text-xs mb-3">
          <div><span class="text-gray-500">Win rate:</span> <span class="${s.winRate >= 50 ? 'text-green-400' : 'text-red-400'} font-semibold">${s.winRate}%</span></div>
          <div><span class="text-gray-500">Avg PnL:</span> <span class="${(s.avgPnlPct||0)>=0?'text-green-400':'text-red-400'} font-semibold">${(s.avgPnlPct||0)>=0?'+':''}${s.avgPnlPct}%</span></div>
          <div><span class="text-gray-500">TP hits:</span> <span class="text-green-400">${s.tpHits}</span></div>
          <div><span class="text-gray-500">SL hits:</span> <span class="text-red-400">${s.slHits}</span></div>
        </div>

        ${topWins.length ? `
          <div class="text-xs">
            <span class="text-gray-500">Mejores:</span>
            ${topWins.map(p => `<span class="text-green-400 ml-1">${p.symbol} +${p.pnlPct}%</span>`).join('')}
          </div>
        ` : ''}
        ${topLosses.length ? `
          <div class="text-xs mt-1">
            <span class="text-gray-500">Peores:</span>
            ${topLosses.map(p => `<span class="text-red-400 ml-1">${p.symbol} ${p.pnlPct}%</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }

  html += `</div>`;
  setScenarioContent(html);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TAB: MODELO TEMPORAL NO-LINEAL
// ═══════════════════════════════════════════════════════════════════════════════

function renderTemporalModel() {
  const d = _scenarioData;
  if (!d) return;

  // Reconstruir el perfil temporal desde los escenarios de duración
  const scenarios  = (d.durationScenarios || []).filter(s => s.status === 'simulated');
  const hours      = scenarios.map(s => s.durationH);
  const accuracies = scenarios.map(s => s.metrics?.successRate || 0);

  // Encontrar activos INVERTIBLE del ciclo
  const invertibleScenario = scenarios.find(s => s.durationMs === d.actualDurationMs)?.results
    ?.filter(r => r.classification === 'INVERTIBLE')
    ?.slice(0, 1)[0];

  const basePred = invertibleScenario?.predictedSim || 10; // fallback 10%

  // Calcular curvas de predicción temporal
  const WINDOW_HOURS = [6, 12, 18, 24, 30, 36, 48, 72];
  const invertibleCurve = WINDOW_HOURS.map(h => {
    const s = scenarios.find(sc => Math.abs(sc.durationH - h) < 1);
    if (s) {
      const invResults = s.results?.filter(r => r.classification === 'INVERTIBLE') || [];
      const avgPred    = invResults.length > 0
        ? invResults.reduce((sum, r) => sum + r.predictedSim, 0) / invResults.length
        : null;
      return { h, pred: avgPred, real: s.metrics?.byClass?.INVERTIBLE?.successRate };
    }
    return { h, pred: null, real: null };
  });

  let html = `
    <div class="mb-4">
      <div class="bg-blue-900/20 border border-blue-800/50 rounded-lg p-3 mb-4">
        <div class="text-sm font-semibold text-blue-300 mb-1">📐 Modelo Temporal No-Lineal v1</div>
        <div class="text-xs text-gray-400 space-y-1">
          <div>• <strong class="text-white">Fase 1 (0→momentum máx.):</strong> Lineal con boost inicial — el precio necesita tiempo para materializar la señal</div>
          <div>• <strong class="text-white">Fase 2 (momentum→inicio reversión):</strong> Logarítmica — cada hora adicional aporta menos que la anterior</div>
          <div>• <strong class="text-white">Fase 3 (reversión+):</strong> Decay exponencial — la señal original se diluye, precio busca equilibrio</div>
          <div class="mt-2 text-yellow-400">⚠️ Importante: 4% a 12h ≠ 8% a 24h. La predicción en cada ventana es independiente y no proporcional.</div>
        </div>
      </div>
    </div>

    <!-- Tabla de predicciones por ventana temporal -->
    <div class="mb-4">
      <h3 class="text-sm font-semibold text-gray-300 mb-2">Predicciones vs Accuracy real por ventana</h3>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-gray-500 border-b border-gray-700">
              <th class="pb-1 pr-4 text-left">Ventana</th>
              <th class="pb-1 pr-4 text-center">Factor temporal</th>
              <th class="pb-1 pr-4 text-center">Pred. media INVERT.</th>
              <th class="pb-1 text-center">Accuracy real</th>
            </tr>
          </thead>
          <tbody>
  `;

  for (const point of invertibleCurve) {
    const scenario = scenarios.find(s => Math.abs(s.durationH - point.h) < 1);
    if (!scenario) continue;

    // Factor temporal aproximado (pred / basePred)
    const avgBasePred = scenarios.find(s => s.durationH === 12)?.results
      ?.filter(r => r.classification === 'INVERTIBLE')
      ?.reduce((s, r, _, arr) => s + r.predictedSim / arr.length, 0) || basePred;

    const factor = avgBasePred > 0 && point.pred != null ? (point.pred / avgBasePred).toFixed(3) : '—';
    const isActual = scenario.isActual;

    html += `
      <tr class="border-b border-gray-800 ${isActual ? 'bg-purple-900/10' : ''}">
        <td class="py-1 pr-4 font-semibold ${isActual ? 'text-purple-400' : 'text-gray-200'}">${point.h}h ${isActual ? '📍' : ''}</td>
        <td class="py-1 pr-4 text-center text-blue-400">×${factor}</td>
        <td class="py-1 pr-4 text-center ${point.pred != null ? (point.pred >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-600'}">
          ${point.pred != null ? `${point.pred >= 0 ? '+' : ''}${point.pred?.toFixed(1)}%` : '—'}
        </td>
        <td class="py-1 text-center">
          ${point.real != null
            ? `<span class="metric-badge ${point.real >= 65 ? 'bg-green-900 text-green-300' : point.real >= 45 ? 'bg-yellow-900 text-yellow-300' : 'bg-red-900 text-red-300'}">${point.real}%</span>`
            : '<span class="text-gray-600">—</span>'}
        </td>
      </tr>
    `;
  }

  html += `
        </tbody>
      </table>
    </div>
  </div>

  <!-- Parámetros del modelo -->
  <div class="mt-4">
    <h3 class="text-sm font-semibold text-gray-300 mb-2">Parámetros del modelo por clasificación</h3>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      ${renderTemporalParamsCard('INVERTIBLE', '#22c55e', {momentumHalfLife: 18, logAlpha: 0.55, reversionStart: 36, maxMultiplier: 2.8})}
      ${renderTemporalParamsCard('APALANCADO', '#f59e0b', {momentumHalfLife: 10, logAlpha: 0.40, reversionStart: 20, maxMultiplier: 1.5})}
      ${renderTemporalParamsCard('RUIDOSO',    '#6b7280', {momentumHalfLife: 6,  logAlpha: 0.30, reversionStart: 12, maxMultiplier: 1.0})}
    </div>
  </div>
  `;

  setScenarioContent(html);
}

function renderTemporalParamsCard(label, color, params) {
  return `
    <div class="scenario-card">
      <div class="font-bold mb-2" style="color:${color}">${label}</div>
      <div class="space-y-1 text-gray-400">
        <div>Momentum hasta: <span class="text-white">${params.momentumHalfLife}h</span></div>
        <div>α logarítmico: <span class="text-white">${params.logAlpha}</span></div>
        <div>Reversión inicia: <span class="text-white">${params.reversionStart}h</span></div>
        <div>Multiplicador máx: <span class="text-white">×${params.maxMultiplier}</span></div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TAB: MEJOR ESCENARIO — PARA ALIMENTAR OPTIMIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════════

function renderBestScenario() {
  const d  = _scenarioData;
  const feed = d?.optimizationFeed;
  const ts   = d?.tradingScenarios;
  if (!feed) return;

  const bestTradingConfig = ts?.[feed.bestTradingConfig];
  const bestDuration      = d?.durationScenarios?.find(s => Math.abs(s.durationMs - feed.bestDurationMs) < 60000);

  let html = `
    <div class="mb-3">
      <p class="text-sm text-gray-400">Resumen del escenario óptimo detectado en este ciclo.
      Puedes usar estos datos para alimentar el algoritmo de mejora (<em>3 Sabios</em>).</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

      <!-- Mejor duración -->
      <div class="scenario-card best-scenario">
        <div class="text-xs text-yellow-400 font-semibold mb-2">🏆 Mejor Duración</div>
        <div class="text-3xl font-bold text-white mb-1">${bestDuration?.label || feed.bestDurationH + 'h'}</div>
        <div class="text-sm text-gray-400 mb-3">Accuracy: <span class="text-green-400 font-bold">${feed.bestDurationAccuracy}%</span></div>
        ${bestDuration?.metrics ? `
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="text-center p-1 bg-gray-800 rounded">
              <div class="text-gray-500">Total</div>
              <div class="text-white">${bestDuration.metrics.total}</div>
            </div>
            <div class="text-center p-1 bg-gray-800 rounded">
              <div class="text-gray-500">Correctos</div>
              <div class="text-green-400">${bestDuration.metrics.correct}</div>
            </div>
            <div class="text-center p-1 bg-gray-800 rounded">
              <div class="text-gray-500">Errores</div>
              <div class="text-red-400">${bestDuration.metrics.total - bestDuration.metrics.correct}</div>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Mejor config trading -->
      <div class="scenario-card best-scenario">
        <div class="text-xs text-yellow-400 font-semibold mb-2">🏆 Mejor Config Trading</div>
        <div class="text-2xl font-bold text-white mb-1">${bestTradingConfig?.emoji} ${bestTradingConfig?.label}</div>
        <div class="text-sm text-gray-400 mb-3">Score: <span class="text-yellow-400 font-bold">${feed.bestTradingScore}</span></div>
        ${feed.recommendedParams ? `
          <div class="grid grid-cols-3 gap-2 text-xs">
            <div class="text-center p-1 bg-gray-800 rounded">
              <div class="text-gray-500">Take Profit</div>
              <div class="text-green-400">${feed.recommendedParams.takeProfitPct}%</div>
            </div>
            <div class="text-center p-1 bg-gray-800 rounded">
              <div class="text-gray-500">Stop Loss</div>
              <div class="text-red-400">${feed.recommendedParams.stopLossPct}%</div>
            </div>
            <div class="text-center p-1 bg-gray-800 rounded">
              <div class="text-gray-500">Max Hold</div>
              <div class="text-blue-400">${feed.recommendedParams.maxHoldCycles}x</div>
            </div>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Ranking completo de configs de trading -->
    <div class="mb-4">
      <h3 class="text-sm font-semibold text-gray-300 mb-2">Ranking de configuraciones de trading</h3>
      <div class="space-y-2">
        ${(ts?.ranking || []).map((r, i) => {
          const cfg = ts[r.key];
          return `
            <div class="flex items-center justify-between p-2 rounded bg-gray-800/50 ${i === 0 ? 'border border-yellow-600/40' : ''}">
              <div class="flex items-center gap-2">
                <span class="text-gray-500 text-sm w-5">${i + 1}.</span>
                <span class="text-sm">${cfg?.emoji} ${cfg?.label}</span>
              </div>
              <div class="flex items-center gap-3 text-xs">
                <span class="text-gray-400">W: <span class="${(cfg?.summary?.winRate||0)>=50?'text-green-400':'text-red-400'}">${cfg?.summary?.winRate}%</span></span>
                <span class="text-gray-400">PnL: <span class="${(cfg?.summary?.avgPnlPct||0)>=0?'text-green-400':'text-red-400'}">${(cfg?.summary?.avgPnlPct||0)>=0?'+':''}${cfg?.summary?.avgPnlPct}%</span></span>
                <span class="font-bold ${i===0?'text-yellow-400':'text-gray-300'}">${r.score}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- JSON para copiar/exportar -->
    <details class="text-xs">
      <summary class="text-gray-500 cursor-pointer hover:text-gray-300 mb-2">
        📋 JSON para exportar a 3 Sabios
      </summary>
      <pre class="bg-gray-800 rounded p-3 overflow-x-auto text-gray-300 mt-2">${JSON.stringify(feed, null, 2)}</pre>
    </details>
  `;

  setScenarioContent(html);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. ACCIÓN: APLICAR MEJOR ESCENARIO
// ═══════════════════════════════════════════════════════════════════════════════

window.applyBestScenario = async function() {
  const feed = _scenarioData?.optimizationFeed;
  if (!feed || !_scenarioCycleId) return;

  try {
    const resp = await fetch(`/api/cycles/${_scenarioCycleId}/apply-best-scenario`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        bestDurationMs:   feed.bestDurationMs,
        bestTradingConfig: feed.bestTradingConfig,
        notes:            `Auto-detectado por análisis de escenarios. Score: ${feed.bestTradingScore}`,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    alert(`✅ Mejor escenario registrado para el ciclo ${_scenarioCycleId}.\n\nConfig recomendada: ${data.recommendedConfig?.label || feed.bestTradingConfig}\n\nEste dato alimentará el próximo análisis de 3 Sabios.`);
  } catch (err) {
    alert(`❌ Error aplicando escenario: ${err.message}`);
  }
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function setScenarioContent(html) {
  const el = document.getElementById('scenario-content');
  if (el) el.innerHTML = html;
}
