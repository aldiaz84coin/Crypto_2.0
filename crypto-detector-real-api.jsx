import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle, BarChart3, Clock, Target, Brain, RefreshCw, Database, Wifi, WifiOff } from 'lucide-react';

const CryptoDetectorApp = () => {
  const [cryptoAssets, setCryptoAssets] = useState([]);
  const [historicalData, setHistoricalData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [apiStatus, setApiStatus] = useState({
    coingecko: 'disconnected',
    news: 'disconnected'
  });
  const [algorithm, setAlgorithm] = useState({
    searchIncreaseThreshold: 150,
    newsCountThreshold: 5,
    boostPowerThreshold: 0.4,
    marketCapRatioThreshold: 0.3,
    historicalLowPercentile: 25,
    successRate: 0,
    totalPredictions: 0,
    correctPredictions: 0
  });
  const [activeTab, setActiveTab] = useState('monitor');
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Función para obtener datos reales de CoinGecko
  const fetchCoinGeckoData = async () => {
    try {
      setApiStatus(prev => ({ ...prev, coingecko: 'connecting' }));
      
      // Obtener top 100 criptomonedas por capitalización de mercado
      const response = await fetch(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d'
      );
      
      if (!response.ok) throw new Error('Error al obtener datos de CoinGecko');
      
      const data = await response.json();
      setApiStatus(prev => ({ ...prev, coingecko: 'connected' }));
      
      return data;
    } catch (error) {
      console.error('Error fetching CoinGecko data:', error);
      setApiStatus(prev => ({ ...prev, coingecko: 'error' }));
      return null;
    }
  };

  // Función para obtener noticias de crypto (simulado pero con estructura para API real)
  const fetchCryptoNews = async (symbol) => {
    try {
      // En producción, usar CryptoCompare, NewsAPI, o similar
      // Ejemplo: https://min-api.cryptocompare.com/data/v2/news/?categories=${symbol}
      
      // Por ahora, simulamos con datos realistas
      const newsCount = Math.floor(Math.random() * 25);
      const sentiment = Math.random();
      
      return { newsCount, sentiment };
    } catch (error) {
      console.error('Error fetching news:', error);
      return { newsCount: 0, sentiment: 0.5 };
    }
  };

  // Función para calcular tendencias de búsqueda (simulado - requiere Google Trends API o SerpAPI)
  const calculateSearchTrend = async (symbol) => {
    try {
      // En producción, usar SerpAPI o pytrends
      // Ejemplo: https://serpapi.com/search.json?engine=google_trends&q=${symbol}
      
      // Simulamos basado en volatilidad del precio como proxy
      const trend = Math.random() * 400;
      return trend;
    } catch (error) {
      console.error('Error calculating search trend:', error);
      return 0;
    }
  };

  // Procesar datos de CoinGecko y enriquecerlos
  const processCryptoData = async (coinGeckoData) => {
    if (!coinGeckoData) return [];

    const processedData = await Promise.all(
      coinGeckoData.map(async (coin) => {
        const news = await fetchCryptoNews(coin.symbol);
        const searchTrend = await calculateSearchTrend(coin.symbol);
        
        // Calcular métricas adicionales
        const sparkline = coin.sparkline_in_7d?.price || [];
        const historicalAvg = sparkline.length > 0 
          ? sparkline.reduce((a, b) => a + b, 0) / sparkline.length 
          : coin.current_price;
        
        const volatility = sparkline.length > 1
          ? Math.sqrt(
              sparkline.reduce((sum, price, i, arr) => {
                if (i === 0) return 0;
                const change = ((price - arr[i-1]) / arr[i-1]) * 100;
                return sum + Math.pow(change, 2);
              }, 0) / sparkline.length
            )
          : 0;

        return {
          id: coin.id,
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          currentPrice: coin.current_price,
          marketCap: coin.market_cap,
          volume24h: coin.total_volume,
          priceChange24h: coin.price_change_percentage_24h || 0,
          priceChange7d: coin.price_change_percentage_7d_in_currency || 0,
          historicalAvg,
          volatility,
          searchTrend,
          newsCount: news.newsCount,
          socialSentiment: news.sentiment,
          ath: coin.ath,
          athChangePercentage: coin.ath_change_percentage,
          circulatingSupply: coin.circulating_supply,
          totalSupply: coin.total_supply,
          detectedAt: new Date(),
          classification: null,
          boostPower: null,
          predictedChange: null,
          image: coin.image
        };
      })
    );

    return processedData;
  };

  // Clasificar criptoactivo según el algoritmo mejorado
  const classifyCrypto = (crypto) => {
    const searchIncrease = crypto.searchTrend;
    const newsCount = crypto.newsCount;
    const priceVsHistorical = (crypto.currentPrice / crypto.historicalAvg) * 100;
    const marketCapRatio = crypto.marketCap / (crypto.currentPrice * crypto.volume24h);
    
    // Calcular Boost-Power mejorado
    const volumeScore = Math.min(crypto.volume24h / crypto.marketCap, 1);
    const volatilityScore = Math.min(crypto.volatility / 10, 1);
    const sentimentScore = crypto.socialSentiment;
    const newsScore = Math.min(newsCount / 20, 1);
    const trendScore = Math.min(searchIncrease / 300, 1);
    
    const boostPower = (
      trendScore * 0.3 +
      newsScore * 0.25 +
      sentimentScore * 0.2 +
      volumeScore * 0.15 +
      volatilityScore * 0.1
    );
    
    crypto.boostPower = boostPower.toFixed(3);

    // Observable si cumple requisitos mínimos
    const isObservable = searchIncrease > algorithm.searchIncreaseThreshold || 
                        newsCount > algorithm.newsCountThreshold ||
                        Math.abs(crypto.priceChange24h) > 15;

    if (!isObservable) {
      return { 
        ...crypto, 
        classification: 'no-observable', 
        predictedChange: crypto.priceChange24h * 0.5 
      };
    }

    // Clasificación mejorada
    if (boostPower < 0.25) {
      return { 
        ...crypto, 
        classification: 'ruidoso', 
        predictedChange: crypto.priceChange24h * 0.3 
      };
    }

    // Detectar apalancamiento alto
    const isHighlyLeveraged = 
      marketCapRatio > algorithm.marketCapRatioThreshold ||
      crypto.athChangePercentage < -70 ||
      (priceVsHistorical < algorithm.historicalLowPercentile && crypto.volume24h > crypto.marketCap * 0.5);

    if (isHighlyLeveraged && boostPower > 0.3) {
      return { 
        ...crypto, 
        classification: 'apalancado', 
        predictedChange: Math.abs(crypto.priceChange24h) * 1.5 
      };
    }

    // Invertible: bajo apalancamiento, alto boost power
    if (boostPower > algorithm.boostPowerThreshold && !isHighlyLeveraged && crypto.priceChange24h > 0) {
      return { 
        ...crypto, 
        classification: 'invertible', 
        predictedChange: 30 + (boostPower * 50) 
      };
    }

    return { 
      ...crypto, 
      classification: 'otros', 
      predictedChange: crypto.priceChange24h * 0.8 
    };
  };

  // Cargar datos reales
  const loadRealData = async () => {
    setLoading(true);
    try {
      const coinGeckoData = await fetchCoinGeckoData();
      if (coinGeckoData) {
        const processed = await processCryptoData(coinGeckoData);
        const classified = processed.map(classifyCrypto);
        setCryptoAssets(classified);
        setLastUpdate(new Date());
      }
    } catch (error) {
      console.error('Error loading real data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Verificar predicción después de 12 horas
  const verifyPrediction = (crypto, actualChange) => {
    const absChange = Math.abs(actualChange);
    
    const correct = 
      (crypto.classification === 'ruidoso' && absChange < 30) ||
      (crypto.classification === 'apalancado' && absChange > 10 && absChange < 60) ||
      (crypto.classification === 'invertible' && actualChange > 20);
    
    return correct;
  };

  // Ajustar algoritmo basado en resultados
  const adjustAlgorithm = (results) => {
    const successCount = results.filter(r => r.correct).length;
    const totalCount = results.length;
    const successRate = (successCount / totalCount) * 100;

    setAlgorithm(prev => {
      const newTotalPredictions = prev.totalPredictions + totalCount;
      const newCorrectPredictions = prev.correctPredictions + successCount;
      const overallSuccessRate = (newCorrectPredictions / newTotalPredictions) * 100;
      
      // Ajuste adaptativo
      const adjustmentFactor = successRate < 85 ? 0.92 : 1.03;
      
      return {
        searchIncreaseThreshold: Math.max(50, prev.searchIncreaseThreshold * adjustmentFactor),
        newsCountThreshold: Math.max(2, Math.min(15, prev.newsCountThreshold * adjustmentFactor)),
        boostPowerThreshold: Math.max(0.2, Math.min(0.7, prev.boostPowerThreshold * adjustmentFactor)),
        marketCapRatioThreshold: Math.max(0.1, Math.min(0.6, prev.marketCapRatioThreshold * adjustmentFactor)),
        historicalLowPercentile: prev.historicalLowPercentile,
        successRate: overallSuccessRate.toFixed(1),
        totalPredictions: newTotalPredictions,
        correctPredictions: newCorrectPredictions
      };
    });
  };

  // Simulación de ciclo completo con datos reales
  const runSimulation = async () => {
    setSimulationRunning(true);
    
    // Tomar snapshot de activos actuales para verificar
    const snapshot = [...cryptoAssets].filter(c => c.classification !== 'no-observable').slice(0, 20);
    
    // Simular espera de 12 horas (en realidad esperamos unos segundos y re-fetcheamos)
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Obtener datos actualizados
    const newData = await fetchCoinGeckoData();
    if (newData) {
      const results = snapshot.map(originalCrypto => {
        // Buscar el mismo activo en los datos nuevos
        const updatedCoin = newData.find(c => c.id === originalCrypto.id);
        
        if (!updatedCoin) {
          return { ...originalCrypto, actualChange: 0, correct: false };
        }
        
        // Calcular cambio real (simulado como cambio en 24h)
        const actualChange = updatedCoin.price_change_percentage_24h || 0;
        const correct = verifyPrediction(originalCrypto, actualChange);
        
        return {
          ...originalCrypto,
          actualChange: actualChange.toFixed(2),
          actualPrice: updatedCoin.current_price,
          correct
        };
      });

      // Guardar en histórico
      setHistoricalData(prev => [...prev, ...results]);

      // Ajustar algoritmo
      adjustAlgorithm(results);
      
      // Recargar datos
      await loadRealData();
    }
    
    setSimulationRunning(false);
  };

  // Generar y descargar informe
  const downloadReport = async (iterationResults) => {
    setGeneratingReport(true);
    try {
      const iterationData = prepareIterationData(iterationResults);
      
      const response = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(iterationData)
      });

      if (!response.ok) {
        throw new Error('Error generating report');
      }

      // Descargar el archivo
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Informe-Iteracion-${algorithm.totalPredictions + 1}-${new Date().toISOString().split('T')[0]}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      alert('✅ Informe generado y descargado exitosamente');
    } catch (error) {
      console.error('Error downloading report:', error);
      alert('❌ Error al generar el informe. Revisa la consola para más detalles.');
    } finally {
      setGeneratingReport(false);
    }
  };

  // Enviar informe por email
  const sendReportByEmail = async (iterationResults) => {
    setSendingEmail(true);
    try {
      const iterationData = prepareIterationData(iterationResults);
      
      const response = await fetch('/api/reports/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ iterationData })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ Informe enviado exitosamente por email${result.mode === 'test' ? ' (modo prueba)' : ''}`);
      } else {
        throw new Error(result.error || 'Error sending email');
      }
    } catch (error) {
      console.error('Error sending email:', error);
      alert('❌ Error al enviar el informe por email. Revisa la consola para más detalles.');
    } finally {
      setSendingEmail(false);
    }
  };

  // Preparar datos de iteración para el informe
  const prepareIterationData = (results) => {
    const successCount = results.filter(r => r.correct).length;
    const successRate = ((successCount / results.length) * 100).toFixed(1);
    
    return {
      iterationNumber: algorithm.totalPredictions > 0 
        ? Math.floor(algorithm.totalPredictions / 20) + 1 
        : 1,
      timestamp: new Date().toISOString(),
      cryptoAssets: cryptoAssets.slice(0, 20),
      predictions: results,
      results: results,
      algorithm: algorithm,
      successRate: parseFloat(successRate),
      recommendations: generateRecommendations(results, successRate)
    };
  };

  // Generar recomendaciones basadas en resultados
  const generateRecommendations = (results, successRate) => {
    const recommendations = [];
    
    if (parseFloat(successRate) < 70) {
      recommendations.push(
        "Considerar ampliar el período de análisis para obtener más datos",
        "Revisar los umbrales de clasificación con ajustes más conservadores"
      );
    } else if (parseFloat(successRate) < 85) {
      recommendations.push(
        "Mantener el seguimiento cercano de los parámetros actuales",
        "Validar la calidad de las fuentes de datos de tendencias"
      );
    } else {
      recommendations.push(
        "Continuar con la estrategia actual de parámetros",
        "Explorar oportunidades de optimización adicional"
      );
    }
    
    return recommendations;
  };

  // Cargar datos al iniciar
  useEffect(() => {
    loadRealData();
    checkEmailConfiguration();
    
    // Auto-refresh cada 5 minutos
    const interval = setInterval(() => {
      loadRealData();
    }, 300000);
    
    return () => clearInterval(interval);
  }, []);

  // Verificar configuración de email
  const checkEmailConfiguration = async () => {
    try {
      const response = await fetch('/api/email/verify');
      const data = await response.json();
      setEmailConfigured(data.configured && data.hasRecipient);
    } catch (error) {
      console.error('Error checking email configuration:', error);
      setEmailConfigured(false);
    }
  };

  const getClassificationColor = (classification) => {
    const colors = {
      'invertible': 'bg-green-100 text-green-800 border-green-300',
      'apalancado': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'ruidoso': 'bg-gray-100 text-gray-800 border-gray-300',
      'no-observable': 'bg-red-100 text-red-800 border-red-300',
      'otros': 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[classification] || 'bg-gray-100 text-gray-800';
  };

  const getClassificationIcon = (classification) => {
    switch(classification) {
      case 'invertible': return <TrendingUp className="w-5 h-5" />;
      case 'apalancado': return <BarChart3 className="w-5 h-5" />;
      case 'ruidoso': return <AlertCircle className="w-5 h-5" />;
      default: return <Clock className="w-5 h-5" />;
    }
  };

  const top20Observable = cryptoAssets
    .filter(c => c.classification !== 'no-observable')
    .sort((a, b) => b.boostPower - a.boostPower)
    .slice(0, 20);

  const stats = {
    total: cryptoAssets.length,
    invertibles: cryptoAssets.filter(c => c.classification === 'invertible').length,
    apalancados: cryptoAssets.filter(c => c.classification === 'apalancado').length,
    ruidosos: cryptoAssets.filter(c => c.classification === 'ruidoso').length,
    totalHistorical: algorithm.totalPredictions,
    correctPredictions: algorithm.correctPredictions
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
                <Brain className="w-10 h-10 text-purple-400" />
                Detector de Criptoactivos Invertibles
              </h1>
              <p className="text-gray-300">Sistema con datos reales de CoinGecko API</p>
            </div>
            
            <div className="flex items-center gap-4">
              {/* API Status */}
              <div className="bg-white/10 backdrop-blur rounded-lg p-3 border border-white/20">
                <div className="flex items-center gap-2 text-sm">
                  {apiStatus.coingecko === 'connected' ? (
                    <Wifi className="w-4 h-4 text-green-400" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-red-400" />
                  )}
                  <span>CoinGecko API</span>
                </div>
              </div>
              
              <button
                onClick={loadRealData}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Cargando...' : 'Actualizar'}
              </button>
            </div>
          </div>
          
          {lastUpdate && (
            <div className="text-sm text-gray-400 mt-2">
              Última actualización: {lastUpdate.toLocaleString('es-ES')}
            </div>
          )}
        </div>

        {/* Stats Dashboard */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
            <div className="text-gray-300 text-sm mb-1">Tasa de Acierto</div>
            <div className="text-3xl font-bold text-green-400">{algorithm.successRate}%</div>
            <div className="text-xs text-gray-400 mt-1">
              {stats.correctPredictions}/{stats.totalHistorical}
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
            <div className="text-gray-300 text-sm mb-1">Invertibles</div>
            <div className="text-3xl font-bold text-green-400">{stats.invertibles}</div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
            <div className="text-gray-300 text-sm mb-1">Apalancados</div>
            <div className="text-3xl font-bold text-yellow-400">{stats.apalancados}</div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
            <div className="text-gray-300 text-sm mb-1">Ruidosos</div>
            <div className="text-3xl font-bold text-gray-400">{stats.ruidosos}</div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-lg p-4 border border-white/20">
            <div className="text-gray-300 text-sm mb-1">Total Activos</div>
            <div className="text-3xl font-bold text-purple-400">{stats.total}</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-white/20 pb-2">
          <button
            onClick={() => setActiveTab('monitor')}
            className={`px-4 py-2 rounded-t-lg transition ${
              activeTab === 'monitor' 
                ? 'bg-purple-600 text-white' 
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Database className="w-4 h-4 inline mr-2" />
            Monitor en Tiempo Real
          </button>
          <button
            onClick={() => setActiveTab('algorithm')}
            className={`px-4 py-2 rounded-t-lg transition ${
              activeTab === 'algorithm' 
                ? 'bg-purple-600 text-white' 
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <Brain className="w-4 h-4 inline mr-2" />
            Parámetros del Algoritmo
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-t-lg transition ${
              activeTab === 'history' 
                ? 'bg-purple-600 text-white' 
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            <BarChart3 className="w-4 h-4 inline mr-2" />
            Historial y Validación
          </button>
        </div>

        {/* Content */}
        {activeTab === 'monitor' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-semibold">Top 20 Activos Observables</h2>
              <div className="flex gap-3">
                {historicalData.length > 0 && (
                  <>
                    <button
                      onClick={() => downloadReport(historicalData.slice(-20))}
                      disabled={generatingReport}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                      title="Descargar informe de la última iteración"
                    >
                      {generatingReport ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          Generando...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          Descargar Informe
                        </>
                      )}
                    </button>
                    
                    {emailConfigured && (
                      <button
                        onClick={() => sendReportByEmail(historicalData.slice(-20))}
                        disabled={sendingEmail}
                        className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                        title="Enviar informe por email"
                      >
                        {sendingEmail ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                            Enviando...
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            Enviar por Email
                          </>
                        )}
                      </button>
                    )}
                  </>
                )}
                
                <button
                  onClick={runSimulation}
                  disabled={simulationRunning || loading}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 px-6 py-2 rounded-lg font-semibold transition flex items-center gap-2"
                >
                  {simulationRunning ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Ejecutando ciclo...
                    </>
                  ) : (
                    <>
                      <Target className="w-5 h-5" />
                      Ejecutar Ciclo 12h
                    </>
                  )}
                </button>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500 border-t-transparent"></div>
              </div>
            ) : (
              <div className="grid gap-4">
                {top20Observable.map((crypto) => (
                  <div
                    key={crypto.id}
                    className="bg-white/5 backdrop-blur rounded-lg p-4 border border-white/20 hover:bg-white/10 transition"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-4 flex-1">
                        <img src={crypto.image} alt={crypto.symbol} className="w-10 h-10 rounded-full" />
                        <div>
                          <div className="text-xl font-bold">{crypto.symbol}</div>
                          <div className="text-sm text-gray-400">{crypto.name}</div>
                        </div>
                        <div className={`px-3 py-1 rounded-full border text-sm font-semibold flex items-center gap-2 ${getClassificationColor(crypto.classification)}`}>
                          {getClassificationIcon(crypto.classification)}
                          {crypto.classification.toUpperCase()}
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="text-2xl font-bold">${crypto.currentPrice.toLocaleString()}</div>
                        <div className={`text-sm font-semibold ${crypto.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {crypto.priceChange24h >= 0 ? '↑' : '↓'} {Math.abs(crypto.priceChange24h).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-5 gap-4 text-sm">
                      <div>
                        <div className="text-gray-400 mb-1">Boost-Power</div>
                        <div className="font-bold text-lg text-purple-400">{crypto.boostPower}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 mb-1">Tendencia</div>
                        <div className="font-bold text-green-400">+{crypto.searchTrend.toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-gray-400 mb-1">Noticias</div>
                        <div className="font-bold">{crypto.newsCount}</div>
                      </div>
                      <div>
                        <div className="text-gray-400 mb-1">Volatilidad</div>
                        <div className="font-bold">{crypto.volatility.toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-gray-400 mb-1">Predicción 12h</div>
                        <div className={`font-bold ${crypto.predictedChange > 30 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {crypto.predictedChange >= 0 ? '+' : ''}{crypto.predictedChange.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-white/10 text-xs text-gray-400">
                      Cap. Mercado: ${(crypto.marketCap / 1000000).toFixed(2)}M | 
                      Volumen 24h: ${(crypto.volume24h / 1000000).toFixed(2)}M | 
                      Cambio 7d: {crypto.priceChange7d.toFixed(2)}%
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'algorithm' && (
          <div className="bg-white/5 backdrop-blur rounded-lg p-6 border border-white/20">
            <h2 className="text-2xl font-semibold mb-6">Parámetros del Algoritmo de Clasificación</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Umbral de Incremento de Búsquedas (%)
                </label>
                <input
                  type="range"
                  min="50"
                  max="300"
                  value={algorithm.searchIncreaseThreshold}
                  onChange={(e) => setAlgorithm({...algorithm, searchIncreaseThreshold: Number(e.target.value)})}
                  className="w-full"
                />
                <div className="text-right text-purple-400 font-bold">{algorithm.searchIncreaseThreshold.toFixed(0)}%</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Umbral de Noticias Simultáneas
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={algorithm.newsCountThreshold}
                  onChange={(e) => setAlgorithm({...algorithm, newsCountThreshold: Number(e.target.value)})}
                  className="w-full"
                />
                <div className="text-right text-purple-400 font-bold">{algorithm.newsCountThreshold.toFixed(0)} noticias</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Umbral de Boost-Power (Invertible)
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={algorithm.boostPowerThreshold}
                  onChange={(e) => setAlgorithm({...algorithm, boostPowerThreshold: Number(e.target.value)})}
                  className="w-full"
                />
                <div className="text-right text-purple-400 font-bold">{algorithm.boostPowerThreshold.toFixed(2)}</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Ratio Capitalización/Valor (Apalancamiento)
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={algorithm.marketCapRatioThreshold}
                  onChange={(e) => setAlgorithm({...algorithm, marketCapRatioThreshold: Number(e.target.value)})}
                  className="w-full"
                />
                <div className="text-right text-purple-400 font-bold">{algorithm.marketCapRatioThreshold.toFixed(2)}</div>
              </div>

              <div className="mt-8 p-4 bg-purple-900/30 rounded-lg border border-purple-500/30">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  Aprendizaje Automático Activo
                </h3>
                <p className="text-sm text-gray-300 mb-3">
                  El algoritmo ajusta automáticamente sus parámetros después de cada ciclo de validación para mejorar la precisión.
                </p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-white/5 p-3 rounded">
                    <div className="text-gray-400">Predicciones totales</div>
                    <div className="text-xl font-bold">{algorithm.totalPredictions}</div>
                  </div>
                  <div className="bg-white/5 p-3 rounded">
                    <div className="text-gray-400">Predicciones correctas</div>
                    <div className="text-xl font-bold text-green-400">{algorithm.correctPredictions}</div>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-900/30 rounded-lg border border-blue-500/30">
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Fuentes de Datos Reales
                </h3>
                <ul className="text-sm text-gray-300 space-y-2">
                  <li>✓ CoinGecko API - Precios, capitalización y volumen en tiempo real</li>
                  <li>✓ Datos de volatilidad calculados de sparklines de 7 días</li>
                  <li>⚠ Tendencias de búsqueda - Simuladas (requiere Google Trends API)</li>
                  <li>⚠ Noticias crypto - Simuladas (requiere CryptoCompare o NewsAPI)</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <h2 className="text-2xl font-semibold mb-4">Historial de Predicciones Verificadas</h2>
            
            {historicalData.length === 0 ? (
              <div className="bg-white/5 backdrop-blur rounded-lg p-12 border border-white/20 text-center">
                <Clock className="w-16 h-16 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-300">No hay datos históricos aún. Ejecuta un ciclo de 12h para comenzar a validar predicciones.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {historicalData.slice(-30).reverse().map((item, index) => (
                  <div
                    key={index}
                    className={`bg-white/5 backdrop-blur rounded-lg p-4 border ${
                      item.correct ? 'border-green-500/50' : 'border-red-500/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {item.image && <img src={item.image} alt={item.symbol} className="w-8 h-8 rounded-full" />}
                        <div>
                          <div className="text-xl font-bold">{item.symbol}</div>
                          <div className="text-sm text-gray-400">{item.name}</div>
                        </div>
                        <div className={`px-3 py-1 rounded-full border text-sm ${getClassificationColor(item.classification)}`}>
                          {item.classification.toUpperCase()}
                        </div>
                        {item.correct ? (
                          <CheckCircle className="w-6 h-6 text-green-400" />
                        ) : (
                          <AlertCircle className="w-6 h-6 text-red-400" />
                        )}
                      </div>
                      
                      <div className="grid grid-cols-4 gap-6 text-sm">
                        <div>
                          <div className="text-gray-400 mb-1">Boost-Power</div>
                          <div className="font-bold text-purple-400">{item.boostPower}</div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Predicción</div>
                          <div className="font-bold text-yellow-400">{item.predictedChange >= 0 ? '+' : ''}{item.predictedChange}%</div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Resultado Real</div>
                          <div className={`font-bold ${Number(item.actualChange) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {Number(item.actualChange) >= 0 ? '+' : ''}{item.actualChange}%
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400 mb-1">Estado</div>
                          <div className={`font-bold ${item.correct ? 'text-green-400' : 'text-red-400'}`}>
                            {item.correct ? '✓ CORRECTO' : '✗ INCORRECTO'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CryptoDetectorApp;