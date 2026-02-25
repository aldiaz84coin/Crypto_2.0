// ═══════════════════════════════════════════════════════════════════════════════
// PATCH: patch-decide-priority.js
// Mejora el botón "Analizar & Decidir" para:
//   1. Mostrar activos ordenados por predicción de crecimiento (mayor primero)
//   2. Mostrar tabla de TODOS los candidatos elegibles con su ranking
//   3. Indicar visualmente el criterio de filtrado activo (minPredictedChange)
// ═══════════════════════════════════════════════════════════════════════════════

(function patchDecidePriority() {
  'use strict';

  // ── Override renderDecision ─────────────────────────────────────────────────
  window.renderDecision = function renderDecision(d) {
    const div = document.getElementById('inv-decision');
    if (!div) return;

    // ── Sin inversión ───────────────────────────────────────────────────────
    if (!d.shouldInvest) {
      const allCands = d.allCandidates || [];
      const candRows = allCands.length > 0
        ? `<div class="mt-3 border-t border-yellow-900/40 pt-3">
            <p class="text-xs text-gray-500 mb-2">Candidatos disponibles (sin cumplir umbral mínimo):</p>
            ${allCands.slice(0, 6).map(a => `
              <div class="flex justify-between items-center py-1 text-xs border-b border-gray-800/60 last:border-0">
                <span class="font-semibold text-gray-300 mono w-16">${(a.symbol || '').toUpperCase()}</span>
                <span class="text-blue-400">BP: ${Math.round((a.boostPower || 0) * 100)}%</span>
                <span class="${(a.predictedChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}">
                  Pred: ${(a.predictedChange || 0) >= 0 ? '+' : ''}${(a.predictedChange || 0).toFixed(1)}%
                </span>
              </div>`).join('')}
           </div>`
        : '';

      div.innerHTML = `
        <div class="bg-yellow-950 border border-yellow-800 rounded-xl p-4">
          <p class="text-yellow-400 font-semibold">⏸️ No invertir en este ciclo</p>
          <p class="text-gray-400 text-sm mt-1">${d.reason}</p>
          <p class="text-gray-500 text-sm mt-1">Capital disponible: $${d.capitalAvailable?.toFixed(2) || '—'} → se mantiene en ${window.investConfig?.stableCoin || 'USDT'}</p>
          ${candRows}
        </div>`;
      return;
    }

    // ── Con inversión: ordenar targets por predictedChange desc ────────────
    const targets = [...(d.targets || [])].sort(
      (a, b) => (b.predictedChange || 0) - (a.predictedChange || 0)
    );

    const allCands = d.allCandidates || targets;

    // ── Etiqueta de filtros activos ─────────────────────────────────────────
    const cfg = window.investConfig || {};
    const minPred  = cfg.minPredictedChange || 0;
    const minBP    = cfg.minBoostPower ? Math.round(cfg.minBoostPower * 100) : 65;
    const filterBadges = `
      <div class="flex flex-wrap gap-1.5 mb-3">
        <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-300">
          📈 Orden: mayor predicción primero
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
          BP ≥ ${minBP}%
        </span>
        ${minPred > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-green-950 border border-green-800 text-green-400">
          Pred mín ≥ +${minPred}%
        </span>` : ''}
        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-950 border border-blue-800 text-blue-300">
          💰 $${d.cycleCapital?.toFixed(0) || '—'} asignados
        </span>
      </div>`;

    // ── Cards de activos seleccionados ──────────────────────────────────────
    const RANK_COLORS = ['#f59e0b', '#9ca3af', '#b45309'];  // oro, plata, bronce
    const RANK_LABELS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

    const cols = targets.map((t, idx) => {
      const rankColor = RANK_COLORS[idx] || '#6b7280';
      const rankEmoji = RANK_LABELS[idx] || `#${idx + 1}`;
      const predColor = (t.predictedChange || 0) >= 10 ? '#22c55e'
                      : (t.predictedChange || 0) >= 5  ? '#86efac'
                      : '#a3e635';

      return `
        <div class="bg-gray-800 rounded-xl p-4 border-l-4" style="border-color:${rankColor}">
          <div class="flex justify-between items-start mb-2">
            <div class="flex items-center gap-2">
              <span class="text-lg">${rankEmoji}</span>
              <div>
                <p class="font-bold text-white mono">${(t.symbol || '').toUpperCase()}</p>
                <p class="text-xs text-gray-500 truncate max-w-[120px]">${t.name || ''}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="text-lg font-bold mono" style="color:${predColor}">
                +${(t.predictedChange || 0).toFixed(1)}%
              </p>
              <p class="text-xs text-gray-500">previsto</p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2 text-xs mb-3">
            <div class="bg-gray-900 rounded p-1.5 text-center">
              <p class="text-gray-500">BoostPower</p>
              <p class="font-semibold text-blue-400">${Math.round((t.boostPower || 0) * 100)}%</p>
            </div>
            <div class="bg-gray-900 rounded p-1.5 text-center">
              <p class="text-gray-500">Capital</p>
              <p class="font-semibold text-white">$${t.capitalUSD?.toFixed(0) || '—'}</p>
            </div>
          </div>

          <div class="flex justify-between text-xs text-gray-500 mb-3">
            <span>Entrada: <span class="text-white mono">$${_fmtPrice(t.entryPrice)}</span></span>
            <span class="text-green-400">TP: $${_fmtPrice(t.takeProfitPrice)}</span>
            <span class="text-red-400">SL: $${_fmtPrice(t.stopLossPrice)}</span>
          </div>

          <div class="flex gap-2">
            <button onclick="executeSingleDecision('${t.assetId}','${t.symbol}',${t.entryPrice})"
              class="flex-1 bg-green-800 hover:bg-green-700 px-3 py-1.5 rounded-lg text-xs font-semibold">
              ✅ Comprar
            </button>
          </div>
        </div>`;
    }).join('');

    // ── Tabla completa de candidatos (todos, no solo seleccionados) ─────────
    let allCandTable = '';
    if (allCands.length > targets.length) {
      const extras = allCands.filter(a => !targets.find(t => t.assetId === a.id || t.symbol === a.symbol));
      if (extras.length > 0) {
        allCandTable = `
          <div class="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-3">
            <p class="text-xs font-semibold text-gray-400 mb-2">
              📋 Otros candidatos elegibles (fuera del máximo de posiciones)
            </p>
            <div class="space-y-1">
              ${extras.map((a, i) => `
                <div class="flex justify-between items-center text-xs py-1 border-b border-gray-800/50 last:border-0">
                  <span class="font-semibold text-gray-300 mono w-16">${(a.symbol || '').toUpperCase()}</span>
                  <span class="text-gray-400">BP: <span class="text-blue-400">${Math.round((a.boostPower || 0) * 100)}%</span></span>
                  <span class="${(a.predictedChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
                    +${(a.predictedChange || 0).toFixed(1)}%
                  </span>
                  <span class="text-gray-600 mono">$${_fmtPrice(a.current_price)}</span>
                </div>`).join('')}
            </div>
          </div>`;
      }
    }

    // ── Renderizar ──────────────────────────────────────────────────────────
    div.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-2">
          <p class="text-sm font-semibold text-green-400">✅ ${targets.length} activo${targets.length !== 1 ? 's' : ''} seleccionado${targets.length !== 1 ? 's' : ''}</p>
          <p class="text-xs text-gray-500">${d.reason || ''}</p>
        </div>
        ${filterBadges}
        <div class="grid grid-cols-1 md:grid-cols-${Math.min(targets.length, 3)} gap-3">
          ${cols}
        </div>
        ${allCandTable}
      </div>`;
  };

  // ── Helper: formatear precio ─────────────────────────────────────────────
  function _fmtPrice(p) {
    if (!p && p !== 0) return '—';
    if (p < 0.01) return p.toFixed(6);
    if (p < 1)    return p.toFixed(4);
    if (p < 1000) return p.toFixed(2);
    return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // ── Helper: ejecutar compra de activo individual desde decisión ──────────
  window.executeSingleDecision = async function(assetId, symbol, price) {
    if (!confirm(`¿Abrir posición en ${symbol.toUpperCase()} a $${_fmtPrice(price)}?`)) return;
    try {
      const r = await fetch('/api/invest/buy-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, symbol, price }),
      });
      const d = await r.json();
      if (d.success) {
        // Toast de confirmación
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-800 border border-green-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
        toast.textContent = `✅ Posición abierta en ${symbol.toUpperCase()}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
        if (typeof loadInvestOverview === 'function') await loadInvestOverview();
      } else {
        alert('❌ ' + (d.error || 'Error desconocido'));
      }
    } catch (e) {
      alert('❌ ' + e.message);
    }
  };

  console.log('[patch-decide-priority] ✅ renderDecision mejorado: orden por predicción de crecimiento');
})();
