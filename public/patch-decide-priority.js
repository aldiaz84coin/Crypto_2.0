// ═══════════════════════════════════════════════════════════════════════════════
// PATCH: patch-decide-priority.js  (v3 — triple fix)
//
// FIX 1: executeSingleDecision — enviaba { assetId, symbol, price } pero el
//         backend /api/invest/buy-manual espera { assetData: { id, symbol, ... } }
//         → corregido para enviar el objeto assetData completo con todos los campos.
//
// FIX 2: extractAssetInfo — now reads current_price from ALL posible campo names
//         del snapshot (current_price, price, entryPrice, snapshotPrice) para
//         que las cards no muestren precio 0.
//
// FIX 3: Ordenación — los targets se ordenan estrictamente por predictedChange DESC
//         y dentro de allCandidates también, garantizando que INVERTIBLES con mayor
//         predicción aparezcan primero siempre.
//
// CÓMO FUNCIONA:
//   - Sobreescribe window.renderDecision
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
    if (p == null || isNaN(p) || p === 0) return '—';
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.01)   return p.toFixed(6);
    if (p < 1)      return p.toFixed(4);
    if (p < 1000)   return p.toFixed(2);
    return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // ── Extraer precio del asset (múltiples campos posibles según el origen) ─────
  function extractPrice(a) {
    // Orden de prioridad: entryPrice (puesto por investment-manager) → current_price
    // (CoinGecko) → price → snapshotPrice → 0
    const v = a.entryPrice ?? a.current_price ?? a.price ?? a.snapshotPrice ?? 0;
    return parseFloat(v) || 0;
  }

  // ── Extraer campos de un asset del snapshot (estructura variable) ───────────
  function extractAssetInfo(a) {
    const price = extractPrice(a);
    return {
      // ID y símbolo — todos los formatos posibles
      id:              a.id || a.assetId || a.coinId || '',
      symbol:          (a.symbol || '').toUpperCase(),
      name:            a.name || a.symbol || '—',
      // Métricas del algoritmo
      boostPower:      a.boostPower || 0,
      boostPowerPct:   a.boostPowerPct ?? a.boostPowerPercent ?? Math.round((a.boostPower || 0) * 100),
      predictedChange: typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0),
      price,
      classification:  classStr(a.classification),
      // Campos de trading calculados por investment-manager
      capitalUSD:      a.capitalUSD,
      takeProfitPrice: a.takeProfitPrice,
      stopLossPrice:   a.stopLossPrice,
      // Guardar el objeto original para poder enviarlo completo al backend
      _raw: a,
    };
  }

  // ── renderDecision sobreescrito ─────────────────────────────────────────────
  window.renderDecision = function renderDecision(d) {
    const div = document.getElementById('inv-decision');
    if (!div) return;

    // ─── Caso: no invertir ────────────────────────────────────────────────────
    if (!d.shouldInvest) {
      // Ordenar todos los candidatos por predicción desc para mostrar el ranking
      const allCands = [...(d.allCandidates || [])]
        .map(extractAssetInfo)
        .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

      const candRows = allCands.length > 0 ?
        `<div class="mt-3 border-t border-yellow-900/40 pt-3">
          <p class="text-xs text-gray-500 mb-1.5">Candidatos INVERTIBLE disponibles (orden por mayor predicción):</p>
          ${allCands.slice(0, 8).map((a, i) => `
            <div class="flex justify-between items-center py-1 text-xs border-b border-gray-800/40 last:border-0">
              <span class="text-gray-600 w-4">#${i+1}</span>
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
    // Ordenar targets por predictedChange desc
    const targets = [...(d.targets || [])]
      .map(extractAssetInfo)
      .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

    // Candidatos adicionales (todos los INVERTIBLE, excluidos los ya en targets)
    const allCands = [...(d.allCandidates || [])]
      .map(extractAssetInfo)
      .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));
    const extras = allCands.filter(a =>
      !targets.find(t => t.id === a.id || t.symbol === a.symbol)
    );

    // Filtros activos
    const cfg    = window.investConfig || {};
    const minBP  = cfg.minBoostPower ? Math.round(cfg.minBoostPower * 100) : 65;
    const minPred = cfg.minPredictedChange || 0;

    const filterBar = `
      <div class="flex flex-wrap gap-1.5 mb-3">
        <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-300 font-semibold">
          📈 Mayor predicción primero
        </span>
        <span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
          BP ≥ ${minBP}%
        </span>
        ${minPred > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-purple-950 border border-purple-800 text-purple-300">pred ≥ +${minPred}%</span>` : ''}
      </div>`;

    // Cards de targets principales
    const cards = targets.map((t, idx) => {
      const pctColor = t.predictedChange >= 0 ? 'text-green-400' : 'text-red-400';
      const bpColor  = t.boostPowerPct >= 75 ? 'text-green-400' : t.boostPowerPct >= 60 ? 'text-blue-400' : 'text-yellow-400';
      return `
        <div class="bg-gray-950 border border-green-900 rounded-xl p-3">
          <!-- Header -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-600 font-bold">#${idx + 1}</span>
              <div>
                <p class="font-bold text-sm">${t.symbol}</p>
                <p class="text-xs text-gray-500">${t.name}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="${pctColor} font-bold text-lg">${t.predictedChange >= 0 ? '+' : ''}${t.predictedChange.toFixed(1)}%</p>
              <p class="text-xs text-gray-500">predicción</p>
            </div>
          </div>

          <!-- Métricas -->
          <div class="grid grid-cols-3 gap-1.5 mb-2">
            <div class="bg-gray-900/80 rounded-lg p-2 text-center">
              <p class="text-gray-500 text-xs">BoostPwr</p>
              <p class="${bpColor} font-bold text-sm">${t.boostPowerPct}%</p>
            </div>
            <div class="bg-gray-900/80 rounded-lg p-2 text-center">
              <p class="text-gray-500 text-xs">Capital</p>
              <p class="font-bold text-white text-sm">$${t.capitalUSD != null ? t.capitalUSD.toFixed(0) : '—'}</p>
            </div>
            <div class="bg-gray-900/80 rounded-lg p-2 text-center">
              <p class="text-gray-500 text-xs">Precio</p>
              <p class="font-bold text-white mono text-xs">$${fmtP(t.price)}</p>
            </div>
          </div>

          <!-- TP / SL -->
          <div class="flex justify-between text-xs mb-3">
            <span class="text-green-400">TP: ${t.takeProfitPrice ? '$' + fmtP(t.takeProfitPrice) : '—'}</span>
            <span class="text-red-400">SL: ${t.stopLossPrice ? '$' + fmtP(t.stopLossPrice) : '—'}</span>
          </div>

          <!-- Acción -->
          <button
            onclick="executeSingleDecision(${JSON.stringify(t.id)}, ${JSON.stringify(t.symbol)}, ${t.price}, ${JSON.stringify(JSON.stringify(t._raw))})"
            class="w-full bg-green-800 hover:bg-green-700 active:bg-green-900 px-3 py-2 rounded-lg text-xs font-semibold transition-colors">
            ✅ Abrir posición
          </button>
        </div>`;
    }).join('');

    // Tabla de extras
    const extrasTable = extras.length > 0 ? `
      <div class="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-3">
        <p class="text-xs font-semibold text-gray-400 mb-2">
          📋 Otros INVERTIBLES elegibles (fuera del límite de ${targets.length} posiciones) — por mayor predicción
        </p>
        <div class="space-y-0.5">
          ${extras.map((a, i) => `
            <div class="flex justify-between items-center py-1.5 text-xs border-b border-gray-800/40 last:border-0">
              <span class="text-gray-400 w-5">#${targets.length + i + 1}</span>
              <span class="font-semibold mono text-gray-200 w-16">${a.symbol}</span>
              <span class="text-blue-400">BP: ${a.boostPowerPct}%</span>
              <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
                ${a.predictedChange >= 0 ? '+' : ''}${a.predictedChange.toFixed(1)}%
              </span>
              <span class="text-gray-600 mono">$${fmtP(a.price)}</span>
            </div>`).join('')}
        </div>
      </div>` : '';

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

  // ── Compra individual desde la decisión — FIX: enviar assetData correcto ────
  window.executeSingleDecision = async function(assetId, symbol, price, rawJsonStr) {
    const symUp = (symbol || '').toUpperCase();
    if (!confirm(`¿Abrir posición en ${symUp} a $${(parseFloat(price) || 0).toFixed(6)}?`)) return;

    // Reconstruir assetData completo desde el raw del snapshot
    let assetData = { id: assetId, symbol: symUp };
    try {
      if (rawJsonStr) {
        const raw = JSON.parse(rawJsonStr);
        // Mezclar todos los campos del raw con id/symbol garantizados
        assetData = {
          ...raw,
          id:     raw.id     || raw.assetId  || assetId,
          symbol: raw.symbol || symUp,
          current_price: raw.current_price ?? raw.entryPrice ?? raw.price ?? parseFloat(price) ?? 0,
        };
      }
    } catch (_) {
      assetData = {
        id:            assetId,
        symbol:        symUp,
        current_price: parseFloat(price) || 0,
      };
    }

    try {
      const r = await fetch('/api/invest/buy-manual', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ assetData }),
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

  console.log('[patch-decide-priority] ✅ v3 — assetData fix, precio desde snapshot, orden por predicción');
})();
