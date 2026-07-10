#!/bin/bash

# Caminho do arquivo de configuração do Nginx
NGINX_CONF="/etc/nginx/sites-available/disparador"

if [ ! -f "$NGINX_CONF" ]; then
    echo "❌ Arquivo de configuração do Nginx não encontrado em $NGINX_CONF"
    exit 1
fi

echo "Removing password protection from Nginx..."

# Remove as linhas de auth_basic usando sed
sudo sed -i '/auth_basic/d' "$NGINX_CONF"

# Testa a configuração do Nginx
if sudo nginx -t; then
    sudo systemctl restart nginx
    echo "✅ Proteção por senha removida com sucesso!"
    echo "O site agora está acessível publicamente."
else
    echo "❌ Erro na configuração do Nginx. Verifique manualmente."
    exit 1
fi
