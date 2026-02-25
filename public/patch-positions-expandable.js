// public/patch-positions-expandable.js
// ═══════════════════════════════════════════════════════════════════════════
// PARCHE: Posiciones abiertas con desplegable
//
// Problema: La lista de posiciones abiertas en la ronda de inversión muestra
//           todas las tarjetas en un bloque estático, sin scroll ni collapse,
//           por lo que con más de 4 es difícil ver toda la información.
// Solución: Mostrar las primeras 4 posiciones visibles y colapsar el resto
//           tras un botón "Ver todas (N)" expandible/colapsable.
//
// INSTALACIÓN:
//   Añadir en public/index.html antes de </body>:
//   <script src="/patch-positions-expandable.js"></script>
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

console.log('[PATCH] positions-expandable ✅');

const _PX_VISIBLE = 4; // número de tarjetas visibles por defecto

// ─── Estado del desplegable ───────────────────────────────────────────────────
const _pxState = {
  expanded: false,
};

// ─── Inyectar controles de expand/collapse tras renderizar posiciones ─────────
function _pxApply() {
  const container = document.getElementById('inv-pos-open-list');
  if (!container) return;

  // Eliminar controles previos para evitar duplicados
  container.querySelectorAll('.px-expand-ctrl').forEach(el => el.remove());
  container.querySelectorAll('.px-hidden-group').forEach(el => {
    // Desplegar los hijos de vuelta al contenedor
    while (el.firstChild) container.insertBefore(el.firstChild, el);
    el.remove();
  });

  // Obtener todas las tarjetas de posición (hijos directos que sean elementos de posición)
  const cards = Array.from(container.children).filter(el =>
    el.tagName !== 'P' && !el.classList.contains('px-expand-ctrl')
  );

  if (cards.length <= _PX_VISIBLE) {
    // Menos de 5 tarjetas — no hace falta desplegable
    return;
  }

  // Tarjetas que se ocultarán
  const hidden = cards.slice(_PX_VISIBLE);
  const total  = cards.length;
  const rest   = hidden.length;

  // Crear un grupo envolvente para las tarjetas ocultas
  const group = document.createElement('div');
  group.className = 'px-hidden-group';
  group.style.cssText = `
    overflow: hidden;
    transition: max-height 0.35s ease, opacity 0.3s ease;
    max-height: ${_pxState.expanded ? '9999px' : '0'};
    opacity: ${_pxState.expanded ? '1' : '0'};
  `;

  // Mover tarjetas ocultas al grupo
  hidden.forEach(card => group.appendChild(card));
  container.appendChild(group);

  // ── Botón toggle ──────────────────────────────────────────────────────────
  const ctrl = document.createElement('div');
  ctrl.className = 'px-expand-ctrl';
  ctrl.style.cssText = `
    margin-top: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
  `;

  const btn = document.createElement('button');
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #374151;
    background: #1f2937;
    color: #9ca3af;
    transition: background 0.2s, color 0.2s;
    font-family: inherit;
  `;
  btn.onmouseover = () => { btn.style.background = '#374151'; btn.style.color = '#f3f4f6'; };
  btn.onmouseout  = () => { btn.style.background = '#1f2937'; btn.style.color = '#9ca3af'; };

  function _updateBtn() {
    if (_pxState.expanded) {
      btn.innerHTML = `<span>▲</span> Mostrar menos`;
      group.style.maxHeight = '9999px';
      group.style.opacity   = '1';
    } else {
      btn.innerHTML = `<span>▼</span> Ver todas · <span style="color:#60a5fa;font-weight:700">${total}</span> posiciones <span style="color:#6b7280">(${rest} más)</span>`;
      group.style.maxHeight = '0';
      group.style.opacity   = '0';
    }
  }

  btn.onclick = () => {
    _pxState.expanded = !_pxState.expanded;
    _updateBtn();
  };

  // Resumen compacto de las posiciones ocultas cuando están colapsadas
  const summaryEl = document.createElement('span');
  summaryEl.className = 'px-hidden-summary';
  summaryEl.style.cssText = 'font-size:11px;color:#6b7280;font-family:ui-monospace,monospace;';
  function _updateSummary() {
    if (_pxState.expanded) { summaryEl.textContent = ''; return; }
    // Calcular P&L de las posiciones ocultas
    let totalPnl = 0;
    let countPos = 0;
    let countNeg = 0;
    hidden.forEach(card => {
      // Buscar el span de P&L (busca texto con + o -)
      const pnlEl = card.querySelector('[class*="text-green-400"], [class*="text-red-400"]');
      if (pnlEl) {
        const val = parseFloat(pnlEl.textContent.replace(/[^0-9.\-+]/g, ''));
        if (!isNaN(val)) {
          totalPnl += val;
          if (val >= 0) countPos++; else countNeg++;
        }
      }
    });
    const color = totalPnl >= 0 ? '#4ade80' : '#f87171';
    const sign  = totalPnl >= 0 ? '+' : '';
    summaryEl.innerHTML = `<span style="color:${color}">${sign}$${totalPnl.toFixed(2)}</span> <span style="color:#374151">· ${countPos}↑ ${countNeg}↓</span>`;
  }

  _updateBtn();
  _updateSummary();

  ctrl.appendChild(btn);
  ctrl.appendChild(summaryEl);
  container.appendChild(ctrl);

  // Actualizar summary al expandir/colapsar
  const _origOnclick = btn.onclick;
  btn.onclick = () => {
    _origOnclick();
    _updateSummary();
  };
}

// ─── Hook sobre loadInvestPositions ──────────────────────────────────────────
// Esperamos a que el DOM esté listo y luego hookeamos la función principal.

function _hookLoadInvestPositions() {
  if (typeof window.loadInvestPositions !== 'function') {
    // Aún no definida — reintentar
    setTimeout(_hookLoadInvestPositions, 200);
    return;
  }

  const _orig = window.loadInvestPositions;
  window.loadInvestPositions = async function() {
    await _orig.apply(this, arguments);
    // Aplicar expandable después de que el DOM se haya actualizado
    requestAnimationFrame(() => {
      setTimeout(_pxApply, 50);
    });
  };

  console.log('[positions-expandable] ✅ Hook sobre loadInvestPositions instalado');
}

// ─── También hookear el botón manual "ABIERTAS" por si se re-renderiza solo ──
function _observeOpenList() {
  const target = document.getElementById('inv-pos-open-list');
  if (!target) { setTimeout(_observeOpenList, 500); return; }

  const obs = new MutationObserver(() => {
    // Pequeño debounce para no disparar en cada nodo
    clearTimeout(_observeOpenList._t);
    _observeOpenList._t = setTimeout(_pxApply, 80);
  });
  obs.observe(target, { childList: true, subtree: false });
}

// ─── CSS de transición ────────────────────────────────────────────────────────
function _injectExpandCSS() {
  if (document.getElementById('px-expand-css')) return;
  const s = document.createElement('style');
  s.id = 'px-expand-css';
  s.textContent = `
    .px-hidden-group { will-change: max-height, opacity; }
  `;
  document.head.appendChild(s);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
function _initPositionsExpandable() {
  _injectExpandCSS();
  _hookLoadInvestPositions();
  _observeOpenList();
  console.log('[positions-expandable] 🟢 Inicializado');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initPositionsExpandable);
} else {
  setTimeout(_initPositionsExpandable, 0);
}
