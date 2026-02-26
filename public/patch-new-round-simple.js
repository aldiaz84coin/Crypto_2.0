// ═══════════════════════════════════════════════════════════════════════════════
// PATCH: patch-new-round-simple.js
//
// BUG FIX: Elimina las opciones de configuración adicionales del modal de
// "Nueva Ronda de Inversión". La nueva ronda se abre siempre con la
// configuración global actual del investConfig (guardada en /api/invest/config).
//
// Sobreescribe: openNewRoundWizard(), submitNewRound()
// Elimina: campos nr-tp, nr-sl, nr-hold, nr-maxpos, nr-boost, nr-min-pred,
//          nr-mode, nr-exchange, nr-capital, nr-capital-pct
// ═══════════════════════════════════════════════════════════════════════════════

(function patchNewRoundSimple() {
  'use strict';

  // ── Helper: formatear moneda ────────────────────────────────────────────────
  function fmt$(v) { return v != null ? `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'; }
  function fmtPct(v) { return v != null ? `${parseFloat(v).toFixed(1)}%` : '—'; }

  // ── Sobreescribir openNewRoundWizard ────────────────────────────────────────
  window.openNewRoundWizard = async function openNewRoundWizard() {
    // Eliminar modal anterior si existiera
    document.getElementById('new-round-modal')?.remove();

    // Cargar config global actual
    let cfg = {};
    let algoConfig = null;
    try {
      const [cfgRes, algoRes] = await Promise.all([
        fetch('/api/invest/config'),
        fetch('/api/config'),
      ]);
      const cfgData  = await cfgRes.json();
      const algoData = await algoRes.json();
      if (cfgData.success)  cfg       = cfgData.config || {};
      if (algoData.success) algoConfig = algoData.config || null;
    } catch (_) {}

    // ── Cargar posibles recomendaciones del último análisis ───────────────────
    let adjustmentsHTML = '';
    try {
      const recRes = await fetch('/api/invest/rounds/recommendations');
      const recData = await recRes.json();
      if (recData.success && recData.suggestedAdjustments) {
        const adj = recData.suggestedAdjustments;
        const changes = [];
        if (adj.takeProfitPct != null) changes.push(`TP: ${fmtPct(adj.takeProfitPct)}`);
        if (adj.stopLossPct   != null) changes.push(`SL: ${fmtPct(adj.stopLossPct)}`);
        if (adj.maxHoldCycles != null) changes.push(`Hold: ${adj.maxHoldCycles} ciclos`);
        if (changes.length > 0) {
          adjustmentsHTML = `
            <div class="bg-purple-950 border border-purple-800 rounded-xl p-3 mb-4">
              <p class="text-xs font-semibold text-purple-300 mb-1">✨ Ajustes sugeridos por análisis anterior</p>
              <p class="text-xs text-gray-400">${changes.join(' · ')}</p>
              <p class="text-xs text-gray-500 mt-1">Se aplicarán automáticamente al guardar la config global antes de abrir esta ronda.</p>
            </div>`;
        }
      }
    } catch (_) {}

    // ── Parámetros actuales del algo A (solo informativo) ─────────────────────
    const algoHTML = algoConfig ? `
      <div class="bg-gray-800/60 border border-gray-700 rounded-xl p-3 mb-4 text-xs text-gray-400 flex flex-wrap gap-3">
        <span>Algoritmo A: <span class="text-white">BP mín. ${algoConfig.classification?.invertibleMinBoost != null ? (algoConfig.classification.invertibleMinBoost * 100).toFixed(0) + '%' : '—'}</span></span>
        <span>Target: <span class="text-white">${algoConfig.prediction?.invertibleTarget != null ? algoConfig.prediction.invertibleTarget + '%' : '—'}</span></span>
        <span>Potencial: <span class="text-white">${algoConfig.metaWeights?.potential != null ? (algoConfig.metaWeights.potential * 100).toFixed(0) + '%' : '—'}</span></span>
      </div>` : '';

    // ── Parámetros actuales del investConfig (modo, exchange, capital, TP/SL…) ─
    const modeLabel  = cfg.mode === 'real' ? '💰 Real' : cfg.mode === 'testnet' ? '🧪 Testnet' : '⚗️ Simulado';
    const capitalPct = cfg.capitalPerCycle != null ? (cfg.capitalPerCycle * 100).toFixed(0) + '%' : '—';

    const modal = document.createElement('div');
    modal.id = 'new-round-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
    modal.style.background = 'rgba(0,0,0,0.82)';
    modal.innerHTML = `
      <div class="cycle-modal-enter bg-gray-950 border border-indigo-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div class="flex items-center justify-between p-4 border-b border-gray-800">
          <div>
            <h2 class="text-base font-bold text-indigo-300">🚀 Nueva Ronda de Inversión</h2>
            <p class="text-xs text-gray-500 mt-0.5">Se usará la configuración global actual</p>
          </div>
          <button onclick="document.getElementById('new-round-modal').remove()" class="text-gray-500 hover:text-white text-xl p-1">✕</button>
        </div>

        <div class="p-4 space-y-3">
          ${adjustmentsHTML}
          ${algoHTML}

          <!-- Resumen de config global -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p class="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">Configuración activa</p>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Modo</span>
                <span class="text-white font-semibold">${modeLabel}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Exchange</span>
                <span class="text-white font-semibold">${cfg.exchange || 'binance'}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Capital total</span>
                <span class="text-white font-semibold">${fmt$(cfg.capitalTotal)}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Capital/ciclo</span>
                <span class="text-white font-semibold">${capitalPct}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Take Profit</span>
                <span class="text-green-400 font-semibold">${fmtPct(cfg.takeProfitPct)}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Stop Loss</span>
                <span class="text-red-400 font-semibold">${fmtPct(cfg.stopLossPct)}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Max Hold</span>
                <span class="text-white font-semibold">${cfg.maxHoldCycles || 3} ciclos</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Máx posiciones</span>
                <span class="text-white font-semibold">${cfg.maxPositions || 3}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Min BP</span>
                <span class="text-blue-400 font-semibold">${cfg.minBoostPower != null ? (cfg.minBoostPower * 100).toFixed(0) + '%' : '65%'}</span>
              </div>
              <div class="flex justify-between bg-gray-800 rounded-lg px-3 py-2">
                <span class="text-gray-400">Min predicción</span>
                <span class="text-indigo-400 font-semibold">${cfg.minPredictedChange > 0 ? '+' + fmtPct(cfg.minPredictedChange) : 'Sin filtro'}</span>
              </div>
            </div>
            <p class="text-xs text-gray-600 mt-3">
              Para cambiar estos parámetros ve a <strong class="text-gray-400">Inversión → Configuración</strong> antes de abrir la ronda.
            </p>
          </div>

          <div id="nr-status" class="hidden text-sm text-gray-400"></div>
        </div>

        <div class="p-3 border-t border-gray-800 flex gap-2">
          <button onclick="document.getElementById('new-round-modal').remove()"
            class="flex-1 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold">
            Cancelar
          </button>
          <button id="btn-open-round" onclick="submitNewRound()"
            class="flex-1 bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold">
            🚀 Abrir Ronda
          </button>
        </div>
      </div>`;

    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  };

  // ── Sobreescribir submitNewRound — sin payload de config extra ─────────────
  window.submitNewRound = async function submitNewRound() {
    const btn    = document.getElementById('btn-open-round');
    const status = document.getElementById('nr-status');
    if (!btn || !status) return;

    btn.disabled  = true;
    btn.innerHTML = '⏳ Abriendo...';
    status.classList.remove('hidden');
    status.textContent = 'Abriendo nueva ronda con configuración actual...';

    try {
      // Sin payload: el backend lee el investConfig guardado
      const r = await fetch('/api/invest/rounds/open', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      });
      const d = await r.json();

      if (!d.success) {
        status.textContent = '❌ ' + d.error;
        btn.disabled  = false;
        btn.innerHTML = '🚀 Abrir Ronda';
        return;
      }

      document.getElementById('new-round-modal')?.remove();

      // Refrescar UI
      if (typeof loadCurrentRoundBanner === 'function') await loadCurrentRoundBanner();
      if (typeof loadInvestPositions === 'function')    await loadInvestPositions();
      if (typeof loadInvestOverview === 'function')     await loadInvestOverview();
      if (typeof loadInvestRounds === 'function')       loadInvestRounds();

      // Toast de confirmación
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-indigo-800 border border-indigo-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold cycle-modal-enter';
      toast.textContent = `✅ Ronda #${d.round?.roundNumber || '?'} abierta — ¡A invertir!`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3500);

    } catch (e) {
      status.textContent = '❌ ' + e.message;
      btn.disabled  = false;
      btn.innerHTML = '🚀 Abrir Ronda';
    }
  };

  console.log('[patch-new-round-simple] ✅ Wizard de nueva ronda simplificado — usa investConfig global');
})();
