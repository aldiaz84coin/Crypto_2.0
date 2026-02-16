// report-generator.js - Generador de Informes Word (Iteración 3)

const { Document, Paragraph, TextRun, Table, TableCell, TableRow, HeadingLevel, AlignmentType, WidthType } = require('docx');

/**
 * Generar informe Word de un ciclo completado
 */
function generateCycleReport(cycle) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Título
        new Paragraph({
          text: "INFORME DE CICLO DE PREDICCIÓN",
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
            new TextRun({ text: "Fecha de Inicio: ", bold: true }),
            new TextRun(new Date(cycle.startTime).toLocaleString())
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Fecha de Finalización: ", bold: true }),
            new TextRun(new Date(cycle.completedAt).toLocaleString())
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Duración: ", bold: true }),
            new TextRun("12 horas")
          ],
          spacing: { after: 400 }
        }),
        
        // Métricas Globales
        new Paragraph({
          text: "Métricas Globales",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Total de Predicciones: ", bold: true }),
            new TextRun(cycle.metrics.total.toString())
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Predicciones Correctas: ", bold: true }),
            new TextRun(cycle.metrics.correct.toString())
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Tasa de Acierto: ", bold: true }),
            new TextRun({ text: `${cycle.metrics.successRate}%`, color: "00AA00", bold: true })
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Error Promedio: ", bold: true }),
            new TextRun(`${cycle.metrics.avgError}%`)
          ]
        }),
        
        new Paragraph({
          children: [
            new TextRun({ text: "Error Máximo: ", bold: true }),
            new TextRun(`${cycle.metrics.maxError}%`)
          ],
          spacing: { after: 400 }
        }),
        
        // Métricas por Categoría
        new Paragraph({
          text: "Métricas por Categoría",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        createCategoryTable(cycle.metrics),
        
        // Detalles de Predicciones
        new Paragraph({
          text: "Detalle de Predicciones",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 }
        }),
        
        createResultsTable(cycle.results)
      ]
    }]
  });
  
  return doc;
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
function createResultsTable(results) {
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
  
  // Data rows
  results.forEach(result => {
    rows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(`${result.name} (${result.symbol.toUpperCase()})`)] }),
          new TableCell({ children: [new Paragraph(result.classification)] }),
          new TableCell({ children: [new Paragraph(`${result.predictedChange}%`)] }),
          new TableCell({ children: [new Paragraph(`${result.actualChange}%`)] }),
          new TableCell({ children: [new Paragraph(`${result.error}%`)] }),
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
