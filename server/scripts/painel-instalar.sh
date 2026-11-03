#!/usr/bin/env bash
# Instala (ou atualiza) o painel de assinaturas do DisparaZap neste servidor.
#
#   bash server/scripts/painel-instalar.sh [dominio-do-painel] [dominio-base]
#   ex.: bash server/scripts/painel-instalar.sh painel.saleseassociados.com.br saleseassociados.com.br
#
# Rode com o MESMO usuário que roda o PM2 do sistema (ex.: dropsales), não como root.
# Idempotente: se o arquivo de configuração já existe, ele NÃO é sobrescrito nem a senha é trocada.
set -Eeuo pipefail

DOMINIO_PAINEL="${1:-painel.saleseassociados.com.br}"
DOMINIO_BASE="${2:-saleseassociados.com.br}"
APP_DIR="${APP_DIR:-/home/dropsales/disparador-sales2/server}"
PAINEL_DIR="${PAINEL_DIR:-/srv/disparazap-painel}"
INSTANCIAS_DIR="${INSTANCIAS_DIR:-/srv/disparazap}"
PORTA="${PAINEL_PORT:-3340}"
NOME_PM2="${NOME_PM2:-dz-painel}"
SIMULAR="${SIMULAR:-0}"   # SIMULAR=1: só cria arquivos, não inicia o PM2

erro() { echo "ERRO: $*" >&2; exit 1; }
info() { echo "• $*"; }
[ "$(id -u)" -ne 0 ] || [ "${PERMITIR_ROOT:-0}" = "1" ] || erro "Não rode como root. Use o usuário do sistema (ex.: dropsales)."
[[ "$DOMINIO_PAINEL" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || erro "Domínio do painel inválido: $DOMINIO_PAINEL"
[[ "$DOMINIO_BASE" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || erro "Domínio base inválido: $DOMINIO_BASE"
[[ "$PORTA" =~ ^[0-9]+$ ]] && [ "$PORTA" -ge 1024 ] && [ "$PORTA" -le 65535 ] || erro "Porta inválida: $PORTA"
command -v node >/dev/null || erro "Node.js não encontrado."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || erro "Node.js 20 ou superior é necessário (o projeto usa o 22)."
command -v openssl >/dev/null || erro "openssl não encontrado."
if [ "$SIMULAR" != "1" ]; then
  command -v pm2 >/dev/null || erro "PM2 não encontrado."
  [ -f "$APP_DIR/dist/painel/index.js" ] || erro "Não achei $APP_DIR/dist/painel/index.js. Aguarde o deploy da versão 2.61.0 ou rode: npm run build --prefix $(dirname "$APP_DIR")/server"
fi

info "Criando pastas em $PAINEL_DIR"
if ! mkdir -p "$PAINEL_DIR/data" 2>/dev/null; then
  sudo install -d -m 700 -o "$(id -un)" -g "$(id -gn)" "$PAINEL_DIR" "$PAINEL_DIR/data"
fi
chmod 700 "$PAINEL_DIR" "$PAINEL_DIR/data"

ENV_FILE="$PAINEL_DIR/painel.env"
SENHA_NOVA=""
if [ -f "$ENV_FILE" ]; then
  info "Configuração existente mantida: $ENV_FILE"
else
  SENHA_NOVA="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
  TOKEN_WEBHOOK="$(openssl rand -hex 32)"
  umask 077
  cat > "$ENV_FILE" <<CONF
# Painel de assinaturas do DisparaZap — gerado em $(date -Iseconds)
PAINEL_PORT=$PORTA
PAINEL_DATA_DIR=$PAINEL_DIR/data
PAINEL_PUBLIC_URL=https://$DOMINIO_PAINEL
PAINEL_BASE_DOMAIN=$DOMINIO_BASE
PAINEL_APP_DIR=$APP_DIR
PAINEL_INSTANCIAS_DIR=$INSTANCIAS_DIR
PAINEL_ADMIN_USER=admin
# Usada só na primeira execução. Depois de entrar no painel, apague esta linha.
PAINEL_ADMIN_PASSWORD=$SENHA_NOVA
# Cobrança (Asaas). Comece pelo sandbox; para produção use https://api.asaas.com/v3
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=$TOKEN_WEBHOOK
CONF
  chmod 600 "$ENV_FILE"
  info "Configuração criada: $ENV_FILE"
fi

if [ "$SIMULAR" = "1" ]; then
  info "SIMULAR=1: PM2 não iniciado."
else
  if pm2 describe "$NOME_PM2" >/dev/null 2>&1; then
    info "Reiniciando $NOME_PM2"
    pm2 restart "$NOME_PM2" >/dev/null
  else
    info "Iniciando $NOME_PM2 na porta $PORTA"
    (cd "$APP_DIR" && pm2 start dist/painel/index.js --name "$NOME_PM2" --node-args="--env-file=$ENV_FILE" >/dev/null)
  fi
  pm2 save >/dev/null
  info "Aguardando o painel responder…"
  OK=0
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$PORTA/healthz" >/dev/null 2>&1; then OK=1; break; fi
    sleep 1
  done
  [ "$OK" = "1" ] || { pm2 logs "$NOME_PM2" --lines 30 --nostream || true; erro "O painel não respondeu em http://127.0.0.1:$PORTA/healthz. Veja o log acima."; }
  info "Painel no ar localmente: http://127.0.0.1:$PORTA"
fi

echo
echo "============================================================"
echo " Painel instalado."
echo " Endereço (depois do DNS + Nginx): https://$DOMINIO_PAINEL"
echo " Usuário: admin"
if [ -n "$SENHA_NOVA" ]; then
  echo " Senha:   $SENHA_NOVA     <-- anote agora; não será exibida de novo"
else
  echo " Senha:   a já definida (a linha PAINEL_ADMIN_PASSWORD de $ENV_FILE só vale na 1ª execução)"
fi
echo " Token do webhook (cadastre no Asaas):"
grep '^ASAAS_WEBHOOK_TOKEN=' "$ENV_FILE" | cut -d= -f2-
echo " Chave privada de licença (FAÇA BACKUP): $PAINEL_DIR/data/licenca-privada.pem"
echo "============================================================"
