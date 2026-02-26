/**
 * patch-performance-v2.js
 * ════════════════════════════════════════════════════════════════
 * PARCHE: Rendimiento histórico desglosado + métricas parciales en ciclo activo
 *
 * Problemas que resuelve:
 *  1. loadInvestPerformance() — rediseño completo: muestra rondas separadas,
 *     compras manuales, detector; cada sección con inversión vs retorno neto
 *     y estado abierto/cerrado bien claro.
 *  2. loadInvestRounds() — sección de ronda activa con P&L parcial en tiempo real
 *     (realizados + no realizados) para tener "foto actual" mientras el ciclo corre.
 *
 * INSTALACIÓN:
 *   Añadir antes de </body> en public/index.html:
 *   <script src="/patch-performance-v2.js"></script>
 * ════════════════════════════════════════════════════════════════
 */

/* ─── Helpers ────────────────────────────────────────────────────────────────── */
function _p2_fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function _p2_fmtRel(ts) {
  if (!ts) return '—';
  const d = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
  const h = Math.floor(d / 3600000), m = Math.floor((d % 3600000) / 60000);
  if (h > 48) return `hace ${Math.floor(h / 24)}d`;
  if (h > 0)  return `hace ${h}h ${m}m`;
  return `hace ${m}m`;
}

function _p2_pnlColor(v) {
  return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

function _p2_pnlBg(v) {
  return v > 0 ? 'bg-green-950 border-green-900' : v < 0 ? 'bg-red-950 border-red-900' : 'bg-gray-900 border-gray-800';
}

function _p2_sign(v) { return v > 0 ? '+' : ''; }

function _p2_calcStats(positions) {
  const closed = positions.filter(p => p.status === 'closed');
  const open   = positions.filter(p => p.status === 'open');
  const invested   = closed.reduce((s, p) => s + (p.capitalUSD || 0), 0);
  // realizedPnL ya es NETO de fees — netReturn = totalPnL directamente, sin restar fees de nuevo
  const pnl        = closed.reduce((s, p) => s + (p.realizedPnL || 0), 0);
  const fees       = closed.reduce((s, p) => s + (p.totalFeesUSD || 0), 0);  // solo informativo para mostrar desglose
  const netReturn  = pnl;  // FIX: pnl ya es el retorno neto real
  const unrealized = open.reduce((s, p)   => s + (p.unrealizedPnL || 0), 0);
  const wins       = closed.filter(p => (p.realizedPnL || 0) > 0);
  return { closed, open, invested, pnl, fees, netReturn, unrealized, wins,
    netPct: invested > 0 ? netReturn / invested * 100 : 0,
    winRate: closed.length > 0 ? wins.length / closed.length * 100 : null };
}

/* ─── Render de una posición mini (para desplegables) ───────────────────────── */
function _p2_renderMiniPos(p) {
  const isOpen   = p.status === 'open';
  const pnl      = isOpen ? (p.unrealizedPnL || 0) : (p.realizedPnL || 0);
  const pnlPct   = isOpen ? (p.unrealizedPnLPct || 0) : (p.realizedPnLPct || 0);
  const color    = _p2_pnlColor(pnl);
  const closeTag = isOpen
    ? `<span class="text-xs text-yellow-400 font-semibold">● ABIERTA</span>`
    : `<span class="text-xs text-gray-500">${p.closeReason?.split(':')[0] || '—'}</span>`;
  return `
    <div class="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-semibold text-sm text-gray-100">${p.symbol || p.assetId || '—'}</span>
        ${closeTag}
        <span class="text-xs text-gray-600">$${(p.capitalUSD||0).toFixed(0)}</span>
      </div>
      <div class="flex items-center gap-3 text-xs mono shrink-0">
        <span class="${color} font-semibold">${_p2_sign(pnl)}$${pnl.toFixed(2)}</span>
        <span class="${color}">${_p2_sign(pnlPct)}${pnlPct.toFixed(2)}%</span>
      </div>
    </div>`;
}

/* ─── Render tarjeta de ronda (activa o cerrada) ────────────────────────────── */
function _p2_renderRoundCard(round, allPositions) {
  const isActive  = round.status === 'active';
  const report    = round.report || {};
  const roundStart = round.openedAt ? new Date(round.openedAt).getTime() : 0;
  const roundEnd   = round.closedAt ? new Date(round.closedAt).getTime() : Date.now();

  // Filtrar posiciones de esta ronda por ventana temporal
  const roundPos = allPositions.filter(p => {
    const pOpen  = p.openedAt  ? new Date(p.openedAt).getTime()  : 0;
    const pClose = p.closedAt  ? new Date(p.closedAt).getTime()  : 0;
    if (!roundStart) return false;
    // La posición se abrió dentro de la ronda
    return pOpen >= roundStart && (isActive || pOpen <= roundEnd);
  });

  const stats = _p2_calcStats(roundPos);

  // Si es activa mostramos también no realizados
  const totalIncludeUnrealized = stats.netReturn + stats.unrealized;
  const totalPct = stats.invested > 0 ? totalIncludeUnrealized / stats.invested * 100 : 0;

  const borderColor = isActive ? 'border-blue-800' : stats.netReturn >= 0 ? 'border-green-900' : 'border-red-900';
  const statusBadge = isActive
    ? `<span class="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full font-semibold animate-pulse">● EN CURSO</span>`
    : `<span class="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">CERRADA</span>`;

  const dateInfo = isActive
    ? `Iniciada ${_p2_fmtRel(roundStart)}`
    : `${_p2_fmtDate(round.openedAt)} → ${_p2_fmtDate(round.closedAt)}`;

  // Barra de estado de posiciones
  const totalPos = roundPos.length;
  const openPos  = stats.open.length;
  const closedPos = stats.closed.length;

  const cardId = `round-detail-${round.id || round.roundNumber}`;

  let unrealizedBlock = '';
  if (isActive && stats.open.length > 0) {
    const urColor = _p2_pnlColor(stats.unrealized);
    unrealizedBlock = `
      <div class="flex justify-between items-center mt-1.5 text-xs">
        <span class="text-gray-500">No realizado (${stats.open.length} abiertas)</span>
        <span class="${urColor} mono font-semibold">${_p2_sign(stats.unrealized)}$${stats.unrealized.toFixed(2)}</span>
      </div>`;
  }

  let totalBlock = '';
  if (isActive && totalPos > 0) {
    const totColor = _p2_pnlColor(totalIncludeUnrealized);
    totalBlock = `
      <div class="flex justify-between items-center mt-2 pt-2 border-t border-gray-700 text-sm">
        <span class="text-gray-400 font-semibold">Total parcial</span>
        <span class="${totColor} mono font-bold text-base">
          ${_p2_sign(totalIncludeUnrealized)}$${totalIncludeUnrealized.toFixed(2)}
          <span class="text-sm">(${_p2_sign(totalPct)}${totalPct.toFixed(2)}%)</span>
        </span>
      </div>`;
  }

  const winRateStr = stats.winRate !== null ? `${stats.winRate.toFixed(1)}% WR` : '—';
  const netColor   = _p2_pnlColor(stats.netReturn);

  return `
    <div class="bg-gray-900 border ${borderColor} rounded-xl p-4 mb-3">
      <!-- Header -->
      <div class="flex justify-between items-start mb-3">
        <div>
          <div class="flex items-center gap-2 mb-0.5">
            <span class="font-bold text-white">Ronda #${round.roundNumber || '?'}</span>
            ${statusBadge}
          </div>
          <p class="text-xs text-gray-500">${dateInfo}</p>
        </div>
        <!-- Retorno neto -->
        <div class="text-right">
          <p class="text-xs text-gray-500 mb-0.5">Retorno neto</p>
          <p class="font-bold text-lg mono ${netColor}">
            ${_p2_sign(stats.netReturn)}$${stats.netReturn.toFixed(2)}
          </p>
          <p class="text-xs mono ${netColor}">
            ${_p2_sign(stats.netPct)}${stats.netPct.toFixed(2)}%
            ${stats.invested > 0 ? `<span class="text-gray-600">sobre $${stats.invested.toFixed(0)}</span>` : ''}
          </p>
        </div>
      </div>

      <!-- Stats fila -->
      <div class="grid grid-cols-3 gap-2 mb-3 text-xs">
        <div class="bg-gray-800 rounded-lg p-2 text-center">
          <p class="text-gray-500">Invertido</p>
          <p class="font-semibold text-gray-100 mono">$${stats.invested.toFixed(2)}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-2 text-center">
          <p class="text-gray-500">Win Rate</p>
          <p class="font-semibold ${stats.winRate >= 50 ? 'text-green-400' : stats.winRate !== null ? 'text-red-400' : 'text-gray-500'} mono">
            ${winRateStr}
          </p>
          <p class="text-gray-600 mt-0.5">${closedPos}✓ / ${openPos}⏳</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-2 text-center">
          <p class="text-gray-500">Comisiones</p>
          <p class="font-semibold text-orange-400 mono">-$${stats.fees.toFixed(2)}</p>
        </div>
      </div>

      ${unrealizedBlock}
      ${totalBlock}

      <!-- Posiciones desplegable -->
      ${totalPos > 0 ? `
        <details class="mt-3">
          <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300 select-none">
            ▾ Ver ${totalPos} posicion${totalPos !== 1 ? 'es' : ''} de esta ronda
          </summary>
          <div class="mt-2 pl-1" id="${cardId}">
            ${roundPos.map(_p2_renderMiniPos).join('')}
          </div>
        </details>
      ` : '<p class="text-xs text-gray-600 mt-2">Sin posiciones registradas</p>'}
    </div>`;
}

/* ─── Render sección de operaciones standalone (manual, detector, etc.) ──────── */
function _p2_renderStandaloneSection(title, icon, positions) {
  if (positions.length === 0) return '';
  const stats = _p2_calcStats(positions);
  const netColor = _p2_pnlColor(stats.netReturn);
  const openCount = stats.open.length;

  return `
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-3">
      <div class="flex justify-between items-start mb-3">
        <div>
          <p class="font-semibold text-gray-100">${icon} ${title}</p>
          <p class="text-xs text-gray-500 mt-0.5">
            ${positions.length} operación${positions.length !== 1 ? 'es' : ''}
            ${openCount > 0 ? `· <span class="text-yellow-400">${openCount} abierta${openCount !== 1 ? 's' : ''}</span>` : ''}
          </p>
        </div>
        <div class="text-right">
          <p class="font-bold text-base mono ${netColor}">${_p2_sign(stats.netReturn)}$${stats.netReturn.toFixed(2)}</p>
          <p class="text-xs mono ${netColor}">${_p2_sign(stats.netPct)}${stats.netPct.toFixed(2)}%</p>
          <p class="text-xs text-gray-600">sobre $${stats.invested.toFixed(0)}</p>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 text-xs mb-3">
        <div class="bg-gray-800 rounded-lg p-2 text-center">
          <p class="text-gray-500">Realizadas</p>
          <p class="font-semibold text-gray-100">${stats.closed.length}</p>
        </div>
        <div class="bg-gray-800 rounded-lg p-2 text-center">
          <p class="text-gray-500">Win Rate</p>
          <p class="font-semibold ${stats.winRate >= 50 ? 'text-green-400' : stats.winRate !== null ? 'text-red-400' : 'text-gray-500'}">
            ${stats.winRate !== null ? stats.winRate.toFixed(1) + '%' : '—'}
          </p>
        </div>
        <div class="bg-gray-800 rounded-lg p-2 text-center">
          <p class="text-gray-500">Comisiones</p>
          <p class="font-semibold text-orange-400 mono">-$${stats.fees.toFixed(2)}</p>
        </div>
      </div>

      ${openCount > 0 ? `
        <div class="bg-yellow-950 border border-yellow-900 rounded-lg p-2 mb-2 text-xs">
          <span class="text-yellow-400 font-semibold">● No realizado: </span>
          <span class="mono ${_p2_pnlColor(stats.unrealized)}">${_p2_sign(stats.unrealized)}$${stats.unrealized.toFixed(2)}</span>
        </div>` : ''}

      <details>
        <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300 select-none">
          ▾ Ver todas las posiciones
        </summary>
        <div class="mt-2 pl-1">
          ${positions.map(_p2_renderMiniPos).join('')}
        </div>
      </details>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   OVERRIDE: loadInvestPerformance
   ═══════════════════════════════════════════════════════════════════════════════ */
window.loadInvestPerformance = async function () {
  const div = document.getElementById('inv-perf-content');
  if (!div) return;
  div.innerHTML = '<p class="text-gray-500 text-sm">⏳ Cargando rendimiento...</p>';

  try {
    // Obtener todo en paralelo
    const [perfRes, roundsRes, posRes] = await Promise.all([
      fetch('/api/invest/performance').then(r => r.json()),
      fetch('/api/invest/rounds').then(r => r.json()),
      fetch('/api/invest/positions').then(r => r.json()),
    ]);

    if (!perfRes.success) { div.innerHTML = `<p class="text-red-400 text-sm">❌ ${perfRes.error}</p>`; return; }

    const p        = perfRes.performance;
    const cap      = perfRes.capital || {};
    const rounds   = roundsRes.success ? (roundsRes.rounds || []) : [];
    const current  = roundsRes.success ? roundsRes.current : null;
    const allPos   = posRes.success
      ? [...(posRes.open || []), ...(posRes.closed || [])]
      : [];

    // ── Construir lista completa de rondas (activa primero, luego historial) ──
    const allRounds = [];
    if (current && current.status === 'active') {
      allRounds.push({ ...current, status: 'active' });
    }
    rounds.forEach(r => allRounds.push(r));

    // ── Calcular ventanas de rondas para identificar posiciones standalone ──
    const roundWindows = allRounds
      .filter(r => r.openedAt)
      .map(r => ({
        start: new Date(r.openedAt).getTime(),
        end:   r.closedAt ? new Date(r.closedAt).getTime() : Date.now(),
      }));

    const inAnyRound = (p) => {
      const pOpen = p.openedAt ? new Date(p.openedAt).getTime() : 0;
      return roundWindows.some(w => pOpen >= w.start && pOpen <= w.end);
    };

    // Posiciones que no pertenecen a ninguna ronda
    const standalonePos = allPos.filter(p => !inAnyRound(p));

    // Clasificar standalone por origen
    const manualPos    = standalonePos.filter(p => (p.source === 'manual') || ((p.closeReason || '').startsWith('manual')) || (p.openReason || '').includes('manual'));
    const detectorPos  = standalonePos.filter(p => (p.source === 'pump_detector') || (p.source === 'bug_detector') || (p.openReason || '').includes('detector') || (p.openReason || '').includes('pump'));
    const otherStandalone = standalonePos.filter(p => !manualPos.includes(p) && !detectorPos.includes(p));

    // ── Global stats ──────────────────────────────────────────────────────
    const netColor   = _p2_pnlColor(p.netReturnUSD);
    const netBg      = _p2_pnlBg(p.netReturnUSD);
    const unrealPnL  = cap.unrealizedPnL || 0;
    const unrealColor = _p2_pnlColor(unrealPnL);

    // Total incluyendo no realizado
    const totalPotential    = p.netReturnUSD + unrealPnL;
    const totalPotentialPct = cap.total > 0 ? totalPotential / cap.total * 100 : 0;
    const totColor          = _p2_pnlColor(totalPotential);

    div.innerHTML = `
      <!-- ═══ RESUMEN GLOBAL ═══ -->
      <div class="mb-5">
        <div class="flex items-center gap-2 mb-3">
          <p class="text-sm font-semibold text-gray-300 uppercase tracking-wider">Resumen Global</p>
          <div class="flex-1 h-px bg-gray-800"></div>
        </div>

        <!-- KPIs principales -->
        <div class="grid grid-cols-2 gap-3 mb-3">
          <div class="${netBg} border rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 mb-1">Retorno Neto (realizadas)</p>
            <p class="text-2xl font-bold mono ${netColor}">
              ${_p2_sign(p.netReturnUSD)}$${p.netReturnUSD.toFixed(2)}
            </p>
            <p class="text-sm mono ${netColor}">${_p2_sign(p.netReturnPct)}${p.netReturnPct}%</p>
          </div>
          <div class="${_p2_pnlBg(totalPotential)} border rounded-xl p-4 text-center">
            <p class="text-xs text-gray-500 mb-1">Total Potencial (incl. abiertas)</p>
            <p class="text-2xl font-bold mono ${totColor}">
              ${_p2_sign(totalPotential)}$${totalPotential.toFixed(2)}
            </p>
            <p class="text-sm mono ${totColor}">${_p2_sign(totalPotentialPct)}${totalPotentialPct.toFixed(2)}%</p>
          </div>
        </div>

        <!-- Capital y stats rápidos -->
        <div class="grid grid-cols-4 gap-2 text-xs">
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-2.5 text-center">
            <p class="text-gray-500">Capital total</p>
            <p class="font-bold text-gray-100 mono">$${(cap.total||0).toFixed(0)}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-2.5 text-center">
            <p class="text-gray-500">Disponible</p>
            <p class="font-bold text-green-400 mono">$${(cap.available||0).toFixed(2)}</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-2.5 text-center">
            <p class="text-gray-500">Win Rate</p>
            <p class="font-bold mono ${(p.winRate||0) >= 50 ? 'text-green-400' : 'text-red-400'}">
              ${p.winRate !== null ? p.winRate + '%' : '—'}
            </p>
            <p class="text-gray-600 mt-0.5">${p.winCount||0}W / ${p.lossCount||0}L</p>
          </div>
          <div class="bg-gray-900 border border-gray-800 rounded-lg p-2.5 text-center">
            <p class="text-gray-500">Comisiones</p>
            <p class="font-bold text-orange-400 mono">-$${(p.totalFeesUSD||0).toFixed(2)}</p>
          </div>
        </div>

        ${unrealPnL !== 0 ? `
          <div class="mt-2 bg-gray-900 border border-yellow-900 rounded-lg px-3 py-2 flex justify-between items-center text-xs">
            <span class="text-yellow-400">● P&L no realizado (${p.openPositions||0} posición${(p.openPositions||0)!==1?'es':''})</span>
            <span class="mono font-semibold ${unrealColor}">${_p2_sign(unrealPnL)}$${unrealPnL.toFixed(2)}</span>
          </div>` : ''}
      </div>

      <!-- ═══ RONDAS DE INVERSIÓN ═══ -->
      <div class="mb-5">
        <div class="flex items-center gap-2 mb-3">
          <p class="text-sm font-semibold text-gray-300 uppercase tracking-wider">🎯 Rondas de inversión</p>
          <span class="text-xs text-gray-600">(${allRounds.length})</span>
          <div class="flex-1 h-px bg-gray-800"></div>
        </div>
        ${allRounds.length === 0
          ? '<p class="text-gray-600 text-sm">Sin rondas registradas. Inicia una ronda desde la pestaña Rondas.</p>'
          : allRounds.map(r => _p2_renderRoundCard(r, allPos)).join('')}
      </div>

      <!-- ═══ COMPRAS MANUALES ═══ -->
      ${manualPos.length > 0 ? `
        <div class="mb-5">
          <div class="flex items-center gap-2 mb-3">
            <p class="text-sm font-semibold text-gray-300 uppercase tracking-wider">🔒 Compras Manuales</p>
            <div class="flex-1 h-px bg-gray-800"></div>
          </div>
          ${_p2_renderStandaloneSection('Operaciones manuales', '🔒', manualPos)}
        </div>` : ''}

      <!-- ═══ BUG / PUMP DETECTOR ═══ -->
      ${detectorPos.length > 0 ? `
        <div class="mb-5">
          <div class="flex items-center gap-2 mb-3">
            <p class="text-sm font-semibold text-gray-300 uppercase tracking-wider">🚨 Detector</p>
            <div class="flex-1 h-px bg-gray-800"></div>
          </div>
          ${_p2_renderStandaloneSection('Detector de Pumps / Bugs', '🚨', detectorPos)}
        </div>` : ''}

      <!-- ═══ OTRAS OPERACIONES ═══ -->
      ${otherStandalone.length > 0 ? `
        <div class="mb-5">
          <div class="flex items-center gap-2 mb-3">
            <p class="text-sm font-semibold text-gray-300 uppercase tracking-wider">📦 Otras operaciones</p>
            <div class="flex-1 h-px bg-gray-800"></div>
          </div>
          ${_p2_renderStandaloneSection('Operaciones sin ronda', '📦', otherStandalone)}
        </div>` : ''}

      <!-- Nota si no hay nada standalone -->
      ${standalonePos.length === 0 && allRounds.length > 0 ? `
        <p class="text-xs text-gray-700 text-center mt-2">✓ Todas las operaciones pertenecen a alguna ronda.</p>` : ''}
    `;

  } catch (e) {
    console.error('[patch-performance-v2] Error:', e);
    div.innerHTML = `<p class="text-red-400 text-sm">❌ Error cargando rendimiento: ${e.message}</p>`;
  }
};

// NOTA: loadInvestRounds está gestionado por patch-invest-unified.js (v7)
// que carga antes y es el responsable del tab Rondas. No se sobreescribe aquí.
console.log('[patch-performance-v2] ✅ Rendimiento histórico desglosado + métricas parciales activas');
