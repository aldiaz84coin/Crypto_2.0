/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: Round Report Modal — Fix completo
 *  Archivo: public/patch-round-report-modal.js
 *  Incluir al FINAL del <body> en public/index.html, DESPUÉS de
 *  patch-invest-unified.js
 *
 *  BUGS CORREGIDOS:
 *  1. rep.totalFeesUSD no existe → usar rep.feeBreakdown?.total
 *  2. Falta sección de Capital (antes/después con capitalSnapshot)
 *  3. Falta sección de Conclusiones automáticas
 *  4. Falta desglose de Gastos (fees entrada, salida, API)
 *  5. _renderRoundCard mostraba $0.000 en fees
 *  6. Serialización robusta via global store (evita problemas con ' en JSON)
 * ══════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  // ── Global store de rondas (serialización segura) ──────────────────────────
  window._rrmStore = window._rrmStore || {};

  // ── Helpers ────────────────────────────────────────────────────────────────
  function fmt2(n)        { return isNaN(n) ? '0.00' : Math.abs(parseFloat(n)).toFixed(2); }
  function fmtUsd(n)      { const v = parseFloat(n)||0; return (v>=0?'+$':'-$') + Math.abs(v).toFixed(2); }
  function fmtUsdAbs(n)   { return '$' + fmt2(n); }
  function pnlClass(n)    { return parseFloat(n)>=0 ? 'text-green-400' : 'text-red-400'; }
  function pnlBorderCls(n){ return parseFloat(n)>=0 ? 'border-green-800' : 'border-red-800'; }
  function totalFees(rep) { return rep.feeBreakdown?.total ?? rep.totalFeesUSD ?? 0; }

  // ── Auto-conclusiones ─────────────────────────────────────────────────────
  function buildConclusions(rep, capSnap) {
    const net       = rep.netReturnPct    || 0;
    const wr        = rep.winRate         || 0;
    const ops       = rep.totalOperations || 0;
    const fees      = totalFees(rep);
    const feeImpact = rep.totalInvested > 0 ? (fees / rep.totalInvested * 100) : 0;
    const out = [];

    // Rendimiento
    if      (net >= 5)  out.push({ cls:'border-green-800 bg-green-950/30',   icon:'🚀', title:'Rendimiento excepcional',      text:'La ronda generó ' + net.toFixed(2) + '% de retorno neto, muy por encima de lo esperado. La estrategia funcionó excelentemente.' });
    else if (net >= 2)  out.push({ cls:'border-green-800 bg-green-950/20',   icon:'✅', title:'Rendimiento positivo sólido',   text:'La ronda cerró con ' + net.toFixed(2) + '% de retorno neto. Resultado positivo que valida la configuración.' });
    else if (net >= 0)  out.push({ cls:'border-gray-700 bg-gray-900',        icon:'➡️', title:'Rendimiento marginal',          text:'Ronda en positivo pero con margen reducido (' + net.toFixed(2) + '%). Considerar ajustes para mejorar rentabilidad.' });
    else if (net >= -3) out.push({ cls:'border-yellow-800 bg-yellow-950/20', icon:'⚠️', title:'Pérdida limitada',             text:'Pérdida moderada del ' + net.toFixed(2) + '%. Revisar umbrales de Stop Loss y selección de activos.' });
    else                out.push({ cls:'border-red-800 bg-red-950/20',       icon:'🛑', title:'Pérdida significativa',         text:'La ronda incurrió en una pérdida del ' + net.toFixed(2) + '%. Revisar la configuración antes de la próxima ronda.' });

    // Win Rate
    if (ops >= 3) {
      if      (wr >= 70) out.push({ cls:'border-blue-800 bg-blue-950/20',  icon:'🎯', title:'Win Rate alto',     text: wr.toFixed(0) + '% de operaciones ganadoras (' + (rep.winsCount||0) + 'W / ' + (rep.lossesCount||0) + 'L). Selección de activos muy acertada.' });
      else if (wr >= 50) out.push({ cls:'border-gray-700 bg-gray-900',     icon:'📊', title:'Win Rate positivo', text:'Más del 50% de operaciones ganadoras (' + wr.toFixed(0) + '%). El sistema selecciona activos con sesgo positivo.' });
      else               out.push({ cls:'border-red-900 bg-red-950/20',    icon:'📉', title:'Win Rate bajo',     text:'Solo el ' + wr.toFixed(0) + '% de operaciones fueron ganadoras. Revisar criterios de selección (BoostPower mínimo, señales).' });
    }

    // Fees
    if (feeImpact > 1)
      out.push({ cls:'border-orange-900 bg-orange-950/20', icon:'💸', title:'Impacto de fees elevado',
        text:'Las comisiones representaron el ' + feeImpact.toFixed(2) + '% del capital invertido. Considerar aumentar capital por posición.' });

    // Capital
    if (capSnap && capSnap.before > 0) {
      var diff    = (capSnap.after||0) - (capSnap.before||0);
      var diffPct = diff / capSnap.before * 100;
      out.push({ cls: diff>=0 ? 'border-green-800 bg-green-950/20' : 'border-red-900 bg-red-950/20',
        icon: diff>=0 ? '💼' : '📉', title:'Impacto en capital total',
        text:'El capital del sistema pasó de ' + fmtUsdAbs(capSnap.before) + ' a ' + fmtUsdAbs(capSnap.after) + ' (' + (diffPct>=0?'+':'') + diffPct.toFixed(2) + '%).' });
    }

    // Razón dominante de cierre
    var reasons  = rep.closeReasonBreakdown || {};
    var dominant = Object.entries(reasons).sort(function(a,b){ return b[1]-a[1]; })[0];
    if (dominant) {
      var reason = dominant[0], count = dominant[1];
      if (reason === 'stop_loss' && count/(ops||1) > 0.4)
        out.push({ cls:'border-red-900 bg-red-950/20', icon:'🛑', title:'Alto % de Stop Loss',
          text:count + ' de ' + ops + ' operaciones cerraron por Stop Loss (' + (count/(ops||1)*100).toFixed(0) + '%). Considerar ampliar el SL o revisar timing de entrada.' });
      if (reason === 'take_profit')
        out.push({ cls:'border-green-800 bg-green-950/20', icon:'✅', title:'Take Profit como razón principal',
          text:'La mayoría de operaciones (' + count + '/' + ops + ') cerraron por Take Profit. Los objetivos de ganancia se están alcanzando.' });
      if (reason === 'max_hold')
        out.push({ cls:'border-yellow-800 bg-yellow-950/20', icon:'⏰', title:'Max Hold Cycles frecuente',
          text:count + ' operaciones cerraron por tiempo máximo de hold. Considerar ajustar los ciclos máximos.' });
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // _renderRoundCard — versión corregida con fees y store seguro
  // ══════════════════════════════════════════════════════════════════════════
  window._renderRoundCard = function(rnd) {
    var rep    = rnd.report || {};
    var net    = rep.netReturnPct || 0;
    var netCls = pnlClass(net);
    var border = net >= 1.5 ? 'border-green-800' : net >= 0 ? 'border-gray-700' : 'border-red-900';
    var since  = (rnd.openedAt || rep.openedAt)
      ? new Date(rnd.openedAt || rep.openedAt).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
    var dur    = rep.durationHrs
      ? (rep.durationHrs >= 24 ? Math.round(rep.durationHrs/24)+'d' : rep.durationHrs.toFixed(1)+'h') : '—';
    var fees   = totalFees(rep);
    var key    = rnd.id || ('rnd_'+rnd.roundNumber+'_'+Date.now());

    window._rrmStore[key] = rnd;

    return '<div class="bg-gray-900 border ' + border + ' rounded-xl p-4">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<div>' +
          '<span class="font-semibold">Ronda #' + rnd.roundNumber + '</span>' +
          '<span class="text-xs text-gray-500 ml-2">' + since + ' · ' + dur + '</span>' +
        '</div>' +
        '<div class="flex items-center gap-3">' +
          '<span class="text-lg font-bold mono ' + netCls + '">' + (net>=0?'+':'') + net.toFixed(2) + '%</span>' +
          '<button onclick="_rrmOpen(\'' + key + '\')" class="text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg">📊 Informe</button>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-cols-4 gap-2 text-xs">' +
        '<div class="text-center"><p class="text-gray-500">Operaciones</p><p class="font-semibold">' + (rep.totalOperations||0) + '</p></div>' +
        '<div class="text-center"><p class="text-gray-500">Win Rate</p><p class="font-semibold ' + ((rep.winRate||0)>=50?'text-blue-400':'text-gray-300') + '">' + (rep.winRate!=null?rep.winRate+'%':'—') + '</p></div>' +
        '<div class="text-center"><p class="text-gray-500">P&L Neto</p><p class="font-semibold mono ' + netCls + '">' + (net>=0?'+':'') + '$' + fmt2(rep.netReturnUSD) + '</p></div>' +
        '<div class="text-center"><p class="text-gray-500">Fees</p><p class="font-semibold text-orange-400">$' + fmt2(fees) + '</p></div>' +
      '</div>' +
    '</div>';
  };

  // Alias para onclick desde HTML
  window._rrmOpen = function(key) {
    var rnd = window._rrmStore[key];
    if (rnd) window.showRoundReport(rnd);
    else console.warn('[_rrmOpen] Ronda no encontrada en store:', key);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // showRoundReport — versión completa corregida
  // ══════════════════════════════════════════════════════════════════════════
  window.showRoundReport = function(rnd) {
    document.getElementById('round-report-modal')?.remove();

    var rep     = rnd.report || {};
    var capSnap = rnd.capitalSnapshot || rep.capitalSnapshot || null;
    var net     = rep.netReturnPct || 0;
    var netCls  = pnlClass(net);
    var since   = (rep.openedAt || rnd.openedAt) ? new Date(rep.openedAt || rnd.openedAt).toLocaleString('es-ES') : '—';
    var until   = (rep.closedAt || rnd.closedAt) ? new Date(rep.closedAt || rnd.closedAt).toLocaleString('es-ES') : '—';
    var dur     = rep.durationHrs ? (rep.durationHrs >= 24 ? (rep.durationHrs/24).toFixed(1)+'d' : rep.durationHrs.toFixed(1)+'h') : '—';

    // Fees
    var feesBrk  = rep.feeBreakdown || {};
    var feesTotal= totalFees(rep);
    var entryFee = feesBrk.entry  ?? feesBrk.entryFees ?? 0;
    var exitFee  = feesBrk.exit   ?? feesBrk.exitFees  ?? 0;
    var apiCost  = feesBrk.api    ?? feesBrk.apiCosts  ?? 0;

    // ── Capital section ───────────────────────────────────────────────────────
    var capHtml;
    if (capSnap) {
      var diff    = (capSnap.after||0) - (capSnap.before||0);
      capHtml =
        '<div class="grid grid-cols-3 gap-2 text-xs">' +
          '<div class="bg-gray-900 border border-gray-700 rounded-lg p-3 text-center">' +
            '<p class="text-gray-500 mb-1">Capital Entrada</p>' +
            '<p class="font-bold mono text-gray-100">' + fmtUsdAbs(capSnap.before) + '</p>' +
          '</div>' +
          '<div class="bg-gray-900 border border-gray-700 rounded-lg p-3 text-center">' +
            '<p class="text-gray-500 mb-1">Capital Salida</p>' +
            '<p class="font-bold mono ' + pnlClass(diff) + '">' + fmtUsdAbs(capSnap.after) + '</p>' +
          '</div>' +
          '<div class="bg-gray-900 border ' + pnlBorderCls(diff) + ' rounded-lg p-3 text-center">' +
            '<p class="text-gray-500 mb-1">Variación</p>' +
            '<p class="font-bold mono ' + pnlClass(diff) + '">' + fmtUsd(diff) + '</p>' +
          '</div>' +
        '</div>';
    } else {
      capHtml = '<p class="text-xs text-gray-600 italic">Sin datos de capital disponibles para esta ronda.</p>';
    }

    // ── Resumen financiero ────────────────────────────────────────────────────
    var rows = [
      { label:'Capital Invertido Total',  val: fmtUsdAbs(rep.totalInvested),                       cls:'text-gray-100',                    hi:false, sep:false },
      { label:'P&amp;L Bruto Operaciones',val: fmtUsd(rep.totalPnL ?? rep.totalPnlUSD ?? 0),       cls: pnlClass(rep.totalPnL??0),         hi:false, sep:false },
      { label:'&nbsp;&nbsp;└ Fees Entrada', val:'-'+fmtUsdAbs(entryFee),                           cls:'text-orange-400',                  hi:false, sep:false },
      { label:'&nbsp;&nbsp;└ Fees Salida',  val:'-'+fmtUsdAbs(exitFee),                            cls:'text-orange-400',                  hi:false, sep:false },
      { label:'&nbsp;&nbsp;└ Costes API',   val:'-'+fmtUsdAbs(apiCost),                            cls:'text-orange-400',                  hi:false, sep:false },
      { label:'Total Fees y Costes',      val: '-'+fmtUsdAbs(feesTotal),                           cls:'text-orange-400 font-semibold',    hi:false, sep:true  },
      { label:'🏆 RETORNO NETO FINAL',    val: (net>=0?'+':'')+net.toFixed(2)+'%  ('+fmtUsd(rep.netReturnUSD)+')',
                                                                                                    cls: netCls+' font-bold',               hi:true,  sep:false },
    ];

    var finHtml = rows.map(function(r) {
      return '<div class="flex justify-between items-center px-3 py-2 text-xs ' +
        (r.hi ? (net>=0 ? 'bg-green-950/40 border border-green-800' : 'bg-red-950/40 border border-red-800') + ' rounded-lg mt-1' :
                r.sep ? 'border-b-2 border-gray-700' : 'border-b border-gray-800/50') + '">' +
        '<span class="text-gray-400">' + r.label + '</span>' +
        '<span class="mono ' + r.cls + '">' + r.val + '</span>' +
        '</div>';
    }).join('');

    // ── Top operaciones ───────────────────────────────────────────────────────
    function mkPos(p, isWin) {
      var cls = isWin ? 'bg-green-950/20 border-green-900/30' : 'bg-red-950/20 border-red-900/30';
      var nc  = isWin ? 'text-green-400' : 'text-red-400';
      var nc2 = isWin ? 'text-green-300' : 'text-red-300';
      return '<div class="flex justify-between items-center ' + cls + ' border rounded-lg px-3 py-2 text-xs">' +
        '<span class="font-semibold w-16">' + (p.symbol||'').toUpperCase() + '</span>' +
        '<span class="text-gray-500 flex-1 truncate px-2">' + (p.closeReason||'—') + '</span>' +
        '<span class="' + nc + ' font-bold mono">' + (isWin?'+':'') + (p.pnlPct||0).toFixed(2) + '%</span>' +
        '<span class="' + nc2 + ' mono ml-2">' + (isWin?'+':'') + '$' + fmt2(p.pnlUSD) + '</span>' +
        '</div>';
    }

    var winsHtml   = (rep.top5Wins   ||[]).slice(0,5).map(function(p){ return mkPos(p,true);  }).join('') || '<p class="text-gray-600 text-xs py-1 text-center">—</p>';
    var lossesHtml = (rep.top5Losses ||[]).slice(0,5).map(function(p){ return mkPos(p,false); }).join('') || '<p class="text-gray-600 text-xs py-1 text-center">—</p>';

    // ── Razones de cierre ──────────────────────────────────────────────────────
    var rLabels = { take_profit:'✅ Take Profit', stop_loss:'🛑 Stop Loss', max_hold:'⏰ Max Hold', round_close:'🏁 Cierre Ronda', manual:'✋ Manual' };
    var crHTML  = Object.entries(rep.closeReasonBreakdown||{}).map(function(e) {
      return '<div class="flex justify-between text-xs bg-gray-800 rounded-lg px-3 py-2"><span class="text-gray-400">' +
        (rLabels[e[0]]||e[0]) + '</span><span class="font-semibold">' + e[1] + '</span></div>';
    }).join('');

    // ── Conclusiones ───────────────────────────────────────────────────────────
    var concls    = buildConclusions(rep, capSnap);
    var conclHtml = concls.map(function(c) {
      return '<div class="border ' + c.cls + ' rounded-lg px-3 py-2.5 text-xs">' +
        '<p class="font-semibold text-gray-100 mb-1">' + c.icon + ' ' + c.title + '</p>' +
        '<p class="text-gray-400 leading-relaxed">' + c.text + '</p>' +
        '</div>';
    }).join('') || '<p class="text-gray-600 text-xs">Sin datos suficientes para conclusiones.</p>';

    // ── Configuración ──────────────────────────────────────────────────────────
    var tc = rep.tradingConfig || rnd.config || {};
    var cfgItems = [
      tc.takeProfitPct  != null ? '<div class="bg-gray-800 rounded p-2"><p class="text-gray-500 text-xs">Take Profit</p><p class="font-semibold text-green-400">' + tc.takeProfitPct + '%</p></div>' : '',
      tc.stopLossPct    != null ? '<div class="bg-gray-800 rounded p-2"><p class="text-gray-500 text-xs">Stop Loss</p><p class="font-semibold text-red-400">' + tc.stopLossPct + '%</p></div>' : '',
      tc.maxHoldCycles  != null ? '<div class="bg-gray-800 rounded p-2"><p class="text-gray-500 text-xs">Max Hold</p><p class="font-semibold">' + tc.maxHoldCycles + ' ciclos</p></div>' : '',
      tc.maxPositions   != null ? '<div class="bg-gray-800 rounded p-2"><p class="text-gray-500 text-xs">Max Posiciones</p><p class="font-semibold">' + tc.maxPositions + '</p></div>' : '',
      tc.minBoostPower  != null ? '<div class="bg-gray-800 rounded p-2"><p class="text-gray-500 text-xs">Min BoostPower</p><p class="font-semibold">' + parseFloat(tc.minBoostPower).toFixed(3) + '</p></div>' : '',
      tc.capitalPerCycle!= null ? '<div class="bg-gray-800 rounded p-2"><p class="text-gray-500 text-xs">Capital/Ciclo</p><p class="font-semibold">' + (parseFloat(tc.capitalPerCycle)*100).toFixed(0) + '%</p></div>' : '',
    ].filter(Boolean);
    var cfgHtml = cfgItems.length > 0
      ? '<div class="grid grid-cols-3 gap-1.5 text-xs">' + cfgItems.join('') + '</div>'
      : '<p class="text-gray-600 text-xs italic">Sin datos de configuración.</p>';

    // ── Contexto de mercado ────────────────────────────────────────────────────
    var mc = rep.marketContext || {};
    var mktHtml = (mc.avgMarketPnl != null || mc.bestSymbol || mc.worstSymbol)
      ? '<div class="flex gap-4 flex-wrap text-xs">' +
          (mc.avgMarketPnl != null ? '<span class="text-gray-500">Mercado promedio: <span class="' + pnlClass(mc.avgMarketPnl) + ' font-semibold">' + (mc.avgMarketPnl>=0?'+':'') + parseFloat(mc.avgMarketPnl).toFixed(2) + '%</span></span>' : '') +
          (mc.bestSymbol  ? '<span class="text-gray-500">Mejor: <span class="text-green-400 font-bold">' + mc.bestSymbol + '</span></span>' : '') +
          (mc.worstSymbol ? '<span class="text-gray-500">Peor: <span class="text-red-400 font-bold">' + mc.worstSymbol + '</span></span>' : '') +
         '</div>'
      : '<p class="text-gray-600 text-xs italic">Sin datos de contexto de mercado.</p>';

    // ── Botón descarga .docx ───────────────────────────────────────────────────
    var docxId  = rnd.id || rnd.roundNumber;
    var docxBtn = docxId ? '<button onclick="window.open(\'/api/invest/rounds/' + docxId + '/report.docx\',\'_blank\')" class="bg-blue-900 hover:bg-blue-800 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap">📥 .docx</button>' : '';

    // ── Modal HTML ─────────────────────────────────────────────────────────────
    var hasWins    = (rep.top5Wins   ||[]).length > 0;
    var hasLosses  = (rep.top5Losses ||[]).length > 0;
    var hasCR      = Object.keys(rep.closeReasonBreakdown||{}).length > 0;

    var modal = document.createElement('div');
    modal.id        = 'round-report-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
    modal.style.background = 'rgba(0,0,0,0.85)';

    modal.innerHTML = [
      '<div class="cycle-modal-enter bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[93vh] flex flex-col shadow-2xl">',

        // Header
        '<div class="flex items-center justify-between p-4 border-b border-gray-800 shrink-0">',
          '<div>',
            '<h2 class="text-base font-bold">📊 Informe — Ronda #' + rnd.roundNumber + '</h2>',
            '<p class="text-xs text-gray-500 mt-0.5">' + since + ' → ' + until + ' · ' + dur + '</p>',
          '</div>',
          '<button onclick="document.getElementById(\'round-report-modal\').remove()" class="text-gray-500 hover:text-white text-xl p-1 leading-none">✕</button>',
        '</div>',

        // Body
        '<div class="overflow-y-auto p-4 flex-1 space-y-5">',

          // KPIs
          '<div class="grid grid-cols-4 gap-2">',
            '<div class="bg-gray-900 border ' + pnlBorderCls(net) + ' rounded-xl p-3 text-center">',
              '<p class="text-xs text-gray-500">Retorno Neto</p>',
              '<p class="text-2xl font-bold mono ' + netCls + '">' + (net>=0?'+':'') + net.toFixed(2) + '%</p>',
              '<p class="text-xs mono ' + netCls + ' mt-0.5">' + fmtUsd(rep.netReturnUSD) + '</p>',
            '</div>',
            '<div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">',
              '<p class="text-xs text-gray-500">Operaciones</p>',
              '<p class="text-2xl font-bold">' + (rep.totalOperations||0) + '</p>',
              '<p class="text-xs text-gray-600">' + (rep.winsCount||0) + 'W / ' + (rep.lossesCount||0) + 'L</p>',
            '</div>',
            '<div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">',
              '<p class="text-xs text-gray-500">Win Rate</p>',
              '<p class="text-2xl font-bold ' + ((rep.winRate||0)>=50?'text-blue-400':'text-red-400') + '">' + (rep.winRate!=null?rep.winRate+'%':'—') + '</p>',
            '</div>',
            '<div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">',
              '<p class="text-xs text-gray-500">Duración</p>',
              '<p class="text-2xl font-bold">' + dur + '</p>',
            '</div>',
          '</div>',

          // Capital
          '<div>',
            '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">💼 Capital del Sistema</p>',
            capHtml,
          '</div>',

          // Resumen financiero
          '<div>',
            '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">💰 Resumen Financiero</p>',
            '<div class="space-y-0.5">' + finHtml + '</div>',
          '</div>',

          // Top operaciones (condicional)
          (hasWins || hasLosses) ? [
            '<div>',
              '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">🏆 Top Operaciones</p>',
              hasWins   ? '<p class="text-xs text-gray-600 font-semibold mb-1.5">▲ Mayores Ganancias</p><div class="space-y-1 mb-3">' + winsHtml + '</div>' : '',
              hasLosses ? '<p class="text-xs text-gray-600 font-semibold mb-1.5">▼ Mayores Pérdidas</p><div class="space-y-1">' + lossesHtml + '</div>' : '',
            '</div>',
          ].join('') : '',

          // Razones de cierre (condicional)
          hasCR ? [
            '<div>',
              '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">🔒 Razones de Cierre</p>',
              '<div class="space-y-1.5">' + crHTML + '</div>',
            '</div>',
          ].join('') : '',

          // Contexto de mercado
          '<div>',
            '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">🌍 Contexto de Mercado</p>',
            mktHtml,
          '</div>',

          // Conclusiones
          '<div>',
            '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">🧠 Conclusiones y Análisis</p>',
            '<div class="space-y-2">' + conclHtml + '</div>',
          '</div>',

          // Configuración
          '<div>',
            '<p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">⚙️ Configuración Usada</p>',
            cfgHtml,
          '</div>',

        '</div>',// /body

        // Footer
        '<div class="p-3 border-t border-gray-800 shrink-0 flex gap-2">',
          '<button onclick="document.getElementById(\'round-report-modal\').remove()" class="flex-1 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold">Cerrar</button>',
          docxBtn,
          '<button onclick="document.getElementById(\'round-report-modal\').remove(); if(typeof openNewRoundWizard===\'function\') openNewRoundWizard();" class="flex-1 bg-indigo-700 hover:bg-indigo-600 px-4 py-2 rounded-lg text-sm font-bold">🚀 Nueva Ronda →</button>',
        '</div>',

      '</div>',
    ].join('');

    modal.addEventListener('click', function(e){ if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  };

  // ── Parchear _p2_renderRoundCard si ya existe (patch-performance-v2) ────────
  function _patchP2() {
    if (typeof window._p2_renderRoundCard === 'function') {
      var _orig = window._p2_renderRoundCard;
      window._p2_renderRoundCard = function(rnd, allPos) {
        var key = rnd.id || ('p2_'+rnd.roundNumber+'_'+Date.now());
        window._rrmStore[key] = rnd;
        var html = _orig(rnd, allPos);
        // Reemplazar onclick del botón informe
        return html.replace(
          /onclick="showRoundReport\([^)]*\)"/g,
          'onclick="_rrmOpen(\'' + key + '\')"'
        );
      };
      console.log('[patch-round-report-modal] _p2_renderRoundCard parchado');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _patchP2);
  else setTimeout(_patchP2, 200);

  console.log('[patch-round-report-modal] ✅ Modal rondas cerradas — capital, fees, conclusiones, serialización segura');

})();
