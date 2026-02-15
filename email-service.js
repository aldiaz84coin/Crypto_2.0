// email-service.js - Servicio de Envío de Emails
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    // Configurar transportador de email
    // Soporta múltiples proveedores
    this.transporter = null;
    this.setupTransporter();
  }

  setupTransporter() {
    // Detectar proveedor según variables de entorno
    if (process.env.SENDGRID_API_KEY) {
      // SendGrid (Recomendado - 100 emails/día gratis)
      this.transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
          user: 'apikey',
          pass: process.env.SENDGRID_API_KEY
        }
      });
    } else if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      // Gmail con App Password
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD
        }
      });
    } else if (process.env.SMTP_HOST) {
      // SMTP Genérico
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    } else {
      // Modo de prueba sin envío real
      console.warn('⚠️  No email configuration found. Emails will be logged but not sent.');
      this.transporter = nodemailer.createTransport({
        jsonTransport: true
      });
    }
  }

  async sendIterationReport(reportData) {
    const {
      reportBuffer,
      iterationNumber,
      timestamp,
      successRate,
      recipientEmail,
      ccEmails = [],
      results
    } = reportData;

    const date = new Date(timestamp);
    const statusEmoji = successRate >= 85 ? '✅' : successRate >= 70 ? '⚠️' : '❌';
    const statusText = successRate >= 85 ? 'Objetivo Alcanzado' : successRate >= 70 ? 'En Progreso' : 'Requiere Atención';

    // Generar resumen HTML para el email
    const htmlContent = this.generateEmailHTML(
      iterationNumber,
      date,
      successRate,
      statusText,
      results
    );

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'Crypto Detector <noreply@cryptodetector.app>',
      to: recipientEmail,
      cc: ccEmails.length > 0 ? ccEmails.join(',') : undefined,
      subject: `${statusEmoji} Informe Iteración #${iterationNumber} - ${successRate}% de Acierto`,
      html: htmlContent,
      attachments: [
        {
          filename: `Informe-Iteracion-${iterationNumber}-${date.toISOString().split('T')[0]}.docx`,
          content: reportBuffer,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }
      ]
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      
      // Si es modo de prueba, loggear el mensaje
      if (this.transporter.transporter && this.transporter.transporter.name === 'JSONTransport') {
        console.log('📧 Email de prueba generado (no enviado):');
        console.log(JSON.parse(info.message));
        return {
          success: true,
          mode: 'test',
          messageId: 'test-' + Date.now()
        };
      }

      console.log('✅ Email enviado exitosamente:', info.messageId);
      return {
        success: true,
        mode: 'production',
        messageId: info.messageId
      };
    } catch (error) {
      console.error('❌ Error enviando email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  generateEmailHTML(iterationNumber, date, successRate, statusText, results) {
    const correct = results.filter(r => r.correct).length;
    const total = results.length;
    const incorrect = total - correct;

    const invertibles = results.filter(r => r.classification === 'invertible');
    const apalancados = results.filter(r => r.classification === 'apalancado');
    const ruidosos = results.filter(r => r.classification === 'ruidoso');

    const statusColor = successRate >= 85 ? '#22C55E' : successRate >= 70 ? '#F59E0B' : '#EF4444';
    const statusBg = successRate >= 85 ? '#DCFCE7' : successRate >= 70 ? '#FEF3C7' : '#FEE2E2';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: white;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 3px solid #2E75B6;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #2E75B6;
      margin: 0 0 10px 0;
      font-size: 28px;
    }
    .header .iteration {
      color: #666;
      font-size: 18px;
    }
    .status-badge {
      display: inline-block;
      padding: 12px 24px;
      border-radius: 20px;
      font-size: 24px;
      font-weight: bold;
      margin: 20px 0;
      background-color: ${statusBg};
      color: ${statusColor};
    }
    .metrics {
      background-color: #f9fafb;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .metric-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .metric-row:last-child {
      border-bottom: none;
    }
    .metric-label {
      font-weight: 600;
      color: #666;
    }
    .metric-value {
      font-weight: bold;
      color: #111;
    }
    .classification-section {
      margin: 25px 0;
    }
    .classification-header {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 10px;
      padding: 10px;
      background-color: #f3f4f6;
      border-radius: 5px;
    }
    .classification-stats {
      padding-left: 20px;
      margin-top: 10px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      color: #666;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      margin: 20px 0;
      padding: 12px 30px;
      background-color: #2E75B6;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      font-weight: bold;
    }
    .success { color: #22C55E; }
    .warning { color: #F59E0B; }
    .error { color: #EF4444; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Crypto Detector</h1>
      <div class="iteration">Iteración #${iterationNumber}</div>
      <div style="color: #666; font-size: 14px; margin-top: 10px;">
        ${date.toLocaleDateString('es-ES', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })} a las ${date.toLocaleTimeString('es-ES', { 
          hour: '2-digit', 
          minute: '2-digit' 
        })}
      </div>
    </div>

    <div style="text-align: center;">
      <div class="status-badge">
        ${successRate}% de Acierto
      </div>
      <div style="font-size: 18px; color: ${statusColor}; font-weight: bold; margin-top: 10px;">
        ${statusText}
      </div>
    </div>

    <div class="metrics">
      <h3 style="margin-top: 0; color: #2E75B6;">📊 Resumen de Resultados</h3>
      
      <div class="metric-row">
        <span class="metric-label">Total de Predicciones:</span>
        <span class="metric-value">${total}</span>
      </div>
      
      <div class="metric-row">
        <span class="metric-label">Predicciones Correctas:</span>
        <span class="metric-value success">${correct} (${((correct/total)*100).toFixed(1)}%)</span>
      </div>
      
      <div class="metric-row">
        <span class="metric-label">Predicciones Incorrectas:</span>
        <span class="metric-value error">${incorrect} (${((incorrect/total)*100).toFixed(1)}%)</span>
      </div>
    </div>

    <div class="classification-section">
      <h3 style="color: #2E75B6;">🎯 Análisis por Clasificación</h3>
      
      <div class="classification-header" style="color: #22C55E;">
        🟢 Invertibles: ${invertibles.length} activos
      </div>
      <div class="classification-stats">
        <div class="metric-row">
          <span class="metric-label">Tasa de Acierto:</span>
          <span class="metric-value ${invertibles.length > 0 && (invertibles.filter(i => i.correct).length / invertibles.length * 100) >= 70 ? 'success' : 'warning'}">
            ${invertibles.length > 0 ? ((invertibles.filter(i => i.correct).length / invertibles.length) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>

      <div class="classification-header" style="color: #F59E0B; margin-top: 15px;">
        🟡 Apalancados: ${apalancados.length} activos
      </div>
      <div class="classification-stats">
        <div class="metric-row">
          <span class="metric-label">Tasa de Acierto:</span>
          <span class="metric-value ${apalancados.length > 0 && (apalancados.filter(a => a.correct).length / apalancados.length * 100) >= 70 ? 'success' : 'warning'}">
            ${apalancados.length > 0 ? ((apalancados.filter(a => a.correct).length / apalancados.length) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>

      <div class="classification-header" style="color: #9CA3AF; margin-top: 15px;">
        ⚪ Ruidosos: ${ruidosos.length} activos
      </div>
      <div class="classification-stats">
        <div class="metric-row">
          <span class="metric-label">Tasa de Acierto:</span>
          <span class="metric-value ${ruidosos.length > 0 && (ruidosos.filter(r => r.correct).length / ruidosos.length * 100) >= 70 ? 'success' : 'warning'}">
            ${ruidosos.length > 0 ? ((ruidosos.filter(r => r.correct).length / ruidosos.length) * 100).toFixed(1) : '0.0'}%
          </span>
        </div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 30px;">
      <p style="color: #666; margin-bottom: 10px;">
        📎 Se adjunta el informe completo en formato Word con análisis detallado, 
        conclusiones y recomendaciones para la próxima iteración.
      </p>
    </div>

    <div class="footer">
      <p><strong>Crypto Detector</strong> - Sistema Inteligente de Análisis de Criptoactivos</p>
      <p style="font-size: 12px; color: #999; margin-top: 10px;">
        Este es un email automático generado por el sistema. 
        Los datos son actualizados cada 12 horas.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // Verificar configuración del servicio
  async verify() {
    try {
      await this.transporter.verify();
      console.log('✅ Servicio de email configurado correctamente');
      return true;
    } catch (error) {
      console.error('❌ Error en configuración de email:', error.message);
      return false;
    }
  }

  // Enviar email de prueba
  async sendTestEmail(recipientEmail) {
    const testMailOptions = {
      from: process.env.EMAIL_FROM || 'Crypto Detector <noreply@cryptodetector.app>',
      to: recipientEmail,
      subject: '🧪 Email de Prueba - Crypto Detector',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2E75B6;">✅ Configuración de Email Correcta</h2>
          <p>Este es un email de prueba del sistema Crypto Detector.</p>
          <p>Si recibes este mensaje, significa que el servicio de email está configurado correctamente y podrás recibir los informes automáticos de cada iteración.</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
          <p style="color: #666; font-size: 14px;">
            <strong>Próximos pasos:</strong><br>
            Los informes automáticos se enviarán al finalizar cada ciclo de 12 horas con:
            <ul style="color: #666;">
              <li>Resultados detallados de las predicciones</li>
              <li>Análisis por clasificación</li>
              <li>Ajustes del algoritmo</li>
              <li>Conclusiones y recomendaciones</li>
            </ul>
          </p>
        </div>
      `
    };

    try {
      const info = await this.transporter.sendMail(testMailOptions);
      console.log('✅ Email de prueba enviado:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Error enviando email de prueba:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = EmailService;
