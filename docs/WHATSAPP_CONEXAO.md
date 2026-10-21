# Conexão do WhatsApp — correção 2.39.1

O telefone pode aceitar o vínculo antes de a biblioteca terminar a sincronização. A aplicação distingue esses momentos:

- **Aguardando escaneamento:** existe um QR atual; o vínculo ainda não foi confirmado.
- **Validando vínculo:** o socket passou para `PAIRING` após a apresentação do QR. A imagem sai da tela, enquanto a autorização ainda está sendo validada. Essa fase também tem limite de três minutos.
- **Sincronizando:** a biblioteca confirmou a autenticação ou `Client.getState()` retornou `CONNECTED`. O QR é retirado, mas o envio continua bloqueado.
- **Conectado:** o evento `ready` confirmou a inicialização da biblioteca. Consultas/envios passam a ser permitidos e o marcador de sessão é persistido.

A geração assíncrona de imagens do QR tem controle de sequência: uma imagem antiga não substitui um QR renovado nem desfaz a confirmação de autenticação/conexão. Eventos de uma tentativa encerrada também não podem reativá-la.

Durante o pareamento, uma leitura do estado real a cada dois segundos cobre a falta/atraso do evento `authenticated`. As leituras não se sobrepõem e têm limite de oito segundos. Três falhas consecutivas após a fase inicial entram no fluxo de recuperação. Uma navegação transitória isolada não derruba a tentativa. Progresso de carregamento ou o estado `PAIRING`, sozinhos, não são considerados confirmação do vínculo.

A sincronização tem limite de três minutos a partir da primeira confirmação do vínculo; eventos repetidos não renovam esse limite. O fluxo existente de reconexão faz até seis novas tentativas, com intervalo crescente, preservando o profile do LocalAuth nas falhas transitórias. A mensagem descreve a retomada da sessão, sem afirmar que um novo QR será obrigatório. Depois do limite, a falha aparece na interface. A coleta de diagnóstico de uma desconexão também tem tempo limitado.

**Parar** cancela a inicialização, as sondagens e o limite de sincronização, preservando a sessão. **Desconectar** continua sendo a ação explícita de logout/troca de sessão. Uma falha genuína de autenticação/logout mantém o tratamento anterior de invalidação. Novos eventos `ready` da mesma instância continuam reconciliando as respostas pendentes, como antes.

Após atualizar, abra **Configurações → WhatsApp** e use **Conectar WhatsApp**; se houver uma tentativa aberta, use **Parar** antes. A sessão existente será reutilizada quando válida. Não é preciso apagar diretórios de autenticação para aplicar esta correção.

Foram adicionados 14 testes de eventos atrasados, ordenação de QRs, confirmação antecipada, repetição de eventos, cancelamento e recuperação. A interface é validada com API/gerenciador locais reais e o cliente WhatsApp simulado. O pareamento real com o telefone do escritório precisa ser conferido na hospedagem após a atualização. Esta versão não altera a dependência ou a seleção da versão do WhatsApp Web, os calendários, o classificador ou as regras de envio.

Referência do contrato da biblioteca: [Client — whatsapp-web.js](https://docs.wwebjs.dev/Client.html).
