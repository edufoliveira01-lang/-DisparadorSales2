# Gestão do escritório

Área nova, ao lado de "Perícias e avisos" e "Processos e DJEN". Nada do que já existia foi alterado: as telas e rotinas atuais seguem iguais. A gestão só **acrescenta** tabelas (`gestao_*`), rotas (`/api/gestao/*`) e telas.

## Fase 1 (2.64.0): pessoas, processos e pastas

- **Pessoas** (`/gestao/pessoas`): clientes, partes contrárias, testemunhas e peritos, com CPF/CNPJ validados (dígitos verificadores), contatos, endereço, origem e observações. Cadastro com documento repetido é recusado; quem participa de processos é inativado, não excluído.
- **Processos e pastas** (`/gestao/processos`): número validado (dígito verificador CNJ), tribunal identificado pelo número, **pasta automática** (`AAAA/0001`), responsável, área, valor da causa, situação e fase. Busca por número, pasta, cliente ou CPF.
- **Ficha do processo**: resumo editável, partes (autor, réu, terceiro, testemunha, perito, advogado contrário) e histórico, que reúne as publicações do DJEN, as perícias agendadas e as anotações da equipe.
- **Ligação com o que já existe**: "Criar fichas" gera, de uma vez, a ficha de cada processo monitorado pelo DJEN (número, tribunal, vara, classe, área e cliente já preenchidos); "Importar contatos" transforma os contatos da agenda em cadastros completos (um contato gera uma única pessoa; a agenda e os avisos continuam funcionando).
- **Permissões**: `gestao.view` (ver) e `gestao.manage` (cadastrar/editar). Administrador, gestor, advogado e atendimento já recebem as duas; consulta recebe só a de leitura. Para pessoas com permissões personalizadas, marque em Equipe → Gestão do escritório.
- **Planos (SaaS)**: o limite `max_processos` do plano já vale para as fichas (hoje ilimitado).

## Próximas fases

2. Arquivos por pasta e modelos de documento. 3. Tarefas e "Meu painel". 4. Financeiro. 5. Indicadores de gestão. 6. Módulos e cotas por plano.
