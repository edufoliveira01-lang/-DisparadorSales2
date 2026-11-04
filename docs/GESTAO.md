# Gestão do escritório

Área ao lado de "Perícias e avisos" e "Processos e DJEN". Nada do que já existia foi alterado: a gestão só **acrescenta** tabelas (`gestao_*`), rotas (`/api/gestao/*`) e telas.

## Menu único e modelo da ficha (2.67.0)

- **Menu único:** a barra lateral reúne tudo, em grupos que abrem e fecham: **Gestão do escritório**, **Processos e DJEN**, **Perícias e avisos**, **Contatos** e **Preferências**. O grupo da página atual abre sozinho e a escolha de cada grupo fica guardada. Não há mais troca de "área". Ao entrar, quem tem acesso à Gestão cai no **Meu painel**; a visão geral das perícias fica em `/pericias`.
- **Ficha de cadastro (menu Gestão):** monta o visual da ficha impressa: título, subtítulo, nome do escritório, até 3 linhas de cabeçalho (endereço, telefone, OAB), **logotipo**, quadro da foto, quais seções saem (identificação, endereço, contato, campos personalizados, processos, observações), linhas em branco para anotar à mão, **campo de assinatura** com texto (declaração, aviso de privacidade) e rodapé, com pré-visualização ao lado. Os campos personalizados são criados no botão "Criar e organizar campos".
- **Foto do cliente:** no cadastro, "Colocar foto" (PNG, JPG ou WebP, até 2 MB); ela sai no quadro 3x4 da ficha. O logotipo aceita até 1 MB.
- **Editar livremente:** em "Imprimir ficha" há **Baixar para editar (Word)**, que gera um arquivo `.doc` com a ficha.
- Fotos e logotipo ficam em `DATA_DIR/ficha` (inclua na cópia do servidor, junto de `DATA_DIR/arquivos`).

## Cadastro unificado (2.66.0)

**Clientes e processos** é uma tela só, com duas visões do mesmo cadastro ("Por cliente" e "Por processo") e uma busca única: acha pelo nome, CPF/CNPJ, telefone, número do processo, pasta ou título. Cada cliente aparece com os processos logo abaixo.

A **ficha do cliente** (página inteira) reúne tudo:

- **Dados:** identificação, contato e endereço. Ao digitar o **CEP**, rua, bairro, cidade e UF são preenchidos sozinhos (consulta ViaCEP, com BrasilAPI de reserva; se a internet falhar, preenche-se à mão).
- **Campos personalizados:** o escritório cria os campos que quiser (texto, número, valor, data, sim/não, lista, link, telefone, e-mail ou **senha**), com grupo e se saem na ficha impressa. Senhas ficam **criptografadas** (AES-256-GCM com a `ENCRYPTION_KEY` do escritório), nunca aparecem na leitura comum e só são mostradas por pedido explícito, que fica no registro de auditoria. Há um botão que adiciona de uma vez os campos da ficha previdenciária (serviço, indicação, seguridade até, última contribuição, vínculo, CNPJ, UDT, Meu INSS).
- **Processos:** os do cliente, com "Novo processo" já vinculado a ele (e cadastro rápido do cliente dentro de "Novo processo").
- **Financeiro:** contratado, recebido, em aberto e em atraso; contratos e parcelas do cliente, com receber, pagar e estornar na própria ficha (exige permissão financeira).
- **Documentos:** arquivos do cliente e geração de procuração, declaração e contrato a partir dos modelos.
- **Perícias e prazos:** perícias/audiências do cliente (pelos processos ou pelo telefone) e tarefas em aberto.

**Imprimir ficha:** botão na ficha (e logo após cadastrar). Abre em nova aba uma ficha A4 com quadros e faixas de seção, no estilo de formulário: identificação (nome, nascimento, RG, CPF, escolaridade, estado civil, PIS/NIT, profissão, mãe, filiação), endereço, contato, grupos dos campos personalizados, processos vinculados e linhas para observações. As senhas saem ocultas; "Com senhas" exige permissão de edição e fica registrado.

A **ficha do processo** ganhou o cliente em destaque (com atalho para o financeiro dele), a aba **Andamento e perícias** (etapa no quadro, últimas publicações do DJEN, prazos abertos e perícias, com atalhos para as telas de origem) e campos personalizados próprios. O **Meu painel** traz publicações não lidas, prazos do escritório vencendo e perícias dos próximos 7 dias. As telas de Perícias e avisos e de Processos e DJEN continuam como sempre.

## O que existe (2.65.0)

| Tela | O que faz |
| --- | --- |
| **Meu painel** | Tarefas atribuídas e concluídas na semana, atrasadas, prazos fatais (5 dias), lista de hoje e dos próximos 7 dias, tarefas com mais atrasos no escritório. |
| **Tarefas** | Responsável, prazo, prazo fatal, prioridade e vínculo ao processo. Os prazos do DJEN dos processos com ficha entram sozinhos como tarefas; concluir de um lado conclui do outro. |
| **Pessoas** | Clientes, partes contrárias, testemunhas e peritos: CPF/CNPJ validados, contatos, endereço, origem, documentos do cliente. |
| **Processos e pastas** | Número CNJ validado, tribunal pelo número, pasta automática (`AAAA/0001`), responsável, área, valor da causa, partes, histórico (DJEN, perícias, anotações), tarefas e arquivos. |
| **Modelos de documento** | Procuração, declaração de hipossuficiência e contrato (textos-base para revisar). Dados do cliente e do processo entram sozinhos; baixa em Word, imprime ou salva na pasta. Modelos próprios com variáveis `{{cliente.nome}}` etc. |
| **Financeiro** | Contratos de honorários (parcelas viram contas a receber), contas a pagar e receber, baixa/estorno, custas reembolsáveis, comissões e repasses, resumo mensal e fluxo de caixa. Controle interno (sem cobrança automática por boleto/PIX). |
| **Indicadores** | Produtividade por pessoa, estoque de processos (situação, área, responsável, tribunal, sem movimentação há 60 dias), captação de clientes (por mês e origem) e receita por área/responsável. |

## Arquivos

Ficam no servidor, em `DATA_DIR/arquivos` de cada escritório (isolados por escritório). Limite de 25 MB por arquivo; tipos permitidos: PDF, Word, Excel, OpenDocument, imagens, áudio, vídeo, texto, CSV e ZIP (nada executável nem HTML/SVG). Mesmo nome na mesma pasta = nova versão. O download sempre é "anexo" (o PDF e as imagens podem ser vistos no navegador em modo isolado).

**Backup:** o backup do sistema (Configurações) copia o banco de dados. Para copiar também os arquivos, inclua a pasta `DATA_DIR/arquivos` (por exemplo, `/srv/disparazap/<escritorio>/data/arquivos`) na sua rotina de cópia do servidor.

## Permissões

- `gestao.view` / `gestao.manage`: administrador, gestor, advogado e atendimento recebem as duas; consulta recebe só a de leitura.
- `financeiro.view` / `financeiro.manage`: valores sensíveis. Administrador e gestor recebem; os demais perfis **não**. Marque em Equipe → Gestão do escritório para liberar a alguém.
- Pessoas com permissões personalizadas precisam ser marcadas em Equipe.

## Planos (SaaS)

No painel de assinaturas, cada plano (e cada escritório) pode ligar/desligar e limitar:

- **Módulo de gestão** (`modulo_gestao`): sem ele, a área Gestão some do menu e a API responde 403.
- **Módulo financeiro** (`modulo_financeiro`): idem para o Financeiro e a receita nos indicadores.
- **Armazenamento de arquivos (MB)** (`max_armazenamento_mb`): ao acabar o espaço, o envio é recusado com aviso.
- **Processos acompanhados** (`max_processos`): vale para as fichas de processo.

Hoje todos os planos vêm ilimitados/ligados (padrão), então nada muda até você restringir.

## Próximos passos possíveis

Cobrança de cliente por boleto/PIX (Asaas), integração com Google Drive, calendário compartilhado com tarefas, controle de horas e backup automático dos arquivos.

## Configurações reunidas e kit de documentos (2.69.0)

**Menu.** O menu lateral agora segue a função de cada ferramenta: Início, Clientes, Processos e prazos, Agenda e perícias, Comunicação, Financeiro e **Configurações**. Tudo o que é ajuste (dados do escritório, kit de documentos, ficha de cadastro, modelos de mensagens, WhatsApp, Trello, Google, IA, DJEN, equipe, conta, aparência, backup, atividade do sistema) fica dentro de *Configurações*, com menu próprio e uma visão geral em cards. Os endereços antigos continuam funcionando.

**Dados do escritório** (`Configurações → Dados do escritório`): nome, razão social, OAB e CNPJ da sociedade, endereço, cidade/UF, foro, telefones, e-mail, rodapé, logotipo, advogados (outorgados/contratados) e testemunhas padrão. Nada vem preenchido de fábrica: cada instalação cadastra o seu.

**Kit de documentos** (`Configurações → Kit de documentos` e botão *Gerar documentos* no cadastro do cliente e do processo): Procuração, Declaração de hipossuficiência, Contrato de prestação de serviços, Declaração de honorários não adiantados e Termo de ciência, em três tipos:
- **Comum** — o cliente assina;
- **A rogo** — assina outra pessoa de confiança, com duas testemunhas e quadro da digital do polegar;
- **Neste ato representado por…** — o representante legal assina (menor, incapaz).

Cada texto é editável (variáveis `{{cliente.nome}}`, `{{escritorio.razao_social}}`, `{{outorgados.lista}}`…), com botão para voltar ao padrão e prévia ao vivo. Os honorários do contrato (nº de benefícios e percentuais) têm valores padrão e podem ser trocados em cada geração. Saída: HTML pronto para imprimir (A4, cabeçalho com logotipo e rodapé do escritório em cada folha) ou **Word (.docx)** de verdade, com o mesmo cabeçalho e rodapé. Tudo é registrado na auditoria; os dados de terceiros (representante, quem assina a rogo) ficam no servidor por 10 minutos apenas e a janela de impressão leva só um código.

### Imagens do escritório (2.70.0)
Cada uso tem a sua imagem, em *Configurações → Dados do escritório*:
- **Cabeçalho dos documentos** (com alinhamento esquerda/centro/direita) e **rodapé** (imagem opcional + linhas de texto, também com alinhamento), usados no HTML e no Word.
- **Logotipo da ficha de cadastro**, em *Ficha de cadastro*: usar o mesmo cabeçalho dos documentos ou enviar uma imagem só da ficha, com posição esquerda/centro/direita.
- **Ícone (favicon)**: aparece na aba do navegador, no menu lateral e na tela de login, junto com o nome do escritório. É servido sem login (`/api/auth/identidade` e `/api/auth/favicon`) porque a tela de login precisa dele.

*Modelos livres* (antes "Outros modelos de documento") são os modelos de texto simples do sistema anterior, para qualquer documento fora do kit.

### Documentos próprios, configurações no topo e anotação rápida (2.71.0)
- **Modelos livres foi removido.** O que ele fazia agora é o botão **Novo documento** em *Configurações → Documentos do escritório* (antes "Kit de documentos"): o escritório cria o documento (nome e texto com variáveis) e ele passa a sair com cabeçalho, rodapé e assinatura, comum, a rogo ou representado, no botão *Gerar documentos* do cliente e do processo.
- **Configurações em largura total:** abas por assunto no topo (Escritório e pessoas, Documentos e modelos, Conexões e avisos, DJEN e prazos, Sistema) e, logo abaixo, as páginas de cada assunto.
- **Anotação rápida:** botão **Anotar** no topo de qualquer tela (ou **Alt+N**): escolha o cliente, o processo (opcional) e escreva. Sem processo, a anotação fica no cadastro do cliente. O cadastro do cliente ganhou a aba **Anotações**, que reúne as anotações do cadastro e as dos processos dele.
