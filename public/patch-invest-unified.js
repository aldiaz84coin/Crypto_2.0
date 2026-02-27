// ════════════════════════════════════════════════════════════════════════════
//  PATCH: patch-invest-unified.js  (v6)
//
//  BUG FIXES v6:
//    BUG A – Posiciones muestran $— / $undefined
//            ROOT CAUSE: _piuMiniPos no manejaba campos nulos + entryPrice=0 → fmtP='—'
//            FIX: nuevo _piuPosCard robusto con fallback en todos los campos
//
//    BUG B – investment-manager lee solo a.current_price (undefined si snapshot usa 'price')
//            ROOT CAUSE: selectInvestmentTargets usa a.current_price exclusivamente
//            FIX: extractPrice() helper en frontend + normalización antes de enviar al backend
//
//    BUG C – Filtro INVERTIBLE no ordena por mayor predicción de crecimiento
//            ROOT CAUSE: classification puede llegar como objeto {category:'INVERTIBLE'}
//                        y algunos activos tienen predictedChange=null/undefined
//            FIX: normalización explícita antes de enviar snapshot a /api/invest/decide
//
//    BUG D – Status bar de precios nunca actualiza (indicador arriba izquierda)
//            ROOT CAUSE: _startStatusBarTick solo llama _renderWdCompact(), nunca
//                        _renderPriceCompact() → el tiempo "hace Xm" no se refresca
//            FIX: hook en _startStatusBarTick + fallback directo a _renderPriceCompact
//
//  REEMPLAZA (igual que v5):
//    patch-rounds-v3, patch-fix-orphaned-positions, patch-decide-priority,
//    patch-new-round-simple, patch-positions-expandable, patch-rounds-expandable,
//    patch-performance-v2, patch-round-verbose
// ════════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ─── Utilidades compartidas ─────────────────────────────────────────────────

  function classStr(val) {
    if (!val) return 'RUIDOSO';
    if (typeof val === 'string') return val.toUpperCase();
    if (typeof val === 'object') return (val.category || val.label || 'RUIDOSO').toUpperCase();
    return 'RUIDOSO';
  }

  // FIX BUG A: fmtP ahora muestra '0.000000' en vez de '—' para precio cero real
  function fmtP(p, zeroLabel) {
    const n = parseFloat(p);
    if (p == null || isNaN(n)) return '—';
    if (n === 0) return zeroLabel || '0.00';
    if (n < 0.0001) return n.toFixed(8);
    if (n < 0.01)   return n.toFixed(6);
    if (n < 1)      return n.toFixed(4);
    if (n < 1000)   return n.toFixed(2);
    return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  // FIX BUG A+B: extrae precio de cualquier nombre de campo posible
  function extractPriceFromAsset(a) {
    if (!a) return null;
    const v = a.entryPrice ?? a.current_price ?? a.currentPrice ?? a.price
            ?? a.snapshotPrice ?? a.lastPrice ?? a.usd_price ?? null;
    const n = parseFloat(v);
    return (n > 0) ? n : null;
  }

  function fmtUsd(v) {
    const n = parseFloat(v) || 0;
    const sign = n >= 0 ? '+' : '';
    return `${sign}$${Math.abs(n).toFixed(2)}`;
  }

  function fmtUsdAbs(v) {
    return `$${(parseFloat(v) || 0).toFixed(2)}`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); }
    catch { return iso; }
  }

  function pnlColor(v) {
    return (parseFloat(v) || 0) >= 0 ? 'text-green-400' : 'text-red-400';
  }

  // ─── FIX BUG B: extrae el snapshot del monitor y lo normaliza para el backend ─
  //  Asegura que TODOS los activos tengan:
  //    - current_price  (leído de cualquier campo posible)
  //    - predictedChange (número, nunca null/undefined)
  //    - classification  (string normalizado)
  function normalizeSnapshotForDecide(assets) {
    if (!Array.isArray(assets)) return [];
    return assets.map(a => {
      const price   = extractPriceFromAsset(a) || 0;
      const pred    = typeof a.predictedChange === 'number'
                        ? a.predictedChange
                        : parseFloat(a.predictedChange ?? a.predicted_change ?? a.basePrediction ?? 0);
      const cls     = classStr(a.classification);
      const bp      = parseFloat(a.boostPower ?? a.boost_power ?? 0) || 0;
      const bpPct   = parseFloat(a.boostPowerPercent ?? a.boostPowerPct ?? (bp * 100)) || 0;
      return {
        ...a,
        // Campos normalizados — el backend SIEMPRE encontrará estos nombres
        current_price:    price,
        price,
        predictedChange:  isNaN(pred) ? 0 : pred,
        classification:   cls,            // string, nunca objeto
        boostPower:       bp,
        boostPowerPercent: bpPct || (bp * 100),
      };
    });
  }

  // ─── FIX BUG C: override de decideCycle para normalizar snapshot ────────────
  const _origDecideCycle = window.decideCycle;
  window.decideCycle = async function () {
    // FIX: cryptos es variable global del script de index.html, no window.cryptos
    const assets = (typeof cryptos !== "undefined" && cryptos?.length) ? cryptos
                  : (window.cryptos?.length ? window.cryptos : null);
    if (!assets?.length) {
      const div = document.getElementById('inv-decision');
      if (div) div.innerHTML = '<p class="text-yellow-400 text-sm">⚠️ Primero carga activos en el Monitor.</p>';
      return;
    }

    // Validar coherencia: si el snapshot se cargó con un modo distinto al activo, bloquear
    const loadedMode = window._snapshotLoadedMode || 'normal';
    const activeMode = window.currentMode || 'normal';
    if (loadedMode !== activeMode) {
      const div = document.getElementById('inv-decision');
      if (div) div.innerHTML = `
        <div class="bg-yellow-950 border border-yellow-700 rounded-xl p-4">
          <p class="text-yellow-400 font-semibold mb-1">⚠️ Inconsistencia de modo detectada</p>
          <p class="text-sm text-gray-300 mb-3">
            Los activos del Monitor se cargaron en modo
            <b>${loadedMode === 'speculative' ? '🎯 Especulativo' : '📊 Normal'}</b>
            pero el selector está ahora en modo
            <b>${activeMode === 'speculative' ? '🎯 Especulativo' : '📊 Normal'}</b>.
          </p>
          <p class="text-xs text-gray-500 mb-3">Recarga el Monitor con el modo correcto antes de analizar para que algoritmo y snapshot sean coherentes.</p>
          <button onclick="setTab('monitor')" class="bg-blue-700 hover:bg-blue-600 px-3 py-1.5 rounded-lg text-xs font-semibold">
            🔄 Ir al Monitor a recargar
          </button>
        </div>`;
      return;
    }
    const div = document.getElementById('inv-decision');
    if (div) div.innerHTML = '<p class="text-gray-400 text-sm">⏳ Analizando...</p>';
    try {
      // FIX: normalizar snapshot antes de enviarlo
      const normalized = normalizeSnapshotForDecide(assets);
      // Ordenar localmente para debug visual (el backend también ordena)
      const sortedForLog = [...normalized]
        .filter(a => a.classification === 'INVERTIBLE')
        .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));
      console.log('[piu-v6] Top INVERTIBLE por predictedChange:',
        sortedForLog.slice(0, 5).map(a => `${a.symbol}: ${(a.predictedChange||0).toFixed(2)}%`)
      );
      const r = await fetch('/api/invest/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: normalized, mode: window.currentMode || 'normal' }),
      });
      const d = await r.json();
      if (typeof window._origRenderDecision === 'function') {
        window._origRenderDecision(d);
      } else if (typeof window.renderDecision === 'function') {
        window.renderDecision(d);
      } else {
        _piuRenderDecision(d);
      }
    } catch (e) {
      if (div) div.innerHTML = `<p class="text-red-400 text-sm">❌ ${e.message}</p>`;
    }
  };

  // ─── FIX BUG A: tarjeta de posición robusta ─────────────────────────────────
  //  Funciona con CUALQUIER forma de los datos (campos opcionales, null, undefined)
  function _piuPosCard(p) {
    if (!p) return '';

    const isOpen    = p.status === 'open';
    const symbol    = p.symbol || p.assetId || '???';
    const name      = p.name || '';

    // Precios — múltiples fuentes posibles
    const entry     = extractPriceFromAsset({ entryPrice: p.entryPrice }) || extractPriceFromAsset(p);
    const current   = parseFloat(p.currentPrice ?? p.current_price ?? p.exitPrice ?? entry) || null;

    // Capital — múltiples nombres
    const capital   = parseFloat(p.capitalUSD ?? p.capital ?? p.capitalUsd ?? p.invested ?? 0) || 0;
    const units     = parseFloat(p.units ?? p.quantity ?? 0) || 0;

    // Fees — suma de todas las fuentes
    const entryFee  = parseFloat(p.entryFeeUSD ?? p.entry_fee ?? 0) || 0;
    const exitFee   = parseFloat(p.exitFeeUSD  ?? p.exit_fee  ?? 0) || 0;
    const totalFees = parseFloat(p.totalFeesUSD ?? (entryFee + exitFee)) || entryFee + exitFee;

    // Exchange
    const exchange  = p.exchange || p.broker || 'n/a';

    // TP / SL
    const tp        = parseFloat(p.takeProfitPrice ?? p.tp ?? 0) || null;
    const sl        = parseFloat(p.stopLossPrice   ?? p.sl ?? 0) || null;

    // P&L
    const pnl       = isOpen
                       ? (parseFloat(p.unrealizedPnL ?? 0) || 0)
                       : (parseFloat(p.realizedPnL   ?? 0) || 0);
    const pnlPct    = isOpen
                       ? (parseFloat(p.unrealizedPnLPct ?? 0) || 0)
                       : (parseFloat(p.realizedPnLPct   ?? 0) || 0);

    // Predicción / BoostPower
    const pred      = parseFloat(p.predictedChange ?? 0) || 0;
    const bp        = parseFloat(p.boostPower      ?? 0) || 0;
    const bpPct     = parseFloat(p.boostPowerPct   ?? p.boostPowerPercent ?? (bp * 100)) || bp * 100;

    // Hold cycles
    const hold      = parseInt(p.holdCycles ?? 0) || 0;
    const maxHold   = parseInt(p.maxHoldCycles ?? 0) || 0;

    // Colores
    const pnlCls    = pnl >= 0 ? 'text-green-400' : 'text-red-400';
    const statusCls = isOpen ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-800 text-gray-400';
    const statusLbl = isOpen ? '● ABIERTA' : (p.closeReason?.split(':')[0]?.toUpperCase() || 'CERRADA');

    // Precio actual vs entrada → delta %
    let deltaPct = null;
    if (entry && current && entry > 0) {
      deltaPct = ((current - entry) / entry * 100);
    }
    const deltaCls  = (deltaPct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400';

    return `
      <div class="bg-gray-800 border border-gray-700 rounded-xl p-3 text-xs"
           data-position-id="${p.id || ''}" data-asset-id="${p.assetId || ''}">
        <!-- Header -->
        <div class="flex justify-between items-start mb-2">
          <div>
            <span class="font-bold text-white text-sm">${symbol}</span>
            ${name ? `<span class="text-gray-500 ml-1">${name.substring(0, 20)}</span>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${statusCls}">${statusLbl}</span>
            <span class="${pnlCls} font-bold">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</span>
          </div>
        </div>

        <!-- Precios -->
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
          <span class="text-gray-500">Entrada:
            <span class="mono text-white">${entry ? '$' + fmtP(entry) : '—'}</span>
          </span>
          <span class="text-gray-500">Actual:
            <span class="mono ${deltaCls}">${current ? '$' + fmtP(current) : '—'}
              ${deltaPct !== null ? ` <span class="${deltaCls}">(${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)</span>` : ''}
            </span>
          </span>
          ${tp ? `<span class="text-gray-500">TP: <span class="mono text-green-400">$${fmtP(tp)}</span></span>` : '<span></span>'}
          ${sl ? `<span class="text-gray-500">SL: <span class="mono text-red-400">$${fmtP(sl)}</span></span>` : '<span></span>'}
        </div>

        <!-- Capital y operativa -->
        <div class="flex flex-wrap gap-x-3 gap-y-0.5 mb-2 text-gray-500">
          <span>Capital: <span class="mono text-white">${fmtUsdAbs(capital)}</span></span>
          ${units > 0 ? `<span>Units: <span class="mono text-gray-300">${units.toFixed(6)}</span></span>` : ''}
          <span>Fees: <span class="mono text-yellow-400">${fmtUsdAbs(totalFees)}</span></span>
          <span>Exchange: <span class="mono text-gray-300">${exchange}</span></span>
          ${hold > 0 || maxHold > 0 ? `<span>Hold: <span class="mono text-gray-300">${hold}/${maxHold}</span></span>` : ''}
        </div>

        <!-- Algo info -->
        <div class="flex gap-3 text-gray-500">
          ${pred !== 0 ? `<span>Pred: <span class="mono text-blue-400">${pred >= 0 ? '+' : ''}${pred.toFixed(2)}%</span></span>` : ''}
          ${bp > 0    ? `<span>BP: <span class="mono text-yellow-400">${(bpPct || bp * 100).toFixed(1)}%</span></span>` : ''}
          ${pnl !== 0 ? `<span>P&amp;L: <span class="mono ${pnlCls}">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(4)}</span></span>` : ''}
        </div>

        <!-- Botón cierre manual para posiciones abiertas -->
        ${isOpen && p.id ? `
        <div class="mt-2 flex justify-end">
          <button onclick="closePositionManual('${p.id}')"
            class="text-[10px] bg-red-900 hover:bg-red-700 text-red-300 px-2 py-1 rounded transition-colors">
            Cerrar posición
          </button>
        </div>` : ''}
      </div>`;
  }

  // Exponer para que otros módulos puedan usarlo
  window._piuPosCard = _piuPosCard;

  // ─── Override loadInvestPositions: usa _piuPosCard ───────────────────────────
  const _origLoadPos = window.loadInvestPositions;
  window.loadInvestPositions = async function (...args) {
    if (_origLoadPos) {
      const r = await _origLoadPos(...args);
      // Asegurar que el div de resumen abierto también use nuestra tarjeta
      return r;
    }
  };

  // ─── SECCIÓN 1: renderDecision mejorado ─────────────────────────────────────
  function extractAssetInfo(a) {
    const price = extractPriceFromAsset(a) || 0;
    const pred  = typeof a.predictedChange === 'number' ? a.predictedChange
                  : parseFloat(a.predictedChange ?? a.predicted_change ?? 0);
    const bp    = parseFloat(a.boostPower ?? a.boost_power ?? 0) || 0;
    const bpPct = parseFloat(a.boostPowerPercent ?? a.boostPowerPct ?? (bp * 100)) || bp * 100;
    return {
      ...a,
      id:             a.id || a.assetId,
      price,
      current_price:  price,
      predictedChange: isNaN(pred) ? 0 : pred,
      boostPower:     bp,
      boostPowerPct:  Math.round(bpPct),
      classification: classStr(a.classification),
      capitalUSD:     parseFloat(a.capitalUSD ?? a.capital ?? 0) || 0,
    };
  }

  function _piuRenderDecision(d) {
    const div = document.getElementById('inv-decision');
    if (!div) return;
    if (!d?.success) {
      div.innerHTML = `<p class="text-red-400 text-sm">❌ ${d?.error || 'Error desconocido'}</p>`;
      return;
    }

    const dbg      = d._debug || {};
    const cfg      = window.investConfig || {};
    const minBP    = dbg.minBoostApplied != null ? Math.round(dbg.minBoostApplied * 100)
                     : Math.round((cfg.minBoostPower || 0.65) * 100);
    const minPred  = dbg.minPredictedChange ?? 0;

    const criteriaHtml = `
      <div class="flex flex-wrap gap-1 mb-2">
        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-950 border border-blue-800 text-blue-300">
          BP ≥ ${minBP}%${dbg.minBoostFromAlgoA != null ? ' <span class="text-blue-500">(Algo A)</span>' : ''}
        </span>
        ${minPred > 0 ? `<span class="text-xs px-2 py-0.5 rounded-full bg-purple-950 border border-purple-800 text-purple-300">pred ≥ +${minPred}%</span>` : ''}
        <span class="text-xs text-gray-500">Snapshot: ${dbg.snapshotTotal ?? '?'} activos · INVERTIBLE: ${dbg.invertiblesInSnapshot ?? '?'} · Candidatos: ${dbg.invertiblesPassingAll ?? '?'}/${dbg.minSignalsRequired ?? 2}</span>
      </div>`;

    // Diagnóstico inline
    let debugHtml = '';
    if (dbg.snapshotTotal != null) {
      const noPred = dbg.snapshotHasPredictedChange === 0;
      debugHtml = `
        <div class="mt-3 p-2 bg-gray-900 rounded-lg border border-gray-800 text-xs text-gray-500 space-y-0.5">
          <p class="font-semibold text-gray-400 mb-1">🔍 Filtros aplicados</p>
          <p>Total → INVERTIBLE <span class="text-green-400">${dbg.invertiblesInSnapshot ?? '—'}</span>
             → fallan pred <span class="text-yellow-400">${dbg.invertiblesFailingPredFilter ?? 0}</span>
             → candidatos <span class="${(dbg.invertiblesPassingAll ?? 0) >= (dbg.minSignalsRequired ?? 2) ? 'text-green-400' : 'text-red-400'} font-bold">${dbg.invertiblesPassingAll ?? '—'}</span>
             (mín ${dbg.minSignalsRequired ?? 2})</p>
          ${noPred ? '<p class="text-orange-400">⚠️ Activos sin predictedChange — carga el Monitor primero</p>' : ''}
        </div>`;
    }

    if (!d.shouldInvest) {
      const allCands = [...(d.allCandidates || [])]
        .map(extractAssetInfo)
        .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));

      const candRows = allCands.length > 0 ? `
        <div class="mt-3 border-t border-yellow-900/40 pt-3">
          <p class="text-xs text-gray-500 mb-1.5">Candidatos INVERTIBLE — mayor predicción primero:</p>
          ${allCands.slice(0, 10).map((a, i) => `
            <div class="flex justify-between items-center py-1 text-xs border-b border-gray-800/40 last:border-0">
              <span class="text-gray-600 w-4">#${i + 1}</span>
              <span class="font-semibold mono text-gray-200 w-16">${a.symbol}</span>
              <span class="text-blue-400">BP: ${a.boostPowerPct}%</span>
              <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'} font-semibold">
                ${a.predictedChange >= 0 ? '+' : ''}${(a.predictedChange || 0).toFixed(2)}%
              </span>
              <span class="text-gray-600 mono text-[10px]">$${fmtP(a.price)}</span>
            </div>`).join('')}
        </div>` : '<p class="text-xs text-gray-600 mt-2">Sin candidatos INVERTIBLE.</p>';

      div.innerHTML = `
        <div class="bg-yellow-950 border border-yellow-800 rounded-xl p-4">
          ${criteriaHtml}
          <p class="text-yellow-400 font-semibold">⏸️ No invertir en este ciclo</p>
          <p class="text-gray-400 text-sm mt-1">${d.reason || ''}</p>
          <p class="text-gray-500 text-sm mt-1">Capital disponible: $${(d.capitalAvailable || 0).toFixed(2)}</p>
          ${candRows}
          ${debugHtml}
        </div>`;
      return;
    }

    const targets = [...(d.targets || [])].map(extractAssetInfo)
      .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));
    const allCands = [...(d.allCandidates || [])].map(extractAssetInfo)
      .sort((a, b) => (b.predictedChange || 0) - (a.predictedChange || 0));
    const extras = allCands.filter(a => !targets.find(t => t.id === a.id || t.symbol === a.symbol));

    const cards = targets.map((t, idx) => {
      const pctColor = t.predictedChange >= 0 ? 'text-green-400' : 'text-red-400';
      const bpColor  = t.boostPowerPct >= 75 ? 'text-green-400' : t.boostPowerPct >= 60 ? 'text-yellow-400' : 'text-red-400';
      return `
        <div class="bg-gray-800 rounded-xl p-3 border border-gray-700">
          <div class="flex justify-between items-start mb-2">
            <div>
              <span class="text-xs text-gray-500">#${idx + 1}</span>
              <p class="font-bold text-white">${t.symbol}</p>
              <p class="text-xs text-gray-500 truncate">${t.name || ''}</p>
            </div>
            <span class="text-2xl font-bold ${pctColor}">${t.predictedChange >= 0 ? '+' : ''}${(t.predictedChange || 0).toFixed(1)}%</span>
          </div>
          <div class="grid grid-cols-2 gap-1 text-xs">
            <div><p class="text-gray-500">BoostPower</p><p class="${bpColor} font-semibold">${t.boostPowerPct}%</p></div>
            <div><p class="text-gray-500">Precio</p><p class="text-gray-200 mono">$${fmtP(t.price)}</p></div>
            <div><p class="text-gray-500">Capital</p><p class="text-blue-400 font-semibold">$${(t.capitalUSD || 0).toFixed(0)}</p></div>
            <div><p class="text-gray-500">Clasificación</p><p class="text-green-400 font-semibold text-xs">${t.classification}</p></div>
          </div>
          <button onclick="window._piuExecuteSingle('${t.id}','${t.symbol}',${t.price || 0})"
            class="mt-2 w-full bg-green-800 hover:bg-green-700 text-xs py-1.5 rounded-lg font-semibold transition-colors">
            Comprar
          </button>
        </div>`;
    }).join('');

    const extrasHtml = extras.length > 0 ? `
      <details class="mt-3 text-xs">
        <summary class="cursor-pointer text-gray-500 hover:text-gray-300">Ver ${extras.length} activos adicionales</summary>
        <div class="mt-2 space-y-1">
          ${extras.slice(0, 8).map((a, i) => `
            <div class="flex justify-between items-center py-1 px-2 bg-gray-800 rounded text-xs">
              <span class="text-gray-600">#${targets.length + i + 1}</span>
              <span class="font-semibold text-gray-300 w-14">${a.symbol}</span>
              <span class="text-blue-400">BP:${a.boostPowerPct}%</span>
              <span class="${a.predictedChange >= 0 ? 'text-green-400' : 'text-red-400'}">
                ${a.predictedChange >= 0 ? '+' : ''}${(a.predictedChange || 0).toFixed(2)}%
              </span>
            </div>`).join('')}
        </div>
      </details>` : '';

    div.innerHTML = `
      <div class="bg-green-950 border border-green-800 rounded-xl p-4">
        ${criteriaHtml}
        <p class="font-semibold text-green-400 mb-1">✅ ${targets.length} inversión${targets.length !== 1 ? 'es' : ''} recomendada${targets.length !== 1 ? 's' : ''}</p>
        <p class="text-gray-400 text-sm mb-3">${d.reason || ''} · Capital: $${(d.cycleCapital || 0).toFixed(0)} · Modo: ${d.mode || '—'}</p>
        <div class="grid grid-cols-${Math.min(targets.length, 3)} gap-3 mb-3">${cards}</div>
        <button onclick="executeInvestment()"
          class="w-full bg-green-700 hover:bg-green-600 py-3 rounded-xl font-bold text-lg transition-colors">
          ${d.mode === 'simulated' ? '⚗️ Ejecutar (Simulado)' : '💵 Ejecutar INVERSIÓN REAL'}
        </button>
        ${extrasHtml}
        ${debugHtml}
      </div>`;

    window._pendingTargets = d;
  }

  // Guardar referencia a renderDecision original por si existe
  if (typeof window.renderDecision === 'function') {
    window._origRenderDecision = window.renderDecision;
  }
  window.renderDecision = _piuRenderDecision;


  // ─── SECCIÓN 2: Posiciones huérfanas ────────────────────────────────────────

  function renderOrphanPositionRow(p) {
    const pnl = parseFloat(p.unrealizedPnL ?? p.realizedPnL ?? 0) || 0;
    const pc  = pnl >= 0 ? 'text-green-400' : 'text-red-400';
    const capital = parseFloat(p.capitalUSD ?? p.capital ?? 0) || 0;
    return `
      <div class="flex justify-between items-center py-2 px-2 border-b border-gray-700 last:border-0 text-xs">
        <div>
          <span class="font-bold text-white">${p.symbol || p.assetId}</span>
          <span class="text-gray-500 ml-2">${fmtUsdAbs(capital)}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="${pc}">${fmtUsd(pnl)}</span>
          <button onclick="closePositionManual('${p.id}')"
            class="bg-red-900 hover:bg-red-800 text-red-300 px-2 py-0.5 rounded text-[10px]">Cerrar</button>
        </div>
      </div>`;
  }

  function _piuInjectOrphanBanner(openPositions) {
    const existing = document.getElementById('piu-orphan-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'piu-orphan-banner';
    banner.className = 'mb-4 bg-orange-950 border border-orange-800 rounded-xl p-4';
    banner.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <p class="font-semibold text-orange-300">⚠️ ${openPositions.length} posición${openPositions.length !== 1 ? 'es' : ''} huérfana${openPositions.length !== 1 ? 's' : ''} (sin ronda activa)</p>
        <button onclick="piuCloseOrphanedPositions()"
          class="bg-red-800 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
          Cerrar todas
        </button>
      </div>
      <div class="bg-gray-900 rounded-lg overflow-hidden">
        ${openPositions.map(renderOrphanPositionRow).join('')}
      </div>`;

    const activeDiv = document.getElementById('inv-rounds-active');
    if (activeDiv) activeDiv.prepend(banner);
  }

  window.piuRefreshOrphanBanner = async function () {
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

  window.piuCloseOrphanedPositions = async function () {
    if (!confirm('¿Cerrar todas las posiciones huérfanas al precio actual?')) return;
    try {
      const r = await fetch('/api/invest/positions/close-orphaned', { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        document.getElementById('piu-orphan-banner')?.remove();
        if (typeof loadInvestPositions === 'function') await loadInvestPositions();
        if (typeof loadInvestOverview  === 'function') await loadInvestOverview();
        if (typeof loadInvestRounds    === 'function') await loadInvestRounds();
      } else {
        alert('❌ ' + (d.error || 'Error'));
      }
    } catch (e) { alert('❌ ' + e.message); }
  };


  // ─── SECCIÓN 3: openNewRoundWizard ──────────────────────────────────────────

  window.openNewRoundWizard = async function () {
    document.getElementById('new-round-modal')?.remove();
    let suggestions = {}, adjustments = [], currentConfig = {}, basedOnRounds = 0;
    try {
      const r = await fetch('/api/invest/rounds/recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      });
      const d = await r.json();
      if (d.success) {
        suggestions    = d.suggestions || {};
        adjustments    = d.reasonedAdjustments || [];
        currentConfig  = d.currentConfig || {};
        basedOnRounds  = d.basedOnRounds || 0;
      }
    } catch (_) {}

    const s = { ...suggestions };
    const adjHtml = adjustments.length > 0 ? `
      <div class="bg-amber-950/40 border border-amber-800 rounded-lg p-3 mb-3">
        <p class="text-xs font-semibold text-amber-400 mb-1.5">💡 Ajustes recomendados (${basedOnRounds} ronda${basedOnRounds !== 1 ? 's' : ''})</p>
        ${adjustments.slice(0, 3).map(a => `<p class="text-xs text-amber-300/80">• ${a}</p>`).join('')}
      </div>` : '';

    const modal = document.createElement('div');
    modal.id = 'new-round-modal';
    modal.className = 'fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div class="flex justify-between items-center px-6 py-4 border-b border-gray-800">
          <h3 class="text-lg font-bold">🚀 Nueva Ronda</h3>
          <button onclick="document.getElementById('new-round-modal').remove()"
            class="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div class="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          ${adjHtml}
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-400 block mb-1">Take Profit %</label>
              <input id="nr-tp" type="number" step="0.5" min="1" max="50"
                value="${s.takeProfitPct || currentConfig.takeProfitPct || 10}"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">Stop Loss %</label>
              <input id="nr-sl" type="number" step="0.5" min="1" max="30"
                value="${s.stopLossPct || currentConfig.stopLossPct || 5}"
                class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs text-gray-400 block mb-1">Max Hold Ciclos</label>
              <select id="nr-hold" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
                ${[1,2,3,4,5,6].map(v => `<option value="${v}" ${v === (s.maxHoldCycles || 3) ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="text-xs text-gray-400 block mb-1">Máx posiciones</label>
              <select id="nr-maxpos" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
                ${[1,2,3,4,5].map(v => `<option value="${v}" ${v === (s.maxPositions || 3) ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label class="text-xs text-gray-400 block mb-1">Min BoostPower</label>
            <select id="nr-boost" class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
              ${[0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85].map(v =>
                `<option value="${v}" ${Math.abs(v - (s.minBoostPower || 0.65)) < 0.01 ? 'selected' : ''}>${(v * 100).toFixed(0)}%</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-400 block mb-1">📈 Subida mínima prevista</label>
            <select id="nr-min-pred" class="w-full bg-gray-800 border border-indigo-900 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none text-indigo-200">
              ${[0,1,2,3,5,7,10,15].map(v =>
                `<option value="${v}" ${Math.abs(v - (s.minPredictedChange || 0)) < 0.01 ? 'selected' : ''}>
                  ${v === 0 ? 'Sin filtro' : '≥ ' + v + '%'}
                </option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="p-4 border-t border-gray-800">
          <div id="nr-status" class="hidden text-sm text-gray-400 mb-2"></div>
          <button onclick="window._piuSubmitNewRound()"
            class="w-full bg-indigo-700 hover:bg-indigo-600 py-3 rounded-xl font-bold transition-colors">
            🚀 Abrir Ronda
          </button>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  };

  window._piuSubmitNewRound = async function () {
    const btn    = document.querySelector('#new-round-modal button:last-child') ||
                   document.getElementById('nr-submit-btn');
    const status = document.getElementById('nr-status');

    const config = {
      takeProfitPct:    parseFloat(document.getElementById('nr-tp')?.value  || 10),
      stopLossPct:      parseFloat(document.getElementById('nr-sl')?.value  || 5),
      maxHoldCycles:    parseInt  (document.getElementById('nr-hold')?.value || 3),
      maxPositions:     parseInt  (document.getElementById('nr-maxpos')?.value || 3),
      minBoostPower:    parseFloat(document.getElementById('nr-boost')?.value || 0.65),
      minPredictedChange: parseFloat(document.getElementById('nr-min-pred')?.value || 0),
    };

    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Abriendo...'; }
    if (status) { status.classList.remove('hidden'); status.textContent = 'Abriendo nueva ronda...'; }

    try {
      const r = await fetch('/api/invest/rounds/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const d = await r.json();
      if (!d.success) {
        if (status) status.textContent = '❌ ' + d.error;
        if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Abrir Ronda'; }
        if (d.error?.includes('posiciones abiertas')) {
          document.getElementById('new-round-modal')?.remove();
          await window.piuRefreshOrphanBanner();
        }
        return;
      }
      document.getElementById('new-round-modal')?.remove();
      await Promise.all([
        typeof loadCurrentRoundBanner === 'function' ? loadCurrentRoundBanner() : Promise.resolve(),
        typeof loadInvestPositions    === 'function' ? loadInvestPositions()    : Promise.resolve(),
        typeof loadInvestOverview     === 'function' ? loadInvestOverview()     : Promise.resolve(),
        typeof loadInvestRounds       === 'function' ? loadInvestRounds()       : Promise.resolve(),
      ]);
      const toast = document.createElement('div');
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-indigo-800 border border-indigo-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
      toast.textContent = `✅ Ronda #${d.round?.roundNumber || '?'} abierta`;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);
    } catch (e) {
      if (status) status.textContent = '❌ ' + e.message;
      if (btn) { btn.disabled = false; btn.innerHTML = '🚀 Abrir Ronda'; }
    }
  };


  // ─── SECCIÓN 4: loadInvestOverview ──────────────────────────────────────────

  window.loadInvestOverview = async function () {
    try {
      const r = await fetch('/api/invest/positions');
      const d = await r.json();
      if (!d.success) return;

      const s = d.summary || {};
      const capitalGrid = document.getElementById('inv-capital-grid');
      if (capitalGrid) {
        capitalGrid.innerHTML = `
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p class="text-xs text-gray-500">Capital Total</p>
            <p class="font-bold text-lg">${fmtUsdAbs(s.capitalTotal)}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p class="text-xs text-gray-500">Disponible</p>
            <p class="font-bold text-lg text-green-400">${fmtUsdAbs(s.capitalAvailable)}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
            <p class="text-xs text-gray-500">Invertido</p>
            <p class="font-bold text-lg text-blue-400">${fmtUsdAbs(s.capitalInvested)}</p>
          </div>
          <div class="${(s.totalUnrealizedPnL || 0) >= 0 ? 'bg-green-950 border-green-900' : 'bg-red-950 border-red-900'} border rounded-xl p-3 text-center">
            <p class="text-xs text-gray-500">P&L No Real.</p>
            <p class="font-bold text-lg ${pnlColor(s.totalUnrealizedPnL)}">${fmtUsd(s.totalUnrealizedPnL)}</p>
          </div>`;
      }

      const openDiv = document.getElementById('inv-open-summary');
      if (openDiv) {
        if (!d.open?.length) {
          openDiv.innerHTML = '<p class="text-gray-500 text-sm">Sin posiciones abiertas.</p>';
        } else {
          openDiv.innerHTML = d.open.map(p => _piuPosCard(p)).join('');
        }
      }
    } catch (e) { console.error('[piu-v6] loadInvestOverview error:', e); }
  };


  // ─── SECCIÓN 5: loadInvestRounds ────────────────────────────────────────────

  window.loadInvestRounds = async function () {
    const activeDiv = document.getElementById('inv-rounds-active');
    const histDiv   = document.getElementById('inv-rounds-history');
    if (!activeDiv || !histDiv) return;

    try {
      const [roundsRes, posRes] = await Promise.all([
        fetch('/api/invest/rounds').then(r => r.json()),
        fetch('/api/invest/positions').then(r => r.json()),
      ]);
      if (!roundsRes.success) {
        activeDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${roundsRes.error}</p>`;
        return;
      }

      const current = roundsRes.current;
      const rounds  = roundsRes.rounds || [];
      const allPos  = posRes.success ? [...(posRes.open || []), ...(posRes.closed || [])] : [];

      // ── Ronda activa ────────────────────────────────────────────────────────
      if (current?.status === 'active') {
        const roundStart = current.openedAt ? new Date(current.openedAt).getTime() : 0;
        const roundPos   = allPos
          .filter(p => {
            const t = p.openedAt ? new Date(p.openedAt).getTime() : 0;
            return roundStart > 0 && t >= roundStart;
          })
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
            return (b.closedAt ? new Date(b.closedAt).getTime() : 0)
                 - (a.closedAt ? new Date(a.closedAt).getTime() : 0);
          });

        const openPos   = roundPos.filter(p => p.status === 'open');
        const closedPos = roundPos.filter(p => p.status === 'closed');
        const realPnL   = closedPos.reduce((s, p) => s + (parseFloat(p.realizedPnL) || 0), 0);
        const unrPnL    = openPos .reduce((s, p) => s + (parseFloat(p.unrealizedPnL) || 0), 0);
        const totalFees = roundPos.reduce((s, p) => s + (parseFloat(p.totalFeesUSD) || 0), 0);
        const winRate   = closedPos.length > 0
          ? Math.round(closedPos.filter(p => (parseFloat(p.realizedPnL) || 0) > 0).length / closedPos.length * 100)
          : null;

        // Posiciones expandibles — usa _piuPosCard robusto
        const posHtml = roundPos.length === 0
          ? '<p class="text-gray-600 text-xs mt-2">Sin posiciones aún en esta ronda.</p>'
          : `<div class="mt-3">
              <div class="flex items-center justify-between mb-2">
                <p class="text-xs font-semibold text-gray-400">
                  ${openPos.length} abierta${openPos.length !== 1 ? 's' : ''} · 
                  ${closedPos.length} cerrada${closedPos.length !== 1 ? 's' : ''}
                </p>
                <button onclick="document.getElementById('piu-rnd-pos-list').classList.toggle('hidden')"
                  class="text-xs text-gray-500 hover:text-gray-300">Ver/Ocultar</button>
              </div>
              <div id="piu-rnd-pos-list" class="space-y-2">
                ${roundPos.map(p => _piuPosCard(p)).join('')}
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
                <p class="font-bold text-white">${openPos.length} / ${closedPos.length}</p>
              </div>
              <div class="bg-gray-900 rounded-lg p-2">
                <p class="text-gray-500">P&amp;L Real. (neto)</p>
                <p class="font-bold ${(realPnL - totalFees) >= 0 ? 'text-green-400' : 'text-red-400'}">${fmtUsd(realPnL - totalFees)}</p>
              </div>
              <div class="bg-gray-900 rounded-lg p-2">
                <p class="text-gray-500">No Realizado</p>
                <p class="font-bold ${unrPnL >= 0 ? 'text-green-400' : 'text-red-400'}">${fmtUsd(unrPnL)}</p>
              </div>
            </div>
            ${winRate !== null ? `<p class="text-xs text-gray-500 mb-2">Win rate cerradas: <span class="${winRate >= 50 ? 'text-green-400' : 'text-red-400'} font-semibold">${winRate}%</span></p>` : ''}
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
        await window.piuRefreshOrphanBanner();
      }

      // ── Historial ───────────────────────────────────────────────────────────
      const completed = rounds.filter(r => r.status === 'closed' || r.status === 'completed');
      histDiv.innerHTML = completed.length === 0
        ? '<p class="text-gray-500 text-sm">Sin rondas completadas.</p>'
        : completed.slice(0, 15).map(rnd => {
            const rPnL  = parseFloat(rnd.metrics?.totalPnLUSD || 0);
            const rFees = parseFloat(rnd.metrics?.totalFeesUSD || 0);
            const net   = rPnL - rFees;
            const rPos  = allPos.filter(p => {
              const t = p.openedAt ? new Date(p.openedAt).getTime() : 0;
              const s = rnd.openedAt ? new Date(rnd.openedAt).getTime() : 0;
              return t >= s;
            });
            return `
              <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-2">
                <div class="flex justify-between items-center">
                  <div>
                    <p class="font-semibold text-white text-sm">Ronda #${rnd.roundNumber || '—'}</p>
                    <p class="text-xs text-gray-500">${fmtDate(rnd.openedAt)} → ${fmtDate(rnd.closedAt)}</p>
                    <p class="text-xs text-gray-600 mt-0.5">${rPos.length} posiciones</p>
                  </div>
                  <p class="font-bold ${net >= 0 ? 'text-green-400' : 'text-red-400'} text-lg">${fmtUsd(net)}</p>
                </div>
              </div>`;
          }).join('');

    } catch (e) {
      console.error('[piu-v6] loadInvestRounds error:', e);
      activeDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${e.message}</p>`;
    }
  };

  // ─── SECCIÓN 6: _piuExecuteSingle ───────────────────────────────────────────

  window._piuExecuteSingle = async function (assetId, symbol, price) {
    const symUp = (symbol || '').toUpperCase();
    let assetData;
    try {
      const src = (window._pendingTargets?.targets || []).find(t => (t.assetId || t.id) === assetId || t.symbol === symUp)
               || (window._pendingTargets?.allCandidates || []).find(a => (a.id || a.assetId) === assetId || a.symbol === symUp);
      if (src) {
        assetData = {
          id:              src.assetId || src.id || assetId,
          symbol:          symUp,
          name:            src.name || symUp,
          current_price:   extractPriceFromAsset(src) || parseFloat(price) || 0,
          boostPower:      parseFloat(src.boostPower ?? 0) || 0,
          predictedChange: parseFloat(src.predictedChange ?? 0) || 0,
          classification:  classStr(src.classification),
        };
      } else {
        assetData = { id: assetId, symbol: symUp, current_price: parseFloat(price) || 0 };
      }
    } catch (_) {
      assetData = { id: assetId, symbol: symUp, current_price: parseFloat(price) || 0 };
    }
    try {
      const r    = await fetch('/api/invest/buy-manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetData }),
      });
      const data = await r.json();
      if (data.success) {
        const toast = document.createElement('div');
        toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-green-800 border border-green-600 text-white px-5 py-3 rounded-xl shadow-2xl z-50 text-sm font-semibold';
        toast.textContent = `✅ Posición abierta en ${symUp}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
        if (typeof loadInvestOverview  === 'function') await loadInvestOverview();
        if (typeof loadInvestPositions === 'function') await loadInvestPositions();
      } else {
        alert('❌ ' + (data.error || 'Error desconocido'));
      }
    } catch (e) { alert('❌ ' + e.message); }
  };


  // ─── FIX BUG D: Price status bar — tick también refresca precio ─────────────
  //  patch-status-bar.js inicializa _startStatusBarTick() que solo llama _renderWdCompact().
  //  Aquí lo extendemos para que también llame _renderPriceCompact si existe.
  function _patchStatusBarTick() {
    // Esperar a que patch-status-bar.js haya definido sus funciones
    if (typeof window._renderPriceCompact !== 'function') return;

    // Guardar el tick original si existe y reenvolverlo
    const _orig = window._renderPriceCompact;
    // Forzar una actualización inmediata
    try { _orig(); } catch (_) {}

    // El tick de patch-status-bar.js llama _renderWdCompact pero no _renderPriceCompact.
    // Sobreescribir setInterval para interceptar el tick del status bar:
    const _origSetInterval = window.setInterval;
    let _patched = false;
    window.setInterval = function (fn, delay, ...args) {
      // Solo interceptar el tick de 1000ms del status bar (que llama _renderWdCompact)
      if (!_patched && delay === 1000 && typeof fn === 'function' && fn.toString().includes('_renderWdCompact')) {
        _patched = true;
        window.setInterval = _origSetInterval; // restaurar
        return _origSetInterval.call(window, function () {
          try { fn(); } catch (_) {}
          try { if (typeof window._renderPriceCompact === 'function') window._renderPriceCompact(); } catch (_) {}
        }, delay, ...args);
      }
      return _origSetInterval.call(window, fn, delay, ...args);
    };
  }

  // Intentar inmediatamente y también tras DOMContentLoaded
  setTimeout(_patchStatusBarTick, 500);
  setTimeout(_patchStatusBarTick, 2000);

  // También sobreescribir updatePriceStatusFromPositions para que siempre
  // actualice el compact cuando se llame (aunque no haya status bar)
  const _origUpdatePrice = window.updatePriceStatusFromPositions;
  window.updatePriceStatusFromPositions = function (priceUpdate) {
    if (typeof _origUpdatePrice === 'function') {
      try { _origUpdatePrice.apply(this, arguments); } catch (_) {}
    }
    // Forzar actualización del compact si existe
    setTimeout(() => {
      try { if (typeof window._renderPriceCompact === 'function') window._renderPriceCompact(); } catch (_) {}
    }, 50);
  };


  // ─── INIT ────────────────────────────────────────────────────────────────────

  function _piuInit() {
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

  console.log('[patch-invest-unified] ✅ v6 — BugFix: posCards, campo normalización, decideCycle snapshot, price status bar tick');
})();
