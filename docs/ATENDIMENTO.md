# Atendimento e vendas (DeskcommCRM via LexSync)

O atendimento por WhatsApp com IA roda no **LexSync** (https://github.com/edufoliveira01-lang/LexSync), que é o DeskcommCRM original mais uma ponte nossa. O DisparaZap/painel liga os dois **sem alterar o código do Deskcomm**, então as atualizações dele continuam entrando (`scripts/sales/sincronizar-upstream.sh` no LexSync).

```
Painel de assinaturas ──(assinado)──► Ponte (LexSync/sales-bridge) ──► Supabase do Deskcomm
Sistema do escritório ──(token 60 s)──► Ponte /sso ──► navegador entra logado no Deskcomm
```

## O que o painel faz sozinho
- Plano ou escritório com **"Atendimento e vendas"** ligado (limite `modulo_atendimento`, desligado por padrão) → o painel **cria a empresa** no Deskcomm, com o e-mail do escritório como administrador.
- Escritório suspenso, vencido sem carência, cancelado ou sem o módulo → o painel **suspende** a empresa. Voltou a pagar → **reativa**.
- Um ciclo a cada 15 minutos acompanha vencimentos (que mudam com o tempo, sem evento) e repete o que tiver falhado. O botão **Sincronizar agora** (detalhe do escritório) força na hora.
- A licença do escritório passa a levar o endereço do atendimento e uma **chave de entrada só dele** (derivada do segredo geral, que nunca sai do painel).

## O que a pessoa vê
Menu **Comunicação → Atendimento e vendas** (só aparece com o módulo liberado e a permissão `atendimento.use`). O botão abre o Deskcomm em outra aba, já logado, com o **mesmo e-mail** da conta dela. Quem ainda não existe na equipe do Deskcomm não entra (mensagem clara).

## Instalação
1. **Servidor do Deskcomm** (mín. 2 CPUs e 4 GB de RAM): instale o LexSync com os instaladores dele (ver `README.md` do LexSync) e suba a ponte: `docker compose -f docker-compose.yml -f docker-compose.sales.yml up -d sales-bridge`. Variáveis da ponte no `.env` do Deskcomm: `SALES_BRIDGE_SECRET` (≥ 32 caracteres, gere uma aleatória), `SALES_ACTOR_ID` (UUID de um administrador da plataforma com escopo `full`) e `DESKCOMM_PUBLIC_URL`.
2. Publique a ponte num endereço (ex.: `ponte.atendimento.saleseassociados.com.br` → porta 3900) e o Deskcomm no seu (ex.: `atendimento.saleseassociados.com.br`).
3. **No painel** (`painel.env`): `ATENDIMENTO_PONTE_URL` (endereço da ponte), `ATENDIMENTO_SEGREDO` (o mesmo `SALES_BRIDGE_SECRET`), `ATENDIMENTO_URL` (endereço do Deskcomm) e, se o painel falar com a ponte por um endereço interno, `ATENDIMENTO_PONTE_URL_PUBLICA` (o que o navegador usa). Reinicie o painel.
4. Ligue o módulo no plano (Planos → limites → "Atendimento e vendas") e use **Sincronizar agora**. A instância do escritório pega a novidade na próxima verificação da licença (até 6 h; **Reiniciar sistemas** adianta).

**Instalação própria** (sem licença, como o disparazap.*): defina no `.env` do sistema `ATENDIMENTO_PONTE_URL`, `ATENDIMENTO_SEGREDO`, `ATENDIMENTO_SLUG` e `ATENDIMENTO_URL`; e crie a empresa na ponte (`POST /v1/offices`) ou no próprio Deskcomm.

## Segurança
- Chamadas painel→ponte assinadas (HMAC, janela de 5 min). Entrada direta com token de 60 s e uso único, assinado com a chave do próprio escritório: o sistema de um escritório não consegue entrar em outro.
- O painel não guarda senha do Deskcomm. O administrador é criado sem e-mail de convite e entra pelo botão do sistema.

## O que ainda não foi feito
- **Validação em servidor real**: os testes usam um Supabase falso. O piloto precisa confirmar criação da empresa, entrada direta e suspensão (ver `sales-bridge/README.md` no LexSync).
- **Equipe**: hoje só o administrador (e-mail do escritório) é criado no Deskcomm. Adicionar a equipe pelo painel/sistema é a próxima etapa.
- **Sincronizar clientes/processos** e **enviar os avisos do sistema pelo WhatsApp do Deskcomm** (um só dono do número) são etapas seguintes, depois do piloto.
