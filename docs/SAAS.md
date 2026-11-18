# DisparaZap como serviço (SaaS) — versão 2.61.0

Cada escritório assinante tem seu **workspace próprio e isolado**: uma instância do sistema com endereço (`nome.saleseassociados.com.br`), banco, equipe, credenciais, sessão do WhatsApp e chaves de IA exclusivos. Um **painel de controle** (aplicação separada, sua) cadastra os escritórios, define planos e limites, cobra pelo Asaas e emite a **licença** que cada instância valida.

```
Asaas ──webhook──▶ Painel de controle ◀──licença assinada── Instância do escritório A
                        │  planos · escritórios · status      Instância do escritório B …
                        └─ cobrança recorrente (Asaas)
```

A instalação atual (`disparazap.saleseassociados.com.br`) **não muda**: sem as variáveis `LICENSE_*` ela roda em *modo próprio*, sem verificação, limites ou bloqueios.

> **Implantação passo a passo (Ubuntu + Nginx + PM2 + Cloudflare): [SAAS_IMPLANTACAO.md](SAAS_IMPLANTACAO.md).**

## Painel de controle

Inicie com `npm run painel` (desenvolvimento) ou `npm run painel --prefix server` após o build. Mantenha-o em um processo e domínio próprios (ex.: `painel.seudominio.com.br`), atrás de HTTPS.

| Variável | Função |
| --- | --- |
| `PAINEL_DATA_DIR` | Pasta do banco `painel.sqlite3` e do par de chaves de licença (`licenca-privada.pem` — **faça backup**; `licenca-publica.pem`). Criados na primeira execução. |
| `PAINEL_ADMIN_USER` / `PAINEL_ADMIN_PASSWORD` | Administrador criado na primeira execução (senha com 12+ caracteres). Depois remova a senha do ambiente. |
| `PAINEL_PUBLIC_URL` | URL pública (HTTPS). Define o cookie seguro e a URL do webhook exibida. |
| `PAINEL_BASE_DOMAIN` | Domínio dos workspaces (padrão `saleseassociados.com.br`: escritórios em `nome.saleseassociados.com.br`; `disparazap` e outros endereços já em uso são reservados). Requer DNS curinga `*` e, no acesso direto, certificado curinga. |
| `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN` | Cobrança. Por padrão aponta para o **sandbox** do Asaas. |
| `PAINEL_CONTRATACAO_PUBLICA` (`1` abre a página pública `/contratar`; desligada por padrão) | Contratação online: o visitante escolhe um plano à venda e o painel cria o escritório em teste. |
| `PAINEL_CARENCIA_DIAS` (7), `PAINEL_TESTE_DIAS` (7), `PAINEL_VALIDADE_LICENCA_HORAS` (72), `PAINEL_TOLERANCIA_OFFLINE_DIAS` (14) | Regras padrão. |

### Fluxo de um novo assinante

1. **Planos** → defina o preço mensal e, se quiser, limites. Hoje: advogados e usuários ilimitados.
2. **Novo escritório** → nome, endereço (subdomínio), e-mail, CNPJ, plano e dias de teste (ou cortesia). O painel cria o cliente e a assinatura no Asaas (primeira cobrança no último dia do teste; o cliente escolhe boleto, Pix ou cartão na fatura).
3. O painel mostra **uma única vez** a chave de licença e o bloco de implantação (`.env`, comandos PM2 e proxy nginx). O `ENCRYPTION_KEY` dos dados do escritório é gerado nesse momento e **não é guardado no painel**. Guarde-o: sem ele os dados criptografados não podem ser lidos.
4. Aplique no servidor, aponte o DNS e entregue o endereço e a senha inicial ao escritório.
5. No Asaas, cadastre o webhook `PAINEL_PUBLIC_URL/webhooks/asaas` com o token `ASAAS_WEBHOOK_TOKEN` (eventos de cobrança e de assinatura).

### Situação da assinatura (calculada pelas datas)

| Situação | Quando | Efeito na instância |
| --- | --- | --- |
| Teste | até o fim do teste, sem pagamento | normal, com aviso de dias restantes |
| Ativa | pago até a data de vencimento (ou cortesia, sem vencimento) | normal |
| Em carência | venceu, dentro da carência | normal, com aviso de atraso |
| Suspensa | carência vencida, suspensão manual ou estorno/chargeback | **somente leitura** |
| Cancelada | cancelamento pelo administrador | **somente leitura** |

Pagamento confirmado (`PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`) estende o uso por um mês a partir do vencimento da cobrança. Reentregas do mesmo evento são ignoradas. Em **Registrar pagamento** o administrador libera o uso até uma data (pagamento fora do Asaas, acerto comercial).

### Modo somente leitura

Consulta, relatórios e **exportação/backup continuam**; alterações, envios e rotinas automáticas (captura do DJEN, atualização de históricos, análise por IA, notificações) param. Login, logout e a consulta da licença continuam. Os dados nunca são apagados por inadimplência. Em carência o sistema segue normal; o aviso na interface tem o botão **Já regularizei · verificar agora**.

## Licença na instância

`LICENSE_SERVER_URL`, `LICENSE_KEY` e `LICENSE_PUBLIC_KEY_B64` (as três, ou nenhuma). A instância consulta o painel ao iniciar e a cada 6 horas (a cada 15 min se estiver restrita), recebe uma licença **assinada (Ed25519)** e guarda uma cópia em `DATA_DIR/license.json`. A instância só tem a chave pública: não consegue forjar nem estender a própria licença. A licença traz as datas de vencimento e carência, então a assinatura vencida avança para carência e somente leitura no momento certo mesmo sem contato com o painel. Sem contato por muito tempo (72 h de validade + 14 dias de tolerância) a instância restringe; a primeira instalação sem painel tem 3 dias de carência inicial. Configuração parcial das variáveis deixa a instância em somente leitura com a explicação no aviso, em vez de liberar sem licença.

## Painel de assinaturas (3.54)

Menu lateral com **Visão geral** (receita mensal prevista, escritórios por situação, testes acabando, vencimentos, carência, sistemas sem contato, receita por plano e contratações da página pública), **Escritórios** (busca, filtros por situação e plano, ordenação), **Planos**, **Contratação**, **Atividade** (histórico geral) e **Servidor** (reiniciar sistemas, versão do atendimento, cobrança e regras padrão). O escritório abre num painel com abas: Resumo, Plano e limites, Cobrança, Sistema, Histórico e Zona de perigo.

**Excluir por completo:** só para escritório já **cancelado** (primeiro cancela, depois exclui) e com o endereço digitado. Apaga o cadastro, pagamentos e histórico no painel e, com o provisionamento automático ligado, o sistema no PM2, o endereço no Nginx e a **pasta do escritório com o banco e os arquivos**. Não tem volta. A conta dele no atendimento (Deskcomm) não é apagada.

**Reiniciar sistemas** ignora escritórios cancelados e os que não têm sistema neste servidor (não conta como erro).

## Planos de fábrica e página de contratação

O painel nasce com quatro planos (editáveis em **Planos**; preços e limites são ponto de partida): **Essencial** (R$ 197), **Profissional** (R$ 397, destacado), **Avançado** (R$ 797) e **Ilimitado** (R$ 1.497). Cada um define limites (usuários, advogados, processos, números de WhatsApp, armazenamento) e módulos (gestão, arquivos e modelos, tarefas, indicadores, captação, financeiro, contratos/cobrança, atendimento com IA). O servidor recusa (403, `modulo_nao_contratado`) a área de um módulo que o plano não inclui e a interface esconde o atalho.

A página pública **`/contratar`** (scrollytelling com animações guiadas por rolagem) lista os planos marcados como **à venda** e cria o escritório com **7 dias de teste** (`PAINEL_TESTE_DIAS`). Para abri-la defina `PAINEL_CONTRATACAO_PUBLICA=1`. Proteções: no máximo 5 tentativas por hora por IP, campo-armadilha contra robôs, aceite dos termos obrigatório, e o visitante nunca define limites, cortesia, dias de teste ou porta. Sem `PAINEL_AUTO_PROVISIONAR=1` o escritório é criado no painel e a instância precisa ser provisionada manualmente.

## Limites e planos (para ampliar depois)

Os limites estão em `server/src/licenca/entitlements.ts` (`ENTITLEMENTS`): `max_advogados`, `max_usuarios`, `max_numeros_whatsapp`, `max_processos` (número ou ilimitado) e `ia_habilitada` (liga/desliga). **Para criar um novo limite ou recurso acrescente uma linha ali**: o painel passa a oferecê-lo nos planos e nos ajustes por escritório, e a licença o carrega. Valor efetivo = padrão do sistema ← plano ← ajuste do escritório (`null` = ilimitado). Hoje são aplicados `max_usuarios` (criar/reativar pessoa, resposta 402), `max_advogados` (cadastrar OAB, resposta 402) e `ia_habilitada` (fila de análise); os demais já viajam na licença e podem ser aplicados onde necessário com `mensagemSeExcederLimite(chave, usoAtual)`.

## Cobrança: provedor intercambiável

O painel usa a interface `ProvedorCobranca` (`server/src/painel/asaas.ts`). Há implementação para o **Asaas** (clientes e assinaturas mensais; `billingType: UNDEFINED`, o cliente escolhe a forma de pagamento). Outro provedor (ex.: Mercado Pago) pode ser acrescentado implementando a mesma interface e um endpoint de webhook equivalente. Confirme na documentação do Asaas a URL de produção, as taxas contratadas e a emissão de nota fiscal de serviço com seu contador.

## Segurança e operação

- Painel: senha com scrypt, sessão em cookie `HttpOnly`/`SameSite=Strict`, cabeçalho `X-Requested-With` obrigatório em alterações, limite de tentativas de login, CSP restritiva, chaves de licença guardadas apenas como hash (exibidas uma vez), token do webhook comparado em tempo constante.
- Backup do painel: `PAINEL_DATA_DIR` inteiro (principalmente `licenca-privada.pem`; perdê-la obriga a reemitir a chave pública em todas as instâncias).
- Cada instância exige permissões de arquivos, processo, domínio, porta e backup separados (veja `EXPANSAO_ESCRITORIOS.md`). O deploy automático atual atualiza somente a instalação existente; atualizar as demais instâncias é uma etapa operacional a automatizar.
- **LGPD e sigilo profissional:** como operador dos dados dos escritórios, mantenha contrato de operador/DPA, política de privacidade, backups criptografados e plano de resposta a incidentes. O sistema fornece lembretes operacionais, não prova de prazo: deixe isso claro nos termos de uso.
- **WhatsApp:** a conexão atual (`whatsapp-web.js`) é não oficial e pode levar ao bloqueio de números; avalie a API oficial do WhatsApp Business antes de escalar.
- **IA:** o login por conta ChatGPT não deve ser usado em produto hospedado/comercial; use chaves de API com custo por escritório.
