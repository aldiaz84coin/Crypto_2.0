// api/scenarios-endpoint.js — Endpoint para análisis de escenarios
// Integrar en api/index.js (o cycles-endpoints.js):
//
//   const scenarioSimulator = require('./scenario-simulator');
//   require('./scenarios-endpoint')(app, redis, cyclesManager, getInvestConfig);
//
'use strict';

const scenarioSimulator = require('./scenario-simulator');
const temporalPrediction = require('./temporal-prediction');

module.exports = function registerScenariosEndpoints(app, redis, cyclesManager, getInvestConfig, getCompletedCycles) {

  // ── GET /api/cycles/:id/scenarios ────────────────────────────────────────
  // Genera el análisis completo de escenarios para un ciclo completado.
  // Incluye: duraciones alternativas + configuraciones de trading candidatas.
  app.get('/api/cycles/:id/scenarios', async (req, res) => {
    try {
      const cycleId = req.params.id;
      const cycle   = await cyclesManager.getCycle(redis, cycleId);

      if (!cycle) {
        return res.status(404).json({ success: false, error: `Ciclo ${cycleId} no encontrado` });
      }
      if (cycle.status !== 'completed') {
        return res.status(400).json({
          success: false,
          error:   'El ciclo aún no está completado',
          status:  cycle.status,
          endTime: cycle.endTime,
        });
      }

      const investConfig = await getInvestConfig();
      const analysis     = scenarioSimulator.generateScenarioAnalysis(cycle, investConfig);

      res.json({ success: true, analysis });
    } catch (err) {
      console.error('[scenarios] Error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/cycles/:id/temporal-profile ─────────────────────────────────
  // Devuelve el perfil temporal (curva de predicción no-lineal) de un activo.
  app.get('/api/cycles/:id/temporal-profile', async (req, res) => {
    try {
      const cycleId        = req.params.id;
      const assetId        = req.query.assetId;
      const classification = req.query.classification || 'INVERTIBLE';
      const cycle          = await cyclesManager.getCycle(redis, cycleId);

      if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });

      const mode = cycle.mode || 'normal';

      // Buscar la predicción base del activo si se especificó
      let basePrediction = parseFloat(req.query.basePrediction || 0);
      if (!basePrediction && assetId) {
        const snapAsset = (cycle.snapshot || []).find(a => a.id === assetId);
        basePrediction  = snapAsset?.basePrediction || parseFloat(snapAsset?.predictedChange || 0);
      }

      // Ventanas: 6h, 12h, 18h, 24h, 30h, 36h, 48h, 72h
      const profile = temporalPrediction.buildTemporalProfile(
        basePrediction,
        classification,
        mode,
        [6, 12, 18, 24, 30, 36, 48, 72]
      );

      res.json({ success: true, profile, basePrediction, classification, mode });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/cycles/temporal-calibration ─────────────────────────────────
  // Analiza ciclos históricos y comprueba la precisión del modelo temporal.
  app.get('/api/cycles/temporal-calibration', async (req, res) => {
    try {
      const limit        = parseInt(req.query.limit || '20');
      const completedCycles = await getCompletedCycles(limit);

      const calibration  = temporalPrediction.calibrateFromHistory(completedCycles);

      res.json({ success: true, calibration, cyclesAnalyzed: completedCycles.length });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/cycles/:id/apply-best-scenario ──────────────────────────────
  // Registra qué escenario fue mejor para alimentar el algoritmo de mejora.
  // El frontend envía: { bestDurationMs, bestTradingConfig, notes }
  app.post('/api/cycles/:id/apply-best-scenario', async (req, res) => {
    try {
      const cycleId = req.params.id;
      const { bestDurationMs, bestTradingConfig, notes } = req.body;

      const cycle = await cyclesManager.getCycle(redis, cycleId);
      if (!cycle) return res.status(404).json({ success: false, error: 'Ciclo no encontrado' });

      // Guardar el feedback de escenario en el ciclo
      const updatedCycle = await cyclesManager.saveCycle(redis, {
        ...cycle,
        scenarioFeedback: {
          bestDurationMs,
          bestTradingConfig,
          notes:       notes || '',
          appliedAt:   new Date().toISOString(),
          appliedBy:   'user',
        },
      });

      // Si hay config de trading recomendada, sugerirla para el próximo ciclo
      const { TRADING_CONFIGS } = scenarioSimulator;
      const recommendedConfig   = TRADING_CONFIGS[bestTradingConfig] || null;

      res.json({
        success: true,
        message: 'Feedback de escenario guardado',
        recommendedConfig,
        cycleId,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

};
