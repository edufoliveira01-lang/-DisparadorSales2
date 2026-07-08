#!/bin/bash

# Script de Instalação Mestre - Disparador Sales
# IP: 172.233.0.130

echo "🚀 Iniciando Instalação Mestre do Disparador de Perícias..."

# 1. Configurações Iniciais
PROJECT_DIR="/var/www/disparador"
SERVER_IP="172.233.0.130"

# 2. Atualizar Sistema e Instalar Dependências
echo "📦 Atualizando sistema..."
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx

# Dependências para o WhatsApp (Puppeteer/Chromium)
echo "🌐 Instalando dependências do WhatsApp..."
sudo apt install -y libnss3 libatk-bridge2.0-0 libx11-xcb1 libxcb-dri3-0 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libxrandr2 libxrender1 libxtst6 libcups2 libdrm2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0

# 3. Instalar Node.js 20 e PM2
echo "🟢 Instalando Node.js e PM2..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# 4. Preparar Pasta do Projeto
echo "📁 Preparando diretório do projeto..."
sudo mkdir -p $PROJECT_DIR
sudo chown -R $USER:$USER $PROJECT_DIR

# 5. Clonar o Projeto (Usando o diretório de destino limpo)
# Nota: O usuário precisará clonar manualmente se o repo for privado, 
# mas o script assume que ele já está dentro da pasta ou o repo é acessível.
cd $PROJECT_DIR
# Se a pasta estiver vazia, clonamos
if [ ! -d ".git" ]; then
    echo "📥 Clonando repositório..."
    git clone https://github.com/edufoliveira01-lang/-DisparadorSales2.git .
fi

# 6. Configurar Backend
echo "⚙️ Configurando Backend..."
cd server
npm install
npm run build

# 7. Configurar Frontend
echo "💻 Configurando Frontend..."
cd ../client
echo "VITE_API_URL=/api" > .env
npm install
npm run build

# 8. Configurar Nginx (A Ponte)
echo "🔧 Configurando Nginx..."
cat <<EOF | sudo tee /etc/nginx/sites-available/disparador
server {
    listen 80;
    server_name $SERVER_IP;

    location / {
        root $PROJECT_DIR/client/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3333/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3333/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/disparador /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 9. Permissões de Execução para o Nginx
sudo chmod -R 755 $PROJECT_DIR

# 10. Iniciar com PM2
echo "🏁 Iniciando processos..."
cd $PROJECT_DIR/server
pm2 delete disparador-api 2>/dev/null || true
pm2 start dist/index.js --name "disparador-api"
pm2 save
pm2 startup

# Reiniciar Nginx
sudo systemctl restart nginx

echo "✅ TUDO PRONTO!"
echo "🌍 Acesse: http://$SERVER_IP"
