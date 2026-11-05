# Atendimento e vendas (DeskcommCRM)

O atendimento por WhatsApp com IA roda no **DeskcommCRM** (instalado do repositório original, em outro servidor). A **ponte** que liga os dois está **embutida no painel** (`/ponte`, `server/src/atendimento/rotaPonte.ts`): fala com o Supabase do Deskcomm sem alterar o código dele, então as atualizações do Deskcomm continuam entrando pelo mecanismo dele ("Atualizar agora"/`update.sh`). Passo a passo: `docs/ATENDIMENTO-INSTALACAO.md`.

```
Painel de assinaturas ──(assinado)──► Ponte embutida no painel (/ponte) ──► Supabase do Deskcomm
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
1. **Deskcomm** (servidor próprio, mín. 2 CPUs e 4 GB): instalado do repositório original, publicado por Cloudflare Tunnel em `atendimento.saleseassociados.com.br` (ver `docs/ATENDIMENTO-INSTALACAO.md`).
2. **No painel** (`painel.env`): `ATENDIMENTO_SUPABASE_URL` e `ATENDIMENTO_SUPABASE_CHAVE` (URL e chave de serviço do Supabase do Deskcomm), `ATENDIMENTO_ATOR_ID` (UUID do administrador da plataforma), `ATENDIMENTO_SEGREDO` (≥ 32 caracteres, aleatório) e `ATENDIMENTO_URL` (endereço do Deskcomm). Com `ATENDIMENTO_SUPABASE_URL` definido, os endereços da ponte são os do próprio painel (`http://127.0.0.1:PORTA/ponte` por dentro e `PAINEL_PUBLIC_URL/ponte` para o navegador); só defina `ATENDIMENTO_PONTE_URL`/`ATENDIMENTO_PONTE_URL_PUBLICA` para usar outros. Reinicie o painel (`pm2 restart dz-painel`).

**Instalação própria** (sem licença, como o disparazap.*): defina no `.env` do sistema `ATENDIMENTO_PONTE_URL`, `ATENDIMENTO_SEGREDO`, `ATENDIMENTO_SLUG` e `ATENDIMENTO_URL`; e crie a empresa pela ponte (`POST /ponte/v1/offices`) ou no próprio Deskcomm.

## Segurança
- Chamadas painel→ponte assinadas (HMAC, janela de 5 min). Entrada direta com token de 60 s e uso único, assinado com a chave do próprio escritório: o sistema de um escritório não consegue entrar em outro.
- O painel não guarda senha do Deskcomm. O administrador é criado sem e-mail de convite e entra pelo botão do sistema.

## O que ainda não foi feito
- **Validação em servidor real**: os testes usam um Supabase falso. O piloto precisa confirmar criação da empresa, entrada direta e suspensão (ver `docs/ATENDIMENTO-INSTALACAO.md`).
- **Equipe**: hoje só o administrador (e-mail do escritório) é criado no Deskcomm. Adicionar a equipe pelo painel/sistema é a próxima etapa.
- **Sincronizar clientes/processos** e **enviar os avisos do sistema pelo WhatsApp do Deskcomm** (um só dono do número) são etapas seguintes, depois do piloto.
