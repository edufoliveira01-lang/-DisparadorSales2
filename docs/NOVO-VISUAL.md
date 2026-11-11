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
