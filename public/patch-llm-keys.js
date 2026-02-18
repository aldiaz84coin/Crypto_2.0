/**
 * ══════════════════════════════════════════════════════════════════
 *  PATCH: LLM Key Save Bug Fix + Agent Status + API Usage Indicators
 *  Incluir este <script> al FINAL del <body> en public/index.html
 *  (sobreescribe las funciones originales bugueadas)
 * ══════════════════════════════════════════════════════════════════
 *
 *  BUGS CORREGIDOS:
 *  1. saveAPIKey() no acepta parámetros → LLM keys nunca se guardaban
 *  2. Sin feedback visual de estado de conexión del agente
 *  3. Sin indicadores de límites/uso de cada API
 *
 *  NUEVAS FUNCIONES:
 *  - loadLLMStatus()     → Estado de conexión de cada agente LLM
 *  - renderLLMStatusPanel() → Panel visual con estado y límites
 */

// ── 1. FIX: saveAPIKey con soporte de parámetros ──────────────────────────────
//
// BUG ORIGINAL: la función solo usaba el modal global (currentApiKeyName).
// Los cards de LLMs llaman saveAPIKey('GEMINI_API_KEY','api-key-gemini')
// pero la función ignoraba esos parámetros → keys nunca se guardaban.
//
// FIX: si recibe (apiName, inputId), usa esos; si no, usa el modal global.

window.saveAPIKey = async function(apiName, inputId) {
  const isInline  = !!(apiName && inputId);   // llamada desde card directa
  const resolvedName = isInline ? apiName : (window.currentApiKeyName || '');

  const key = isInline
    ? (document.getElementById(inputId)?.value?.trim() || '')
    : (document.getElementById('apikey-input')?.value?.trim() || '');

  // Mensajes: inline (junto al botón) vs modal
  const inlineMsgId = isInline ? `llm-msg-${apiName}` : null;
  const modalMsg    = !isInline ? document.getElementById('apikey-msg') : null;

  function showMsg(html) {
    if (inlineMsgId) {
      const el = document.getElementById(inlineMsgId);
      if (el) el.innerHTML = html;
    } else if (modalMsg) {
      modalMsg.innerHTML = html;
    }
  }

  if (!key) {
    showMsg('<span class="text-red-400">⚠️ Introduce una key válida</span>');
    return;
  }
  if (!resolvedName) {
    showMsg('<span class="text-red-400">⚠️ Nombre de API no definido</span>');
    return;
  }

  showMsg('<span class="text-gray-400">⏳ Guardando...</span>');

  try {
    const r = await fetch('/api/config/api-key', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apiName: resolvedName, apiKey: key })
    });
    const d = await r.json();

    if (d.success) {
      showMsg('<span class="text-green-400">✅ Guardada correctamente</span>');

      if (isInline) {
        // Limpiar input y refrescar estado LLM
        const inputEl = document.getElementById(inputId);
        if (inputEl) inputEl.value = '';
        setTimeout(() => showMsg(''), 3000);
        loadLLMStatus();                    // refrescar badges
      } else {
        // Comportamiento original del modal
        setTimeout(() => {
          window.closeModal?.('modal-apikey');
          window.loadAPIStatus?.();
        }, 1500);
      }
    } else {
      showMsg(`<span class="text-red-400">❌ ${d.error}</span>`);
    }
  } catch (e) {
    showMsg(`<span class="text-red-400">❌ ${e.message}</span>`);
  }
};

// ── 2. NUEVO: Estado de conexión de agentes LLM ───────────────────────────────

const LLM_MODELS = [
  {
    id:       'gemini',
    apiName:  'GEMINI_API_KEY',
    inputId:  'api-key-gemini',
    label:    'Google Gemini',
    icon:     '🔷',
    tier:     'FREE',
    tierCss:  'bg-blue-950 text-blue-400',
    limit:    '1,500 req/día',
    cost:     'Gratis',
    model:    'gemini-1.5-flash',
    docsUrl:  'https://aistudio.google.com/apikey',
    note:     '1M tokens/día en capa gratuita'
  },
  {
    id:       'claude',
    apiName:  'ANTHROPIC_API_KEY',
    inputId:  'api-key-claude',
    label:    'Anthropic Claude',
    icon:     '🟣',
    tier:     'PAID',
    tierCss:  'bg-purple-950 text-purple-400',
    limit:    '1,000 req/min',
    cost:     '$3-15 / 1M tokens',
    model:    'claude-sonnet-4-20250514',
    docsUrl:  'https://console.anthropic.com/settings/keys',
    note:     'Sin tier gratuito — pago por uso'
  },
  {
    id:       'openai',
    apiName:  'OPENAI_API_KEY',
    inputId:  'api-key-openai',
    label:    'OpenAI GPT-4',
    icon:     '🟢',
    tier:     'PAID',
    tierCss:  'bg-green-950 text-green-400',
    limit:    '500 req/min',
    cost:     '$2.50-10 / 1M tokens',
    model:    'gpt-4o',
    docsUrl:  'https://platform.openai.com/api-keys',
    note:     'Requiere créditos prepago'
  },
  {
    id:       'groq',
    apiName:  'GROQ_API_KEY',
    inputId:  'api-key-groq',
    label:    'Groq Llama',
    icon:     '🟠',
    tier:     'FREE',
    tierCss:  'bg-orange-950 text-orange-400',
    limit:    '30 req/min',
    cost:     'Gratis',
    model:    'llama-3.3-70b-versatile',
    docsUrl:  'https://console.groq.com/keys',
    note:     '6,000 tokens/min en capa gratuita'
  }
];

// Carga el estado real desde /api/insights/keys-status y actualiza los badges
window.loadLLMStatus = async function() {
  try {
    const r = await fetch('/api/insights/keys-status');
    if (!r.ok) return;
    const d = await r.json();
    if (!d.success) return;

    // Actualizar badge por modelo
    LLM_MODELS.forEach(m => {
      const badge = document.getElementById(`llm-status-badge-${m.id}`);
      if (!badge) return;
      const configured = d.keys[m.id];
      if (configured) {
        badge.innerHTML = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-900 text-green-300 text-xs font-semibold">
          <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span> Conectado
        </span>`;
      } else {
        badge.innerHTML = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 text-xs">
          ⚪ Sin configurar
        </span>`;
      }
    });

    // Badge global en el header de la sección
    const globalBadge = document.getElementById('llm-global-badge');
    if (globalBadge) {
      const count = d.configured;
      if (count >= 2) {
        globalBadge.innerHTML = `<span class="text-green-400 text-sm font-semibold">✅ ${count}/4 agentes activos</span>`;
      } else {
        globalBadge.innerHTML = `<span class="text-yellow-400 text-sm">⚠️ ${count}/4 — se necesitan al menos 2</span>`;
      }
    }

  } catch (e) {
    console.warn('[loadLLMStatus] Error:', e.message);
  }
};

// ── 3. NUEVO: Inyectar panel de estado LLM en el DOM ─────────────────────────
//
// Busca los cards de LLM en el HTML y añade:
//   - Badge de estado de conexión
//   - Info de límites/uso
//   - Área de mensaje inline (para feedback al guardar)

function injectLLMStatusUI() {
  LLM_MODELS.forEach(m => {
    const inputEl = document.getElementById(m.inputId);
    if (!inputEl) return;   // card no existe en el DOM

    // ① Badge de estado (encima del input)
    if (!document.getElementById(`llm-status-badge-${m.id}`)) {
      const badge = document.createElement('div');
      badge.id = `llm-status-badge-${m.id}`;
      badge.className = 'mb-2';
      badge.innerHTML = `<span class="text-gray-600 text-xs">⏳ Verificando...</span>`;
      inputEl.parentNode.insertBefore(badge, inputEl);
    }

    // ② Info de límites (debajo del input)
    if (!document.getElementById(`llm-limits-${m.id}`)) {
      const limits = document.createElement('div');
      limits.id = `llm-limits-${m.id}`;
      limits.className = 'text-xs text-gray-600 mt-1 mb-2 flex flex-wrap gap-3';
      limits.innerHTML = `
        <span title="Límite de peticiones">⏱ ${m.limit}</span>
        <span title="Coste aproximado">💰 ${m.cost}</span>
        <span title="Modelo usado">🤖 ${m.model}</span>
        <span title="Nota">${m.note}</span>
      `;
      inputEl.parentNode.insertBefore(limits, inputEl.nextSibling);
    }

    // ③ Área de mensaje inline (para feedback de guardado)
    if (!document.getElementById(`llm-msg-${m.apiName}`)) {
      const msgDiv = document.createElement('div');
      msgDiv.id = `llm-msg-${m.apiName}`;
      msgDiv.className = 'text-xs min-h-[1.2rem] mt-1';
      const limitsEl = document.getElementById(`llm-limits-${m.id}`);
      const refEl = limitsEl ? limitsEl.nextSibling : inputEl.nextSibling;
      inputEl.parentNode.insertBefore(msgDiv, refEl);
    }
  });

  // ④ Badge global en header de la sección LLM
  const llmHeader = document.querySelector('h3.text-purple-400');   // "🧠 LLMs para Insights"
  if (llmHeader && !document.getElementById('llm-global-badge')) {
    const globalBadge = document.createElement('div');
    globalBadge.id = 'llm-global-badge';
    globalBadge.className = 'mt-1 mb-2';
    globalBadge.innerHTML = `<span class="text-gray-600 text-xs">⏳ Cargando estado...</span>`;
    llmHeader.parentNode.insertBefore(globalBadge, llmHeader.nextSibling);
  }
}

// ── 4. NUEVO: Panel de uso/consumo de API ────────────────────────────────────
//
// Muestra un resumen de consumo estimado en la tab Status.
// Se inyecta debajo del api-summary existente.

window.renderAPIUsagePanel = function() {
  const container = document.getElementById('api-summary');
  if (!container) return;

  // Evitar doble inserción
  if (document.getElementById('api-usage-panel')) return;

  const panel = document.createElement('div');
  panel.id = 'api-usage-panel';
  panel.className = 'mt-4 bg-gray-900 border border-gray-700 rounded-xl p-4';
  panel.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-sm font-semibold text-blue-400">📊 Límites y Consumo estimado</h3>
      <button onclick="loadAPIUsageStats()" class="text-xs text-gray-500 hover:text-white">🔄 Actualizar</button>
    </div>
    <div id="api-usage-content">
      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead>
            <tr class="text-gray-500 border-b border-gray-800">
              <th class="pb-2 pr-4">API / Agente</th>
              <th class="pb-2 pr-4">Tier</th>
              <th class="pb-2 pr-4">Límite</th>
              <th class="pb-2 pr-4">Coste</th>
              <th class="pb-2">Estado</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800" id="usage-table-body">
            ${LLM_MODELS.map(m => `
              <tr class="hover:bg-gray-800/40 transition-colors">
                <td class="py-2 pr-4 font-medium">${m.icon} ${m.label}</td>
                <td class="py-2 pr-4">
                  <span class="px-1.5 py-0.5 rounded text-xs ${m.tierCss}">${m.tier}</span>
                </td>
                <td class="py-2 pr-4 text-gray-400">${m.limit}</td>
                <td class="py-2 pr-4 text-gray-400">${m.cost}</td>
                <td class="py-2" id="usage-status-${m.id}">
                  <span class="text-gray-600">—</span>
                </td>
              </tr>
            `).join('')}
            <tr class="border-t border-gray-700">
              <td colspan="5" class="pt-3">
                <div class="text-gray-600 text-xs">
                  <strong class="text-gray-400">APIs de datos de mercado:</strong>
                  CoinGecko (libre · 30 req/min) · Alternative.me (libre) · Blockchain.info (libre) · 
                  CryptoCompare (100K calls/mes free) · NewsAPI (100 req/día free)
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  container.parentNode.insertBefore(panel, container.nextSibling);
};

// Actualiza la columna "Estado" de la tabla de uso con datos reales
window.loadAPIUsageStats = async function() {
  try {
    const r = await fetch('/api/insights/keys-status');
    if (!r.ok) return;
    const d = await r.json();
    if (!d.success) return;

    LLM_MODELS.forEach(m => {
      const cell = document.getElementById(`usage-status-${m.id}`);
      if (!cell) return;
      const configured = d.keys[m.id];
      cell.innerHTML = configured
        ? `<span class="inline-flex items-center gap-1 text-green-400">
             <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span> Configurado
           </span>`
        : `<span class="text-gray-600">Sin key</span>`;
    });
  } catch (e) {
    console.warn('[loadAPIUsageStats] Error:', e.message);
  }
};

// ── 5. OVERRIDE: loadAPIStatus para inyectar panel de uso ────────────────────

const _origLoadAPIStatus = window.loadAPIStatus;
window.loadAPIStatus = async function() {
  await _origLoadAPIStatus?.();
  renderAPIUsagePanel();
  loadAPIUsageStats();
};

// ── 6. OVERRIDE: openInsightsModal para mostrar estado actualizado ───────────

const _origOpenInsightsModal = window.openInsightsModal;
window.openInsightsModal = async function(...args) {
  await _origOpenInsightsModal?.(...args);
  // El modal ya consulta /api/insights/keys-status internamente,
  // pero además refrescamos los badges de los cards
  loadLLMStatus();
};

// ── INIT: Inyectar UI y cargar estados al arrancar ───────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Pequeño delay para que el HTML original termine de renderizar
  setTimeout(() => {
    injectLLMStatusUI();
    loadLLMStatus();
  }, 300);
});

// También re-inyectar si se navega al tab config (renderizado dinámico)
const _origSetTab = window.setTab;
window.setTab = function(tab) {
  _origSetTab?.(tab);
  if (tab === 'status' || tab === 'config') {
    setTimeout(() => {
      injectLLMStatusUI();
      loadLLMStatus();
      if (tab === 'status') {
        renderAPIUsagePanel();
        loadAPIUsageStats();
      }
    }, 200);
  }
};

console.log('[PATCH] LLM Key Fix + Agent Status + Usage Panel — cargado ✅');
