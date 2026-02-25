// ═══════════════════════════════════════════════════════════════════════════════
// PATCH: patch-decide-priority.js
//
// FIXES:
//   1. renderDecision — muestra cards con datos reales, ordenados por predicción
//   2. Normaliza classification (objeto o string) en el frontend
//   3. Muestra todos los candidatos elegibles bajo la selección principal
//   4. Indicadores visuales de filtros activos
//
// CÓMO FUNCIONA:
//   - Este patch sobreescribe window.renderDecision
//   - La función decideCycle() en index.html ya llama a renderDecision(d)
//   - No requiere cambios en decideCycle()
// ═══════════════════════════════════════════════════════════════════════════════

(function patchDecidePriority() {
  'use strict';

  // ── Normalizar classification (objeto o string) ─────────────────────────────
  function classStr(val) {
    if (!val) return 'RUIDOSO';
    if (typeof val === 'string') return val.toUpperCase();
    if (typeof val === 'object') return (val.category || val.label || 'RUIDOSO').toUpperCase();
    return 'RUIDOSO';
  }

  // ── Formatear precio ────────────────────────────────────────────────────────
  function fmtP(p) {
    if (p == null || isNaN(p)) return '—';
    if (p === 0) return '0';
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.01)   return p.toFixed(6);
    if (p < 1)      return p.toFixed(4);
    if (p < 1000)   return p.toFixed(2);
    return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // ── Extraer campos de un asset del snapshot (estructura variable) ───────────
  // Los assets del snapshot pueden venir con classificationDetail, boostPowerPercent, etc.
  function extractAssetInfo(a) {
    return {
      id:              a.id || a.assetId,
      symbol:          (a.symbol || '').toUpperCase(),
      name:            a.name || a.symbol || '—',
      boostPower:      a.boostPower || 0,
      boostPowerPct:   a.boostPowerPct ?? a.boostPowerPercent ?? Math.round((a.boostPower || 0) * 100),
      predictedChange: typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0),
      price:           a.entryPrice ?? a.current_price ?? 0,
      classification:  classStr(a.classification),
      capitalUSD:      a.capitalUSD,
      takeProfitPrice: a.takeProfitPrice,
      stopLossPrice:   a.stopLossPrice,
    };
  }

  // ── renderDecision sobreescrito ─────────────────────────────────────────────
  window.renderDecision = function renderDecision(d) {
    const div = document.getElementById('inv-decision');
    if (!div) return;

    // ─── Caso: no invertir ────────────────────────────────────────────────────
    if (!d.shouldInvest) {
      const allCands = (d.allCandidates || []).map(extractAssetInfo);

      const candRows = allCands.length > 0 ? `
        <div class="mt-3 border-t border-yellow-900/40 pt-3">
          <p class="text-xs text-gray-500 mb-1.5">Candidatos disponibles (insuficientes para operar):</p>
          ${allCands.slice(0, 8).map(a => `
            <div class="flex justify-between items-center py-1 text-xs border-b border-gray-800/40 last:border-0">
              <span class="font-semibold mono text-gray-200 w-16">${a.symbol}</span>
              <span class="text-blue-400">BP: ${a.boostPowerPct}%</span>
              <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
                ${a.predictedChange >= 0 ? '+' : ''}${a.predictedChange.toFixed(1)}%
              </span>
              <span class="text-gray-600 mono">$${fmtP(a.price)}</span>
            </div>`).join('')}
        </div>` : '';

      div.innerHTML = `
        <div class="bg-yellow-950 border border-yellow-800 rounded-xl p-4">
          <p class="text-yellow-400 font-semibold">⏸️ No invertir en este ciclo</p>
          <p class="text-gray-400 text-sm mt-1">${d.reason || ''}</p>
          <p class="text-gray-500 text-sm mt-1">Capital disponible: $${d.capitalAvailable?.toFixed(2) || '—'} → ${window.investConfig?.stableCoin || 'USDT'}</p>
          ${candRows}
        </div>`;
      return;
    }

    // ─── Caso: hay inversión ──────────────────────────────────────────────────
    // Ordenar targets recibidos por predictedChange desc (por si el backend cambia)
    const targets = [...(d.targets || [])]
      .map(extractAssetInfo)
      .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

    // Candidatos adicionales no seleccionados (vienen de allCandidates si el backend los devuelve)
    const allCands = (d.allCandidates || []).map(extractAssetInfo);
    const extras   = allCands.filter(a =>
      !targets.find(t => t.id === a.id || t.symbol === a.symbol)
    );

    // Filtros activos (leídos de investConfig si disponible)
    const cfg      = window.investConfig || {};
    const minPred  = cfg.minPredictedChange || 0;
    const minBP    = cfg.minBoostPower ? Math.round(cfg.minBoostPower * 100) : 65;

    const filterBar = `
      <div class="flex flex-wrap gap-1.5 mb-3">
        <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-300 font-semibold">
          📈 Orden: mayor predicción primero
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
          BP ≥ ${minBP}%
        </span>
        ${minPred > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-green-950 border border-green-800 text-green-400 font-semibold">
          Pred mín ≥ +${minPred}%
        </span>` : ''}
        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-950 border border-blue-800 text-blue-300">
          💰 $${d.cycleCapital?.toFixed(0) || '—'} en ciclo
        </span>
      </div>`;

    // Cards de activos seleccionados
    const MEDALS  = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    const BORDERS = ['#f59e0b', '#9ca3af', '#b45309', '#6b7280', '#6b7280'];

    const cards = targets.map((t, idx) => {
      const pred     = t.predictedChange || 0;
      const predCol  = pred >= 10 ? '#22c55e' : pred >= 5 ? '#86efac' : '#a3e635';
      const bpPct    = t.boostPowerPct || Math.round((t.boostPower || 0) * 100);

      return `
        <div class="bg-gray-800 rounded-xl p-4 border-l-4" style="border-color:${BORDERS[idx] || '#6b7280'}">
          <!-- Header: nombre + predicción -->
          <div class="flex justify-between items-start mb-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-lg flex-shrink-0">${MEDALS[idx] || `#${idx+1}`}</span>
              <div class="min-w-0">
                <p class="font-bold text-white mono leading-tight">${t.symbol}</p>
                <p class="text-xs text-gray-500 truncate">${t.name}</p>
              </div>
            </div>
            <div class="text-right flex-shrink-0 ml-2">
              <p class="text-xl font-bold mono" style="color:${predCol}">
                +${pred.toFixed(1)}%
              </p>
              <p class="text-xs text-gray-500">previsto</p>
            </div>
          </div>

          <!-- Métricas clave -->
          <div class="grid grid-cols-3 gap-2 text-xs mb-3">
            <div class="bg-gray-900/80 rounded-lg p-2 text-center">
              <p class="text-gray-500 text-xs">BoostPower</p>
              <p class="font-bold text-blue-400">${bpPct}%</p>
            </div>
            <div class="bg-gray-900/80 rounded-lg p-2 text-center">
              <p class="text-gray-500 text-xs">Capital</p>
              <p class="font-bold text-white">$${t.capitalUSD != null ? t.capitalUSD.toFixed(0) : '—'}</p>
            </div>
            <div class="bg-gray-900/80 rounded-lg p-2 text-center">
              <p class="text-gray-500 text-xs">Precio</p>
              <p class="font-bold text-white mono text-xs">$${fmtP(t.price)}</p>
            </div>
          </div>

          <!-- TP / SL -->
          <div class="flex justify-between text-xs mb-3">
            <span class="text-green-400">TP: $${fmtP(t.takeProfitPrice)}</span>
            <span class="text-red-400">SL: $${fmtP(t.stopLossPrice)}</span>
          </div>

          <!-- Acción -->
          <button
            onclick="executeSingleDecision('${t.id}','${t.symbol}',${t.price})"
            class="w-full bg-green-800 hover:bg-green-700 active:bg-green-900 px-3 py-2 rounded-lg text-xs font-semibold transition-colors">
            ✅ Abrir posición
          </button>
        </div>`;
    }).join('');

    // Tabla de candidatos extra
    const extrasTable = extras.length > 0 ? `
      <div class="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-3">
        <p class="text-xs font-semibold text-gray-400 mb-2">
          📋 Otros candidatos elegibles (fuera del límite de ${targets.length} posiciones)
        </p>
        <div class="space-y-0.5">
          ${extras.map((a, i) => `
            <div class="flex justify-between items-center py-1.5 text-xs border-b border-gray-800/40 last:border-0">
              <span class="text-gray-400 w-5">#${targets.length + i + 1}</span>
              <span class="font-semibold mono text-gray-200 w-16">${a.symbol}</span>
              <span class="text-blue-400">BP: ${a.boostPowerPct}%</span>
              <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
                +${a.predictedChange.toFixed(1)}%
              </span>
              <span class="text-gray-600 mono">$${fmtP(a.price)}</span>
            </div>`).join('')}
        </div>
      </div>` : '';

    // Render final
    div.innerHTML = `
      <div>
        <div class="flex justify-between items-center mb-2">
          <p class="text-sm font-semibold text-green-400">
            ✅ ${targets.length} activo${targets.length !== 1 ? 's' : ''} seleccionado${targets.length !== 1 ? 's' : ''}
          </p>
          <p class="text-xs text-gray-500 max-w-xs text-right">${d.reason || ''}</p>
        </div>
        ${filterBar}
        <div class="grid grid-cols-1 ${targets.length >= 2 ? 'md:grid-cols-2' : ''} ${targets.length >= 3 ? 'lg:grid-cols-3' : ''} gap-3">
          ${cards}
        </div>
        ${extrasTable}
      </div>`;
  };

  // ── Compra individual desde la decisión ─────────────────────────────────────
  window.executeSingleDecision = async function(assetId, symbol, price) {
    const symUp = (symbol || '').toUpperCase();
    if (!confirm(`¿Abrir posición en ${symUp} a $${(parseFloat(price) || 0).toFixed(6)}?`)) return;
    try {
      const r = await fetch('/api/invest/buy-manual', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assetId, symbol, price }),
      });
      const data = await r.json();
      if (data.success) {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-800 border border-green-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
        toast.textContent = `✅ Posición abierta en ${symUp}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
        if (typeof loadInvestOverview === 'function') await loadInvestOverview();
      } else {
        alert('❌ ' + (data.error || 'Error desconocido'));
      }
    } catch (e) {
      alert('❌ ' + e.message);
    }
  };

  console.log('[patch-decide-priority] ✅ renderDecision v2 — orden por predicción, classification normalizado');
})();
