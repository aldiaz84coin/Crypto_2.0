/**
 * ══════════════════════════════════════════════════════════════════════
 *  PATCH FRONTEND: Botón de revalidación en ciclos "sin datos"
 *  Archivo: public/patch-revalidate-empty-cycles.js
 *  Añadir al final del <body> en public/index.html
 * ══════════════════════════════════════════════════════════════════════
 *
 *  Añade un botón "🔄 Revalidar todos" en la sección de validación
 *  para corregir los ciclos que quedaron sin datos por el bug anterior.
 *
 *  También modifica loadCompletedCycles para mostrar un botón
 *  "Reintentar" en ciclos individuales con results=[].
 * ══════════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  // ── Botón global de revalidación ─────────────────────────────────────────
  function injectRevalidateButton() {
    const histSection = document.querySelector('#content-validation h3.text-green-400');
    if (!histSection || document.getElementById('btn-revalidate-all')) return;

    const btn = document.createElement('button');
    btn.id        = 'btn-revalidate-all';
    btn.className = 'ml-auto bg-orange-900 hover:bg-orange-800 text-orange-300 text-xs px-3 py-1 rounded-lg font-semibold';
    btn.innerHTML = '🔄 Revalidar ciclos sin datos';
    btn.onclick   = revalidateAllEmpty;

    // Poner el botón en la misma línea que el título del historial
    const titleRow = histSection.closest('div') || histSection.parentElement;
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.appendChild(btn);
  }

  async function revalidateAllEmpty() {
    const btn = document.getElementById('btn-revalidate-all');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Revalidando...'; }

    try {
      const r = await fetch('/api/cycles/revalidate-all-empty', { method: 'POST' });
      const d = await r.json();

      if (d.success) {
        const msg = d.fixed > 0
          ? `✅ ${d.fixed} ciclos revalidados de ${d.total} con datos vacíos.`
          : `ℹ️ No había ciclos con datos vacíos.`;
        alert(msg);
        await loadValidation();
      } else {
        alert(`❌ Error: ${d.error}`);
      }
    } catch(e) {
      alert(`❌ ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Revalidar ciclos sin datos'; }
    }
  }

  // ── Parchear loadCompletedCycles para mostrar botón de reintento ──────────
  const _origLoad = window.loadCompletedCycles;
  window.loadCompletedCycles = async function() {
    await (_origLoad || function(){})();

    // Tras cargar, buscar cards de ciclos con 0 activos procesados y añadir botón
    const completedDiv = document.getElementById('completed-cycles');
    if (!completedDiv) return;

    // Buscar en los ciclos del DOM los que muestran "0/0" en métricas
    // (los que tienen metrics.total === 0)
    try {
      const r = await fetch('/api/cycles/history?mode=all');
      const d = await r.json();
      if (!d.success) return;

      d.cycles.forEach(c => {
        const hasData = c.results && c.results.length > 0;
        if (hasData) return;

        // Encontrar la card de este ciclo e inyectar botón de reintento
        const allCards = completedDiv.querySelectorAll('[data-cycle-id]');
        allCards.forEach(card => {
          if (card.dataset.cycleId === c.id) {
            if (card.querySelector('.btn-retry')) return;
            const retryBtn = document.createElement('button');
            retryBtn.className = 'btn-retry bg-orange-900 hover:bg-orange-800 text-orange-300 text-xs px-2 py-1 rounded font-semibold mt-1';
            retryBtn.textContent = '🔄 Revalidar';
            retryBtn.onclick = async () => {
              retryBtn.textContent = '⏳';
              retryBtn.disabled = true;
              try {
                const rv = await fetch(`/api/cycles/${c.id}/revalidate`, { method: 'POST' });
                const rd = await rv.json();
                if (rd.success) {
                  await loadValidation();
                } else {
                  alert(`❌ ${rd.error}`);
                  retryBtn.textContent = '🔄 Revalidar';
                  retryBtn.disabled = false;
                }
              } catch(e) {
                alert(`❌ ${e.message}`);
                retryBtn.textContent = '🔄 Revalidar';
                retryBtn.disabled = false;
              }
            };
            card.appendChild(retryBtn);
          }
        });
      });
    } catch(_) {}

    injectRevalidateButton();
  };

  // ── Indicador visual en la card del ciclo ────────────────────────────────
  // Parchea el render para añadir `data-cycle-id` a cada card y mostrar
  // badge de advertencia en ciclos sin datos.
  const _origPatch = window.loadCompletedCycles;

  // Ejecutar al cargar la tab de validación
  const _origSetTab = window.setTab;
  if (_origSetTab) {
    window.setTab = function(tab) {
      _origSetTab(tab);
      if (tab === 'validation') {
        setTimeout(injectRevalidateButton, 500);
      }
    };
  }

  // También inyectar si ya estamos en validación
  setTimeout(injectRevalidateButton, 1000);

  console.log('[PATCH] revalidate-empty-cycles — botones de revalidación ✅');
})();
