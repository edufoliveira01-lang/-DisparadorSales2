# Expansão para vários escritórios e PostgreSQL

## Estado desta entrega — 2.50.19

O runtime continua SQLite. Foram adicionadas proteções para **novas instâncias isoladas**, documentação do estado atual e um plano de migração. Não foi executada conversão de dados nem implementado SaaS com vários escritórios no mesmo processo.

A equipe e seus perfis controlam áreas e ações dentro do mesmo escritório. Criar outro usuário não cria outro escritório e não separa clientes, processos ou credenciais.

## Transição: uma instância por escritório

Para um novo escritório, provisione instância com usuário do sistema/contêiner próprio, domínio próprio, processo PM2 próprio, porta própria, `.env` próprio, dados e credenciais próprios. Não reutilize o runner de produção atual para outro destino sem configurar um fluxo próprio.

Exemplo de configuração de uma **nova instância vazia**, sem alterar o escritório atual:

```dotenv
OFFICE_ID=escritorio-exemplo
DATA_DIR=/srv/disparazap/escritorio-exemplo/data
DJEN_CODEX_HOME=/srv/disparazap/escritorio-exemplo/data/codex
PORT=3334
APP_URL=https://dominio-do-escritorio.example
NODE_ENV=production
# Gere uma chave nova e exclusiva, não copie a de outro escritório.
ENCRYPTION_KEY=
```

Com `OFFICE_ID`, o backend exige `DATA_DIR` absoluto, chave com pelo menos 32 caracteres e autenticação Codex dentro do diretório daquele escritório. Grava uma identidade no diretório e recusa iniciá-lo para outro escritório ou sem sua identidade. Links simbólicos também são considerados na validação dos caminhos.

Uma pasta com banco legado sem identidade não é automaticamente atribuída a um novo escritório. O fluxo atual, sem `OFFICE_ID`, permanece com os mesmos dados e caminhos. Não adicione essa configuração à instalação atual sem um procedimento de atribuição e migração validado.

Isso é uma proteção de implantação, **não isolamento multiempresa dentro do mesmo servidor Node**. Permissões de arquivos, contêiner/usuário, domínios, portas, backups e credenciais também precisam ser separados pela infraestrutura. O deploy Ubuntu atual continua específico à instalação existente e ao seu caminho padrão de sessão Chromium.

## Arquitetura alvo com PostgreSQL

1. **Identidade:** tabelas `offices`, `users` e `office_memberships`. Um usuário pode participar de escritórios distintos com permissões distintas. O escritório ativo vem de uma associação autenticada verificada no servidor.
2. **Dados:** adicionar `office_id` obrigatório a clientes, processos, publicações, buscas, templates, configurações, histórico, filas, prazos, exemplos e auditoria. Chaves únicas e relacionamentos devem incluir o escritório quando aplicável; uma publicação compartilhada no DJEN não deve colidir entre escritórios.
3. **Isolamento:** PostgreSQL com Row Level Security, contexto de escritório definido por transação e papel da aplicação sem privilégios de proprietário/BYPASSRLS. Testar troca de conexão no pool e acessos cruzados em leitura, alteração, exportação e backup.
4. **API e serviços:** substituir o acesso síncrono `better-sqlite3` por uma camada assíncrona com transações e pool. Converter consultas SQLite (`PRAGMA`, `INSERT OR IGNORE`, `datetime`, alterações de schema e gatilhos) e revisar todos os serviços. Adicionar índices por escritório e paginação.
5. **Integrações:** credenciais cifradas e arquivos de WhatsApp/Codex exclusivos por escritório. Trabalhadores e tarefas levam `office_id`; trancas, cache, idempotência, canais de WebSocket e progresso também incluem esse contexto. Não manter singletons globais para várias contas.
6. **Auditoria e operação:** logar escritório e ator, limitar recuperação de senha por identidade, definir retenção, backups criptografados e restauração por escritório. Não restaurar um banco global pela rota administrativa atual de um único escritório.

## Migração dos dados existentes

1. Criar ambiente de homologação e backup consistente SQLite pela Online Backup API, preservando `.env`, chave de criptografia e os diretórios de sessão necessários em armazenamento seguro.
2. Inventariar tabelas, contagens, integridade (`integrity_check`/`foreign_key_check`), valores nulos, datas e referências legadas. Nomear explicitamente o escritório proprietário dos dados atuais.
3. Criar schema PostgreSQL versionado e testar a conversão numa cópia. Preservar identificadores locais ou manter mapa de IDs; reajustar sequences após importar. Normalizar timestamps em UTC e validar índices e referências.
4. Migrar credenciais sem expô-las em logs. Invalidar sessões web antigas. Tratar as sessões WhatsApp/Codex como arquivos de credenciais, não como linhas comuns exportadas para um banco compartilhado.
5. Comparar contagens, amostras funcionais e checksums por tabela. Validar categorias revisadas, etapas manuais, prazos, lembretes e vínculos Google/Trello. Manter envios e sincronizações externas desabilitados na homologação para evitar duplicidades.
6. Testar concorrência, reexecução de filas e isolamento entre pelo menos dois escritórios. A conversão do driver por si só não torna o sistema multiempresa.
7. No corte, pausar escritores e automações, tirar backup final e aplicar a importação final. Testar a API nova antes de liberar operações externas; definir retorno à base anterior sem perder as novas operações, caso necessário.

## Critérios para liberar a migração

- Testes de isolamento entre escritórios em API, banco, sockets, cache e tarefas.
- Paridade dos dados e dos fluxos de comunicação/agenda/processos.
- Testes de restauração e rollback com migrações, não somente rollback de código.
- Medições de concorrência, consultas lentas e limites de filas.
- PostgreSQL e novo backend validados juntos em homologação antes de trocar a instalação atual.
