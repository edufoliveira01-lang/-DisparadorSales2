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
