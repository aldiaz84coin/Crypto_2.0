// patch-rounds-v3.js — Correcciones rondas cerradas: resumen desempeño + informe Word
// Cargar DESPUÉS de patch-performance-v2.js en index.html
// ════════════════════════════════════════════════════════════════════════════
'use strict';

console.log('[patch-rounds-v3] 🔄 Cargando parche de rondas v3...');

// ── Helpers ──────────────────────────────────────────────────────────────────
function _r3_fmt2(v) { return Math.abs(parseFloat(v||0)).toFixed(2); }
function _r3_sign(v) { return parseFloat(v||0) >= 0 ? '+' : '-'; }
function _r3_pct(v)  { const n=parseFloat(v||0); return (n>=0?'+':'')+n.toFixed(2)+'%'; }
function _r3_usd(v)  { const n=parseFloat(v||0); return (n>=0?'+':'')+`$${Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function _r3_usdAbs(v){ return `$${parseFloat(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function _r3_dur(ms) {
  if (!ms) return '—';
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
  return h >= 24 ? `${Math.floor(h/24)}d ${h%24}h` : `${h}h ${m}m`;
}
function _r3_date(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-ES', {day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'});
}
function _r3_pnlColor(v) { return parseFloat(v||0) >= 0 ? 'text-green-400' : 'text-red-400'; }
function _r3_pnlBg(v)    { return parseFloat(v||0) >= 0 ? 'bg-green-950 border-green-900' : 'bg-red-950 border-red-900'; }
function _r3_wrColor(wr) { return wr >= 60 ? 'text-green-400' : wr >= 40 ? 'text-yellow-400' : 'text-red-400'; }

// ── Descarga de informe Word ──────────────────────────────────────────────────
window.downloadRoundReport = async function(roundId, roundNumber) {
  const btn = document.getElementById(`btn-report-${roundId}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Generando...'; }
  try {
    const resp = await fetch(`/api/invest/rounds/${roundId}/report.docx`);
    if (!resp.ok) {
      const err = await resp.json().catch(()=>({error:'Error desconocido'}));
      alert('❌ ' + (err.error || 'Error generando informe'));
      return;
    }
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `informe-ronda-${roundNumber}.docx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
  } catch(e) {
    alert('❌ ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '📄 Informe Word'; }
  }
};

// ── Render de card de ronda cerrada — versión mejorada ────────────────────────
window._r3_renderRoundCard = function(rnd) {
  const rep = rnd.report || {};
  const net    = parseFloat(rep.netReturnPct || 0);
  const netUSD = parseFloat(rep.netReturnUSD || 0);
  const winRate = rep.winRate;
  const totalOps = rep.totalOperations || 0;
  const dur    = _r3_dur(rep.durationMs);
  const since  = rnd.openedAt ? new Date(rnd.openedAt).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
  const closed = rnd.closedAt ? _r3_date(rnd.closedAt) : '—';
  const borderColor = net >= 3 ? 'border-green-700' : net >= 0 ? 'border-gray-700' : net >= -3 ? 'border-orange-900' : 'border-red-900';
  const netColor = _r3_pnlColor(net);
  const cs = rnd.capitalSnapshot;

  // Breakdown de razones
  const reasons = rep.closeReasonBreakdown || {};
  const reasonsHTML = Object.entries(reasons).length > 0
    ? Object.entries(reasons).map(([r,c]) => {
        const icon = r==='take_profit'?'✅':r==='stop_loss'?'🛑':r==='max_hold'?'⏰':r==='round_close'?'🏁':r==='manual'?'✋':'🔒';
        return `<span class="text-xs text-gray-400">${icon} ${r.replace(/_/g,' ')}: <span class="text-white font-semibold">${c}</span></span>`;
      }).join('  ·  ')
    : '<span class="text-xs text-gray-600">—</span>';

  // Top wins/losses
  const top3Wins   = (rep.top5Wins   || []).slice(0,3);
  const top3Losses = (rep.top5Losses || []).slice(0,3);

  const topOpsHTML = (top3Wins.length > 0 || top3Losses.length > 0) ? `
    <div class="mt-3 pt-3 border-t border-gray-800">
      <div class="grid grid-cols-2 gap-3">
        ${top3Wins.length > 0 ? `
        <div>
          <p class="text-xs font-semibold text-green-500 mb-1.5">🏆 Mejores</p>
          ${top3Wins.map(p => `
            <div class="flex justify-between items-center py-0.5">
              <span class="text-xs text-gray-300 font-mono">${(p.symbol||'?').toUpperCase()}</span>
              <span class="text-xs text-green-400 font-semibold">${_r3_pct(p.pnlPct)}</span>
            </div>`).join('')}
        </div>` : ''}
        ${top3Losses.length > 0 ? `
        <div>
          <p class="text-xs font-semibold text-red-500 mb-1.5">📉 Peores</p>
          ${top3Losses.map(p => `
            <div class="flex justify-between items-center py-0.5">
              <span class="text-xs text-gray-300 font-mono">${(p.symbol||'?').toUpperCase()}</span>
              <span class="text-xs text-red-400 font-semibold">${_r3_pct(p.pnlPct)}</span>
            </div>`).join('')}
        </div>` : ''}
      </div>
    </div>` : '';

  // Capital snapshot
  const capitalHTML = cs ? `
    <div class="mt-3 pt-3 border-t border-gray-800">
      <div class="flex justify-between items-center text-xs">
        <span class="text-gray-500">Capital antes</span>
        <span class="mono text-gray-300">${_r3_usdAbs(cs.before)}</span>
      </div>
      <div class="flex justify-between items-center text-xs mt-1">
        <span class="text-gray-500">Capital después</span>
        <span class="mono font-semibold ${netColor}">${_r3_usdAbs(cs.after)} <span class="text-xs">(${_r3_pct(net)})</span></span>
      </div>
    </div>` : '';

  // Fees
  const fees = rep.feeBreakdown || {};
  const totalFees = fees.total || 0;
  const feesHTML = totalFees > 0 ? `
    <div class="flex justify-between items-center">
      <span class="text-xs text-gray-500">Total fees</span>
      <span class="text-xs text-orange-400 mono">-${_r3_usdAbs(totalFees)}</span>
    </div>` : '';

  const id = rnd.id || `round_${rnd.roundNumber}`;
  const expanded = rnd._expanded || false;

  return `
    <div class="bg-gray-900 border ${borderColor} rounded-xl overflow-hidden mb-3" id="round-card-${id}">
      
      <!-- Header (siempre visible) -->
      <div class="p-4">
        <div class="flex items-start justify-between">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-bold text-white">Ronda #${rnd.roundNumber}</span>
              <span class="text-xs text-gray-500">${since} · ${dur}</span>
              ${(rnd.config?.mode||'simulated')==='real'?'<span class="text-xs bg-red-900 text-red-300 px-1.5 py-0.5 rounded">💵 Real</span>':(rnd.config?.mode==='testnet'?'<span class="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded">🧪 Test</span>':'<span class="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">⚗️ Sim</span>')}
            </div>

            <!-- Métricas principales en fila -->
            <div class="grid grid-cols-4 gap-3 mt-2">
              <div class="${net>=0?'bg-green-950 border-green-900':'bg-red-950 border-red-900'} border rounded-lg p-2 text-center">
                <p class="text-xs text-gray-500">Retorno neto</p>
                <p class="text-base font-bold ${netColor} mono">${_r3_pct(net)}</p>
                <p class="text-xs ${netColor} mono opacity-80">${_r3_usd(netUSD)}</p>
              </div>
              <div class="bg-gray-800 rounded-lg p-2 text-center">
                <p class="text-xs text-gray-500">Operaciones</p>
                <p class="text-base font-bold text-white">${totalOps}</p>
                <p class="text-xs text-gray-500">${rep.winsCount||0}W / ${rep.lossesCount||0}L</p>
              </div>
              <div class="bg-gray-800 rounded-lg p-2 text-center">
                <p class="text-xs text-gray-500">Win Rate</p>
                <p class="text-base font-bold ${winRate!=null?_r3_wrColor(winRate):'text-gray-500'}">${winRate!=null?winRate.toFixed(1)+'%':'—'}</p>
                <p class="text-xs text-gray-600">precisión</p>
              </div>
              <div class="bg-gray-800 rounded-lg p-2 text-center">
                <p class="text-xs text-gray-500">Duración</p>
                <p class="text-sm font-bold text-white">${dur}</p>
                <p class="text-xs text-gray-500">${rnd.config?.mode||'sim'}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Botones de acción -->
        <div class="flex gap-2 mt-3">
          <button onclick="_r3_toggleExpand('${id}')" 
                  class="flex-1 text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-gray-300 transition-colors" 
                  id="btn-expand-${id}">
            📊 Ver desglose completo
          </button>
          <button onclick="downloadRoundReport('${id}', ${rnd.roundNumber})"
                  id="btn-report-${id}"
                  class="text-xs bg-indigo-900 hover:bg-indigo-800 px-3 py-1.5 rounded-lg text-indigo-300 font-semibold transition-colors">
            📄 Informe Word
          </button>
          <button onclick="showRoundReport(${JSON.stringify(rnd).replace(/"/g,'&quot;')})" 
                  class="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg text-gray-400 transition-colors">
            🪟 Modal
          </button>
        </div>
      </div>

      <!-- Desglose expandible -->
      <div id="round-expand-${id}" class="hidden border-t border-gray-800 bg-gray-950 p-4">
        
        <!-- Config de la ronda -->
        ${rnd.config ? `
        <div class="mb-4">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">⚙️ Configuración usada</p>
          <div class="grid grid-cols-4 gap-2 text-xs">
            <div class="bg-gray-900 rounded-lg p-2 text-center">
              <p class="text-gray-500">TP</p>
              <p class="font-semibold text-green-400">${rnd.config.takeProfitPct||'—'}%</p>
            </div>
            <div class="bg-gray-900 rounded-lg p-2 text-center">
              <p class="text-gray-500">SL</p>
              <p class="font-semibold text-red-400">${rnd.config.stopLossPct||'—'}%</p>
            </div>
            <div class="bg-gray-900 rounded-lg p-2 text-center">
              <p class="text-gray-500">Max hold</p>
              <p class="font-semibold">${rnd.config.maxHoldCycles||'—'} ciclos</p>
            </div>
            <div class="bg-gray-900 rounded-lg p-2 text-center">
              <p class="text-gray-500">Max pos.</p>
              <p class="font-semibold">${rnd.config.maxPositions||'—'}</p>
            </div>
          </div>
          <div class="flex gap-4 mt-2 text-xs text-gray-500">
            <span>Capital: <span class="text-white">${_r3_usdAbs(rnd.config.capitalTotal)}</span></span>
            <span>Min BoostPower: <span class="text-white">${rnd.config.minBoostPower||'—'}</span></span>
            <span>Exchange: <span class="text-white">${(rnd.config.exchange||'binance').charAt(0).toUpperCase()+(rnd.config.exchange||'binance').slice(1)}</span></span>
          </div>
        </div>` : ''}

        <!-- P&L detallado -->
        <div class="mb-4">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">💰 Desglose P&L</p>
          <div class="space-y-1">
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-500">Capital total invertido</span>
              <span class="text-xs mono text-gray-300">${_r3_usdAbs(rep.totalInvested||0)}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-500">P&L bruto</span>
              <span class="text-xs mono font-semibold ${_r3_pnlColor(rep.totalPnL)}">${_r3_usd(rep.totalPnL||0)}</span>
            </div>
            ${feesHTML}
            <div class="flex justify-between items-center pt-1 border-t border-gray-800 mt-1">
              <span class="text-xs font-semibold text-gray-300">Retorno neto</span>
              <span class="text-sm mono font-bold ${netColor}">${_r3_usd(netUSD)} · ${_r3_pct(net)}</span>
            </div>
          </div>
        </div>

        <!-- Capital snapshot -->
        ${capitalHTML}

        <!-- Razones de cierre -->
        ${Object.keys(reasons).length > 0 ? `
        <div class="mb-4 mt-3">
          <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">🔒 Razones de cierre</p>
          <div class="flex flex-wrap gap-2">${reasonsHTML}</div>
        </div>` : ''}

        <!-- Top operaciones -->
        ${topOpsHTML}

        <!-- Fechas -->
        <div class="mt-3 pt-3 border-t border-gray-800 flex justify-between text-xs text-gray-600">
          <span>Apertura: ${_r3_date(rnd.openedAt)}</span>
          <span>Cierre: ${closed}</span>
        </div>
      </div>
    </div>`;
};

// Toggle expand
window._r3_toggleExpand = function(id) {
  const panel = document.getElementById(`round-expand-${id}`);
  const btn   = document.getElementById(`btn-expand-${id}`);
  if (!panel) return;
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !isHidden);
  if (btn) btn.innerHTML = isHidden ? '🔼 Ocultar desglose' : '📊 Ver desglose completo';
};

// ── Override de loadInvestRounds — usa nuevo renderer ────────────────────────
const _r3_originalLoadRounds = window.loadInvestRounds;

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

    // ── Ronda ACTIVA ──────────────────────────────────────────────────────────
    if (current && current.status === 'active') {
      const roundStart = current.openedAt ? new Date(current.openedAt).getTime() : 0;
      const roundPos   = allPos.filter(p => {
        const pOpen = p.openedAt ? new Date(p.openedAt).getTime() : 0;
        return roundStart > 0 && pOpen >= roundStart;
      });

      const closedPos   = roundPos.filter(p => p.status === 'closed');
      const openPos     = roundPos.filter(p => p.status === 'open');
      const realizedPnL = closedPos.reduce((s,p) => s+(p.realizedPnL||0), 0);
      const unrealPnL   = openPos.reduce((s,p) => s+(p.unrealizedPnL||0), 0);
      const totalFees   = closedPos.reduce((s,p) => s+(p.totalFeesUSD||0), 0);
      const netRealized = realizedPnL - totalFees;
      const totalInvested = roundPos.reduce((s,p) => s+(p.capitalUSD||0), 0);
      const wins     = closedPos.filter(p => (p.realizedPnL||0) > 0);
      const winRate  = closedPos.length > 0 ? (wins.length/closedPos.length*100).toFixed(0) : null;
      const netColor = netRealized >= 0 ? 'text-green-400' : 'text-red-400';

      activeDiv.innerHTML = `
        <div class="bg-gray-900 border border-indigo-800 rounded-xl p-4 mb-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="font-bold text-indigo-300">🎯 Ronda #${current.roundNumber} — Activa</p>
              <p class="text-xs text-gray-500 mt-0.5">
                ${current.config?.mode||'simulated'} · TP ${current.config?.takeProfitPct||'—'}% / SL ${current.config?.stopLossPct||'—'}%
                · Iniciada ${current.openedAt ? new Date(current.openedAt).toLocaleDateString('es-ES') : '—'}
              </p>
            </div>
            <button onclick="openCloseRoundModal()" class="text-xs bg-red-900 hover:bg-red-800 px-3 py-1.5 rounded-lg text-red-300 font-semibold">
              🏁 Cerrar Ronda
            </button>
          </div>

          <!-- P&L parcial -->
          <div class="grid grid-cols-4 gap-2">
            <div class="bg-gray-800 rounded-lg p-2 text-center">
              <p class="text-xs text-gray-500">Operaciones</p>
              <p class="font-bold">${roundPos.length}</p>
              <p class="text-xs text-gray-600">${openPos.length} abiertas</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-2 text-center">
              <p class="text-xs text-gray-500">P&L realizado</p>
              <p class="font-bold ${_r3_pnlColor(netRealized)} mono text-sm">${_r3_usd(netRealized)}</p>
              <p class="text-xs text-gray-600">${closedPos.length} cerradas</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-2 text-center">
              <p class="text-xs text-gray-500">P&L no realizado</p>
              <p class="font-bold ${_r3_pnlColor(unrealPnL)} mono text-sm">${_r3_usd(unrealPnL)}</p>
              <p class="text-xs text-gray-600">${openPos.length} abiertas</p>
            </div>
            <div class="bg-gray-800 rounded-lg p-2 text-center">
              <p class="text-xs text-gray-500">Win Rate</p>
              <p class="font-bold ${winRate!=null?_r3_wrColor(parseFloat(winRate)):'text-gray-500'}">${winRate!=null?winRate+'%':'—'}</p>
              <p class="text-xs text-gray-600">${wins.length}W / ${closedPos.length-wins.length}L</p>
            </div>
          </div>
        </div>`;
    } else {
      activeDiv.innerHTML = `
        <div class="bg-gray-900 border border-gray-700 border-dashed rounded-xl p-4 mb-4 text-center">
          <p class="text-gray-500 mb-3">Sin ronda activa</p>
          <button onclick="openNewRoundWizard()" class="bg-indigo-700 hover:bg-indigo-600 px-5 py-2.5 rounded-lg text-sm font-bold">🚀 Abrir Nueva Ronda de Inversión</button>
        </div>`;
    }

    // ── Historial de rondas cerradas ──────────────────────────────────────────
    if (rounds.length === 0) {
      histDiv.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">Sin rondas cerradas aún.</p>';
      return;
    }

    histDiv.innerHTML = `
      <div class="flex items-center gap-2 mb-3">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Historial — ${rounds.length} ronda${rounds.length!==1?'s':''} cerrada${rounds.length!==1?'s':''}</p>
        <div class="flex-1 h-px bg-gray-800"></div>
      </div>
      <div class="space-y-0">
        ${rounds.map(r => _r3_renderRoundCard(r)).join('')}
      </div>`;

  } catch(e) {
    console.error('[patch-rounds-v3] loadInvestRounds error:', e);
    histDiv.innerHTML = `<p class="text-red-400 text-sm">❌ ${e.message}</p>`;
  }
};

// ── Override loadInvestOverview para mostrar capital actualizado ──────────────
const _r3_origLoadOverview = window.loadInvestOverview;

window.loadInvestOverview = async function() {
  try {
    const r = await fetch('/api/invest/positions');
    const d = await r.json();
    if (!d.success) return;
    const s = d.summary;

    // Calcular retorno total realizado
    const realizedPnL = s.totalRealizedPnL || 0;
    const unrealizedPnL = s.totalUnrealizedPnL || 0;
    const totalReturn = realizedPnL + unrealizedPnL;
    const returnPct = s.capitalTotal > 0 ? (realizedPnL / s.capitalTotal * 100) : 0;

    document.getElementById('inv-capital-grid').innerHTML = `
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
        <p class="text-xs text-gray-500">Capital Total</p>
        <p class="text-2xl font-bold text-white mono">${_r3_usdAbs(s.capitalTotal)}</p>
        <p class="text-xs text-gray-600 mt-1">
          ${(investConfig?.mode||'simulated')==='real'?'💵 Real':(investConfig?.mode==='testnet'?'🧪 Testnet':'⚗️ Simulado')}
          ${realizedPnL !== 0 ? `<span class="${_r3_pnlColor(realizedPnL)}">${_r3_pct(returnPct)}</span> vs inicio` : ''}
        </p>
      </div>
      <div class="bg-green-950 border border-green-900 rounded-xl p-4 text-center">
        <p class="text-xs text-gray-500">Disponible</p>
        <p class="text-2xl font-bold text-green-400 mono">${_r3_usdAbs(s.capitalAvailable)}</p>
        <p class="text-xs text-gray-600 mt-1">${s.capitalTotal>0?((s.capitalAvailable/s.capitalTotal)*100).toFixed(0):'0'}% libre</p>
      </div>
      <div class="bg-blue-950 border border-blue-900 rounded-xl p-4 text-center">
        <p class="text-xs text-gray-500">En posiciones</p>
        <p class="text-2xl font-bold text-blue-400 mono">${_r3_usdAbs(s.capitalInvested)}</p>
        <p class="text-xs text-gray-600 mt-1">${s.openPositions} abierta${s.openPositions!==1?'s':''}</p>
      </div>
      <div class="${unrealizedPnL>=0?'bg-green-950 border-green-900':'bg-red-950 border-red-900'} border rounded-xl p-4 text-center">
        <p class="text-xs text-gray-500">P&L No Realizado</p>
        <p class="text-2xl font-bold ${unrealizedPnL>=0?'text-green-400':'text-red-400'} mono">${_r3_usd(unrealizedPnL)}</p>
        <p class="text-xs text-gray-600 mt-1">Posiciones abiertas</p>
      </div>`;

    // Posiciones abiertas en resumen
    const openDiv = document.getElementById('inv-open-summary');
    if (openDiv) {
      if (d.open.length === 0) {
        openDiv.innerHTML = '<p class="text-gray-500 text-sm">Sin posiciones abiertas.</p>';
      } else {
        Object.keys(positionCycleTimers||{}).forEach(id => { clearInterval(positionCycleTimers[id]); delete positionCycleTimers[id]; });
        openDiv.innerHTML = d.open.map(p => renderPositionCard(p, true)).join('');
      }
    }
  } catch(e) { console.error('[patch-rounds-v3] loadInvestOverview error:', e); }
};

// ── Fix executeCloseRound: actualizar overview con nuevo capital ──────────────
const _r3_origExecuteClose = window.executeCloseRound;
window.executeCloseRound = async function() {
  const btn    = document.getElementById('btn-confirm-close-round');
  const status = document.getElementById('close-round-status');
  if (!btn || !status) { if (_r3_origExecuteClose) return _r3_origExecuteClose(); return; }

  btn.disabled = true; btn.innerHTML = '⏳ Cerrando posiciones...';
  status.classList.remove('hidden'); status.textContent = 'Obteniendo precios actuales y ejecutando cierres...';
  try {
    const r = await fetch('/api/invest/rounds/close', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    const d = await r.json();
    if (!d.success) { status.textContent = '❌ ' + d.error; btn.disabled=false; btn.innerHTML='🏁 Confirmar Cierre'; return; }

    document.getElementById('close-round-modal')?.remove();

    // Recargar datos (el capital ya está actualizado en Redis)
    await Promise.all([
      loadInvestPositions(),
      loadInvestOverview(),
      loadInvestRounds(),
    ]);
    if (typeof loadCurrentRoundBanner === 'function') await loadCurrentRoundBanner();

    // Mostrar informe en modal y ofrecer descarga
    if (d.report) {
      showRoundReport({ roundNumber: d.report.roundNumber, report: d.report, id: d.report.roundId, capitalSnapshot: d.capitalSnapshot });

      // Notificación de descarga disponible
      setTimeout(() => {
        const modal = document.getElementById('round-report-modal');
        if (modal && d.report.roundId) {
          const footer = modal.querySelector('.p-3.border-t');
          if (footer) {
            const dlBtn = document.createElement('button');
            dlBtn.className = 'flex-1 bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold';
            dlBtn.innerHTML = '📄 Descargar Informe Word';
            dlBtn.onclick = () => downloadRoundReport(d.report.roundId, d.report.roundNumber);
            footer.insertBefore(dlBtn, footer.firstChild);
          }
        }
      }, 200);
    }
  } catch(e) {
    status.textContent = '❌ ' + e.message;
    btn.disabled = false; btn.innerHTML = '🏁 Confirmar Cierre';
  }
};

console.log('[patch-rounds-v3] ✅ Resumen de rondas cerradas + informe Word + capital actualizado');
