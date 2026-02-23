// enhanced-report-generator.js — v3.1
// Informe paramétrico completo por activo + conclusiones LLM "Los 3 Sabios"
//
// Secciones:
//   1. Portada y resumen ejecutivo (modo normal / especulativo)
//      · Ventana temporal explícita (misma para predicción y validación)
//      · Candidatas al próximo ciclo — siempre explícito (nunca en blanco)
//      · Activos descartados — siempre explícito (nunca en blanco)
//   2. Configuración del algoritmo (todos los pesos y umbrales)
//   3. Contexto general de mercado en el momento del ciclo
//   4. Por cada activo: indicadores calculados + influencia en clasificación,
//      valores de mercado inicio→fin, Google Trends, predicción vs real
//   5. Tabla comparativa global — nueva lógica:
//      · Dirección acertada ✓/✗ (↑↑/↓↓/↑↓/↓↑)
//      · Calidad: Buena ≤1% / Media 1-3% / No válida >3%
//   6. Parámetros del algoritmo de compra/venta durante el ciclo
//   7. Conclusiones por activo (razonamiento individual mejorado)
//   8. Conclusiones generales con consenso "Los 3 Sabios" (LLM)
//   9. Recomendaciones de ajuste de pesos

'use strict';

const axios = require('axios');
const {
  Document, Paragraph, TextRun, Table, TableCell, TableRow,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, convertInchesToTwip, PageBreak
} = require('docx');

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS DE FORMATO
// ═══════════════════════════════════════════════════════════════════════════════

const fmt = {
  pct:    v => `${parseFloat(v || 0).toFixed(2)}%`,
  pct1:   v => `${parseFloat(v || 0).toFixed(1)}%`,
  price:  v => v >= 1 ? `$${parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${parseFloat(v).toFixed(6)}`,
  mcap:   v => { if (!v) return '—'; const b = v / 1e9; return b >= 1 ? `$${b.toFixed(2)}B` : `$${(v/1e6).toFixed(1)}M`; },
  vol:    v => { if (!v) return '—'; const b = v / 1e9; return b >= 1 ? `$${b.toFixed(2)}B` : `$${(v/1e6).toFixed(1)}M`; },
  weight: v => `${(parseFloat(v || 0) * 100).toFixed(0)}%`,
  score:  v => `${(parseFloat(v || 0) * 100).toFixed(0)}/100`,
  date:   v => new Date(v).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }),
  dur:    ms => { const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000); return `${h}h ${m}m`; },
  sign:   v => parseFloat(v) >= 0 ? `+${parseFloat(v).toFixed(2)}%` : `${parseFloat(v).toFixed(2)}%`,
};

const COLOR = {
  GREEN:    '16A34A', LIGHTGREEN: '4ADE80', RED:    'DC2626', LIGHTRED:   'F87171',
  YELLOW:   'CA8A04', LIGHTYELLOW:'FDE68A', BLUE:   '2563EB', LIGHTBLUE:  '93C5FD',
  PURPLE:   '7C3AED', GRAY:       '6B7280', DARK:   '111827', WHITE:      'FFFFFF',
  ORANGE:   'EA580C', TEAL:       '0D9488', HEADER: '1E293B', SUBHEADER:  '334155',
};

function classColor(cat) {
  return cat === 'INVERTIBLE' ? COLOR.GREEN : cat === 'APALANCADO' ? COLOR.YELLOW : COLOR.GRAY;
}
function changeColor(v) { return parseFloat(v) >= 0 ? COLOR.GREEN : COLOR.RED; }
function correctColor(c) { return c ? COLOR.GREEN : COLOR.RED; }

// ─── NUEVO v3.1: Calidad de predicción ────────────────────────────────────────
/**
 * Califica la predicción según desviación absoluta (pred vs real)
 *   Buena    <= 1%
 *   Media    1% < x <= 3%
 *   No válida > 3%
 */
function predQuality(absDev) {
  const d = Math.abs(parseFloat(absDev || 0));
  if (d <= 1) return { label: 'BUENA',     color: COLOR.GREEN,  bg: 'F0FDF4' };
  if (d <= 3) return { label: 'MEDIA',     color: COLOR.YELLOW, bg: 'FFFBEB' };
  return           { label: 'NO VALIDA',  color: COLOR.RED,    bg: 'FEF2F2' };
}

/**
 * Analiza si prediccion y real van en la misma direccion.
 * Devuelve { correct: boolean, label: string, arrow: string }
 * Umbral de ruido: movimientos < 0.3% se consideran laterales.
 */
function directionAnalysis(predicted, actual) {
  const p = parseFloat(predicted || 0);
  const a = parseFloat(actual    || 0);
  const NOISE = 0.3;
  const pDir = Math.abs(p) < NOISE ? 0 : (p > 0 ? 1 : -1);
  const aDir = Math.abs(a) < NOISE ? 0 : (a > 0 ? 1 : -1);

  if (pDir === 0 && aDir === 0) return { correct: true,  label: 'Lateral / Lateral',                                   arrow: '->' };
  if (pDir === 0)               return { correct: Math.abs(a) < 1, label: `Lateral / ${a>0?'Sube':'Baja'}`,           arrow: '->' };
  if (aDir === 0)               return { correct: Math.abs(p) < 1, label: `${p>0?'Sube':'Baja'} / Lateral`,          arrow: '->' };

  if (pDir === aDir) {
    const arrow = pDir > 0 ? 'sube/sube' : 'baja/baja';
    return { correct: true,  label: `[${arrow}] ${pDir > 0 ? 'Subida' : 'Bajada'} acertada`, arrow };
  }
  const arrow = p > 0 ? 'sube/baja' : 'baja/sube';
  return { correct: false, label: `[${arrow}] Pred: ${p>0?'Sube':'Baja'} / Real: ${a>0?'Sube':'Baja'}`, arrow };
}

// Celda de tabla con fondo opcional
function tc(text, { bold = false, color, bg, align = AlignmentType.LEFT, colspan } = {}) {
  return new TableCell({
    columnSpan: colspan,
    shading: bg ? { fill: bg, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text ?? '—'), bold, color: color || COLOR.DARK, size: 18 })]
    })]
  });
}

function headerRow(...cells) {
  return new TableRow({ children: cells.map(t => tc(t, { bold: true, bg: COLOR.HEADER, color: COLOR.WHITE })) });
}

function p(text, { bold = false, color, size = 20, spacing, indent } = {}) {
  return new Paragraph({
    spacing,
    indent,
    children: [new TextRun({ text: String(text ?? ''), bold, color, size })]
  });
}

function h1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 600, after: 200 } });
}
function h2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 400, after: 160 } });
}
function h3(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 300, after: 120 } });
}
function br() { return new Paragraph({ children: [new PageBreak()] }); }
function sep() { return p('─'.repeat(80), { color: COLOR.GRAY, size: 16 }); }
function blank(n = 1) { return Array.from({ length: n }, () => new Paragraph('')); }

function kv(label, value, { color } = {}) {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 19 }),
      new TextRun({ text: String(value ?? '—'), color: color || COLOR.DARK, size: 19 }),
    ]
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 1 — PORTADA Y RESUMEN EJECUTIVO
// ═══════════════════════════════════════════════════════════════════════════════

function buildCover(cycle, config) {
  const mode        = cycle.mode || 'normal';
  const modeLabel   = mode === 'speculative' ? 'ESPECULATIVO' : 'GENERALISTA';
  const allResults  = cycle.results || [];
  const excludedIds = cycle.excludedResults || [];
  const validResults = allResults.filter(r => !excludedIds.includes(r.id));
  const excluded     = allResults.filter(r =>  excludedIds.includes(r.id));
  const successRate  = cycle.metrics?.successRate || '0.00';
  const acc          = parseFloat(successRate);

  // Candidatas al proximo ciclo: INVERTIBLE/APALANCADO que acertaron con BP >= 60%
  const nextCandidates = validResults.filter(r =>
    (r.classification === 'INVERTIBLE' || r.classification === 'APALANCADO') &&
    r.correct &&
    parseFloat(r.boostPower || 0) >= 0.60
  );

  const windowHrs  = ((cycle.durationMs || 43200000) / 3600000).toFixed(1);
  const windowNote = `Todas las predicciones y validaciones corresponden a la misma ventana de ${windowHrs}h (inicio: ${fmt.date(cycle.startTime)} -> fin: ${fmt.date(cycle.completedAt)})`;

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: 'CRYPTO DETECTOR', bold: true, size: 52, color: COLOR.BLUE })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: `INFORME ANALITICO DE CICLO - MODELO ${modeLabel}`, bold: true, size: 28, color: COLOR.DARK })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: `Generado: ${fmt.date(Date.now())}`, size: 18, color: COLOR.GRAY })]
    }),
    sep(),
    ...blank(),

    // Resumen ejecutivo en tabla
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [
          tc('ID Ciclo',   { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(cycle.id,    { bg: 'F1F5F9' }),
          tc('Modo',      { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(modeLabel,   { bold: true, bg: 'F1F5F9', color: mode === 'speculative' ? COLOR.ORANGE : COLOR.BLUE }),
        ]}),
        new TableRow({ children: [
          tc('Inicio',    { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(fmt.date(cycle.startTime),   { bg: 'F1F5F9' }),
          tc('Fin',       { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(fmt.date(cycle.completedAt), { bg: 'F1F5F9' }),
        ]}),
        new TableRow({ children: [
          tc('Duracion',  { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(fmt.dur(cycle.durationMs || 0), { bg: 'F1F5F9' }),
          tc('Significativo', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(cycle.isSignificant ? 'Si (>=6h)' : 'No (<6h)', { bg: 'F1F5F9', color: cycle.isSignificant ? COLOR.GREEN : COLOR.ORANGE }),
        ]}),
        new TableRow({ children: [
          tc('Activos analizados', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(`${validResults.length} validos / ${allResults.length} total`, { bg: 'F1F5F9' }),
          tc('Tasa de acierto',   { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(`${successRate}%`, { bold: true, bg: acc >= 60 ? 'DCFCE7' : acc >= 40 ? 'FEF9C3' : 'FEE2E2', color: acc >= 60 ? COLOR.GREEN : acc >= 40 ? COLOR.YELLOW : COLOR.RED }),
        ]}),
        new TableRow({ children: [
          tc('Correctas',  { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(`${cycle.metrics?.correct || 0} / ${cycle.metrics?.total || 0}`, { bg: 'F1F5F9' }),
          tc('Error promedio', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(fmt.pct(cycle.metrics?.avgError || 0), { bg: 'F1F5F9' }),
        ]}),
        new TableRow({ children: [
          tc('INVERTIBLE', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(`${cycle.metrics?.invertible?.correct||0}/${cycle.metrics?.invertible?.total||0} (${cycle.metrics?.invertible?.successRate||'0.00'}%)`, { bg: 'F0FDF4' }),
          tc('APALANCADO', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(`${cycle.metrics?.apalancado?.correct||0}/${cycle.metrics?.apalancado?.total||0} (${cycle.metrics?.apalancado?.successRate||'0.00'}%)`, { bg: 'FFFBEB' }),
        ]}),
      ]
    }),
    ...blank(),

    // Ventana temporal — siempre explicita
    p('Ventana Temporal de Analisis', { bold: true, size: 22, color: COLOR.BLUE }),
    p(windowNote, { size: 18, color: COLOR.DARK }),
    ...blank(),

    // Candidatas al proximo ciclo — SIEMPRE explicito, nunca en blanco
    p('Candidatas para el Proximo Ciclo', { bold: true, size: 22, color: COLOR.GREEN }),
    ...(nextCandidates.length === 0
      ? [p('Ninguna — No hay activos que cumplan los criterios para ser candidatos al proximo ciclo (requiere: acierto + BoostPower >= 60% + clasificacion INVERTIBLE o APALANCADO).', {
          size: 18, color: COLOR.RED
        })]
      : [
          p(`${nextCandidates.length} activo(s) recomendados para el siguiente ciclo:`, { size: 18 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              headerRow('Activo', 'Clasificacion', 'BoostPower', 'Pred.', 'Real', 'Calidad pred.'),
              ...nextCandidates.map(r => {
                const dev  = Math.abs(parseFloat(r.predictedChange||0) - parseFloat(r.actualChange||0));
                const qual = predQuality(dev);
                return new TableRow({ children: [
                  tc(`${r.name||r.symbol} (${r.symbol?.toUpperCase()})`, { bold: true }),
                  tc(r.classification, { color: classColor(r.classification), bold: true }),
                  tc(fmt.score(r.boostPower), { color: COLOR.GREEN }),
                  tc(fmt.sign(r.predictedChange), { color: changeColor(r.predictedChange) }),
                  tc(fmt.sign(r.actualChange),    { color: changeColor(r.actualChange) }),
                  tc(qual.label, { bold: true, color: qual.color }),
                ]});
              }),
            ]
          }),
        ]
    ),
    ...blank(),

    // Activos descartados — SIEMPRE explicito, nunca en blanco
    p('Activos Descartados (Excluidos del Analisis Estadistico)', { bold: true, size: 22, color: COLOR.RED }),
    ...(excluded.length === 0
      ? [p('Ninguno — Todos los activos del ciclo han sido incluidos en el analisis estadistico.', {
          size: 18, color: COLOR.GRAY
        })]
      : [
          p(`${excluded.length} activo(s) excluidos manualmente del computo estadistico:`, { size: 18, color: COLOR.ORANGE }),
          new Table({
            width: { size: 80, type: WidthType.PERCENTAGE },
            rows: [
              headerRow('Activo', 'Clasificacion', 'BoostPower', 'Razon exclusion'),
              ...excluded.map(r => new TableRow({ children: [
                tc(`${r.name||r.symbol} (${r.symbol?.toUpperCase()})`, { bold: true }),
                tc(r.classification || '—', { color: classColor(r.classification) }),
                tc(fmt.score(r.boostPower)),
                tc(r.exclusionReason || 'Excluido manualmente por el operador', { color: COLOR.GRAY }),
              ]})),
            ]
          }),
        ]
    ),
    ...blank(),
    sep(),
    ...blank(),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 2 — CONFIGURACIÓN COMPLETA DEL ALGORITMO
// ═══════════════════════════════════════════════════════════════════════════════

function buildConfigSection(config, mode) {
  const modeLabel = mode === 'speculative' ? 'Especulativo' : 'Generalista';

  // Pesos de potencial
  const pw = config.potentialWeights || {};
  const rw = config.resistanceWeights || {};
  const mw = config.metaWeights || {};
  const cl = config.classification || {};
  const pr = config.prediction || {};
  const th = config.thresholds || {};

  return [
    h2(`Configuración del Algoritmo — Modelo ${modeLabel}`),
    p('Pesos y parámetros activos durante este ciclo de ejecución. Estos valores determinan la clasificación de activos y las predicciones generadas.', { color: COLOR.GRAY, size: 18 }),
    ...blank(),

    // Meta-pesos
    h3('Meta-pesos (Potencial vs Resistencia)'),
    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Componente', 'Peso asignado', 'Influencia'),
        new TableRow({ children: [tc('Potencial'), tc(fmt.weight(mw.potential), { color: COLOR.GREEN, bold: true }), tc('Fuerza de subida del activo')] }),
        new TableRow({ children: [tc('Resistencia'), tc(fmt.weight(mw.resistance), { color: COLOR.RED, bold: true }), tc('Factores que frenan el movimiento')] }),
      ]
    }),
    ...blank(),

    // Factores de potencial con pesos
    h3('Factores de Potencial (con pesos individuales)'),
    new Table({
      width: { size: 90, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Factor', 'Peso', 'Descripción'),
        new TableRow({ children: [tc('ATL Proximity (atlProximity)'), tc(fmt.weight(pw.atlProximity), { color: COLOR.GREEN, bold: true }), tc('Distancia al mínimo histórico — mayor espacio de subida')] }),
        new TableRow({ children: [tc('Volume Surge (volumeSurge)'), tc(fmt.weight(pw.volumeSurge), { color: COLOR.GREEN, bold: true }), tc('Pico de volumen relativo al market cap')] }),
        new TableRow({ children: [tc('Social Momentum (socialMomentum)'), tc(fmt.weight(pw.socialMomentum), { color: COLOR.GREEN, bold: true }), tc('Reddit + noticias específicas del activo')] }),
        new TableRow({ children: [tc('News Sentiment (newsSentiment)'), tc(fmt.weight(pw.newsSentiment), { color: COLOR.GREEN, bold: true }), tc('Tono de noticias recientes sobre el activo')] }),
        new TableRow({ children: [tc('Rebound Recency (reboundRecency)'), tc(fmt.weight(pw.reboundRecency), { color: COLOR.GREEN, bold: true }), tc('ATL reciente → patrón de rebote más probable')] }),
      ]
    }),
    ...blank(),

    // Factores de resistencia con pesos
    h3('Factores de Resistencia (con pesos individuales)'),
    new Table({
      width: { size: 90, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Factor', 'Peso', 'Descripción'),
        new TableRow({ children: [tc('Leverage Ratio (leverageRatio)'), tc(fmt.weight(rw.leverageRatio), { color: COLOR.RED, bold: true }), tc('Precio vs histórico — holders en beneficio presionarán bajada')] }),
        new TableRow({ children: [tc('Market Cap Size (marketCapSize)'), tc(fmt.weight(rw.marketCapSize), { color: COLOR.RED, bold: true }), tc('Cap grande → más difícil mover significativamente')] }),
        new TableRow({ children: [tc('Volatility Noise (volatilityNoise)'), tc(fmt.weight(rw.volatilityNoise), { color: COLOR.RED, bold: true }), tc('Volatilidad extrema → ruido sin señal real')] }),
        new TableRow({ children: [tc('Fear Overlap (fearOverlap)'), tc(fmt.weight(rw.fearOverlap), { color: COLOR.RED, bold: true }), tc('Fear & Greed alto → euforia de mercado → techo cercano')] }),
      ]
    }),
    ...blank(),

    // Clasificación y predicción
    h3('Parámetros de Clasificación y Predicción'),
    new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Parámetro', 'Valor', 'Función'),
        new TableRow({ children: [tc('INVERTIBLE — Boost mínimo'), tc(fmt.weight(cl.invertibleMinBoost), { bold: true, color: COLOR.GREEN }), tc('BoostPower mínimo para clasificar como INVERTIBLE')] }),
        new TableRow({ children: [tc('APALANCADO — Boost mínimo'), tc(fmt.weight(cl.apalancadoMinBoost), { bold: true, color: COLOR.YELLOW }), tc('BoostPower mínimo para APALANCADO (o RUIDOSO si menor)')] }),
        new TableRow({ children: [tc('INVERTIBLE — Target cambio'), tc(fmt.pct(pr.invertibleTarget), { bold: true }), tc('Cambio % objetivo predicho para INVERTIBLE')] }),
        new TableRow({ children: [tc('Tolerancia de magnitud'), tc(`±${fmt.pct(pr.magnitudeTolerance)}`, { bold: true }), tc('Margen de error aceptable en la magnitud predicha')] }),
        new TableRow({ children: [tc('Umbral Vol. mínimo'), tc(fmt.vol(th.volumeMin), { bold: true }), tc('Volumen mínimo para considerar señal válida')] }),
        new TableRow({ children: [tc('Umbral Vol. máximo'), tc(fmt.vol(th.volumeMax), { bold: true }), tc('Volumen máximo (exceso = sospecha de manipulación)')] }),
      ]
    }),
    ...blank(2),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 3 — CONTEXTO GENERAL DE MERCADO
// ═══════════════════════════════════════════════════════════════════════════════

function buildMarketContext(cycle) {
  const ctx = cycle.marketContext || cycle.externalData || {};
  const fg  = ctx.fearGreed || cycle.fearGreed;

  return [
    h2('Contexto General de Mercado al Inicio del Ciclo'),
    p('Indicadores macroeconómicos y de sentimiento que afectan a todos los activos del ciclo.', { color: COLOR.GRAY, size: 18 }),
    ...blank(),
    new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Indicador', 'Valor', 'Interpretación'),
        new TableRow({ children: [
          tc('Fear & Greed Index'),
          tc(fg ? `${fg.value || fg.score || '—'} — ${fg.label || fg.valueClassification || '—'}` : 'No disponible',
             { bold: true, color: fg ? (parseInt(fg.value||fg.score||50) < 40 ? COLOR.GREEN : parseInt(fg.value||fg.score||50) > 60 ? COLOR.RED : COLOR.YELLOW) : COLOR.GRAY }),
          tc(fg ? fearGreedInterpretation(parseInt(fg.value || fg.score || 50)) : 'Dato no capturado en este ciclo')
        ]}),
        new TableRow({ children: [
          tc('Sentimiento de noticias (mercado)'),
          tc(ctx.marketNews?.avgSentiment !== undefined ? `${(ctx.marketNews.avgSentiment * 100).toFixed(0)}%` : '—'),
          tc('Tono medio de noticias crypto genéricas en el período')
        ]}),
        new TableRow({ children: [
          tc('Modo de mercado (ciclo)'),
          tc((cycle.mode || 'normal').toUpperCase(), { bold: true, color: cycle.mode === 'speculative' ? COLOR.ORANGE : COLOR.BLUE }),
          tc(cycle.mode === 'speculative' ? 'Micro-caps seleccionados (cap < $200M)' : 'Top activos por capitalización de mercado')
        ]}),
        new TableRow({ children: [
          tc('Factor de escala temporal'),
          tc(cycle.predictionScaleFactor ? `×${parseFloat(cycle.predictionScaleFactor).toFixed(2)}` : cycle.snapshot?.[0]?.predictionScaleFactor ? `×${parseFloat(cycle.snapshot[0].predictionScaleFactor).toFixed(2)}` : '×1.00'),
          tc(`Las predicciones base (12h) se escalaron por este factor según duración ${fmt.dur(cycle.durationMs || 43200000)}`)
        ]}),
      ]
    }),
    ...blank(2),
  ];
}

function fearGreedInterpretation(v) {
  if (v <= 20) return 'Miedo extremo → señal contrarian de compra fuerte';
  if (v <= 40) return 'Miedo → mercado pesimista, posibles oportunidades';
  if (v <= 60) return 'Neutral → mercado equilibrado, seguir señales individuales';
  if (v <= 80) return 'Codicia → euforia moderada, mayor riesgo de corrección';
  return 'Codicia extrema → máximo riesgo, probable corrección inminente';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 4 — ANÁLISIS PARAMÉTRICO POR ACTIVO
// ═══════════════════════════════════════════════════════════════════════════════

function buildPerAssetSection(cycle, allSnapshot) {
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));

  const sections = [
    h2('Análisis Paramétrico por Activo'),
    p('Para cada activo: parámetros de clasificación, valores de mercado inicio→fin, tendencias de búsqueda y comparación predicción vs real.', { color: COLOR.GRAY, size: 18 }),
    ...blank(),
  ];

  validResults.forEach((result, i) => {
    // Buscar datos del snapshot (inicio del ciclo)
    const snap = (allSnapshot || cycle.snapshot || []).find(a => a.id === result.id) || {};

    sections.push(...buildAssetCard(result, snap, cycle, i + 1));
  });

  return sections;
}

function buildAssetCard(result, snap, cycle, idx) {
  const cat         = result.classification || 'RUIDOSO';
  const catColor    = classColor(cat);
  const predicted   = parseFloat(result.predictedChange || 0);
  const actual      = parseFloat(result.actualChange || 0);
  const correct     = result.correct;
  const startPrice  = result.snapshotPrice || snap.current_price || 0;
  const endPrice    = result.currentPrice || 0;
  const priceDelta  = startPrice > 0 ? ((endPrice - startPrice) / startPrice * 100) : 0;

  // Nuevas metricas v3.1
  const absDev      = Math.abs(predicted - actual);
  const dir         = directionAnalysis(predicted, actual);
  const qual        = predQuality(absDev);

  // Breakdown de factores (si está disponible)
  const bd = snap.breakdown || {};
  const potFactors = bd.potential?.factors || {};
  const resFactors = bd.resistance?.factors || {};
  const indicators = bd.indicators || {};

  // Trends (si fueron capturados)
  const trends = snap.googleTrends || snap.trends || null;

  return [
    h3(`${idx}. ${result.name || snap.name || result.symbol?.toUpperCase()} (${result.symbol?.toUpperCase() || '—'})`),

    // — Resultado general del activo
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [
          tc('Clasificacion', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(cat, { bold: true, color: catColor, bg: cat === 'INVERTIBLE' ? 'DCFCE7' : cat === 'APALANCADO' ? 'FEF9C3' : 'F3F4F6' }),
          tc('BoostPower', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(fmt.score(result.boostPower || snap.boostPower), { bold: true, color: (result.boostPower || snap.boostPower || 0) > 0.6 ? COLOR.GREEN : COLOR.YELLOW }),
          tc('Resultado', { bold: true, bg: COLOR.SUBHEADER, color: COLOR.WHITE }),
          tc(correct ? 'CORRECTO' : 'INCORRECTO', { bold: true, color: correctColor(correct), bg: correct ? 'DCFCE7' : 'FEE2E2' }),
        ]}),
      ]
    }),
    ...blank(),

    // — Valores de mercado: inicio vs fin
    h3('  Valores de Mercado — Inicio vs Fin del Ciclo'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Metrica', 'Valor al INICIO', 'Valor al CIERRE', 'Variacion'),
        new TableRow({ children: [
          tc('Precio', { bold: true }),
          tc(fmt.price(startPrice)),
          tc(fmt.price(endPrice)),
          tc(fmt.sign(priceDelta), { bold: true, color: changeColor(priceDelta) }),
        ]}),
        new TableRow({ children: [
          tc('Market Cap', { bold: true }),
          tc(fmt.mcap(snap.market_cap)),
          tc('—'),
          tc('—'),
        ]}),
        new TableRow({ children: [
          tc('Volumen 24h (inicio)', { bold: true }),
          tc(fmt.vol(snap.total_volume)),
          tc('—'),
          tc('—'),
        ]}),
        new TableRow({ children: [
          tc('Cambio 24h (inicio)', { bold: true }),
          tc(fmt.sign(snap.price_change_percentage_24h), { color: changeColor(snap.price_change_percentage_24h) }),
          tc('—'),
          tc('—'),
        ]}),
        new TableRow({ children: [
          tc('ATH', { bold: true }),
          tc(fmt.price(snap.ath)),
          tc('Distancia al ATH', { bold: true }),
          tc(snap.ath && startPrice ? fmt.pct1((snap.ath - startPrice) / snap.ath * 100) + ' por debajo' : '—'),
        ]}),
        new TableRow({ children: [
          tc('ATL', { bold: true }),
          tc(fmt.price(snap.atl)),
          tc('Distancia al ATL', { bold: true }),
          tc(snap.atl && startPrice ? fmt.pct1((startPrice - snap.atl) / startPrice * 100) + ' por encima' : '—'),
        ]}),
      ]
    }),
    ...blank(),

    // — NUEVA SECCION v3.1: Indicadores calculados e influencia
    ...buildIndicatorsTable(snap, result),

    // — Prediccion vs Real (mejorado v3.1)
    h3('  Prediccion vs Resultado Real'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Metrica', 'Prediccion', 'Real', 'Resultado'),
        new TableRow({ children: [
          tc('Cambio esperado / observado', { bold: true }),
          tc(fmt.sign(predicted), { bold: true, color: changeColor(predicted) }),
          tc(fmt.sign(actual),    { bold: true, color: changeColor(actual) }),
          tc(`Desv. abs.: ${fmt.pct(absDev)}`, { color: qual.color }),
        ]}),
        new TableRow({ children: [
          tc('Direccion', { bold: true }),
          tc(predicted >= 0 ? 'Sube' : 'Baja', { color: changeColor(predicted) }),
          tc(actual    >= 0 ? 'Sube' : 'Baja', { color: changeColor(actual) }),
          tc(`${dir.correct ? '[OK]' : '[FALLO]'} ${dir.label}`, { bold: true, color: dir.correct ? COLOR.GREEN : COLOR.RED }),
        ]}),
        new TableRow({ children: [
          tc('Calidad de prediccion', { bold: true }),
          tc(qual.label, { bold: true, color: qual.color, colspan: 2 }),
          tc(qual.label === 'BUENA' ? 'Desv <=1% — prediccion precisa' : qual.label === 'MEDIA' ? 'Desv 1-3% — orientativa' : 'Desv >3% — no valida estadisticamente', { color: qual.color }),
        ]}),
        new TableRow({ children: [
          tc('Ventana temporal', { bold: true }),
          tc(fmt.date(cycle.startTime), { colspan: 2 }),
          tc(`-> ${fmt.date(cycle.completedAt)}  (${fmt.dur(cycle.durationMs||0)})`, { color: COLOR.GRAY }),
        ]}),
      ]
    }),
    p(`Razon de validacion: ${result.validationReason || '—'}`, { color: COLOR.GRAY, size: 17, spacing: { before: 100 } }),
    ...blank(),

    // — Factores del algoritmo (breakdown)
    h3('  Factores del Algoritmo (pesos y scores)'),
    buildFactorsTable(potFactors, resFactors, snap, cycle.config, indicators),
    ...blank(),

    // — Google Trends (si disponible)
    ...(trends ? buildTrendsSection(trends, result.name || snap.name) : [
      p('Google Trends: dato no disponible para este activo (requiere SERPAPI_KEY configurada)', { color: COLOR.GRAY, size: 17 })
    ]),
    ...blank(),
    sep(),
    ...blank(),
  ];
}

function buildFactorsTable(potFactors, resFactors, snap, cycleConfig, indicators) {
  const rows = [headerRow('Factor', 'Tipo', 'Score (0-100)', 'Contexto')];

  const potDefs = [
    { key: 'atlProximity',   label: 'ATL Proximity',   type: 'Potencial' },
    { key: 'volumeSurge',    label: 'Volume Surge',    type: 'Potencial' },
    { key: 'socialMomentum', label: 'Social Momentum', type: 'Potencial' },
    { key: 'newsSentiment',  label: 'News Sentiment',  type: 'Potencial' },
    { key: 'reboundRecency', label: 'Rebound Recency', type: 'Potencial' },
  ];
  const resDefs = [
    { key: 'leverageRatio',   label: 'Leverage Ratio',   type: 'Resistencia' },
    { key: 'marketCapSize',   label: 'Market Cap Size',  type: 'Resistencia' },
    { key: 'volatilityNoise', label: 'Volatility Noise', type: 'Resistencia' },
    { key: 'fearOverlap',     label: 'Fear Overlap',     type: 'Resistencia' },
  ];

  potDefs.forEach(d => {
    const v = potFactors[d.key];
    if (v === undefined) return;
    const score = Math.round(v * 100);
    rows.push(new TableRow({ children: [
      tc(d.label),
      tc(d.type, { color: COLOR.GREEN }),
      tc(`${score}/100`, { bold: true, color: score >= 60 ? COLOR.GREEN : score >= 40 ? COLOR.YELLOW : COLOR.RED }),
      tc(factorContext(d.key, v, snap, indicators)),
    ]}));
  });

  resDefs.forEach(d => {
    const v = resFactors[d.key];
    if (v === undefined) return;
    const score = Math.round(v * 100);
    rows.push(new TableRow({ children: [
      tc(d.label),
      tc(d.type, { color: COLOR.RED }),
      tc(`${score}/100`, { bold: true, color: score >= 60 ? COLOR.RED : score >= 40 ? COLOR.YELLOW : COLOR.GREEN }),
      tc(factorContext(d.key, v, snap, indicators)),
    ]}));
  });

  if (rows.length === 1) {
    rows.push(new TableRow({ children: [tc('Breakdown detallado no disponible (datos del snapshot simplificado)', { colspan: 4, color: COLOR.GRAY })] }));
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function factorContext(key, value, snap, indicators) {
  switch (key) {
    case 'atlProximity':
      if (!snap.atl || !snap.current_price) return '—';
      const pct = ((snap.current_price - snap.atl) / snap.current_price * 100).toFixed(1);
      return `Precio ${pct}% por encima del ATL histórico`;
    case 'volumeSurge':
      if (!snap.total_volume || !snap.market_cap) return '—';
      return `Ratio vol/mcap: ${(snap.total_volume / snap.market_cap * 100).toFixed(2)}%`;
    case 'socialMomentum':
      return indicators.newsCount !== undefined ? `${indicators.newsCount} noticias, sentimiento ${indicators.newsSentimentLabel || '—'}` : '—';
    case 'newsSentiment':
      return indicators.newsSentiment !== undefined ? `Score sentimiento: ${(indicators.newsSentiment * 100).toFixed(0)}%` : '—';
    case 'reboundRecency':
      return indicators.atlDaysAgo !== undefined ? `ATL hace ${indicators.atlDaysAgo} días` : '—';
    case 'leverageRatio':
      if (!snap.ath || !snap.current_price) return '—';
      return `Precio al ${(snap.current_price / snap.ath * 100).toFixed(1)}% del ATH`;
    case 'marketCapSize':
      return fmt.mcap(snap.market_cap);
    case 'volatilityNoise':
      return indicators.change7d !== undefined ? `Cambio 7d: ${parseFloat(indicators.change7d || 0).toFixed(2)}%` : '—';
    case 'fearOverlap':
      return indicators.fearGreedIndex !== undefined ? `FGI: ${indicators.fearGreedIndex} — ${indicators.fearGreedLabel || '—'}` : '—';
    default: return '—';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NUEVA SECCION v3.1 — INDICADORES CALCULADOS E INFLUENCIA EN CLASIFICACION
// ═══════════════════════════════════════════════════════════════════════════════

function buildIndicatorsTable(snap, result) {
  const bd         = snap.breakdown || result.breakdown || {};
  const indicators = bd.indicators  || snap.indicators || {};
  const potFactors = bd.potential?.factors  || {};
  const resFactors = bd.resistance?.factors || {};
  const potScore   = parseFloat(bd.potential?.score  || 0);
  const resScore   = parseFloat(bd.resistance?.score || 0);

  if (Object.keys(indicators).length === 0 && Object.keys(potFactors).length === 0) {
    return [
      h3('  Indicadores Calculados'),
      p('Datos de indicadores no disponibles para este activo en este ciclo.', { size: 17, color: COLOR.GRAY }),
      ...blank(),
    ];
  }

  const rows = [
    headerRow('Indicador', 'Valor', 'Tipo', 'Influencia en clasificacion'),
    ...buildIndicatorRows(indicators, potFactors, resFactors, snap),
    // Filas de resumen de scores
    new TableRow({ children: [
      tc('SCORE POTENCIAL', { bold: true, bg: 'F0FDF4' }),
      tc(`${(potScore * 100).toFixed(0)}/100`, { bold: true, bg: 'F0FDF4', color: potScore >= 0.6 ? COLOR.GREEN : COLOR.YELLOW }),
      tc('META', { bg: 'F0FDF4', color: COLOR.TEAL }),
      tc('Suma ponderada de factores alcistas -> determina el BoostPower del activo', { bg: 'F0FDF4' }),
    ]}),
    new TableRow({ children: [
      tc('SCORE RESISTENCIA', { bold: true, bg: 'FEF2F2' }),
      tc(`${(resScore * 100).toFixed(0)}/100`, { bold: true, bg: 'FEF2F2', color: resScore >= 0.6 ? COLOR.RED : COLOR.GREEN }),
      tc('META', { bg: 'FEF2F2', color: COLOR.RED }),
      tc('Suma ponderada de factores bajistas -> reduce el BoostPower final', { bg: 'FEF2F2' }),
    ]}),
  ];

  return [
    h3('  Indicadores Calculados e Influencia en Clasificacion'),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
    ...blank(),
  ];
}

function buildIndicatorRows(indicators, potFactors, resFactors, snap) {
  const rows = [];

  // Indicadores cuantitativos con descripcion de influencia
  const indicatorDefs = [
    { key: 'priceChange24h',  label: 'Cambio 24h',       fmt: v => fmt.sign(v),    type: 'MERCADO',
      influence: v => `Momentum ${parseFloat(v)>0 ? 'positivo (refuerza potencial)' : 'negativo (refuerza resistencia)'}` },
    { key: 'priceChange7d',   label: 'Cambio 7d',        fmt: v => fmt.sign(v),    type: 'MERCADO',
      influence: v => parseFloat(v)>5 ? 'Fuerte impulso alcista semanal' : parseFloat(v)<-5 ? 'Caida sostenida semanal' : 'Movimiento moderado' },
    { key: 'volumeChange24h', label: 'Volumen Delta 24h', fmt: v => fmt.sign(v),   type: 'MERCADO',
      influence: v => `${parseFloat(v)>20 ? 'Spike de volumen — activa volumeSurge' : 'Volumen estable — volumeSurge bajo'}` },
    { key: 'atlProximityPct', label: 'Proximidad ATL',   fmt: v => `${parseFloat(v||0).toFixed(1)}%`, type: 'POSICION',
      influence: v => parseFloat(v)<20 ? 'Muy cerca del ATL — alto atlProximity' : parseFloat(v)<50 ? 'Moderado atlProximity' : 'Lejos del ATL — bajo atlProximity' },
    { key: 'athDistancePct',  label: 'Distancia ATH',    fmt: v => `${parseFloat(v||0).toFixed(1)}%`, type: 'POSICION',
      influence: v => parseFloat(v)>80 ? 'Activo muy deprimido (refuerza leverageRatio)' : 'Cerca del ATH — menor margen de recorrido' },
    { key: 'fearGreedIndex',  label: 'Fear & Greed',     fmt: v => `${v} / 100`,   type: 'SENTIM.',
      influence: v => parseFloat(v)<30 ? 'Miedo extremo -> senal contrarian de compra' : parseFloat(v)>70 ? 'Codicia -> mayor riesgo de correccion (fearOverlap alto)' : 'Sentimiento neutral' },
    { key: 'newsCount',       label: 'Noticias 24h',     fmt: v => `${v} noticias`, type: 'SOCIAL',
      influence: v => `${parseFloat(v)>5 ? 'Alta cobertura (activa socialMomentum)' : 'Cobertura baja — socialMomentum reducido'}` },
    { key: 'newsSentiment',   label: 'Sentim. noticias', fmt: v => `${(parseFloat(v||0)*100).toFixed(0)}%`, type: 'SOCIAL',
      influence: v => `Sentimiento ${parseFloat(v||0)>=0.6 ? 'positivo (refuerza newsSentiment)' : parseFloat(v||0)<=0.4 ? 'negativo (penaliza)' : 'neutro'}` },
    { key: 'atlDaysAgo',      label: 'Dias desde ATL',   fmt: v => `${v} dias`,    type: 'TEMPORAL',
      influence: v => parseFloat(v)<30 ? 'ATL muy reciente — alto reboundRecency' : parseFloat(v)<90 ? 'Rebote moderado — reboundRecency medio' : 'ATL antiguo — bajo reboundRecency' },
  ];

  indicatorDefs.forEach(({ key, label, fmt: fmtFn, type, influence }) => {
    const v = indicators[key];
    if (v === undefined || v === null) return;
    rows.push(new TableRow({ children: [
      tc(label, { bold: true }),
      tc(fmtFn(v)),
      tc(type, { color: COLOR.PURPLE }),
      tc(influence(v), { size: 17 }),
    ]}));
  });

  // Factores de potencial calculados
  const potDefs = [
    { key: 'atlProximity',   label: 'Factor pot: atlProximity' },
    { key: 'volumeSurge',    label: 'Factor pot: volumeSurge' },
    { key: 'socialMomentum', label: 'Factor pot: socialMomentum' },
    { key: 'newsSentiment',  label: 'Factor pot: newsSentiment' },
    { key: 'reboundRecency', label: 'Factor pot: reboundRecency' },
  ];
  potDefs.forEach(({ key, label }) => {
    const v = potFactors[key];
    if (v === undefined) return;
    const score = Math.round(parseFloat(v) * 100);
    rows.push(new TableRow({ children: [
      tc(label, { bold: true }),
      tc(`${score}/100`, { color: score>=60 ? COLOR.GREEN : score>=40 ? COLOR.YELLOW : COLOR.RED }),
      tc('POTENCIAL', { color: COLOR.TEAL }),
      tc(`Contribuye al Score Potencial. ${score>=60 ? 'Senal alcista activa.' : score>=40 ? 'Senal moderada.' : 'Senal debil.'}`),
    ]}));
  });

  // Factores de resistencia calculados
  const resDefs = [
    { key: 'leverageRatio',   label: 'Factor res: leverageRatio' },
    { key: 'marketCapSize',   label: 'Factor res: marketCapSize' },
    { key: 'volatilityNoise', label: 'Factor res: volatilityNoise' },
    { key: 'fearOverlap',     label: 'Factor res: fearOverlap' },
  ];
  resDefs.forEach(({ key, label }) => {
    const v = resFactors[key];
    if (v === undefined) return;
    const score = Math.round(parseFloat(v) * 100);
    rows.push(new TableRow({ children: [
      tc(label, { bold: true }),
      tc(`${score}/100`, { color: score>=60 ? COLOR.RED : score>=40 ? COLOR.YELLOW : COLOR.GREEN }),
      tc('RESISTENCIA', { color: COLOR.RED }),
      tc(`Contribuye al Score Resistencia. ${score>=60 ? 'Alta resistencia — penaliza BoostPower.' : score>=40 ? 'Resistencia moderada.' : 'Resistencia baja.'}`),
    ]}));
  });

  return rows;
}

function buildTrendsSection(trends, assetName) {
  const sections = [
    h3(`  Google Trends — "${assetName}"`),
    kv('Período analizado', trends.period || trends.timeRange || 'últimas semanas'),
    kv('Tendencia general', trends.trend || trends.direction || '—'),
    kv('Pico de interés', trends.peak ? `${trends.peak} / 100` : '—'),
    kv('Valor medio', trends.average ? `${trends.average} / 100` : '—'),
    kv('Interpretación', trends.interpretation || trendInterpretation(trends)),
  ];
  return sections;
}

function trendInterpretation(trends) {
  if (!trends) return 'Sin datos';
  const v = trends.average || trends.current || 0;
  if (v >= 75) return 'Interés muy alto — posible pico de cobertura mediática';
  if (v >= 50) return 'Interés elevado — activo en el radar del mercado general';
  if (v >= 25) return 'Interés moderado — comunidad activa pero sin viralidad';
  return 'Interés bajo — fase de acumulación silenciosa o pérdida de relevancia';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 5 — TABLA COMPARATIVA GLOBAL
// ═══════════════════════════════════════════════════════════════════════════════

function buildComparisonTable(cycle) {
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
  const windowHrs    = ((cycle.durationMs || 43200000) / 3600000).toFixed(1);
  const n = validResults.length || 1;

  // Estadisticas de calidad de prediccion
  let cntBuena = 0, cntMedia = 0, cntNoValida = 0, cntDirOk = 0;
  validResults.forEach(r => {
    const dev = Math.abs(parseFloat(r.predictedChange||0) - parseFloat(r.actualChange||0));
    const q   = predQuality(dev);
    const dir = directionAnalysis(r.predictedChange, r.actualChange);
    if (q.label === 'BUENA')      cntBuena++;
    else if (q.label === 'MEDIA') cntMedia++;
    else                          cntNoValida++;
    if (dir.correct) cntDirOk++;
  });

  return [
    h2('Tabla Comparativa Global — Prediccion vs Real'),

    // Nota de ventana temporal
    p(`Predicciones y validaciones para la misma ventana: ${windowHrs}h  (${fmt.date(cycle.startTime)} -> ${fmt.date(cycle.completedAt)})`, {
      size: 17, color: COLOR.BLUE
    }),
    ...blank(),

    // Resumen de calidad de prediccion
    new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Direccion acertada', 'Calidad BUENA (<=1%)', 'Calidad MEDIA (1-3%)', 'No valida (>3%)'),
        new TableRow({ children: [
          tc(`${cntDirOk}/${validResults.length} (${(cntDirOk/n*100).toFixed(0)}%)`,
             { bold: true, color: cntDirOk/n >= 0.6 ? COLOR.GREEN : COLOR.RED }),
          tc(`${cntBuena}`, { bold: true, color: COLOR.GREEN }),
          tc(`${cntMedia}`, { bold: true, color: COLOR.YELLOW }),
          tc(`${cntNoValida}`, { bold: true, color: COLOR.RED }),
        ]}),
      ]
    }),
    ...blank(),

    // Tabla detallada con nuevas columnas
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Activo', 'Clase', 'BP', 'P.inicio', 'P.cierre', 'Pred.', 'Real', 'Desv.abs.', 'Direccion', 'Calidad'),
        ...validResults.map(r => {
          const predicted = parseFloat(r.predictedChange || 0);
          const actual    = parseFloat(r.actualChange    || 0);
          const absDev    = Math.abs(predicted - actual);
          const dir       = directionAnalysis(predicted, actual);
          const qual      = predQuality(absDev);

          return new TableRow({ children: [
            tc(`${r.name || r.symbol} (${r.symbol?.toUpperCase()})`),
            tc(r.classification || '—', { color: classColor(r.classification), bold: true }),
            tc(fmt.score(r.boostPower), { color: (r.boostPower || 0) > 0.6 ? COLOR.GREEN : COLOR.YELLOW }),
            tc(fmt.price(r.snapshotPrice || 0)),
            tc(fmt.price(r.currentPrice  || 0)),
            tc(fmt.sign(r.predictedChange), { color: changeColor(r.predictedChange) }),
            tc(fmt.sign(r.actualChange),    { bold: true, color: changeColor(r.actualChange) }),
            tc(fmt.pct(absDev), { color: qual.color }),
            tc(dir.label, { color: dir.correct ? COLOR.GREEN : COLOR.RED, bold: true }),
            tc(qual.label, { bold: true, color: qual.color, bg: qual.bg }),
          ]});
        }),
      ]
    }),
    ...blank(),

    // Leyenda de criterios
    p('Criterios de validacion de prediccion:', { bold: true, size: 19 }),
    p('  BUENA: desviacion absoluta <= 1% entre prediccion y movimiento real', { size: 17, color: COLOR.GREEN }),
    p('  MEDIA: desviacion absoluta entre 1% y 3% — prediccion orientativa', { size: 17, color: COLOR.YELLOW }),
    p('  NO VALIDA: desviacion > 3% — la prediccion no refleja el movimiento real', { size: 17, color: COLOR.RED }),
    p('  Direccion: se evalua independientemente de la magnitud (sube/sube o baja/baja = acertado)', { size: 17, color: COLOR.GRAY }),
    ...blank(),

    // Metricas por categoria
    h3('Metricas por Categoria'),
    buildCategoryMetricsTable(cycle.metrics),
    ...blank(2),
  ];
}

function buildCategoryMetricsTable(metrics) {
  const cats = ['invertible', 'apalancado', 'ruidoso'];
  return new Table({
    width: { size: 80, type: WidthType.PERCENTAGE },
    rows: [
      headerRow('Categoría', 'Total', 'Correctas', 'Tasa acierto', 'Error promedio'),
      ...cats.map(cat => {
        const d = metrics?.[cat];
        if (!d || !d.total) return new TableRow({ children: [
          tc(cat.toUpperCase()), tc('0'), tc('0'), tc('—'), tc('—')
        ]});
        const acc = parseFloat(d.successRate || 0);
        return new TableRow({ children: [
          tc(cat.toUpperCase(), { bold: true, color: classColor(cat.toUpperCase()) }),
          tc(d.total),
          tc(d.correct),
          tc(fmt.pct(d.successRate), { bold: true, color: acc >= 60 ? COLOR.GREEN : acc >= 40 ? COLOR.YELLOW : COLOR.RED }),
          tc(fmt.pct(d.avgError)),
        ]});
      }),
    ]
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 6 — PARÁMETROS DEL ALGORITMO DE COMPRA/VENTA
// ═══════════════════════════════════════════════════════════════════════════════

function buildInvestParamsSection(cycle, investConfig) {
  const ic = investConfig || {};
  return [
    h2('Parámetros del Algoritmo de Compra/Venta'),
    p('Configuración del módulo de inversión durante el período de este ciclo.', { color: COLOR.GRAY, size: 18 }),
    ...blank(),
    new Table({
      width: { size: 80, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Parámetro', 'Valor', 'Descripción'),
        new TableRow({ children: [tc('Modo operación'), tc(ic.mode || 'simulated', { bold: true }), tc('simulated / testnet / real')] }),
        new TableRow({ children: [tc('Exchange'), tc(ic.exchange || '—'), tc('Plataforma de ejecución')] }),
        new TableRow({ children: [tc('Capital total'), tc(ic.capitalTotal ? `$${ic.capitalTotal}` : '—'), tc('Capital disponible para el módulo')] }),
        new TableRow({ children: [tc('Capital por posición (%)'), tc(ic.capitalPerTrade ? fmt.pct(ic.capitalPerTrade * 100) : '—'), tc('Porcentaje del capital por operación')] }),
        new TableRow({ children: [tc('Stop Loss'), tc(ic.stopLossPercent ? fmt.pct(ic.stopLossPercent) : '—'), tc('Pérdida máxima tolerada por posición')] }),
        new TableRow({ children: [tc('Take Profit'), tc(ic.takeProfitPercent ? fmt.pct(ic.takeProfitPercent) : '—'), tc('Beneficio objetivo por posición')] }),
        new TableRow({ children: [tc('Max posiciones abiertas'), tc(ic.maxPositions || '—'), tc('Límite de posiciones simultáneas')] }),
        new TableRow({ children: [tc('Trailing Stop'), tc(ic.trailingStop ? 'Sí' : 'No'), tc('Ajuste dinámico del stop-loss')] }),
      ]
    }),
    ...blank(2),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 7 — CONCLUSIONES POR ACTIVO (RAZONAMIENTO INDIVIDUAL)
// ═══════════════════════════════════════════════════════════════════════════════

function buildAssetConclusions(cycle) {
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));

  const sections = [
    h2('Conclusiones por Activo — Razonamiento Individual'),
    p('Analisis con clasificacion de calidad (Buena/Media/No valida) y direccion acertada/fallada.', { color: COLOR.GRAY, size: 18 }),
    ...blank(),
  ];

  validResults.forEach((result, i) => {
    const predicted = parseFloat(result.predictedChange || 0);
    const actual    = parseFloat(result.actualChange    || 0);
    const cat       = result.classification || 'RUIDOSO';
    const absDev    = Math.abs(predicted - actual);
    const dir       = directionAnalysis(predicted, actual);
    const qual      = predQuality(absDev);

    const reasoning = generateAssetReasoning(result, predicted, actual, absDev, cat, dir, qual);

    sections.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `${i + 1}. ${result.name || result.symbol?.toUpperCase()} `, bold: true, size: 22 }),
          new TextRun({ text: `[${cat}]`, bold: true, size: 20, color: classColor(cat) }),
          new TextRun({ text: `  Dir: ${dir.correct ? '[OK]' : '[FALLO]'} ${dir.arrow}`, bold: true, size: 20, color: dir.correct ? COLOR.GREEN : COLOR.RED }),
          new TextRun({ text: `  Calidad: ${qual.label}`, bold: true, size: 20, color: qual.color }),
        ]
      }),
      ...reasoning.map(line => new Paragraph({
        spacing: { after: 40 },
        indent: { left: convertInchesToTwip(0.3) },
        children: [new TextRun({ text: line, size: 18, color: COLOR.DARK })]
      })),
      ...blank(),
    );
  });

  return sections;
}

function generateAssetReasoning(result, predicted, actual, absDev, cat, dir, qual) {
  const lines = [];
  const bd         = result.breakdown || {};
  const indicators = bd.indicators   || {};

  lines.push(`Prediccion: ${fmt.sign(predicted)} -> Real: ${fmt.sign(actual)} -> Desviacion absoluta: ${fmt.pct(absDev)}`);

  // Direccion
  if (dir.correct) {
    lines.push(`OK Direccion acertada: ${dir.label}`);
  } else {
    lines.push(`FALLO Direccion fallada: ${dir.label} — el mercado se movio en sentido contrario.`);
  }

  // Calidad de la prediccion
  if (qual.label === 'BUENA') {
    lines.push(`Calidad BUENA (desv. <=1%): la prediccion reflejo el movimiento real con alta precision.`);
  } else if (qual.label === 'MEDIA') {
    lines.push(`Calidad MEDIA (desv. 1-3%): prediccion orientativa. La magnitud divergio ${fmt.pct(absDev)} del real.`);
  } else {
    lines.push(`Calidad NO VALIDA (desv. >3%): la prediccion no refleja adecuadamente el movimiento real (${fmt.pct(absDev)} de desviacion).`);
  }

  // Analisis por categoria
  if (cat === 'INVERTIBLE') {
    if (!dir.correct) {
      lines.push(`Senal falsa INVERTIBLE: el BoostPower indicaba potencial alcista pero factores externos dominaron. Revisar pesos atlProximity/socialMomentum.`);
    } else if (qual.label === 'NO VALIDA') {
      lines.push(`INVERTIBLE con direccion correcta pero magnitud muy alejada. Considerar ajustar invertibleTarget o escala temporal.`);
    } else {
      lines.push(`INVERTIBLE bien identificado. ${qual.label === 'BUENA' ? 'Modelo muy bien calibrado para este activo.' : 'Calibracion aceptable, margen de mejora en magnitud.'}`);
    }
  } else if (cat === 'APALANCADO') {
    if (!dir.correct) {
      lines.push(`APALANCADO con error de direccion. Revisar fearOverlap y volatilityNoise — mayor sensibilidad al sentimiento.`);
    } else if (qual.label === 'NO VALIDA') {
      lines.push(`APALANCADO: la alta volatilidad puede explicar la gran desviacion de magnitud. Considerar ampliar tolerancia para esta clase.`);
    }
  } else if (cat === 'RUIDOSO') {
    if (qual.label === 'NO VALIDA') {
      lines.push(`RUIDOSO con movimiento significativo inesperado. El activo supero el umbral de ruido esperado. Revisar volatilityNoise.`);
    }
  }

  // Contexto de indicadores disponibles
  if (indicators.fearGreedIndex !== undefined) {
    lines.push(`Contexto macro: Fear & Greed = ${indicators.fearGreedIndex} (${indicators.fearGreedLabel || '—'})`);
  }
  if (indicators.atlDaysAgo !== undefined) {
    lines.push(`ATL hace ${indicators.atlDaysAgo} dias — reboundRecency ${indicators.atlDaysAgo < 30 ? 'muy activo' : indicators.atlDaysAgo < 90 ? 'moderado' : 'bajo'}`);
  }
  if (indicators.newsSentiment !== undefined) {
    lines.push(`Sentimiento noticias: ${(parseFloat(indicators.newsSentiment)*100).toFixed(0)}% — ${parseFloat(indicators.newsSentiment)>=0.6 ? 'positivo' : parseFloat(indicators.newsSentiment)<=0.4 ? 'negativo' : 'neutro'}`);
  }

  lines.push(`Razon tecnica registrada: ${result.validationReason || '—'}`);
  return lines.map(l => `• ${l}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 8 — CONCLUSIONES GENERALES + "LOS 3 SABIOS" (LLM)
// ═══════════════════════════════════════════════════════════════════════════════

function buildLLMConclusions(llmResponses, consensus, cycle) {
  const sections = [
    h2('Conclusiones Generales — "Los 3 Sabios Recomiendan"'),
    p('Análisis de consenso generado por los modelos de IA configurados a partir de los datos de este ciclo.', { color: COLOR.GRAY, size: 18 }),
    ...blank(),
  ];

  if (!llmResponses || Object.keys(llmResponses).length === 0) {
    sections.push(
      p('⚠️  No hay API keys de LLM configuradas. Configura al menos 2 modelos (Mistral, Cohere, Cerebras, etc.) en la pestaña APIs para obtener conclusiones automáticas de IA.', { color: COLOR.ORANGE, size: 19 }),
      ...blank(),
    );
    sections.push(...buildAutoConclusions(cycle));
    return sections;
  }

  // Tabla de respuestas de cada modelo
  sections.push(h3('Respuestas individuales de los modelos'));
  const models = Object.entries(llmResponses);
  models.forEach(([modelName, resp]) => {
    if (!resp) return;
    sections.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `🤖 ${modelName}: `, bold: true, size: 20 }),
          new TextRun({ text: resp.success ? '✓ Respuesta obtenida' : `✗ ${resp.error || 'Sin respuesta'}`, color: resp.success ? COLOR.GREEN : COLOR.RED, size: 18 }),
        ]
      })
    );
    if (resp.success && resp.assessment) {
      sections.push(new Paragraph({
        indent: { left: convertInchesToTwip(0.3) },
        spacing: { after: 100 },
        children: [new TextRun({ text: resp.assessment, size: 18, color: COLOR.DARK })]
      }));
    }
  });

  sections.push(...blank());

  // Consenso
  if (consensus?.hasConsensus) {
    sections.push(
      h3(`Consenso de ${consensus.modelsUsed} modelos`),
      p(`Modelos participantes: ${(consensus.modelNames || []).join(', ')}`, { color: COLOR.GRAY, size: 17 }),
      ...blank(),
    );

    // Ajustes sugeridos en tabla
    if (consensus.consensus) {
      sections.push(h3('Ajustes sugeridos por consenso IA'));
      sections.push(...buildConsensusAdjustmentsTable(consensus.consensus));
    }

    // Razonamiento del consenso
    const successResp = models.find(([, r]) => r?.success && r?.reasoning);
    if (successResp) {
      sections.push(
        h3('Razonamiento del consenso'),
        new Paragraph({
          indent: { left: convertInchesToTwip(0.3) },
          spacing: { after: 200 },
          children: [new TextRun({ text: successResp[1].reasoning, size: 18 })]
        }),
      );
    }
  } else {
    sections.push(
      p('⚠️  Consenso no alcanzado: se necesitan al menos 2 modelos con respuesta exitosa.', { color: COLOR.YELLOW }),
      ...blank(),
      ...buildAutoConclusions(cycle),
    );
  }

  return sections;
}

function buildConsensusAdjustmentsTable(consensus) {
  const rows = [headerRow('Componente', 'Parámetro', 'Valor sugerido por IA')];

  const sections = [
    { key: 'metaWeights',       label: 'Meta-pesos' },
    { key: 'classification',    label: 'Clasificación' },
    { key: 'prediction',        label: 'Predicción' },
    { key: 'potentialWeights',  label: 'Factores Potencial' },
    { key: 'resistanceWeights', label: 'Factores Resistencia' },
  ];

  sections.forEach(s => {
    const block = consensus[s.key];
    if (!block || Object.keys(block).length === 0) return;
    Object.entries(block).forEach(([param, val]) => {
      rows.push(new TableRow({ children: [
        tc(s.label),
        tc(param),
        tc(typeof val === 'number' && val <= 1 ? fmt.weight(val) : String(val), { bold: true, color: COLOR.PURPLE }),
      ]}));
    });
  });

  if (rows.length === 1) {
    rows.push(new TableRow({ children: [tc('Sin ajustes sugeridos por consenso', { colspan: 3, color: COLOR.GRAY })] }));
  }

  return [new Table({ width: { size: 80, type: WidthType.PERCENTAGE }, rows }), ...blank()];
}

function buildAutoConclusions(cycle) {
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
  const acc  = parseFloat(cycle.metrics?.successRate || 0);
  const mode = cycle.mode || 'normal';
  const lines = [];

  lines.push(`Ciclo de ${fmt.dur(cycle.durationMs || 0)} — Modelo ${mode === 'speculative' ? 'Especulativo' : 'Generalista'}.`);
  lines.push(`Tasa de acierto global: ${fmt.pct(acc)} sobre ${validResults.length} activos analizados.`);

  if (acc >= 70) lines.push('▶ El algoritmo funcionó bien en este ciclo. Los pesos actuales parecen bien calibrados para las condiciones de mercado dadas.');
  else if (acc >= 50) lines.push('▶ Rendimiento moderado. Revisar los factores con mayor error y considerar ajustes en los pesos de clasificación.');
  else lines.push('▶ Rendimiento bajo. Se recomienda revisar la calibración del modelo antes del siguiente ciclo.');

  const invAcc = parseFloat(cycle.metrics?.invertible?.successRate || 0);
  if (cycle.metrics?.invertible?.total >= 2) {
    lines.push(`▶ INVERTIBLE: ${fmt.pct(invAcc)} acierto — ${invAcc >= 60 ? 'bien calibrado' : 'revisar umbral invertibleMinBoost y target de predicción'}.`);
  }

  return lines.map(l => new Paragraph({
    spacing: { after: 80 },
    indent: { left: convertInchesToTwip(0.3) },
    children: [new TextRun({ text: l, size: 18 })]
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECCIÓN 9 — RECOMENDACIONES DE AJUSTE DE PESOS
// ═══════════════════════════════════════════════════════════════════════════════

function buildRecommendations(cycle, config, consensus) {
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
  const mode = cycle.mode || 'normal';
  const recs = generateRecommendations(validResults, config, cycle.metrics, consensus);

  return [
    h2('Recomendaciones de Ajuste de Pesos y Parámetros'),
    p(`Propuestas de mejora del algoritmo basadas en los resultados de este ciclo — Modelo ${mode === 'speculative' ? 'Especulativo' : 'Generalista'}.`, { color: COLOR.GRAY, size: 18 }),
    ...blank(),

    // Tabla de recomendaciones
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow('Área', 'Situación actual', 'Recomendación', 'Prioridad'),
        ...recs.map(r => new TableRow({ children: [
          tc(r.area, { bold: true }),
          tc(r.current),
          tc(r.recommendation),
          tc(r.priority, { bold: true, color: r.priority === 'Alta' ? COLOR.RED : r.priority === 'Media' ? COLOR.YELLOW : COLOR.GREEN }),
        ]}))
      ]
    }),
    ...blank(),

    p('Nota: Estas recomendaciones son orientativas. Aplica los cambios gradualmente y valida con nuevos ciclos antes de ajustes más agresivos.', { color: COLOR.GRAY, size: 17 }),
    ...blank(2),
  ];
}

function generateRecommendations(results, config, metrics, consensus) {
  const recs = [];
  const cl = config.classification || {};
  const pr = config.prediction || {};

  const invAcc   = parseFloat(metrics?.invertible?.successRate || 0);
  const apalAcc  = parseFloat(metrics?.apalancado?.successRate || 0);
  const ruidAcc  = parseFloat(metrics?.ruidoso?.successRate || 0);
  const avgError = parseFloat(metrics?.avgError || 0);
  const invCount = metrics?.invertible?.total || 0;

  // INVERTIBLE accuracy
  if (invCount >= 2 && invAcc < 40) {
    recs.push({ area: 'INVERTIBLE — Umbral', current: `invertibleMinBoost = ${fmt.weight(cl.invertibleMinBoost)}`, recommendation: `Aumentar a ${fmt.weight(Math.min(0.80, (cl.invertibleMinBoost || 0.65) + 0.05))} para filtrar señales débiles`, priority: 'Alta' });
  } else if (invCount >= 2 && invAcc > 85) {
    recs.push({ area: 'INVERTIBLE — Umbral', current: `invertibleMinBoost = ${fmt.weight(cl.invertibleMinBoost)}`, recommendation: `Bajar ligeramente a ${fmt.weight(Math.max(0.50, (cl.invertibleMinBoost || 0.65) - 0.03))} para capturar más oportunidades`, priority: 'Baja' });
  }

  // Error de magnitud
  if (avgError > 15) {
    recs.push({ area: 'Target de predicción', current: `invertibleTarget = ${pr.invertibleTarget || 30}%`, recommendation: `Reducir a ${Math.max(15, (pr.invertibleTarget || 30) - 5)}% — las predicciones sobreestiman el movimiento`, priority: 'Alta' });
  } else if (avgError < 3 && invAcc > 70) {
    recs.push({ area: 'Target de predicción', current: `invertibleTarget = ${pr.invertibleTarget || 30}%`, recommendation: `Puedes aumentar a ${(pr.invertibleTarget || 30) + 3}% — el modelo es conservador y hay margen`, priority: 'Media' });
  }

  // Tolerancia de magnitud
  if (avgError > 10 && avgError < 20) {
    recs.push({ area: 'Tolerancia de magnitud', current: `magnitudeTolerance = ±${pr.magnitudeTolerance || 5}%`, recommendation: `Aumentar a ±${(pr.magnitudeTolerance || 5) + 2}% para reducir falsos negativos`, priority: 'Media' });
  }

  // Resultados por dirección incorrecta
  const wrongDir = results.filter(r => {
    const p = parseFloat(r.predictedChange || 0);
    const a = parseFloat(r.actualChange || 0);
    return !r.correct && ((p > 0 && a < 0) || (p < 0 && a > 0));
  });
  if (wrongDir.length >= 2) {
    recs.push({ area: 'Social Momentum', current: `peso actual en pesos de potencial`, recommendation: 'Aumentar peso de newsSentiment y reducir reboundRecency — hay errores de dirección sistemáticos', priority: 'Alta' });
    recs.push({ area: 'Fear & Greed', current: `fearOverlap en resistencia`, recommendation: 'Aumentar peso de fearOverlap si los errores de dirección coinciden con FGI > 70', priority: 'Media' });
  }

  // Consenso IA
  if (consensus?.hasConsensus && consensus.consensus?.metaWeights) {
    const mw = consensus.consensus.metaWeights;
    if (mw.potential !== undefined || mw.resistance !== undefined) {
      recs.push({ area: 'Meta-pesos (IA)', current: `potential=${fmt.weight(config.metaWeights?.potential)}, resistance=${fmt.weight(config.metaWeights?.resistance)}`, recommendation: `IA sugiere: potential=${fmt.weight(mw.potential)}, resistance=${fmt.weight(mw.resistance)}`, priority: 'Media' });
    }
  }

  if (recs.length === 0) {
    recs.push({ area: 'General', current: 'Configuración actual', recommendation: 'El algoritmo está bien calibrado para este ciclo. Mantener y validar con más ciclos.', priority: 'Baja' });
  }

  return recs;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROMPT PARA LLMs — ESPECÍFICO PARA EL INFORME DE CICLO
// ═══════════════════════════════════════════════════════════════════════════════

function buildCycleReportPrompt(cycle, config) {
  const mode = cycle.mode || 'normal';
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
  const acc = cycle.metrics?.successRate || '0';

  const assetSummaries = validResults.map(r => ({
    symbol:     r.symbol,
    cat:        r.classification,
    boostPower: Math.round((r.boostPower || 0) * 100),
    predicted:  r.predictedChange,
    actual:     r.actualChange,
    error:      r.error,
    correct:    r.correct,
    reason:     r.validationReason,
  }));

  return `Eres un experto en análisis cuantitativo de algoritmos de predicción de activos cripto.
Analiza los resultados del siguiente ciclo de ejecución y proporciona conclusiones accionables.

## CICLO
- Modo: ${mode === 'speculative' ? 'Especulativo (micro-caps)' : 'Generalista (top caps)'}
- Duración: ${fmt.dur(cycle.durationMs || 0)}
- Activos analizados: ${validResults.length}
- Tasa de acierto: ${acc}%
- Error promedio: ${cycle.metrics?.avgError || 0}%
- INVERTIBLE: ${cycle.metrics?.invertible?.successRate || 0}% acierto (${cycle.metrics?.invertible?.total || 0} activos)
- APALANCADO: ${cycle.metrics?.apalancado?.successRate || 0}% acierto (${cycle.metrics?.apalancado?.total || 0} activos)
- RUIDOSO: ${cycle.metrics?.ruidoso?.successRate || 0}% acierto (${cycle.metrics?.ruidoso?.total || 0} activos)

## CONFIGURACIÓN ACTIVA (pesos del algoritmo)
- Meta-pesos: potencial=${config.metaWeights?.potential}, resistencia=${config.metaWeights?.resistance}
- Clasificación: invertibleMinBoost=${config.classification?.invertibleMinBoost}, apalancadoMinBoost=${config.classification?.apalancadoMinBoost}
- Predicción: invertibleTarget=${config.prediction?.invertibleTarget}%, tolerancia=±${config.prediction?.magnitudeTolerance}%
- Pesos potencial: ${JSON.stringify(config.potentialWeights || {})}
- Pesos resistencia: ${JSON.stringify(config.resistanceWeights || {})}

## RESULTADOS POR ACTIVO
${JSON.stringify(assetSummaries, null, 2)}

## TU TAREA
Analiza estos resultados y devuelve SOLO JSON válido sin markdown con esta estructura:

{
  "overallAssessment": "Evaluación global del ciclo en 2-3 líneas",
  "suggestedAdjustments": {
    "metaWeights": { "potential": 0.XX, "resistance": 0.XX },
    "classification": { "invertibleMinBoost": 0.XX, "apalancadoMinBoost": 0.XX },
    "prediction": { "invertibleTarget": XX, "magnitudeTolerance": XX },
    "potentialWeights": { "atlProximity": 0.XX, "volumeSurge": 0.XX, "socialMomentum": 0.XX, "newsSentiment": 0.XX, "reboundRecency": 0.XX },
    "resistanceWeights": { "leverageRatio": 0.XX, "marketCapSize": 0.XX, "volatilityNoise": 0.XX, "fearOverlap": 0.XX }
  },
  "reasoning": "Explicación de 3-4 líneas de los ajustes sugeridos basada en los errores observados",
  "expectedImpact": "Mejora esperada en accuracy si se aplican los ajustes"
}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLAMADAS LLM (para el informe)
// ═══════════════════════════════════════════════════════════════════════════════

async function callLLMsForReport(prompt, apiKeys) {
  const calls = {};

  async function tryCall(name, fn) {
    try { calls[name] = await fn(); }
    catch (e) { calls[name] = { success: false, model: name, error: e.message }; }
  }

  await Promise.allSettled([
    apiKeys.gemini   && tryCall('Gemini',   () => callGemini(prompt, apiKeys.gemini)),
    apiKeys.claude   && tryCall('Claude',   () => callClaude(prompt, apiKeys.claude)),
    apiKeys.openai   && tryCall('OpenAI',   () => callOpenAI(prompt, apiKeys.openai)),
    apiKeys.groq     && tryCall('Llama',    () => callGroq(prompt, apiKeys.groq)),
    apiKeys.mistral  && tryCall('Mistral',  () => callMistral(prompt, apiKeys.mistral)),
    apiKeys.cohere   && tryCall('Cohere',   () => callCohere(prompt, apiKeys.cohere)),
    apiKeys.cerebras && tryCall('Cerebras', () => callCerebras(prompt, apiKeys.cerebras)),
  ].filter(Boolean));

  return calls;
}

function parseJSON(text, model) {
  try {
    const clean = text.trim().replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
    const parsed = JSON.parse(clean);
    if (!parsed.suggestedAdjustments) throw new Error('Missing suggestedAdjustments');
    return { success: true, model, assessment: parsed.overallAssessment || '', adjustments: parsed.suggestedAdjustments, reasoning: parsed.reasoning || '', expectedImpact: parsed.expectedImpact || '' };
  } catch(e) { return { success: false, model, error: `Parse failed: ${e.message}`, rawResponse: text.slice(0, 300) }; }
}

function extractError(err) { return err.response?.data?.error?.message || err.response?.data?.message || err.response?.data?.detail || err.message; }

async function callGemini(prompt, key) {
  for (const model of ['gemini-2.0-flash','gemini-1.5-flash-latest']) {
    try {
      const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } }, { timeout: 30000 });
      const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const result = parseJSON(text, 'Gemini');
      if (result.success) return result;
    } catch(e) { if (e.response?.status === 404) continue; return { success: false, model: 'Gemini', error: extractError(e) }; }
  }
  return { success: false, model: 'Gemini', error: 'No model available' };
}

async function callClaude(prompt, key) {
  for (const model of ['claude-sonnet-4-5','claude-3-5-sonnet-20241022']) {
    try {
      const r = await axios.post('https://api.anthropic.com/v1/messages',
        { model, max_tokens: 2048, temperature: 0.3, messages: [{ role: 'user', content: prompt }] },
        { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 30000 });
      const text = r.data?.content?.[0]?.text || '';
      return parseJSON(text, 'Claude');
    } catch(e) { const s = e.response?.status; if (s === 400) continue; return { success: false, model: 'Claude', error: extractError(e) }; }
  }
  return { success: false, model: 'Claude', error: 'No model available' };
}

async function callOpenAI(prompt, key) {
  for (const model of ['gpt-4o', 'gpt-4o-mini']) {
    try {
      const r = await axios.post('https://api.openai.com/v1/chat/completions',
        { model, messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 },
        { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 });
      return parseJSON(r.data?.choices?.[0]?.message?.content || '', 'OpenAI');
    } catch(e) { const s = e.response?.status; if (s === 429 || s === 404) continue; return { success: false, model: 'OpenAI', error: extractError(e) }; }
  }
  return { success: false, model: 'OpenAI', error: 'No quota available' };
}

async function callGroq(prompt, key) {
  try {
    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions',
      { model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 },
      { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    return parseJSON(r.data?.choices?.[0]?.message?.content || '', 'Llama');
  } catch(e) { return { success: false, model: 'Llama', error: extractError(e) }; }
}

async function callMistral(prompt, key) {
  try {
    const r = await axios.post('https://api.mistral.ai/v1/chat/completions',
      { model: 'mistral-small-latest', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 },
      { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    return parseJSON(r.data?.choices?.[0]?.message?.content || '', 'Mistral');
  } catch(e) { return { success: false, model: 'Mistral', error: extractError(e) }; }
}

async function callCohere(prompt, key) {
  try {
    const r = await axios.post('https://api.cohere.com/v1/chat',
      { model: 'command-r', message: prompt, temperature: 0.3, max_tokens: 2048, preamble: 'Responde solo en JSON válido.' },
      { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    return parseJSON(r.data?.text || '', 'Cohere');
  } catch(e) { return { success: false, model: 'Cohere', error: extractError(e) }; }
}

async function callCerebras(prompt, key) {
  try {
    const r = await axios.post('https://api.cerebras.ai/v1/chat/completions',
      { model: 'llama-3.3-70b', messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 2048 },
      { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    return parseJSON(r.data?.choices?.[0]?.message?.content || '', 'Cerebras');
  } catch(e) { return { success: false, model: 'Cerebras', error: extractError(e) }; }
}

function calculateConsensus(responses) {
  const successful = Object.values(responses).filter(r => r?.success);
  if (successful.length < 2) return { hasConsensus: false, modelsUsed: successful.length };
  const consensus = { metaWeights: {}, classification: {}, prediction: {}, potentialWeights: {}, resistanceWeights: {} };
  Object.keys(consensus).forEach(cat => {
    const allKeys = new Set();
    successful.forEach(r => { if (r.adjustments?.[cat]) Object.keys(r.adjustments[cat]).forEach(k => allKeys.add(k)); });
    allKeys.forEach(key => {
      const vals = successful.map(r => r.adjustments?.[cat]?.[key]).filter(v => v !== undefined && !isNaN(Number(v)));
      if (vals.length >= 2) consensus[cat][key] = Math.round(vals.reduce((s,v) => s + Number(v), 0) / vals.length * 100) / 100;
    });
  });
  return { hasConsensus: true, consensus, modelsUsed: successful.length, modelNames: successful.map(r => r.model) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL — ASYNC
// ═══════════════════════════════════════════════════════════════════════════════

async function generateEnhancedReport(cycle, allSnapshot, config, apiKeys = {}, investConfig = {}) {
  // Llamar LLMs en paralelo mientras se prepara el doc
  const prompt       = buildCycleReportPrompt(cycle, config);
  const llmResponses = await callLLMsForReport(prompt, apiKeys);
  const consensus    = calculateConsensus(llmResponses);

  const doc = new Document({
    creator:     'Crypto Detector',
    title:       `Informe de Ciclo ${cycle.id}`,
    description: `Análisis paramétrico — Modelo ${cycle.mode || 'normal'}`,
    sections: [{
      properties: {},
      children: [
        // 1. Portada
        ...buildCover(cycle, config),
        br(),

        // 2. Configuración del algoritmo
        ...buildConfigSection(config, cycle.mode || 'normal'),

        // 3. Contexto de mercado
        ...buildMarketContext(cycle),

        // 4. Análisis por activo
        ...buildPerAssetSection(cycle, allSnapshot),
        br(),

        // 5. Tabla comparativa global
        ...buildComparisonTable(cycle),
        br(),

        // 6. Parámetros compra/venta
        ...buildInvestParamsSection(cycle, investConfig),

        // 7. Conclusiones por activo
        ...buildAssetConclusions(cycle),
        br(),

        // 8. Conclusiones LLM
        ...buildLLMConclusions(llmResponses, consensus, cycle),
        br(),

        // 9. Recomendaciones
        ...buildRecommendations(cycle, config, consensus),

        // Pie
        sep(),
        p(`Informe generado automáticamente por Crypto Detector · ${fmt.date(Date.now())}`, { color: COLOR.GRAY, size: 16, spacing: { before: 200 } }),
      ]
    }]
  });

  return doc;
}

module.exports = { generateEnhancedReport };
