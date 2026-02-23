/**
 * patch-scheduler-sync.js
 * Sincroniza el widget del WD frontend con el último run del scheduler server-side.
 * Al cargar la app (o volver a la pestaña), consulta /api/scheduler/status y
 * actualiza _wd.lastRunAt para que el widget refleje la realidad del servidor.
 *
 * INSTALACIÓN: ya referenciado en index.html después de patch-pump-duration.js
 */
'use strict';

async function syncSchedulerStatus() {
  try {
    const r = await fetch('/api/scheduler/status');
    const d = await r.json();
    if (!d.success) return;

    const now = Date.now();

    // ── Sincronizar WD con el último run del servidor ─────────────────────
    if (d.watchdog?.lastRunAt) {
      const serverLastRun = d.watchdog.lastRunAt;
      if (!_wd.lastRunAt || serverLastRun > _wd.lastRunAt) {
        _wd.lastRunAt = serverLastRun;

        if (!_wd.lastResult) {
          _wd.lastResult = {
            success:     true,
            checked:     0,
            sells:       d.watchdog.lastSells || 0,
            holds:       0,
            errors:      0,
            priceSource: d.watchdog.lastSource || 'server',
            fromServer:  true,
          };
        }

        const timeSince = now - serverLastRun;
        if (timeSince < (30 * 60 * 1000 - 2 * 60 * 1000)) {
          _wd.nextRunAt = serverLastRun + 30 * 60 * 1000;
        }

        if (typeof wdSaveState === 'function') wdSaveState();
        if (typeof _wdRender   === 'function') _wdRender();

        console.log(
          `[scheduler-sync] WD sincronizado con servidor — ` +
          `último run hace ${Math.round(timeSince / 60000)}min`
        );
      }
    }

    if (d.iterations?.lastRunAt) {
      console.log(
        `[scheduler-sync] Iteraciones servidor — ` +
        `último run hace ${Math.round(d.iterations.lastRunAgo / 60000)}min · ` +
        `procesadas: ${d.iterations.lastProcessed}`
      );
    }
  } catch (e) {
    console.warn('[scheduler-sync] Sin conexión con /api/scheduler/status:', e.message);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(syncSchedulerStatus, 3500));
} else {
  setTimeout(syncSchedulerStatus, 3500);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(syncSchedulerStatus, 1500);
});

console.log('[patch-scheduler-sync] ✅ Sincronización con scheduler del servidor activa');
