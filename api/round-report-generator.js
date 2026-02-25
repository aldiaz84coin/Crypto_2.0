// round-report-generator.js — Generador de Informes Word para Rondas de Inversión
// Genera un informe completo al cerrar una ronda: config del sistema, operaciones, P&L, conclusiones
'use strict';

const {
  Document, Paragraph, TextRun, Table, TableCell, TableRow,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, PageBreak, convertInchesToTwip
} = require('docx');

// ── Colores y helpers ─────────────────────────────────────────────────────────
const COLOR = {
  GREEN:     '16A34A', LIGHTGREEN: 'DCFCE7',
  RED:       'DC2626', LIGHTRED:   'FEE2E2',
  YELLOW:    'CA8A04', LIGHTYELLOW:'FEF9C3',
  BLUE:      '1D4ED8', LIGHTBLUE:  'DBEAFE',
  PURPLE:    '7C3AED', LIGHTPURPLE:'EDE9FE',
  GRAY:      '6B7280', DARKGRAY:   '374151',
  DARK:      '111827', WHITE:      'FFFFFF',
  HEADER:    '1E293B', SUBHEADER:  '334155',
  ORANGE:    'EA580C', TEAL:       '0D9488',
};

const fmt = {
  usd:   v => { const n = parseFloat(v||0); return (n>=0?'+':'')+`$${Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`; },
  usdAbs:v => `$${parseFloat(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`,
  pct:   v => { const n = parseFloat(v||0); return (n>=0?'+':'')+n.toFixed(2)+'%'; },
  pctAbs:v => parseFloat(v||0).toFixed(2)+'%',
  date:  v => v ? new Date(v).toLocaleString('es-ES',{dateStyle:'medium',timeStyle:'short'}) : '—',
  dur:   ms => { if(!ms) return '—'; const h=Math.floor(ms/3600000); const m=Math.floor((ms%3600000)/60000); return h>=24?`${Math.floor(h/24)}d ${h%24}h ${m}m`:`${h}h ${m}m`; },
  price: v => { if(!v) return '—'; return v>=1?`$${parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4})}`:(`$${parseFloat(v).toFixed(6)}`); },
};

// Helpers de construcción de documentos
function p(text, { bold=false, color, size=20, spacing, center=false, italic=false } = {}) {
  return new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: spacing || { after: 80 },
    children: [new TextRun({ text: String(text??''), bold, color: color||COLOR.DARK, size, italics: italic })]
  });
}
function h1(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing:{ before:600, after:200 } }); }
function h2(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing:{ before:400, after:160 } }); }
function h3(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing:{ before:300, after:120 } }); }
function blank(n=1) { return Array.from({length:n}, ()=>new Paragraph('')); }
function sep() { return p('─'.repeat(90), {color:COLOR.GRAY, size:16}); }
function br()  { return new Paragraph({ children:[new PageBreak()] }); }

function kv(label, value, { color, size=20 }={}) {
  return new Paragraph({
    spacing:{ after:80 },
    children:[
      new TextRun({ text:`${label}: `, bold:true, size }),
      new TextRun({ text:String(value??'—'), color:color||COLOR.DARK, size }),
    ]
  });
}

function tc(text, { bold=false, color, bg, align=AlignmentType.LEFT, colspan, width }={}) {
  return new TableCell({
    columnSpan: colspan,
    width: width ? { size:width, type:WidthType.PERCENTAGE } : undefined,
    shading: bg ? { fill:bg, type:ShadingType.CLEAR, color:'auto' } : undefined,
    margins: { top:80, bottom:80, left:120, right:120 },
    children:[new Paragraph({
      alignment: align,
      children:[new TextRun({ text:String(text??'—'), bold, color:color||COLOR.DARK, size:18 })]
    })]
  });
}

function headerRow(...cells) {
  return new TableRow({ children: cells.map(t => tc(t,{bold:true,bg:COLOR.HEADER,color:COLOR.WHITE})) });
}

function pnlColor(v) { return parseFloat(v||0)>=0 ? COLOR.GREEN : COLOR.RED; }
function pnlBg(v)    { return parseFloat(v||0)>=0 ? COLOR.LIGHTGREEN : COLOR.LIGHTRED; }

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 1 — PORTADA Y RESUMEN EJECUTIVO
// ══════════════════════════════════════════════════════════════════════════════
function buildCover(round, report, capitalSnapshot) {
  const net = report.netReturnPct || 0;
  const netUSD = report.netReturnUSD || 0;
  const mode = (round.config?.mode || 'simulated').toUpperCase();
  const modeLabel = mode === 'SPECULATIVE' ? '⚡ ESPECULATIVO' : mode === 'REAL' ? '💵 REAL' : mode === 'TESTNET' ? '🧪 TESTNET' : '⚗️ SIMULADO';

  return [
    ...blank(2),
    new Paragraph({
      text: `INFORME DE RONDA DE INVERSIÓN`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing:{ after:100 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:{ after:300 },
      children:[
        new TextRun({ text:`Ronda #${round.roundNumber}  ·  ${modeLabel}  ·  ${round.config?.exchange||'Binance'}`, size:24, color:COLOR.GRAY })
      ]
    }),
    sep(),
    ...blank(),

    // Métricas principales en tabla de resumen
    new Table({
      width:{ size:100, type:WidthType.PERCENTAGE },
      rows:[
        new TableRow({ children:[
          tc('📅 Apertura',    {bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(fmt.date(round.openedAt), {size:20}),
          tc('🏁 Cierre',     {bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(fmt.date(report.closedAt), {size:20}),
        ]}),
        new TableRow({ children:[
          tc('⏱️ Duración',   {bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(fmt.dur(report.durationMs), {size:20}),
          tc('🔢 Operaciones',{bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(String(report.totalOperations||0), {size:20}),
        ]}),
        new TableRow({ children:[
          tc('💰 Capital Inicial',{bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(capitalSnapshot ? fmt.usdAbs(capitalSnapshot.before) : fmt.usdAbs(report.tradingConfig?.capitalTotal), {size:20}),
          tc('💼 Capital Final', {bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(capitalSnapshot ? fmt.usdAbs(capitalSnapshot.after) : '—', {size:20, color: net>=0?COLOR.GREEN:COLOR.RED, bold:true}),
        ]}),
        new TableRow({ children:[
          tc('📈 Retorno Neto', {bold:true, bg: net>=0?COLOR.GREEN:COLOR.RED, color:COLOR.WHITE}),
          tc(`${fmt.pct(net)}  (${fmt.usd(netUSD)})`, {bold:true, size:22, color: net>=0?COLOR.GREEN:COLOR.RED}),
          tc('🎯 Win Rate',    {bold:true, bg:COLOR.SUBHEADER, color:COLOR.WHITE}),
          tc(report.winRate!=null?fmt.pctAbs(report.winRate)+'  ('+report.winsCount+'W / '+report.lossesCount+'L)':'—', {size:20}),
        ]}),
      ]
    }),
    ...blank(2),
    sep(),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 2 — CONFIGURACIÓN DEL SISTEMA
// ══════════════════════════════════════════════════════════════════════════════
function buildSystemConfig(round, report) {
  const tc_ = round.config || {};
  const ac  = round.algoConfig || {};

  const rows = [
    headerRow('⚙️ Parámetro', 'Valor', '📝 Descripción'),
    // Trading
    new TableRow({ children:[tc('──── Módulo de Inversión (Algoritmo B)',{bold:true,colspan:3,bg:COLOR.SUBHEADER,color:COLOR.WHITE})] }),
    new TableRow({ children:[tc('Modo de operación'),  tc(tc_.mode||'simulated',{bold:true,color:tc_.mode==='real'?COLOR.RED:COLOR.BLUE}), tc('simulated / testnet / real')] }),
    new TableRow({ children:[tc('Exchange'),           tc(tc_.exchange||'binance'),                 tc('Plataforma de ejecución')] }),
    new TableRow({ children:[tc('Capital total'),      tc(fmt.usdAbs(tc_.capitalTotal)),            tc('Capital total asignado al módulo')] }),
    new TableRow({ children:[tc('Capital por ciclo'),  tc(tc_.capitalPerCycle!=null?fmt.pctAbs(tc_.capitalPerCycle*100):'—'),tc('% del capital por ciclo de inversión')] }),
    new TableRow({ children:[tc('Take Profit'),        tc(tc_.takeProfitPct!=null?fmt.pctAbs(tc_.takeProfitPct):'—'),       tc('Objetivo de ganancia por posición')] }),
    new TableRow({ children:[tc('Stop Loss'),          tc(tc_.stopLossPct!=null?fmt.pctAbs(tc_.stopLossPct):'—'),           tc('Pérdida máxima tolerada')] }),
    new TableRow({ children:[tc('Max posiciones'),     tc(String(tc_.maxPositions||'—')),           tc('Límite de posiciones abiertas simultáneas')] }),
    new TableRow({ children:[tc('Max hold cycles'),    tc(String(tc_.maxHoldCycles||'—')),          tc('Ciclos máximos en posición antes de forzar cierre')] }),
    new TableRow({ children:[tc('Fee por operación'),  tc(tc_.feePct!=null?fmt.pctAbs(tc_.feePct)+'  /operación':'—'),      tc('Comisión aplicada en entrada y salida')] }),
    new TableRow({ children:[tc('Diversificación'),    tc(tc_.diversification?'✅ Activada':'❌ Desactivada'),              tc('Distribuir capital entre múltiples activos')] }),
    new TableRow({ children:[tc('Min BoostPower',{bold:true}), tc(tc_.minBoostPower!=null?tc_.minBoostPower.toFixed(3):'—'),tc('Umbral mínimo para seleccionar activo')] }),
    new TableRow({ children:[tc('Min señales',{bold:true}),    tc(String(tc_.minSignals||'—')),     tc('Señales mínimas requeridas')] }),
  ];

  // Algoritmo A (si existe)
  if (ac && Object.keys(ac).length > 0) {
    rows.push(new TableRow({ children:[tc('──── Algoritmo de Clasificación (Algoritmo A)',{bold:true,colspan:3,bg:COLOR.SUBHEADER,color:COLOR.WHITE})] }));
    if (ac.invertibleMinBoost!=null) rows.push(new TableRow({ children:[tc('INVERTIBLE min. BoostPower'), tc(String(ac.invertibleMinBoost)), tc('Umbral para clasificar como INVERTIBLE')] }));
    if (ac.invertibleTarget!=null)   rows.push(new TableRow({ children:[tc('Target predicción INVERTIBLE'),tc(fmt.pctAbs(ac.invertibleTarget)),tc('Movimiento esperado en activos INVERTIBLE')] }));
    if (ac.metaWeights)              rows.push(new TableRow({ children:[tc('Meta pesos'),                tc(`Potencial: ${Math.round((ac.metaWeights.potential||0)*100)}%  /  Resistencia: ${Math.round((ac.metaWeights.resistance||0)*100)}%`),tc('Peso de cada dimensión en el score final')] }));
  }

  return [
    h2('⚙️ Configuración del Sistema'),
    p('Parámetros activos durante esta ronda de inversión.', {color:COLOR.GRAY, size:18}),
    ...blank(),
    new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }),
    ...blank(2),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 3 — RESUMEN FINANCIERO DE LA RONDA
// ══════════════════════════════════════════════════════════════════════════════
function buildFinancialSummary(report, capitalSnapshot) {
  const { totalInvested, totalPnL, feeBreakdown, netReturnUSD, netReturnPct,
          totalOperations, winsCount, lossesCount, winRate, closeReasonBreakdown } = report;
  const fees = feeBreakdown || {};

  const rows = [
    headerRow('💰 Concepto', 'Importe', '% del Capital'),
    new TableRow({ children:[
      tc('Capital invertido total', {bold:true}),
      tc(fmt.usdAbs(totalInvested||0)),
      tc(capitalSnapshot?.before>0 ? fmt.pctAbs((totalInvested||0)/(capitalSnapshot.before)*100) : '—'),
    ]}),
    new TableRow({ children:[
      tc('P&L bruto operaciones'),
      tc(fmt.usd(totalPnL||0), {color:pnlColor(totalPnL),bold:true}),
      tc(totalInvested>0 ? fmt.pct((totalPnL||0)/totalInvested*100) : '—', {color:pnlColor(totalPnL)}),
    ]}),
    new TableRow({ children:[
      tc('  └─ Fees de entrada'),
      tc('-'+fmt.usdAbs(fees.entryFees||0), {color:COLOR.ORANGE}),
      tc(''),
    ]}),
    new TableRow({ children:[
      tc('  └─ Fees de salida'),
      tc('-'+fmt.usdAbs(fees.exitFees||0), {color:COLOR.ORANGE}),
      tc(''),
    ]}),
    new TableRow({ children:[
      tc('  └─ Costes API'),
      tc('-'+fmt.usdAbs(fees.apiCosts||0), {color:COLOR.ORANGE}),
      tc(''),
    ]}),
    new TableRow({ children:[
      tc('Total fees y costes', {bold:true}),
      tc('-'+fmt.usdAbs(fees.total||0), {bold:true, color:COLOR.ORANGE}),
      tc(totalInvested>0 ? '-'+fmt.pctAbs((fees.total||0)/totalInvested*100) : '—', {color:COLOR.ORANGE}),
    ]}),
    new TableRow({ children:[
      tc('🏆 RETORNO NETO FINAL', {bold:true, bg:pnlBg(netReturnPct)}),
      tc(fmt.usd(netReturnUSD||0), {bold:true, color:pnlColor(netReturnPct), bg:pnlBg(netReturnPct)}),
      tc(fmt.pct(netReturnPct||0), {bold:true, color:pnlColor(netReturnPct), bg:pnlBg(netReturnPct)}),
    ]}),
  ];

  // Añadir capital antes/después si disponible
  const capitalRows = [];
  if (capitalSnapshot) {
    capitalRows.push(
      headerRow('💼 Estado del Capital', 'Importe', 'Variación'),
      new TableRow({ children:[tc('Capital antes de ronda',{bold:true}),tc(fmt.usdAbs(capitalSnapshot.before)),tc('—')] }),
      new TableRow({ children:[
        tc('Capital después de ronda',{bold:true}),
        tc(fmt.usdAbs(capitalSnapshot.after),{bold:true,color:pnlColor(capitalSnapshot.after-capitalSnapshot.before)}),
        tc(fmt.usd(capitalSnapshot.after-capitalSnapshot.before),{color:pnlColor(capitalSnapshot.after-capitalSnapshot.before),bold:true}),
      ]}),
    );
  }

  // Breakdown razones de cierre
  const reasonRows = [headerRow('🔒 Razón de Cierre', 'Nº Operaciones', '% del Total')];
  const totalOps = totalOperations || 1;
  Object.entries(closeReasonBreakdown||{}).forEach(([reason, count]) => {
    const label = reason==='take_profit'?'✅ Take Profit':reason==='stop_loss'?'🛑 Stop Loss':reason==='max_hold'?'⏰ Max Hold Cycles':reason==='round_close'?'🏁 Cierre de Ronda':reason==='manual'?'✋ Manual':reason;
    reasonRows.push(new TableRow({ children:[tc(label),tc(String(count)),tc(fmt.pctAbs(count/totalOps*100))] }));
  });

  return [
    h2('💰 Resumen Financiero'),
    ...blank(),

    p('Detalle de P&L:', {bold:true, size:19}),
    new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }),
    ...blank(),

    ...(capitalSnapshot ? [
      p('Capital del sistema:', {bold:true, size:19}),
      new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows:capitalRows }),
      ...blank(),
    ] : []),

    p('Estadísticas de operaciones:', {bold:true, size:19}),
    new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      rows:[
        headerRow('📊 Estadística', 'Valor'),
        new TableRow({ children:[tc('Total operaciones'),    tc(String(totalOperations||0))] }),
        new TableRow({ children:[tc('Operaciones ganadoras'),tc(String(winsCount||0),{color:COLOR.GREEN,bold:true})] }),
        new TableRow({ children:[tc('Operaciones perdedoras'),tc(String(lossesCount||0),{color:COLOR.RED,bold:true})] }),
        new TableRow({ children:[tc('Win Rate',{bold:true}), tc(winRate!=null?fmt.pctAbs(winRate):'—',{bold:true,color:winRate>=50?COLOR.GREEN:COLOR.RED})] }),
        new TableRow({ children:[tc('P&L promedio por operación'), tc(totalOperations>0?fmt.usd((netReturnUSD||0)/totalOperations):'—')] }),
      ]
    }),
    ...blank(),

    ...(Object.keys(closeReasonBreakdown||{}).length>0 ? [
      p('Razones de cierre:', {bold:true, size:19}),
      new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows:reasonRows }),
      ...blank(),
    ] : []),

    ...blank(),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 4 — TOP OPERACIONES
// ══════════════════════════════════════════════════════════════════════════════
function buildTopOperations(report) {
  const wins   = (report.top5Wins   || []).slice(0,5);
  const losses = (report.top5Losses || []).slice(0,5);

  function posRow(pos, isWin) {
    const col = isWin ? COLOR.GREEN : COLOR.RED;
    const bg  = isWin ? COLOR.LIGHTGREEN : COLOR.LIGHTRED;
    return new TableRow({ children:[
      tc(`${pos.symbol?.toUpperCase()||'—'}  ${pos.name?('('+pos.name.substring(0,18)+')'):''}`, {bold:true}),
      tc(fmt.usd(pos.pnlUSD||0),  {color:col, bold:true, bg}),
      tc(fmt.pct(pos.pnlPct||0),  {color:col, bold:true, bg}),
      tc(fmt.usdAbs(pos.capitalUSD||0)),
      tc(pos.closeReason?pos.closeReason.replace('_',' ').toUpperCase():'—'),
      tc(pos.closedAt ? new Date(pos.closedAt).toLocaleDateString('es-ES') : '—'),
    ]});
  }

  const rows = [
    headerRow('🥇 Activo', 'P&L ($)', 'P&L (%)', 'Capital', 'Razón Cierre', 'Fecha'),
  ];

  if (wins.length>0) {
    rows.push(new TableRow({ children:[tc('── TOP GANANCIAS ──',{bold:true,colspan:6,bg:COLOR.SUBHEADER,color:COLOR.WHITE})] }));
    wins.forEach(p => rows.push(posRow(p, true)));
  }
  if (losses.length>0) {
    rows.push(new TableRow({ children:[tc('── TOP PÉRDIDAS ──',{bold:true,colspan:6,bg:COLOR.SUBHEADER,color:COLOR.WHITE})] }));
    losses.forEach(p => rows.push(posRow(p, false)));
  }

  if (wins.length===0 && losses.length===0) return [];

  return [
    h2('🏆 Top Operaciones'),
    p('Las 5 mejores y peores operaciones de la ronda.', {color:COLOR.GRAY, size:18}),
    ...blank(),
    new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }),
    ...blank(2),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 5 — DETALLE DE TODAS LAS OPERACIONES
// ══════════════════════════════════════════════════════════════════════════════
function buildAllPositions(positions) {
  if (!positions || positions.length===0) return [];

  const rows = [
    headerRow('Activo','Capital','P&L $','P&L %','Entrada','Salida','Razón Cierre','Apertura','Cierre'),
  ];

  [...positions]
    .sort((a,b) => (b.realizedPnL||0)-(a.realizedPnL||0))
    .forEach(pos => {
      const pnl = pos.realizedPnL||0;
      rows.push(new TableRow({ children:[
        tc(`${pos.symbol?.toUpperCase()||'?'}`, {bold:true}),
        tc(fmt.usdAbs(pos.capitalUSD||0)),
        tc(fmt.usd(pnl), {color:pnlColor(pnl), bold:true}),
        tc(fmt.pct(pos.realizedPnLPct||pos.realizedPnL_pct||0), {color:pnlColor(pnl)}),
        tc(pos.entryPrice?`$${parseFloat(pos.entryPrice).toFixed(4)}`:'—'),
        tc(pos.exitPrice?`$${parseFloat(pos.exitPrice).toFixed(4)}`:pos.currentPrice?`$${parseFloat(pos.currentPrice).toFixed(4)}`:'—'),
        tc((pos.closeReason||'—').replace(/_/g,' ')),
        tc(pos.openedAt?new Date(pos.openedAt).toLocaleDateString('es-ES'):'—'),
        tc(pos.closedAt?new Date(pos.closedAt).toLocaleDateString('es-ES'):'—'),
      ]}));
    });

  return [
    h2('📋 Detalle de Operaciones'),
    p('Listado completo de todas las posiciones ejecutadas en esta ronda, ordenadas por P&L.', {color:COLOR.GRAY, size:18}),
    ...blank(),
    new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows }),
    ...blank(2),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 6 — ANÁLISIS DE CONTEXTO DE MERCADO
// ══════════════════════════════════════════════════════════════════════════════
function buildMarketContext(report) {
  const mc = report.marketContext || {};
  if (!mc.avgMarketPnl && !mc.bestSymbol && !mc.worstSymbol) return [];

  return [
    h2('🌍 Contexto de Mercado'),
    ...blank(),
    new Table({
      width:{size:100,type:WidthType.PERCENTAGE},
      rows:[
        headerRow('📊 Métrica','Valor','Notas'),
        new TableRow({ children:[
          tc('Movimiento promedio del mercado (activos de la ronda)'),
          tc(fmt.pct(mc.avgMarketPnl||0),{color:pnlColor(mc.avgMarketPnl),bold:true}),
          tc(mc.avgMarketPnl>0?'Mercado alcista durante la ronda':'Mercado bajista durante la ronda'),
        ]}),
        ...(mc.bestSymbol?[new TableRow({ children:[tc('Mejor activo de la ronda'),tc(mc.bestSymbol,{color:COLOR.GREEN,bold:true}),tc('Mayor ganancia porcentual')] })]:[]),
        ...(mc.worstSymbol?[new TableRow({ children:[tc('Peor activo de la ronda'), tc(mc.worstSymbol,{color:COLOR.RED,bold:true}),  tc('Mayor pérdida porcentual')] })]:[]),
      ]
    }),
    ...blank(2),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 7 — CONCLUSIONES Y ANÁLISIS
// ══════════════════════════════════════════════════════════════════════════════
function buildConclusions(round, report, capitalSnapshot) {
  const net = report.netReturnPct || 0;
  const wr  = report.winRate || 0;
  const totalOps = report.totalOperations || 0;

  // Análisis automático basado en los números
  const conclusions = [];

  // Rendimiento global
  if (net >= 5)      conclusions.push({ icon:'🚀', title:'Rendimiento excepcional', text:`La ronda generó un retorno neto de ${fmt.pct(net)}, significativamente por encima de lo esperado. La estrategia funcionó muy bien en este período.` });
  else if (net >= 2) conclusions.push({ icon:'✅', title:'Rendimiento positivo sólido', text:`La ronda cerró con ${fmt.pct(net)} de retorno neto, un resultado positivo que valida la configuración utilizada.` });
  else if (net >= 0) conclusions.push({ icon:'➡️', title:'Rendimiento marginal', text:`La ronda cerró en terreno positivo pero con margen reducido (${fmt.pct(net)}). Considerar ajustes en los parámetros para mejorar la rentabilidad.` });
  else if (net >= -3)conclusions.push({ icon:'⚠️', title:'Pérdida limitada', text:`La ronda registró una pérdida moderada de ${fmt.pct(net)}. Es recomendable revisar los umbrales de Stop Loss y la selección de activos.` });
  else               conclusions.push({ icon:'🛑', title:'Pérdida significativa', text:`La ronda incurrió en una pérdida de ${fmt.pct(net)}. Se recomienda revisar la configuración del sistema antes de abrir la siguiente ronda.` });

  // Win rate
  if (totalOps >= 3) {
    if (wr >= 70)      conclusions.push({ icon:'🎯', title:'Win Rate alto', text:`${fmt.pctAbs(wr)} de las operaciones fueron ganadoras (${report.winsCount}W / ${report.lossesCount}L). La selección de activos fue muy acertada.` });
    else if (wr >= 50) conclusions.push({ icon:'📊', title:'Win Rate positivo', text:`Más del 50% de operaciones ganadoras (${fmt.pctAbs(wr)}). El sistema está seleccionando activos con sesgo positivo.` });
    else               conclusions.push({ icon:'📉', title:'Win Rate bajo', text:`Solo el ${fmt.pctAbs(wr)} de las operaciones fueron ganadoras. Revisar los criterios de selección de activos (BoostPower mínimo, señales).` });
  }

  // Fees
  const feeImpact = report.totalInvested > 0 ? (report.feeBreakdown?.total||0) / report.totalInvested * 100 : 0;
  if (feeImpact > 1) conclusions.push({ icon:'💸', title:'Impacto de fees elevado', text:`Los costes de comisiones representaron ${fmt.pctAbs(feeImpact)} del capital invertido. Considerar aumentar el capital por posición o reducir el número de operaciones.` });

  // Razón de cierre dominante
  const reasons = report.closeReasonBreakdown || {};
  const dominantReason = Object.entries(reasons).sort(([,a],[,b])=>b-a)[0];
  if (dominantReason) {
    const [reason, count] = dominantReason;
    if (reason==='stop_loss' && count/(totalOps||1)>0.4) conclusions.push({ icon:'🛑', title:'Alto porcentaje de Stop Loss', text:`${count} de ${totalOps} operaciones cerraron por Stop Loss (${fmt.pctAbs(count/(totalOps||1)*100)}). Considerar ampliar el Stop Loss o revisar el timing de entrada.` });
    if (reason==='take_profit') conclusions.push({ icon:'✅', title:'Take Profit como razón principal', text:`La mayoría de operaciones (${count}/${totalOps}) cerraron por Take Profit, lo que indica que los objetivos de ganancia se están alcanzando correctamente.` });
    if (reason==='max_hold') conclusions.push({ icon:'⏰', title:'Max Hold Cycles frecuente', text:`${count} operaciones cerraron por tiempo máximo de hold. Considerar ajustar los ciclos máximos de mantenimiento o el criterio de selección.` });
  }

  // Recomendaciones para próxima ronda
  const recs = [];
  const tc_ = round.config || {};
  if (net < -2)  recs.push(`Reducir el Stop Loss de ${fmt.pctAbs(tc_.stopLossPct||5)} a ${Math.max(2, (tc_.stopLossPct||5)-1).toFixed(1)}%`);
  if (wr < 40 && totalOps >= 5) recs.push(`Aumentar el BoostPower mínimo de ${tc_.minBoostPower||0.5} a ${Math.min(0.9,(tc_.minBoostPower||0.5)+0.05).toFixed(2)}`);
  if (feeImpact > 1.5) recs.push(`Aumentar capital mínimo por posición para reducir el impacto de fees`);
  if (net > 5 && wr > 60) recs.push(`Considerar aumentar el Take Profit de ${fmt.pctAbs(tc_.takeProfitPct||10)} a ${((tc_.takeProfitPct||10)*1.1).toFixed(1)}%`);

  const children = [];
  conclusions.forEach(c => {
    children.push(
      new Paragraph({ spacing:{before:200,after:60}, children:[new TextRun({text:`${c.icon} ${c.title}`,bold:true,size:20})] }),
      p(c.text, {size:18, color:COLOR.DARKGRAY, spacing:{after:120}}),
    );
  });

  if (recs.length > 0) {
    children.push(
      ...blank(),
      new Paragraph({ spacing:{before:200,after:100}, children:[new TextRun({text:'💡 Recomendaciones para la próxima ronda:',bold:true,size:20,color:COLOR.BLUE})] }),
      ...recs.map((r,i) => p(`${i+1}. ${r}`, {size:18,color:COLOR.DARKGRAY})),
    );
  }

  return [
    h2('🧠 Análisis y Conclusiones'),
    ...blank(),
    ...children,
    ...blank(2),
  ];
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — generateRoundReport
// ══════════════════════════════════════════════════════════════════════════════
async function generateRoundReport(round, positions, capitalSnapshot) {
  const report = round.report || {};

  // Filtrar posiciones de esta ronda
  const roundStart = round.openedAt ? new Date(round.openedAt).getTime() : 0;
  const roundPositions = positions ? positions.filter(p => {
    if (p.status !== 'closed') return false;
    const openedAt = p.openedAt ? new Date(p.openedAt).getTime() : 0;
    const closedAt = p.closedAt ? new Date(p.closedAt).getTime() : 0;
    return roundStart > 0 && (openedAt >= roundStart || closedAt >= roundStart);
  }) : [];

  const doc = new Document({
    creator:     'Crypto Detector',
    title:       `Informe Ronda #${round.roundNumber}`,
    description: `Ronda de inversión #${round.roundNumber} · ${round.config?.mode || 'simulated'}`,
    styles: {
      default: {
        document: {
          run: { font:'Calibri', size:20, color:COLOR.DARK }
        }
      },
      paragraphStyles: [
        { id:'Heading1', name:'Heading 1', run:{ bold:true, size:32, color:COLOR.DARK } },
        { id:'Heading2', name:'Heading 2', run:{ bold:true, size:26, color:COLOR.DARKGRAY } },
        { id:'Heading3', name:'Heading 3', run:{ bold:true, size:22, color:COLOR.GRAY } },
      ]
    },
    sections: [{
      properties: {},
      children: [
        // 1. Portada + resumen ejecutivo
        ...buildCover(round, report, capitalSnapshot),

        // 2. Configuración del sistema
        ...buildSystemConfig(round, report),
        br(),

        // 3. Resumen financiero detallado
        ...buildFinancialSummary(report, capitalSnapshot),
        br(),

        // 4. Top operaciones
        ...buildTopOperations(report),
        br(),

        // 5. Detalle de todas las posiciones
        ...buildAllPositions(roundPositions),
        br(),

        // 6. Contexto de mercado
        ...buildMarketContext(report),

        // 7. Conclusiones y recomendaciones
        ...buildConclusions(round, report, capitalSnapshot),

        sep(),
        p(`Informe generado automáticamente por Crypto Detector  ·  ${fmt.date(Date.now())}`, {
          color:COLOR.GRAY, size:16, center:true, spacing:{before:200}
        }),
      ]
    }]
  });

  return doc;
}

module.exports = { generateRoundReport };
