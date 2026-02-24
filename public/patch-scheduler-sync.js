/**
 * patch-scheduler-sync.js  v2
 * Sincroniza el widget del WD frontend con el último run del servidor (Redis).
 *
 * NOVEDADES v2:
 *  - Sincronización periódica cada 3 min (antes solo al cargar/volver a la pestaña)
 *  - Detección de WD overdue (>32 min): badge rojo en el widget
 *  - Fallback de emergencia (>35 min): llama a /api/watchdog/ping antes de ejecutar local
 */
'use strict';

const _SYNC_INTERVAL_MS     = 3  * 60 * 1000; // consultar estado cada 3 min
const _WD_OVERDUE_MS        = 32 * 60 * 1000; // >32 min → badge de alerta
const _WD_EMERGENCY_MS      = 35 * 60 * 1000; // >35 min → disparar ping / fallback local

let _syncTimer = null;

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

        // Cancelar timeout inicial si el servidor ya corrió recientemente
        if (_wd.pendingTimeout !== null && _wd.pendingTimeout !== undefined) {
          clearTimeout(_wd.pendingTimeout);
          _wd.pendingTimeout = null;
          console.log('[scheduler-sync] ⛔ Timeout inicial del WD cancelado');

          const WD_MS = _wd.INTERVAL_MS || (30 * 60 * 1000);
          if (timeSince < (WD_MS - 2 * 60 * 1000)) {
            const waitMs = Math.max(10000, WD_MS - timeSince);
            _wd.nextRunAt = now + waitMs;
            _wd.pendingTimeout = setTimeout(() => {
              _wd.pendingTimeout = null;
              _wdRun();
              clearInterval(_wd.interval);
              _wd.interval = setInterval(() => _wdRun(), WD_MS);
            }, waitMs);
            console.log(`[scheduler-sync] ⏭ WD reprogramado — próxima en ${Math.round(waitMs/60000)}min`);
          }
        }

        if (typeof wdSaveState === 'function') wdSaveState();
        if (typeof _wdRender   === 'function') _wdRender();

        console.log(
          `[scheduler-sync] WD sincronizado — ` +
          `último run hace ${Math.round(timeSince / 60000)}min`
        );

        // Si el server corrió recientemente, quitar badge overdue
        _wdClearOverdueBadge();
      }
    }

    // ── Detección de WD overdue ───────────────────────────────────────────
    const wdLastRun  = d.watchdog?.lastRunAt || _wd.lastRunAt || 0;
    const wdElapsed  = wdLastRun ? now - wdLastRun : 0;

    if (wdLastRun && wdElapsed > _WD_EMERGENCY_MS && !_wd.running) {
      const min = Math.floor(wdElapsed / 60000);
      console.warn(`[scheduler-sync] 🚨 WD EMERGENCIA — sin correr hace ${min}min → disparando ping`);
      _wdSetOverdueBadge(min);
      _triggerWatchdogEmergency();
    } else if (wdLastRun && wdElapsed > _WD_OVERDUE_MS) {
      _wdSetOverdueBadge(Math.floor(wdElapsed / 60000));
    } else {
      _wdClearOverdueBadge();
    }

    if (d.iterations?.lastRunAt) {
      console.log(
        `[scheduler-sync] Iteraciones — ` +
        `hace ${Math.round(d.iterations.lastRunAgo / 60000)}min · ` +
        `procesadas: ${d.iterations.lastProcessed}`
      );
    }
  } catch (e) {
    console.warn('[scheduler-sync] Sin conexión con /api/scheduler/status:', e.message);
  }
}

// ── Badge overdue en el widget ────────────────────────────────────────────────
function _wdSetOverdueBadge(minutes) {
  const w = document.getElementById('watchdog-widget');
  if (!w) return;
  w.style.borderColor = '#dc2626';
  let badge = document.getElementById('wd-overdue-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'wd-overdue-badge';
    badge.style.cssText = 'color:#f87171;font-size:10px;margin-top:4px;font-weight:bold;';
    w.appendChild(badge);
  }
  badge.textContent = `⚠️ Sin ejecutar hace ${minutes}min`;
}

function _wdClearOverdueBadge() {
  const badge = document.getElementById('wd-overdue-badge');
  if (badge) badge.remove();
}

// ── Fallback de emergencia ────────────────────────────────────────────────────
async function _triggerWatchdogEmergency() {
  try {
    const r = await fetch('/api/watchdog/ping');
    const d = await r.json();
    if (d.triggered) {
      console.log('[scheduler-sync] ✅ Ping de emergencia aceptado — WD en ejecución');
    } else {
      console.log('[scheduler-sync] Ping respondió:', d.reason || JSON.stringify(d));
    }
  } catch(e) {
    // Último recurso: ejecutar WD directamente desde el browser
    console.warn('[scheduler-sync] Ping falló — ejecutando WD local:', e.message);
    if (typeof _wdRun === 'function') _wdRun();
  }
}

// ── Arranque ──────────────────────────────────────────────────────────────────
(function _initSchedulerSync() {
  // Sincronización inicial
  const _initialSync = () => setTimeout(syncSchedulerStatus, 3500);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initialSync);
  } else {
    _initialSync();
  }

  // Sincronización periódica cada 3 min
  _syncTimer = setInterval(syncSchedulerStatus, _SYNC_INTERVAL_MS);

  // Re-sincronizar al volver a la pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(syncSchedulerStatus, 1500);
  });

  console.log('[patch-scheduler-sync] ✅ v2 — sync cada 3min + detección overdue activa');
})();

