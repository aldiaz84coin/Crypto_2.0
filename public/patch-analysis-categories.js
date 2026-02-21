/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: Análisis de Simulaciones — Categoría INVERTIBLE siempre visible
 *
 *  INSTALACIÓN:
 *  Añadir al final del <body> en public/index.html, después de los
 *  otros parches existentes:
 *
 *    <script src="/patch-llm-keys.js"></script>
 *    <script src="/patch-pump-sources.js"></script>
 *    <script src="/patch-analysis-categories.js"></script>  ← esta línea
 *
 * ══════════════════════════════════════════════════════════════════
 *  PROBLEMA QUE CORRIGE:
 *  El backend solo incluye una categoría en `d.analysis` cuando tiene
 *  al menos 1 muestra. Si ningún activo fue clasificado como INVERTIBLE
 *  en los ciclos significativos, `d.analysis.INVERTIBLE` no existe y
 *  el frontend lo omite silenciosamente con `if (!a) return`.
 *
 *  SOLUCIÓN:
 *  1. Siempre renderiza las 3 categorías (INVERTIBLE, APALANCADO, RUIDOSO)
 *  2. Muestra estado "Sin muestras" con explicación cuando una categoría
 *     no tiene datos, en vez de desaparecer
 *  3. Añade diagnóstico del umbral activo (invertibleMinBoost) para que
 *     el usuario entienda por qué no se generan INVERTIBLEs
 *  4. Muestra barra de progreso de accuracy + desglose correcto/incorrecto
 *  5. Añade tabla de distribución de clasificaciones del último ciclo
 * ══════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuración visual de categorías
// ─────────────────────────────────────────────────────────────────────────────
const CAT_META = {
  INVERTIBLE: {
    icon:        '🟢',
    label:       'INVERTIBLE',
    color:       'green',
    borderColor: '#16a34a',
    bgColor:     '#052e16',
    textColor:   '#4ade80',
    desc:        'Activos con alto potencial de rebote y condiciones estructurales favorables',
    thresholdKey: 'invertibleMinBoost',
    thresholdLabel: 'invertibleMinBoost',
    zeroHint:    'Para aparecer aquí, un activo necesita BoostPower ≥ {threshold} + market cap bajo + precio cerca del ATL.',
  },
  APALANCADO: {
    icon:        '🟡',
    label:       'APALANCADO',
    color:       'yellow',
    borderColor: '#ca8a04',
    bgColor:     '#1c1a00',
    textColor:   '#facc15',
    desc:        'Señal positiva pero con presión vendedora estructural que limita el recorrido',
    thresholdKey: 'apalancadoMinBoost',
    thresholdLabel: 'apalancadoMinBoost',
    zeroHint:    'Ningún activo tuvo señal moderada (BoostPower ≥ {threshold}) en los ciclos analizados.',
  },
  RUIDOSO: {
    icon:        '⚪',
    label:       'RUIDOSO',
    color:       'gray',
    borderColor: '#475569',
    bgColor:     '#0f172a',
    textColor:   '#94a3b8',
    desc:        'Sin catalizador claro ni señal convergente en este ciclo',
    thresholdKey: null,
    thresholdLabel: null,
    zeroHint:    'Todos los activos tuvieron algún nivel de señal, lo que es inusual.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Override de renderAnalysis
// ─────────────────────────────────────────────────────────────────────────────
window.renderAnalysis = function(d) {
  const div = document.getElementById('analysis-content');
  if (!div) return;

  // Sin simulaciones significativas
  if (!d.hasSignificant) {
    div.innerHTML = `
      <div class="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <p class="text-yellow-400 font-semibold mb-2">⚠️ Sin simulaciones significativas</p>
        <p class="text-gray-400 text-sm">${d.message}</p>
        ${d.testingCount > 0
          ? `<p class="text-gray-500 text-sm mt-2">${d.testingCount} simulación(es) de testing (&lt;6h) detectadas — no calibran el algoritmo.</p>`
          : ''}
        <div class="mt-4 p-3 bg-blue-950 border border-blue-800 rounded-lg">
          <p class="text-xs text-blue-300">💡 Para obtener análisis de rendimiento por categoría, completa al menos 1 ciclo de duración ≥ 6 horas.</p>
        </div>
      </div>`;
    return;
  }

  const modeLabel  = d.mode === 'speculative' ? 'Especulativo' : 'Generalista';
  const modeColor  = d.mode === 'speculative' ? 'yellow' : 'blue';
  const accFloat   = parseFloat(d.overallAccuracy || 0);
  const accColor   = accFloat > 60 ? 'text-green-400' : accFloat > 40 ? 'text-yellow-400' : 'text-red-400';
  const accBarColor= accFloat > 60 ? '#22c55e' : accFloat > 40 ? '#f59e0b' : '#ef4444';

  // Extraer umbrales del config embebido en la respuesta (si existe)
  const cfg = d.config || {};
  const invertibleThresh = cfg.classification?.invertibleMinBoost  ?? (d.mode === 'speculative' ? 0.60 : 0.68);
  const apalancadoThresh = cfg.classification?.apalancadoMinBoost  ?? (d.mode === 'speculative' ? 0.35 : 0.42);

  const thresholds = {
    INVERTIBLE: invertibleThresh,
    APALANCADO: apalancadoThresh,
    RUIDOSO:    null,
  };

  // ── Cabecera ───────────────────────────────────────────────────────────────
  let html = `
    <div class="bg-gray-900 border border-${modeColor}-900 rounded-xl p-4 mb-4">
      <p class="text-sm text-gray-400 mb-2">📋 Fuente de datos</p>
      <p class="text-sm text-${modeColor}-300">
        <span class="font-bold">${d.cyclesThisMode || 0}</span> ciclos del modelo
        <span class="font-bold">${modeLabel}</span>
        · ${d.significantCount} significativos ≥6h · ${d.testingCount} de testing &lt;6h
      </p>
      ${d.note ? `<p class="text-xs text-gray-500 mt-1">${d.note}</p>` : ''}
    </div>

    <!-- KPIs globales -->
    <div class="grid grid-cols-3 gap-3 mb-4">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
        <div class="text-2xl font-bold ${accColor} mono">${d.overallAccuracy ?? '—'}%</div>
        <div class="text-xs text-gray-500 mt-1">Accuracy Global</div>
        <div style="margin-top:8px;background:#1e293b;border-radius:4px;height:5px;overflow:hidden">
          <div style="height:100%;width:${accFloat}%;background:${accBarColor};border-radius:4px;transition:width 1s ease"></div>
        </div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
        <div class="text-2xl font-bold text-${modeColor}-400 mono">${d.significantCount}</div>
        <div class="text-xs text-gray-500 mt-1">Significativas ≥6h</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
        <div class="text-2xl font-bold text-gray-400 mono">${d.testingCount}</div>
        <div class="text-xs text-gray-500 mt-1">Testing &lt;6h</div>
      </div>
    </div>

    <!-- Rendimiento por categoría — SIEMPRE 3 cards -->
    <p class="text-sm font-semibold text-gray-300 mb-3">📊 Rendimiento por categoría de previsión</p>
    <div class="grid grid-cols-3 gap-3 mb-5">`;

  // Renderizar las 3 categorías SIN EXCEPCIÓN
  ['INVERTIBLE', 'APALANCADO', 'RUIDOSO'].forEach(cat => {
    const meta = CAT_META[cat];
    const a    = d.analysis?.[cat];     // puede ser undefined si no hay muestras
    const thr  = thresholds[cat];
    const hasData = a && a.total > 0;

    if (hasData) {
      // ── Card con datos ────────────────────────────────────────────────────
      const acc      = parseFloat(a.accuracy);
      const acColor  = acc > 60 ? '#22c55e' : acc > 40 ? '#f59e0b' : '#ef4444';
      const barColor = acc > 60 ? '#22c55e' : acc > 40 ? '#f59e0b' : '#ef4444';
      const incorrect= a.total - a.correct;

      html += `
        <div style="background:${meta.bgColor};border:1px solid ${meta.borderColor}40;border-radius:12px;padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <p style="font-size:10px;font-weight:700;color:${meta.textColor};text-transform:uppercase;letter-spacing:0.05em">
              ${meta.icon} ${cat}
            </p>
            ${thr !== null
              ? `<span style="font-size:9px;padding:1px 6px;background:#1e293b;color:#64748b;border-radius:4px;border:1px solid #334155">
                  BoostPower ≥ ${(thr * 100).toFixed(0)}%
                </span>`
              : ''}
          </div>

          <!-- Accuracy grande -->
          <div style="font-size:28px;font-weight:800;color:${acColor};font-family:monospace;margin-bottom:2px">
            ${a.accuracy}%
          </div>

          <!-- Barra de progreso -->
          <div style="background:#1e293b;border-radius:4px;height:5px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:${acc}%;background:${barColor};border-radius:4px;transition:width 1s ease"></div>
          </div>

          <!-- Desglose ✓/✗ -->
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <span style="font-size:11px;color:#22c55e;font-weight:700">✓ ${a.correct}</span>
            <span style="font-size:11px;color:#ef4444;font-weight:700">✗ ${incorrect}</span>
            <span style="font-size:11px;color:#64748b">de ${a.total}</span>
          </div>

          <!-- Error -->
          <div style="font-size:10px;color:#475569">
            Error prom: <span style="color:#94a3b8">${a.avgError}%</span>
            · máx: <span style="color:#94a3b8">${a.maxError}%</span>
          </div>
        </div>`;

    } else {
      // ── Card SIN datos — mostrar explicación en vez de desaparecer ────────
      const hint = thr !== null
        ? meta.zeroHint.replace('{threshold}', `${(thr * 100).toFixed(0)}%`)
        : meta.zeroHint;

      html += `
        <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:14px;opacity:0.75">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <p style="font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.05em">
              ${meta.icon} ${cat}
            </p>
            ${thr !== null
              ? `<span style="font-size:9px;padding:1px 6px;background:#1e293b;color:#334155;border-radius:4px;border:1px solid #1e293b">
                  ≥ ${(thr * 100).toFixed(0)}%
                </span>`
              : ''}
          </div>

          <!-- Sin datos -->
          <div style="font-size:22px;font-weight:800;color:#334155;font-family:monospace;margin-bottom:4px">— %</div>
          <div style="background:#1e293b;border-radius:4px;height:5px;margin-bottom:8px;opacity:0.3"></div>
          <p style="font-size:10px;color:#334155;margin-bottom:6px">0 muestras en ciclos ≥6h</p>

          <!-- Hint explicativo -->
          <div style="background:#0c1525;border:1px solid #1e3a5f30;border-radius:6px;padding:7px 9px">
            <p style="font-size:10px;color:#3b82f680;line-height:1.4;margin:0">${hint}</p>
          </div>

          ${cat === 'INVERTIBLE' ? `
          <!-- Sugerencia de acción -->
          <div style="margin-top:8px;font-size:10px;color:#475569">
            💡 Prueba a <strong style="color:#60a5fa">reducir invertibleMinBoost</strong> en Config
            o espera ciclos con más activos de baja capitalización.
          </div>` : ''}
        </div>`;
    }
  });

  html += `</div>`;

  // ── Diagnóstico de umbrales activos ────────────────────────────────────────
  html += `
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-5">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">⚙️ Umbrales de clasificación activos (modelo ${modeLabel})</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${[
          { label: 'BoostPower INVERTIBLE',   val: `≥ ${(invertibleThresh * 100).toFixed(0)}%`,  color: '#4ade80' },
          { label: 'BoostPower APALANCADO',   val: `≥ ${(apalancadoThresh * 100).toFixed(0)}%`, color: '#facc15' },
          { label: 'Market Cap máx (INVERT.)',val: cfg.classification?.invertibleMaxMarketCap
                ? `$${(cfg.classification.invertibleMaxMarketCap / 1e6).toFixed(0)}M`
                : (d.mode === 'speculative' ? '$200M' : '$2B'), color: '#60a5fa' },
          { label: 'Target INVERTIBLE',       val: `+${cfg.prediction?.invertibleTarget ?? (d.mode === 'speculative' ? 40 : 15)}%`, color: '#a78bfa' },
          { label: 'Tolerancia error',        val: `±${cfg.prediction?.magnitudeTolerance ?? (d.mode === 'speculative' ? 10 : 7)}%`, color: '#94a3b8' },
        ].map(item => `
          <div style="background:#0f172a;border:1px solid #1e293b;border-radius:7px;padding:8px 10px">
            <div style="font-size:9px;color:#64748b;margin-bottom:2px">${item.label}</div>
            <div style="font-size:15px;font-weight:700;color:${item.color};font-family:monospace">${item.val}</div>
          </div>
        `).join('')}
      </div>
      <p style="font-size:10px;color:#334155;margin-top:10px">
        Ajusta estos parámetros en <strong style="color:#60a5fa">Config → Clasificación</strong> para generar más o menos candidatos INVERTIBLE.
      </p>
    </div>`;

  // ── Recomendaciones ────────────────────────────────────────────────────────
  if (d.recommendations?.length > 0) {
    html += `
      <div class="mb-5">
        <p class="text-sm font-semibold mb-3">💡 Recomendaciones de ajuste</p>
        <div class="space-y-2">`;

    d.recommendations.forEach(rec => {
      const col = rec.priority === 'HIGH' ? 'red' : rec.priority === 'MEDIUM' ? 'yellow' : 'green';
      html += `
        <div class="bg-${col}-950 border border-${col}-800 rounded-xl p-3">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-xs font-bold text-${col}-400 uppercase">${rec.priority}</span>
            <span class="text-xs text-gray-400">${rec.category}</span>
          </div>
          <p class="text-sm text-gray-200 mb-1">${rec.issue}</p>
          <p class="text-xs text-gray-400">→ ${rec.suggestion}</p>
        </div>`;
    });

    html += `</div></div>`;
  }

  // ── Ajustes sugeridos ──────────────────────────────────────────────────────
  if (d.suggestedAdjustments && Object.keys(d.suggestedAdjustments).length > 0) {
    html += `
      <div class="mb-5">
        <div class="flex justify-between items-center mb-3">
          <p class="text-sm font-semibold">🎛️ Ajustes sugeridos</p>
          <button onclick="applySimulationSuggestion()"
            class="bg-purple-700 hover:bg-purple-600 px-4 py-1.5 rounded-lg text-xs font-semibold">
            ✨ Aplicar al modelo ${modeLabel}
          </button>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">`;

    (function printAdjustments(obj, prefix) {
      Object.entries(obj).forEach(([k, v]) => {
        if (v !== null && typeof v === 'object') {
          printAdjustments(v, prefix ? `${prefix}.${k}` : k);
        } else {
          html += `<div class="flex justify-between text-sm">
            <span class="text-gray-400 mono">${prefix ? `${prefix}.` : ''}${k}</span>
            <span class="text-purple-300 font-bold mono">${typeof v === 'number' && v <= 1 ? (v * 100).toFixed(0) + '%' : v}</span>
          </div>`;
        }
      });
    })(d.suggestedAdjustments, '');

    html += `</div></div>`;
  }

  div.innerHTML = html;
};

console.log('[PATCH] analysis-categories — renderAnalysis mejorado ✅');
