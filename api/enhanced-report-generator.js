// enhanced-report-generator.js - Informes mejorados con análisis de oportunidades

const { Document, Paragraph, TextRun, Table, TableCell, TableRow, HeadingLevel, AlignmentType, WidthType, BorderStyle } = require('docx');

/**
 * Generar informe mejorado de un ciclo con análisis de oportunidades perdidas
 */
function generateEnhancedReport(cycle, allSnapshot, config) {
  const mode = cycle.mode || 'normal';
  const modeLabel = mode === 'speculative' ? 'ESPECULATIVO' : 'GENERALISTA';
  const durationHrs = ((cycle.durationMs || 43200000) / 3600000).toFixed(1);
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
  const excludedCount = (cycle.results || []).length - validResults.length;
  
  // Analizar oportunidades perdidas (activos del snapshot que no se seleccionaron)
  const selectedIds = new Set(validResults.map(r => r.id));
  const missed = (allSnapshot || []).filter(a => !selectedIds.has(a.id));
  
  // Simular cuál hubiera sido el desempeño de los activos descartados
  const missedWithPerformance = missed.map(a => ({
    ...a,
    // Calcular desempeño real (esto debe venir de los precios finales si están disponibles)
    actualChange: a.actualChange || 0,  // debe ser calculado con precios finales
    wouldHaveWorked: (a.actualChange || 0) >= (a.predictedChange || 0) * 0.9
  })).sort((a,b) => (b.actualChange || 0) - (a.actualChange || 0));
  
  const top5Missed = missedWithPerformance.slice(0, 5);
  
  // Análisis de impacto en ponderaciones
  const impactAnalysis = analyzeConfigImpact(validResults, config);
  
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        ...createHeader(cycle, mode, modeLabel, durationHrs, validResults.length, excludedCount),
        ...createConfigSection(config, mode),
        ...createMetricsSection(cycle.metrics),
        ...createCategoryAnalysis(cycle.metrics, config),
        ...createMissedOpportunities(top5Missed, selectedIds.size),
        ...createImpactAnalysis(impactAnalysis),
        ...createNextCycleCandidates(validResults, config),
        ...createDetailedResults(validResults)
      ]
    }]
  });
  
  return doc;
}

function createHeader(cycle, mode, modeLabel, durationHrs, validCount, excludedCount) {
  return [
    new Paragraph({
      text: `INFORME MEJORADO - MODELO ${modeLabel}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    }),
    new Paragraph({
      text: "Información del Ciclo",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "ID: ", bold: true }),
        new TextRun(cycle.id)
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Modo: ", bold: true }),
        new TextRun(`${modeLabel} (${mode})`)
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Inicio: ", bold: true }),
        new TextRun(new Date(cycle.startTime).toLocaleString('es-ES'))
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Fin: ", bold: true }),
        new TextRun(new Date(cycle.completedAt).toLocaleString('es-ES'))
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Duración: ", bold: true }),
        new TextRun(`${durationHrs} horas`)
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Activos: ", bold: true }),
        new TextRun(`${validCount} incluidos, ${excludedCount} excluidos`)
      ],
      spacing: { after: 400 }
    })
  ];
}

function createConfigSection(config, mode) {
  return [
    new Paragraph({
      text: "Configuración del Algoritmo",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    createConfigTable(config),
    new Paragraph({ spacing: { after: 400 } })
  ];
}

function createConfigTable(config) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Parámetro", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Valor", bold: true })] })
      ]
    })
  ];
  
  const params = [
    { label: 'Boost Power Threshold', value: config.boostPowerThreshold || 'N/A' },
    { label: 'Meta Weight: Potential', value: config.metaWeights?.potential || 'N/A' },
    { label: 'Meta Weight: Resistance', value: config.metaWeights?.resistance || 'N/A' },
    { label: 'INVERTIBLE Min Boost', value: config.classification?.invertibleMinBoost || 'N/A' },
    { label: 'INVERTIBLE Max Market Cap', value: config.classification?.invertibleMaxMarketCap ? `$${(config.classification.invertibleMaxMarketCap/1e9).toFixed(1)}B` : 'N/A' },
    { label: 'INVERTIBLE Target', value: config.prediction?.invertibleTarget ? `${config.prediction.invertibleTarget}%` : 'N/A' },
    { label: 'Magnitude Tolerance', value: config.prediction?.magnitudeTolerance ? `${config.prediction.magnitudeTolerance}%` : 'N/A' }
  ];
  
  params.forEach(p => {
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(p.label)] }),
          new TableCell({ children: [new Paragraph(String(p.value))] })
        ]
      })
    );
  });
  
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function createMetricsSection(metrics) {
  return [
    new Paragraph({
      text: "Métricas Globales",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Total de Predicciones: ", bold: true }),
        new TextRun((metrics?.total || 0).toString())
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Correctas: ", bold: true }),
        new TextRun((metrics?.correct || 0).toString())
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Tasa de Acierto: ", bold: true }),
        new TextRun({ text: `${metrics?.successRate || '0.00'}%`, color: "00AA00", bold: true })
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Error Promedio: ", bold: true }),
        new TextRun(`${metrics?.avgError || '0.00'}%`)
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Error Máximo: ", bold: true }),
        new TextRun(`${metrics?.maxError || '0.00'}%`)
      ],
      spacing: { after: 400 }
    })
  ];
}

function createCategoryAnalysis(metrics, config) {
  return [
    new Paragraph({
      text: "Análisis por Categoría",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    createCategoryTable(metrics),
    new Paragraph({ spacing: { after: 400 } })
  ];
}

function createCategoryTable(metrics) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Categoría", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Total", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Correctas", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Tasa Acierto", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Error Prom", bold: true })] })
      ]
    })
  ];
  
  ['invertible', 'apalancado', 'ruidoso'].forEach(cat => {
    const data = metrics?.[cat];
    if (!data) return;
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(cat.toUpperCase())] }),
          new TableCell({ children: [new Paragraph((data.total || 0).toString())] }),
          new TableCell({ children: [new Paragraph((data.correct || 0).toString())] }),
          new TableCell({ children: [new Paragraph(`${data.successRate || '0'}%`)] }),
          new TableCell({ children: [new Paragraph(`${data.avgError || '0'}%`)] })
        ]
      })
    );
  });
  
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function createMissedOpportunities(top5Missed, selectedCount) {
  return [
    new Paragraph({
      text: "Oportunidades Perdidas — Top 5 Activos Descartados",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Nota: ", bold: true, color: "FF6600" }),
        new TextRun({ text: `De los activos en el snapshot, solo ${selectedCount} fueron seleccionados. Los siguientes 5 activos descartados tuvieron el mejor desempeño real:`, color: "666666" })
      ],
      spacing: { after: 200 }
    }),
    createMissedOpportunitiesTable(top5Missed),
    new Paragraph({ spacing: { after: 400 } })
  ];
}

function createMissedOpportunitiesTable(missed) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Activo", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Boost Power", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Clasificación", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Predicción", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Cambio Real", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Razón de Descarte", bold: true })] })
      ]
    })
  ];
  
  missed.forEach(a => {
    const reason = a.boostPower < 0.60 ? 'Boost Power bajo' : 
                   a.classification === 'RUIDOSO' ? 'Clasificado como RUIDOSO' :
                   'No en top de boostPower';
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(`${a.name || a.symbol}`)] }),
          new TableCell({ children: [new Paragraph(`${(a.boostPowerPercent || 0).toFixed(0)}%`)] }),
          new TableCell({ children: [new Paragraph(a.classification || 'N/A')] }),
          new TableCell({ children: [new Paragraph(`${(a.predictedChange || 0).toFixed(1)}%`)] }),
          new TableCell({ children: [new Paragraph({ text: `${(a.actualChange || 0).toFixed(1)}%`, color: (a.actualChange || 0) > 0 ? "00AA00" : "AA0000" })] }),
          new TableCell({ children: [new Paragraph(reason)] })
        ]
      })
    );
  });
  
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

function createImpactAnalysis(impact) {
  return [
    new Paragraph({
      text: "Impacto en Ponderaciones del Algoritmo",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Análisis: ", bold: true }),
        new TextRun(impact.summary || 'Basado en los resultados de este ciclo, se recomienda ajustar las ponderaciones.')
      ],
      spacing: { after: 200 }
    }),
    ...impact.suggestions.map(s => 
      new Paragraph({
        children: [
          new TextRun({ text: "• ", color: "FF6600", bold: true }),
          new TextRun(s)
        ]
      })
    ),
    new Paragraph({ spacing: { after: 400 } })
  ];
}

function analyzeConfigImpact(results, config) {
  const suggestions = [];
  const invertible = results.filter(r => r.classification === 'INVERTIBLE');
  const invertibleCorrect = invertible.filter(r => r.correct).length;
  const invertibleAcc = invertible.length > 0 ? (invertibleCorrect / invertible.length * 100) : 0;
  
  if (invertibleAcc < 40 && invertible.length >= 3) {
    suggestions.push(`Accuracy INVERTIBLE muy bajo (${invertibleAcc.toFixed(1)}%). Aumentar invertibleMinBoost de ${config.classification?.invertibleMinBoost || 0.65} a ${Math.min(0.80, (config.classification?.invertibleMinBoost || 0.65) + 0.05).toFixed(2)}`);
  } else if (invertibleAcc > 80 && invertible.length >= 3) {
    suggestions.push(`Accuracy INVERTIBLE excelente (${invertibleAcc.toFixed(1)}%). Los parámetros están bien calibrados.`);
  }
  
  const avgError = results.reduce((s, r) => s + parseFloat(r.error || 0), 0) / results.length;
  if (avgError > 15) {
    suggestions.push(`Error promedio alto (${avgError.toFixed(1)}%). Reducir target de predicción de ${config.prediction?.invertibleTarget || 30}% a ${Math.max(15, (config.prediction?.invertibleTarget || 30) - 5)}%`);
  }
  
  return {
    summary: suggestions.length > 0 ? 'Se detectaron áreas de mejora.' : 'Configuración en buen estado.',
    suggestions
  };
}

function createNextCycleCandidates(results, config) {
  const successful = results.filter(r => r.correct && r.classification === 'INVERTIBLE').slice(0, 3);
  
  return [
    new Paragraph({
      text: "Candidatas para el Próximo Ciclo",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Nota: ", bold: true, color: "00AA00" }),
        new TextRun({ text: "Activos que cumplieron las predicciones y podrían repetir patrón:", color: "666666" })
      ],
      spacing: { after: 200 }
    }),
    ...successful.map(r => 
      new Paragraph({
        children: [
          new TextRun({ text: "✓ ", color: "00AA00", bold: true }),
          new TextRun({ text: `${r.name} (${r.symbol?.toUpperCase()}) `, bold: true }),
          new TextRun({ text: `— Predicho: ${r.predictedChange}%, Real: ${r.actualChange}%`, color: "666666" })
        ]
      })
    ),
    new Paragraph({ spacing: { after: 400 } })
  ];
}

function createDetailedResults(validResults) {
  return [
    new Paragraph({
      text: "Detalle de Predicciones (Solo Incluidas)",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 400, after: 200 }
    }),
    createResultsTable(validResults),
    new Paragraph({ spacing: { after: 400 } })
  ];
}

function createResultsTable(results) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Activo", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Categoría", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Pred", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Real", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Error", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "✓", bold: true })] })
      ]
    })
  ];
  
  results.forEach(r => {
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(`${r.name} (${r.symbol?.toUpperCase() || '—'})`)] }),
          new TableCell({ children: [new Paragraph(r.classification || 'N/A')] }),
          new TableCell({ children: [new Paragraph(`${r.predictedChange || 0}%`)] }),
          new TableCell({ children: [new Paragraph({ text: `${r.actualChange || 0}%`, color: parseFloat(r.actualChange||0) >= 0 ? "00AA00" : "AA0000" })] }),
          new TableCell({ children: [new Paragraph(`${r.error || 0}%`)] }),
          new TableCell({ children: [new Paragraph({ text: r.correct ? "✓" : "✗", color: r.correct ? "00AA00" : "AA0000" })] })
        ]
      })
    );
  });
  
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
}

module.exports = {
  generateEnhancedReport
};
