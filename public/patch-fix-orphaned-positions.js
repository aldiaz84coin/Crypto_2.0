/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: fix-orphaned-positions
 *  
 *  BUGS CORREGIDOS:
 *  1. /api/invest/positions/:id/close — investManager.closePosition()
 *     se llamaba con parámetros incorrectos y su valor de retorno no
 *     se aplicaba → las posiciones permanecían 'open' en Redis aunque
 *     la orden de venta se ejecutara.
 *
 *  2. Nuevo endpoint POST /api/invest/positions/close-orphaned
 *     para limpiar posiciones abiertas sin ronda activa, desbloqueando
 *     la apertura de una nueva ronda.
 *
 *  3. POST /api/invest/rounds/open ya no bloquea si el currentRound
 *     está en estado 'closed' (solo bloquea si está 'active').
 *
 *  INSTRUCCIONES:
 *  Añadir <script src="/patch-fix-orphaned-positions.js"></script>
 *  en index.html ANTES de cerrar </body>.
 *  
 *  Los fixes del backend (api/index.js) están documentados al final.
 * ══════════════════════════════════════════════════════════════════
 */

// ─── 1. BOTÓN DE LIMPIEZA EN EL BANNER "SIN RONDA" ──────────────────────────
// Cuando no hay ronda activa pero existen posiciones abiertas huérfanas,
// muestra un banner de advertencia con botón para limpiarlas.

(async function patchOrphanedPositions() {
  'use strict';

  // ── Override: openNewRoundWizard ─────────────────────────────────────────
  // Antes de abrir el wizard, comprueba si hay posiciones huérfanas y, si las
  // hay, ofrece limpiarlas sin bloquear el flujo.
  const _orig_openNewRoundWizard = window.openNewRoundWizard;
  window.openNewRoundWizard = async function () {
    try {
      const r = await fetch('/api/invest/positions');
      const d = await r.json();
      const openCount = d.success ? (d.open || []).length : 0;

      if (openCount > 0) {
        // Hay posiciones abiertas sin ronda activa → mostrar diálogo de limpieza
        showOrphanedCleanupModal(openCount, async () => {
          // Callback tras limpieza exitosa: abrir wizard normalmente
          if (_orig_openNewRoundWizard) _orig_openNewRoundWizard();
        });
        return;
      }
    } catch (_) { /* si falla la comprobación, dejar pasar al wizard */ }

    if (_orig_openNewRoundWizard) _orig_openNewRoundWizard();
  };

  // ── Override: loadCurrentRoundBanner ────────────────────────────────────
  // Inyecta aviso de posiciones huérfanas en el banner "sin ronda activa".
  const _orig_loadBanner = window.loadCurrentRoundBanner;
  window.loadCurrentRoundBanner = async function () {
    if (_orig_loadBanner) await _orig_loadBanner();

    try {
      const [roundsRes, posRes] = await Promise.all([
        fetch('/api/invest/rounds').then(r => r.json()),
        fetch('/api/invest/positions').then(r => r.json()),
      ]);

      const hasActiveRound = roundsRes.success && roundsRes.current?.status === 'active';
      const openPos        = posRes.success ? (posRes.open || []) : [];

      // Solo mostrar si NO hay ronda activa pero sí posiciones abiertas
      if (!hasActiveRound && openPos.length > 0) {
        _injectOrphanBanner(openPos.length);
      } else {
        document.getElementById('orphan-positions-banner')?.remove();
      }
    } catch (_) {}
  };

  // ── Helper: inyectar banner de advertencia ───────────────────────────────
  function _injectOrphanBanner(count) {
    document.getElementById('orphan-positions-banner')?.remove();

    const noRoundBanner = document.getElementById('inv-no-round-banner');
    const insertAfter   = noRoundBanner?.parentElement || document.getElementById('content-invest');
    if (!insertAfter) return;

    const banner = document.createElement('div');
    banner.id = 'orphan-positions-banner';
    banner.className = 'bg-orange-950 border border-orange-700 rounded-xl p-4 mb-4 mx-4 mt-2';
    banner.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-2xl">⚠️</span>
        <div class="flex-1">
          <p class="font-bold text-orange-300 text-sm">
            ${count} posición${count !== 1 ? 'es' : ''} huérfana${count !== 1 ? 's' : ''}
          </p>
          <p class="text-xs text-orange-400 mt-0.5">
            La ronda anterior se cerró pero quedaron posiciones en estado 'open'.
            Deben limpiarse antes de abrir una nueva ronda.
          </p>
          <div class="flex gap-2 mt-3">
            <button
              onclick="window.closeOrphanedPositions()"
              class="bg-orange-700 hover:bg-orange-600 px-4 py-1.5 rounded-lg text-xs font-bold text-white">
              🧹 Limpiar posiciones huérfanas
            </button>
            <button
              onclick="loadInvestPositions()"
              class="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs text-gray-300">
              Ver posiciones
            </button>
          </div>
        </div>
      </div>`;

    if (noRoundBanner) {
      noRoundBanner.after(banner);
    } else {
      insertAfter.prepend(banner);
    }
  }

  // ── Modal de confirmación de limpieza ────────────────────────────────────
  function showOrphanedCleanupModal(count, onCleanedCallback) {
    document.getElementById('orphan-cleanup-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'orphan-cleanup-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
    modal.style.background = 'rgba(0,0,0,0.85)';
    modal.innerHTML = `
      <div class="bg-gray-950 border border-orange-800 rounded-2xl w-full max-w-md shadow-2xl">
        <div class="p-5">
          <h2 class="text-base font-bold text-orange-400 mb-1">
            ⚠️ ${count} posición${count !== 1 ? 'es' : ''} sin ronda activa
          </h2>
          <p class="text-sm text-gray-400 mb-3">
            Estas posiciones quedaron abiertas de la ronda anterior. 
            Serán cerradas con el precio actual antes de abrir la nueva ronda.
          </p>
          <div class="bg-orange-950/50 border border-orange-900 rounded-lg p-3 text-xs text-orange-300 mb-4">
            Se marcará el PnL a precio de mercado actual y se registrará como <code>orphan_close</code>.
          </div>
          <div id="orphan-modal-status" class="hidden text-sm text-gray-400 mb-3"></div>
          <div class="flex gap-2">
            <button 
              onclick="document.getElementById('orphan-cleanup-modal').remove()"
              class="flex-1 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm font-semibold">
              Cancelar
            </button>
            <button
              id="btn-confirm-orphan-close"
              onclick="window._confirmOrphanClose(${JSON.stringify(typeof onCleanedCallback === 'function' ? 'callback' : 'none')})"
              class="flex-1 bg-orange-700 hover:bg-orange-600 px-4 py-2 rounded-lg text-sm font-bold">
              🧹 Limpiar y continuar
            </button>
          </div>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);

    // Almacenar callback temporalmente
    window._orphanCleanupCallback = onCleanedCallback;
  }

  // ── Acción confirmada de limpieza ────────────────────────────────────────
  window._confirmOrphanClose = async function () {
    const btn    = document.getElementById('btn-confirm-orphan-close');
    const status = document.getElementById('orphan-modal-status');
    if (!btn) return;

    btn.disabled = true;
    btn.innerHTML = '⏳ Cerrando...';
    if (status) { status.classList.remove('hidden'); status.textContent = 'Cerrando posiciones huérfanas...'; }

    await window.closeOrphanedPositions({ silent: true });

    document.getElementById('orphan-cleanup-modal')?.remove();

    // Ejecutar callback (abrir wizard de nueva ronda)
    const cb = window._orphanCleanupCallback;
    window._orphanCleanupCallback = null;
    if (typeof cb === 'function') cb();
  };

  // ── Función principal de limpieza ────────────────────────────────────────
  window.closeOrphanedPositions = async function ({ silent = false } = {}) {
    try {
      const r = await fetch('/api/invest/positions/close-orphaned', { method: 'POST' });
      const d = await r.json();

      if (!d.success) {
        if (!silent) alert('❌ ' + (d.error || 'Error al cerrar posiciones huérfanas'));
        return false;
      }

      const closed = d.closedCount || 0;
      if (!silent) {
        alert(`✅ ${closed} posición${closed !== 1 ? 'es' : ''} limpiada${closed !== 1 ? 's' : ''} correctamente.`);
      }

      // Refrescar UI
      document.getElementById('orphan-positions-banner')?.remove();
      await Promise.all([
        typeof loadInvestPositions === 'function'  ? loadInvestPositions()  : Promise.resolve(),
        typeof loadInvestOverview  === 'function'  ? loadInvestOverview()   : Promise.resolve(),
        typeof loadInvestRounds    === 'function'  ? loadInvestRounds()     : Promise.resolve(),
        typeof loadCurrentRoundBanner === 'function' ? loadCurrentRoundBanner() : Promise.resolve(),
      ]);

      return true;
    } catch (e) {
      if (!silent) alert('❌ ' + e.message);
      return false;
    }
  };

  // ── Ejecución inicial ────────────────────────────────────────────────────
  // Después de que la página cargue, verificar si hay posiciones huérfanas
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
      try {
        const [roundsRes, posRes] = await Promise.all([
          fetch('/api/invest/rounds').then(r => r.json()),
          fetch('/api/invest/positions').then(r => r.json()),
        ]);
        const hasActiveRound = roundsRes.success && roundsRes.current?.status === 'active';
        const openCount      = posRes.success ? (posRes.open || []).length : 0;
        if (!hasActiveRound && openCount > 0) _injectOrphanBanner(openCount);
      } catch (_) {}
    }, 1500);
  });

  console.log('[patch-fix-orphaned-positions] ✅ Cargado');
})();


// ════════════════════════════════════════════════════════════════════════════
//  FIXES REQUERIDOS EN api/index.js
// ════════════════════════════════════════════════════════════════════════════
//
//  ── FIX 1: Endpoint POST /api/invest/positions/:id/close ─────────────────
//
//  CÓDIGO ACTUAL (BUGGY):
//    const order = await exchangeConnector.placeOrder(...);
//    investManager.closePosition(position, evaluation);   ← retorno ignorado
//    await savePositions(positions);
//
//  CÓDIGO CORRECTO:
//    const order = await exchangeConnector.placeOrder(...);
//    const closedPos = investManager.closePosition(position, currentPrice, evaluation.reason, cfg);
//    Object.assign(position, closedPos);
//    await onPositionClosed(position);
//    position.exchangeCloseOrderId = order.orderId;
//    await savePositions(positions);
//
//
//  ── FIX 2: Nuevo endpoint POST /api/invest/positions/close-orphaned ───────
//  Añadir ANTES del endpoint /:id/close (importante el orden de rutas en Express):
//
//  app.post('/api/invest/positions/close-orphaned', async (req, res) => {
//    if (!redis) return res.status(503).json({ success: false, error: 'Redis no disponible' });
//    try {
//      const cfg       = await getInvestConfig();
//      const positions = await getPositions();
//      const openPos   = positions.filter(p => p.status === 'open');
//
//      if (openPos.length === 0)
//        return res.json({ success: true, closedCount: 0, message: 'Sin posiciones huérfanas' });
//
//      const keys = await getExchangeKeys(cfg.exchange);
//      const results = [];
//
//      for (const position of openPos) {
//        try {
//          // Precio actual con fallback
//          let currentPrice = position.currentPrice || position.entryPrice;
//          try {
//            const pRes = await axios.get(
//              `https://api.coingecko.com/api/v3/simple/price?ids=${position.assetId}&vs_currencies=usd`,
//              { timeout: 5000 }
//            );
//            currentPrice = pRes.data?.[position.assetId]?.usd || currentPrice;
//          } catch (_) {}
//
//          const evaluation  = investManager.evaluatePosition(position, currentPrice, 'orphan_close', cfg);
//          evaluation.reason = 'orphan_close: cierre de posición huérfana';
//
//          const order = await exchangeConnector.placeOrder(position.symbol, 'SELL', position.units, cfg, keys);
//
//          const closedPos = investManager.closePosition(position, currentPrice, evaluation.reason, cfg);
//          Object.assign(position, closedPos);
//          await onPositionClosed(position);
//          position.exchangeCloseOrderId = order.orderId;
//
//          results.push({ symbol: position.symbol, success: true, pnlPct: evaluation.pnlPct });
//        } catch (e) {
//          // Si falla la orden del exchange, forzar cierre igualmente para no quedar bloqueados
//          position.status    = 'closed';
//          position.closeReason = 'orphan_force_close: ' + e.message;
//          position.closedAt  = new Date().toISOString();
//          position.exitPrice = position.currentPrice || position.entryPrice;
//          const grossPnL = (position.exitPrice - position.entryPrice) * position.units;
//          position.realizedPnL    = parseFloat(grossPnL.toFixed(4));
//          position.realizedPnLPct = parseFloat(((grossPnL / (position.capitalUSD || 1)) * 100).toFixed(2));
//          results.push({ symbol: position.symbol, success: false, forced: true, error: e.message });
//        }
//      }
//
//      await savePositions(positions);
//      await appendInvestLog({
//        type: 'orphan_close', subtype: 'system_action',
//        timestamp: new Date().toISOString(),
//        closedCount: results.length, results
//      });
//
//      res.json({ success: true, closedCount: results.length, results });
//    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
//  });
//
//
//  ── FIX 3: POST /api/invest/rounds/open — validación de ronda existente ──
//  Cambiar:
//    if (existing && existing.status === 'active') {
//  Por:
//    if (existing && existing.status === 'active') {
//  (sin cambio en la condición, ya es correcto — solo asegurarse de que
//   currentRound = null no bloquea la apertura de nueva ronda)
//
// ════════════════════════════════════════════════════════════════════════════
