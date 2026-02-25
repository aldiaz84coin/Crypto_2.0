// public/patch-rounds-expandable.js
// ═══════════════════════════════════════════════════════════════════════════
// PARCHE: Desplegable de posiciones en la ronda activa (pestaña Rondas)
//
// Problema: patch-performance-v2.js renderiza las posiciones de la ronda
//           activa dentro de un <details> nativo que:
//             1. Tailwind CSS puede romper (display:block override)
//             2. Usa _p2_renderMiniPos — filas compactas sin detalle completo
//           Con más de 4 posiciones es imposible ver el estado de la ronda.
//
// Solución: Envuelve loadInvestRounds para:
//             1. Capturar los datos de posiciones antes de renderizar
//             2. Tras el render de v2, reemplazar el <details> con un
//                desplegable JS que usa renderPositionCard (tarjetas completas)
//             3. Separar: ABIERTAS primero (con badge animado), luego CERRADAS
//
// INSTALACIÓN (en public/index.html, ANTES de </body>):
//   <!-- Debe ir DESPUÉS de patch-performance-v2.js -->
//   <script src="/patch-rounds-expandable.js"></script>
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

console.log('[PATCH] rounds-expandable ✅');

// ─── Estado del desplegable ───────────────────────────────────────────────────
const _re = {
  expanded:  false,
  positions: null,   // roundPos capturadas en el último render
};

// ─── 1. Hook sobre loadInvestRounds ──────────────────────────────────────────
function _reHook() {
  if (typeof window.loadInvestRounds !== 'function') {
    setTimeout(_reHook, 200);
    return;
  }

  const _orig = window.loadInvestRounds;

  window.loadInvestRounds = async function () {
    // Capturar posiciones de la ronda activa ANTES de delegar al original
    _re.positions = null;
    try {
      const [roundsRes, posRes] = await Promise.all([
        fetch('/api/invest/rounds').then(r => r.json()),
        fetch('/api/invest/positions').then(r => r.json()),
      ]);

      if (roundsRes.success && roundsRes.current?.status === 'active') {
        const allPos     = posRes.success
          ? [...(posRes.open || []), ...(posRes.closed || [])]
          : [];
        const roundStart = roundsRes.current.openedAt
          ? new Date(roundsRes.current.openedAt).getTime()
          : 0;

        const roundPos = allPos.filter(p => {
          const pOpen = p.openedAt ? new Date(p.openedAt).getTime() : 0;
          return roundStart > 0 && pOpen >= roundStart;
        });

        // Orden: abiertas primero, luego cerradas ordenadas por fecha de cierre desc
        roundPos.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
          // Ambas cerradas: más reciente primero
          const ta = a.closedAt ? new Date(a.closedAt).getTime() : 0;
          const tb = b.closedAt ? new Date(b.closedAt).getTime() : 0;
          return tb - ta;
        });

        _re.positions = roundPos;
      }
    } catch (e) {
      console.warn('[rounds-expandable] Error capturando posiciones:', e.message);
    }

    // Delegar al original (patch-performance-v2 o index.html)
    await _orig.apply(this, arguments);

    // Post-procesar el DOM tras el render
    if (_re.positions && _re.positions.length > 0) {
      requestAnimationFrame(() => {
        setTimeout(_reInjectExpandable, 30);
      });
    }
  };

  console.log('[rounds-expandable] ✅ Hook sobre loadInvestRounds instalado');
}

// ─── 2. Inyectar el desplegable reemplazando el <details> ─────────────────────
function _reInjectExpandable() {
  const activeDiv = document.getElementById('inv-rounds-active');
  if (!activeDiv || !_re.positions) return;

  // Eliminar instancia previa del parche (re-renders)
  const prev = activeDiv.querySelector('#re-positions-block');
  if (prev) prev.remove();

  // Buscar el <details> nativo del v2 y eliminarlo
  const details = activeDiv.querySelector('details');
  if (details) details.remove();

  // También quitar texto "Sin posiciones registradas" si existe y hay posiciones
  activeDiv.querySelectorAll('p.text-xs.text-gray-600').forEach(el => {
    if (el.textContent.includes('Sin posiciones')) el.remove();
  });

  const positions = _re.positions;
  const total     = positions.length;
  const openPos   = positions.filter(p => p.status === 'open');
  const closedPos = positions.filter(p => p.status === 'closed');

  // ── Contenedor principal ──────────────────────────────────────────────────
  const block = document.createElement('div');
  block.id = 're-positions-block';
  block.style.marginTop = '12px';

  // ── Botón toggle ──────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';

  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = `
    display: inline-flex; align-items: center; gap: 7px;
    padding: 7px 14px; border-radius: 9px; cursor: pointer;
    border: 1px solid #374151; background: #1f2937;
    color: #9ca3af; font-size: 12px; font-weight: 600;
    font-family: inherit; transition: all 0.2s;
    flex: 1;
  `;
  toggleBtn.onmouseover = () => { toggleBtn.style.background = '#374151'; toggleBtn.style.color = '#f3f4f6'; };
  toggleBtn.onmouseout  = () => { toggleBtn.style.background = '#1f2937'; toggleBtn.style.color = '#9ca3af'; };

  // Resumen compacto siempre visible
  const summarySpan = document.createElement('span');
  summarySpan.style.cssText = 'font-size:11px;color:#6b7280;font-family:ui-monospace,monospace;flex-shrink:0;';

  function _updateSummary() {
    const unrealTotal = openPos.reduce((s, p) => s + (p.unrealizedPnL || 0), 0);
    const realTotal   = closedPos.reduce((s, p) => s + (p.realizedPnL || 0), 0);
    const uColor = unrealTotal >= 0 ? '#4ade80' : '#f87171';
    const rColor = realTotal   >= 0 ? '#4ade80' : '#f87171';
    const uSign  = unrealTotal >= 0 ? '+' : '';
    const rSign  = realTotal   >= 0 ? '+' : '';
    summarySpan.innerHTML =
      openPos.length   > 0 ? `<span style="color:${uColor}">${uSign}$${unrealTotal.toFixed(2)} unrealiz.</span>` : '' +
      closedPos.length > 0 ? `<span style="color:#4b5563"> · </span><span style="color:${rColor}">${rSign}$${realTotal.toFixed(2)} realiz.</span>` : '';
  }

  // ── Contenedor de tarjetas (colapsable) ───────────────────────────────────
  const cardContainer = document.createElement('div');
  cardContainer.style.cssText = `
    overflow: hidden;
    transition: max-height 0.4s ease, opacity 0.3s ease;
    max-height: 0; opacity: 0;
    margin-top: 4px;
  `;

  function _buildCards() {
    cardContainer.innerHTML = '';

    // Sección ABIERTAS
    if (openPos.length > 0) {
      const openHeader = document.createElement('p');
      openHeader.style.cssText = 'font-size:11px;font-weight:700;color:#4ade80;margin:10px 0 6px;letter-spacing:.05em;text-transform:uppercase;';
      openHeader.textContent = `● ABIERTAS (${openPos.length})`;
      cardContainer.appendChild(openHeader);

      openPos.forEach(p => {
        const wrapper = document.createElement('div');
        if (typeof renderPositionCard === 'function') {
          wrapper.innerHTML = renderPositionCard(p, true);
          // Arrancar timers de ciclo si hay cycleInfo
          const ci = p.cycleInfo || null;
          if (ci && typeof startPositionCycleTimer === 'function') {
            setTimeout(() => startPositionCycleTimer(p.id, ci), 60);
          }
        } else {
          wrapper.innerHTML = _reFallbackCard(p, true);
        }
        cardContainer.appendChild(wrapper);
      });
    }

    // Sección CERRADAS
    if (closedPos.length > 0) {
      const closedHeader = document.createElement('p');
      closedHeader.style.cssText = 'font-size:11px;font-weight:700;color:#6b7280;margin:14px 0 6px;letter-spacing:.05em;text-transform:uppercase;';
      closedHeader.textContent = `CERRADAS (${closedPos.length})`;
      cardContainer.appendChild(closedHeader);

      closedPos.forEach(p => {
        const wrapper = document.createElement('div');
        if (typeof renderPositionCard === 'function') {
          wrapper.innerHTML = renderPositionCard(p, false);
        } else {
          wrapper.innerHTML = _reFallbackCard(p, false);
        }
        cardContainer.appendChild(wrapper);
      });
    }
  }

  function _updateToggleBtn() {
    if (_re.expanded) {
      toggleBtn.innerHTML = `<span>▲</span> Ocultar posiciones`;
      cardContainer.style.maxHeight = '9999px';
      cardContainer.style.opacity   = '1';
    } else {
      const openBadge   = openPos.length   > 0 ? `<span style="color:#fbbf24;font-weight:700">${openPos.length} abiertas</span>` : '';
      const closedBadge = closedPos.length > 0 ? `<span style="color:#6b7280">${closedPos.length} cerradas</span>` : '';
      const sep = openPos.length > 0 && closedPos.length > 0 ? ' · ' : '';
      toggleBtn.innerHTML = `<span>▼</span> Ver todas · <b style="color:#60a5fa">${total}</b> posiciones &nbsp;(${openBadge}${sep}${closedBadge})`;
      cardContainer.style.maxHeight = '0';
      cardContainer.style.opacity   = '0';
    }
  }

  toggleBtn.onclick = () => {
    _re.expanded = !_re.expanded;
    if (_re.expanded && cardContainer.childElementCount === 0) {
      _buildCards(); // construir tarjetas la primera vez que se abre
    }
    _updateToggleBtn();
    _updateSummary();
  };

  _updateToggleBtn();
  _updateSummary();

  header.appendChild(toggleBtn);
  header.appendChild(summarySpan);
  block.appendChild(header);
  block.appendChild(cardContainer);

  // Insertar al final del card de la ronda activa
  const roundCard = activeDiv.querySelector('.bg-gray-900, .bg-blue-950');
  if (roundCard) {
    roundCard.appendChild(block);
  } else {
    activeDiv.appendChild(block);
  }
}

// ─── 3. Fallback si renderPositionCard no está disponible ─────────────────────
// Tarjeta algo más rica que _p2_renderMiniPos pero sin depender del original
function _reFallbackCard(p, isOpen) {
  const pnl    = isOpen ? (p.unrealizedPnL || 0) : (p.realizedPnL || 0);
  const pnlPct = isOpen ? (p.unrealizedPnLPct || 0) : (p.realizedPnLPct || 0);
  const sign   = pnl >= 0 ? '+' : '';
  const color  = pnl >= 0 ? '#4ade80' : '#f87171';
  const border = isOpen ? '#1d4ed8' : pnl >= 0 ? '#14532d' : '#7f1d1d';

  const entryFmt = p.entryPrice ? `$${parseFloat(p.entryPrice).toFixed(4)}` : '—';
  const currFmt  = p.currentPrice ? `$${parseFloat(p.currentPrice).toFixed(4)}` : '—';
  const capitalFmt = `$${(p.capitalUSD || 0).toFixed(2)}`;
  const reason   = p.closeReason || (isOpen ? '● ABIERTA' : 'cerrada');

  return `
    <div style="background:#111827;border:1px solid ${border};border-radius:10px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <div>
          <span style="font-weight:700;font-size:14px;color:#f1f5f9">${p.name || p.symbol || p.assetId || '—'}</span>
          <span style="color:#6b7280;font-size:11px;margin-left:6px;font-family:monospace">${(p.symbol||'').toUpperCase()}</span>
          ${isOpen
            ? `<span style="background:#1d3a5f;color:#93c5fd;font-size:10px;padding:1px 7px;border-radius:4px;margin-left:6px;font-weight:700">● ABIERTA</span>`
            : `<span style="background:#1f2937;color:#9ca3af;font-size:10px;padding:1px 7px;border-radius:4px;margin-left:6px">${reason}</span>`}
        </div>
        <div style="text-align:right">
          <span style="color:${color};font-weight:700;font-size:16px;font-family:monospace">${sign}${pnl.toFixed(2)} USD</span><br>
          <span style="color:${color};font-size:12px;font-family:monospace">${sign}${pnlPct.toFixed(2)}%</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:11px;color:#6b7280;">
        <div><span>Capital: </span><span style="color:#d1d5db">${capitalFmt}</span></div>
        <div><span>Entrada: </span><span style="color:#d1d5db;font-family:monospace">${entryFmt}</span></div>
        <div><span>Actual: </span><span style="color:#d1d5db;font-family:monospace">${currFmt}</span></div>
      </div>
    </div>`;
}

// ─── 4. CSS de transición ─────────────────────────────────────────────────────
function _reInjectCSS() {
  if (document.getElementById('re-css')) return;
  const s = document.createElement('style');
  s.id = 're-css';
  s.textContent = `
    #re-positions-block .pos-card-transition {
      will-change: max-height, opacity;
    }
    /* Asegurar que <details> en inv-rounds-active no bloquee el contenido */
    #inv-rounds-active details > div {
      display: block !important;
    }
  `;
  document.head.appendChild(s);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function _initRoundsExpandable() {
  _reInjectCSS();
  _reHook();
  console.log('[rounds-expandable] 🟢 Inicializado');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initRoundsExpandable);
} else {
  setTimeout(_initRoundsExpandable, 0);
}
