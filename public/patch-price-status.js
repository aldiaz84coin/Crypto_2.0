// public/patch-price-status.js
// Indicador UX de estado de precios: última actualización, fuente, frescura.
// Se activa en la sección de inversión y muestra alertas cuando los precios
// son stale o hay activos sin datos.
'use strict';

console.log('[PATCH] price-status UX ✅');

// ─── Estado global del indicador ─────────────────────────────────────────────
const _priceStatus = {
  lastUpdate:   null,   // ISO string
  source:       null,   // 'coingecko' | 'cryptocompare' | 'binance' | 'stale' | 'none'
  fetchedCount: 0,
  staleCount:   0,
  failedIds:    [],
  hasIssues:    false,
};

// ─── Helpers de formato ───────────────────────────────────────────────────────

function timeAgo(isoString) {
  if (!isoString) return 'nunca';
  const ms   = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `hace ${mins}m`;
  const hrs  = Math.floor(mins / 60);
  return `hace ${hrs}h ${mins % 60}m`;
}

const SOURCE_LABELS = {
  coingecko:                '🟢 CoinGecko',
  cryptocompare:            '🔵 CryptoCompare',
  'coingecko+cryptocompare':'🟢 CoinGecko + CryptoCompare',
  binance:                  '🟡 Binance',
  stale:                    '🟠 Caché anterior',
  none:                     '⚫ Sin datos',
};

function sourceLabel(src) {
  return SOURCE_LABELS[src] || `⚪ ${src || 'desconocido'}`;
}

function freshnessColor(source, staleCount) {
  if (source === 'none')    return 'text-red-400 border-red-700';
  if (staleCount > 0)       return 'text-yellow-400 border-yellow-700';
  if (source === 'stale')   return 'text-orange-400 border-orange-700';
  return 'text-emerald-400 border-emerald-700';
}

// ─── Crear / actualizar el widget ─────────────────────────────────────────────

function getOrCreateWidget() {
  let w = document.getElementById('price-status-widget');
  if (w) return w;

  w = document.createElement('div');
  w.id        = 'price-status-widget';
  w.className = 'hidden fixed bottom-4 left-4 z-40 bg-gray-900 border rounded-xl px-3 py-2 text-xs shadow-lg cursor-pointer max-w-xs';
  w.title     = 'Estado de precios — click para refrescar';
  w.onclick   = () => forceRefreshPrices();
  document.body.appendChild(w);
  return w;
}

function renderWidget(status) {
  const w = getOrCreateWidget();
  const { lastUpdate, source, fetchedCount, staleCount, failedIds } = status;

  const colorClass = freshnessColor(source, staleCount);
  w.className = `fixed bottom-4 left-4 z-40 bg-gray-900 border ${colorClass.split(' ')[1]} rounded-xl px-3 py-2 text-xs shadow-lg cursor-pointer max-w-xs`;

  const staleWarning = staleCount > 0
    ? `<div class="text-yellow-400 mt-0.5">⚠️ ${staleCount} precio(s) de caché anterior</div>` : '';
  const failedWarning = failedIds.length > 0
    ? `<div class="text-red-400 mt-0.5">❌ Sin precio: ${failedIds.slice(0,3).join(', ')}${failedIds.length > 3 ? '...' : ''}</div>` : '';

  w.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="${colorClass.split(' ')[0]} font-semibold">Precios</span>
      <span class="text-gray-400">${sourceLabel(source)}</span>
    </div>
    <div class="text-gray-500 mt-0.5">
      Actualizado: <span class="text-gray-300">${timeAgo(lastUpdate)}</span>
      · ${fetchedCount} activos
    </div>
    ${staleWarning}${failedWarning}
    <div class="text-gray-600 mt-1 text-[10px]">Click para refrescar</div>
  `;
  w.classList.remove('hidden');
}

// ─── Actualizar desde datos del endpoint /api/invest/positions ───────────────

/**
 * Llama con los metadatos devueltos por GET /api/invest/positions
 * para actualizar el widget sin hacer una llamada extra.
 */
window.updatePriceStatusFromPositions = function(priceUpdate) {
  if (!priceUpdate) return;
  _priceStatus.lastUpdate   = priceUpdate.updatedAt;
  _priceStatus.source       = priceUpdate.source;
  _priceStatus.fetchedCount = priceUpdate.fetchedCount;
  _priceStatus.staleCount   = priceUpdate.staleCount;
  _priceStatus.failedIds    = priceUpdate.failedIds || [];
  _priceStatus.hasIssues    = priceUpdate.hasStale || priceUpdate.hasFailed;

  renderWidget(_priceStatus);
  updatePositionCards(priceUpdate);
};

// ─── Indicador por tarjeta de posición ───────────────────────────────────────

/**
 * Añade un badge de frescura de precio a cada tarjeta de posición abierta.
 * Se llama después de que loadInvestPositions renderiza las cards.
 */
function updatePositionCards(priceUpdate) {
  if (!priceUpdate) return;
  // Marcar tarjetas que usan precio stale
  document.querySelectorAll('[data-position-id]').forEach(card => {
    const assetId = card.dataset.assetId;
    if (!assetId) return;

    // Eliminar badge previo
    card.querySelectorAll('.price-freshness-badge').forEach(b => b.remove());

    const isStale  = (priceUpdate.failedIds || []).includes(assetId) ||
                     priceUpdate.hasStale;
    const isFailed = (priceUpdate.failedIds || []).includes(assetId);

    if (!isFailed && !isStale) return; // precio fresco — sin badge

    const badge = document.createElement('div');
    badge.className = 'price-freshness-badge text-xs px-2 py-0.5 rounded font-semibold mt-1 inline-block';

    if (isFailed) {
      badge.className += ' bg-red-900/50 text-red-300';
      badge.textContent = '❌ Sin precio actualizado';
    } else {
      badge.className += ' bg-yellow-900/50 text-yellow-300';
      badge.textContent = `⚠️ Precio de caché · ${timeAgo(priceUpdate.updatedAt)}`;
    }

    // Intentar insertar después del precio en la card
    const priceEl = card.querySelector('.price-display, .current-price, [data-price]');
    if (priceEl) priceEl.insertAdjacentElement('afterend', badge);
    else card.appendChild(badge);
  });
}

// ─── Forzar refresco manual ───────────────────────────────────────────────────

window.forceRefreshPrices = async function() {
  const w = getOrCreateWidget();
  const prevHtml = w.innerHTML;
  w.innerHTML = '<div class="text-gray-400">⏳ Actualizando precios...</div>';

  try {
    const r = await fetch('/api/invest/prices/refresh', { method: 'POST' });
    const d = await r.json();
    if (d.success) {
      window.updatePriceStatusFromPositions({
        source:       d.source,
        updatedAt:    d.updatedAt,
        fetchedCount: d.fetchedCount,
        staleCount:   d.staleCount,
        failedIds:    d.failedIds || [],
        hasStale:     d.staleCount > 0,
        hasFailed:    (d.failedIds?.length || 0) > 0,
      });

      // Mostrar toast de resultado
      showPriceToast(d);

      // Refrescar la vista de posiciones si está disponible
      if (typeof loadInvestPositions === 'function') await loadInvestPositions();
    } else {
      w.innerHTML = prevHtml;
      console.warn('[price-status] refresh failed:', d.error);
    }
  } catch (e) {
    w.innerHTML = prevHtml;
    console.warn('[price-status] refresh error:', e.message);
  }
};

function showPriceToast(data) {
  const existing = document.getElementById('price-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'price-toast';

  const isOk = data.staleCount === 0 && (data.failedIds?.length || 0) === 0;
  toast.className = `fixed top-4 right-4 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold border ${
    isOk
      ? 'bg-emerald-900/90 text-emerald-300 border-emerald-700'
      : 'bg-yellow-900/90 text-yellow-300 border-yellow-700'
  }`;

  const label = SOURCE_LABELS[data.source] || data.source;
  toast.innerHTML = isOk
    ? `✅ Precios actualizados · ${label} · ${data.fetchedCount} activos`
    : `⚠️ ${data.fetchedCount} frescos · ${data.staleCount} stale · ${data.failedIds?.length||0} fallidos`;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Intervalo de refresco automático ────────────────────────────────────────
// Refresca los precios del caché cada 3 minutos en background.
// Nota: el watchdog (cada 30min) también llama fetchAndCachePrices internamente.

let _priceRefreshInterval = null;

function startPriceRefreshInterval() {
  if (_priceRefreshInterval) return;
  const INTERVAL_MS = 3 * 60 * 1000; // 3 minutos
  _priceRefreshInterval = setInterval(async () => {
    try {
      const r = await fetch('/api/invest/prices/refresh', { method: 'POST' });
      const d = await r.json();
      if (d.success) {
        window.updatePriceStatusFromPositions({
          source:       d.source,
          updatedAt:    d.updatedAt,
          fetchedCount: d.fetchedCount,
          staleCount:   d.staleCount,
          failedIds:    d.failedIds || [],
          hasStale:     d.staleCount > 0,
          hasFailed:    (d.failedIds?.length || 0) > 0,
        });
        // Mostrar toast solo si hay problemas
        if (d.staleCount > 0 || (d.failedIds?.length || 0) > 0) showPriceToast(d);
      }
    } catch (_) {}
  }, INTERVAL_MS);
  console.log('[price-status] Auto-refresh cada 3 min iniciado');
}

// ─── Interceptar loadInvestPositions ─────────────────────────────────────────
// Cuando el sistema carga posiciones, lee el campo priceUpdate y actualiza el widget.

const _origLoadInvestPositions = window.loadInvestPositions;
window.loadInvestPositions = async function(...args) {
  if (_origLoadInvestPositions) {
    const result = await _origLoadInvestPositions(...args);
    return result;
  }
};

// Interceptar el fetch a /api/invest/positions para capturar priceUpdate
const _origFetchForPrice = window.fetch;
window.fetch = function(url, options, ...rest) {
  const promise = _origFetchForPrice.call(this, url, options, ...rest);
  if (typeof url === 'string' && url.includes('/api/invest/positions') && !url.includes('close')) {
    return promise.then(async res => {
      // Clonar para leer sin consumir
      const clone = res.clone();
      try {
        const data = await clone.json();
        if (data?.priceUpdate) {
          window.updatePriceStatusFromPositions(data.priceUpdate);
        }
      } catch (_) {}
      return res;
    });
  }
  return promise;
};

// ─── Inicialización ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Esperar a que la app esté lista
  setTimeout(() => {
    startPriceRefreshInterval();
    // Primera carga del status
    fetch('/api/invest/prices/status')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.entries?.length) {
          const latest = d.entries[0];
          window.updatePriceStatusFromPositions({
            source:       latest ? 'cache' : 'none',
            updatedAt:    d.lastUpdated,
            fetchedCount: d.freshCount,
            staleCount:   d.staleCount,
            failedIds:    d.openWithIssues?.map(e => e.assetId) || [],
            hasStale:     d.staleCount > 0,
            hasFailed:    (d.openWithIssues?.length || 0) > 0,
          });
        }
      })
      .catch(() => {});
  }, 4000);
});
