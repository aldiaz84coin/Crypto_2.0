/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: patch-round-verbose.js
 *
 *  Restaura la verbosidad completa de la card de ronda activa.
 *  Muestra en inv-rounds-active:
 *    • Barra de config: TP / SL / Capital / Fee / MaxHold
 *    • Métricas en vivo: Win Rate, posiciones, P&L bruto, fees, neto, no realizado
 *    • Position cards completas inline (predicción, BoostPower, ciclo, TP/SL, botón cerrar)
 *  Sobreescribe el override anterior de patch-rounds-v3.
 * ══════════════════════════════════════════════════════════════════
 */

(function patchRoundVerbose() {
  'use strict';

  // ── Timers por posición (usa el mismo objeto global) ─────────────────────
  function _clearRoundTimers() {
    if (typeof positionCycleTimers === 'undefined') return;
    Object.keys(positionCycleTimers).forEach(id => {
      clearInterval(positionCycleTimers[id]);
      delete positionCycleTimers[id];
    });
  }

  // ── Formateo ─────────────────────────────────────────────────────────────
  function _fmt(v) {
    if (v == null || isNaN(v)) return '—';
    const n = parseFloat(v);
    if (n === 0) return '0.00';
    if (Math.abs(n) < 0.0001) return n.toExponential(2);
    if (Math.abs(n) < 0.01)   return n.toFixed(6);
    if (Math.abs(n) < 1)      return n.toFixed(4);
    if (Math.abs(n) < 10)     return n.toFixed(3);
    if (Math.abs(n) < 1000)   return n.toFixed(2);
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  function _fmtUSD(v) {
    const n = parseFloat(v) || 0;
    const abs = Math.abs(n);
    const s = abs < 0.001 ? n.toFixed(6) : abs < 0.01 ? n.toFixed(4) : n.toFixed(2);
    return (n >= 0 ? '+$' : '-$') + Math.abs(parseFloat(s)).toFixed(s.split('.')[1]?.length || 2);
  }

  function _durStr(ms) {
    if (!ms || ms <= 0) return '—';
    if (ms >= 86400000) return Math.floor(ms/86400000)+'d '+Math.floor((ms%86400000)/3600000)+'h';
    if (ms >= 3600000)  return Math.floor(ms/3600000)+'h '+Math.floor((ms%3600000)/60000)+'m';
    return Math.floor(ms/60000)+'m';
  }

  // ── Override principal: loadInvestRounds ─────────────────────────────────
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
        histDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${roundsRes.error}</p>`;
        return;
      }

      const current = roundsRes.current;
      const rounds  = roundsRes.rounds || [];
      const allOpen   = posRes.success ? (posRes.open   || []) : [];
      const allClosed = posRes.success ? (posRes.closed || []) : [];

      // ── Ronda ACTIVA ────────────────────────────────────────────────────
      if (current && current.status === 'active') {
        const c          = current;
        const roundStart = c.openedAt ? new Date(c.openedAt).getTime() : 0;
        const now        = Date.now();
        const durationMs = roundStart ? now - roundStart : null;

        // Posiciones de esta ronda
        const roundOpen   = allOpen;
        const roundClosed = roundStart
          ? allClosed.filter(p => {
              const pOpen   = p.openedAt  ? new Date(p.openedAt).getTime()  : 0;
              const pClosed = p.closedAt  ? new Date(p.closedAt).getTime()  : 0;
              return pOpen >= roundStart || pClosed >= roundStart;
            })
          : allClosed;

        // Métricas
        const totalClosed  = roundClosed.length;
        const wins         = roundClosed.filter(p => (p.realizedPnL || 0) > 0).length;
        const losses       = totalClosed - wins;
        const winRate      = totalClosed > 0 ? (wins / totalClosed * 100) : null;
        const wrColor      = winRate === null ? 'text-gray-500'
                           : winRate >= 60    ? 'text-green-400'
                           : winRate >= 45    ? 'text-yellow-400' : 'text-red-400';

        const capitalOpen   = roundOpen.reduce((s, p) => s + (p.capitalUSD || 0), 0);
        const capitalClosed = roundClosed.reduce((s, p) => s + (p.capitalUSD || 0), 0);
        const grossPnL      = roundClosed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
        const totalFees     = roundClosed.reduce((s, p) =>
          s + (p.totalFeesUSD || (p.entryFeeUSD || 0) + (p.exitFeeUSD || 0) + (p.apiCostUSD || 0)), 0);
        const netResult     = grossPnL - totalFees;
        const netResultPct  = capitalClosed > 0 ? (netResult / capitalClosed * 100) : 0;
        const unrealPnL     = roundOpen.reduce((s, p) => s + (p.unrealizedPnL || 0), 0);

        const netColor  = netResult >= 0 ? 'text-green-400' : 'text-red-400';
        const netBg     = netResult >= 0 ? 'bg-green-950/50 border border-green-800' : 'bg-red-950/50 border border-red-900';
        const unrColor  = unrealPnL >= 0 ? 'text-blue-400' : 'text-orange-400';
        const since     = durationMs ? _durStr(durationMs) : '—';
        const sinceRel  = c.openedAt ? (() => {
          const d = now - new Date(c.openedAt).getTime();
          const h = Math.floor(d/3600000), m = Math.floor((d%3600000)/60000);
          return h > 24 ? `hace ${Math.floor(h/24)}d ${h%24}h` : h > 0 ? `hace ${h}h ${m}m` : `hace ${m}m`;
        })() : '—';

        // ── Render position cards ───────────────────────────────────────
        _clearRoundTimers();
        const posCardsHTML = roundOpen.length > 0
          ? roundOpen.map(p => {
              if (typeof renderPositionCard === 'function') return renderPositionCard(p, true);
              // Fallback compacto si renderPositionCard no está disponible
              const pnl     = p.unrealizedPnL || 0;
              const pnlPct  = p.unrealizedPnLPct || 0;
              const pColor  = pnl >= 0 ? 'text-green-400' : 'text-red-400';
              const border  = pnl >= 0 ? 'border-green-800' : 'border-red-800';
              return `
                <div class="bg-gray-900 rounded-xl border ${border} p-4 mb-3">
                  <div class="flex justify-between items-start">
                    <div>
                      <p class="font-bold">${p.name} <span class="text-gray-500 mono text-xs">${(p.symbol||'').toUpperCase()}</span></p>
                      <p class="text-xs text-gray-500 mt-1">
                        Entrada: <span class="mono text-white">$${_fmt(p.entryPrice)}</span>
                        · Actual: <span class="mono text-white">$${_fmt(p.currentPrice)}</span>
                      </p>
                      <p class="text-xs text-gray-500">
                        TP: <span class="mono text-green-400">$${_fmt(p.takeProfitPrice)}</span>
                        · SL: <span class="mono text-red-400">$${_fmt(p.stopLossPrice)}</span>
                      </p>
                      ${p.predictedChange != null ? `<p class="text-xs mt-0.5">
                        Pred: <span class="mono text-blue-400">${p.predictedChange >= 0 ? '+' : ''}${(p.predictedChange||0).toFixed(2)}%</span>
                        ${p.boostPower != null ? `· BP: <span class="mono text-purple-400">${(p.boostPower||0).toFixed(3)}</span>` : ''}
                      </p>` : ''}
                    </div>
                    <div class="text-right ml-3">
                      <p class="${pColor} text-xl font-bold mono">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</p>
                      <p class="${pColor} text-sm mono">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(4)}</p>
                      <button onclick="closePosition('${p.id}')" class="mt-2 bg-red-900 hover:bg-red-800 px-3 py-1 rounded text-xs text-red-300">✕ Cerrar</button>
                    </div>
                  </div>
                </div>`;
            }).join('')
          : '<p class="text-gray-500 text-sm text-center py-3">Sin posiciones abiertas en esta ronda</p>';

        activeDiv.innerHTML = `
          <div class="bg-indigo-950/50 border border-indigo-700 rounded-xl p-4 mb-4">

            <!-- Header -->
            <div class="flex items-center justify-between mb-4">
              <div>
                <p class="font-semibold text-indigo-300 text-base">🎯 Ronda #${c.roundNumber} — Activa</p>
                <p class="text-xs text-gray-400 mt-0.5">
                  Iniciada ${sinceRel} · ⏱ ${since}
                  · Modo <span class="text-white font-medium">${c.config?.mode || '—'}</span>
                </p>
              </div>
              <button onclick="openCloseRoundModal()"
                class="bg-red-800 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold">
                🏁 Cerrar Ronda
              </button>
            </div>

            <!-- Config bar: TP / SL / Capital / Fee / MaxHold -->
            <div class="grid grid-cols-5 gap-2 text-xs mb-4">
              <div class="bg-gray-900 rounded-lg p-2 text-center">
                <p class="text-gray-500">Take Profit</p>
                <p class="font-bold text-green-400">+${c.config?.takeProfitPct || '—'}%</p>
              </div>
              <div class="bg-gray-900 rounded-lg p-2 text-center">
                <p class="text-gray-500">Stop Loss</p>
                <p class="font-bold text-red-400">-${c.config?.stopLossPct || '—'}%</p>
              </div>
              <div class="bg-gray-900 rounded-lg p-2 text-center">
                <p class="text-gray-500">Capital</p>
                <p class="font-bold text-white">$${c.config?.capitalTotal || '—'}</p>
              </div>
              <div class="bg-gray-900 rounded-lg p-2 text-center">
                <p class="text-gray-500">Fee est.</p>
                <p class="font-bold text-orange-400">${c.config?.feePct || '—'}%</p>
              </div>
              <div class="bg-gray-900 rounded-lg p-2 text-center">
                <p class="text-gray-500">Max hold</p>
                <p class="font-bold text-white">${c.config?.maxHoldCycles || '—'} ciclos</p>
              </div>
            </div>

            <!-- Título métricas -->
            <div class="flex items-center justify-between mb-3">
              <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">📊 Métricas en vivo</p>
              <button onclick="loadInvestRounds()"
                class="text-gray-600 hover:text-gray-300 text-xs transition-colors">🔄 Actualizar</button>
            </div>

            <!-- Fila 1: Win Rate + posiciones abiertas + posiciones cerradas -->
            <div class="grid grid-cols-3 gap-2 text-xs mb-2">
              <div class="bg-gray-900 rounded-xl p-3 text-center">
                <p class="text-gray-500 mb-1">Tasa de acierto</p>
                <p class="font-bold text-2xl ${wrColor}">${winRate !== null ? winRate.toFixed(1) + '%' : '—'}</p>
                <p class="text-gray-600 mt-0.5">${wins}✅ · ${losses}❌ de ${totalClosed}</p>
              </div>
              <div class="bg-gray-900 rounded-xl p-3 text-center">
                <p class="text-gray-500 mb-1">En posiciones abiertas</p>
                <p class="font-bold text-xl text-blue-400">${roundOpen.length} pos.</p>
                <p class="text-blue-300/70 font-mono mt-0.5">$${(capitalOpen||0).toFixed(2)}</p>
              </div>
              <div class="bg-gray-900 rounded-xl p-3 text-center">
                <p class="text-gray-500 mb-1">Posiciones cerradas</p>
                <p class="font-bold text-xl text-gray-300">${totalClosed} pos.</p>
                <p class="text-gray-500 font-mono mt-0.5">$${(capitalClosed||0).toFixed(2)} mov.</p>
              </div>
            </div>

            <!-- Fila 2: P&L bruto + fees + resultado neto + no realizado -->
            <div class="grid grid-cols-4 gap-2 text-xs mb-4">
              <div class="bg-gray-900 rounded-xl p-3 text-center">
                <p class="text-gray-500 mb-1">P&L Bruto</p>
                <p class="font-bold mono ${grossPnL >= 0 ? 'text-green-400' : 'text-red-400'}">
                  ${grossPnL >= 0 ? '+' : ''}$${Math.abs(grossPnL).toFixed(2)}
                </p>
                <p class="text-gray-600 mt-0.5">antes de fees</p>
              </div>
              <div class="bg-gray-900 rounded-xl p-3 text-center">
                <p class="text-gray-500 mb-1">Fees</p>
                <p class="font-bold mono text-orange-400">-$${(totalFees||0).toFixed(4)}</p>
                <p class="text-gray-600 mt-0.5">entrada + salida</p>
              </div>
              <div class="${netBg} rounded-xl p-3 text-center">
                <p class="text-gray-400 mb-1 font-semibold">Resultado Neto</p>
                <p class="font-bold mono ${netColor}">${netResult >= 0 ? '+' : ''}$${Math.abs(netResult).toFixed(2)}</p>
                <p class="${netColor} opacity-80 font-mono mt-0.5">${netResultPct >= 0 ? '+' : ''}${netResultPct.toFixed(2)}%</p>
              </div>
              <div class="${unrealPnL >= 0 ? 'bg-blue-950/40 border border-blue-900' : 'bg-orange-950/40 border border-orange-900'} rounded-xl p-3 text-center">
                <p class="text-gray-400 mb-1">No Realizado</p>
                <p class="font-bold mono ${unrColor}">${unrealPnL >= 0 ? '+' : ''}$${Math.abs(unrealPnL).toFixed(2)}</p>
                <p class="text-gray-600 mt-0.5 text-xs">${roundOpen.length} abiertas</p>
              </div>
            </div>

            <!-- Posiciones abiertas inline -->
            ${roundOpen.length > 0 ? `
            <div class="border-t border-indigo-900/60 pt-4">
              <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                🔓 Posiciones abiertas (${roundOpen.length})
              </p>
              <div id="rv-open-positions">
                ${posCardsHTML}
              </div>
            </div>` : `
            <div class="border-t border-indigo-900/60 pt-3">
              <p class="text-xs text-gray-600 text-center">⚡ Sin posiciones abiertas · El P&L es final</p>
            </div>`}

          </div>`;

        // Arrancar timers live después de render
        if (roundOpen.length > 0) {
          setTimeout(() => {
            roundOpen.forEach(p => {
              if (p.cycleInfo && typeof startPositionCycleTimer === 'function') {
                startPositionCycleTimer(p.id, p.cycleInfo);
              }
            });
          }, 80);
        }

      } else {
        // Sin ronda activa
        activeDiv.innerHTML = `
          <div class="bg-gray-900 border border-gray-700 border-dashed rounded-xl p-4 mb-4 text-center">
            <p class="text-gray-500 mb-3">Sin ronda activa</p>
            <button onclick="openNewRoundWizard()"
              class="bg-indigo-700 hover:bg-indigo-600 px-5 py-2.5 rounded-lg text-sm font-bold">
              🚀 Abrir Nueva Ronda de Inversión
            </button>
          </div>`;
      }

      // ── Historial de rondas cerradas ──────────────────────────────────────
      if (!rounds || rounds.length === 0) {
        histDiv.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">Sin rondas cerradas aún.</p>';
        return;
      }

      histDiv.innerHTML = `
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Historial de Rondas Cerradas (${rounds.length})
        </p>
        <div class="space-y-3">
          ${rounds.map(rnd => _renderRoundHistoryCard(rnd)).join('')}
        </div>`;

    } catch (e) {
      console.error('[patch-round-verbose] loadInvestRounds error:', e);
      if (histDiv) histDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${e.message}</p>`;
    }
  };

  // ── Render card de historial ─────────────────────────────────────────────
  function _renderRoundHistoryCard(rnd) {
    const rep         = rnd.report || {};
    const net         = rep.netReturnPct || 0;
    const netUSD      = rep.netReturnUSD || 0;
    const netColor    = net >= 0 ? 'text-green-400' : 'text-red-400';
    const borderColor = net >= 1.5 ? 'border-green-800' : net >= 0 ? 'border-gray-700' : 'border-red-900';
    const since       = rnd.openedAt
      ? new Date(rnd.openedAt).toLocaleDateString('es-ES', {day:'2-digit', month:'short', year:'2-digit'})
      : '—';
    const dur = rep.durationHrs
      ? (rep.durationHrs >= 24 ? Math.round(rep.durationHrs/24)+'d' : rep.durationHrs.toFixed(1)+'h')
      : '—';
    const safeRnd = JSON.stringify(rnd).replace(/"/g, '&quot;');

    return `
      <div class="bg-gray-900 border ${borderColor} rounded-xl p-4">
        <div class="flex items-center justify-between mb-3">
          <div>
            <span class="font-semibold">Ronda #${rnd.roundNumber}</span>
            <span class="text-xs text-gray-500 ml-2">${since} · ${dur}</span>
            ${rnd.config?.mode === 'speculative' ? '<span class="ml-2 text-xs text-yellow-400 bg-yellow-950 px-1.5 py-0.5 rounded">Especulativo</span>' : ''}
          </div>
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold mono ${netColor}">${net >= 0 ? '+' : ''}${net.toFixed(2)}%</span>
            <button onclick="showRoundReport(${safeRnd})"
              class="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg">
              📊 Informe
            </button>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-2 text-xs">
          <div class="text-center">
            <p class="text-gray-500">Operaciones</p>
            <p class="font-semibold">${rep.totalOperations || 0}</p>
          </div>
          <div class="text-center">
            <p class="text-gray-500">Win Rate</p>
            <p class="font-semibold ${rep.winRate >= 50 ? 'text-blue-400' : 'text-gray-300'}">
              ${rep.winRate != null ? rep.winRate + '%' : '—'}
            </p>
          </div>
          <div class="text-center">
            <p class="text-gray-500">P&L Neto</p>
            <p class="font-semibold mono ${netColor}">${netUSD >= 0 ? '+' : ''}$${(netUSD).toFixed(2)}</p>
          </div>
          <div class="text-center">
            <p class="text-gray-500">Fees</p>
            <p class="font-semibold text-orange-400">$${(rep.totalFeesUSD||0).toFixed(3)}</p>
          </div>
        </div>
      </div>`;
  }

  // ── Auto-refresh cada vez que se carga la tab de inversión ───────────────
  const _origSetTab = window.setTab;
  if (_origSetTab) {
    window.setTab = function(tab) {
      _origSetTab(tab);
      if (tab === 'invest' || tab === 'inv-rounds') {
        setTimeout(() => {
          if (typeof loadInvestRounds === 'function') loadInvestRounds();
        }, 50);
      }
    };
  }

  console.log('[patch-round-verbose] ✅ Cargado');
})();
