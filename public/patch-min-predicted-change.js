// ═══════════════════════════════════════════════════════════════════════════
// PATCH: minPredictedChange en el Wizard de Nueva Ronda
// Inyecta el selector en el modal y lo incluye en el payload al abrir ronda.
// Añadir en un <script> al final de index.html, o como archivo separado.
// ═══════════════════════════════════════════════════════════════════════════

(function patchMinPredictedChange() {

  // ── 1. Parchear openNewRoundWizard para inyectar el nuevo campo ─────────
  const _origOpenWizard = window.openNewRoundWizard;

  window.openNewRoundWizard = async function (...args) {
    // Ejecutar el wizard original
    await _origOpenWizard?.apply(this, args);

    // Esperar a que el DOM del modal esté renderizado
    requestAnimationFrame(() => {
      const modal = document.getElementById('new-round-modal');
      if (!modal) return;

      // Evitar inyección doble
      if (modal.querySelector('#nr-min-pred')) return;

      // Leer valor actual de config (si estaba guardado en suggestions)
      const currentMinPred = window._lastRoundSuggestions?.minPredictedChange ?? 0;

      // Construir el nuevo bloque HTML
      const wrapper = document.createElement('div');
      wrapper.innerHTML = buildMinPredSelectorHTML(currentMinPred);

      // Insertarlo justo antes del bloque de Modo / Exchange (último grid del form)
      // Buscamos el select de modo como ancla
      const modeSelect = modal.querySelector('#nr-mode');
      if (modeSelect) {
        const modeGrid = modeSelect.closest('.grid');
        if (modeGrid) {
          modeGrid.parentNode.insertBefore(wrapper.firstElementChild, modeGrid);
        }
      }
    });
  };

  // ── 2. Guardar suggestions para que el patch las lea ───────────────────
  // Parchear la llamada fetch de recommendations para capturar minPredictedChange
  const _origFetch = window.fetch;
  window.fetch = function (url, options, ...rest) {
    const promise = _origFetch.call(this, url, options, ...rest);
    if (typeof url === 'string' && url.includes('/api/invest/rounds/recommendations')) {
      promise.then(r => r.clone().json()).then(d => {
        if (d.success) {
          window._lastRoundSuggestions = {
            ...(window._lastRoundSuggestions || {}),
            minPredictedChange: d.currentConfig?.minPredictedChange ?? 0,
          };
        }
      }).catch(() => {});
    }
    return promise;
  };

  // ── 3. Parchear submitNewRound para incluir minPredictedChange ──────────
  const _origSubmit = window.submitNewRound;

  window.submitNewRound = async function (...args) {
    // Leer el campo antes de que el original lo envíe
    const minPredEl = document.getElementById('nr-min-pred');
    const minPredValue = minPredEl ? parseFloat(minPredEl.value) : 0;

    // Parchear fetch temporalmente para inyectar el campo
    const _patchedFetch = window.fetch;
    window.fetch = function (url, options, ...rest) {
      if (typeof url === 'string' && url.includes('/api/invest/rounds/open') && options?.method === 'POST') {
        try {
          const body = JSON.parse(options.body || '{}');
          body.minPredictedChange = minPredValue;
          options = { ...options, body: JSON.stringify(body) };
        } catch (_) {}
      }
      return _patchedFetch.call(this, url, options, ...rest);
    };

    try {
      await _origSubmit?.apply(this, args);
    } finally {
      // Restaurar fetch original
      window.fetch = _patchedFetch;
    }
  };

  // ── 4. HTML del selector ────────────────────────────────────────────────
  function buildMinPredSelectorHTML(currentVal = 0) {
    const options = [
      { value: 0,    label: 'Sin filtro (cualquier subida prevista)' },
      { value: 1,    label: '≥ 1%' },
      { value: 2,    label: '≥ 2%' },
      { value: 3,    label: '≥ 3%' },
      { value: 5,    label: '≥ 5%' },
      { value: 7,    label: '≥ 7%' },
      { value: 10,   label: '≥ 10%' },
      { value: 15,   label: '≥ 15%' },
    ];

    const optionsHTML = options.map(o =>
      `<option value="${o.value}" ${Math.abs(o.value - currentVal) < 0.01 ? 'selected' : ''}>${o.label}</option>`
    ).join('');

    return `
      <div class="grid grid-cols-1 gap-3" id="nr-min-pred-block">
        <div>
          <label class="text-xs text-gray-400 block mb-1">
            📈 Subida mínima prevista
            <span class="text-gray-600 ml-1">(filtra activos con predicción demasiado baja)</span>
          </label>
          <select id="nr-min-pred"
            class="w-full bg-gray-800 border border-indigo-900 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none text-indigo-200">
            ${optionsHTML}
          </select>
          <p class="text-xs text-gray-600 mt-1">
            Los activos se ordenan de mayor a menor subida prevista. El BoostPower actúa como desempate.
          </p>
        </div>
      </div>`;
  }

  console.log('[patch-min-predicted-change] ✅ Cargado correctamente');

})();
