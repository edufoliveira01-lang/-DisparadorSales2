# Acompanhamento processual — versão 2.38.0

No seletor **Serviço ativo**, escolha **Processos e DJEN**. O controle anterior continua em **Perícias e avisos**.

## Primeiro uso

1. Em **Advogados**, cadastre o nome completo, o número da OAB e a UF. Podem ser acompanhados vários advogados. Cada inscrição tem cadastro próprio; outra UF exige outro cadastro.
2. O modo padrão faz duas consultas complementares: OAB/UF e nome. Inscrições com letra também são consultadas com as variações de separador. Correspondências só pelo nome precisam de conferência da OAB, devido a homônimos.
3. Em **Monitoramento DJEN**, escolha um período de disponibilização de até 31 dias e consulte todos os advogados ativos ou apenas um.
4. Em **Publicações**, selecione uma ou mais categorias, resultados, advogados e situações. Categorias da mesma lista são combinadas por OU; listas diferentes são combinadas por E. As demais publicações continuam armazenadas em **Outros**; não são descartadas por falta de classificação.
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

Se aparecer `Missing optional dependency @openai/codex-linux-x64` (ou a variante da arquitetura), faltou o pacote nativo do CLI. Desde a versão 2.36.1, o instalador inclui dependências opcionais na instalação do servidor e verifica `codex --version` ao final de `npm run install:all`. Se necessário, instala explicitamente o pacote da plataforma na mesma versão do CLI, sem instalação global e sem alterar package.json/package-lock.json. O comando de login também faz essa verificação antes de iniciar a autenticação.

Para reparar uma instalação já existente:

```bash
npm run codex:install --prefix server
npm run codex:login --prefix server
```

A verificação de conexão na interface distingue executável ausente de conta ainda não conectada. O reparo usa apenas o registro npm; não muda as credenciais da conta nem faz chamada de análise de IA.

### Classificação por situação (2.37.0)

O filtro **Sentença de mérito** é reservado ao julgamento dos pedidos da ação de conhecimento. O tipo formal continua visível nos dados da fonte. Uma sentença que extingue RPV/execução é classificada na fase correspondente, e uma sentença homologatória de acordo recebe **Homologação de acordo**. Também estão disponíveis RPV, precatório, extinção da execução, extinção sem mérito, cumprimento de sentença, levantamento de valores, decisão interlocutória, despacho e intimação, além das categorias existentes. A situação descritiva pode ser ajustada na revisão para detalhar fatos fora da lista, que continuam em Outros.

No resultado, o dispositivo global **JULGO PARCIALMENTE PROCEDENTES os pedidos** prevalece sobre a rejeição de um capítulo específico, como dano moral. Referências a julgamentos alheios continuam fora da classificação. As análises automáticas antigas sem revisão serão refeitas nesta atualização; revisões humanas são preservadas e podem receber nova sugestão pela reanálise individual.

O histórico dos andamentos é paginado e inclui datas, órgão, tipo do documento, situação e resumo. O histórico de alterações registra captura, análise, revisão, alterações do processo, prazos e links de documentos a partir desta versão, sem inventar alterações anteriores. Prazos e documentos pertencem ao andamento; contato e anotações pertencem ao processo.

### Categorias

- **Sentença de mérito:** julgamento efetivamente comunicado dos pedidos; referência a sentença anterior, decisão de tutela, pedido de julgamento e cumprimento de sentença não bastam. O resultado é procedente, improcedente, parcial ou não identificado; exige dispositivo literal compatível, e não é deduzido da procedência de um recurso ou de tutela.
- **Acórdão:** julgamento colegiado efetivamente comunicado. Citação de precedente ou remessa para futuro julgamento não bastam.
- **Perícia agendada:** exige data, horário e local explícitos do mesmo agendamento. Determinação de realização, nomeação do perito, solicitação de data/local e agendamento incompleto não entram nesta categoria. Uma decisão incidental pode receber **Decisão interlocutória**; sem evidência suficiente, fica em **Outros**, com os dados faltantes destacados.
- **Laudo pericial juntado:** exige confirmação de apresentação/juntada já ocorrida. Ordem ou prazo de entrega, exames médicos e futura vista após juntada não comprovam esse fato.
- **Outros:** tudo que não se enquadra, está incompleto ou é inconclusivo. Não se criam categorias de prazos nesta etapa.

Toda classificação automática fica **A revisar**. O servidor verifica o formato, as citações e os dados mínimos, mas a análise de IA continua sujeita a erro. O usuário pode ajustar e salvar. Na atualização, as classificações antigas sem revisão, geradas por palavras-chave, voltam a Outros e aguardam análise. Revisões humanas salvas são preservadas. A reanálise individual guarda a sugestão separadamente sem substituir uma revisão humana. O botão de reanálise em lote inclui somente publicações sem revisão. Recaptura idêntica preserva a análise; mudança no texto ou no tipo documental invalida análise e revisão anteriores.

### Execução e credenciais

O Codex roda com duas análises simultâneas por padrão (configurável de uma a três em Monitoramento DJEN) em diretório temporário, com saída JSON, sessão efêmera, sandbox somente leitura e ferramentas de shell, navegador, plugins, aplicativos e subagentes desativadas. O texto judicial é dado não confiável e não autoriza instruções ou ações. A execução não herda as chaves e tokens das outras integrações. API keys são removidas do ambiente e o modo de login é restrito a ChatGPT.

A sessão fica em `~/.disparador-codex` do usuário do servidor, fora do banco/backup do aplicativo. Para um diretório persistente diferente, configure `DJEN_CODEX_HOME` no ambiente do PM2 e no ambiente usado pelo comando de login. Não é necessário informar chave de API. Em contêineres ou múltiplos usuários, mantenha esse diretório persistente, privado e idêntico nos dois comandos. O login não é compartilhado com os demais usuários da máquina.

A conexão positiva é verificada uma vez e reaproveitada por cinco minutos, com nova checagem forçada ao clicar em Verificar conexão. Uma falha de execução invalida esse cache. A interface mostra quantas publicações estão em análise, tempo médio das últimas 50 conclusões e estimativa de término, sujeita à variação dos textos e limites da conta. Erro de validação isolado não interrompe outras publicações; falha de conexão ou limite pausa novas tarefas. O modelo e o esforço de raciocínio foram mantidos.

Há tempo máximo de três minutos por chamada do CLI. Publicações com mais de 60 mil caracteres são divididas em trechos com sobreposição; todas as partes são analisadas, com consolidação progressiva de fatos e evidências e validação das citações contra o texto original. Não há mais rejeição automática aos 120 mil caracteres. A análise de um texto longo pode usar várias chamadas e consumir mais tempo/limite da conta. Uma falha em qualquer parte impede que uma análise incompleta seja salva como conclusão. Uma execução interrompida pelo reinício volta à fila. Credenciais e erros brutos do CLI não são devolvidos ao navegador.

Os prazos têm descrição, início, término, status e observações. A seção de identificação encontra ordens de manifestação com quantidade de dias expressa no texto. O usuário confere o destinatário, regime e marco inicial; não se inventa um prazo recursal apenas pelo rótulo Sentença/Acórdão. A calculadora CPC usa a data-base escolhida (disponibilização DJEN, publicação ou ciência conferida), dias úteis/corridos expressamente determinados, feriados e suspensões configurados, com memória da contagem. Não calcula automaticamente regras especiais, prazo em dobro ou ciência pessoal. O PDF oficial DJEN é aberto diretamente; documentos dos autos continuam dependendo dos links e do acesso do tribunal. A data da lista é a disponibilização, não o vencimento.

Documentação oficial consultada: [execução não interativa](https://developers.openai.com/codex/noninteractive), [autenticação](https://developers.openai.com/codex/auth) e [configuração](https://developers.openai.com/codex/config-reference).


## Novidades e operação na versão 2.38.0

- **WhatsApp:** Parar aparece durante inicialização, QR e autenticação. O estado sai de Iniciando imediatamente ao interromper; fechamento/logout têm limite de cinco segundos com encerramento do Chromium desta instância quando necessário. A inicialização sem avanço tem limite de dois minutos. Eventos e respostas de tentativas antigas não podem reativar a conexão cancelada. Parar preserva a sessão; Desconectar/trocar sessão continua invalidando o login local. O navegador não tem nova versão imposta nesta alteração. A conexão real deve ser conferida na hospedagem após atualizar.
- **Proposta de acordo:** categoria própria para proposta efetivamente apresentada, inclusive pelo INSS, e manifestação sobre proposta existente. Não equivale a acordo homologado. Homologação atual não é descartada por uma extinção futura condicionada ao pagamento. A atualização recoloca análises sem revisão na fila, preservando revisões humanas e os textos capturados.
- **Leitura e conclusão:** todo cartão abre os detalhes, por clique ou teclado. Não lidas têm destaque de cor e lateral, e há ações de marcar lida/não lida. Concluir oculta da lista de pendentes sem apagar dados. O filtro Concluídas permite consultar e reabrir. Concluir a publicação não conclui seus prazos e não apaga eventos no Google.
- **Navegação:** controles no topo permanecem visíveis durante a rolagem; controles no final continuam disponíveis. A numeração foi corrigida entre a API e o componente de paginação.
- **Cliente:** pesquisa por nome, telefone ou processo, sugestões do mesmo processo com seleção explícita e cadastro de contato no próprio detalhe. Nunca há vínculo por nome presumido. Ao preparar a mensagem, o contato escolhido é vinculado ao processo.
- **Avisar cliente:** abre o editor mesmo antes de salvar a revisão. A confirmação exige conferência do inteiro teor, classificação, destinatário e mensagem; a revisão é salva antes do envio. O envio continua exigindo conexão e confirmação ACK, com idempotência e bloqueio de repetição recente. Também funciona em HTTP sem depender de crypto.randomUUID disponível.
- **Codex manual:** funciona com análise automática desligada e tem prioridade na fila. Falha/limite de conexão permanece visível; o botão pode ser usado para tentar novamente. A análise automática continua configurada separadamente.
- **Consultas:** somente cinco registros recentes são mostrados. Excluir remove apenas o histórico daquela consulta concluída, sem apagar publicações, advogados ou cursor; uma consulta em execução não pode ser excluída.

### Configurar os prazos e a agenda processual

Em **Configurações → Prazos e calendários**, carregue as agendas da conta Google compartilhada e selecione uma agenda exclusiva para prazos. A aplicação rejeita o uso de agendas já configuradas para perícias ao enviar o prazo. Não é criada uma agenda Google por conta própria. O botão **Adicionar à agenda de prazos** cria ou atualiza um evento de dia inteiro no término do prazo, com o início e as observações na descrição. O identificador determinístico evita duplicação após repetição/resultado incerto. Editar o prazo local exige usar novamente o botão para atualizar o Google; excluir/cancelar localmente não remove o evento remoto automaticamente.

Cadastre um ou mais calendários com sigla do tribunal, órgão/unidade opcional, intervalo de cobertura, fonte oficial HTTPS (.jus.br), feriados sem expediente e suspensões. Calendários gerais e da unidade são combinados. Confirme a cobertura após conferir a fonte e atos locais/extraordinários. Não há importação automática universal de feriados dos tribunais; o sistema não afirma que um calendário está completo apenas pelo endereço da fonte. Sem cobertura conferida, ou diante de períodos sobrepostos ambíguos, o cálculo é bloqueado. A interface permite deixar o calendário a conferir. Amplie a cobertura quando o cálculo atravessar o ano.

A calculadora separa o dia da disponibilização, a publicação oficial e o primeiro dia contado, e separa feriado de expediente da suspensão do curso do prazo. A suspensão anual do CPC é aplicada à contagem; feriados de expediente no recesso devem constar do calendário. As datas são sugestões para conferência, não protocolo nem garantia de tempestividade. Nenhuma sugestão grava prazo ou envia ao Google sem a ação correspondente.

Fontes utilizadas para a regra CPC: [arts. 219, 220 e 224](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm). Exemplo de consulta oficial de feriados, suspensões e diferenças locais: [TJSP](https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense). A configuração precisa corresponder ao tribunal e à unidade reais do processo.

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
