/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: Historial de ciclos — modo visible + bugs corregidos
 *
 *  INSTALACIÓN:
 *    <script src="/patch-cycles-history.js"></script>
 *  (añadir al final del <body>, después de los otros patches)
 *
 *  BUGS QUE CORRIGE (frontend):
 *  1. El historial no mostraba el modo (Generalista / Especulativo)
 *  2. loadCompletedCycles filtraba por currentMode → ciclos del otro
 *     modo desaparecían si cambiabas el selector de análisis
 *  3. Los activos en el detalle del ciclo especulativo no mostraban
 *     la clasificación correcta
 *
 *  BUG DE BACKEND (corregir en api/index.js manualmente):
 *  Ver comentario al final de este archivo.
 * ══════════════════════════════════════════════════════════════════
 */

const HIST_SIG_MS = 6 * 3600000;

// ─── Override de loadCompletedCycles ─────────────────────────────────────────
window.loadCompletedCycles = async function() {
  const div = document.getElementById('completed-cycles');
  if (!div) return;
  div.innerHTML = '<p class="text-gray-500 text-sm">⏳ Cargando historial...</p>';

  try {
    // ✅ FIX: pedir mode=all — mostrar TODOS los ciclos independientemente del
    // currentMode activo en el selector de análisis
    const r = await fetch('/api/cycles/history?mode=all');
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Error del servidor');

    const cycles = d.cycles || [];
    if (cycles.length === 0) {
      div.innerHTML = '<p class="text-gray-500 text-sm">Sin ciclos completados.</p>';
      return;
    }

    div.innerHTML = '';

    cycles.slice(0, 15).forEach(c => {
      const excl  = (c.excludedResults || []).length;
      const sig   = (c.durationMs || 0) >= HIST_SIG_MS;
      const mode  = c.mode || 'normal';
      const isSpec = mode === 'speculative';

      const accVal   = parseFloat(c.metrics?.successRate || 0);
      const accClass = accVal > 60 ? 'text-green-400' : accVal > 40 ? 'text-yellow-400' : 'text-red-400';

      // Métricas por categoría (si están disponibles)
      const inv  = c.metrics?.invertible  || { total: 0, correct: 0, successRate: '0' };
      const apal = c.metrics?.apalancado  || { total: 0, correct: 0, successRate: '0' };
      const ruid = c.metrics?.ruidoso     || { total: 0, correct: 0, successRate: '0' };

      const card = document.createElement('div');

      // Borde de color según modo
      const borderColor = isSpec ? 'border-yellow-900' : 'border-gray-800';
      card.className = `bg-gray-900 rounded-xl border ${borderColor} p-4 mb-2`;

      card.innerHTML = `
        <div class="flex justify-between items-start gap-3">

          <!-- Info izquierda -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <p class="font-semibold text-sm text-gray-100">
                ${new Date(c.completedAt).toLocaleString('es-ES', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}
              </p>
              <!-- ✅ FIX: Badge de modo siempre visible -->
              ${isSpec
                ? `<span class="pill bg-yellow-900 text-yellow-300" title="Modelo especulativo — micro-caps">🎯 Especulativo</span>`
                : `<span class="pill bg-blue-950 text-blue-300" title="Modelo generalista">📊 Generalista</span>`}
              <span class="pill ${sig ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-400'}">
                ${sig ? '⭐ Significativo' : '⚗️ Testing'}
              </span>
            </div>

            <!-- Detalles secundarios -->
            <div class="flex items-center gap-2 flex-wrap text-xs text-gray-500">
              <span>${c.snapshot?.length || c.metrics?.total || 0} activos</span>
              <span>·</span>
              <span>${_fmtDurH(c.durationMs)}</span>
              ${excl ? `<span>· <span class="text-yellow-400">${excl} excluidos</span></span>` : ''}
              <span class="text-gray-700 mono text-xs">${c.id?.slice(-8) || ''}</span>
            </div>

            <!-- Mini pills por categoría -->
            ${(inv.total + apal.total + ruid.total) > 0 ? `
            <div class="flex gap-2 mt-2 flex-wrap">
              ${inv.total > 0 ? `
                <span class="pill bg-green-950 text-green-400" style="font-size:10px">
                  🟢 ${inv.total} · ${parseFloat(inv.successRate).toFixed(0)}%
                </span>` : ''}
              ${apal.total > 0 ? `
                <span class="pill bg-yellow-950 text-yellow-400" style="font-size:10px">
                  🟡 ${apal.total} · ${parseFloat(apal.successRate).toFixed(0)}%
                </span>` : ''}
              ${ruid.total > 0 ? `
                <span class="pill bg-gray-800 text-gray-400" style="font-size:10px">
                  ⚪ ${ruid.total} · ${parseFloat(ruid.successRate).toFixed(0)}%
                </span>` : ''}
            </div>` : ''}
          </div>

          <!-- Accuracy + botones -->
          <div class="flex items-center gap-3 flex-shrink-0">
            <div class="text-right">
              <div class="text-2xl font-bold ${accClass} mono">${c.metrics?.successRate ?? '?'}%</div>
              <div class="text-xs text-gray-500">${c.metrics?.correct ?? '?'}/${c.metrics?.total ?? '?'}</div>
              ${c.metrics?.total === 0 && isSpec ? `
                <div class="text-xs text-red-400 mt-0.5" title="Bug conocido: los micro-caps no estaban en el top-50 de CoinGecko al completar. Aplica el fix de backend.">
                  ⚠️ Sin datos
                </div>` : ''}
            </div>
            <div class="flex flex-col gap-1">
              <button onclick="toggleDetail('${c.id}')"
                class="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-xs">
                📋 Ver
              </button>
              <button onclick="downloadReport('${c.id}')"
                class="bg-blue-900 hover:bg-blue-800 px-3 py-1 rounded text-xs">
                📄 Word
              </button>
              ${sig ? `
              <button onclick="downloadEnhancedReport('${c.id}')"
                class="bg-green-900 hover:bg-green-800 px-3 py-1 rounded text-xs"
                title="Informe mejorado con análisis de oportunidades perdidas">
                📊 Mejorado
              </button>` : ''}
            </div>
          </div>
        </div>

        <!-- Detalle desplegable de resultados -->
        <div id="cdetail-${c.id}" class="hidden mt-3 border-t border-gray-800 pt-3">
          <p class="text-xs text-gray-500 mb-2">Click para excluir/incluir de las estadísticas</p>
          <div class="space-y-1.5">
            ${(c.results || []).map(r => _renderResultCard(r, c)).join('')}
            ${(c.results || []).length === 0
              ? `<p class="text-xs text-gray-600 py-2">
                  Sin resultados registrados.
                  ${isSpec ? '⚠️ Aplica el fix de backend para ciclos especulativos.' : ''}
                </p>`
              : ''}
          </div>
        </div>
      `;

      div.appendChild(card);
    });

    // Total de ciclos si hay más de 15
    if (cycles.length > 15) {
      const note = document.createElement('p');
      note.className = 'text-xs text-gray-600 text-center mt-2';
      note.textContent = `Mostrando 15 de ${cycles.length} ciclos. Ve a Análisis para seleccionar individualmente.`;
      div.appendChild(note);
    }

  } catch(e) {
    div.innerHTML = `<p class="text-red-400 text-sm">❌ Error: ${e.message}</p>`;
  }
};

// ─── Helper: renderizar card de resultado individual ──────────────────────────
function _renderResultCard(result, cycle) {
  const excl   = (cycle.excludedResults || []).includes(result.id);
  const ok     = result.correct;
  const border = excl ? 'border-gray-700' : ok ? 'border-green-700' : 'border-red-700';
  const op     = excl ? 'opacity-40' : '';
  const cat    = result.classification || 'RUIDOSO';
  const catColor = cat === 'INVERTIBLE' ? 'text-green-400' : cat === 'APALANCADO' ? 'text-yellow-400' : 'text-gray-500';

  return `
    <div class="result-card ${op} bg-gray-800 rounded-lg p-2.5 border-l-4 ${border} flex justify-between items-center text-sm"
      onclick="toggleExclude('${cycle.id}','${result.id}',this)"
      title="${excl ? 'Click para incluir' : 'Click para excluir'}">
      <div class="flex items-center gap-2">
        <span class="font-semibold">${result.name || result.symbol || result.id}</span>
        <span class="${catColor} mono text-xs">${cat}</span>
      </div>
      <div class="flex items-center gap-3 text-xs mono">
        <span class="text-gray-400">Pred: <span class="text-white">${result.predictedChange}%</span></span>
        <span class="text-gray-400">Real: <span class="${parseFloat(result.actualChange) >= 0 ? 'text-green-400' : 'text-red-400'}">
          ${parseFloat(result.actualChange) > 0 ? '+' : ''}${result.actualChange}%
        </span></span>
        <span class="text-gray-500">Δ${result.error}%</span>
        <span class="${excl ? 'text-gray-500' : ok ? 'text-green-400' : 'text-red-400'} font-bold text-base">
          ${excl ? '⊘' : ok ? '✓' : '✗'}
        </span>
      </div>
    </div>`;
}

// ─── Helper: formato de duración ──────────────────────────────────────────────
function _fmtDurH(ms) {
  if (!ms) return '—';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}` : `${m}m`;
}

console.log('[PATCH] cycles-history — modo visible + todos los ciclos ✅');

/*
 * ══════════════════════════════════════════════════════════════════
 *  FIX DE BACKEND REQUERIDO — api/index.js
 * ══════════════════════════════════════════════════════════════════
 *
 *  PROBLEMA: el endpoint POST /api/cycles/:cycleId/complete siempre
 *  pide a CoinGecko los top 50 por market cap. Los micro-caps del
 *  modo especulativo (≤$200M) no están en esa lista, así que todos
 *  los activos se saltan con `continue` y el ciclo queda sin resultados.
 *
 *  LOCALIZAR esta sección en api/index.js:
 *
 *    app.post('/api/cycles/:cycleId/complete', async (req, res) => {
 *      ...
 *      const cycleData = await cyclesManager.getCycle(redis, req.params.cycleId);
 *      const cycleMode = cycleData?.mode || req.body?.mode || 'normal';
 *      const config    = await getConfig(cycleMode);
 *      const prices  = await axios.get(                              ← LÍNEA A CAMBIAR
 *        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1',
 *        { timeout: 8000 }
 *      );
 *
 *  REEMPLAZAR esas líneas de prices por:
 *
 *      // Obtener IDs del snapshot para buscar precios exactos
 *      const snapshotIds = (cycleData?.snapshot || [])
 *        .map(a => a.id).filter(Boolean).join(',');
 *
 *      const priceUrl = snapshotIds
 *        ? `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${snapshotIds}&per_page=250`
 *        : `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1`;
 *
 *      const prices = await axios.get(priceUrl, { timeout: 10000 });
 *
 *  Esto busca los precios actuales de los activos EXACTOS del snapshot,
 *  sin importar si son large-cap o micro-cap.
 * ══════════════════════════════════════════════════════════════════
 */
