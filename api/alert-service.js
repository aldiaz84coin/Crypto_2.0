// api/alert-service.js — Alertas por email y scheduler de detección
'use strict';
const nodemailer = require('nodemailer');

// ─── Configuración de email ────────────────────────────────────────────────
// Soporta: SMTP genérico, Gmail, SendGrid (via SMTP relay)
function buildTransporter(emailConfig) {
  const cfg = emailConfig || {};
  return nodemailer.createTransport({
    host:   cfg.host   || 'smtp.gmail.com',
    port:   cfg.port   || 587,
    secure: cfg.port   === 465,
    auth: {
      user: cfg.user   || '',
      pass: cfg.pass   || ''    // Gmail: usa App Password (no la contraseña de cuenta)
    }
  });
}

// ─── Email de alerta de pump ───────────────────────────────────────────────
function buildPumpEmailHTML(detection) {
  const riskColors = { red: '#ef4444', orange: '#f97316', green: '#22c55e' };
  const color = riskColors[detection.riskColor] || '#6b7280';

  const breakdownRows = Object.entries(detection.breakdown || {}).map(([key, val]) => {
    const names = { socialSpike:'📱 Spike Social', volumeAnomaly:'📊 Volumen Anómalo', vacuousNews:'📰 Noticias Vacías',
      whaleActivity:'🐋 Actividad Ballenas', lunarCrush:'🌙 LunarCrush', timingSync:'⏱️ Timing Sincronizado' };
    const bars = '█'.repeat(val.score) + '░'.repeat(Math.max(0, val.max - val.score));
    return `<tr><td style="padding:4px 8px;color:#9ca3af;font-size:13px">${names[key]||key}</td>
      <td style="padding:4px 8px;font-family:monospace;color:${color}">${bars}</td>
      <td style="padding:4px 8px;color:#e5e7eb;font-size:13px;text-align:right">${val.score}/${val.max}</td></tr>`;
  }).join('');

  const evidenceItems = (detection.evidence || []).map(e =>
    `<li style="color:#d1d5db;font-size:13px;margin-bottom:4px">⚡ ${e}</li>`
  ).join('');

  const newsItems = (detection.flaggedNews || []).slice(0, 3).map(n =>
    `<li style="color:#fbbf24;font-size:12px;margin-bottom:4px">📰 ${n.title} <em style="color:#6b7280">(${n.source})</em></li>`
  ).join('');

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="background:#0f172a;color:#e5e7eb;font-family:sans-serif;padding:20px;max-width:600px;margin:0 auto">
  <div style="background:#1e293b;border-radius:16px;padding:24px;border:2px solid ${color}">
    <h1 style="margin:0 0 4px;font-size:22px">${detection.riskEmoji} Pump Detectado</h1>
    <p style="margin:0 0 16px;color:#9ca3af;font-size:13px">CryptoDetector · ${new Date(detection.detectedAt).toLocaleString('es-ES')}</p>

    <div style="background:#0f172a;border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0;font-size:20px;color:#fff">${detection.name} <span style="color:#6b7280;font-size:14px">${detection.symbol}</span></h2>
          <p style="margin:4px 0;color:#9ca3af;font-size:12px">Market Cap: $${(detection.market_cap/1e6).toFixed(1)}M</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:28px;font-weight:bold;font-family:monospace;color:${color}">${detection.totalScore}/10</div>
          <div style="background:${color};color:#fff;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:bold">${detection.riskLevel}</div>
        </div>
      </div>
    </div>

    <h3 style="color:#9ca3af;font-size:13px;margin:0 0 8px;text-transform:uppercase">Score por señal</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${breakdownRows}</table>

    <h3 style="color:#9ca3af;font-size:13px;margin:0 0 8px;text-transform:uppercase">Evidencias detectadas</h3>
    <ul style="margin:0 0 16px;padding-left:16px">${evidenceItems || '<li style="color:#6b7280">Sin evidencias específicas</li>'}</ul>

    ${newsItems ? `<h3 style="color:#9ca3af;font-size:13px;margin:0 0 8px;text-transform:uppercase">Noticias sospechosas</h3><ul style="margin:0 0 16px;padding-left:16px">${newsItems}</ul>` : ''}

    <div style="background:#1f2937;border-radius:8px;padding:12px;margin-top:16px;border-left:4px solid #f59e0b">
      <p style="margin:0;font-size:12px;color:#9ca3af">⚠️ Este es un detector de patrones automático. No constituye asesoramiento financiero. Verifica siempre manualmente antes de tomar decisiones.</p>
    </div>
  </div>
</body></html>`;
}

// ─── Enviar alerta ─────────────────────────────────────────────────────────
async function sendPumpAlert(detection, emailConfig) {
  if (!emailConfig?.user || !emailConfig?.to) {
    return { success: false, reason: 'Email no configurado' };
  }
  try {
    const transporter = buildTransporter(emailConfig);
    const result = await transporter.sendMail({
      from:    `"CryptoDetector 🚨" <${emailConfig.user}>`,
      to:      emailConfig.to,
      subject: `${detection.riskEmoji} [${detection.riskLevel}] Pump detectado: ${detection.name} (${detection.symbol}) · Score ${detection.totalScore}/10`,
      html:    buildPumpEmailHTML(detection)
    });
    return { success: true, messageId: result.messageId };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ─── Scheduler en memoria (Vercel-compatible via cron externo) ─────────────
// En Vercel, el scheduler se activa via vercel.json "crons" o un endpoint hit externo
// En desarrollo local, usamos setInterval
let schedulerInterval = null;

function startScheduler(scanFn, intervalMs = 6 * 3600000) {
  if (schedulerInterval) clearInterval(schedulerInterval);
  schedulerInterval = setInterval(async () => {
    try {
      console.log('[PumpDetector] Escaneo automático iniciado:', new Date().toISOString());
      await scanFn();
    } catch(e) {
      console.error('[PumpDetector] Error en escaneo automático:', e.message);
    }
  }, intervalMs);
  console.log(`[PumpDetector] Scheduler activo — cada ${intervalMs / 3600000}h`);
  return schedulerInterval;
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

module.exports = { sendPumpAlert, buildPumpEmailHTML, startScheduler, stopScheduler };
