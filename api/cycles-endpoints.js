// cycles-endpoints.js - Endpoints para ciclos de 12h
// Este archivo es importado por index.js que ya tiene app y kvHelpers disponibles

// Obtener referencias globales
const express = require('express');
const axios = require('axios');

module.exports = function(app, kvHelpers, reportGenerator, emailService) {

// Iniciar ciclo
app.post('/api/cycles/start', async (req, res) => {
  try {
    const { snapshot, predictions, algorithm } = req.body;

    if (!snapshot || !Array.isArray(snapshot) || snapshot.length === 0) {
      return res.status(400).json({ 
        error: 'snapshot requerido - array de activos observados' 
      });
    }

    const cycle = await kvHelpers.createCycle({
      snapshot,
      predictions: predictions || snapshot.map(asset => ({
        id: asset.id,
        symbol: asset.symbol,
        predictedChange: asset.predictedChange || 0,
        classification: asset.classification,
        boostPower: asset.boostPower
      })),
      algorithm: algorithm || {},
      userEmail: process.env.REPORT_RECIPIENT_EMAIL
    });

    res.json({
      success: true,
      cycle: {
        id: cycle.id,
        startTime: cycle.startTime,
        endTime: cycle.endTime,
        scheduledFor: new Date(cycle.endTime).toISOString(),
        assetsCount: snapshot.length,
        status: cycle.status
      },
      message: 'Ciclo iniciado. Recibirás un email en 12 horas.'
    });

  } catch (error) {
    console.error('Error starting cycle:', error);
    res.status(500).json({ 
      error: 'Error al iniciar ciclo',
      message: error.message 
    });
  }
});

// Obtener ciclos activos
app.get('/api/cycles/active', async (req, res) => {
  try {
    const activeCycles = await kvHelpers.getActiveCycles();
    const now = Date.now();

    const cyclesWithTimeRemaining = activeCycles.map(cycle => ({
      id: cycle.id,
      startTime: cycle.startTime,
      endTime: cycle.endTime,
      timeRemaining: Math.max(0, cycle.endTime - now),
      assetsCount: cycle.snapshot?.length || 0,
      status: cycle.status,
      progress: Math.min(100, ((now - cycle.startTime) / (cycle.endTime - cycle.startTime)) * 100)
    }));

    res.json({
      success: true,
      activeCycles: cyclesWithTimeRemaining,
      count: cyclesWithTimeRemaining.length
    });

  } catch (error) {
    console.error('Error getting active cycles:', error);
    res.status(500).json({ 
      error: 'Error al obtener ciclos activos',
      message: error.message 
    });
  }
});

// Histórico
app.get('/api/cycles/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = await kvHelpers.getCycleHistory(limit);

    const formattedHistory = history.map(cycle => ({
      id: cycle.id,
      startTime: cycle.startTime,
      endTime: cycle.endTime,
      completedAt: cycle.completedAt,
      status: cycle.status,
      assetsCount: cycle.snapshot?.length || 0,
      resultsCount: cycle.results?.length || 0,
      successRate: cycle.results ? 
        ((cycle.results.filter(r => r.correct).length / cycle.results.length) * 100).toFixed(2) : 
        null,
      emailSent: cycle.emailSent,
      algorithm: cycle.algorithm
    }));

    res.json({
      success: true,
      history: formattedHistory,
      count: formattedHistory.length
    });

  } catch (error) {
    console.error('Error getting cycle history:', error);
    res.status(500).json({ error: 'Error al obtener histórico', message: error.message });
  }
});

// Cancelar ciclo
app.delete('/api/cycles/:cycleId', async (req, res) => {
  try {
    const { cycleId } = req.params;
    const cycle = await kvHelpers.getCycle(cycleId);

    if (!cycle) {
      return res.status(404).json({ error: 'Ciclo no encontrado' });
    }

    if (cycle.status === 'completed') {
      return res.status(400).json({ error: 'No se puede cancelar un ciclo completado' });
    }

    await kvHelpers.deleteCycle(cycleId);
    res.json({ success: true, message: 'Ciclo cancelado' });

  } catch (error) {
    console.error('Error deleting cycle:', error);
    res.status(500).json({ error: 'Error al cancelar ciclo', message: error.message });
  }
});

// Completar manualmente (testing)
app.post('/api/cycles/:cycleId/complete', async (req, res) => {
  try {
    const { cycleId } = req.params;
    const cycle = await kvHelpers.getCycle(cycleId);

    if (!cycle) {
      return res.status(404).json({ error: 'Ciclo no encontrado' });
    }

    const currentData = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1'
    );

    const results = cycle.snapshot.map(originalAsset => {
      const currentAsset = currentData.data.find(c => c.id === originalAsset.id);
      
      if (!currentAsset) {
        return { ...originalAsset, actualChange: 0, actualPrice: 0, correct: false };
      }

      const actualChange = ((currentAsset.current_price - originalAsset.price) / originalAsset.price) * 100;
      const predictedChange = originalAsset.predictedChange || 0;
      const sameDirection = (predictedChange >= 0 && actualChange >= 0) || (predictedChange < 0 && actualChange < 0);
      const magnitudeDiff = Math.abs(predictedChange - actualChange);
      const correct = sameDirection && magnitudeDiff < 15;

      return {
        id: originalAsset.id,
        symbol: originalAsset.symbol,
        name: originalAsset.name,
        classification: originalAsset.classification,
        snapshotPrice: originalAsset.price,
        currentPrice: currentAsset.current_price,
        predictedChange: predictedChange.toFixed(2),
        actualChange: actualChange.toFixed(2),
        correct
      };
    });

    const completedCycle = await kvHelpers.completeCycle(cycleId, results);
    const successRate = (results.filter(r => r.correct).length / results.length) * 100;

    res.json({
      success: true,
      cycle: completedCycle,
      results: {
        total: results.length,
        correct: results.filter(r => r.correct).length,
        successRate: successRate.toFixed(2)
      }
    });

  } catch (error) {
    console.error('Error completing cycle:', error);
    res.status(500).json({ error: 'Error al completar ciclo', message: error.message });
  }
});

// Stats
app.get('/api/cycles/stats', async (req, res) => {
  try {
    const stats = await kvHelpers.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas', message: error.message });
  }
});

// CRON JOB
app.get('/api/cron/check-cycles', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pendingCycles = await kvHelpers.getPendingCycles();
    const results = [];

    for (const cycle of pendingCycles) {
      try {
        console.log(`Processing cycle ${cycle.id}`);

        const currentData = await axios.get(
          'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1',
          { timeout: 10000 }
        );

        const cycleResults = cycle.snapshot.map(originalAsset => {
          const currentAsset = currentData.data.find(c => c.id === originalAsset.id);
          if (!currentAsset) {
            return { ...originalAsset, actualChange: 0, actualPrice: 0, correct: false };
          }

          const actualChange = ((currentAsset.current_price - originalAsset.price) / originalAsset.price) * 100;
          const predictedChange = originalAsset.predictedChange || 0;
          const sameDirection = (predictedChange >= 0 && actualChange >= 0) || (predictedChange < 0 && actualChange < 0);
          const magnitudeDiff = Math.abs(predictedChange - actualChange);
          const correct = sameDirection && magnitudeDiff < 15;

          return {
            id: originalAsset.id,
            symbol: originalAsset.symbol,
            name: originalAsset.name,
            classification: originalAsset.classification,
            snapshotPrice: originalAsset.price,
            currentPrice: currentAsset.current_price,
            predictedChange: predictedChange.toFixed(2),
            actualChange: actualChange.toFixed(2),
            correct
          };
        });

        const completedCycle = await kvHelpers.completeCycle(cycle.id, cycleResults);

        if (cycle.userEmail && !completedCycle.emailSent) {
          try {
            const successRate = (cycleResults.filter(r => r.correct).length / cycleResults.length) * 100;
            const reportData = {
              iterationNumber: cycle.id.split('_')[1],
              timestamp: new Date(completedCycle.completedAt).toISOString(),
              results: cycleResults,
              successRate: successRate.toFixed(2),
              algorithm: cycle.algorithm || {},
              totalPredictions: cycleResults.length,
              correctPredictions: cycleResults.filter(r => r.correct).length
            };

            await emailService.sendIterationReport(reportData);
            await kvHelpers.markEmailSent(cycle.id);
            console.log(`Email sent for cycle ${cycle.id}`);
          } catch (emailError) {
            console.error(`Error sending email:`, emailError);
          }
        }

        results.push({ cycleId: cycle.id, status: 'completed', emailSent: true });

      } catch (cycleError) {
        console.error(`Error processing cycle:`, cycleError);
        results.push({ cycleId: cycle.id, status: 'error', error: cycleError.message });
      }
    }

    res.json({ success: true, processed: results.length, results });

  } catch (error) {
    console.error('Cron job error:', error);
    res.status(500).json({ error: 'Error en cron job', message: error.message });
  }
});

};
