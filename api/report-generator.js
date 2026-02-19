// report-generator.js - Generador de Informes Word (Iteración 3)

const { Document, Paragraph, TextRun, Table, TableCell, TableRow, HeadingLevel, AlignmentType, WidthType } = require('docx');

/**
 * Generar informe Word de un ciclo completado
 */
function generateCycleReport(cycle) {
  const mode = cycle.mode || 'normal';
  const modeLabel = mode === 'speculative' ? 'ESPECULATIVO' : 'GENERALISTA';
  const durationHrs = ((cycle.durationMs || 43200000) / 3600000).toFixed(1);
  const validResults = (cycle.results || []).filter(r => !(cycle.excludedResults || []).includes(r.id));
  const excludedCount = (cycle.results || []).length - validResults.length;
  
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Título
        new Paragraph({
          text: `INFORME DE CICLO - MODELO ${modeLabel}`,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 }
        }),
        
        // Información del ciclo
        new Paragraph({
          text: "Información del Ciclo",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "ID del Ciclo: ", bold: true }),
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
            new TextRun({ text: "Fecha de Inicio: ", bold: true }),
            new TextRun(new Date(cycle.startTime).toLocaleString('es-ES'))
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Fecha de Finalización: ", bold: true }),
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
            new TextRun({ text: "Activos Totales: ", bold: true }),
            new TextRun(`${(cycle.results || []).length} (${validResults.length} incluidos, ${excludedCount} excluidos)`)
          ],
          spacing: { after: 400 }
        }),
        
        // Configuración del algoritmo
        new Paragraph({
          text: "Configuración del Algoritmo",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        createConfigTable(cycle.config || {}),
        
        // Métricas Globales
        new Paragraph({
          text: "Métricas Globales (solo activos incluidos)",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Total de Predicciones: ", bold: true }),
            new TextRun((cycle.metrics?.total || 0).toString())
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Predicciones Correctas: ", bold: true }),
            new TextRun((cycle.metrics?.correct || 0).toString())
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Tasa de Acierto: ", bold: true }),
            new TextRun({ text: `${cycle.metrics?.successRate || '0.00'}%`, color: "00AA00", bold: true })
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Error Promedio: ", bold: true }),
            new TextRun(`${cycle.metrics?.avgError || '0.00'}%`)
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Error Máximo: ", bold: true }),
            new TextRun(`${cycle.metrics?.maxError || '0.00'}%`)
          ],
          spacing: { after: 400 }
        }),
        
        // Métricas por Categoría
        new Paragraph({
          text: "Métricas por Categoría",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        createCategoryTable(cycle.metrics || {}),
        
        // Detalles de Predicciones
        new Paragraph({
          text: "Detalle de Predicciones",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        createResultsTable(validResults, cycle.excludedResults || [])
      ]
    }]
  });
  
  return doc;
}


/**
 * Crear tabla de configuración del algoritmo
 */
function createConfigTable(config) {
  const rows = [
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Parámetro", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Valor", bold: true })] })
      ]
    })
  ];
  
  // Extraer parámetros clave
  const params = [
    { label: 'Boost Power Threshold', value: config.boostPowerThreshold || 'N/A' },
    { label: 'INVERTIBLE Min Boost', value: config.classification?.invertibleMinBoost || 'N/A' },
    { label: 'INVERTIBLE Max Market Cap', value: config.classification?.invertibleMaxMarketCap ? `$${(config.classification.invertibleMaxMarketCap/1e9).toFixed(1)}B` : 'N/A' },
    { label: 'INVERTIBLE Target', value: config.prediction?.invertibleTarget ? `${config.prediction.invertibleTarget}%` : 'N/A' },
    { label: 'Magnitude Tolerance', value: config.prediction?.magnitudeTolerance ? `${config.prediction.magnitudeTolerance}%` : 'N/A' },
    { label: 'Meta Weight: Potential', value: config.metaWeights?.potential || 'N/A' },
    { label: 'Meta Weight: Resistance', value: config.metaWeights?.resistance || 'N/A' }
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
  
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows
  });
}

/**
 * Crear tabla de métricas por categoría
 */
function createCategoryTable(metrics) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      // Header
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: "Categoría", bold: true })] }),
          new TableCell({ children: [new Paragraph({ text: "Total", bold: true })] }),
          new TableCell({ children: [new Paragraph({ text: "Correctas", bold: true })] }),
          new TableCell({ children: [new Paragraph({ text: "Tasa de Acierto", bold: true })] })
        ]
      }),
      
      // INVERTIBLE
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("INVERTIBLE")] }),
          new TableCell({ children: [new Paragraph(metrics.invertible.total.toString())] }),
          new TableCell({ children: [new Paragraph(metrics.invertible.correct.toString())] }),
          new TableCell({ children: [new Paragraph(`${metrics.invertible.successRate}%`)] })
        ]
      }),
      
      // APALANCADO
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("APALANCADO")] }),
          new TableCell({ children: [new Paragraph(metrics.apalancado.total.toString())] }),
          new TableCell({ children: [new Paragraph(metrics.apalancado.correct.toString())] }),
          new TableCell({ children: [new Paragraph(`${metrics.apalancado.successRate}%`)] })
        ]
      }),
      
      // RUIDOSO
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph("RUIDOSO")] }),
          new TableCell({ children: [new Paragraph(metrics.ruidoso.total.toString())] }),
          new TableCell({ children: [new Paragraph(metrics.ruidoso.correct.toString())] }),
          new TableCell({ children: [new Paragraph(`${metrics.ruidoso.successRate}%`)] })
        ]
      })
    ]
  });
}

/**
 * Crear tabla de resultados
 */
function createResultsTable(results, excludedResults = []) {
  const rows = [
    // Header
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "Activo", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Categoría", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Predicción", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Real", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Error", bold: true })] }),
        new TableCell({ children: [new Paragraph({ text: "Resultado", bold: true })] })
      ]
    })
  ];
  
  // Data rows - solo activos NO excluidos (validResults ya está filtrado)
  results.forEach(result => {
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(`${result.name} (${result.symbol?.toUpperCase() || '—'})`)] }),
          new TableCell({ children: [new Paragraph(result.classification || 'N/A')] }),
          new TableCell({ children: [new Paragraph(`${result.predictedChange || 0}%`)] }),
          new TableCell({ children: [new Paragraph(`${result.actualChange || 0}%`)] }),
          new TableCell({ children: [new Paragraph(`${result.error || 0}%`)] }),
          new TableCell({ 
            children: [
              new Paragraph({
                text: result.correct ? "✓" : "✗",
                color: result.correct ? "00AA00" : "AA0000"
              })
            ] 
          })
        ]
      })
    );
  });
  
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows
  });
}

module.exports = {
  generateCycleReport
};
