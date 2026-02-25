// public/patch-status-bar.js
// ═══════════════════════════════════════════════════════════════════════════
// PARCHE: Barra de estado embebida en el header
//
// Problema: Los widgets de WD (esquina inferior derecha) y precios (esquina
//           inferior izquierda) tapan información de la UI.
// Solución: Insertar una barra de estado compacta debajo del título y
//           redirigir ambos widgets a ella, eliminando los overlays flotantes.
//
// INSTALACIÓN:
//   Añadir en public/index.html justo DESPUÉS de patch-pump-duration.js
//   y patch-price-status.js pero ANTES de </body>:
//   <script src="/patch-status-bar.js"></script>
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

console.log('[PATCH] status-bar ✅');

// ─── 1. Crear la barra de estado en el DOM ────────────────────────────────────
function _createStatusBar() {
  if (document.getElementById('system-status-bar')) return;

  // Buscar el header (título de la app)
  const header = document.querySelector('.max-w-7xl .flex.justify-between.items-center');
  if (!header) {
    // fallback: insertar antes de los tabs
    const tabs = document.querySelector('.max-w-7xl .flex.gap-1.mb-5');
    if (tabs) tabs.parentNode.insertBefore(_buildBar(), tabs);
    return;
  }

  // Insertar la barra justo debajo del header de título
  header.insertAdjacentElement('afterend', _buildBar());
}

function _buildBar() {
  const bar = document.createElement('div');
  bar.id = 'system-status-bar';
  bar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 6px 12px;
    margin-bottom: 14px;
    font-size: 11px;
    font-family: ui-monospace, monospace;
  `;

  // Placeholder de WD
  const wdSlot = document.createElement('div');
  wdSlot.id = 'status-bar-wd';
  wdSlot.style.cssText = 'display:flex;align-items:center;gap:6px;color:#374151;';
  wdSlot.innerHTML = '<span style="color:#374151">🔔 WD —</span>';

  // Separador
  const sep = document.createElement('div');
  sep.style.cssText = 'width:1px;height:14px;background:#1e293b;flex-shrink:0;';

  // Placeholder de Precios
  const priceSlot = document.createElement('div');
  priceSlot.id = 'status-bar-price';
  priceSlot.style.cssText = 'display:flex;align-items:center;gap:6px;color:#374151;';
  priceSlot.innerHTML = '<span style="color:#374151">💰 Precios —</span>';

  bar.appendChild(wdSlot);
  bar.appendChild(sep);
  bar.appendChild(priceSlot);
  return bar;
}

// ─── 2. Re-render de WD en formato compacto ───────────────────────────────────
function _renderWdCompact() {
  const slot = document.getElementById('status-bar-wd');
  if (!slot || typeof _wd === 'undefined') return;

  const now = Date.now();

  // Estado / color
  let dotColor = '#065f46';
  let dotAnim  = '';
  if (_wd.running) {
    dotColor = '#ca8a04';
    dotAnim  = 'animation:pulse 1s infinite';
  } else if (_wd.lastResult?.sells > 0) {
    dotColor = '#16a34a';
  } else if (_wd.lastResult?.errors > 0) {
    dotColor = '#dc2626';
  }

  // Tiempo último run
  let lastText = '—';
  if (_wd.lastRunAt) {
    const s = Math.floor((now - _wd.lastRunAt) / 1000);
    lastText = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m` : `${Math.floor(s/3600)}h`;
  }

  // Próximo run
  let nextText = '—';
  if (_wd.nextRunAt) {
    const s = Math.floor((_wd.nextRunAt - now) / 1000);
    nextText = s <= 0 ? 'ahora' : s < 60 ? `${s}s` : `${Math.floor(s/60)}m`;
  }

  // Texto de ventas
  let sellText = '';
  if (_wd.running) {
    sellText = `<span style="color:#fbbf24">⏳</span>`;
  } else if (_wd.lastResult?.sells > 0) {
    sellText = `<span style="color:#4ade80;font-weight:700">+${_wd.lastResult.sells}v</span>`;
  }

  slot.innerHTML = `
    <span title="Watchdog SL/TP — click para ejecutar" onclick="if(typeof _wdRun==='function')_wdRun(true)"
      style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;padding:2px 6px;border-radius:6px;border:1px solid ${dotColor}33;background:${dotColor}11;transition:background .2s"
      onmouseover="this.style.background='${dotColor}22'" onmouseout="this.style.background='${dotColor}11'">
      <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};${dotAnim};flex-shrink:0"></span>
      <span style="color:#9ca3af">🔔 WD</span>
      <span style="color:#d1fae5">↩${lastText}</span>
      <span style="color:#fef3c7">↻${nextText}</span>
      ${sellText}
    </span>
  `;
}

// ─── 3. Re-render de Precios en formato compacto ─────────────────────────────
function _renderPriceCompact(status) {
  const slot = document.getElementById('status-bar-price');
  if (!slot) return;

  const src = status?.source || 'none';
  const stale = status?.staleCount || 0;
  const failed = status?.failedIds?.length || 0;
  const lastUpdate = status?.lastUpdate;

  // Color según frescura
  let dotColor = '#065f46';
  if (src === 'none')  dotColor = '#7f1d1d';
  else if (failed > 0) dotColor = '#7f1d1d';
  else if (stale > 0)  dotColor = '#78350f';

  // Label corto de fuente
  const srcShort = {
    coingecko: 'CG', cryptocompare: 'CC',
    'coingecko+cryptocompare': 'CG+CC',
    binance: 'BN', stale: 'CACHÉ', none: '—'
  }[src] || src;

  // Tiempo desde actualización
  let timeText = '—';
  if (lastUpdate) {
    const s = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / 1000);
    timeText = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m` : `${Math.floor(s/3600)}h`;
  }

  const warnings = [];
  if (stale > 0)  warnings.push(`<span style="color:#fbbf24">⚠${stale}</span>`);
  if (failed > 0) warnings.push(`<span style="color:#f87171">❌${failed}</span>`);

  slot.innerHTML = `
    <span title="Estado de precios — click para refrescar" onclick="if(typeof forceRefreshPrices==='function')forceRefreshPrices()"
      style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;padding:2px 6px;border-radius:6px;border:1px solid ${dotColor}33;background:${dotColor}11;transition:background .2s"
      onmouseover="this.style.background='${dotColor}22'" onmouseout="this.style.background='${dotColor}11'">
      <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
      <span style="color:#9ca3af">💰 ${srcShort}</span>
      <span style="color:#d1fae5">${timeText}</span>
      ${warnings.join('')}
    </span>
  `;
}

// ─── 4. Eliminar widgets flotantes originales cuando ya no sean necesarios ────
function _hideOriginalWidgets() {
  // WD widget (bottom-right, JS dinámico)
  const wd = document.getElementById('watchdog-widget');
  if (wd) wd.style.display = 'none';

  // Price widget (bottom-left)
  const pw = document.getElementById('price-status-widget');
  if (pw) pw.style.display = 'none';
}

// ─── 5. Interceptar creación de widgets originales ────────────────────────────
// Como los patches originales crean el widget antes de que este código corra,
// los ocultamos y usamos la barra. También sobreescribimos las funciones
// de render para que futuras llamadas actualicen la barra.

function _hookExistingPatches() {
  // Hook: cuando el patch original llame a _wdRender(), también actualizamos la barra
  if (typeof _wdRender === 'function') {
    const _origWdRender = _wdRender;
    window._wdRender = function() {
      _origWdRender.apply(this, arguments);
      _renderWdCompact();
      _hideOriginalWidgets();
    };
  }

  // Hook: cuando el patch original llame a renderWidget(), también actualizamos la barra
  // (renderWidget es función local en patch-price-status.js, pero updatePriceStatusFromPositions es global)
  if (typeof window.updatePriceStatusFromPositions === 'function') {
    const _origUpdate = window.updatePriceStatusFromPositions;
    window.updatePriceStatusFromPositions = function(priceUpdate) {
      _origUpdate.apply(this, arguments);
      _renderPriceCompact({
        source:      priceUpdate?.source,
        staleCount:  priceUpdate?.staleCount,
        failedIds:   priceUpdate?.failedIds,
        lastUpdate:  priceUpdate?.updatedAt,
      });
      _hideOriginalWidgets();
    };
  }
}

// ─── 6. Tick de actualización de WD (cada segundo para el countdown) ─────────
function _startStatusBarTick() {
  setInterval(() => {
    _renderWdCompact();
  }, 1000);
}

// ─── 7. CSS de animación de pulso ─────────────────────────────────────────────
function _injectPulseCSS() {
  if (document.getElementById('status-bar-css')) return;
  const s = document.createElement('style');
  s.id = 'status-bar-css';
  s.textContent = `
    @keyframes pulse {
      0%,100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(s);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function _initStatusBar() {
  _injectPulseCSS();
  _createStatusBar();
  _hookExistingPatches();
  _hideOriginalWidgets();
  _renderWdCompact();
  _startStatusBarTick();

  // Render inicial de precios si hay estado guardado
  if (typeof _priceStatus !== 'undefined') {
    _renderPriceCompact(_priceStatus);
  }

  console.log('[status-bar] ✅ Barra de estado embebida en header');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initStatusBar);
} else {
  // Si el DOM ya está listo, esperar un tick para que los otros patches corran primero
  setTimeout(_initStatusBar, 0);
}
