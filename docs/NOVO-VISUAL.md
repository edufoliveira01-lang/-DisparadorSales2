# Novo visual (v3.0.0) — Fase 1: o casco

- **Cor principal azul** (`accent`); `violet` e `indigo` apontam para a mesma escala, então telas antigas ganham o azul sem retrabalho.
- **Cores de status** (sempre as mesmas): verde = ok, amarelo = atenção, vermelho = urgente, azul = informação.
- **Tema**: claro por padrão, com **Escuro** e **Automático** (segue o computador/navegador em tempo real). A escolha fica no menu do avatar, no topo. Chave: `disparazap:theme` (`light`, `dark` ou `system`).
- **Menu lateral**: aberto por padrão (com os nomes), seções sempre à vista; recolhe para só ícones (chave `disparazap:navigation-v3`).
- **Topo**: busca larga (Ctrl+K), botão **+ Criar** (anotação, cliente, processo, tarefa, compromisso, documentos), estado do WhatsApp e menu da pessoa (conta, configurações, aparência, modo leve, sair).
- Fases seguintes: reformular as telas uma a uma (painel, clientes, processos, agenda, financeiro, configurações).

## Fase 2 — dashboard da tela Início (v3.1.0)

- `GET /api/gestao/dashboard?mes=YYYY-MM` devolve tudo num pedido só: contratos (assinados, enviados, aguardando), processos protocolados (pela data de distribuição), clientes novos, perícias e audiências (hoje, próximos 7 dias, por tipo, quantos ainda vão ser avisados, sem telefone, aguardando resposta, avisos de hoje e falhas), tarefas, publicações e prazos do DJEN, financeiro (só para quem pode ver), documentos no Dropbox e o retrato do atendimento.
- **Atendimento**: o Deskcomm calcula e empurra o retrato (leads que chegaram em cada mês e como estão: qualificados, desqualificados, sem interesse, em andamento; e onde estão os abertos) a cada 30 minutos por `POST /api/integracao/indicadores` (canal assinado dos contratos; o painel repassa). O Sales guarda em `settings` (`atendimento_indicadores`). A conta é por coorte (leads que NASCERAM no mês) e as etapas se leem pelo nome: «Desqualificado» = desqualificado; perdido por outro motivo = sem interesse; proposta/contrato/assinado/documentos ou ganho = qualificado.
- A faixa «Precisa de atenção» junta o que é urgente (tarefas atrasadas, prazos fatais e vencidos, compromissos sem telefone, avisos que falharam, contratos parados há mais de 3 dias, problema no Dropbox, cobranças em atraso).

## Fase 3 — Captação e "Negócio" (3.2.0)
- Ficha do cliente: aba **Negócio** (fonte do lead, presencial/online, quem fechou, área, datas, qualificação com motivo).
- Tela **Captação** (`/gestao/captacao`): total anual, mês a mês, por fonte, presencial × online, por responsável, motivos, funil; aba "Preencher cadastros" (clientes antigos) e "Fontes" (fontes próprias); exportar CSV.
- Início: "Clientes qualificados" e "Desqualificados" usam a qualificação registrada pela equipe.
- Qualquer funcionário pode marcar a qualificação. Sem controle de investimento.

## Fase 4 — Clientes (3.3.0)
- Lista: avatar com iniciais (ou foto), atalho para o WhatsApp, processos em faixa e cartões no padrão novo.
- Ficha: cabeçalho com foto/avatar, tipo, documento, WhatsApp e ações; abas em pílulas; formulário em cartão.

## Fase 5 — Processos (3.5.0)
- Lista: pasta em etiqueta com ícone, linhas com realce azul ao passar o mouse, cartão único.
- Ficha: cabeçalho em cartão (ícone da pasta, número, situação, tribunal, título e ações), faixa do cliente, abas em pílulas.
- Cartões das fichas de Clientes, Processos, Financeiro e Tarefas passaram para o mesmo estilo (`surface-panel`).

## Fase 6 — Agenda (3.7.1)
- Estado vazio (Calendário, listas) legível no tema escuro; cartões restantes no padrão `surface-panel`.
- Visão geral de Perícias: título direto («Avisos do dia para conferir e enviar»).
- DataJud: nova seção em Configurações → DJEN e prazos (chave pública do CNJ).

## Financeiro (3.8.0)
- Resumo: lista **Quem está em atraso** (maiores devedores, dias de atraso) com botão **Cobrar**: copia a mensagem de cobrança pronta e abre a conversa do cliente no atendimento.
- Contas a pagar e receber: botão **Cobrar** nas parcelas atrasadas e **Exportar** (CSV com os filtros atuais).

## Tarefas (3.9.0)
- Resumo clicável (atrasadas, hoje, próximos 7 dias, prazos fatais) que filtra a lista.
- Lista agrupada por prazo (Atrasadas, Hoje, Próximos 7 dias, Mais adiante, Sem prazo) e menu ⋯ por tarefa: **Adiar 1 dia**, **Adiar 1 semana**, **Assumir**.

## Financeiro — aditamentos (3.10.0)
- **Pagamento parcial:** ao receber menos que o previsto, o diálogo pergunta o que fazer com o restante: lançar um saldo em nova parcela (data sugerida: mesmo dia do mês seguinte) ou dar por quitado (desconto).
- **Nova data de vencimento:** com motivo e, para parcelas de contrato, opção de mover as seguintes junto (por mês quando o dia é o mesmo).
- **Histórico de alterações** em cada lançamento (baixa parcial, nova data, valor, saldo criado), com quem fez.
- **Excedente (3.10.1):** ao receber a mais, o usuário escolhe em qual parcela abater e quanto (nunca automático); as duas parcelas ganham o registro no histórico.
- **Planejado:** integração com Asaas (boletos, PIX, cobrança e envio automáticos). O histórico por lançamento e o saldo/abatimento já guardam o que será conciliado.

## Publicações (3.13.1)
- Os seis contadores (na lista, não lidos, aguardando retorno, perícias sem laudo, prazos do escritório, processos parados) viraram uma **faixa no topo**, clicável; a lateral ficou só com os filtros.
- Cartões mais enxutos: **Abrir processo** e **Registrar providência** em destaque, **Concluir** e **Marcar lida** lado a lado. O aviso da IA só aparece quando há algo pendente ou pausado.

## Quadro de processos (3.14.1)
- Cartões mais compactos: a caixa de seleção fica ao lado do nome (sem a linha «Selecionar»), e a etiqueta «Etapa automática · DJEN» só aparece quando a etapa é manual ou ainda não foi identificada.
- Cada coluna ganha uma faixa colorida no topo: cinza (triagem), amarela (etapa com contagem de espera), azul (etapa movida automaticamente por categoria do DJEN).

## Acompanhamentos (3.15.0) — refeita por inteiro
- A tela virou **«Acompanhamentos»** (antes «Aguardando retorno»), com o mesmo nome do menu.
- **Painéis por tipo** no topo (juízo, laudo do perito, esclarecimentos, cálculos, INSS, outra parte, ofício): mostram quantos há e filtram ao clicar.
- **Duas seções:** «Precisa de atenção» (passou do tempo de espera ou o prazo precisa ser conferido) e «Dentro do tempo de espera». Antes era uma lista única e longa.
- **Cartões enxutos:** cliente, tipo, «há N dias · espera de M», número do processo (com copiar), quem estamos esperando, o motivo em uma linha e os prazos. Resumo, cobertura do histórico e observações ficam em **«Ver detalhes»**.
- Os avisos jurídicos (publicação antiga não é pendência confirmada, prazo expresso, conferir os autos antes de cobrar) saíram do topo para o botão **«Como funciona»**; os avisos continuam no texto de cada cartão em «Ver detalhes».
- Ordenação (mais antigos, mais recentes, cliente A–Z) e busca. Os botões (Ver processo, Cobrança feita, Já foi cumprido) funcionam como antes.
- Componente novo: `components/djen/Acompanhamentos.tsx`.

## Quadro de processos — etapas e arrastar (3.16.0)
- A «lista gigante» de etapas saiu. No lugar, o botão **Etapas (N de M no quadro)** abre um menu com busca e contagem, para focar numa etapa. **Etapas vazias ficam ocultas** por padrão (opção «Mostrar etapas vazias»); o quadro mostra só o que tem processo.
- **Arrastar etapas:** cada título tem um puxador (⋮⋮): arraste para qualquer posição, ou use as setas ←/→ com o puxador em foco. As setas de cada coluna foram removidas.
- **Arrastar cartões:** solte sobre outro cartão para colocar antes dele (reordena) ou sobre a coluna para ir ao final. Ao arrastar, aparece uma barra **«Solte em qualquer etapa»** com todas as etapas (inclusive as vazias), e o quadro rola sozinho perto das bordas.
- Reordenar um cartão dentro da mesma etapa agora só muda a posição: não vira «etapa manual» nem reinicia a contagem de espera.

## Contatos do WhatsApp (3.17.0) — refeita por inteiro
- Título igual ao do menu: **«Contatos do WhatsApp»**. Botões: **Novo contato** em destaque, Importar e Exportar ao lado.
- **Painéis clicáveis** no topo: Todos, Com processo, Sem processo e **Telefone a conferir** (número que não tem DDD + 8/9 dígitos, e portanto o aviso não chega).
- A fileira de letras A–Z saiu; a busca (nome, telefone ou processo) e a ordenação (A–Z ou mais recentes) resolvem.
- Cada contato virou uma linha limpa: avatar com iniciais, nome, telefone, processo e a observação em uma linha (antes ficava atrás de um botão «Observações»). **Abrir conversa** no atendimento (ícone verde), **Editar**, e **Apagar** dentro do menu «⋯».
- A barra de ações em lote só aparece quando há contatos marcados. No celular a linha se adapta (ícones sem texto).

## Clientes e Contatos unificados (3.18.0)
- A tela **Contatos do WhatsApp** saiu do menu (o endereço antigo `/agenda` leva para Clientes). **Clientes e processos** é a única lista de pessoas.
- Em Clientes: painéis **Todos / Com processo / Sem processo / Telefone a conferir** (clicáveis; contam dentro do tipo e da situação escolhidos), selo «conferir» na linha quando o telefone não tem DDD + 8/9 dígitos, e o botão **⋯** com **Importar contatos (CSV ou vCard)** e **Exportar contatos (CSV)**.
- **Importar contatos** agora cria CLIENTES (sem duplicar o mesmo nome e telefone). O processo que vier no arquivo fica guardado para os avisos.
- **Como os avisos continuam funcionando:** a tabela `contacts` (que os avisos de perícia, os lembretes e o casamento com o DJEN leem) virou um **espelho dos clientes**: cada cliente com telefone válido tem um contato por processo (ou um sem processo). O espelho se recalcula sozinho ao salvar cliente/processo, ao iniciar e a cada 10 minutos. Contatos antigos são **ligados** ao cliente de mesmo nome e telefone; os que não têm cliente correspondente **NÃO viram cliente sozinhos**: continuam valendo para os avisos e aparecem em Clientes → «Revisar e importar», onde a pessoa marca quais criar (3.18.1). Apagar um cliente apaga os contatos dele (o histórico de envios é preservado). Ninguém edita mais `contacts` à mão.
- Banco: colunas `contacts.pessoa_id` e `contacts.origem` (`manual` ou `espelho`). Código: `services/gestao/contatosEspelho.ts`.

## Acompanhamentos: ordens superadas (3.19.0)
- A tela é dos processos **parados à espera de alguém**. Se depois da ordem o processo **entrou em fase posterior** (RPV, precatório, levantamento de valores, cumprimento de sentença, extinção, trânsito em julgado) ou **seguiu andando por meses**, a ordem sai da lista principal e dos contadores/avisos.
- Regras (`motivoDeSuperada`, em `services/djen/externalFollowUp.ts`): (1) qualquer publicação posterior de fase posterior supera a ordem; (2) ordem com 180+ dias e publicações posteriores até pelo menos 90 dias depois dela também é superada. Ordem recente, ou com andamento só nas semanas seguintes, continua na lista.
- As superadas aparecem num bloco recolhido **«Provavelmente superados»** no fim da tela, com o motivo («O processo já entrou em fase posterior (rpv, em 16/10/2026)»), para conferência. Endpoint: `GET /api/djen/aguardando/superados`.
- Ordem já marcada como cobrada ou resolvida não muda de lugar por esta regra.

## Aguardando resposta (3.20.0) — refeita por inteiro
- **Painéis clicáveis** no topo, que substituem o menu de filtro: Aguardando resposta, **Sem resposta há 2+ dias**, Lidas sem resposta, Entregues não lidas e Ainda não entregues.
- **Duas seções:** «Sem resposta há 2 dias ou mais» (destaque âmbar) e «Esperando há pouco tempo». A ordem padrão passou a ser **mais antigos primeiro**.
- **Linha por cliente:** avatar, nome, estado da mensagem (enviada, entregue, lida), **«há 5 dia(s)»**, telefone e data do envio. Botões: **Cobrar resposta** (principal), **Já respondeu** (antes «Confirmar recebimento»: marca o atendimento como concluído) e o menu **⋯** com **Finalizar espera (sem resposta)** e **Apagar registro**.
- Busca, ordenação, filtro por período e ações em lote continuam; a barra de lote só aparece com itens marcados. Nenhuma regra do servidor mudou.

> 3.20.1 — correção: a importação antiga de contatos (`/pessoas/importar-contatos`) criava um cadastro duplicado para contatos que o espelho já tinha ligado a um cliente; agora ignora contatos já ligados. Isso fazia o teste de gestão falhar de forma intermitente no deploy da 3.19.0.

## Histórico de envios (3.21.0) — refeita por inteiro
- **Painéis clicáveis** no topo (substituem o seletor «Tipo de envio»): Envios, **Com falha**, Ainda não entregues, Entregues, Lidas, Respondidas e Remarcações.
- Saiu a **fileira A–Z** e o **seletor de modelo fixo** («Template usado somente em reenvios»): ao clicar em **Reenviar** (envios com falha), abre uma janela para escolher o modelo.
- **Uma linha por envio:** avatar, nome, estado (enviado, entregue, lido, respondido, erro), tipo (Lembrete, Reenvio, Remarcação), telefone, data e **a mensagem em uma linha** (ou o motivo do erro, em vermelho). Envios com falha ganham uma barra vermelha à esquerda.
- **Detalhes** abre os dados do agendamento e a comunicação com o cliente (como antes); **Apagar** ficou no menu «⋯».
- Busca (nome, telefone, processo, mensagem), ordenação, período e ações em lote continuam; nenhuma regra do servidor mudou.

## Acompanhamentos: honorários periciais e perícia que já andou (3.21.1)
- **Rótulo certo:** ordens sobre antecipação de honorários periciais deixam de aparecer como «Manifestação da outra parte» e ganham o painel/etiqueta **«Honorários periciais (antecipação)»** (campo `assunto` da ordem; o tipo interno continua `parte_contraria`, sem mudar o banco).
- **Cumprimento por consequência:** se depois da ordem o perito apresentou laudo ou esclarecimentos (ou há comprovante de depósito/pagamento dos honorários), a ordem de honorários sai da lista (a perícia só anda com os honorários tratados).
- **Perícia concluída supera a fase anterior:** ordens de manifestação/contestação/réplica anteriores ao laudo vão para «Provavelmente superados» (motivo: «A perícia já andou…»). Ordens que já são sobre o laudo, esclarecimentos, cálculos ou recurso não são superadas por isso.
- **Limites da regra de tempo** mais curtos: ordem com **120+ dias** e publicações posteriores até **60+ dias** depois dela passam para «Provavelmente superados» (antes 180 e 90).

## Perícias e compromissos (3.22.0) — refeita por inteiro
- **Novo título e descrição** (antes «Visão geral»); saíram o banner azul e o bloco de apresentação que ocupavam o topo.
- **Painéis clicáveis que filtram de verdade:** Todos os avisos, Para enviar, Enviados, Com falha e Aguardando retorno (abre a tela de pendências).
- **Barra compacta:** busca, tipo, modelo, «Marcar todos os exibidos» e «Enviar selecionados».
- **Cartões compactos (metade da altura):** avatar, nome, selos de estado (contato, aviso enviado/falha, modo audiência, revisar dados), processo e telefone, uma linha por perícia com lápis de edição, último aviso; botões «Revisar e avisar», «Editar/Cadastrar contato» e «Ver detalhes».
- A coluna «No seu radar» (Hoje / Próxima data / Depois) foi mantida. Nenhuma regra do servidor mudou.

## Calendário (3.23.0) — refeito por inteiro
- **Nova visão «Lista» (padrão):** compromissos de hoje em diante agrupados por dia (Hoje destacado), com «Mostrar mais dias». «Semana» e «Mês» continuam disponíveis para ver datas passadas.
- **Painéis clicáveis** (Próximos compromissos, Perícias médicas, Perícias sociais, Audiências) filtram a lista; saiu o resumo escondido em «Ver resumo por tipo».
- **Barra única** com visão, navegação (semana/mês), busca em todos os meses, tipo e «Mostrar substituídas».
- Enviar lembrete, editar e apagar continuam em cada linha; nenhuma regra do servidor mudou.

## Configurações (3.24.0) — nova organização
- **Menu lateral fixo** com todos os assuntos, em vez das abas e botões no topo; no celular vira um seletor «Ir para».
- **Grupos reorganizados:** Escritório e acesso · Documentos e fichas · Comunicação com clientes (WhatsApp, Envio pelo Deskcomm, Modelos de mensagens, Notificações, Intervalo, Atendimento com IA) · Cobrança (Cobranças e avisos, Asaas) · Processos e prazos (Advogados, DJEN, DataJud, Calendários, Prazos) · Integrações (Trello, Google, Dropbox, IA) · Sistema (Backup, Atividade). Antes, Deskcomm/Asaas/cobrança estavam em «DJEN e prazos».
- **Visão geral** com busca («boleto», «WhatsApp», «prazos»…) e descrição de cada grupo.
- **Título certo em cada página** (antes todas as integrações mostravam «Conexões e sistema»); «Sair do sistema» fica em Dados de acesso e Minha conta.
- **Minha conta** e **Equipe e acessos** saíram do visual roxo antigo para o padrão atual.
- Nenhuma configuração mudou de lugar no servidor; os endereços antigos continuam funcionando.

## Sub-páginas de Configurações (3.25.0) — todas no mesmo padrão
Peças comuns em `components/ui/Settings.tsx` (cartão com situação, blocos, campos com dica, rodapé de ações, avisos). Cada tela mostra a **situação no topo**, o essencial primeiro, o avançado recolhido e o resultado de testes em aviso colorido.
- **Cobrança:** Asaas (passos: chave → aviso de pagamento), Envio pelo Deskcomm (passos: gerar token → colar), Cobranças e avisos (Mensagens · Como enviar · Avisos automáticos, um só Salvar), DataJud.
- **Conexões:** WhatsApp (situação grande, QR em destaque, motor em «Opções avançadas»), Notificações (Telegram e Whapi separados, cada um com Testar), Trello (4 passos), Intervalo, Backup (baixar / restaurar com confirmação), Aparência, Dados de acesso.
- **Integrações:** Inteligência artificial (3 passos), Google Agenda (sincronização + destinos em acordeão), Dropbox (2 passos + onde salvar), Prazos e agenda processual (3 cartões, calendário manual agrupado por tribunal com busca).
- **Escritório e documentos:** Dados do escritório (cartões por assunto, barra «alterações não salvas»; enviar imagem não descarta o que foi digitado), Documentos (lista à esquerda, abas comum/a rogo/representado, prévia), Atendimento com IA, Ficha de cadastro (prévia fixa).
- **Modelos de mensagens:** abas por categoria, cartões com «Padrão», variáveis clicáveis e prévia em balão de WhatsApp.
- **DJEN:** Monitoramento (cartão de situação, avançado recolhido, histórico recolhido), Advogados (uma linha por advogado, ⋯ com Editar/Consultar/Pausar) e Calendários de prazos (órgãos recolhíveis com situação).
- Mudança de comportamento: as seções de WhatsApp/Notificações/Trello/etc. carregam seus dados ao abrir e **não guardam texto digitado** ao trocar de aba sem salvar.

## Fechamento das Configurações (3.25.1)
- **Calendários de prazos:** o interior de cada órgão também foi refeito (erros em avisos, localidade recolhida que abre sozinha quando pendente, datas em lista compacta com selo do tipo e ações na linha, adicionar data em uma linha, histórico recolhido, regras de cálculo em aviso recolhível).
- **Advogados acompanhados:** novo «Remover advogado» no menu ⋯ (com confirmação). Se já existirem publicações dele, a remoção é recusada e o sistema orienta a pausar, para não perder histórico. Novo `DELETE /djen/advogados/:id` com teste.
- **Cartões de imagem** (cabeçalho, rodapé, ícone, logotipo da ficha) no padrão novo, com selo «Enviada / Sem imagem».
- **Modelos de mensagens:** «Descartar alterações?» e «Excluir modelo?» agora usam a janela do sistema (`useConfirmar`), no lugar da janela do navegador.
- Removidos três arquivos de modelos que nenhuma tela usava.

## WhatsApp único com o Deskcomm — fase 1 (3.26.0)
- **Escolha do número:** em «Envio pelo Deskcomm» (passo 3) o Sales lista os celulares conectados no Deskcomm (nome, telefone, Conectado/Desconectado/Pausado). A conexão por QR Code continua só no Deskcomm; no Sales escolhe-se **qual número envia**: um **padrão** (ou «Automático», o primeiro conectado) e, opcionalmente, **outro número só para cobranças**.
- Se o número escolhido estiver desconectado, o envio falha com aviso claro. **Não há troca silenciosa de número.** Conversas que já existem continuam no número em que começaram.
- Exige o Deskcomm atualizado (listar números por token) e um token com **leitura (`mcp:read`) e escrita (`mcp:write`)**.
- Próximas fases: (2) avisos de perícia/audiência, lembretes e DJEN passam a sair pelo Deskcomm; (3) respostas e confirmações de leitura chegam do Deskcomm ao Sales (Aguardando resposta e Histórico) e a conexão própria do Sales é desligada.

## WhatsApp único com o Deskcomm — fases 2 e 3 (3.27.0)
- **Um interruptor:** em «Envio pelo Deskcomm» → passo 4, «Usar o WhatsApp do Deskcomm para tudo». Ligado, **avisos de perícia/audiência, lembretes, reenvios, mensagens do DJEN, cobranças e «cobrar resposta»** saem todos pelo WhatsApp do Deskcomm, no número escolhido (padrão, ou um número por finalidade: cobranças, avisos, DJEN).
- **Respostas e leitura voltam sozinhas:** a cada minuto o Sales confere as conversas das mensagens que enviou e atualiza ✓✓ entregue / lido e a **resposta do cliente** (resolve «Aguardando resposta» e move o cartão do Trello, como antes). Exige o Deskcomm atualizado (histórico de mensagens por token) e o token com `mcp:read` + `mcp:write`.
- **Barra do topo e tela de WhatsApp** passam a mostrar a situação dos números do Deskcomm; a tela de WhatsApp lista os números e leva para as escolhas (a conexão por QR Code fica só no Deskcomm).
- **Reversível:** o botão «Voltar ao WhatsApp deste sistema» desfaz. Com o Deskcomm ligado, o servidor **não restaura** a conexão própria ao iniciar.
- Limites conhecidos: o telefone não é validado antes (o Deskcomm abre a conversa pelo número); com o WhatsApp do Deskcomm, ✓✓ e respostas dependem da conferência por minuto, não de evento instantâneo; reações (emoji) não resolvem a espera.

## Correções após o primeiro teste do WhatsApp único (3.27.2)
- **Número em uso à vista:** com o Deskcomm ligado, a barra do topo mostra «WhatsApp conectado · (13) 99711-5721» (o número escolhido, ou o primeiro conectado). Telefones das listas aparecem formatados.
- **Menu ⋯ cortado:** o menu de ações (Histórico de envios, Aguardando resposta, Advogados acompanhados, Tarefas…) agora abre por cima da página, alinhado ao botão, e abre para cima quando falta espaço. Antes ficava escondido dentro de listas com cantos arredondados.
