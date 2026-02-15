#!/bin/bash

# 🚀 Script de Configuración Automática para Vercel
# Crypto Detector - Setup Automático

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 CRYPTO DETECTOR - Configuración para Vercel"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar que estamos en el directorio correcto
if [ ! -f "server.js" ]; then
    echo "❌ Error: No se encuentra server.js"
    echo "Por favor ejecuta este script desde la carpeta del proyecto"
    exit 1
fi

echo "${BLUE}📁 Paso 1: Creando estructura de carpetas...${NC}"
mkdir -p api public
echo "   ✅ Carpetas creadas"
echo ""

echo "${BLUE}📦 Paso 2: Organizando archivos...${NC}"

# Copiar backend a /api
if [ -f "api-index.js" ]; then
    cp api-index.js api/index.js
    echo "   ✅ Backend copiado a api/index.js"
elif [ -f "server.js" ]; then
    cp server.js api/index.js
    echo "   ✅ Backend copiado a api/index.js"
else
    echo "   ❌ No se encontró el archivo del backend"
    exit 1
fi

# Copiar frontend a /public
if [ -f "crypto-detector-real-api.jsx" ]; then
    cp crypto-detector-real-api.jsx public/app.jsx
    echo "   ✅ Frontend copiado a public/app.jsx"
else
    echo "   ❌ No se encontró crypto-detector-real-api.jsx"
    exit 1
fi

# Copiar index.html
if [ -f "index.html" ]; then
    cp index.html public/index.html
    echo "   ✅ index.html copiado a public/"
else
    echo "   ⚠️  No se encontró index.html, creando uno nuevo..."
    cat > public/index.html << 'EOF'
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Crypto Detector</title>
    <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
    <div id="root"></div>
    <script type="text/babel" src="app.jsx"></script>
    <script type="text/babel">
        ReactDOM.createRoot(document.getElementById('root')).render(<CryptoDetectorApp />);
    </script>
</body>
</html>
EOF
    echo "   ✅ index.html creado"
fi

# Copiar vercel.json
if [ -f "vercel.json" ]; then
    echo "   ✅ vercel.json ya existe"
else
    echo "   ⚠️  Creando vercel.json..."
    cat > vercel.json << 'EOF'
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    },
    {
      "src": "public/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/public/$1"
    }
  ]
}
EOF
    echo "   ✅ vercel.json creado"
fi

echo ""
echo "${BLUE}🔧 Paso 3: Actualizando URLs en el frontend...${NC}"

# Actualizar URLs en app.jsx para usar rutas relativas
if [ -f "public/app.jsx" ]; then
    # Backup
    cp public/app.jsx public/app.jsx.backup
    
    # Reemplazar localhost:3001 con URLs relativas
    sed -i.bak "s|http://localhost:3001/api/|/api/|g" public/app.jsx
    sed -i.bak "s|http://localhost:\${PORT}/api/|/api/|g" public/app.jsx
    
    # Limpiar archivos backup de sed
    rm -f public/app.jsx.bak
    
    echo "   ✅ URLs actualizadas a rutas relativas"
else
    echo "   ❌ No se pudo actualizar el frontend"
fi

echo ""
echo "${BLUE}📝 Paso 4: Creando/actualizando .gitignore...${NC}"

cat > .gitignore << 'EOF'
# Dependencies
node_modules/
package-lock.json
yarn.lock

# Environment
.env
.env.local
.env.production

# Logs
*.log
npm-debug.log*
yarn-debug.log*

# OS
.DS_Store
Thumbs.db

# Vercel
.vercel

# Backups
*.backup
EOF

echo "   ✅ .gitignore actualizado"
echo ""

echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}✅ ¡Configuración completada!${NC}"
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "${YELLOW}📋 Estructura del proyecto:${NC}"
echo "   📁 api/"
echo "      └── index.js (backend)"
echo "   📁 public/"
echo "      ├── index.html"
echo "      └── app.jsx (frontend)"
echo "   📄 vercel.json"
echo "   📄 package.json"
echo "   📄 .gitignore"
echo ""
echo "${YELLOW}🚀 Próximos pasos:${NC}"
echo ""
echo "1️⃣  Inicializar Git (si no lo has hecho):"
echo "   ${BLUE}git init${NC}"
echo "   ${BLUE}git add .${NC}"
echo "   ${BLUE}git commit -m \"Initial commit - Crypto Detector\"${NC}"
echo ""
echo "2️⃣  Crear repositorio en GitHub:"
echo "   • Ve a https://github.com/new"
echo "   • Crea un repo llamado 'crypto-detector'"
echo "   • NO añadas README ni .gitignore"
echo ""
echo "3️⃣  Subir a GitHub:"
echo "   ${BLUE}git remote add origin https://github.com/TU-USUARIO/crypto-detector.git${NC}"
echo "   ${BLUE}git branch -M main${NC}"
echo "   ${BLUE}git push -u origin main${NC}"
echo ""
echo "4️⃣  Desplegar en Vercel:"
echo "   • Ve a https://vercel.com/dashboard"
echo "   • Click en 'Add New...' → 'Project'"
echo "   • Importa tu repo de GitHub"
echo "   • Click en 'Deploy'"
echo ""
echo "5️⃣  Configurar variables de entorno en Vercel (opcional):"
echo "   • En tu proyecto → Settings → Environment Variables"
echo "   • Añade: SERPAPI_KEY y CRYPTOCOMPARE_KEY"
echo ""
echo "${GREEN}🎉 ¡Tu app estará online en ~2 minutos!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
