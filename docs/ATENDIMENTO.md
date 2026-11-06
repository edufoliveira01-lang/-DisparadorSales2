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

## Equipe do escritório no atendimento
A equipe do sistema do escritório é mantida no atendimento **automaticamente** (só em escritórios licenciados e com o atendimento ativo):
- **Criou ou editou uma pessoa** (com e-mail): ela entra na empresa do Deskcomm, com o papel equivalente (administrador→admin, gestor→manager, advogado/atendimento→agent, consulta→viewer). Várias alterações seguidas viram uma só sincronização (espera de 5 s).
- **Desativou a pessoa, ou trocou o e-mail dela**: o acesso (ou o e-mail antigo) é **revogado** no Deskcomm. O vínculo é marcado como revogado, como a tela de equipe do próprio Deskcomm faz, e as conversas atribuídas voltam para a fila. O último administrador da empresa nunca é revogado.
- **A cada 6 horas** (e 2 minutos depois de o sistema iniciar) o sistema confere a equipe inteira e corrige diferenças (falha de conexão, por exemplo).
- O botão **Enviar equipe ao atendimento** (Comunicação → Atendimento e vendas) força a conferência na hora e mostra o resultado, inclusive quem ficou sem e-mail.

Caminho: sistema do escritório → painel (`POST /api/v1/atendimento/equipe`, autenticado pela chave de licença) → ponte (`POST /ponte/v1/offices/:slug/members`, com `members` e/ou `remove`). Pessoas sem e-mail não entram (o e-mail é a chave da entrada direta). Limitação: um e-mail trocado só é revogado se o sistema estiver no ar na hora da troca; um e-mail antigo esquecido pode ser removido à mão no Deskcomm.

## Aviso de versão nova do Deskcomm no painel
Na aba **Escritórios** do painel aparece uma faixa do atendimento: **amarela** quando o repositório original do DeskcommCRM tem versão mais nova que a do nosso fork ("há versão nova do original · em uso 1.101.0 · nova 1.102.0 · ver novidades"), **verde** quando está em dia. Botão **Verificar agora** refaz a consulta. Como funciona: a imagem do Deskcomm publica `https://atendimento.<dominio>/sales-versao.js` (gerado no build, fora da autenticação do app) com a versão do original em que se baseia; o painel lê esse arquivo e compara com a maior tag `vX.Y.Z` de `melgarafael/DeskcommCRM` (API pública do GitHub, com cache de 6 h). Se a imagem em uso for anterior à que publica o arquivo, a faixa pede para atualizar a imagem. Endpoint: `GET /api/admin/atendimento/versao` (sessão de administrador; `?forcar=1` ignora o cache).


## Contratos pelo atendimento (ZapSign)

Fluxo (UM envelope, um link e uma assinatura valem para os 3 documentos — procuração; hipossuficiência; contrato + declarações —, cada um com a sua validade no ZapSign, pelo recurso "documento extra"): o atendente clica em **Gerar contrato** no Deskcomm → o Deskcomm pede ao painel (`/contratos`, assinado com `CONTRATOS_SEGREDO`) →
o painel repassa à instância do escritório (`/api/integracao/contratos`, assinado com a chave do escritório) → o sistema cadastra/atualiza o cliente
(pelo CPF), monta **todos os documentos do kit**, converte em PDF (LibreOffice) e envia ao ZapSign → o link de assinatura volta ao Deskcomm, que o
manda ao cliente pelo WhatsApp. O ZapSign envia a cópia por e-mail quando o cliente tem e-mail.

Configuração:
- No painel (Ubuntu): `CONTRATOS_SEGREDO` (32+ caracteres) no `.env` do painel; reiniciar o painel.
- No Deskcomm (VPS): `SALES_PAINEL_URL` (endereço público do painel) e o mesmo `CONTRATOS_SEGREDO`.
- No sistema do escritório: Atendimento → "Contratos com assinatura (ZapSign)": token da API e ambiente (produção ou testes).
