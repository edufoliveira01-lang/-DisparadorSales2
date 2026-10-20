# Acompanhamento processual — versão 2.35.0

No seletor **Serviço ativo**, escolha **Processos e DJEN**. O controle anterior continua em **Perícias e avisos**.

## Primeiro uso

1. Em **Advogados**, cadastre o nome completo, o número da OAB e a UF. Podem ser acompanhados vários advogados. Cada inscrição tem cadastro próprio; outra UF exige outro cadastro.
2. O modo padrão faz duas consultas complementares: OAB/UF e nome. Inscrições com letra também são consultadas com as variações de separador. Correspondências só pelo nome precisam de conferência da OAB, devido a homônimos.
3. Em **Monitoramento DJEN**, escolha um período de disponibilização de até 31 dias e consulte todos os advogados ativos ou apenas um.
4. Em **Publicações**, filtre sentença, acórdão, publicação de perícia ou laudo pericial juntado. As demais publicações continuam armazenadas em **Outras**; não são descartadas por falta de classificação.
5. Abra os detalhes para consultar o inteiro teor da publicação, partes, advogados, órgão julgador, classe, data, certidão oficial e outras publicações já capturadas do mesmo processo.
6. Confira a classificação, vincule o contato correto da Agenda e, se desejar, revise a mensagem antes de confirmar o envio pelo WhatsApp.

## Identificação inicial

A triagem inicial é baseada em tipo de documento e evidências explícitas do texto. Não usa um modelo de IA ou credenciais externas. Sentenças podem ter resultado procedente, improcedente, parcialmente procedente ou não identificado. Havendo dispositivos conflitantes, não se presume o resultado.

A identificação de laudo tenta distinguir juntada já comunicada de determinação futura de juntada. Toda identificação fica **A revisar** e pode ser corrigida pelo usuário. Uma mudança posterior no inteiro teor exige nova revisão. A mensagem inicial ao cliente é neutra e editável; não afirma que o cliente ganhou ou perdeu automaticamente.

Esta etapa não calcula prazos, consulta autos integrais, acessa documentos sob sigilo ou cria eventos em calendários. A data exibida é a **disponibilização informada pelo DJEN**, não uma data de vencimento calculada.

## Independência dos serviços

As tabelas `djen_*` guardam advogados, processos, publicações, consultas, revisão e mensagens desta área. A captura e a comunicação processual não criam registros em `pericias_agendadas`, `send_logs`, `pending_replies` nem vínculos do calendário de perícias. Não há transferência automática de perícia identificada no DJEN para o controle anterior.

Somente infraestrutura comum é reutilizada: login, Agenda de contatos, conexão do WhatsApp e acesso às configurações existentes. O vínculo do contato com o processo é explícito; não é escolhido automaticamente pelo nome da parte. A exclusão de um contato não apaga as publicações. As mensagens ficam no histórico do acompanhamento processual e não abrem uma espera de resposta no módulo de perícias.

## Captura automática e falhas

O monitoramento automático começa desligado. Pode ser ativado com intervalo entre 30 e 1440 minutos. Na primeira execução usa a janela configurada; depois retoma do último período concluído, com sobreposição de dois dias. Se houver muito tempo sem captura, recupera o histórico em janelas de até 31 dias, sem saltar diretamente para hoje.

Publicações são deduplicadas pelo identificador da comunicação, inclusive quando encontradas por vários advogados ou pelos dois modos de busca. As consultas respeitam paginação e espera entre requisições. Resultados a partir de 10 mil provocam divisão do intervalo, quando possível. Paginação incompleta, repetida, limite de requisições ou falha de acesso não avançam o cursor do advogado afetado.

Erros aparecem em **Últimas consultas** e no cadastro do advogado. Reiniciar o servidor preserva o que já foi capturado; uma consulta interrompida deve ser repetida para completá-la. Envios de resultado incerto não são repetidos automaticamente. O destinatário é conferido novamente no servidor antes do envio e a confirmação exige ACK do WhatsApp.

## Fonte e validação

Fonte fixa: `https://comunicaapi.pje.jus.br/api/v1/comunicacao`. A consulta é somente leitura. Filtros e paginação foram conferidos no código público do portal oficial `https://comunica.pje.jus.br/`, consultado em 20/10/2026: `numeroOab`, `ufOab`, `nomeAdvogado`, `dataDisponibilizacaoInicio`, `dataDisponibilizacaoFim`, `pagina` e `itensPorPagina`.

O acesso direto à API retornou HTTP 403 no ambiente de desenvolvimento. Portanto a conectividade real precisa ser confirmada a partir da hospedagem do escritório; não foi declarada uma captura real de produção. Um 403 é mostrado como falha de acesso, nunca como sucesso com zero publicações. Não é utilizada fonte alternativa, contorno de bloqueio nem dados fictícios na aplicação de produção.

Testes automatizados cobrem classificação, paginação, falhas, deduplicação, revisão, cursor, destinatário e isolamento. A interface foi exercitada com API e SQLite locais reais, simulando somente a fonte DJEN e o envio pelo WhatsApp. O backup existente, por copiar o SQLite, também inclui as novas tabelas.
