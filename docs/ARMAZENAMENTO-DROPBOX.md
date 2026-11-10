# Armazenamento externo — Dropbox (documentos dos clientes)

Os documentos dos clientes são copiados para o Dropbox **do próprio escritório**, em `CLIENTES / NOME DO CLIENTE / TIPO /`.
O código nasce independente de provedor (`server/src/armazenamento/`): Dropbox agora; Google Drive e OneDrive entram depois só com um provedor novo.

## O que acontece
- **Documentos assinados (ZapSign):** continuam guardados no Sales; ao assinar, entra na fila uma cópia para `CLIENTES/NOME/CONTRATOS E PROCURAÇÕES`. A fila roda em segundo plano (1 vez por minuto), com nova tentativa (2, 4, 8… até 2 h; 6 tentativas) e **nunca atrasa a assinatura**.
- **Nome do arquivo:** `AAAA-MM-DD - Título.ext` (data de Brasília; ordena por data no Dropbox e nunca sobrescreve).
- **Pasta do cliente:** nome do cadastro em MAIÚSCULAS e com acento. Se já existir pasta com o mesmo nome (ignorando caixa, acento e pontuação), ela é usada. Se existir uma **parecida** (ex.: «DA» no lugar de «DE»), o documento **espera** e a equipe escolhe em Configurações › Dropbox. Nada parecido: a pasta é criada.
- O vínculo cliente → pasta é gravado pelo **identificador da pasta no Dropbox** (sobrevive a renomeação).
- **Trava de segurança:** o app tem acesso à conta inteira (o Dropbox não restringe a uma pasta só), então o código só grava dentro da pasta dos clientes configurada (padrão `/CLIENTES/`) e recusa qualquer outro caminho.

## Tipos de pasta
PARTE MÉDICA · DOCUMENTOS PESSOAIS · DOCUMENTOS ADMINISTRATIVO · CONTRATOS E PROCURAÇÕES · A CLASSIFICAR

## Como conectar (uma vez por escritório)
1. Em dropbox.com/developers/apps: **Create app › Scoped access › Full Dropbox**.
2. Aba **Permissions**: `files.metadata.read`, `files.metadata.write`, `files.content.read`, `files.content.write` › Submit.
3. Aba **Settings › OAuth 2 › Redirect URIs**: cadastre o endereço mostrado em Configurações › Dropbox (`https://<endereço do Sales>/api/dropbox/retorno`).
4. No Sales: Configurações › **Dropbox** › informe a App key e a App secret › **Salvar dados do app** › **Conectar ao Dropbox** (autorize na janela do Dropbox).
5. (Uma vez) **Vincular pastas que já existem**: confirme os pares sugeridos entre clientes e pastas.

A App secret e o acesso ficam guardados **criptografados** (AES-256-GCM, `ENCRYPTION_KEY` do servidor) e nunca voltam para a tela. Variável opcional: `DROPBOX_REDIRECT_URI` (força o endereço de retorno atrás de proxy).

## Permissão
Tudo em `/api/armazenamento` e `/api/dropbox` exige `integrations.manage` (a mesma das demais integrações). O card **Dropbox** fica em Configurações › Conexões e avisos.

## Onde salvar (configurável por escritório)

Em **Configurações › Dropbox › Onde salvar os documentos** cada escritório define a **pasta dos clientes** (ex.: `/CLIENTES` ou `/ESCRITÓRIO/CLIENTES`, até 3 níveis) e o **nome de cada subpasta de tipo**. Fica no banco do escritório (`armazenamento_config.pasta_raiz` e `nomes_dos_tipos`). Valem para os próximos documentos; o que já foi enviado não é movido. Trocar a pasta dos clientes desfaz os vínculos cliente → pasta (o sistema procura de novo pelo nome na pasta nova).
