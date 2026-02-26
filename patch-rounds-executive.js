/**
 * patch-rounds-executive.js
 * ═══════════════════════════════════════════════════════════════════════
 * Vista ejecutiva para la ronda activa en la pestaña "Ciclos/Rondas"
 *
 * COMPORTAMIENTO:
 *  - Por defecto muestra la vista EJECUTIVA (resumen compacto)
 *  - Botón "Ver detalle" despliega la vista completa existente
 *  - Resumen: P&L, capital invertido, operaciones, resultado neto
 *  - Tabla de operaciones: op, activo, razón, predicción, resultado, cuándo
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
  'use strict';

  // ── Utilidades ─────────────────────────────────────────────────────────────

  const _fmtUsd = v => {
    const n = parseFloat(v) || 0;
    const s = n < 0 ? '-' : (n > 0 ? '+' : '');
    return s + '$' + Math.abs(n).toFixed(2);
  };

  const _fmtUsdAbs = v => '$' + (parseFloat(v) || 0).toFixed(2);

  const _pnlClass = v => {
    const n = parseFloat(v) || 0;
    return n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-gray-400';
  };

  const _timeAgo = iso => {
    if (!iso) return '—';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (d < 1)    return 'ahora';
    if (d < 60)   return `${d}m`;
    if (d < 1440) return `${Math.floor(d / 60)}h ${d % 60}m`;
    return `${Math.floor(d / 1440)}d ${Math.floor((d % 1440) / 60)}h`;
  };

  const _fmtTs = iso => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  };

  // ── Fila de operación (tabla ejecutiva) ────────────────────────────────────

  function _renderOpRow(p) {
    const isBuy  = p.status === 'open';
    const pnl    = isBuy
      ? (parseFloat(p.unrealizedPnL) || 0)
      : (parseFloat(p.realizedPnL)   || 0);

    const opLabel = isBuy
      ? `<span class="font-semibold text-blue-400">COMPRA</span>`
      : `<span class="font-semibold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}">VENTA</span>`;

    const symbol   = (p.symbol || p.assetId || '?').toUpperCase();
    const cat      = (p.classification || p.type || '').toUpperCase();
    const catColor = cat === 'INVERTIBLE' ? 'text-green-400'
                   : cat === 'APALANCADO' ? 'text-yellow-400' : 'text-gray-500';

    const reason   = p.closeReason || p.reason || p.signal
                   || (isBuy ? 'Señal de compra' : '—');

    const predPct  = p.predictedChange != null
      ? `${parseFloat(p.predictedChange) >= 0 ? '+' : ''}${parseFloat(p.predictedChange).toFixed(1)}%`
      : '—';

    const realPctVal = isBuy
      ? (() => {
          // Para abiertas: usar unrealizedPnLPct (calculado en el servidor al leer precios)
          if (p.unrealizedPnLPct != null) return parseFloat(p.unrealizedPnLPct);
          const cap = parseFloat(p.capitalUSD || p.amountUSD || 0);
          const unr = parseFloat(p.unrealizedPnL || 0);
          return cap > 0 ? parseFloat((unr / cap * 100).toFixed(2)) : null;
        })()
      : (p.actualChangePct  != null ? parseFloat(p.actualChangePct)
         : p.realizedPnLPct != null ? parseFloat(p.realizedPnLPct) : null);

    const realPct  = realPctVal !== null
      ? `<span class="${_pnlClass(realPctVal)}">${realPctVal >= 0 ? '+' : ''}${realPctVal.toFixed(1)}%</span>`
      : '—';

    const ts = isBuy ? p.openedAt : (p.closedAt || p.openedAt);

    return `
      <tr class="border-b border-gray-800/40 hover:bg-white/[0.02] transition-colors">
        <td class="py-2 px-3 text-xs whitespace-nowrap">${opLabel}</td>
        <td class="py-2 px-3 whitespace-nowrap">
          <span class="font-semibold text-sm text-white">${symbol}</span>
          ${cat ? `<span class="ml-1 text-xs ${catColor} hidden sm:inline">${cat}</span>` : ''}
        </td>
        <td class="py-2 px-3 text-xs text-gray-400 max-w-[160px] truncate" title="${reason.replace(/"/g,"'")}">
          ${reason}
        </td>
        <td class="py-2 px-3 text-xs text-gray-500 text-right whitespace-nowrap">${predPct}</td>
        <td class="py-2 px-3 text-xs text-right whitespace-nowrap">${realPct}</td>
        <td class="py-2 px-3 text-right whitespace-nowrap">
          <span class="font-bold text-sm ${_pnlClass(pnl)}">${_fmtUsd(pnl)}</span>
        </td>
        <td class="py-2 px-3 text-right text-xs text-gray-600 whitespace-nowrap">${_timeAgo(ts)}</td>
      </tr>`;
  }

  // ── Tarjeta de métrica ─────────────────────────────────────────────────────

  function _kpi(label, val, cls = 'text-white', sub = '') {
    return `
      <div class="bg-black/20 border border-white/5 rounded-xl p-3 text-center min-w-0">
        <p class="text-xs text-gray-500 mb-1 truncate leading-tight">${label}</p>
        <p class="font-bold text-xl leading-tight ${cls}">${val}</p>
        ${sub ? `<p class="text-xs text-gray-600 mt-0.5 leading-tight">${sub}</p>` : ''}
      </div>`;
  }

  // ── Estado global de toggle ────────────────────────────────────────────────
  if (window._execViewExpanded === undefined) window._execViewExpanded = false;

  // ── OVERRIDE loadInvestRounds ──────────────────────────────────────────────

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
      const allPos  = posRes.success
        ? [...(posRes.open || []), ...(posRes.closed || [])]
        : [];

      // ── RONDA ACTIVA ────────────────────────────────────────────────────────
      if (current?.status === 'active') {
        const roundStart = current.openedAt
          ? new Date(current.openedAt).getTime() : 0;

        // BUG FIX: filtrar por roundId si está disponible (enlace directo), 
        // con fallback a openedAt para posiciones antiguas sin roundId.
        // Antes: solo timestamp → posiciones de rondas previas podían colarse.
        // Ahora: roundId tiene prioridad; si no tiene roundId se usa el timestamp.
        const roundPos = allPos
          .filter(p => {
            if (p.roundId) return p.roundId === current.id;      // enlace directo ✓
            const t = p.openedAt ? new Date(p.openedAt).getTime() : 0;
            return roundStart > 0 && t >= roundStart;             // fallback temporal
          })
          .sort((a, b) => {
            if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
            const tA = a.closedAt
              ? new Date(a.closedAt).getTime()
              : new Date(a.openedAt || 0).getTime();
            const tB = b.closedAt
              ? new Date(b.closedAt).getTime()
              : new Date(b.openedAt || 0).getTime();
            return tB - tA;
          });

        const openPos   = roundPos.filter(p => p.status === 'open');
        const closedPos = roundPos.filter(p => p.status === 'closed');

        // Cálculos financieros
        const realPnL   = closedPos.reduce((s, p) => s + (parseFloat(p.realizedPnL)   || 0), 0);
        const unrealPnL = openPos .reduce((s, p) => s + (parseFloat(p.unrealizedPnL)  || 0), 0);
        // BUG FIX: capitalUSD es el campo primario de investment-manager.createPosition()
        const invested  = roundPos.reduce((s, p) => {
          const v = parseFloat(p.capitalUSD || p.amountUSD || p.investedUSD || p.entryAmountUSD || 0);
          return s + v;
        }, 0);
        const netPnL    = realPnL + unrealPnL;
        const wins      = closedPos.filter(p => (parseFloat(p.realizedPnL) || 0) > 0).length;
        const losses    = closedPos.length - wins;
        const winRate   = closedPos.length > 0
          ? Math.round(wins / closedPos.length * 100) : null;

        // ── % actual desde compra (media ponderada por capital) ───────────────
        let avgChangePct = null;
        if (openPos.length > 0) {
          const totalCap = openPos.reduce((s, p) => s + (parseFloat(p.capitalUSD || p.amountUSD || 0) || 0), 0);
          const totalUnr = openPos.reduce((s, p) => s + (parseFloat(p.unrealizedPnL) || 0), 0);
          if (totalCap > 0) {
            avgChangePct = parseFloat((totalUnr / totalCap * 100).toFixed(2));
          } else {
            const withPct = openPos.filter(p => p.unrealizedPnLPct != null);
            if (withPct.length > 0)
              avgChangePct = parseFloat(
                (withPct.reduce((s, p) => s + parseFloat(p.unrealizedPnLPct), 0) / withPct.length).toFixed(2)
              );
          }
        }

        // ── Target efectivo de venta ──────────────────────────────────────────
        // Criterio real: venta cuando pnlPct >= TP  O  pnlPct >= predictedChange
        const cfgTP   = parseFloat(current.config?.takeProfitPct || 0);
        const minPred = openPos.length > 0
          ? openPos.reduce((min, p) => {
              const pred = parseFloat(p.predictedChange || 0);
              return (pred > 0 && pred < min) ? pred : min;
            }, cfgTP > 0 ? cfgTP : Infinity)
          : cfgTP;
        const effectiveTarget = isFinite(minPred) && minPred > 0 ? minPred : cfgTP;
        const targetNote = (cfgTP > 0 && effectiveTarget < cfgTP)
          ? `TP ${cfgTP}% · pred ${effectiveTarget.toFixed(1)}%`
          : cfgTP > 0 ? `TP config: ${cfgTP}%` : '—';

        const isExpanded = window._execViewExpanded;

        activeDiv.innerHTML = `
          <div class="rounded-xl border border-indigo-900/60 bg-gradient-to-b from-indigo-950/40 to-gray-950/60 overflow-hidden mb-4">

            <!-- Cabecera -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-indigo-900/40">
              <div class="flex items-center gap-2.5">
                <span class="relative flex h-2.5 w-2.5">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                <div>
                  <p class="font-bold text-sm text-indigo-200">
                    Ronda #${current.roundNumber} &mdash; En curso
                  </p>
                  <p class="text-xs text-gray-500">
                    Iniciada ${_timeAgo(current.openedAt)} &nbsp;·&nbsp;
                    Modo <span class="text-gray-400">${current.config?.mode || '—'}</span> &nbsp;·&nbsp;
                    TP <span class="text-green-500">${current.config?.takeProfitPct || '—'}%</span>
                    / SL <span class="text-red-500">${current.config?.stopLossPct || '—'}%</span>
                  </p>
                </div>
              </div>
              <div class="flex gap-2">
                <button
                  onclick="window._execViewExpanded=!window._execViewExpanded; window.loadInvestRounds()"
                  class="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-gray-300 transition-colors">
                  ${isExpanded ? '▲ Ocultar detalle' : '▼ Ver detalle'}
                </button>
                <button
                  onclick="if(confirm('¿Cerrar ronda?')) fetch('/api/invest/rounds/close',{method:'POST'}).then(r=>r.json()).then(d=>{if(d.success){loadInvestRounds();loadInvestOverview();}else{alert('❌ '+d.error);}})"
                  class="text-xs bg-red-900/60 hover:bg-red-900 border border-red-900 px-3 py-1.5 rounded-lg text-red-300 transition-colors">
                  🔒 Cerrar
                </button>
              </div>
            </div>

            <!-- KPIs -->
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 p-4">
              ${_kpi('💰 Invertido',    _fmtUsdAbs(invested), 'text-blue-300')}
              ${_kpi('📈 Resultado neto',
                _fmtUsd(netPnL),
                _pnlClass(netPnL),
                `Real ${_fmtUsd(realPnL)} · Est. ${_fmtUsd(unrealPnL)}`
              )}
              ${_kpi('🔢 Operaciones',
                roundPos.length,
                'text-white',
                `${openPos.length} abiertas · ${closedPos.length} cerradas`
              )}
              ${_kpi('🎯 Win rate',
                winRate !== null ? `${winRate}%` : '—',
                winRate === null ? 'text-gray-500'
                  : winRate >= 60 ? 'text-green-400'
                  : winRate >= 40 ? 'text-yellow-400' : 'text-red-400',
                winRate !== null ? `${wins}✓ &nbsp; ${losses}✗` : 'Sin cerradas'
              )}
              ${openPos.length > 0 && avgChangePct !== null
                ? _kpi(
                    `📊 Actual${openPos.length > 1 ? ' (media)' : ''}`,
                    `${avgChangePct >= 0 ? '+' : ''}${avgChangePct}%`,
                    avgChangePct > 0  ? 'text-green-400'
                    : avgChangePct < 0 ? 'text-red-400' : 'text-gray-400',
                    `${openPos.length} pos. abierta${openPos.length !== 1 ? 's' : ''}`
                  )
                : _kpi('📊 Actual', '—', 'text-gray-600', 'Sin pos. abiertas')
              }
              ${_kpi(
                '🎯 Target venta',
                effectiveTarget > 0 ? `+${effectiveTarget.toFixed(1)}%` : '—',
                effectiveTarget > 0 ? 'text-yellow-400' : 'text-gray-500',
                targetNote
              )}
            </div>

            <!-- Tabla compacta de operaciones -->
            <div class="px-4 pb-4">
              ${roundPos.length > 0 ? `
              <div class="overflow-x-auto rounded-xl border border-gray-800/60">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="bg-gray-900/80 text-gray-500 text-xs uppercase tracking-wider">
                      <th class="py-2 px-3 text-left font-medium">Op</th>
                      <th class="py-2 px-3 text-left font-medium">Activo</th>
                      <th class="py-2 px-3 text-left font-medium">Razón</th>
                      <th class="py-2 px-3 text-right font-medium">Pred.</th>
                      <th class="py-2 px-3 text-right font-medium">% Actual</th>
                      <th class="py-2 px-3 text-right font-medium">P&L</th>
                      <th class="py-2 px-3 text-right font-medium">Hace</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-800/40 bg-gray-950/60">
                    ${roundPos.map(_renderOpRow).join('')}
                  </tbody>
                </table>
              </div>` : `
              <p class="text-gray-600 text-sm text-center py-6">
                Sin operaciones en esta ronda aún.
              </p>`}
            </div>

            <!-- Sección de detalle colapsable -->
            <div id="exec-detail-section"
              class="${isExpanded ? '' : 'hidden'} border-t border-indigo-900/30">
              <div id="exec-detail-inner" class="p-4">
                ${_buildDetailHtml(roundPos, openPos, closedPos)}
              </div>
            </div>

          </div>`;

      } else {
        // Sin ronda activa
        activeDiv.innerHTML = `
          <div class="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-8 mb-4 text-center">
            <p class="text-3xl mb-3">💤</p>
            <p class="text-gray-400 font-medium">Sin ronda activa</p>
            <p class="text-xs text-gray-600 mt-1.5">
              Inicia una nueva ronda para comenzar a registrar inversiones
            </p>
          </div>`;
      }

      // ── Historial de rondas cerradas ────────────────────────────────────────
      if (rounds.length === 0) {
        histDiv.innerHTML = '<p class="text-gray-700 text-sm text-center py-4">Sin rondas cerradas aún.</p>';
        return;
      }

      histDiv.innerHTML =
        `<div class="flex items-center gap-2 mb-3">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Historial</p>
          <div class="flex-1 h-px bg-gray-800"></div>
        </div>` +
        rounds.map(r => _renderClosedRoundCard(r, allPos)).join('');

    } catch (e) {
      console.error('[patch-rounds-executive] Error:', e);
      if (activeDiv) activeDiv.innerHTML =
        `<p class="text-red-400 text-sm">❌ Error: ${e.message}</p>`;
    }
  };

  // ── HTML de la vista de detalle ────────────────────────────────────────────

  function _buildDetailHtml(roundPos, openPos, closedPos) {
    const _posCard = p => {
      const isBuy  = p.status === 'open';
      const pnl    = isBuy
        ? (parseFloat(p.unrealizedPnL) || 0)
        : (parseFloat(p.realizedPnL)   || 0);
      const symbol = (p.symbol || p.assetId || '?').toUpperCase();
      const border = isBuy ? 'border-blue-900/60'
                   : pnl >= 0 ? 'border-green-900/60' : 'border-red-900/60';

      return `
        <div class="bg-gray-900 border ${border} rounded-xl p-3 mb-2">
          <div class="flex justify-between items-start gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-bold text-sm text-white">${symbol}</span>
                <span class="text-xs ${isBuy ? 'text-blue-400' : pnl >= 0 ? 'text-green-400' : 'text-red-400'}">
                  ${isBuy ? '🔓 Abierta' : '🔒 Cerrada'}
                </span>
              </div>
              <p class="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
                ${p.closeReason || p.reason || p.signal || '—'}
              </p>
              ${p.predictedChange != null ? `
              <p class="text-xs text-gray-600 mt-0.5">
                Pred: <span class="text-gray-400">${parseFloat(p.predictedChange) >= 0 ? '+' : ''}${parseFloat(p.predictedChange).toFixed(2)}%</span>
                ${p.actualChangePct != null ? `
                 → Real: <span class="${_pnlClass(p.actualChangePct)}">${parseFloat(p.actualChangePct) >= 0 ? '+' : ''}${parseFloat(p.actualChangePct).toFixed(2)}%</span>` : ''}
              </p>` : ''}
              ${p.entryPrice ? `
              <p class="text-xs text-gray-700 mt-1">
                Entrada $${parseFloat(p.entryPrice).toFixed(4)}
                ${p.exitPrice ? ` · Salida $${parseFloat(p.exitPrice).toFixed(4)}` : ''}
                ${p.amountUSD ? ` · ${_fmtUsdAbs(p.amountUSD)} invertidos` : ''}
              </p>` : ''}
            </div>
            <div class="text-right shrink-0">
              <p class="font-bold text-lg ${_pnlClass(pnl)} leading-tight">${_fmtUsd(pnl)}</p>
              <p class="text-xs text-gray-600">
                ${isBuy ? `hace ${_timeAgo(p.openedAt)}` : `cerrada ${_timeAgo(p.closedAt)}`}
              </p>
              ${isBuy ? `
              <button
                onclick="if(confirm('¿Cerrar ${symbol}?')) closePosition('${p.id}')"
                class="mt-1 text-xs bg-red-900/60 hover:bg-red-900 px-2 py-0.5 rounded text-red-300 transition-colors">
                Cerrar
              </button>` : ''}
            </div>
          </div>
        </div>`;
    };

    return `
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">📋 Posiciones completas</p>
      ${openPos.length > 0 ? `
        <p class="text-xs text-blue-400 mb-2">🔓 Abiertas (${openPos.length})</p>
        ${openPos.map(_posCard).join('')}` : ''}
      ${closedPos.length > 0 ? `
        <p class="text-xs text-gray-500 mb-2 ${openPos.length > 0 ? 'mt-4' : ''}">🔒 Cerradas (${closedPos.length})</p>
        ${closedPos.map(_posCard).join('')}` : ''}
      ${roundPos.length === 0 ? `
        <p class="text-gray-600 text-sm text-center py-6">Sin posiciones en esta ronda.</p>` : ''}
      <div class="flex gap-2 mt-4 pt-3 border-t border-gray-800">
        <button onclick="evaluateCycle()"
          class="bg-orange-900/60 hover:bg-orange-900 border border-orange-900 px-4 py-2 rounded-lg text-xs font-semibold text-orange-300 transition-colors">
          🔬 Diagnosticar
        </button>
        <button onclick="openCloseRoundModal()"
          class="bg-red-900/60 hover:bg-red-900 border border-red-900 px-4 py-2 rounded-lg text-xs font-semibold text-red-300 transition-colors">
          🔒 Cerrar ronda
        </button>
      </div>`;
  }

  // ── Card de ronda cerrada ──────────────────────────────────────────────────

  function _renderClosedRoundCard(r, allPos) {
    const roundStart = r.openedAt ? new Date(r.openedAt).getTime() : 0;
    const roundEnd   = r.closedAt ? new Date(r.closedAt).getTime() : Date.now();
    const roundPos   = allPos.filter(p => {
      const t = p.openedAt ? new Date(p.openedAt).getTime() : 0;
      return roundStart > 0 && t >= roundStart && t <= roundEnd;
    });

    const closedInRound = roundPos.filter(p => p.status === 'closed');
    const realPnL  = closedInRound.reduce((s, p) => s + (parseFloat(p.realizedPnL) || 0), 0);
    const wins     = closedInRound.filter(p => (parseFloat(p.realizedPnL) || 0) > 0).length;
    const winRate  = closedInRound.length > 0
      ? Math.round(wins / closedInRound.length * 100) : null;

    return `
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-2 flex justify-between items-center gap-3">
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-300">Ronda #${r.roundNumber}</p>
          <p class="text-xs text-gray-600">
            ${_fmtTs(r.openedAt)} → ${_fmtTs(r.closedAt)} · ${closedInRound.length} ops
          </p>
        </div>
        <div class="flex items-center gap-5 text-right shrink-0">
          ${winRate !== null ? `
          <div>
            <p class="text-xs text-gray-600">Win rate</p>
            <p class="font-bold text-sm ${winRate >= 60 ? 'text-green-400' : winRate >= 40 ? 'text-yellow-400' : 'text-red-400'}">
              ${winRate}%
            </p>
          </div>` : ''}
          <div>
            <p class="text-xs text-gray-600">P&L</p>
            <p class="font-bold text-sm ${_pnlClass(realPnL)}">${_fmtUsd(realPnL)}</p>
          </div>
        </div>
      </div>`;
  }

  console.log('[patch-rounds-executive] ✅ v2.2 — Persistencia y visibilidad de ventas corregida');

})();
