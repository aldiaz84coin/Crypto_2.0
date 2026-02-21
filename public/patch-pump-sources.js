/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: Panel de Estado de Fuentes · Detector de Ingerencias
 *
 *  INSTRUCCIONES DE INSTALACIÓN:
 *  Añadir al final del <body> en public/index.html, justo DESPUÉS
 *  de la línea que carga patch-llm-keys.js:
 *
 *    <script src="/patch-llm-keys.js"></script>
 *    <script src="/patch-pump-sources.js"></script>  ← añadir esta
 *
 *  NO tocar nada más del index.html.
 * ══════════════════════════════════════════════════════════════════
 *
 *  QUÉ HACE:
 *  1. Añade sub-tab "🔌 Fuentes" en el detector de pump
 *  2. Muestra estado online/offline de cada fuente externa
 *  3. Indica si está configurada, si alimenta el detector y latencia
 *  4. Panel inline para configurar API keys desde la UI
 *  5. Tabla resumen de puntuación máxima alcanzable
 *  6. Datos reales desde /api/status (mismo backend que pestaña Estado)
 */

// ── Mapa de fuentes relevantes para el detector de pump ──────────────────────
// Indica qué fuentes del api-health-check son usadas por el pump-detector
// y qué señal/puntuación aporta cada una.
const PUMP_SOURCE_MAP = {
  reddit:       { signal: 'Lenguaje pump + clones sociales', pts: 2, envKey: null,                   docsUrl: null,                                          category: 'Social'   },
  coingecko:    { signal: 'Volumen anormal 7 días',          pts: 2, envKey: null,                   docsUrl: null,                                          category: 'Mercado'  },
  whaleAlert:   { signal: 'Actividad de ballenas',           pts: 2, envKey: 'WHALE_ALERT_API_KEY',  docsUrl: 'https://whale-alert.io/api',                  category: 'On-chain' },
  telegram:     { signal: 'Crecimiento artificial grupos',   pts: 1, envKey: 'TELEGRAM_BOT_TOKEN',   docsUrl: 'https://core.telegram.org/bots',              category: 'Social'   },
  cryptocompare:{ signal: 'Noticias vacuas / sin sustancia', pts: 1, envKey: 'CRYPTOCOMPARE_API_KEY',docsUrl: 'https://www.cryptocompare.com/cryptopian/api-keys', category: 'Noticias' },
  lunarcrush:   { signal: 'Galaxy Score + Alt Rank spike',   pts: 1, envKey: 'LUNARCRUSH_API_KEY',   docsUrl: 'https://lunarcrush.com/developers',           category: 'Social'   },
  twitter:      { signal: 'Sentimiento + spike menciones',   pts: 2, envKey: 'TWITTER_BEARER_TOKEN', docsUrl: 'https://developer.twitter.com',               category: 'Social'   },
  alternative:  { signal: 'Fear & Greed (contexto pump)',    pts: 0, envKey: null,                   docsUrl: null,                                          category: 'Mercado'  },
};

const TIER_STYLE = {
  free:     { label: 'FREE',     css: 'background:#052e16;color:#22c55e;border:1px solid #166534' },
  freemium: { label: 'FREEMIUM', css: 'background:#1c1200;color:#fbbf24;border:1px solid #92400e' },
  paid:     { label: 'PAID',     css: 'background:#1c0a00;color:#fb923c;border:1px solid #9a3412' },
  premium:  { label: 'PREMIUM',  css: 'background:#1c0a0a;color:#f87171;border:1px solid #991b1b' },
  limited:  { label: 'FREE',     css: 'background:#052e16;color:#22c55e;border:1px solid #166534' },
};

const CAT_COLOR = {
  Social: '#a78bfa', Mercado: '#60a5fa', Noticias: '#34d399', 'On-chain': '#fbbf24'
};

// ── 1. INYECTAR SUB-TAB "FUENTES" EN EL DOM ──────────────────────────────────

function injectPumpSourcesTab() {
  // Evitar doble inyección
  if (document.getElementById('pumptab-pump-fuentes')) return;

  // Añadir botón al tab bar de pump
  const tabBar = document.querySelector('.pumptab')?.parentElement;
  if (!tabBar) return;

  const btn = document.createElement('button');
  btn.id        = 'pumptab-pump-fuentes';
  btn.className = 'pumptab flex-1 py-1.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors';
  btn.textContent = '🔌 Fuentes';
  btn.setAttribute('onclick', "openPumpTab('pump-fuentes')");
  tabBar.appendChild(btn);

  // Crear panel de contenido
  const panel = document.createElement('div');
  panel.id        = 'pump-fuentes';
  panel.className = 'pumptab-content hidden';
  panel.innerHTML = `
    <!-- Header del panel -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div>
        <p class="text-sm font-semibold text-gray-200">🔌 Estado de Fuentes Externas</p>
        <p class="text-xs text-gray-500 mt-0.5" id="pump-sources-timestamp">—</p>
      </div>
      <button onclick="loadPumpSources(true)"
        class="bg-gray-800 hover:bg-gray-700 px-4 py-1.5 rounded-lg text-xs font-semibold text-gray-300">
        ⟳ Reverificar
      </button>
    </div>

    <!-- Pills resumen -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px" id="pump-sources-summary">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
        <div class="text-2xl font-bold text-gray-600" id="psm-online">—</div>
        <div class="text-xs text-gray-500 mt-0.5">Online</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
        <div class="text-2xl font-bold text-gray-600" id="psm-configured">—</div>
        <div class="text-xs text-gray-500 mt-0.5">Configuradas</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
        <div class="text-2xl font-bold text-gray-600" id="psm-pts">—</div>
        <div class="text-xs text-gray-500 mt-0.5">Pts disponibles</div>
      </div>
    </div>

    <!-- Barra de cobertura -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-4">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span class="text-xs text-gray-400">Cobertura del detector</span>
        <span class="text-xs font-bold text-white" id="psm-coverage-pct">—</span>
      </div>
      <div style="background:#1e293b;border-radius:4px;height:6px;overflow:hidden">
        <div id="psm-coverage-bar" style="height:100%;width:0%;background:#22c55e;border-radius:4px;transition:width 0.8s ease"></div>
      </div>
    </div>

    <!-- Cards de fuentes -->
    <div id="pump-sources-list" class="space-y-2">
      <p class="text-gray-500 text-sm text-center py-6">⏳ Cargando estado de fuentes...</p>
    </div>

    <!-- Tabla de puntuación -->
    <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 mt-4">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">📊 Puntuación máxima por fuente</p>
      <div id="pump-pts-table" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px"></div>
      <div style="margin-top:10px;padding:8px 12px;background:#13111e;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
        <span class="text-xs text-gray-500">Score máximo activo / máximo teórico</span>
        <span class="text-sm font-bold" id="pump-pts-total" style="color:#a78bfa">— / 10 pts</span>
      </div>
    </div>
  `;

  // Insertar después del último pumptab-content existente
  const lastContent = [...document.querySelectorAll('.pumptab-content')].pop();
  if (lastContent) lastContent.after(panel);
}

// ── 2. CARGAR Y RENDERIZAR FUENTES ───────────────────────────────────────────

window.loadPumpSources = async function(force = false) {
  const list = document.getElementById('pump-sources-list');
  if (!list) return;

  if (!force && list.dataset.loaded === '1') return; // ya cargado, no repetir

  list.innerHTML = '<p class="text-gray-500 text-sm text-center py-6">⏳ Consultando APIs...</p>';

  try {
    const r = await fetch('/api/status/complete');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();

    const ts = document.getElementById('pump-sources-timestamp');
    if (ts && d.timestamp) {
      ts.textContent = `Última verificación: ${new Date(d.timestamp).toLocaleTimeString('es-ES')}`;
    }

    renderPumpSources(d.apis || {});
    list.dataset.loaded = '1';

  } catch (e) {
    list.innerHTML = `<p class="text-red-400 text-sm text-center py-4">❌ Error al obtener estado: ${e.message}</p>`;
  }
};

function renderPumpSources(apis) {
  const list = document.getElementById('pump-sources-list');
  if (!list) return;

  // Filtrar solo las fuentes relevantes al pump-detector
  const sources = Object.entries(PUMP_SOURCE_MAP)
    .map(([key, meta]) => ({ key, meta, api: apis[key] || null }))
    .sort((a, b) => (b.meta.pts || 0) - (a.meta.pts || 0)); // ordenar por puntos desc

  let onlineCount = 0, configuredCount = 0, activeScore = 0;

  const html = sources.map(({ key, meta, api }) => {
    const isOnline     = api?.available ?? false;
    const isConfigured = api?.configured ?? false;
    const isFeeding    = isOnline && isConfigured;
    const tier         = api?.tier || 'free';
    const tierMeta     = TIER_STYLE[tier] || TIER_STYLE.free;
    const latency      = api?.responseTime || null;
    const statusMsg    = api?.message || '—';
    const needsKey     = !!meta.envKey;

    if (isOnline)     onlineCount++;
    if (isConfigured) configuredCount++;
    if (isFeeding && meta.pts > 0) activeScore += meta.pts;

    const dotColor  = !api ? '#475569' : isOnline ? '#22c55e' : '#ef4444';
    const borderCol = !api ? '#1e293b' : isOnline ? '#22c55e22' : needsKey && !isConfigured ? '#f59e0b22' : '#ef444422';

    const statusBadge   = isOnline
      ? `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#052e16;color:#22c55e;border:1px solid #166534">✓ Online</span>`
      : `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1c0a0a;color:#ef4444;border:1px solid #991b1b">✗ Offline</span>`;

    const configBadge = !needsKey
      ? `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#0c1a2e;color:#60a5fa;border:1px solid #1e3a5f">🔓 Sin key</span>`
      : isConfigured
        ? `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#0c1a2e;color:#60a5fa;border:1px solid #1e3a5f">🔑 Configurada</span>`
        : `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1c1200;color:#fbbf24;border:1px solid #92400e">⚠ Sin key</span>`;

    const feedBadge = isFeeding
      ? `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1a0c2e;color:#a78bfa;border:1px solid #6d28d9">⚡ Activa</span>`
      : `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1e293b;color:#475569;border:1px solid #334155">○ Inactiva</span>`;

    const ptsLabel = meta.pts > 0
      ? `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1a0c2e;color:#a78bfa;border:1px solid #6d28d9;font-weight:700">+${meta.pts} pts</span>`
      : `<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1e293b;color:#64748b;border:1px solid #334155">contexto</span>`;

    const configPanel = needsKey ? `
      <div id="pump-key-panel-${key}" style="display:none;border-top:1px solid #1e3a5f;background:#0c1525;padding:12px 14px">
        <p style="margin:0 0 8px;font-size:11px;color:#60a5fa;font-weight:700">
          🔑 Configurar <code style="color:#a78bfa">${meta.envKey}</code>
        </p>
        ${isConfigured ? `
          <div style="background:#052e16;border:1px solid #166534;border-radius:6px;padding:7px 10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:11px;color:#22c55e">✓ Key activa — guardada en Redis</span>
            <button onclick="removePumpSourceKey('${key}','${meta.envKey}')"
              style="background:#1c0a0a;border:1px solid #991b1b;color:#ef4444;padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer">
              ✕ Eliminar
            </button>
          </div>` : ''}
        <div style="display:flex;gap:6px">
          <input type="password" id="pump-key-input-${key}"
            placeholder="Pega tu ${meta.envKey} aquí"
            style="flex:1;background:#0f172a;border:1px solid #334155;color:#f1f5f9;padding:7px 10px;border-radius:6px;font-size:12px;font-family:monospace;outline:none"
            onkeydown="if(event.key==='Enter') savePumpSourceKey('${key}','${meta.envKey}')"
          />
          <button onclick="savePumpSourceKey('${key}','${meta.envKey}')"
            style="background:#1e3a5f;border:1px solid #2563eb;color:#60a5fa;padding:7px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">
            Guardar
          </button>
        </div>
        ${meta.docsUrl ? `<p style="margin:6px 0 0;font-size:10px;color:#475569">
          📎 Obtener key: <a href="${meta.docsUrl}" target="_blank" style="color:#60a5fa">${meta.docsUrl}</a>
        </p>` : ''}
        <div id="pump-key-msg-${key}" style="font-size:11px;min-height:1.2rem;margin-top:4px"></div>
      </div>` : '';

    const configBtn = needsKey ? `
      <button onclick="togglePumpKeyPanel('${key}')" id="pump-key-btn-${key}"
        style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer">
        ⚙ Config
      </button>` : '';

    return `
      <div style="background:#0f172a;border:1px solid ${borderCol};border-radius:10px;overflow:hidden;transition:border-color 0.3s">
        <!-- Fila principal -->
        <div style="padding:11px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">

          <!-- Dot de estado -->
          <div style="width:9px;height:9px;border-radius:50%;background:${dotColor};flex-shrink:0;
            ${isOnline ? `box-shadow:0 0 7px ${dotColor}` : ''}"></div>

          <!-- Nombre y categoría -->
          <div style="min-width:120px">
            <div style="font-size:13px;font-weight:700;color:#f1f5f9">${api?.name || key}</div>
            <div style="font-size:10px;color:${CAT_COLOR[meta.category] || '#94a3b8'}">${meta.category}</div>
          </div>

          <!-- Tier -->
          <span style="font-size:9px;font-weight:700;letter-spacing:0.05em;padding:2px 7px;border-radius:4px;${tierMeta.css}">${tierMeta.label}</span>

          <!-- Señal -->
          <div style="flex:1;min-width:100px">
            <div style="font-size:11px;color:#94a3b8">${meta.signal}</div>
          </div>

          <!-- Badges -->
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
            ${statusBadge}
            ${configBadge}
            ${feedBadge}
            ${ptsLabel}
            ${latency && isOnline ? `<span style="font-size:10px;color:#475569">${latency}ms</span>` : ''}
          </div>

          <!-- Botón config -->
          ${configBtn}
          <button onclick="recheckPumpSource('${key}')"
            style="background:transparent;border:1px solid #334155;color:#64748b;padding:4px 7px;border-radius:6px;font-size:11px;cursor:pointer"
            title="Reverificar esta fuente">⟳</button>
        </div>

        <!-- Descripción y error -->
        <div style="padding:0 14px 9px 33px">
          <p style="margin:0;font-size:10px;color:#475569">${statusMsg}</p>
          ${!isOnline && api?.configInstructions ? `<a href="${api.configInstructions}" target="_blank" style="font-size:10px;color:#60a5fa">→ Instrucciones de configuración</a>` : ''}
        </div>

        <!-- Panel de config de key (expandible) -->
        ${configPanel}
      </div>`;
  }).join('');

  list.innerHTML = html;

  // Actualizar pills de resumen
  const maxPts = Object.values(PUMP_SOURCE_MAP).reduce((a, m) => a + m.pts, 0);
  const coverage = Math.round((activeScore / Math.max(maxPts, 1)) * 100);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('psm-online',      `${onlineCount}/${sources.length}`);
  setEl('psm-configured',  `${configuredCount}/${sources.length}`);
  setEl('psm-pts',         `${activeScore}/${maxPts}`);
  setEl('psm-coverage-pct', `${coverage}%`);

  const bar = document.getElementById('psm-coverage-bar');
  if (bar) {
    bar.style.width = `${coverage}%`;
    bar.style.background = coverage >= 70 ? '#22c55e' : coverage >= 40 ? '#f59e0b' : '#ef4444';
  }

  // Actualizar colores de summary pills
  const onlineEl = document.getElementById('psm-online');
  if (onlineEl) onlineEl.style.color = onlineCount >= 4 ? '#22c55e' : onlineCount >= 2 ? '#f59e0b' : '#ef4444';

  // Tabla de puntuación por fuente
  renderPtsTalbe(sources, apis);
}

function renderPtsTalbe(sources, apis) {
  const table = document.getElementById('pump-pts-table');
  const totalEl = document.getElementById('pump-pts-total');
  if (!table) return;

  let activeScore = 0;
  const maxPts = Object.values(PUMP_SOURCE_MAP).reduce((a, m) => a + m.pts, 0);

  const cards = sources
    .filter(({ meta }) => meta.pts > 0)
    .map(({ key, meta, api }) => {
      const active = api?.available && api?.configured;
      if (active) activeScore += meta.pts;
      return `
        <div style="background:${active ? '#1a0c2e' : '#0f172a'};border:1px solid ${active ? '#6d28d9' : '#1e293b'};
          border-radius:7px;padding:8px 10px;opacity:${active ? 1 : 0.45}">
          <div style="font-size:10px;color:#64748b;margin-bottom:2px">${api?.name || key}</div>
          <div style="font-size:18px;font-weight:800;color:${active ? '#a78bfa' : '#334155'}">
            ${active ? `+${meta.pts}` : `+0`}
            <span style="font-size:9px;color:#475569;font-weight:400"> / +${meta.pts}</span>
          </div>
        </div>`;
    }).join('');

  table.innerHTML = cards;
  if (totalEl) {
    totalEl.textContent = `${activeScore} / ${maxPts} pts`;
    totalEl.style.color = activeScore >= 7 ? '#22c55e' : activeScore >= 4 ? '#f59e0b' : '#a78bfa';
  }
}

// ── 3. ACCIONES: TOGGLE PANEL, GUARDAR / ELIMINAR KEY ────────────────────────

window.togglePumpKeyPanel = function(key) {
  const panel = document.getElementById(`pump-key-panel-${key}`);
  const btn   = document.getElementById(`pump-key-btn-${key}`);
  if (!panel) return;
  const open = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = open ? 'block' : 'none';
  if (btn) {
    btn.style.background    = open ? '#1e3a5f' : '#1e293b';
    btn.style.borderColor   = open ? '#2563eb' : '#334155';
    btn.style.color         = open ? '#60a5fa' : '#94a3b8';
    btn.textContent         = open ? '↑ Cerrar' : '⚙ Config';
  }
};

window.savePumpSourceKey = async function(sourceKey, envKey) {
  const input  = document.getElementById(`pump-key-input-${sourceKey}`);
  const msgEl  = document.getElementById(`pump-key-msg-${sourceKey}`);
  const val    = input?.value?.trim();

  if (!val) { if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444">⚠ Introduce una key válida</span>'; return; }
  if (msgEl) msgEl.innerHTML = '<span style="color:#94a3b8">⏳ Guardando...</span>';

  try {
    const r = await fetch('/api/config/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiName: envKey, apiKey: val })
    });
    const d = await r.json();
    if (d.success) {
      if (msgEl) msgEl.innerHTML = '<span style="color:#22c55e">✅ Guardada correctamente</span>';
      if (input) input.value = '';
      setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 3000);
      // Recargar panel después de guardar
      setTimeout(() => loadPumpSources(true), 800);
    } else {
      if (msgEl) msgEl.innerHTML = `<span style="color:#ef4444">❌ ${d.error}</span>`;
    }
  } catch (e) {
    if (msgEl) msgEl.innerHTML = `<span style="color:#ef4444">❌ ${e.message}</span>`;
  }
};

window.removePumpSourceKey = async function(sourceKey, envKey) {
  if (!confirm(`¿Eliminar la key ${envKey}? La fuente dejará de alimentar el detector.`)) return;
  try {
    await fetch('/api/config/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiName: envKey, apiKey: '' }) // guardar vacío = borrar
    });
    loadPumpSources(true);
  } catch (e) {
    alert('❌ Error al eliminar key: ' + e.message);
  }
};

window.recheckPumpSource = async function(key) {
  // Reverifica solo esta fuente recargando todo el panel
  // (el endpoint /api/status verifica en paralelo en ~4s)
  await loadPumpSources(true);
};

// ── 4. OVERRIDE openPumpTab para cargar el panel al entrar ───────────────────

const _origOpenPumpTab = window.openPumpTab;
window.openPumpTab = function(tab) {
  _origOpenPumpTab(tab);
  if (tab === 'pump-fuentes') {
    loadPumpSources();
  }
};

// ── 5. INIT: inyectar UI cuando el DOM esté listo ────────────────────────────

function tryInject() {
  // El div pump-results existe → el HTML del detector ya está en el DOM
  if (document.getElementById('pump-results')) {
    injectPumpSourcesTab();
  } else {
    setTimeout(tryInject, 300);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(tryInject, 400));
} else {
  setTimeout(tryInject, 400);
}

// Re-inyectar si se navega a la pestaña pump desde el tab principal
const _origSetTabForPump = window.setTab;
window.setTab = function(tab) {
  _origSetTabForPump?.(tab);
  if (tab === 'pump') {
    setTimeout(injectPumpSourcesTab, 200);
  }
};

console.log('[PATCH] pump-sources panel — cargado ✅');
