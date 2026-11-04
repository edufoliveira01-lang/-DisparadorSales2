# Motores de conexão do WhatsApp

O sistema tem dois motores. A escolha fica em **Configurações → WhatsApp → Motor de conexão**.

| | Motor atual (whatsapp-web.js) | Motor novo (Baileys) |
|---|---|---|
| Como conecta | Abre um Chromium e carrega o WhatsApp Web | Fala direto com o WhatsApp (sem navegador) |
| QR Code | ~20–30 s | poucos segundos |
| Memória | alta (Chromium) | baixa |
| Padrão | **sim** | não (opt-in) |

## Como testar o motor novo
1. Configurações → WhatsApp → **Motor novo (Baileys)** → confirmar.
2. Clique em **Conectar**, leia o QR Code (WhatsApp → Aparelhos conectados).
3. Envie uma mensagem de teste e confira entrega (✓✓) e a detecção de resposta.

## Voltar
Escolha **Motor atual** no mesmo lugar. Cada motor guarda a própria sessão
(`wwebjs_auth/` e `baileys_auth/` na pasta de dados), então voltar retoma a sessão antiga sem novo QR.

## O que continua igual
Disparos em lote, lembretes, respostas pendentes, confirmação de entrega/leitura e reações usam
a mesma camada (`whatsappService.ts`); o Baileys é adaptado em `whatsappBaileys.ts` para emitir os
mesmos eventos. Como o Baileys não consulta histórico de conversas, as mensagens trocadas são
guardadas na tabela `wa_baileys_mensagens` (retenção de 30 dias).
