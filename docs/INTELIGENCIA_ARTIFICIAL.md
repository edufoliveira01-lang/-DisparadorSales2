# Central de inteligência artificial — 2.51.0

## Configurar pelo painel

Abra **Configurações → Inteligência artificial** com permissão de gerenciar integrações. A configuração é compartilhada pela equipe da instalação/escritório atual; ela não é uma chave individual por colaborador.

1. Selecione **OpenAI · API**, **Anthropic · Claude API** ou **OpenAI · conta ChatGPT**.
2. Para API, informe a chave da sua conta do provedor. O servidor exige `ENCRYPTION_KEY` estável com pelo menos 32 caracteres para salvar credenciais de IA. Uma chave já cadastrada nunca é exibida; o campo vazio a mantém.
3. Use **Carregar modelos** ou informe o identificador. O catálogo pode incluir modelos sem acesso à inferência ou sem suporte a saída estruturada; confirme com o teste.
4. Selecione o modelo principal. Isso aplica a escolha aos três modos. Em **Modelos por modo de análise**, ajuste econômico, equilibrado e máxima precisão separadamente se necessário.
5. Escolha o modo a testar e clique em **Testar conexão**. O teste faz uma pequena chamada ao modelo escolhido, sem texto de clientes. Pode consumir créditos ou limites da conta. Modelos diferentes devem ser testados separadamente.
6. Salve. As próximas tarefas usam a conexão escolhida. Não há troca automática entre provedores. Caso o modelo econômico e o equilibrado sejam diferentes, casos econômicos inconclusivos podem usar o equilibrado do mesmo provedor.
7. Em **Processos → Monitoramento**, configure a fila automática e retome-a quando estiver pronta.

Uma alteração de conexão aguarda as análises em andamento. As publicações já concluídas, seus metadados de origem e revisões humanas permanecem intactos. A configuração não reanalisa todo o histórico por conta própria.

## Conectar uma conta ChatGPT sem SSH

Na opção de conta ChatGPT, clique em **Conectar conta ChatGPT**. O painel exibe um código temporário e o link oficial `https://auth.openai.com/codex/device`. Abra esse link, autorize a conta na OpenAI e retorne ao painel. O resultado é acompanhado automaticamente. A senha e os tokens nunca são digitados nem expostos no DisparaZap.

A tentativa fica restrita ao usuário e à sessão que a iniciaram e expira em cinco minutos no painel. Encerrar a sessão ou revogar sua permissão interrompe o fluxo. Pode ser cancelada. Inícios concorrentes são bloqueados; concluir, cancelar, falhar ou expirar remove o código e encerra o processo auxiliar. Ao desconectar uma conta ativa, a fila é pausada e precisa ser retomada após reconectar ou escolher outra origem.

É necessário habilitar o login por código de dispositivo nas configurações da conta/workspace quando a OpenAI exigir. O componente local `@openai/codex` existente continua sendo usado internamente para esse provedor, mas a interface geral chama as funções de **IA**.

### Limite para produtos hospedados/comerciais

A autenticação tradicional do componente não deve ser usada para transformar uma assinatura pessoal em backend de serviço hospedado/comercial. Nesses ambientes, use APIs ou implemente **Sign in with ChatGPT** com a habilitação oficial aplicável ao aplicativo. Esta versão não registra automaticamente o produto no programa de parceiros nem implementa esse OAuth comercial sem as credenciais/autorizações correspondentes.

`AI_DEPLOYMENT_MODE=hosted` bloqueia o início do login tradicional pelo painel, a seleção dessa conexão e sua execução. Novas instâncias com `OFFICE_ID` assumem esse modo por padrão. A instalação legada, sem `OFFICE_ID`, assume `local` para compatibilidade com seu uso interno local; configure o modo explicitamente ao mudar a forma de hospedagem. O modo não pode ser alterado pela API nem pelo painel. Não declare `local` para contornar requisitos do serviço.

A sessão já existente é preservada. A mudança da interface não exige desconectar e autenticar novamente uma conta válida.

## Dados, cache e segurança

- APIs acessam exclusivamente `https://api.openai.com/v1` e `https://api.anthropic.com/v1`; não há endpoint arbitrário para receber chaves. Redirecionamentos são recusados.
- Chaves de API usam AES-256-GCM no banco existente. Preserve `ENCRYPTION_KEY` ao migrar/restaurar; não publique chaves, `.env` ou diretórios de autenticação.
- Credenciais da conta ChatGPT continuam no diretório privado `DJEN_CODEX_HOME`, administradas pelo componente oficial. Não são retornadas ao navegador.
- APIs recebem o texto/contexto da publicação, regras de classificação e exemplos configurados. Revise o provedor autorizado a processar esses dados.
- A resposta passa por validação local de schema semântico e evidências, além da saída estruturada do provedor. Revisões humanas prevalecem.
- Provedor, modelo e revisão da conexão participam do cache. Cache antigo de outra origem não é atribuído ao modelo recém-selecionado. Reanálise manual individual ignora cache.
- Cada publicação analisada registra provedor/modelo; os registros anteriores de conta ChatGPT mantêm modelo desconhecido quando não havia essa informação. Não se inventa um modelo retroativamente.
- Os registros de execução incluem provedor e modelo, inclusive em falhas e reutilização do cache. Não são um demonstrativo de cobrança de tokens.
- Conexões em falta, falha de autenticação e limites pausam a fila sem tentar outra empresa automaticamente. Erros brutos dos serviços não são devolvidos ao navegador.

## Compatibilidade e operação

O driver SQLite não muda nesta entrega. As migrações acrescentam metadados sem apagar análises, filas, revisões ou contas. Os identificadores internos e rotas antigas `/djen/codex/*` são mantidos como aliases para abas antigas; a interface nova usa `/djen/ia/*` e `/ai/*`.

As APIs não dependem do executável local para gerar análises. Se a opção de conta ChatGPT informar componente indisponível, um administrador da infraestrutura pode reparar a dependência com `npm run codex:install --prefix server`; isso é manutenção da instalação, não o fluxo de login do usuário.

Fontes de implementação: [OpenAI — saídas estruturadas](https://developers.openai.com/api/docs/guides/structured-outputs), [Anthropic — saídas estruturadas](https://platform.claude.com/docs/en/build-with-claude/structured-outputs), [autenticação do componente oficial](https://learn.chatgpt.com/docs/app-server), [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart).
