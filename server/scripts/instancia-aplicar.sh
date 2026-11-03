#!/usr/bin/env bash
# Cria no servidor o workspace de um escritório a partir do bloco ".env" gerado pelo painel.
#
#   bash server/scripts/instancia-aplicar.sh <slug> <porta> <arquivo-com-o-env>
#   ex.: bash server/scripts/instancia-aplicar.sh sales 3411 /tmp/sales.env
#
# Não sobrescreve uma instância existente (para trocar só a licença, edite as linhas LICENSE_* do .env dela).
set -Eeuo pipefail

SLUG="${1:-}"; PORTA="${2:-}"; ARQ="${3:-}"
APP_DIR="${APP_DIR:-/home/dropsales/disparador-sales2/server}"
INSTANCIAS_DIR="${INSTANCIAS_DIR:-/srv/disparazap}"
DOMINIO_BASE="${DOMINIO_BASE:-saleseassociados.com.br}"
SIMULAR="${SIMULAR:-0}"

erro() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "• $*"; }
[ "$(id -u)" -ne 0 ] || [ "${PERMITIR_ROOT:-0}" = "1" ] || erro "Não rode como root. Use o usuário do sistema (ex.: dropsales)."
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{2,40}[a-z0-9]$ ]] || erro "Uso: instancia-aplicar.sh <slug> <porta> <arquivo-env>  (slug inválido)"
[[ "$PORTA" =~ ^[0-9]+$ ]] && [ "$PORTA" -ge 1024 ] && [ "$PORTA" -le 65535 ] || erro "Porta inválida."
[ -f "$ARQ" ] || erro "Arquivo do .env não encontrado: $ARQ"
grep -q "^OFFICE_ID=$SLUG\$" "$ARQ" || erro "O arquivo não tem OFFICE_ID=$SLUG (use o bloco gerado para este escritório)."
grep -q '^LICENSE_KEY=dz_' "$ARQ" || erro "O arquivo não tem a LICENSE_KEY gerada pelo painel."
grep -q '^ENCRYPTION_KEY=[0-9a-f]\{64\}$' "$ARQ" || erro "ENCRYPTION_KEY ausente ou fora do formato esperado."
grep -q "^PORT=$PORTA\$" "$ARQ" || erro "A PORT do arquivo difere de $PORTA."
if [ "$SIMULAR" != "1" ]; then
  command -v pm2 >/dev/null || erro "PM2 não encontrado."
  [ -f "$APP_DIR/dist/index.js" ] || erro "Não achei $APP_DIR/dist/index.js (faça o build/deploy do sistema)."
  if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ":$PORTA "; then erro "A porta $PORTA já está em uso."; fi
fi

DIR="$INSTANCIAS_DIR/$SLUG"
[ ! -e "$DIR/.env" ] || erro "Já existe $DIR/.env. Instância existente não é sobrescrita."
info "Criando $DIR"
if ! mkdir -p "$DIR/data" 2>/dev/null; then sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "$DIR" "$DIR/data"; fi
chmod 700 "$DIR" "$DIR/data"
umask 077
cp "$ARQ" "$DIR/.env"; chmod 600 "$DIR/.env"
info "Configuração gravada em $DIR/.env (apague o arquivo temporário $ARQ depois)"

if [ "$SIMULAR" != "1" ]; then
  info "Iniciando dz-$SLUG na porta $PORTA"
  (cd "$APP_DIR" && pm2 start dist/index.js --name "dz-$SLUG" --node-args="--env-file=$DIR/.env" >/dev/null)
  pm2 save >/dev/null
  sleep 5
  pm2 describe "dz-$SLUG" | grep -E "status|restarts" || true
fi

cat > "$DIR/nginx.exemplo.conf" <<CONF
# Exemplo para https://$SLUG.$DOMINIO_BASE  (ajuste os caminhos do certificado, se usar certificado de origem)
server {
  listen 80;
  server_name $SLUG.$DOMINIO_BASE;
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:$PORTA;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$http_cf_connecting_ip;
    proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
CONF
echo
echo "Workspace criado: https://$SLUG.$DOMINIO_BASE  (porta $PORTA)"
echo "Próximo passo: configurar o Nginx e o DNS (exemplo em $DIR/nginx.exemplo.conf)."
echo "Senha inicial do administrador do escritório: a linha INITIAL_ADMIN_PASSWORD do .env (peça para trocar no 1º acesso)."
