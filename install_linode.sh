#!/bin/bash

# Script de Instalação Automatizada para Linode - Ubuntu 24.04
# IP do Servidor: 172.233.0.130

echo "🚀 Iniciando instalação do Disparador de Perícias..."

# 1. Atualizar sistema e instalar dependências do Linux
echo "📦 Atualizando sistema e instalando dependências..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential

# Dependências para o WhatsApp (Puppeteer/Chromium)
sudo apt install -y libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libxrandr2 libxrender1 libxtst6 libcups2 libdrm2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0

# 2. Instalar Node.js 20
echo "🟢 Instalar Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 3. Instalar PM2 globalmente
echo "🔄 Instalar PM2..."
sudo npm install -g pm2

# 4. Configurar Backend
echo "⚙️ Configurando Backend..."
cd server
npm install
npm run build

# 5. Configurar Frontend
echo "💻 Configurando Frontend..."
cd ../client
# Criar arquivo .env com o IP do servidor
echo "VITE_API_URL=http://172.233.0.130:3333" > .env
npm install
npm run build

# 6. Iniciar processos com PM2
echo "🏁 Iniciando o sistema..."
cd ../server
pm2 delete disparador-api 2>/dev/null || true
pm2 start dist/index.js --name "disparador-api"

cd ../client
pm2 delete disparador-web 2>/dev/null || true
# Usar o comando preview para servir o frontend na porta 80
pm2 start "npm run preview -- --host 0.0.0.0 --port 80" --name "disparador-web"

# Configurar PM2 para iniciar no boot
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp $HOME

echo "✅ Instalação concluída com sucesso!"
echo "🌍 Acesse o sistema em: http://172.233.0.130"
