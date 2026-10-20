# Acompanhamento processual — versão 2.36.1

No seletor **Serviço ativo**, escolha **Processos e DJEN**. O controle anterior continua em **Perícias e avisos**.

## Primeiro uso

1. Em **Advogados**, cadastre o nome completo, o número da OAB e a UF. Podem ser acompanhados vários advogados. Cada inscrição tem cadastro próprio; outra UF exige outro cadastro.
2. O modo padrão faz duas consultas complementares: OAB/UF e nome. Inscrições com letra também são consultadas com as variações de separador. Correspondências só pelo nome precisam de conferência da OAB, devido a homônimos.
3. Em **Monitoramento DJEN**, escolha um período de disponibilização de até 31 dias e consulte todos os advogados ativos ou apenas um.
4. Em **Publicações**, filtre sentença, acórdão, perícia agendada ou laudo pericial juntado. As demais publicações continuam armazenadas em **Outros**; não são descartadas por falta de classificação.
5. Abra os detalhes para consultar o inteiro teor da publicação, partes, advogados, órgão julgador, classe, data, certidão oficial e outras publicações já capturadas do mesmo processo.
6. Confira a classificação, vincule o contato correto da Agenda e, se desejar, revise a mensagem antes de confirmar o envio pelo WhatsApp.

## Classificação e resumos pelo Codex

A conexão é exclusivamente pelo **Codex CLI com login ChatGPT**. Não há chamada direta à API da OpenAI, campo de API key ou alternativa automática por API. O pacote `@openai/codex` está fixado na versão 0.163.0 e é instalado com `npm run install:all`.

### Primeira conexão no servidor

Após atualizar e instalar as dependências, execute **com o mesmo usuário que executa o PM2**:

```bash
cd ~/disparador-sales2
npm run codex:login --prefix server
```

O Codex fornece o endereço e o código de autenticação. Abra o endereço e entre na conta ChatGPT que usará o serviço. Se o login por código de dispositivo estiver desativado, habilite-o nas configurações de segurança da conta ou solicite ao administrador do workspace. Não envie senhas ou arquivos de autenticação pelo aplicativo ou pelo GitHub.

Em **Monitoramento DJEN → Classificação e resumos com Codex**, clique em **Verificar conexão**, marque a análise automática e salve a configuração do Codex. O uso consome os limites disponíveis para a conta Codex; não há promessa de uso ilimitado. Uma falha interrompe a fila com aviso visível; depois de resolver a conexão ou aguardar a liberação de uso, clique em **Retomar análises**.

A análise começa desativada. Na primeira ativação, as publicações antigas sem revisão entram na fila junto com as novas. Até receber uma classificação, ficam em **Outros**, com o estado da análise indicado. O Codex retorna resumo desta publicação, justificativa, citações literais, dados do agendamento presentes e alertas. O histórico do processo mostra os resumos das publicações capturadas; não representa consulta aos autos completos.

### Executável ausente após instalar as dependências

Se aparecer `Missing optional dependency @openai/codex-linux-x64` (ou a variante da arquitetura), faltou o pacote nativo do CLI. A versão 2.36.1 inclui dependências opcionais na instalação do servidor e verifica `codex --version` ao final de `npm run install:all`. Se necessário, instala explicitamente o pacote da plataforma na mesma versão do CLI, sem instalação global e sem alterar package.json/package-lock.json. O comando de login também faz essa verificação antes de iniciar a autenticação.

Para reparar uma instalação já existente:

```bash
npm run codex:install --prefix server
npm run codex:login --prefix server
```

A verificação de conexão na interface distingue executável ausente de conta ainda não conectada. O reparo usa apenas o registro npm; não muda as credenciais da conta nem faz chamada de análise de IA.

### Categorias

- **Sentença:** sentença efetivamente comunicada; referência a sentença anterior, decisão de tutela, pedido de julgamento e cumprimento de sentença não bastam. O resultado é procedente, improcedente, parcial ou não identificado; exige dispositivo literal compatível, e não é deduzido da procedência de um recurso ou de tutela.
- **Acórdão:** julgamento colegiado efetivamente comunicado. Citação de precedente ou remessa para futuro julgamento não bastam.
- **Perícia agendada:** exige data, horário e local explícitos do mesmo agendamento. Determinação de realização, nomeação do perito, solicitação de data/local e agendamento incompleto ficam em **Outros**, com os dados faltantes destacados.
- **Laudo pericial juntado:** exige confirmação de apresentação/juntada já ocorrida. Ordem ou prazo de entrega, exames médicos e futura vista após juntada não comprovam esse fato.
- **Outros:** tudo que não se enquadra, está incompleto ou é inconclusivo. Não se criam categorias de prazos nesta etapa.

Toda classificação automática fica **A revisar**. O servidor verifica o formato, as citações e os dados mínimos, mas a análise de IA continua sujeita a erro. O usuário pode ajustar e salvar. Na atualização, as classificações antigas sem revisão, geradas por palavras-chave, voltam a Outros e aguardam análise. Revisões humanas salvas são preservadas. A reanálise individual guarda a sugestão separadamente sem substituir uma revisão humana. O botão de reanálise em lote inclui somente publicações sem revisão. Recaptura idêntica preserva a análise; mudança no texto ou no tipo documental invalida análise e revisão anteriores.

### Execução e credenciais

O Codex roda serialmente em diretório temporário, com saída JSON, sessão efêmera, sandbox somente leitura e ferramentas de shell, navegador, plugins, aplicativos e subagentes desativadas. O texto judicial é dado não confiável e não autoriza instruções ou ações. A execução não herda as chaves e tokens das outras integrações. API keys são removidas do ambiente e o modo de login é restrito a ChatGPT.

A sessão fica em `~/.disparador-codex` do usuário do servidor, fora do banco/backup do aplicativo. Para um diretório persistente diferente, configure `DJEN_CODEX_HOME` no ambiente do PM2 e no ambiente usado pelo comando de login. Não é necessário informar chave de API. Em contêineres ou múltiplos usuários, mantenha esse diretório persistente, privado e idêntico nos dois comandos. O login não é compartilhado com os demais usuários da máquina.

Há tempo máximo de três minutos por execução e limite de 120 mil caracteres por publicação; textos maiores não são truncados e ficam com erro visível para conferência manual. Uma execução interrompida pelo reinício volta à fila. Credenciais e erros brutos do CLI não são devolvidos ao navegador.

Esta etapa não calcula prazos, consulta autos integrais, acessa documentos sob sigilo ou cria eventos em calendários. A data da lista é a **disponibilização informada pelo DJEN**, não vencimento. A mensagem inicial ao cliente permanece neutra e editável; não afirma resultado favorável automaticamente.

Documentação oficial consultada: [execução não interativa](https://developers.openai.com/codex/noninteractive), [autenticação](https://developers.openai.com/codex/auth) e [configuração](https://developers.openai.com/codex/config-reference).

## Independência dos serviços

As tabelas `djen_*` guardam advogados, processos, publicações, consultas, revisão e mensagens desta área. A captura e a comunicação processual não criam registros em `pericias_agendadas`, `send_logs`, `pending_replies` nem vínculos do calendário de perícias. Não há transferência automática de perícia identificada no DJEN para o controle anterior.

Somente infraestrutura comum é reutilizada: login, Agenda de contatos, conexão do WhatsApp e acesso às configurações existentes. O vínculo do contato com o processo é explícito; não é escolhido automaticamente pelo nome da parte. A exclusão de um contato não apaga as publicações. As mensagens ficam no histórico do acompanhamento processual e não abrem uma espera de resposta no módulo de perícias.

## Captura automática e falhas

O monitoramento automático começa desligado. Pode ser ativado com intervalo entre 30 e 1440 minutos. Na primeira execução usa a janela configurada; depois retoma do último período concluído, com sobreposição de dois dias. Se houver muito tempo sem captura, recupera o histórico em janelas de até 31 dias, sem saltar diretamente para hoje.

Publicações são deduplicadas pelo identificador da comunicação, inclusive quando encontradas por vários advogados ou pelos dois modos de busca. As consultas respeitam paginação e espera entre requisições. Resultados a partir de 10 mil provocam divisão do intervalo, quando possível. Paginação incompleta, repetida, limite de requisições ou falha de acesso não avançam o cursor do advogado afetado.

Erros aparecem em **Últimas consultas** e no cadastro do advogado. Reiniciar o servidor preserva o que já foi capturado; uma consulta interrompida deve ser repetida para completá-la. Envios de resultado incerto não são repetidos automaticamente. O destinatário é conferido novamente no servidor antes do envio e a confirmação exige ACK do WhatsApp.

## Fonte e validação

Fonte fixa: `https://comunicaapi.pje.jus.br/api/v1/comunicacao`. A consulta é somente leitura. Filtros e paginação foram conferidos no código público do portal oficial `https://comunica.pje.jus.br/`, consultado em 20/10/2026: `numeroOab`, `ufOab`, `nomeAdvogado`, `dataDisponibilizacaoInicio`, `dataDisponibilizacaoFim`, `pagina` e `itensPorPagina`.

O acesso direto à API retornou HTTP 403 no ambiente de desenvolvimento. Portanto a conectividade real precisa ser confirmada a partir da hospedagem do escritório; não foi declarada uma captura real de produção. Um 403 é mostrado como falha de acesso, nunca como sucesso com zero publicações. Não é utilizada fonte alternativa, contorno de bloqueio nem dados fictícios na aplicação de produção.

Testes automatizados cobrem validação e persistência da análise (resposta do Codex simulada), paginação, falhas, deduplicação, revisão, cursor, destinatário e isolamento. A interface foi exercitada com API e SQLite locais reais, simulando a fonte DJEN, o retorno do Codex e o envio pelo WhatsApp. O backup existente, por copiar o SQLite, também inclui as novas tabelas.

Não foi usado login ChatGPT de produção no desenvolvimento. A análise real depende da autenticação na hospedagem; os testes locais do contrato CLI e da fila não comprovam a precisão de um modelo em todos os textos judiciais.
