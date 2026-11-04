# DisparaZap — Sales & Associados

Sistema de comunicação com clientes e acompanhamento processual. **Versão 2.65.0.**

## Recursos atuais

- Avisos de perícias, audiências, cobranças e lembretes pelo WhatsApp, com templates, prévia, confirmação de envio e histórico.
- Importação de cards do Trello e contatos CSV/vCard, vinculação de clientes e controle de remarcações.
- Calendário semanal/mensal e Google Agenda com múltiplos destinos, reaproveitamento de eventos existentes e revisão de duplicidades.
- Consulta e monitoramento DJEN por advogado, publicações agrupadas por processo, documentos, leitura e conclusão em lote.
- Análise por IA com provedor selecionável, revisão humana, exemplos de classificação, cache, lotes e paralelismo configurável.
- Quadro/Kanban de etapas processuais, prazos com calendários oficiais e acompanhamentos separados de perícia sem laudo, juízo e obrigações de terceiros.
- Equipe com perfis Administrador, Gestor, Advogado, Atendimento e Consulta, permissões na API e interface, auditoria e personalização do login.
- Notificações por canais configurados, backup administrativo e atividade dos serviços em tempo real.

## Quadro/Kanban

O quadro utiliza **o histórico capturado do DJEN**, as categorias com evidências da análise e a revisão humana. Ele não consulta autos completos que não foram importados. Quando faltam sinais, o processo permanece em **Sem etapa identificada**.

- **Mover**: escolha qualquer lista e salve. Em computador, também é possível arrastar o cartão entre listas.
- A etapa escolhida fica **manual e mantida**, inclusive após novas publicações, análises, revisões e reinícios.
- **Voltar ao automático**: aplica novamente a etapa sustentada pelo histórico disponível.
- Se o histórico indicar outra etapa para um cartão manual, o quadro apresenta a sugestão sem mover o cartão.
- Revisar uma categoria passa a valer para a etapa correspondente mesmo quando a IA não tinha produzido evidência para aquela categoria. A revisão não altera um cartão mantido manualmente.
- Ensinar a IA adiciona exemplos para **análises futuras**; não treina o modelo nem reanalisa automaticamente todas as publicações antigas. Para elas, salve a revisão ou solicite nova análise.
- Uma categoria ampla não descreve todas as etapas possíveis: por exemplo, recurso, cálculos ou perícia realizada podem exigir evidência específica no texto ou ajuste manual.
- As contagens de dias das listas são acompanhamento interno em dias corridos; não substituem prazos processuais.
- **Etapas situacionais (2.56.0):** quando o histórico não prova nenhuma etapa processual, o cartão deixa de ficar em *Sem etapa identificada* e vai para a lista que indica quem deve agir: **Providência do escritório** (ordem vigente), **Aguardando outra parte / terceiros** (perito, INSS, parte contrária, ofícios sem resposta), **Sobrestado / suspenso** ou **Aguardando juízo** (sem ordem pendente). Qualquer etapa processual comprovada (perícia, sentença, recurso etc.) prevalece sobre elas. Novas etapas: Citação / contestação, Audiência, Proposta de acordo (logo após o laudo), Conclusos para sentença e Trânsito em julgado.
- **Áreas (2.60.0):** cada processo recebe uma área — Previdenciário, Trabalhista, Bancário ou Cível / outros — detectada pelo ramo da Justiça no número CNJ, pela classe e pelo órgão e por menções nas publicações (INSS, reclamante/reclamada, banco etc.). O quadro tem um seletor de área e só mostra as etapas que se aplicam (a implantação do benefício é do previdenciário; *Penhora / bloqueio de valores* e *Pagamento / alvará* servem às demais). A área pode ser corrigida em **Mover**; a escolha manual não é sobrescrita.
- **Reclassificar** reavalia todos os cartões automáticos (etapas manuais não mudam). Os chips mostram a contagem por lista e focam uma coluna; é possível selecionar vários cartões e **mover em lote** (vira etapa manual).

## SaaS: assinaturas e licenças

Painel de controle (planos, escritórios, cobrança pelo Asaas e emissão de licenças) e cliente de licença nas instâncias. Cada escritório tem um workspace isolado; a instalação atual continua em modo próprio, sem limites. Veja [docs/SAAS.md](docs/SAAS.md).

## Stack e armazenamento

Backend Node.js/TypeScript, Express, Socket.io, SQLite (`better-sqlite3`, WAL) e `whatsapp-web.js` com Puppeteer. Frontend React 18, TypeScript, Vite e TailwindCSS.

```text
server/src/db/          Banco, migrações e proteção de identidade do escritório
server/src/services/    WhatsApp, agenda, notificações, DJEN e IA
server/src/routes/      APIs com autenticação e permissões
server/tests/           Testes automatizados com SQLite temporário
client/src/pages/       Telas e fluxos
client/src/components/  Componentes compartilhados
.github/workflows/      Validação e atualização seletiva do Ubuntu
```

A instalação atual atende uma equipe em uma base compartilhada. **Não existe suporte PostgreSQL no runtime nem hospedagem de vários escritórios no mesmo processo.** A preparação para expansão está em [docs/EXPANSAO_ESCRITORIOS.md](docs/EXPANSAO_ESCRITORIOS.md). Não configure `DATABASE_URL` esperando trocar o driver automaticamente.

## Instalação e desenvolvimento

Use Node.js **22 LTS**, npm e as bibliotecas do Chromium/Puppeteer exigidas pelo sistema operacional.

Na raiz do projeto, execute um comando por vez:

```bash
cp .env.example .env
```

Preencha uma `ENCRYPTION_KEY` estável e exclusiva. No desenvolvimento, mantenha `PORT=3333` e `APP_URL=http://localhost:8081`.

```bash
npm run install:all
```

```bash
npm run dev
```

Frontend: `http://localhost:8081`. Backend: `http://localhost:3333`. O backend usa `PORT` quando configurado. O Vite encaminha as APIs ao backend de desenvolvimento.

O arquivo canônico é `.env` na raiz. Há compatibilidade com `.env` no diretório de execução para instalações antigas. Nunca publique credenciais no Git.

Por padrão, SQLite, sessão do WhatsApp e arquivos operacionais ficam em `server/data/`. O primeiro administrador é criado com `INITIAL_ADMIN_PASSWORD` (mínimo 12 caracteres) ou uma senha aleatória exibida uma única vez no log do primeiro início. Troque a senha após entrar.

## Configuração operacional

1. Configure Trello, listas e contatos; revise o formato dos cards antes de enviar.
2. Personalize templates por categoria e confira a prévia.
3. Conecte o WhatsApp pelo QR em Configurações. O fluxo reutiliza a sessão válida e oferece recuperação quando necessário.
4. Configure Google OAuth e destinos de agenda. Analise conflitos antes de confirmar remoções de eventos manuais.
5. Cadastre advogados e configure o período e a frequência das consultas DJEN.
6. Em **Configurações → Inteligência artificial**, escolha OpenAI por API, Anthropic por API ou conta ChatGPT. Carregue os modelos ou informe seus identificadores, teste e salve. O login da conta ChatGPT é iniciado no painel e concluído na página oficial da OpenAI, sem SSH. Veja [docs/INTELIGENCIA_ARTIFICIAL.md](docs/INTELIGENCIA_ARTIFICIAL.md) para credenciais, modos locais/hospedados e limites.

7. Cadastre pessoas e permissões em Equipe. Não compartilhe a conta administrativa.

Mais detalhes: [Acompanhamento DJEN](docs/ACOMPANHAMENTO_DJEN.md) e [Conexão WhatsApp](docs/WHATSAPP_CONEXAO.md).

## Variáveis principais

| Variável | Uso |
| --- | --- |
| `PORT` | Porta do backend; padrão 3333. Preserve a configuração do PM2/Nginx existente. |
| `APP_URL` | URL pública usada pelos fluxos de acesso e recuperação. |
| `NODE_ENV` | Use `production` em produção HTTPS para cookies seguros. |
| `DATA_DIR` | Caminho dos dados; padrão `server/data`. |
| `ENCRYPTION_KEY` | Chave estável de criptografia dos tokens. Preserve-a nos backups seguros. |
| `INITIAL_ADMIN_PASSWORD` | Senha inicial opcional; usada somente quando não há usuários. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | OAuth do Google Agenda. |
| `DJEN_CODEX_HOME` | Diretório de autenticação da conta ChatGPT; padrão `~/.disparador-codex`. |
| `AI_DEPLOYMENT_MODE` | `local` para instalação interna local; `hosted` bloqueia o login tradicional da conta ChatGPT. |
| `OFFICE_ID` | Identidade opcional para uma **nova instância isolada**; exige diretórios e chave próprios. |

Credenciais de integrações também podem ser configuradas pela interface. SMTP e os canais de notificação dependem das configurações do servidor. Preserve `.env`, `DATA_DIR` e a autenticação da conta ChatGPT ao migrar de máquina.

## Validação

```bash
npm test --prefix server
```

```bash
npm run build --prefix server
```

```bash
npm run lint --prefix client
```

```bash
npm run build --prefix client
```

Os testes criam um diretório temporário próprio e recusam executar contra o banco operacional. O CI executa testes, verificação de tipos e builds em PRs e na `main`.

## Atualização do Ubuntu

O fluxo **Atualizar Ubuntu** publica a `main` no runner próprio da instalação `/home/dropsales/disparador-sales2`, com interface em `/var/www/disparazap` e serviço PM2 `disparador-backend`.

- Compara os arquivos alterados e reutiliza as dependências quando não mudaram.
- Documentação e testes, isoladamente, não reiniciam o serviço. O CI continua validando o código.
- Antes de publicar código, executa os testes em dados temporários e a verificação de tipos do cliente.
- Compila somente os módulos alterados, cria backups e publica os assets com `index.html` por último.
- Se falhar após iniciar a publicação, tenta restaurar o commit anterior, os artefatos, as dependências substituídas e a interface, e reinicia o serviço anterior.
- A restauração automática **preserva o banco em uso**. Ela não desfaz migrações destrutivas nem alterações em serviços externos. Mudanças futuras de schema devem permanecer compatíveis com a versão anterior ou ter procedimento próprio de restauração.
- A checagem de saúde confirma disponibilidade da API, não autenticação do WhatsApp nem funcionamento de todas as integrações.

Backups do deploy ficam em `/home/dropsales/disparazap-backups`. Mantenha cópias externas protegidas e confira o resultado no GitHub Actions após atualizar.

Para entrar no servidor atual:

```bash
ssh dropsales@192.168.15.10
```

## Dados externos e limites

O armazenamento principal é local, mas as integrações enviam os dados necessários a WhatsApp, Trello, Google e canais de notificação. Com análise habilitada, o conteúdo da publicação é enviado ao provedor de IA selecionado. Revise permissões e configurações antes de usar dados reais.

A recuperação de confirmações consulta a mensagem exata. A recuperação de respostas percorre as pendências por cursor, sem o limite de 200 itens usado na listagem da tela. Reações perdidas durante uma desconexão têm limitações da biblioteca; não se deve presumir sua recuperação.
