#!/usr/bin/env bash
# Instalação ÚNICA do provisionamento automático de escritórios.
# Depois disto, criar um escritório é só preencher o formulário no painel.
#
#   bash server/scripts/provisionamento-instalar.sh [porta-do-nginx] [dominio-base]
#   ex.: bash server/scripts/provisionamento-instalar.sh 8081 saleseassociados.com.br
#
# O que faz (idempotente, pode rodar de novo):
#   1. cria a pasta/arquivo "mapa" (host → porta) e adota as instâncias que já existem em /srv/disparazap;
#   2. cria UM bloco curinga do Nginx (*.dominio) que lê o mapa — sem arquivo por escritório;
#   3. libera, via sudo, SOMENTE "nginx -t" e "systemctl reload nginx" para o usuário do painel;
#   4. liga PAINEL_AUTO_PROVISIONAR no painel.env e reinicia o painel.
set -Eeuo pipefail

PORTA_NGINX="${1:-8081}"
DOMINIO_BASE="${2:-saleseassociados.com.br}"
PAINEL_DIR="${PAINEL_DIR:-/srv/disparazap-painel}"
INSTANCIAS_DIR="${INSTANCIAS_DIR:-/srv/disparazap}"
WEB_ROOT="${WEB_ROOT:-/var/www/disparazap}"
NOME_PM2="${NOME_PM2:-dz-painel}"
USUARIO="$(id -un)"
MAPA="$PAINEL_DIR/nginx/escritorios.map"
CONF="${CONF:-/etc/nginx/conf.d/dz-escritorios.conf}"
SUDOERS="${SUDOERS:-/etc/sudoers.d/dz-painel}"
SIMULAR="${SIMULAR:-0}"

erro() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "• $*"; }
[ "$(id -u)" -ne 0 ] || [ "${PERMITIR_ROOT:-0}" = "1" ] || erro "Não rode como root. Use o usuário do sistema (ex.: dropsales); o script pede sudo quando precisar."
[[ "$PORTA_NGINX" =~ ^[0-9]+$ ]] || erro "Porta do Nginx inválida."
[[ "$DOMINIO_BASE" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || erro "Domínio base inválido."
[ -f "$PAINEL_DIR/painel.env" ] || erro "Não achei $PAINEL_DIR/painel.env (instale o painel primeiro: painel-instalar.sh)."
SUDO="sudo"; [ "$(id -u)" -eq 0 ] && SUDO=""
NGINX_BIN="$(command -v nginx || echo /usr/sbin/nginx)"
SYSTEMCTL_BIN="$(command -v systemctl || echo /usr/bin/systemctl)"

# 0) a pasta das instâncias precisa ser do usuário do painel (ele cria escritórios sem terminal/sudo)
if [ "$SIMULAR" != "1" ] && [ "$(stat -c %U "$INSTANCIAS_DIR" 2>/dev/null || echo ausente)" != "$USUARIO" ]; then
  info "Ajustando o dono de $INSTANCIAS_DIR para $USUARIO (pede a senha do sudo)"
  $SUDO install -d -m 755 -o "$USUARIO" -g "$(id -gn)" "$INSTANCIAS_DIR"
  $SUDO chown -R "$USUARIO:$(id -gn)" "$INSTANCIAS_DIR"
fi

# 1) mapa + adoção das instâncias existentes
mkdir -p "$PAINEL_DIR/nginx"
{
  echo "# Gerado pelo painel. Não edite à mão: host → porta da instância do escritório."
  if [ -d "$INSTANCIAS_DIR" ]; then
    for d in "$INSTANCIAS_DIR"/*/; do
      [ -f "${d}.env" ] || continue
      slug="$(basename "$d")"; porta="$(grep -m1 '^PORT=' "${d}.env" | cut -d= -f2 | tr -d '\r ')"
      [[ "$slug" =~ ^[a-z0-9][a-z0-9-]{2,40}[a-z0-9]$ ]] && [[ "$porta" =~ ^[0-9]+$ ]] || continue
      echo "$slug.$DOMINIO_BASE $porta;"
    done
  fi
} > "$MAPA.novo"
if [ -f "$MAPA" ]; then
  # mantém entradas já registradas pelo painel e acrescenta as que faltam
  { cat "$MAPA"; grep -v '^#' "$MAPA.novo"; } | awk '/^#/ && !c++ {print; next} /^[a-z0-9]/ && !v[$1]++' > "$MAPA.merge" && mv "$MAPA.merge" "$MAPA"
  rm -f "$MAPA.novo"
else
  mv "$MAPA.novo" "$MAPA"
fi
chmod 644 "$MAPA"
info "Mapa de escritórios: $MAPA ($(grep -c ';' "$MAPA" || true) registrado(s))"

# 2) bloco curinga do Nginx
CONTEUDO_CONF="# Gerado por provisionamento-instalar.sh — escritórios (nome.$DOMINIO_BASE) escolhem a porta pelo mapa do painel.
map \$host \$dz_porta {
    default 0;
    include $MAPA;
}
server {
    listen $PORTA_NGINX;
    server_name *.$DOMINIO_BASE;
    client_max_body_size 25m;
    root $WEB_ROOT;
    index index.html;

    # nome sem escritório cadastrado
    if (\$dz_porta = 0) { return 404; }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:\$dz_porta;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$dz_ip;
        proxy_set_header X-Forwarded-Proto https;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:\$dz_porta;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
    }
}
"
BACKUP_CONF=""
if [ "$SIMULAR" = "1" ]; then
  printf '%s' "$CONTEUDO_CONF" > "${CONF}"
else
  if [ -f "$CONF" ]; then BACKUP_CONF="$(mktemp)"; $SUDO cat "$CONF" > "$BACKUP_CONF"; fi
  printf '%s' "$CONTEUDO_CONF" | $SUDO tee "$CONF" >/dev/null
fi
info "Bloco curinga do Nginx: $CONF"

# 3) permissão mínima de sudo
LINHA_SUDO="$USUARIO ALL=(root) NOPASSWD: $NGINX_BIN -t, $SYSTEMCTL_BIN reload nginx"
if [ "$SIMULAR" = "1" ]; then
  printf '%s\n' "$LINHA_SUDO" > "$SUDOERS"
else
  TMP="$(mktemp)"; printf '%s\n' "$LINHA_SUDO" > "$TMP"
  $SUDO visudo -cf "$TMP" >/dev/null || { rm -f "$TMP"; erro "Regra de sudo inválida."; }
  $SUDO install -m 440 -o root -g root "$TMP" "$SUDOERS"; rm -f "$TMP"
fi
info "Sudo restrito a 'nginx -t' e 'systemctl reload nginx' para $USUARIO ($SUDOERS)"

# 4) painel.env
definir() { # chave valor
  if grep -q "^$1=" "$PAINEL_DIR/painel.env"; then sed -i "s|^$1=.*|$1=$2|" "$PAINEL_DIR/painel.env"; else printf '%s=%s\n' "$1" "$2" >> "$PAINEL_DIR/painel.env"; fi
}
definir PAINEL_AUTO_PROVISIONAR 1
definir PAINEL_NGINX_MAPA "$MAPA"
definir PAINEL_NGINX_BIN "$NGINX_BIN"
definir PAINEL_SYSTEMCTL_BIN "$SYSTEMCTL_BIN"
info "painel.env atualizado"

if [ "$SIMULAR" != "1" ]; then
  if ! $SUDO "$NGINX_BIN" -t; then
    if [ -n "$BACKUP_CONF" ]; then $SUDO tee "$CONF" < "$BACKUP_CONF" >/dev/null; else $SUDO rm -f "$CONF"; fi
    erro "O Nginx recusou a configuração gerada; ela foi desfeita e nada foi recarregado. Envie a mensagem acima."
  fi
  $SUDO "$SYSTEMCTL_BIN" reload nginx
  info "Nginx recarregado"
  pm2 restart "$NOME_PM2" >/dev/null && info "Painel reiniciado"
fi

echo
echo "============================================================"
echo " Provisionamento automático ligado."
echo " Agora, no painel: Novo escritório → Criar. O sistema, o endereço e a senha inicial"
echo " aparecem na tela, sem nenhum comando."
if ls /etc/nginx/sites-enabled/dz-escritorio-* >/dev/null 2>&1; then
  echo
  echo " Opcional: arquivos antigos por escritório já não são necessários:"
  ls /etc/nginx/sites-enabled/dz-escritorio-* 2>/dev/null | sed 's/^/   sudo rm /'
  echo "   (depois: sudo nginx -t && sudo systemctl reload nginx)"
fi
echo "============================================================"
