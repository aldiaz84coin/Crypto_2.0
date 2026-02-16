// report-generator.js - Generador de Informes de Iteración
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, 
        AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
        PageBreak, LevelFormat } = require('docx');
const fs = require('fs');

class ReportGenerator {
  constructor() {
    this.border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
    this.borders = { 
      top: this.border, 
      bottom: this.border, 
      left: this.border, 
      right: this.border 
    };
  }

  generateReport(iterationData) {
    const {
      iterationNumber,
      timestamp,
      cryptoAssets,
      predictions,
      results,
      algorithm,
      successRate,
      recommendations
    } = iterationData;

    const doc = new Document({
      styles: {
        default: { 
          document: { 
            run: { font: "Arial", size: 24 } 
          } 
        },
        paragraphStyles: [
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { size: 32, bold: true, font: "Arial", color: "2E75B6" },
            paragraph: { 
              spacing: { before: 240, after: 240 },
              outlineLevel: 0 
            }
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { size: 28, bold: true, font: "Arial", color: "2E75B6" },
            paragraph: { 
              spacing: { before: 180, after: 180 },
              outlineLevel: 1 
            }
          },
          {
            id: "Heading3",
            name: "Heading 3",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { size: 26, bold: true, font: "Arial" },
            paragraph: { 
              spacing: { before: 140, after: 140 },
              outlineLevel: 2 
            }
          }
        ]
      },
      numbering: {
        config: [
          {
            reference: "bullets",
            levels: [
              {
                level: 0,
                format: LevelFormat.BULLET,
                text: "•",
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 }
                  }
                }
              }
            ]
          },
          {
            reference: "numbers",
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: {
                    indent: { left: 720, hanging: 360 }
                  }
                }
              }
            ]
          }
        ]
      },
      sections: [{
        properties: {
          page: {
            size: {
              width: 12240,
              height: 15840
            },
            margin: { 
              top: 1440, 
              right: 1440, 
              bottom: 1440, 
              left: 1440 
            }
          }
        },
        children: [
          // Portada
          ...this.createCoverPage(iterationNumber, timestamp, successRate),
          
          new Paragraph({ children: [new PageBreak()] }),
          
          // Resumen Ejecutivo
          ...this.createExecutiveSummary(results, successRate, algorithm),
          
          new Paragraph({ children: [new PageBreak()] }),
          
          // Resultados Detallados
          ...this.createDetailedResults(predictions, results),
          
          new Paragraph({ children: [new PageBreak()] }),
          
          // Análisis por Clasificación
          ...this.createClassificationAnalysis(results),
          
          new Paragraph({ children: [new PageBreak()] }),
          
          // Ajustes del Algoritmo
          ...this.createAlgorithmAdjustments(algorithm),
          
          new Paragraph({ children: [new PageBreak()] }),
          
          // Conclusiones y Recomendaciones
          ...this.createConclusionsAndRecommendations(results, recommendations)
        ]
      }]
    });

    return Packer.toBuffer(doc);
  }

  createCoverPage(iterationNumber, timestamp, successRate) {
    const date = new Date(timestamp);
    const statusColor = successRate >= 85 ? "22C55E" : successRate >= 70 ? "F59E0B" : "EF4444";
    const statusText = successRate >= 85 ? "OBJETIVO ALCANZADO" : successRate >= 70 ? "EN PROGRESO" : "REQUIERE ATENCIÓN";

    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2880, after: 480 },
        children: [
          new TextRun({
            text: "INFORME DE ITERACIÓN",
            size: 48,
            bold: true,
            color: "2E75B6"
          })
        ]
      }),
      
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: "Detector de Criptoactivos Invertibles",
            size: 32,
            color: "666666"
          })
        ]
      }),

      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 480, after: 1440 },
        children: [
          new TextRun({
            text: `Iteración #${iterationNumber}`,
            size: 36,
            bold: true
          })
        ]
      }),

      // Box con estadísticas principales
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 960, after: 240 },
        children: [
          new TextRun({
            text: `Tasa de Acierto: ${successRate}%`,
            size: 44,
            bold: true,
            color: statusColor
          })
        ]
      }),

      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: statusText,
            size: 28,
            bold: true,
            color: statusColor
          })
        ]
      }),

      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 960, after: 120 },
        children: [
          new TextRun({
            text: "Fecha del Análisis:",
            size: 24,
            color: "666666"
          })
        ]
      }),

      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: date.toLocaleString('es-ES', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
            size: 24,
            bold: true
          })
        ]
      })
    ];
  }

  createExecutiveSummary(results, successRate, algorithm) {
    const totalPredictions = results.length;
    const correct = results.filter(r => r.correct).length;
    const incorrect = totalPredictions - correct;
    
    const invertibles = results.filter(r => r.classification === 'invertible');
    const apalancados = results.filter(r => r.classification === 'apalancado');
    const ruidosos = results.filter(r => r.classification === 'ruidoso');

    const invertiblesSuccess = invertibles.filter(r => r.correct).length;
    const apalancadosSuccess = apalancados.filter(r => r.correct).length;
    const ruidososSuccess = ruidosos.filter(r => r.correct).length;

    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Resumen Ejecutivo")]
      }),

      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: `Esta iteración analizó ${totalPredictions} criptoactivos durante un ciclo de 12 horas, `,
            size: 24
          }),
          new TextRun({
            text: `alcanzando una tasa de acierto del ${successRate}%`,
            size: 24,
            bold: true,
            color: successRate >= 85 ? "22C55E" : "F59E0B"
          }),
          new TextRun({
            text: ". El algoritmo continúa aprendiendo y ajustando sus parámetros para mejorar la precisión de las predicciones.",
            size: 24
          })
        ]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Métricas Clave")]
      }),

      this.createMetricsTable([
        ["Total de Predicciones", totalPredictions.toString()],
        ["Predicciones Correctas", `${correct} (${((correct/totalPredictions)*100).toFixed(1)}%)`],
        ["Predicciones Incorrectas", `${incorrect} (${((incorrect/totalPredictions)*100).toFixed(1)}%)`],
        ["Activos Invertibles Analizados", invertibles.length.toString()],
        ["Activos Apalancados Analizados", apalancados.length.toString()],
        ["Activos Ruidosos Analizados", ruidosos.length.toString()]
      ]),

      new Paragraph({ spacing: { before: 240, after: 120 } }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Precisión por Clasificación")]
      }),

      this.createMetricsTable([
        ["Invertibles", invertibles.length > 0 ? `${((invertiblesSuccess/invertibles.length)*100).toFixed(1)}%` : "N/A"],
        ["Apalancados", apalancados.length > 0 ? `${((apalancadosSuccess/apalancados.length)*100).toFixed(1)}%` : "N/A"],
        ["Ruidosos", ruidosos.length > 0 ? `${((ruidososSuccess/ruidosos.length)*100).toFixed(1)}%` : "N/A"]
      ])
    ];
  }

  createDetailedResults(predictions, results) {
    const sortedResults = [...results].sort((a, b) => {
      // Ordenar: primero correctos, luego por valor absoluto del cambio
      if (a.correct !== b.correct) return b.correct ? 1 : -1;
      return Math.abs(parseFloat(b.actualChange)) - Math.abs(parseFloat(a.actualChange));
    });

    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Resultados Detallados")]
      }),

      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: "A continuación se presenta el análisis detallado de cada activo evaluado en esta iteración:",
            size: 24
          })
        ]
      }),

      this.createResultsTable(sortedResults.slice(0, 20)) // Top 20
    ];
  }

  createClassificationAnalysis(results) {
    const analysis = {
      invertible: this.analyzeClassification(results.filter(r => r.classification === 'invertible')),
      apalancado: this.analyzeClassification(results.filter(r => r.classification === 'apalancado')),
      ruidoso: this.analyzeClassification(results.filter(r => r.classification === 'ruidoso'))
    };

    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Análisis por Clasificación")]
      }),

      // Invertibles
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("🟢 Activos Invertibles")]
      }),

      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `Analizados: ${analysis.invertible.total} | `,
            size: 24
          }),
          new TextRun({
            text: `Correctos: ${analysis.invertible.correct} (${analysis.invertible.successRate}%)`,
            size: 24,
            bold: true,
            color: analysis.invertible.total > 0 && parseFloat(analysis.invertible.successRate) >= 70 ? "22C55E" : "F59E0B"
          })
        ]
      }),

      ...this.createClassificationDetails(analysis.invertible),

      // Apalancados
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 480 },
        children: [new TextRun("🟡 Activos Apalancados")]
      }),

      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `Analizados: ${analysis.apalancado.total} | `,
            size: 24
          }),
          new TextRun({
            text: `Correctos: ${analysis.apalancado.correct} (${analysis.apalancado.successRate}%)`,
            size: 24,
            bold: true,
            color: analysis.apalancado.total > 0 && parseFloat(analysis.apalancado.successRate) >= 70 ? "22C55E" : "F59E0B"
          })
        ]
      }),

      ...this.createClassificationDetails(analysis.apalancado),

      // Ruidosos
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 480 },
        children: [new TextRun("⚪ Activos Ruidosos")]
      }),

      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `Analizados: ${analysis.ruidoso.total} | `,
            size: 24
          }),
          new TextRun({
            text: `Correctos: ${analysis.ruidoso.correct} (${analysis.ruidoso.successRate}%)`,
            size: 24,
            bold: true,
            color: analysis.ruidoso.total > 0 && parseFloat(analysis.ruidoso.successRate) >= 70 ? "22C55E" : "F59E0B"
          })
        ]
      }),

      ...this.createClassificationDetails(analysis.ruidoso)
    ];
  }

  createAlgorithmAdjustments(algorithm) {
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Ajustes del Algoritmo")]
      }),

      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: "El sistema ha ajustado automáticamente los siguientes parámetros basándose en el rendimiento de esta iteración:",
            size: 24
          })
        ]
      }),

      this.createMetricsTable([
        ["Umbral de Incremento de Búsquedas", `${algorithm.searchIncreaseThreshold.toFixed(1)}%`],
        ["Umbral de Noticias Simultáneas", algorithm.newsCountThreshold.toFixed(1)],
        ["Umbral de Boost-Power", algorithm.boostPowerThreshold.toFixed(3)],
        ["Ratio Capitalización/Valor", algorithm.marketCapRatioThreshold.toFixed(3)],
        ["Percentil Histórico Bajo", `${algorithm.historicalLowPercentile}%`]
      ])
    ];
  }

  createConclusionsAndRecommendations(results, recommendations) {
    const successRate = (results.filter(r => r.correct).length / results.length) * 100;
    
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Conclusiones y Recomendaciones")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Conclusiones Principales")]
      }),

      new Paragraph({
        spacing: { after: 120 },
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({
            text: successRate >= 85 
              ? "El algoritmo ha alcanzado el objetivo de 85%+ de precisión y está operando de manera óptima."
              : successRate >= 70
              ? "El algoritmo está en proceso de optimización y muestra progreso hacia el objetivo del 85%."
              : "El algoritmo requiere ajustes significativos para mejorar la tasa de acierto.",
            size: 24
          })
        ]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `Se analizaron ${results.length} activos con una distribución equilibrada entre las categorías de clasificación.`,
            size: 24
          })
        ]
      }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: "Los parámetros del algoritmo se han ajustado automáticamente para mejorar el rendimiento en la próxima iteración.",
            size: 24
          })
        ]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Recomendaciones para la Próxima Iteración")]
      }),

      ...this.generateRecommendations(results, recommendations)
    ];
  }

  // Métodos auxiliares

  createMetricsTable(data) {
    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [6000, 3360],
      rows: data.map(([label, value]) => 
        new TableRow({
          children: [
            new TableCell({
              borders: this.borders,
              width: { size: 6000, type: WidthType.DXA },
              shading: { fill: "F3F4F6", type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: label, size: 22, bold: true })
                  ]
                })
              ]
            }),
            new TableCell({
              borders: this.borders,
              width: { size: 3360, type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: value, size: 22 })
                  ]
                })
              ]
            })
          ]
        })
      )
    });
  }

  createResultsTable(results) {
    const headerRow = new TableRow({
      children: [
        "Símbolo",
        "Clasificación",
        "Predicción",
        "Real",
        "Resultado"
      ].map(text => 
        new TableCell({
          borders: this.borders,
          width: { size: 1872, type: WidthType.DXA },
          shading: { fill: "2E75B6", type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ 
                  text, 
                  size: 20, 
                  bold: true,
                  color: "FFFFFF"
                })
              ]
            })
          ]
        })
      )
    });

    const dataRows = results.map(result => 
      new TableRow({
        children: [
          new TableCell({
            borders: this.borders,
            width: { size: 1872, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ 
                    text: result.symbol, 
                    size: 20,
                    bold: true
                  })
                ]
              })
            ]
          }),
          new TableCell({
            borders: this.borders,
            width: { size: 1872, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ 
                    text: result.classification.toUpperCase(), 
                    size: 18
                  })
                ]
              })
            ]
          }),
          new TableCell({
            borders: this.borders,
            width: { size: 1872, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ 
                    text: `${result.predictedChange >= 0 ? '+' : ''}${result.predictedChange}%`, 
                    size: 20
                  })
                ]
              })
            ]
          }),
          new TableCell({
            borders: this.borders,
            width: { size: 1872, type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ 
                    text: `${parseFloat(result.actualChange) >= 0 ? '+' : ''}${result.actualChange}%`, 
                    size: 20,
                    color: parseFloat(result.actualChange) >= 0 ? "22C55E" : "EF4444"
                  })
                ]
              })
            ]
          }),
          new TableCell({
            borders: this.borders,
            width: { size: 1872, type: WidthType.DXA },
            shading: { 
              fill: result.correct ? "DCFCE7" : "FEE2E2", 
              type: ShadingType.CLEAR 
            },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ 
                    text: result.correct ? "✓ CORRECTO" : "✗ INCORRECTO", 
                    size: 18,
                    bold: true,
                    color: result.correct ? "16A34A" : "DC2626"
                  })
                ]
              })
            ]
          })
        ]
      })
    );

    return new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1872, 1872, 1872, 1872, 1872],
      rows: [headerRow, ...dataRows]
    });
  }

  analyzeClassification(items) {
    if (items.length === 0) {
      return {
        total: 0,
        correct: 0,
        successRate: "0.0",
        avgPredictedChange: 0,
        avgActualChange: 0
      };
    }

    const correct = items.filter(i => i.correct).length;
    const avgPredicted = items.reduce((sum, i) => sum + parseFloat(i.predictedChange), 0) / items.length;
    const avgActual = items.reduce((sum, i) => sum + parseFloat(i.actualChange), 0) / items.length;

    return {
      total: items.length,
      correct,
      successRate: ((correct / items.length) * 100).toFixed(1),
      avgPredictedChange: avgPredicted.toFixed(2),
      avgActualChange: avgActual.toFixed(2)
    };
  }

  createClassificationDetails(analysis) {
    if (analysis.total === 0) {
      return [
        new Paragraph({
          spacing: { after: 240 },
          children: [
            new TextRun({
              text: "No se analizaron activos en esta categoría durante esta iteración.",
              size: 22,
              italics: true,
              color: "666666"
            })
          ]
        })
      ];
    }

    return [
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: `Cambio promedio predicho: `,
            size: 22
          }),
          new TextRun({
            text: `${analysis.avgPredictedChange}%`,
            size: 22,
            bold: true
          })
        ]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [
          new TextRun({
            text: `Cambio promedio real: `,
            size: 22
          }),
          new TextRun({
            text: `${analysis.avgActualChange}%`,
            size: 22,
            bold: true,
            color: parseFloat(analysis.avgActualChange) >= 0 ? "22C55E" : "EF4444"
          })
        ]
      })
    ];
  }

  generateRecommendations(results, customRecommendations = []) {
    const recommendations = [...customRecommendations];
    const successRate = (results.filter(r => r.correct).length / results.length) * 100;

    // Recomendaciones automáticas basadas en el rendimiento
    if (successRate < 70) {
      recommendations.push(
        "Incrementar el tamaño de la muestra para obtener datos más representativos.",
        "Revisar y ajustar los umbrales de clasificación de manera más agresiva.",
        "Considerar la incorporación de nuevas fuentes de datos o indicadores."
      );
    } else if (successRate < 85) {
      recommendations.push(
        "Continuar con el ajuste fino de los parámetros del algoritmo.",
        "Monitorear de cerca las clasificaciones con menor tasa de acierto.",
        "Validar que las fuentes de datos estén proporcionando información actualizada."
      );
    } else {
      recommendations.push(
        "Mantener los parámetros actuales del algoritmo.",
        "Explorar oportunidades para optimizar el tiempo de análisis.",
        "Considerar la expansión a mercados o activos adicionales."
      );
    }

    // Siempre recomendar
    recommendations.push(
      "Documentar cualquier evento de mercado extraordinario que pueda afectar los resultados.",
      "Revisar periódicamente la validez de las API keys y fuentes de datos."
    );

    return recommendations.map(rec => 
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: rec,
            size: 24
          })
        ]
      })
    );
  }
}

module.exports = ReportGenerator;
