# Gestão do escritório

Área ao lado de "Perícias e avisos" e "Processos e DJEN". Nada do que já existia foi alterado: a gestão só **acrescenta** tabelas (`gestao_*`), rotas (`/api/gestao/*`) e telas.

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
