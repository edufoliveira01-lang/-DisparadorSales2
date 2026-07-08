#!/bin/bash

# Script de Configuração do Nginx para Disparador Sales
# IP: 172.233.0.130

echo "🔧 Configurando Nginx para resolver erros de API..."

# 1. Instalar Nginx
sudo apt update
sudo apt install -y nginx

# 2. Criar configuração do site
cat <<EOF | sudo tee /etc/nginx/sites-available/disparador
server {
    listen 80;
    server_name 172.233.0.130;

    # Frontend
    location / {
        root $(pwd)/client/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:3333/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # Socket.io
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3333/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

# 3. Ativar o site e desativar o padrão
sudo ln -s /etc/nginx/sites-available/disparador /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# 4. Ajustar permissões para o Nginx ler os arquivos
chmod o+x /root
chmod o+x $(pwd)
chmod -R o+r $(pwd)/client/dist

# 5. Reiniciar Nginx
sudo nginx -t && sudo systemctl restart nginx

# 6. Parar o frontend rodando no PM2 (agora o Nginx cuida disso)
pm2 stop disparador-web
pm2 delete disparador-web
pm2 save

echo "✅ Nginx configurado! Tente acessar agora: http://172.233.0.130"
