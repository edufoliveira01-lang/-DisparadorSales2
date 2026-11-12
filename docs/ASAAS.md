# Asaas — boleto, PIX e taxas

## Ligar
1. No Asaas (comece pelo **sandbox**): *Integrações → Chave de API* → copie a chave (`$aact_...`).
2. No sistema: **Configurações → Asaas (boleto e PIX)** → escolha o ambiente, cole a chave, **Salvar** e **Testar**.
3. Ainda na mesma tela, copie a **URL do webhook** e o **token**. No Asaas: *Integrações → Webhooks → Novo webhook*: cole a URL e o token, tipo de envio **sequencial**, eventos de **cobranças** ligados. Sem o webhook o sistema funciona, mas a baixa é manual (botão *Atualizar situação*).

## Uso
- **Financeiro → Contas a pagar e receber → Boleto/PIX** (parcelas em aberto, com cliente que tenha CPF/CNPJ): gera a cobrança, mostra link, PIX copia e cola e linha digitável, e **Enviar pelo WhatsApp** abre a conversa do cliente com o texto pronto.
- O Asaas não aceita vencimento no passado: para parcela atrasada, use **Nova data** antes de gerar.
- Mudou data/valor de uma parcela com cobrança aberta? O sistema atualiza no Asaas. Cancelou a parcela? A cobrança é cancelada.
- Pagou? O aviso do Asaas dá **baixa automática** (forma PIX/Boleto, valor e data pagos) e guarda a tarifa.

## Taxas
**Financeiro → Taxas do Asaas**: total do mês, % do recebido, custo por cobrança, por tipo de tarifa (cobrança, notificações, transferência…), por forma de pagamento, mês a mês e linha a linha. *Atualizar do Asaas* traz o extrato; sem ele, a tela usa a diferença entre o valor cobrado e o líquido de cada cobrança paga.

## Segurança
A chave e o token do webhook ficam criptografados no banco. O painel só repassa o aviso à instância do escritório assinando com a chave dele; a instância confere o token do Asaas. As notificações do próprio Asaas ao cliente ficam desligadas (cada uma é cobrada).

## Cobrança pelo WhatsApp, lote e régua automática (3.12.0)

- **Enviar pelo WhatsApp envia de verdade, pelo Deskcomm.** O Sales usa a API do Deskcomm (`/api/v1/conversations/open-with-contact` + `/api/v1/messages`, com token `dsk_` de escrita) para abrir a conversa do telefone e enviar o texto, com link/PIX/linha digitável quando houver cobrança. A mensagem fica no histórico da conversa e a resposta do cliente cai no atendimento. Ligue em **Configurações → Envio pelo Deskcomm** (cole o token gerado em Deskcomm → Configurações → Tokens de API, com permissão `mcp:write`). Sem o token nada é enviado. Não é preciso atualizar o Deskcomm. «Abrir conversa» continua como opção.
- **Na ficha do cliente (aba Financeiro):** por parcela, *Gerar boleto/PIX*, *Cobrar/Avisar*, *Nova data* e *Receber*; faixa com *Cobrar atrasadas*, *Avisar todas em aberto* e *Pausar avisos* (o cliente deixa de receber avisos automáticos).
- **Em lote:** em Financeiro → Contas a pagar e receber, marque as parcelas (ou «Selecionar todas desta página») e use *Enviar aviso pelo WhatsApp*. Também vale para «Quem está em atraso → Cobrar». Há intervalo entre as mensagens (mesmo ritmo dos demais envios: Configurações → intervalos de envio).
- **Cobrança automática** (Financeiro → aba *Cobrança automática*): liga/desliga, dias antes/depois do vencimento, aviso no dia, horário, e se gera boleto/PIX antes de avisar (parcelas ainda não vencidas). Cada parcela recebe cada aviso uma vez; falhas são repetidas até 3 vezes; não envia sem o token do Deskcomm nem para clientes pausados. O histórico mostra o que foi enviado e o motivo das falhas. O agendador confere a cada 5 minutos.
- Tabelas: `gestao_avisos_cobranca`, `gestao_cobranca_pausa`.

### Configurações de cobrança e PIX (3.12.3)
- **Tudo se configura em Configurações → Cobranças e avisos**; os botões (Cobrar, Avisar, Enviar aviso, lote e régua) só executam. Lá ficam: se vai boleto/PIX junto (e qual), **formato de envio** (*separado*: texto com o link e PIX/linha digitável em mensagens próprias; *tudo junto*: uma mensagem), os **textos** dos avisos (antes, no dia e depois do vencimento, com as variáveis `{nome}`, `{descricao}`, `{valor}`, `{vencimento}`, `{quando}`, `{link}`) e os **avisos automáticos** (dias, horário, liga/desliga).
- **PIX sem espaços:** o código copia e cola traz o nome e a cidade do recebedor com espaços e os apps de mensagem o quebravam. O Sales remove os espaços desses dois campos, refaz tamanhos e CRC (o código continua válido) e envia o PIX sozinho.

### Boleto em PDF (3.13.0)
- O boleto é baixado do Asaas em PDF (só endereços do próprio Asaas e só se o arquivo for mesmo um PDF), guardado em **Arquivos do cliente** (categoria *Financeiro*) e copiado para **`/CLIENTES/<cliente>/BOLETOS E COBRANÇAS`** no Dropbox (fila já existente; sem Dropbox conectado, fica só no cadastro). Acontece ao gerar a cobrança e ao enviar um aviso.
- O PDF segue **como arquivo na conversa** (Deskcomm: `POST /api/v1/conversations/<id>/media` + `POST /api/v1/messages` tipo `document`), logo após o texto e antes do PIX/linha digitável. Ambas as opções ficam em Configurações → Cobranças e avisos.
- No **Deskcomm** (build novo), o upload aceita o campo opcional `nome_arquivo`: o cliente vê «Boleto-Maria-Parcela-1-3.pdf» em vez de um nome gerado. Sem atualizar o Deskcomm, o PDF vai do mesmo jeito, só com o nome gerado.
