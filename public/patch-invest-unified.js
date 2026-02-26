// ════════════════════════════════════════════════════════════════════════════
//  PATCH: patch-invest-unified.js  (v5)
//
//  REEMPLAZA:
//    - patch-rounds-v3.js         (loadInvestRounds, loadInvestOverview,
//                                  executeCloseRound, renderizador de rondas)
//    - patch-fix-orphaned-positions.js  (banner, modal, closeOrphanedPositions)
//    - patch-decide-priority.js   (renderDecision, extractAssetInfo, sorting)
//    - patch-new-round-simple.js  (openNewRoundWizard, submitNewRound)
//    - patch-positions-expandable.js  (hook loadInvestPositions)
//    - patch-rounds-expandable.js     (hook loadInvestRounds)
//    - patch-performance-v2.js    (loadInvestRounds override)
//    - patch-round-verbose.js     (verbose round display)
//
//  BUGS CORREGIDOS:
//    BUG 1 – Posiciones abiertas bloquean nueva ronda pero no se ven:
//            → Banner siempre visible + listado de posiciones con close
//            → close-orphaned funciona (endpoint backend implementado)
//
//    BUG 2 – Carga de activos incompleta en tab inversión:
//            → allCandidates ahora llega del backend
//            → Fallback: si snapshot no tiene predictedChange, se avisa
//
//    BUG 3 – No se ordena por predicción / criterios no visibles:
//            → filterBar muestra criterios activos
//            → _debug del backend expone todos los filtros aplicados
//
//  INSTALACIÓN (public/index.html):
//    Reemplazar TODOS los patch-* de inversión por UNA sola línea:
//      <script src="/patch-invest-unified.js"></script>
//    (Los otros patches no relacionados con inversión se mantienen)
// ════════════════════════════════════════════════════════════════════════════
(function() {
'use strict';

// ─── Utilidades compartidas ───────────────────────────────────────────────────
function classStr(val) {
  if (!val) return 'RUIDOSO';
  if (typeof val === 'string') return val.toUpperCase();
  if (typeof val === 'object') return (val.category || val.label || 'RUIDOSO').toUpperCase();
  return 'RUIDOSO';
}

function fmtP(p) {
  if (p == null || isNaN(p) || p === 0) return '—';
  if (p < 0.0001) return p.toFixed(8);
  if (p < 0.01)   return p.toFixed(6);
  if (p < 1)      return p.toFixed(4);
  if (p < 1000)   return p.toFixed(2);
  return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtUsd(v) {
  const n = parseFloat(v) || 0;
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

function extractPrice(a) {
  const v = a.entryPrice ?? a.current_price ?? a.price ?? a.snapshotPrice ?? 0;
  return parseFloat(v) || 0;
}

function extractAssetInfo(a) {
  const price = extractPrice(a);
  return {
    id:              a.id || a.assetId || a.coinId || '',
    symbol:          (a.symbol || '').toUpperCase(),
    name:            a.name || a.symbol || '—',
    boostPower:      a.boostPower || 0,
    boostPowerPct:   a.boostPowerPct ?? a.boostPowerPercent ?? Math.round((a.boostPower || 0) * 100),
    predictedChange: typeof a.predictedChange === 'number' ? a.predictedChange : parseFloat(a.predictedChange || 0),
    price,
    classification:  classStr(a.classification),
    capitalUSD:      a.capitalUSD,
    takeProfitPrice: a.takeProfitPrice,
    stopLossPrice:   a.stopLossPrice,
    _raw: a,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  SECCIÓN 1: renderDecision — BUG 3 FIX
//  Muestra criterios activos, ordena por predicción, expone debug
// ════════════════════════════════════════════════════════════════════════════
window.renderDecision = function renderDecision(d) {
  const div = document.getElementById('inv-decision');
  if (!div) return;

  const cfg     = window.investConfig || {};
  const dbg     = d._debug || {};
  const minBP   = dbg.minBoostPowerPct ?? Math.round((cfg.minBoostPower || 0.65) * 100);
  const minPred = dbg.minPredictedChange ?? cfg.minPredictedChange ?? 0;

  // ── Panel de criterios activos (siempre visible para debug) ──────────────
  const criteriaHtml = `
    <div class="flex flex-wrap gap-1.5 mb-3">
      <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-300 font-semibold">
        📈 Mayor predicción primero
      </span>
      <span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
        🟢 Solo INVERTIBLE
      </span>
      <span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-400">
        BP ≥ ${minBP}%${dbg.minBoostPowerActive !== cfg.minBoostPower ? ' <span class="text-yellow-400">(sincronizado)</span>' : ''}
      </span>
      ${minPred > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-purple-950 border border-purple-800 text-purple-300">pred ≥ +${minPred}%</span>` : ''}
    </div>`;

  // ── Panel de debug (snapshot stats) ─────────────────────────────────────
  let debugHtml = '';
  if (dbg.snapshotTotal != null) {
    const noPred = dbg.snapshotHasPredictedChange === 0;
    debugHtml = `
      <div class="mt-3 p-2 bg-gray-900 rounded-lg border border-gray-800 text-xs text-gray-500 space-y-0.5">
        <p class="font-semibold text-gray-400 mb-1">🔍 Debug filtros</p>
        <p>Snapshot: <span class="text-gray-300">${dbg.snapshotTotal} activos</span> 
           → INVERTIBLE: <span class="text-green-400">${dbg.invertiblesTotal}</span>
           → pasan BP: <span class="${dbg.invertiblesPassingBP > 0 ? 'text-green-400' : 'text-red-400'}">${dbg.invertiblesPassingBP}</span>
           → fallan pred: <span class="text-yellow-400">${dbg.invertiblesFailingPredFilter || 0}</span>
           → candidatos finales: <span class="${dbg.invertiblesPassingAll >= (dbg.minSignalsRequired||2) ? 'text-green-400':'text-red-400'}">${dbg.invertiblesPassingAll}</span>
           (mín ${dbg.minSignalsRequired||2})
        </p>
        ${noPred ? '<p class="text-orange-400">⚠️ Activos sin predictedChange — carga el Monitor primero</p>' : ''}
        <p class="text-gray-600">Posiciones abiertas: ${dbg.openPositions||0}/${dbg.maxPositions||3}</p>
      </div>`;
  }

  // ── Caso: no invertir ────────────────────────────────────────────────────
  if (!d.shouldInvest) {
    const allCands = [...(d.allCandidates || [])]
      .map(extractAssetInfo)
      .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

    const candRows = allCands.length > 0 ? `
      <div class="mt-3 border-t border-yellow-900/40 pt-3">
        <p class="text-xs text-gray-500 mb-1.5">Candidatos INVERTIBLE disponibles (mayor predicción primero):</p>
        ${allCands.slice(0, 10).map((a, i) => `
          <div class="flex justify-between items-center py-1 text-xs border-b border-gray-800/40 last:border-0">
            <span class="text-gray-600 w-4">#${i+1}</span>
            <span class="font-semibold mono text-gray-200 w-16">${a.symbol}</span>
            <span class="text-blue-400">BP: ${a.boostPowerPct}%</span>
            <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
              ${a.predictedChange >= 0 ? '+' : ''}${a.predictedChange.toFixed(1)}%
            </span>
            <span class="text-gray-600 mono">$${fmtP(a.price)}</span>
          </div>`).join('')}
      </div>` : '<p class="text-xs text-gray-600 mt-2">Sin candidatos INVERTIBLE en el snapshot actual.</p>';

    div.innerHTML = `
      <div class="bg-yellow-950 border border-yellow-800 rounded-xl p-4">
        ${criteriaHtml}
        <p class="text-yellow-400 font-semibold">⏸️ No invertir en este ciclo</p>
        <p class="text-gray-400 text-sm mt-1">${d.reason || ''}</p>
        <p class="text-gray-500 text-sm mt-1">Capital disponible: $${d.capitalAvailable?.toFixed(2) || '—'} → ${window.investConfig?.stableCoin || 'USDT'}</p>
        ${candRows}
        ${debugHtml}
      </div>`;
    return;
  }

  // ── Caso: hay inversión ──────────────────────────────────────────────────
  const targets = [...(d.targets || [])]
    .map(extractAssetInfo)
    .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

  const allCands = [...(d.allCandidates || [])]
    .map(extractAssetInfo)
    .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

  const extras = allCands.filter(a => !targets.find(t => t.id === a.id || t.symbol === a.symbol));

  const cards = targets.map((t, idx) => {
    const pctColor = t.predictedChange >= 0 ? 'text-green-400' : 'text-red-400';
    const bpColor  = t.boostPowerPct >= 75 ? 'text-green-400' : t.boostPowerPct >= 60 ? 'text-yellow-400' : 'text-red-400';
    return `
      <div class="bg-gray-800 rounded-xl p-3 border border-gray-700 relative">
        <div class="flex justify-between items-start mb-2">
          <div>
            <span class="text-xs text-gray-500">#${idx+1}</span>
            <p class="font-bold text-white">${t.symbol}</p>
            <p class="text-xs text-gray-500 truncate">${t.name}</p>
          </div>
          <span class="text-2xl font-bold ${pctColor}">${t.predictedChange >= 0 ? '+' : ''}${t.predictedChange.toFixed(1)}%</span>
        </div>
        <div class="grid grid-cols-2 gap-1 text-xs">
          <div><p class="text-gray-500">BoostPower</p><p class="${bpColor} font-semibold">${t.boostPowerPct}%</p></div>
          <div><p class="text-gray-500">Precio</p><p class="text-gray-200 mono">$${fmtP(t.price)}</p></div>
          <div><p class="text-gray-500">Capital</p><p class="text-blue-400 font-semibold">$${(t.capitalUSD||0).toFixed(0)}</p></div>
          <div><p class="text-gray-500">Clasificación</p><p class="text-green-400 font-semibold text-xs">${t.classification}</p></div>
        </div>
        ${t.takeProfitPrice ? `
          <div class="mt-2 flex gap-1 text-xs">
            <span class="flex-1 bg-green-950 text-green-400 text-center py-0.5 rounded">TP: $${fmtP(t.takeProfitPrice)}</span>
            <span class="flex-1 bg-red-950 text-red-400 text-center py-0.5 rounded">SL: $${fmtP(t.stopLossPrice)}</span>
          </div>` : ''}
        <button 
          onclick="window._piuExecuteSingle('${t._raw.assetId || t.id}','${t.symbol}',${t.price})"
          class="mt-2 w-full bg-indigo-700 hover:bg-indigo-600 py-1.5 rounded-lg text-xs font-bold transition-colors">
          💰 Comprar ${t.symbol}
        </button>
      </div>`;
  }).join('');

  const extrasHtml = extras.length > 0 ? `
    <div class="mt-3 border-t border-gray-800 pt-3">
      <p class="text-xs text-gray-500 mb-1.5">Otros candidatos disponibles:</p>
      ${extras.slice(0, 5).map((a, i) => `
        <div class="flex justify-between items-center py-1 text-xs border-b border-gray-800/40 last:border-0">
          <span class="font-semibold mono text-gray-300 w-16">${a.symbol}</span>
          <span class="text-blue-400">BP: ${a.boostPowerPct}%</span>
          <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
            ${a.predictedChange >= 0 ? '+' : ''}${a.predictedChange.toFixed(1)}%
          </span>
        </div>`).join('')}
    </div>` : '';

  div.innerHTML = `
    <div class="bg-green-950 border border-green-800 rounded-xl p-4">
      ${criteriaHtml}
      <p class="text-green-400 font-semibold mb-1">✅ ${targets.length} inversión${targets.length!==1?'es':''} recomendada${targets.length!==1?'s':''}</p>
      <p class="text-gray-400 text-sm mb-3">${d.reason || ''} · Capital: $${d.cycleCapital?.toFixed(0)||'—'} · Modo: ${d.mode||'—'}</p>
      <div class="grid grid-cols-${Math.min(targets.length,3)} gap-3 mb-3">${cards}</div>
      <button onclick="executeInvestment()" class="w-full bg-green-700 hover:bg-green-600 py-3 rounded-xl font-bold text-lg transition-colors">
        ${d.mode==='simulated'?'⚗️ Ejecutar (Simulado)':'💵 Ejecutar INVERSIÓN REAL'}
      </button>
      ${extrasHtml}
      ${debugHtml}
    </div>`;

  window._pendingTargets = d;
};

// ── Compra individual desde renderDecision ───────────────────────────────────
window._piuExecuteSingle = async function(assetId, symbol, price) {
  const symUp = symbol.toUpperCase();
  let assetData;
  try {
    const src = window._pendingTargets?.targets?.find(t => t.assetId === assetId || t.symbol === symUp)
             || window._pendingTargets?.allCandidates?.find(a => (a.id||a.assetId) === assetId || a.symbol === symUp);
    if (src) {
      assetData = {
        id:              src.assetId || src.id || assetId,
        symbol:          symUp,
        name:            src.name || symUp,
        current_price:   extractPrice(src),
        boostPower:      src.boostPower || 0,
        predictedChange: src.predictedChange || 0,
        classification:  classStr(src.classification),
      };
    } else {
      assetData = { id: assetId, symbol: symUp, current_price: parseFloat(price) || 0 };
    }
  } catch (_) {
    assetData = { id: assetId, symbol: symUp, current_price: parseFloat(price) || 0 };
  }
  try {
    const r    = await fetch('/api/invest/buy-manual', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ assetData }) });
    const data = await r.json();
    if (data.success) {
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-800 border border-green-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
      toast.textContent = `✅ Posición abierta en ${symUp}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
      if (typeof loadInvestOverview === 'function') await loadInvestOverview();
      if (typeof loadInvestPositions === 'function') await loadInvestPositions();
    } else {
      alert('❌ ' + (data.error || 'Error desconocido'));
    }
  } catch (e) { alert('❌ ' + e.message); }
};


// ════════════════════════════════════════════════════════════════════════════
//  SECCIÓN 2: Posiciones huérfanas — BUG 1 FIX
//  Banner visible, modal de limpieza, endpoint close-orphaned funcional
// ════════════════════════════════════════════════════════════════════════════

// ── Listado de posiciones abiertas en HTML ──────────────────────────────────
function renderOrphanPositionRow(p) {
  const pnlColor = (p.unrealizedPnL || 0) >= 0 ? 'text-green-400' : 'text-red-400';
  const pnlPct   = (p.unrealizedPnLPct || 0).toFixed(1);
  const pnlUsd   = (p.unrealizedPnL || 0).toFixed(2);
  return `
    <div class="flex items-center justify-between py-2 px-3 bg-gray-900 rounded-lg mb-1.5 text-sm">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-orange-400 animate-pulse inline-block"></span>
        <span class="font-bold text-white">${p.symbol}</span>
        <span class="text-gray-500 text-xs">$${fmtP(p.capitalUSD || 0)} invertido</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="${pnlColor} font-semibold text-xs">${(p.unrealizedPnL||0) >= 0?'+':''}${pnlPct}% (${(p.unrealizedPnL||0) >= 0?'+':''}$${pnlUsd})</span>
        <button 
          onclick="window._piuCloseSinglePosition('${p.id}','${p.symbol}')"
          class="bg-red-900 hover:bg-red-700 text-red-200 px-2 py-0.5 rounded text-xs font-semibold transition-colors">
          Cerrar
        </button>
      </div>
    </div>`;
}

// ── Inyectar banner de posiciones huérfanas ──────────────────────────────────
function _piuInjectOrphanBanner(openPositions) {
  document.getElementById('piu-orphan-banner')?.remove();

  const target = document.getElementById('inv-no-round-banner')?.parentElement
               || document.getElementById('content-invest');
  if (!target) return;

  const count  = openPositions.length;
  const banner = document.createElement('div');
  banner.id    = 'piu-orphan-banner';
  banner.className = 'bg-orange-950 border border-orange-700 rounded-xl p-4 mb-4 mx-0 mt-2';
  banner.innerHTML = `
    <div class="flex items-start gap-3">
      <span class="text-2xl">⚠️</span>
      <div class="flex-1">
        <p class="font-bold text-orange-300">
          ${count} posición${count!==1?'es':''} abierta${count!==1?'s':''} sin ronda activa
        </p>
        <p class="text-xs text-orange-400 mt-0.5">
          La ronda anterior se cerró pero quedaron posiciones abiertas.
          Deben cerrarse antes de abrir una nueva ronda.
        </p>
        <div class="mt-3 space-y-1">
          ${openPositions.map(p => renderOrphanPositionRow(p)).join('')}
        </div>
        <div class="flex gap-2 mt-3">
          <button
            onclick="window.closeOrphanedPositions()"
            class="flex-1 bg-orange-700 hover:bg-orange-600 px-3 py-2 rounded-lg text-sm font-bold transition-colors">
            🧹 Cerrar todas (${count})
          </button>
          <button
            onclick="window.piuRefreshOrphanBanner()"
            class="bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg text-sm font-semibold transition-colors">
            🔄
          </button>
        </div>
      </div>
    </div>`;

  // Insertar después del banner "sin ronda"
  const refBanner = document.getElementById('inv-no-round-banner');
  if (refBanner?.nextSibling) {
    target.insertBefore(banner, refBanner.nextSibling);
  } else {
    target.prepend(banner);
  }
}

// ── Cerrar posición individual ───────────────────────────────────────────────
window._piuCloseSinglePosition = async function(posId, symbol) {
  if (!confirm(`¿Cerrar posición ${symbol}?`)) return;
  try {
    const r = await fetch(`/api/invest/positions/${posId}/close`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
    const d = await r.json();
    if (d.success) {
      await window.piuRefreshOrphanBanner();
      if (typeof loadInvestPositions === 'function') await loadInvestPositions();
    } else {
      alert('❌ ' + (d.error || 'Error al cerrar'));
    }
  } catch(e) { alert('❌ ' + e.message); }
};

// ── Cerrar todas las posiciones huérfanas ───────────────────────────────────
window.closeOrphanedPositions = async function({ silent = false } = {}) {
  try {
    const r = await fetch('/api/invest/positions/close-orphaned', { method: 'POST' });
    const d = await r.json();
    if (!d.success) {
      if (!silent) alert('❌ ' + (d.error || 'Error al cerrar posiciones huérfanas'));
      return false;
    }
    document.getElementById('piu-orphan-banner')?.remove();
    if (!silent) {
      const closed = d.closedCount || 0;
      const toast  = document.createElement('div');
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-indigo-800 border border-indigo-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
      toast.textContent = `✅ ${closed} posición${closed!==1?'es':''} cerrada${closed!==1?'s':''}`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }
    await Promise.all([
      typeof loadInvestPositions  === 'function' ? loadInvestPositions()  : Promise.resolve(),
      typeof loadInvestOverview   === 'function' ? loadInvestOverview()   : Promise.resolve(),
      typeof loadInvestRounds     === 'function' ? loadInvestRounds()     : Promise.resolve(),
    ]);
    return true;
  } catch(e) {
    if (!silent) alert('❌ ' + e.message);
    return false;
  }
};

// ── Refrescar banner ─────────────────────────────────────────────────────────
window.piuRefreshOrphanBanner = async function() {
  try {
    const [roundsRes, posRes] = await Promise.all([
      fetch('/api/invest/rounds').then(r => r.json()),
      fetch('/api/invest/positions').then(r => r.json()),
    ]);
    const hasActiveRound = roundsRes.success && roundsRes.current?.status === 'active';
    const openPos        = posRes.success ? (posRes.open || []) : [];
    if (!hasActiveRound && openPos.length > 0) {
      _piuInjectOrphanBanner(openPos);
    } else {
      document.getElementById('piu-orphan-banner')?.remove();
    }
  } catch (_) {}
};

// ════════════════════════════════════════════════════════════════════════════
//  SECCIÓN 3: loadCurrentRoundBanner — override para mostrar huérfanas
// ════════════════════════════════════════════════════════════════════════════
const _piu_origBanner = window.loadCurrentRoundBanner;
window.loadCurrentRoundBanner = async function() {
  if (_piu_origBanner) await _piu_origBanner();
  await window.piuRefreshOrphanBanner();
};

// ════════════════════════════════════════════════════════════════════════════
//  SECCIÓN 4: openNewRoundWizard — BUG 1 FIX
//  Verifica posiciones abiertas antes de abrir el wizard
// ════════════════════════════════════════════════════════════════════════════
window.openNewRoundWizard = async function() {
  try {
    const posRes   = await fetch('/api/invest/positions').then(r => r.json());
    const openPos  = posRes.success ? (posRes.open || []) : [];
    if (openPos.length > 0) {
      _piuInjectOrphanBanner(openPos);
      // Hacer scroll al banner
      document.getElementById('piu-orphan-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  } catch (_) {}
  _piuShowNewRoundModal();
};

// ── Modal nueva ronda ────────────────────────────────────────────────────────
function _piuShowNewRoundModal() {
  document.getElementById('piu-new-round-modal')?.remove();
  const cfg = window.investConfig || {};

  const fmtPct = v => v != null ? `+${parseFloat(v).toFixed(0)}%` : '—';

  const modal = document.createElement('div');
  modal.id    = 'piu-new-round-modal';
  modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
  modal.innerHTML = `
    <div class="bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
      <div class="flex justify-between items-center px-6 py-4 border-b border-gray-800">
        <h3 class="text-lg font-bold">🚀 Nueva Ronda de Inversión</h3>
        <button onclick="document.getElementById('piu-new-round-modal').remove()" class="text-gray-500 hover:text-white text-2xl leading-none">×</button>
      </div>
      <div class="p-5 space-y-3">
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-0.5">Capital total</p>
            <p class="font-bold text-white">$${cfg.capitalTotal?.toLocaleString() || '1,000'}</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-0.5">Por ciclo</p>
            <p class="font-bold text-white">${Math.round((cfg.capitalPerCycle||0.3)*100)}%</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-0.5">Take Profit</p>
            <p class="font-bold text-green-400">${fmtPct(cfg.takeProfitPct)}</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-0.5">Stop Loss</p>
            <p class="font-bold text-red-400">-${parseFloat(cfg.stopLossPct||5).toFixed(0)}%</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-0.5">Modo</p>
            <p class="font-bold ${cfg.mode==='real'?'text-red-400':'text-blue-400'}">${cfg.mode||'simulated'}</p>
          </div>
          <div class="bg-gray-800 rounded-lg p-3">
            <p class="text-gray-500 text-xs mb-0.5">Máx posiciones</p>
            <p class="font-bold text-white">${cfg.maxPositions||3}</p>
          </div>
        </div>
        <p class="text-xs text-gray-600">Parámetros desde Inversión → Configuración</p>
        <div id="piu-nr-status" class="hidden text-sm text-gray-400"></div>
      </div>
      <div class="p-4 border-t border-gray-800 flex gap-2">
        <button onclick="document.getElementById('piu-new-round-modal').remove()"
          class="flex-1 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold">
          Cancelar
        </button>
        <button id="piu-btn-open-round" onclick="window._piuSubmitNewRound()"
          class="flex-1 bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold">
          🚀 Abrir Ronda
        </button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

window._piuSubmitNewRound = async function() {
  const btn    = document.getElementById('piu-btn-open-round');
  const status = document.getElementById('piu-nr-status');
  if (!btn) return;
  btn.disabled  = true;
  btn.innerHTML = '⏳ Abriendo...';
  if (status) { status.classList.remove('hidden'); status.textContent = 'Abriendo nueva ronda...'; }
  try {
    const r = await fetch('/api/invest/rounds/open', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
    const d = await r.json();
    if (!d.success) {
      if (status) status.textContent = '❌ ' + d.error;
      btn.disabled  = false;
      btn.innerHTML = '🚀 Abrir Ronda';
      // Si el error es de posiciones abiertas, mostrar el banner
      if (d.error?.includes('posiciones abiertas')) {
        document.getElementById('piu-new-round-modal')?.remove();
        await window.piuRefreshOrphanBanner();
      }
      return;
    }
    document.getElementById('piu-new-round-modal')?.remove();
    await Promise.all([
      typeof loadCurrentRoundBanner === 'function' ? loadCurrentRoundBanner() : Promise.resolve(),
      typeof loadInvestPositions    === 'function' ? loadInvestPositions()    : Promise.resolve(),
      typeof loadInvestOverview     === 'function' ? loadInvestOverview()     : Promise.resolve(),
      typeof loadInvestRounds       === 'function' ? loadInvestRounds()       : Promise.resolve(),
    ]);
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-indigo-800 border border-indigo-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
    toast.textContent = `✅ Ronda #${d.round?.roundNumber||'?'} abierta`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  } catch(e) {
    if (status) status.textContent = '❌ ' + e.message;
    btn.disabled  = false;
    btn.innerHTML = '🚀 Abrir Ronda';
  }
};


// ════════════════════════════════════════════════════════════════════════════
//  SECCIÓN 5: loadInvestRounds — override unificado
//  Reemplaza patch-rounds-v3 + patch-performance-v2 + patch-rounds-expandable
// ════════════════════════════════════════════════════════════════════════════
window.loadInvestRounds = async function() {
  const activeDiv = document.getElementById('inv-rounds-active');
  const histDiv   = document.getElementById('inv-rounds-history');
  if (!activeDiv || !histDiv) return;

  try {
    const [roundsRes, posRes] = await Promise.all([
      fetch('/api/invest/rounds').then(r => r.json()),
      fetch('/api/invest/positions').then(r => r.json()),
    ]);
    if (!roundsRes.success) {
      histDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${roundsRes.error}</p>`;
      return;
    }

    const current = roundsRes.current;
    const rounds  = roundsRes.rounds || [];
    const allPos  = posRes.success ? [...(posRes.open||[]), ...(posRes.closed||[])] : [];

    // ── Ronda activa ──────────────────────────────────────────────────────
    if (current?.status === 'active') {
      const roundStart = current.openedAt ? new Date(current.openedAt).getTime() : 0;
      const roundPos   = allPos
        .filter(p => { const t = p.openedAt ? new Date(p.openedAt).getTime() : 0; return roundStart > 0 && t >= roundStart; })
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
          return (b.closedAt ? new Date(b.closedAt).getTime() : 0) - (a.closedAt ? new Date(a.closedAt).getTime() : 0);
        });

      const openPos    = roundPos.filter(p => p.status === 'open');
      const closedPos  = roundPos.filter(p => p.status === 'closed');
      const realPnL    = closedPos.reduce((s,p) => s+(p.realizedPnL||0), 0);
      const unrPnL     = openPos.reduce((s,p) => s+(p.unrealizedPnL||0), 0);
      const totalFees  = closedPos.reduce((s,p) => s+(p.totalFeesUSD||0), 0);
      const winRate    = closedPos.length > 0 ? Math.round(closedPos.filter(p=>(p.realizedPnL||0)>0).length/closedPos.length*100) : null;
      const netColor   = (realPnL-totalFees) >= 0 ? 'text-green-400' : 'text-red-400';

      // Posiciones expandibles
      const posHtml = roundPos.length === 0
        ? '<p class="text-gray-600 text-xs mt-2">Sin posiciones aún en esta ronda.</p>'
        : `<div class="mt-3" id="piu-round-positions">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs font-semibold text-gray-400">${openPos.length} abierta${openPos.length!==1?'s':''} · ${closedPos.length} cerrada${closedPos.length!==1?'s':''}</p>
              <button onclick="document.getElementById('piu-rnd-pos-list').classList.toggle('hidden')" 
                class="text-xs text-gray-500 hover:text-gray-300">
                Ver/Ocultar posiciones
              </button>
            </div>
            <div id="piu-rnd-pos-list" class="space-y-2">
              ${roundPos.map(p => typeof renderPositionCard === 'function' ? renderPositionCard(p, p.status==='open') : _piuMiniPos(p)).join('')}
            </div>
          </div>`;

      activeDiv.innerHTML = `
        <div class="bg-indigo-950 border border-indigo-800 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="font-bold text-indigo-200">Ronda #${current.roundNumber || '—'} activa</p>
              <p class="text-xs text-gray-500">${fmtDate(current.openedAt)}</p>
            </div>
            <button onclick="window.openCloseRoundModal ? openCloseRoundModal() : alert('función no disponible')"
              class="bg-red-900 hover:bg-red-700 text-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors">
              🏁 Cerrar Ronda
            </button>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center text-xs mb-2">
            <div class="bg-gray-900 rounded-lg p-2">
              <p class="text-gray-500">Posiciones</p>
              <p class="font-bold text-white">${openPos.length} abiertas / ${closedPos.length} cerradas</p>
            </div>
            <div class="bg-gray-900 rounded-lg p-2">
              <p class="text-gray-500">P&L Realizado</p>
              <p class="font-bold ${(realPnL-totalFees)>=0?'text-green-400':'text-red-400'}">${fmtUsd(realPnL-totalFees)}</p>
            </div>
            <div class="bg-gray-900 rounded-lg p-2">
              <p class="text-gray-500">No Realizado</p>
              <p class="font-bold ${unrPnL>=0?'text-green-400':'text-red-400'}">${fmtUsd(unrPnL)}</p>
            </div>
          </div>
          ${winRate !== null ? `<p class="text-xs text-gray-500 mb-1">Win rate: <span class="${winRate>=50?'text-green-400':'text-red-400'} font-semibold">${winRate}%</span></p>` : ''}
          ${posHtml}
        </div>`;
    } else {
      activeDiv.innerHTML = `
        <div id="piu-no-round" class="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p class="text-gray-500 text-sm">Sin ronda activa.</p>
          <button onclick="window.openNewRoundWizard()"
            class="mt-2 bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold transition-colors">
            🚀 Abrir Nueva Ronda
          </button>
        </div>`;
      // Verificar huérfanas
      await window.piuRefreshOrphanBanner();
    }

    // ── Historial de rondas ───────────────────────────────────────────────
    const completedRounds = rounds.filter(r => r.status === 'closed' || r.status === 'completed');
    histDiv.innerHTML = completedRounds.length === 0
      ? '<p class="text-gray-500 text-sm">Sin rondas completadas.</p>'
      : completedRounds.slice(0, 15).map(rnd => {
          const rPnL   = (rnd.metrics?.totalPnLUSD || 0);
          const rFees  = (rnd.metrics?.totalFeesUSD || 0);
          const net    = rPnL - rFees;
          const posArr = allPos.filter(p => { const t = p.openedAt ? new Date(p.openedAt).getTime() : 0; const s = rnd.openedAt ? new Date(rnd.openedAt).getTime() : 0; return t >= s; });
          return `
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-2">
            <div class="flex justify-between items-center">
              <div>
                <p class="font-semibold text-white text-sm">Ronda #${rnd.roundNumber||'—'}</p>
                <p class="text-xs text-gray-500">${fmtDate(rnd.openedAt)} → ${fmtDate(rnd.closedAt)}</p>
              </div>
              <p class="font-bold ${net>=0?'text-green-400':'text-red-400'}">${fmtUsd(net)}</p>
            </div>
          </div>`;
        }).join('');

  } catch(e) {
    console.error('[patch-invest-unified] loadInvestRounds error:', e);
    activeDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${e.message}</p>`;
  }
};

// Mini-card de posición si renderPositionCard no está disponible
function _piuMiniPos(p) {
  const pnl   = p.status === 'open' ? (p.unrealizedPnL||0) : (p.realizedPnL||0);
  const color = pnl >= 0 ? 'text-green-400' : 'text-red-400';
  return `
    <div class="flex justify-between items-center py-1.5 px-2 bg-gray-800 rounded-lg text-xs">
      <span class="font-bold text-white">${p.symbol}</span>
      <span class="text-gray-400">${p.status === 'open' ? '🟡 ABIERTA' : '⚪ CERRADA'}</span>
      <span class="${color} font-semibold">${pnl>=0?'+':''}$${Math.abs(pnl).toFixed(2)}</span>
    </div>`;
}


// ════════════════════════════════════════════════════════════════════════════
//  SECCIÓN 6: loadInvestOverview — override unificado
// ════════════════════════════════════════════════════════════════════════════
window.loadInvestOverview = async function() {
  try {
    const [posRes, cfgRes] = await Promise.all([
      fetch('/api/invest/positions').then(r => r.json()),
      fetch('/api/invest/config').then(r => r.json()),
    ]);
    if (!posRes.success) return;

    const d   = posRes;
    const s   = d.summary || {};
    const cfg = cfgRes.success ? cfgRes.config : (window.investConfig || {});

    // Actualizar investConfig global
    if (cfgRes.success) window.investConfig = cfgRes.config;

    const metricsDiv = document.getElementById('inv-overview-metrics');
    if (metricsDiv) {
      const unrColor = (s.totalUnrealizedPnL||0) >= 0 ? 'text-green-400' : 'text-red-400';
      const rlzColor = (s.totalRealizedPnL||0)   >= 0 ? 'text-green-400' : 'text-red-400';
      metricsDiv.innerHTML = `
        <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
          <p class="text-xs text-gray-500">Capital disponible</p>
          <p class="text-2xl font-bold text-white mono">$${(s.capitalAvailable||0).toFixed(2)}</p>
          <p class="text-xs text-gray-600 mt-1">de $${(s.capitalTotal||0).toLocaleString()}</p>
        </div>
        <div class="bg-gray-800 border border-gray-700 rounded-xl p-4 text-center">
          <p class="text-xs text-gray-500">Invertido</p>
          <p class="text-2xl font-bold text-blue-400 mono">$${(s.capitalInvested||0).toFixed(2)}</p>
          <p class="text-xs text-gray-600 mt-1">${s.openPositions||0} posición${(s.openPositions||0)!==1?'es':''} abierta${(s.openPositions||0)!==1?'s':''}</p>
        </div>
        <div class="${(s.totalUnrealizedPnL||0)>=0?'bg-green-950 border-green-900':'bg-red-950 border-red-900'} border rounded-xl p-4 text-center">
          <p class="text-xs text-gray-500">P&L No Realizado</p>
          <p class="text-2xl font-bold ${unrColor} mono">${(s.totalUnrealizedPnL||0)>=0?'+':''}$${(s.totalUnrealizedPnL||0).toFixed(2)}</p>
        </div>`;
    }

    const openDiv = document.getElementById('inv-open-summary');
    if (openDiv) {
      if (!d.open?.length) {
        openDiv.innerHTML = '<p class="text-gray-500 text-sm">Sin posiciones abiertas.</p>';
      } else {
        openDiv.innerHTML = d.open.map(p => typeof renderPositionCard === 'function' ? renderPositionCard(p, true) : _piuMiniPos(p)).join('');
      }
    }
  } catch(e) { console.error('[patch-invest-unified] loadInvestOverview error:', e); }
};


// ════════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════════
function _piuInit() {
  // Verificar posiciones huérfanas al cargar
  setTimeout(async () => {
    try {
      const [roundsRes, posRes] = await Promise.all([
        fetch('/api/invest/rounds').then(r => r.json()),
        fetch('/api/invest/positions').then(r => r.json()),
      ]);
      const hasActiveRound = roundsRes.success && roundsRes.current?.status === 'active';
      const openPos        = posRes.success ? (posRes.open || []) : [];
      if (!hasActiveRound && openPos.length > 0) {
        _piuInjectOrphanBanner(openPos);
      }
    } catch (_) {}
  }, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _piuInit);
} else {
  setTimeout(_piuInit, 0);
}

console.log('[patch-invest-unified] ✅ v5 — BUG1+BUG2+BUG3 corregidos, patches invest consolidados');
})();
