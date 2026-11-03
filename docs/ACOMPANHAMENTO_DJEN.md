# Acompanhamento processual — versão 2.51.0

No seletor **Serviço ativo**, escolha **Processos e DJEN**. O controle anterior continua em **Perícias e avisos**.

## Primeiro uso

1. Em **Advogados**, cadastre o nome completo, o número da OAB e a UF. Podem ser acompanhados vários advogados. Cada inscrição tem cadastro próprio; outra UF exige outro cadastro.
2. O modo padrão faz duas consultas complementares: OAB/UF e nome. Inscrições com letra também são consultadas com as variações de separador. Correspondências só pelo nome precisam de conferência da OAB, devido a homônimos.
3. Em **Monitoramento DJEN**, escolha um período de disponibilização de até 31 dias e consulte todos os advogados ativos ou apenas um.
4. Em **Publicações**, selecione uma ou mais categorias, resultados, advogados e situações. Categorias da mesma lista são combinadas por OU; listas diferentes são combinadas por E. As demais publicações continuam armazenadas em **Outros**; não são descartadas por falta de classificação.
5. Abra os detalhes para consultar o inteiro teor da publicação, partes, advogados, órgão julgador, classe, data, certidão oficial e outras publicações já capturadas do mesmo processo.
6. Confira a classificação, vincule o contato correto da Agenda e, se desejar, revise a mensagem antes de confirmar o envio pelo WhatsApp.

## Classificação e resumos com IA

A partir da versão **2.51.0**, configure o provedor em **Configurações → Inteligência artificial**. Estão disponíveis OpenAI por API, Anthropic por API e a conexão existente de conta ChatGPT. A análise usa o provedor selecionado; não troca silenciosamente para outro serviço.

As chaves de API são criptografadas com a `ENCRYPTION_KEY` da instalação. Para a conta ChatGPT, o painel inicia a autorização oficial por código em instalação interna local; o usuário conclui na página oficial, sem SSH e sem informar senha ao sistema. Implantações hospedadas/comerciais bloqueiam esse fluxo tradicional e precisam de integração oficial autorizada ou API. Veja [Inteligência artificial](INTELIGENCIA_ARTIFICIAL.md).

Em **Monitoramento DJEN → Classificação e resumos com IA**, configure análise automática, paralelismo e modo:

- **Econômico:** até oito publicações curtas por lote. Casos inconclusivos ou inválidos podem usar o modelo equilibrado do mesmo provedor, quando os modelos configurados são diferentes.
- **Equilibrado:** até quatro publicações por lote.
- **Máxima precisão:** uma publicação por execução. A reanálise manual usa esse modo.

Os modelos são definidos na central de IA. Alterar o modelo principal aplica a escolha aos três modos; a área avançada permite escolher um por modo. Os valores anteriores da conta ChatGPT são mantidos até alteração explícita. Publicações com mais de 20 mil caracteres são tratadas individualmente; textos maiores são divididos com sobreposição e consolidados sem truncar o inteiro teor.

O cache inclui provedor, modelo, esforço/perfil, revisão da conexão, versão do classificador, exemplos, texto e contexto. Cache de uma origem não é atribuído a outra. Análises antigas, histórico e revisões humanas são preservados. Os detalhes apresentam a origem da análise; registros legados sem modelo conhecido permanecem identificados como anteriores.

A troca de conexão aguarda trabalhos em andamento. Falhas de autenticação ou limite pausam a fila; corrija a conexão e use **Retomar análises**. Remover a credencial ativa ou desconectar a conta também pausa a fila. O catálogo de modelos não comprova acesso à inferência; o teste faz uma pequena requisição sem dados de clientes e pode consumir créditos. Os indicadores de uso são contagens operacionais, não faturamento exato.

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

A IA usa de uma a três execuções simultâneas configuráveis. Todas as origens retornam JSON e passam pelas mesmas validações de categorias, evidências e agendamento. O texto judicial é dado não confiável e não autoriza executar ações.

As APIs usam endpoints oficiais fixos e credenciais somente no backend. A conexão da conta ChatGPT mantém execução restrita por componente local, diretórios temporários, sessão efêmera e ferramentas desativadas. A autenticação gerenciada fica no diretório `DJEN_CODEX_HOME` (padrão `~/.disparador-codex`) do usuário do serviço; preserve esse diretório com permissões privadas ao migrar o servidor.

Cada chamada tem limite de tempo, tamanho de resposta e validação de resultado completo. Limite de saída, recusa ou falha não são salvos como análise concluída. Erros brutos, tokens e chaves não são devolvidos ao navegador. Trabalhos interrompidos voltam à fila após reinício.

Os prazos têm descrição, início, término, status e observações. A seção de identificação encontra ordens de manifestação com quantidade de dias expressa no texto. O usuário confere o destinatário, regime e marco inicial; não se inventa um prazo recursal apenas pelo rótulo Sentença/Acórdão. A calculadora CPC usa a data-base escolhida (disponibilização DJEN, publicação ou ciência conferida), dias úteis/corridos expressamente determinados, feriados e suspensões importados ou preenchidos manualmente, com memória da contagem. Não calcula automaticamente regras especiais, prazo em dobro ou ciência pessoal. O PDF oficial DJEN é aberto diretamente; documentos dos autos continuam dependendo dos links e do acesso do tribunal. A data da lista é a disponibilização, não o vencimento.

Documentação oficial consultada: [execução não interativa](https://developers.openai.com/codex/noninteractive), [autenticação](https://developers.openai.com/codex/auth) e [configuração](https://developers.openai.com/codex/config-reference).


## Novidades e operação na versão 2.38.0

- **WhatsApp:** Parar aparece durante inicialização, QR e autenticação. O estado sai de Iniciando imediatamente ao interromper; fechamento/logout têm limite de cinco segundos com encerramento do Chromium desta instância quando necessário. A inicialização sem avanço tem limite de dois minutos. Eventos e respostas de tentativas antigas não podem reativar a conexão cancelada. Parar preserva a sessão; Desconectar/trocar sessão continua invalidando o login local. O navegador não tem nova versão imposta nesta alteração. A conexão real deve ser conferida na hospedagem após atualizar.
- **Proposta de acordo:** categoria própria para proposta efetivamente apresentada, inclusive pelo INSS, e manifestação sobre proposta existente. Não equivale a acordo homologado. Homologação atual não é descartada por uma extinção futura condicionada ao pagamento. A atualização recoloca análises sem revisão na fila, preservando revisões humanas e os textos capturados.
- **Leitura e conclusão:** todo cartão abre os detalhes, por clique ou teclado. Não lidas têm destaque de cor e lateral, e há ações de marcar lida/não lida. Concluir oculta da lista de pendentes sem apagar dados. O filtro Concluídas permite consultar e reabrir. Concluir a publicação não conclui seus prazos e não apaga eventos no Google.
- **Navegação:** controles no topo permanecem visíveis durante a rolagem; controles no final continuam disponíveis. A numeração foi corrigida entre a API e o componente de paginação.
- **Cliente:** pesquisa por nome, telefone ou processo, sugestões do mesmo processo com seleção explícita e cadastro de contato no próprio detalhe. Nunca há vínculo por nome presumido. Ao preparar a mensagem, o contato escolhido é vinculado ao processo.
- **Avisar cliente:** abre o editor mesmo antes de salvar a revisão. A confirmação exige conferência do inteiro teor, classificação, destinatário e mensagem; a revisão é salva antes do envio. O envio continua exigindo conexão e confirmação ACK, com idempotência e bloqueio de repetição recente. Também funciona em HTTP sem depender de crypto.randomUUID disponível.
- **Análise manual com IA:** funciona com análise automática desligada e tem prioridade na fila. Falha/limite de conexão permanece visível; o botão pode ser usado para tentar novamente. A análise automática continua configurada separadamente.
- **Consultas:** somente cinco registros recentes são mostrados. Excluir remove apenas o histórico daquela consulta concluída, sem apagar publicações, advogados ou cursor; uma consulta em execução não pode ser excluída.

### Configurar os prazos e a agenda processual

Em **Configurações → Prazos e calendários**, carregue as agendas da conta Google compartilhada e selecione uma agenda exclusiva para prazos. A aplicação rejeita o uso de agendas já configuradas para perícias ao enviar o prazo. Não é criada uma agenda Google por conta própria. O botão **Adicionar à agenda de prazos** cria ou atualiza um evento de dia inteiro no término do prazo, com o início e as observações na descrição. O identificador determinístico evita duplicação após repetição/resultado incerto. Editar o prazo local exige usar novamente o botão para atualizar o Google; excluir/cancelar localmente não remove o evento remoto automaticamente.

A partir da versão **2.39.0**, **Calendários automáticos** vem ativado. O sistema identifica os órgãos/anos das publicações capturadas, importa os dados oficiais e renova cada calendário após seis horas. O monitor verifica pendências a cada minuto, começando trinta segundos após iniciar o servidor; a captura de novas publicações e a abertura das sugestões também alimentam a fila. A calculadora consulta a fonte quando não há dados válidos e importa o ano seguinte se a contagem atravessar a cobertura anual. Consultas simultâneas do mesmo calendário são compartilhadas, e fontes comuns são reaproveitadas por dez minutos. O botão **Atualizar agora** ignora esse cache e permite uma consulta pontual mesmo com o automático desativado.

Fontes implementadas:

| Tribunal / seção | Importação automática |
| --- | --- |
| TJSP | Feriados e suspensões oficiais por município e ano; município identificado pelo órgão ou associado uma vez nas configurações. |
| TRF3, segundo grau | Ato anual consolidado e portarias complementares da página oficial. Separa a sede de SP da Turma Regional de MS. Atos com restrição de dependência ficam para conferência. |
| JFSP, primeiro grau do TRF3 | Ato anual e tabela municipal consolidada da Diretoria do Foro. Datas revogadas/riscadas não entram na contagem. |
| TRF4, JFRS, JFSC e JFPR | Calendário anual oficial, combinando os dias comuns com os da subseção identificada. Cidade ambígua exige informar cidade/UF uma vez. |
| TJDFT | Tabela oficial anual de feriados e expedientes suspensos. |

A primeira instância de MS e os demais tribunais ainda usam a alternativa manual quando não há fonte automática validada. Não se substitui uma fonte indisponível por uma lista de feriados nacionais presumidamente completa. Os calendários importados mostram localidade, fonte, última importação, falhas e histórico. Um ano não publicado, resposta vazia ou formato não reconhecido bloqueia o uso automático desse calendário; conserva-se o conteúdo anterior para consulta e os ajustes manuais, sem apresentá-lo como atualizado.

Se a cidade não puder ser identificada com segurança, abra **Informar ou corrigir localidade**, preencha cidade/UF/instância e salve. As próximas atualizações passam a ser automáticas para esse órgão. Alterar a localidade invalida o calendário anterior até concluir a nova consulta, inclusive se uma consulta estava em andamento.

Em **Ver datas e corrigir manualmente**, é possível adicionar feriado, suspensão ou expediente parcial, desconsiderar/restaurar um evento importado e resolver atos cuja abrangência está pendente. As correções são gravadas separadamente e **sobrevivem a novas importações**. Uma suspensão restrita a outra vara não é aplicada à comarca inteira. Quando não é possível afirmar a abrangência, o ato fica pendente e só bloqueia uma contagem que atravesse o período. Consulte o ato antes de escolher **Confirmar suspensão neste órgão** ou **Não se aplica a este órgão**; para uma exceção diferente, desconsidere o evento e adicione o ajuste apropriado. Datas de expediente parcial são contadas no meio do prazo, com prorrogação do início/vencimento conforme a regra CPC adotada.

**Preencher calendário manual completo (alternativa)** continua disponível, inclusive sem conexão à fonte: cadastre sigla, órgão/unidade opcional, cobertura, fonte oficial HTTPS (.jus.br), feriados e suspensões. Calendários manuais gerais e da unidade são combinados. Um cadastro manual **conferido tem prioridade** sobre a importação para o mesmo órgão/período; cadastros não conferidos não entram no cálculo. Não é necessário cadastrar um calendário manual para usar uma fonte automática atendida. Atos extraordinários ausentes das páginas consultadas podem ser complementados pelos ajustes. Fontes e alterações usadas ficam na memória da contagem. A consulta não modifica prazos já salvos nem eventos no Google.

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

## Validação da importação automática (2.39.0)

Em 21/10/2026, consultas reais às fontes oficiais retornaram calendários do TJSP/São Paulo, JFSP/Catanduva, TRF3/8ª Turma, TRF4/JFSC/Florianópolis e TJDFT. Os testes usam recortes dessas respostas para conferir formato, ano, feriados locais/transferidos, textos consolidados, suspensões restritas, falhas, atualização periódica, concorrência, virada do ano, prioridade manual e preservação dos ajustes. Não há uso de Codex ou API de IA na importação de calendários. A rotina não muda configurações do WhatsApp, não recria agendas e não reclassifica publicações.


## Integração controlada com perícias (2.41)

Os dois serviços continuam independentes. O acompanhamento DJEN apenas consulta o controle de perícias para indicar se o mesmo processo/data/horário/local já está cadastrado e se houve comunicação pelo WhatsApp. A gravação no controle de perícias só ocorre por ação explícita do usuário.

- Perícia agendada exige data e horário; local ausente gera pendência de complementação.
- Determinação genérica de perícia sem data e horário não é agendamento.
- Mesmo processo, data, horário e local já informados: duplicidade.
- Mesmo processo com outra data ou horário: possível redesignação.
- O cliente só é vinculado automaticamente quando nome e número do processo coincidem com um contato.
- Perícias realizadas há pelo menos 60 dias, sem publicação posterior de laudo no mesmo processo, entram na fila operacional de cobrança. Essa fila não representa prazo jurídico.
- A análise diferencia somente ciência, providência sem prazo e prazo explícito atribuído ao escritório/cliente.


## Triagem processual e acompanhamento de espera (2.43)

A lista reúne publicações por processo, mas cada andamento preserva sua classificação, documento, prazo e histórico. O painel distingue ciência, providência e prazo expresso dirigido à parte autora/escritório. Prazo do perito, do INSS e ordem de aguardar não criam prazo do cliente. Sugestões continuam sujeitas à conferência humana e ao calendário do tribunal.

A área Aguardando retorno mostra somente processos cuja última publicação capturada ordenou espera e cujo período transcorreu sem nova publicação no DJEN. Na ausência de período literal, o lembrete operacional usa 30 dias por padrão, configuráveis no monitoramento; isso não comprova ausência de movimentação nos autos e não é prazo judicial. O acompanhamento de perícias sem laudo continua separado e só alerta após 60 dias.



## Detalhes e alertas — 2.52.0

- Botões de copiar o processo e o nome da parte, documentos apresentados em cartões com origem e finalidade.
- A aba Prazos separa ordens para o escritório de obrigações da parte contrária e de terceiros. O responsável é gravado no prazo e incluído no evento da agenda; prazos antigos ficam como responsável a conferir, sem inferência retroativa.
- Adicionar à agenda de prazos abre o cadastro com responsável, descrição e datas. O envio usa a agenda processual configurada, independente das perícias. Se o Google falhar, o prazo já salvo é reaproveitado na nova tentativa.
- Acompanhamentos continuam sendo lembretes operacionais, sem converter o período citado em data processual definitiva. A tela informa a cobertura de publicações e ordens reconhecidas.
- Perícias sem laudo só alertam a partir de 60 dias, com processo preenchido e sem laudo posterior identificado ou resolução manual. Audiências não geram cobrança de laudo. A tela mostra eventos futuros, realizados há menos de 60 dias e cadastros sem processo.
- A limpeza usa a data da realização e preserva perícias ativas pendentes e agendamentos futuros. Registros anteriormente apagados não são reconstruídos automaticamente; precisam ser recuperados da fonte ou de backup.


## Extração comum de providências — 2.53.0

Resumo operacional, sugestões de prazo, obrigações externas e emenda no Kanban passam a consultar a mesma extração de destinatário, comando e período literal. Formas como “regularmente intimada a promover EMENDA À INICIAL, no prazo improrrogável de 15 (quinze) dias” geram providência do escritório e candidato de 15 dias. Idade de comprovante (180 dias antes do ajuizamento), hipóteses, pedidos e simples ciência não geram esse prazo.

As ordens são separadas por destinatário. Horas, meses, data limite expressa e número/extenso divergentes ficam visíveis para conferência sem conversão automática em dias. O cálculo de vencimento continua condicionado ao calendário, regime e marco inicial. Não se presume acesso aos autos completos.

A apresentação de registros antigos é recalculada a partir do texto capturado, sem apagar JSON, revisões, prazos ou movimentos manuais. A nova versão invalida o cache para próximas análises e reavalia sugestões automáticas do quadro; não dispara reanálise paga de todo o histórico. O prompt inclui verificação de coerência entre resumo e providência. A ausência de período calculável não é apresentada como prova de inexistência de obrigação.


## Prazos vigentes, perícias sem laudo e classificação — 2.54.0

**Situação de cada ordem do escritório.** Cada ordem (prazo ou providência) é confrontada com as publicações posteriores do mesmo processo e fica **em aberto**, **prazo decorrido** (há menção a decurso, sem cumprimento identificado), **cumprida** (publicação posterior indica petição/emenda/documentos da parte autora, recebimento da emenda ou conclusão dos prazos salvos pelo usuário), **superada** (sentença, acórdão, acordo ou trânsito posterior encerram a fase) ou **revogada**. Antes, uma ordem antiga continuava sendo exibida como providência atual do processo. Agora a lista mostra apenas a providência vigente e informa quantas anteriores foram encerradas, com motivo e trecho literal nos detalhes. A análise é operacional, baseada somente no DJEN capturado; confirme nos autos. Ordens de perito, INSS, parte contrária e terceiros continuam separadas das do escritório (aba Prazos e acompanhamentos de obrigações externas).

**Perícia realizada sem laudo.** O alerta (60 dias) deixa de aparecer quando há publicação posterior com sentença (inclusive dispositivos longos com "deverá/será"), recurso ou contrarrazões, acórdão, trânsito em julgado, cumprimento de sentença/RPV, acordo homologado, laudo juntado/vista do laudo ou cancelamento/redesignação. O tipo documental e as categorias já classificadas/revisadas também contam. Os registros ocultados ficam numa lista própria ("ocultadas por andamento posterior", `GET /djen/pericias/sem-laudo/superadas`), com o motivo e a data. Registros cujo histórico do DJEN ainda não foi conferido aparecem por último, com aviso. O monitor de processo parado (obrigações da parte contrária, perito e terceiros) usa a mesma detecção para encerrar alertas de instrução após sentença, acórdão, trânsito ou acordo.

**Novas categorias.** Recurso/contrarrazões, trânsito em julgado, emenda à inicial, citação/contestação, audiência, implantação do benefício, cálculos/contadoria, vista do laudo e arquivamento. Só entram com trecho literal e atual (hipótese, pedido, advertência de cabimento e negação são ignorados). Elas são aplicadas na captura, na análise da IA (que as recebe no prompt) e, uma única vez, nas publicações já capturadas que estavam em Outros e sem revisão humana. Revisões humanas e classificações existentes não são alteradas. A classificação continua marcada como A revisar.


## Alertas do escritório e ofícios — 2.55.0

- **Prazos do escritório vencidos ou a vencer** (cartão na lista de publicações): ordens com prazo expresso dirigidas ao escritório, ainda sem cumprimento, revogação ou sentença posterior identificados. A data vem do prazo salvo na publicação ou da previsão pelo calendário conferido (indicada na tela); alerta vencidos e os que vencem em até 3 dias, além de decurso mencionado em publicação posterior. O botão **Já foi cumprido** registra a data e a observação conferidas nos autos e encerra o alerta (`PUT /djen/prazos/escritorio/:id`). Não é contagem de prazo jurídico.
- **Processos parados** (`GET /djen/processos/parados?dias=`, padrão 60): processos ativos sem publicação capturada no período. Excluem trânsito em julgado, arquivamento, extinção, RPV/precatório e perícia futura agendada. A ausência de publicação no DJEN não comprova paralisação nos autos.
- **Ofícios a terceiros**: "Oficie-se à empresa/cartório/hospital…" passa a ser acompanhado como **Resposta de terceiro (ofício)**, com o prazo literal quando houver (ou o padrão de espera). Ofício à CEAB/INSS para implantar continua sendo implantação do benefício. Resposta juntada posteriormente encerra o alerta. A tabela de acompanhamentos é recriada uma vez, preservando as linhas existentes.
- **Perícias sem laudo**: registros com histórico do DJEN pendente ou com falha têm o botão **Atualizar histórico do DJEN** (`POST /djen/pericias/:id/atualizar-historico`).
- A reanálise em massa por IA das publicações antigas continua manual e opcional, por consumir créditos do provedor.

**2.55.1.** Os cartões "Aguardando retorno" e "Perícias sem laudo" passam a mostrar o total de alertas, com a quantidade de históricos já conferidos logo abaixo (antes só contavam os conferidos e ficavam em 0 com a lista cheia). O alerta de prazos do escritório usa, quando não há calendário conferido, uma estimativa conservadora de vencimento (identificada como "estimativa"). Botões dos cartões e dos modais foram reorganizados em um rodapé de ações padronizado.


## Quadro de processos: menos cartões sem etapa — 2.56.0

- **Novas listas padrão** (criadas uma vez, sem alterar nomes ou ordem já escolhidos; uma lista existente com o mesmo nome é adotada): Aguardando juízo, Sobrestado / suspenso, Aguardando outra parte / terceiros, Providência do escritório (logo após *Sem etapa identificada*), Citação / contestação, Audiência, Conclusos para sentença, Acordo (proposta / homologação) e Trânsito em julgado.
- **Etapas processuais** vêm de atos literais e atuais (mesmo classificador complementar da lista de publicações) ou de categorias revisadas. A etapa mais adiantada comprovada prevalece. Hipótese, pedido e advertência de cabimento não movem o cartão.
- **Etapas situacionais** só entram quando nenhuma etapa processual é provada: ordem vigente do escritório (usa a mesma avaliação de cumprimento/revogação/sentença dos prazos), ordem a perito, INSS, parte contrária ou terceiro sem resposta identificada, suspensão/sobrestamento e, por fim, aguardando juízo. A evidência fica no cartão. É leitura operacional do DJEN capturado, não prova do que consta nos autos.
- Baixar um prazo do escritório, concluir um prazo salvo ou registrar cumprimento de obrigação externa pede nova leitura do cartão automaticamente. Cartões em etapa manual nunca são movidos.
- **Reclassificar** (botão no topo) reavalia todos os cartões automáticos e informa quantos foram movidos e a variação de *Sem etapa identificada*. `POST /djen/kanban/reclassificar`.
- **Mover em lote**: selecione cartões (ou todos de uma lista) e escolha a lista de destino; vira etapa manual. `POST /djen/kanban/mover-lote`.
- Filtros novos: sem etapa específica, providência do escritório, aguardando terceiros, etapa automática e com dias sem providência; chips com a contagem por lista focam uma coluna.
- O quadro é reavaliado uma vez após a atualização para aplicar as novas etapas.

**2.56.1.** No Quadro de processos, a roda do mouse rola as listas na horizontal. Dentro de uma coluna que ainda tem cartões para rolar, a roda continua rolando a coluna na vertical; ao chegar ao fim dela (ou nas pontas do quadro) a rolagem volta ao normal. Ctrl+roda (zoom) e Shift+roda não são alterados.
