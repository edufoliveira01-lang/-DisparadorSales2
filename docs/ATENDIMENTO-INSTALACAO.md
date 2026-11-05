# Instalação do atendimento (piloto) — passo a passo

Cada fase termina com uma **conferência**. Só passe para a próxima quando a conferência der certo.

## Fase 1 — Preparar (no seu computador e no Cloudflare)
1. **Servidor**: uma VPS Ubuntu 22.04/24.04 dedicada ao Deskcomm, com **2 CPUs, 4 GB de RAM e 80 GB de disco** (HostGator VPS Turing, Hetzner CX22, DigitalOcean 4 GB…). Anote o **IP** e como entrar por SSH.
2. **DNS no Cloudflare** — crie dois registros **A** apontando para o IP da VPS, com a nuvem **cinza (somente DNS)**:
   - `atendimento` → IP da VPS (o Deskcomm);
   - `ponte-atendimento` → IP da VPS (a ponte).
   Registros A explícitos valem mais que o curinga `*` do túnel, então os escritórios não são afetados.
3. **Supabase** (o banco do Deskcomm): conta em https://supabase.com e, em *Account → Access Tokens*, um token (`sbp_…`). Guarde-o; **nunca cole chaves ou tokens em conversa**.
4. **Um número de WhatsApp de teste** (chip separado), com o celular à mão para ler o QR Code.

Conferência: `ping atendimento.seudominio` responde com o IP da VPS.

## Fase 2 — Instalar o Deskcomm (na VPS)
```bash
ssh root@IP_DA_VPS
git clone --depth 1 https://github.com/melgarafael/DeskcommCRM.git deskcommcrm
cd deskcommcrm
export SUPABASE_ACCESS_TOKEN=sbp_xxx   # o token da fase 1
bash hostgator-setup-kit/install.sh
```
O instalador pergunta domínio (`atendimento.seudominio`), e-mail e senha do administrador, e a IA (a chave pode ficar para depois). Ao terminar, abra `https://atendimento.seudominio`, entre e **conecte o WhatsApp de teste pelo QR Code**.

Conferência: o login funciona e o WhatsApp de teste aparece como conectado.

## Fase 3 — Instalar a ponte (na mesma VPS)
1. Chave de leitura do repositório privado: `ssh-keygen -t ed25519 -f ~/.ssh/lexsync -N ""`, depois `cat ~/.ssh/lexsync.pub` e cadastre em GitHub → LexSync → *Settings → Deploy keys → Add* (só leitura). Depois: `GIT_SSH_COMMAND="ssh -i ~/.ssh/lexsync" git clone git@github.com:edufoliveira01-lang/LexSync.git ~/lexsync`.
2. `cd ~/lexsync && cp sales-bridge/.env.example sales-bridge/.env` e preencha: `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (copie do `.env` do Deskcomm em `~/deskcommcrm/.env`), `SALES_BRIDGE_SECRET` (`openssl rand -hex 32`; **guarde este valor**), `SALES_ACTOR_ID` (Supabase → Authentication → Users → o UID do administrador) e `DESKCOMM_PUBLIC_URL`.
3. Suba a ponte: `CADDY_SITES_NETWORK=$(docker network ls --format '{{.Name}}' | grep caddy-sites) docker compose -f docker-compose.sales.yml up -d --build`.
4. Publique com HTTPS: `cp ~/lexsync/sales-bridge/ponte.caddy.exemplo ~/deskcommcrm/caddy-sites/ponte.caddy`, troque o endereço pelo seu, e recarregue o Caddy: `cd ~/deskcommcrm && docker compose -f docker-compose.prod.yml exec caddy caddy validate --config /etc/caddy/Caddyfile && docker compose -f docker-compose.prod.yml exec caddy caddy reload --config /etc/caddy/Caddyfile`.

Conferência: `curl https://ponte-atendimento.seudominio/health` responde `{"ok":true}`.

## Fase 4 — Ligar o painel (no servidor do sistema atual)
No `painel.env` (como `dropsales`): `ATENDIMENTO_PONTE_URL=https://ponte-atendimento.seudominio`, `ATENDIMENTO_SEGREDO=<o mesmo SALES_BRIDGE_SECRET>`, `ATENDIMENTO_URL=https://atendimento.seudominio`. Depois `pm2 restart dz-painel`.

Conferência: no detalhe de um escritório aparece a seção **Atendimento**.

## Fase 5 — Teste com um escritório de teste
1. Em *Planos*, ligue **Atendimento e vendas** no plano do escritório de teste (ou só nele).
2. Detalhe do escritório → **Sincronizar agora**. Estado esperado: **Ativo**.
3. No Deskcomm, a empresa aparece e o e-mail do escritório é administrador.
4. **Reiniciar sistemas** (a licença nova chega) → no sistema do escritório: **Comunicação → Atendimento e vendas → Abrir** (entra logado).
5. Suspenda o escritório no painel → em instantes a empresa fica suspensa no Deskcomm; reative e confirme.

## Se algo falhar
- Ponte: `docker logs lexsync-sales-bridge-1 --tail 50`.
- Painel: o erro aparece na seção Atendimento do escritório e no histórico dele.
- Voltar atrás: tirar o módulo do plano suspende o atendimento; nada do sistema atual é alterado.
