# 📧 GUÍA DE CONFIGURACIÓN DE EMAIL

Esta guía te ayudará a configurar el envío automático de informes por email.

---

## 🎯 OPCIONES DISPONIBLES

Elige UNA de estas tres opciones:

### 1. SendGrid (✅ RECOMENDADA)
- ✅ Más fácil de configurar
- ✅ 100 emails/día gratis
- ✅ Muy confiable
- ✅ No requiere configuración del servidor

### 2. Gmail
- ✅ Gratis e ilimitado
- ⚠️ Requiere App Password
- ⚠️ Puede tener límites de envío

### 3. SMTP Genérico
- ✅ Compatible con cualquier proveedor
- ⚠️ Requiere configuración manual

---

## 📋 OPCIÓN 1: SENDGRID (Recomendada)

### Paso 1: Crear Cuenta

1. Ve a: https://signup.sendgrid.com/
2. Regístrate gratis (no necesitas tarjeta de crédito)
3. Verifica tu email

### Paso 2: Crear API Key

1. Una vez dentro, ve a: **Settings** → **API Keys**
2. Click en **"Create API Key"**
3. Nombre: `crypto-detector` (o el que prefieras)
4. Permisos: **"Full Access"** (o solo "Mail Send")
5. Click **"Create & View"**
6. **¡IMPORTANTE!** Copia la API key AHORA (solo la verás una vez)

### Paso 3: Verificar Identidad del Remitente

1. Ve a: **Settings** → **Sender Authentication**
2. Click en **"Verify a Single Sender"**
3. Completa el formulario:
   - From Name: `Crypto Detector`
   - From Email: tu email (ej: `tu@gmail.com`)
   - Reply To: el mismo email
   - Completa los demás campos
4. Click **"Create"**
5. Revisa tu email y verifica

### Paso 4: Configurar en .env

```bash
# En tu archivo .env
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMAIL_FROM=Crypto Detector <tu@email.com>
REPORT_RECIPIENT_EMAIL=destinatario@email.com
```

### Paso 5: Probar

```bash
# Iniciar servidor
npm start

# En otra terminal, probar:
curl -X POST http://localhost:3001/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"recipientEmail": "tu@email.com"}'
```

---

## 📋 OPCIÓN 2: GMAIL

### Paso 1: Activar Verificación en 2 Pasos

1. Ve a: https://myaccount.google.com/security
2. Busca **"Verificación en 2 pasos"**
3. Actívala si no lo has hecho

### Paso 2: Crear App Password

1. Ve a: https://myaccount.google.com/apppasswords
2. Nombre de la app: `Crypto Detector`
3. Click **"Generar"**
4. Copia el password de 16 caracteres (ej: `xxxx xxxx xxxx xxxx`)

### Paso 3: Configurar en .env

```bash
# En tu archivo .env
GMAIL_USER=tu@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
EMAIL_FROM=Crypto Detector <tu@gmail.com>
REPORT_RECIPIENT_EMAIL=destinatario@email.com
```

**IMPORTANTE:** El App Password son 16 caracteres separados por espacios.

### Paso 4: Probar

```bash
curl -X POST http://localhost:3001/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"recipientEmail": "tu@email.com"}'
```

---

## 📋 OPCIÓN 3: SMTP GENÉRICO

### Configuración para Proveedores Comunes

#### Outlook/Hotmail
```bash
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu@outlook.com
SMTP_PASS=tu_password
EMAIL_FROM=Crypto Detector <tu@outlook.com>
REPORT_RECIPIENT_EMAIL=destinatario@email.com
```

#### Yahoo Mail
```bash
SMTP_HOST=smtp.mail.yahoo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tu@yahoo.com
SMTP_PASS=tu_app_password
EMAIL_FROM=Crypto Detector <tu@yahoo.com>
REPORT_RECIPIENT_EMAIL=destinatario@email.com
```

#### Otro Proveedor
Consulta la documentación de tu proveedor de email para obtener:
- Host SMTP
- Puerto (usualmente 587 o 465)
- Si usa SSL/TLS

---

## 🧪 VERIFICAR CONFIGURACIÓN

### Método 1: Desde el navegador

1. Inicia el servidor: `npm start`
2. Abre: http://localhost:3001/api/health
3. Busca la sección `"email"`:
```json
{
  "email": {
    "configured": true,
    "recipient": true,
    "provider": "SendGrid"
  }
}
```

### Método 2: Verificar conexión

```bash
curl http://localhost:3001/api/email/verify
```

Deberías ver:
```json
{
  "configured": true,
  "hasRecipient": true,
  "provider": "SendGrid"
}
```

### Método 3: Enviar email de prueba

```bash
curl -X POST http://localhost:3001/api/email/test \
  -H "Content-Type: application/json" \
  -d '{"recipientEmail": "tu@email.com"}'
```

Respuesta exitosa:
```json
{
  "success": true,
  "message": "Test email sent successfully",
  "messageId": "..."
}
```

---

## 📨 CÓMO USAR EL SISTEMA

### 1. Emails Automáticos

Una vez configurado, el sistema enviará automáticamente un informe al finalizar cada ciclo de 12 horas.

El informe incluye:
- ✅ Resumen ejecutivo con tasa de acierto
- ✅ Métricas clave
- ✅ Análisis por clasificación
- ✅ Resultados detallados (top 20)
- ✅ Ajustes del algoritmo
- ✅ Conclusiones y recomendaciones
- ✅ Archivo Word adjunto con análisis completo

### 2. Generar Informe Manualmente (sin enviar)

Desde el frontend, click en el botón **"Descargar Informe"** después de ejecutar un ciclo.

O desde la API:
```bash
curl -X POST http://localhost:3001/api/reports/generate \
  -H "Content-Type: application/json" \
  -d @iteration-data.json \
  --output informe.docx
```

### 3. Enviar Informe Manualmente

Desde el frontend, click en **"Enviar por Email"**.

O desde la API:
```bash
curl -X POST http://localhost:3001/api/reports/send \
  -H "Content-Type: application/json" \
  -d '{
    "iterationData": {...},
    "recipientEmail": "opcional@email.com",
    "ccEmails": ["cc1@email.com", "cc2@email.com"]
  }'
```

---

## 🎨 PERSONALIZAR EMAILS

### Cambiar el remitente

```bash
EMAIL_FROM=Mi Nombre <mi@email.com>
```

### Añadir destinatarios en copia

```bash
REPORT_CC_EMAILS=manager@company.com,team@company.com
```

### Múltiples destinatarios principales

Puedes enviar a múltiples emails desde el frontend o API:
```json
{
  "recipientEmail": "persona1@email.com",
  "ccEmails": ["persona2@email.com", "persona3@email.com"]
}
```

---

## 🐛 SOLUCIÓN DE PROBLEMAS

### ❌ Error: "Email service not configured"

**Solución:** Verifica que tienes al menos una de estas variables:
- `SENDGRID_API_KEY`
- `GMAIL_USER` + `GMAIL_APP_PASSWORD`
- `SMTP_HOST` + `SMTP_USER` + `SMTP_PASS`

### ❌ Error: "Invalid login" (Gmail)

**Solución:** 
1. Verifica que la verificación en 2 pasos esté activa
2. Genera un nuevo App Password
3. Asegúrate de copiar los 16 caracteres correctamente

### ❌ Error: "Authentication failed" (SendGrid)

**Solución:**
1. Verifica que la API key esté correcta (sin espacios)
2. Verifica que la API key tenga permisos de "Mail Send"
3. Verifica que el remitente esté verificado en SendGrid

### ❌ El email no llega

**Solución:**
1. Revisa la carpeta de SPAM
2. Verifica que el email del remitente esté verificado
3. Espera unos minutos (puede haber delay)
4. Revisa los logs del servidor para errores

### ❌ Error: "No recipient email provided"

**Solución:**
Define `REPORT_RECIPIENT_EMAIL` en tu archivo .env

---

## 📊 LÍMITES Y CONSIDERACIONES

### SendGrid (Plan Gratuito)
- ✅ 100 emails/día
- ✅ Perfecto para este proyecto (máximo 2 emails/día)
- ⚠️ Requiere verificar identidad del remitente

### Gmail
- ✅ ~500 emails/día
- ⚠️ Puede marcar como spam si envías muchos
- ⚠️ Requiere App Password

### SMTP Genérico
- Depende del proveedor
- Consulta los límites de tu servicio de email

---

## 🔒 SEGURIDAD

### ✅ HACER:
- ✅ Usar variables de entorno (nunca hardcodear)
- ✅ Mantener el archivo .env en .gitignore
- ✅ Usar App Passwords (no tu password real)
- ✅ Rotar API keys periódicamente

### ❌ NO HACER:
- ❌ Subir .env a GitHub
- ❌ Compartir API keys públicamente
- ❌ Usar tu password real de email
- ❌ Enviar credenciales por email

---

## 🎯 CHECKLIST DE CONFIGURACIÓN

Antes de usar en producción, verifica:

- [ ] ✅ Variable de entorno del proveedor configurada
- [ ] ✅ EMAIL_FROM configurado
- [ ] ✅ REPORT_RECIPIENT_EMAIL configurado
- [ ] ✅ Email de prueba enviado exitosamente
- [ ] ✅ Email de prueba recibido (revisar spam)
- [ ] ✅ Remitente verificado (SendGrid)
- [ ] ✅ .env en .gitignore
- [ ] ✅ API keys seguras

---

## 💡 TIPS Y MEJORES PRÁCTICAS

1. **Usa SendGrid** para producción - es más confiable
2. **Verifica el remitente** antes de enviar emails masivos
3. **Configura cc/bcc** para mantener a tu equipo informado
4. **Revisa spam** la primera vez que recibas un email
5. **Guarda los informes** - el sistema no los almacena

---

## 🆘 SOPORTE

Si sigues teniendo problemas:

1. **Verifica logs del servidor:**
   ```bash
   npm start
   # Busca mensajes de error relacionados con email
   ```

2. **Prueba la conexión:**
   ```bash
   curl http://localhost:3001/api/email/verify
   ```

3. **Revisa la documentación del proveedor:**
   - SendGrid: https://docs.sendgrid.com/
   - Gmail: https://support.google.com/mail/answer/7126229
   - Nodemailer: https://nodemailer.com/

---

**¡Listo! Tu sistema de informes automáticos está configurado 🎉**
