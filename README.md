# Disparador de Perícias — WhatsApp + Trello

Aplicação web local para automatizar o envio de mensagens de WhatsApp para clientes com perícias
agendadas, buscando os dados diretamente de cards do Trello.

O sistema lê os cards de uma lista do Trello, extrai da descrição os dados de cada perícia (uma ou
duas por card), cruza o nome do cliente com uma agenda de contatos local, monta a mensagem a partir
de um template personalizável e dispara pelo WhatsApp — com intervalo aleatório entre os envios e
histórico completo de sucesso/falha.

## Stack

- **Backend:** Node.js + Express + WebSocket (Socket.io), SQLite (`better-sqlite3`), integração
  oficial com a API do Trello e integração com o WhatsApp via `whatsapp-web.js` (QR Code, sessão
  persistida em disco).
- **Frontend:** React + Vite + TailwindCSS, consumindo a API do backend em `localhost`.

## Estrutura

```
/server   -> API REST + WebSocket + banco SQLite
/client   -> interface web (Dashboard, Agenda, Templates, Histórico, Configurações)
```

## Instalação

Requisitos: **Node.js 18+**.

```bash
# 1. Backend
cd server
cp .env.example .env
npm install
npm run dev        # http://localhost:3333

# 2. Frontend (em outro terminal)
cd client
npm install
npm run dev         # http://localhost:5173
```

Abra `http://localhost:5173` no navegador. O banco SQLite e a sessão do WhatsApp são criados
automaticamente em `server/data/` na primeira execução.

> O pacote `whatsapp-web.js` usa Puppeteer, que baixa um Chromium próprio na primeira instalação
> (pode levar alguns minutos). Em servidores Linux sem interface gráfica, pode ser necessário
> instalar dependências do sistema do Chromium (ex: `libnss3`, `libatk1.0-0`, etc.) — veja a
> documentação do Puppeteer caso o `npm install` ou a conexão falhem.

## Testes automatizados

```bash
cd server
npm test
```

Cobre o parser de descrição do card (1 e 2 perícias, campos fora de ordem, campos faltando,
variações de acentuação), o motor de templates (Handlebars) e o matching de contatos.

## Configuração inicial

### 1. Trello — API Key e Token

1. Acesse `trello.com/app-key` logado na sua conta Trello para obter a **API Key**.
2. Na mesma página, gere um **Token** (permissão de leitura é suficiente).
3. Na tela **Configurações** do sistema, cole a API Key e o Token e clique em **Validar
   credenciais**.
4. Selecione o **Board** e a **Lista** que contém os cards das perícias, e salve.

### 2. Formato esperado do card no Trello

A descrição do card deve conter um ou dois blocos, identificados pelos cabeçalhos `PERÍCIA
MÉDICA:` e/ou `PERÍCIA SOCIAL:`, cada um com os campos `TIPO DE PERÍCIA`, `DATA`, `HORÁRIO`,
`LOCAL` e `NOME`:

```
PERÍCIA MÉDICA:
TIPO DE PERÍCIA: Psiquiátrica
DATA: 15/07/2026
HORÁRIO: 14:30
LOCAL: Rua Exemplo, 123 - Centro
NOME: Maria da Silva

PERÍCIA SOCIAL:
TIPO DE PERÍCIA: Assistente Social
DATA: 16/07/2026
HORÁRIO: 09:00
LOCAL: Fórum Central, sala 4
NOME: Maria da Silva
```

Se não houver nenhum dos dois cabeçalhos, mas os 5 campos existirem soltos na descrição, o card é
tratado como tendo **1 perícia genérica**. O parser é tolerante a maiúsculas/minúsculas, acentos
opcionais (ex: `HORARIO` sem acento), `:` opcional e ordem dos campos.

### 3. Agenda de contatos

Na tela **Agenda**, cadastre os clientes com nome e telefone no formato internacional
(`55DDDNÚMERO`, ex: `5511999999999`). O sistema cruza automaticamente o campo `NOME` do card com a
agenda (match exato ou aproximado); quando não encontra um contato, o Dashboard permite cadastrá-lo
sem sair da tela.

### 4. Templates de mensagem

Na tela **Templates**, edite o texto usando as variáveis `{{NOME}}`, `{{TIPO_PERICIA}}`,
`{{DATA}}`, `{{HORARIO}}` e `{{LOCAL}}`. Para cards com 2 perícias, escolha entre enviar **1
mensagem combinada** (usando o bloco `{{#each PERICIAS}}...{{/each}}`) ou **2 mensagens
separadas**.

### 5. Conectar o WhatsApp

Na tela **Configurações**, clique em **Conectar WhatsApp** e escaneie o QR Code exibido com o
celular (WhatsApp → Aparelhos conectados → Conectar um aparelho). A sessão fica salva em
`server/data/wwebjs_auth`, então não é necessário escanear novamente a cada reinício do servidor —
apenas ao clicar em "Desconectar / trocar de sessão".

### 6. Enviar mensagens

No **Dashboard**, atualize a lista de cards, selecione um ou vários e clique em **Enviar**. Antes de
confirmar, uma prévia da mensagem final é exibida. Em envios em lote, o sistema aguarda um
intervalo aleatório (configurável em Configurações) entre cada mensagem para reduzir o risco de
bloqueio da conta. Todo envio é registrado na tela **Histórico**, com opção de reenvio em caso de
falha.

## Variáveis de ambiente (`server/.env`)

| Variável          | Descrição                                                              |
| ----------------- | ----------------------------------------------------------------------- |
| `PORT`            | Porta do servidor backend (padrão `3333`)                              |
| `ENCRYPTION_KEY`  | Chave usada para cifrar o Token do Trello salvo no banco                |
| `DATA_DIR`        | Diretório onde o SQLite e a sessão do WhatsApp são persistidos          |

## Notas

- Aplicação 100% local — nenhum dado sobe para servidores externos além das chamadas às APIs
  oficiais do Trello e do WhatsApp (via `whatsapp-web.js`, que se conecta diretamente aos
  servidores do WhatsApp).
- Se o Trello retornar erro de autenticação, a tela de Configurações exibe o motivo. Se o WhatsApp
  desconectar durante um envio em lote, o envio é pausado e o usuário é notificado.
