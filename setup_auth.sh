#!/bin/bash

# Script para adicionar Usuário e Senha no Disparador Sales via Nginx

echo "🔒 Configurando proteção por senha..."

# 1. Instalar ferramentas de utilitários do apache (para gerar a senha)
sudo apt update
sudo apt install -y apache2-utils

# 2. Criar o arquivo de senha
# Aqui você deve escolher seu usuário e senha
# Vou colocar como padrão: usuario=admin senha=admin123
# Mas você pode mudar rodando o comando manualmente depois
sudo htpasswd -bc /etc/nginx/.htpasswd admin admin123

# 3. Atualizar a configuração do Nginx para exigir a senha
cat <<EOF | sudo tee /etc/nginx/sites-available/disparador
server {
    listen 80;
    server_name 172.233.0.130;

    # Proteção por Senha
    auth_basic "Acesso Restrito - Disparador Sales";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        root /var/www/disparador/client/dist;
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

# 4. Reiniciar Nginx
sudo systemctl restart nginx

echo "✅ Proteção ativada com sucesso!"
echo "👤 Usuário: admin"
echo "🔑 Senha padrão: admin123"
echo "👉 Para mudar a senha depois, use: sudo htpasswd /etc/nginx/.htpasswd admin"
