# Instalação do atendimento (piloto) — passo a passo

Topologia: o **DeskcommCRM** roda na VPS (publicado por **Cloudflare Tunnel**, banco no Supabase). A **ponte** está embutida no **painel** do Ubuntu (rota `/ponte`); não há mais nada para instalar na VPS. Cada fase termina com uma **conferência**.

## Fase 1 — Deskcomm na VPS (feito no piloto)
1. Instalado do repositório original; versão fixada no `.env` (`APP_IMAGE`, `WORKER_IMAGE`, `SCHEDULER_IMAGE`).
2. **Cloudflare → Zero Trust → Túneis**: túnel novo (ex.: `DeskComm`) com a rota `atendimento.<dominio>` → `http://app:3000`. O token vai em `CLOUDFLARE_TUNNEL_TOKEN` no `.env` do Deskcomm.
3. `.env` do Deskcomm: `REVERSE_PROXY="cloudflared"`, `DOMAIN`, `NEXT_PUBLIC_APP_URL` e `NEXT_PUBLIC_ADMIN_URL` com o endereço `https://atendimento.<dominio>`.
4. Supabase → Authentication → URL Configuration: **Site URL** e **Redirect URLs** (`https://atendimento.<dominio>/**`).
5. Subir: `docker compose -f docker-compose.prod.yml -f docker-compose.cloudflared.yml --env-file .env up -d`.

Conferência: `https://atendimento.<dominio>` abre e o login do administrador funciona.

## Fase 2 — Ligar o painel (no Ubuntu, como `dropsales`)
Descubra o UUID do administrador da plataforma (Supabase → Authentication → Users → **UID**). Gere o segredo (`openssl rand -hex 32`) e acrescente ao `painel.env`:
```
ATENDIMENTO_SUPABASE_URL=https://<projeto>.supabase.co
ATENDIMENTO_SUPABASE_CHAVE=<chave de serviço do .env do Deskcomm: SUPABASE_SERVICE_ROLE_KEY>
ATENDIMENTO_ATOR_ID=<UID do administrador>
ATENDIMENTO_SEGREDO=<segredo gerado, ≥ 32 caracteres>
ATENDIMENTO_URL=https://atendimento.<dominio>
```
Depois `pm2 restart dz-painel`. A chave de serviço dá acesso total ao banco do Deskcomm: guarde só neste arquivo (permissão 600) e nunca cole em conversa.

Conferência: o log do painel mostra `Ponte do atendimento embutida ligada em /ponte`, e `curl https://painel.<dominio>/ponte/health` responde `{"ok":true}`.

## Fase 3 — Teste com um escritório de teste
1. Em *Planos*, ligue **Atendimento e vendas** no plano do escritório de teste (ou só nele).
2. Detalhe do escritório → **Sincronizar agora**. Estado esperado: **Ativo**.
3. No Deskcomm, a empresa aparece e o e-mail do escritório é administrador.
4. **Reiniciar sistemas** (a licença nova chega) → no sistema do escritório: **Comunicação → Atendimento e vendas → Abrir** (entra logado).
5. Suspenda o escritório no painel → em instantes a empresa fica suspensa no Deskcomm; reative e confirme.

## Lições do piloto
- O **e-mail do usuário** que entra no sistema do escritório (Minha conta) precisa ser o mesmo do administrador cadastrado no escritório do painel: é por ele que a entrada direta reconhece a pessoa no Deskcomm. Sem e-mail, a tela do atendimento pede o cadastro e leva a Minha conta.
- O item **Atendimento e vendas** só aparece depois que a licença do escritório é renovada (a cada 6 horas ou ao reiniciar o sistema dele). **Reiniciar sistemas** no painel reinicia também escritórios sem porta registrada, desde que o sistema exista no servidor.
- "Onboarding" na lista de Tenants do Deskcomm é só um rótulo (empresa que ainda não concluiu a configuração inicial); o estado real no banco é `active`.
- Suspender no painel suspende a empresa no Deskcomm (tela "Conta suspensa") e reativar a devolve ao normal — validado no piloto.

## Atualizações do Deskcomm
O Deskcomm se atualiza sozinho pelo mecanismo dele ("Atualizar agora"/`update.sh`, com backup e retorno automático). A ponte depende das funções SQL `fn_create_tenant_with_owner`, `fn_accept_team_invite`, `fn_suspender_organizacao`, `fn_reativar_organizacao` e da rota `/auth/confirm`: depois de atualizar, repita a Fase 3 com o escritório de teste.

## Se algo falhar
- O erro aparece na seção Atendimento do escritório (e no histórico dele). Log do painel: `pm2 logs dz-painel`.
- Túnel: `docker logs deskcommcrm-cloudflared-1`.
- Voltar atrás: apague as variáveis `ATENDIMENTO_*` e reinicie o painel; nada do sistema atual é alterado.
