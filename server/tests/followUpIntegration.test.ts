import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ calendarios: [] as Record<string, unknown>[] }));
vi.mock('../src/db', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE djen_historico_consultas(processo_chave TEXT PRIMARY KEY,status TEXT DEFAULT 'pendente',inicio TEXT,fim TEXT,consultado_em TEXT,erro TEXT,revisao INTEGER DEFAULT 0,revisao_conferida INTEGER DEFAULT -1,proxima_tentativa_em TEXT);
    CREATE TABLE djen_config(id INTEGER,aguardo_dias INTEGER);
    INSERT INTO djen_config VALUES(1,30);
    CREATE TABLE djen_publicacoes(id INTEGER PRIMARY KEY,processo_chave TEXT,data_disponibilizacao TEXT,texto TEXT,situacao TEXT DEFAULT '',ia_json TEXT,tribunal TEXT DEFAULT 'TRF3',orgao TEXT DEFAULT 'Jundiai',cancelada INTEGER DEFAULT 0,concluida INTEGER DEFAULT 0,captured_at TEXT DEFAULT CURRENT_TIMESTAMP,categorias_json TEXT DEFAULT '[]',tipo_documento TEXT,classe TEXT);
    CREATE TABLE djen_processos(chave TEXT,numero TEXT,cliente_id INTEGER);
    CREATE TABLE contacts(id INTEGER,nome TEXT,telefone TEXT);
    CREATE TABLE djen_acompanhamentos_obrigacoes(publicacao_id INTEGER,tipo TEXT,status TEXT,ultima_cobranca_em TEXT,PRIMARY KEY(publicacao_id,tipo));
    CREATE TABLE djen_acompanhamentos_aguardo(publicacao_id INTEGER,status TEXT,ultima_cobranca_em TEXT);
    CREATE TABLE pericias_agendadas(id INTEGER PRIMARY KEY,processo_chave TEXT,nome TEXT,processo TEXT,data TEXT,horario TEXT,local TEXT,data_hora_ms INTEGER,ultimo_lembrete_em TEXT,status TEXT DEFAULT 'ativa',origem TEXT DEFAULT 'medica');
    CREATE TABLE djen_acompanhamentos_pericia(pericia_id INTEGER,status TEXT,ultima_cobranca_em TEXT,observacoes TEXT);
    CREATE TABLE djen_historico(publicacao_id INTEGER,tipo TEXT,descricao TEXT,dados_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE djen_mensagens(publicacao_id INTEGER,status TEXT,finished_at TEXT);
    CREATE TABLE djen_kanban_movimentos(processo_chave TEXT,origem_movimento TEXT,created_at TEXT);`);
  return { db };
});
vi.mock('../src/services/djen/store', () => ({ DjenInputError: class extends Error {} }));
vi.mock('../src/services/settingsService', () => ({ getSetting: () => JSON.stringify({calendarios: fixture.calendarios}), setSetting: vi.fn() }));
vi.mock('../src/services/djen/officialCalendars/store', () => ({ lerCalendario: () => undefined, calendarioParaCalculo: () => null }));
vi.mock('../src/services/djen/workflow', () => ({ WorkflowInputError: class extends Error {} }));
vi.mock('../src/services/parserService', () => ({ parseBrazilianDate: vi.fn() }));
vi.mock('../src/services/periciasAgendadasService', () => ({ registrarPericiaAgendadaComResultado: vi.fn() }));
import { db } from '../src/db';
import { prazoDoAcompanhamento } from '../src/services/djen/followUpDeadline';
import { identificarObrigacoesExternas } from '../src/services/djen/obligations';
import { listarObrigacoesExternas, listarObrigacoesExternasAsync } from '../src/services/djen/externalFollowUp';
import { listarPericiasSemLaudo } from '../src/services/djen/periciaIntegration';
import { atividadesProcessos } from '../src/services/djen/activity';
const pub = { tribunal:'TRF3',orgao:'Jundiai',data_disponibilizacao:'2026-10-01' };
const ordem = (periodo='5 dias úteis') => identificarObrigacoesExternas(`Intime-se o perito para apresentar o laudo no prazo de ${periodo}.`)[0];
beforeEach(() => {
  fixture.calendarios = [{tribunal:'TRF3',orgao:'Jundiai',inicio:'2020-01-01',fim:'2027-12-31',conferido:true,fonte:'https://www.trf3.jus.br/',feriados:[],suspensoes:[]}];
  for (const table of ['djen_publicacoes','djen_processos','pericias_agendadas','djen_acompanhamentos_obrigacoes','djen_acompanhamentos_aguardo','djen_acompanhamentos_pericia','djen_historico','djen_mensagens','djen_kanban_movimentos']) db.prepare(`DELETE FROM ${table}`).run();
});
describe('prazo expresso de acompanhamento', () => {
  it('5 dias úteis vencem pelo calendário, sem esperar o piso antigo de 30 dias', () => {
    expect(prazoDoAcompanhamento(ordem(),pub,30,'2026-10-10')).toMatchObject({prazo_termino:'2026-10-09',dias_espera:5,exibir:true,prazo_pendente:false});
    expect(prazoDoAcompanhamento(ordem(),pub,30,'2026-10-09').exibir).toBe(false);
  });
  it('considera feriados do órgão', () => {
    fixture.calendarios[0].feriados=['2026-10-07'];
    expect(prazoDoAcompanhamento(ordem(),pub,30,'2026-10-13').prazo_termino).toBe('2026-10-12');
  });
  it('sem calendário não inventa vencimento nem aplica 30 dias', () => {
    fixture.calendarios=[];
    expect(prazoDoAcompanhamento(ordem(),pub,30,'2026-10-02')).toMatchObject({prazo_termino:null,dias_espera:5,prazo_pendente:true,exibir:true});
  });
  it('sem período expresso só usa o lembrete operacional', () => {
    const o=identificarObrigacoesExternas('Intime-se o perito para apresentar o laudo.')[0];
    expect(prazoDoAcompanhamento(o,pub,30,'2026-10-30').exibir).toBe(false);
    expect(prazoDoAcompanhamento(o,pub,30,'2026-10-31')).toMatchObject({dias_espera:30,exibir:true});
  });
  it.each(['48 horas','2 meses','10 (quinze) dias','5 dias a contar da ciência pessoal'])('unidade ou marco pendente não recebe padrão: %s', periodo => {
    expect(prazoDoAcompanhamento(ordem(periodo),pub,30,'2026-10-02')).toMatchObject({prazo_termino:null,dias_espera:null,prazo_pendente:true,exibir:true});
  });
  it('data limite literal e data inválida', () => {
    const o=identificarObrigacoesExternas('Intime-se o perito para apresentar o laudo até 09/10/2026.')[0];
    expect(prazoDoAcompanhamento(o,pub,30,'2026-10-10')).toMatchObject({prazo_termino:'2026-10-09',exibir:true});
    o.prazo_texto='até 31/13/2026';
    expect(prazoDoAcompanhamento(o,pub,30,'2026-10-10').prazo_pendente).toBe(true);
  });
});
const inserir = (id:number,texto:string,data='2020-02-01',processo='p') => db.prepare('INSERT INTO djen_publicacoes(id,processo_chave,texto,data_disponibilizacao,captured_at) VALUES (?,?,?,?,?)').run(id,processo,texto,data,'2020-01-01 15:00:00');
describe('acompanhamentos cruzados por processo', () => {
  beforeEach(() => {
    db.prepare('INSERT INTO djen_processos VALUES(?,?,NULL)').run('p','5000707-50.2026.4.03.6304');
    db.prepare("INSERT INTO pericias_agendadas(id,processo_chave,nome,processo,data,data_hora_ms) VALUES(1,'p','ELICASSIA','5000707-50.2026.4.03.6304','01/01/2020',?)").run(Date.parse('2020-01-01T14:40:00-03:00'));
    inserir(1,'Intime-se o perito para apresentar o laudo.');
  });
  it('sentença posterior remove alertas obsoletos; nova publicação comum não', async () => {
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    expect(listarObrigacoesExternas()).toHaveLength(1);
    inserir(2,'Conclusos para decisão.','2020-03-01');
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    inserir(3,'Homologo o pedido de desistência da ação e julgo extinto o processo sem resolução de mérito.','2020-04-01');
    expect(listarPericiasSemLaudo()).toHaveLength(0);
    expect(await listarObrigacoesExternasAsync()).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pericias_agendadas').get()).toMatchObject({n:1});
  });
  it('sentença antiga, citação e outro processo não apagam pendência nova', () => {
    inserir(2,'Julgo improcedente o pedido.','2019-12-01');
    inserir(3,'Conforme precedente: “Julgo extinto o processo”.','2020-04-01');
    inserir(4,'Julgo extinto o processo.','2020-04-01','outro');
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    expect(listarObrigacoesExternas()).toHaveLength(1);
  });
  it('laudo deve ter prova literal posterior, não mero nome de categoria', () => {
    inserir(2,'Intime-se o perito para apresentação do laudo.','2020-03-01');
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    inserir(3,'Laudo pericial juntado aos autos.','2020-04-01');
    expect(listarPericiasSemLaudo()).toHaveLength(0);
    expect(listarObrigacoesExternas()).toHaveLength(0);
  });
  it('leitura e IA não reiniciam idade; providência e mensagem enviada reiniciam', () => {
    db.prepare("INSERT INTO djen_historico(publicacao_id,tipo,descricao) VALUES(1,'leitura','lido'),(1,'analise','IA')").run();
    expect(atividadesProcessos().get('p')?.dias).toBeGreaterThan(30);
    db.prepare("INSERT INTO djen_historico(publicacao_id,tipo,descricao) VALUES(1,'providencia','Cobrança por telefone')").run();
    expect(atividadesProcessos().get('p')?.dias).toBe(0);
    db.prepare('DELETE FROM djen_historico').run();
    db.prepare("INSERT INTO djen_mensagens VALUES(1,'sucesso',CURRENT_TIMESTAMP)").run();
    expect(atividadesProcessos().get('p')?.dias).toBe(0);
    db.prepare('DELETE FROM djen_mensagens').run();
    db.prepare("INSERT INTO djen_acompanhamentos_obrigacoes VALUES(1,'perito_laudo','cobrado',CURRENT_TIMESTAMP)").run();
    expect(atividadesProcessos().get('p')?.dias).toBe(0);
    db.prepare('UPDATE djen_publicacoes SET concluida=1').run();
    expect(atividadesProcessos().has('p')).toBe(false);
  });
});

