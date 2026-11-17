import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { hojeSaoPaulo, limparCachesDjen } from "../src/services/djen/cache";
import { listarPublicacoes, revisarPublicacao, salvarProcessoDaPublicacao, detalhesPublicacao } from "../src/services/djen/store";
import { triagensPublicacoes } from "../src/services/djen/triagem";
import { urgenciaDasPublicacoes } from "../src/services/djen/urgencia";
import { concluirComSeguranca, concluirLoteComSeguranca } from "../src/services/djen/conclusaoSegura";
import { agendamentoDaPublicacao, publicacao } from "../src/services/djen/periciaIntegration";

vi.mock("../src/services/googleCalendarService", async importar => ({
  ...await importar<typeof import("../src/services/googleCalendarService")>(), scheduleGoogleCalendarSync: vi.fn(),
}));

let serial = 0;
const ids: number[] = [], chaves: string[] = [], contatos: number[] = [];
const hoje = hojeSaoPaulo();
const depois = (dias: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
function criar(extra: { chave?: string; texto?: string; categorias?: string[]; data?: string; revisada?: number; analise?: unknown } = {}) {
  const chave = extra.chave || `9876543212026403${String(++serial).padStart(5, "0")}`;
  const nome = `Triagem teste ${serial}`;
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  chaves.push(chave);
  const id = Number(db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,
    data_disponibilizacao,texto,categorias_json,revisada,ia_status,ia_json) VALUES (?,?, 'TRF3','Vara','Comum','Intimação','Intimação',?,?,?,?, 'concluida',?)`)
    .run(`triagem-${++serial}`, chave, extra.data || hoje, extra.texto || nome, JSON.stringify(extra.categorias || []), extra.revisada ?? 1, extra.analise ? JSON.stringify(extra.analise) : null).lastInsertRowid);
  ids.push(id); limparCachesDjen(); return id;
}
function prazo(id: number, termino: string, responsavel = "escritorio") {
  db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,termino,status,responsavel) VALUES (?,'Manifestação',?,'aberto',?)").run(id, termino, responsavel);
  limparCachesDjen();
}
afterEach(() => {
  for (const id of ids) {
    db.prepare("DELETE FROM pericias_agendadas WHERE card_id=?").run(`djen:${id}`);
    db.prepare("DELETE FROM djen_mensagens WHERE publicacao_id=?").run(id);
    db.prepare("DELETE FROM djen_publicacoes WHERE id=?").run(id);
  }
  for (const chave of chaves) db.prepare("DELETE FROM djen_processos WHERE chave=?").run(chave);
  for (const id of contatos) db.prepare("DELETE FROM contacts WHERE id=?").run(id);
  ids.length = 0; chaves.length = 0; contatos.length = 0; limparCachesDjen();
});

describe("fila e indicadores de publicações", () => {
  it("abre o andamento urgente mesmo quando há ciência posterior no mesmo processo", () => {
    const a = criar({ data: depois(-20) });
    const chave = publicacao(a)!.processo_chave;
    const b = criar({ chave, data: hoje });
    prazo(a, hoje);
    const r = listarPublicacoes({ agrupamento: "andamentos", prioridade: "urgentes", busca: chave });
    expect(r.items.map(p => p.id)).toEqual([a]);
    expect(listarPublicacoes({ agrupamento: "andamentos", busca: chave }).total).toBe(2);
    expect(listarPublicacoes({ busca: chave }).total).toBe(1);
    expect(b).not.toBe(a);
  });
  it("um andamento que precisa conferir e lançar prazo conta uma vez no indicador", () => {
    const antes = urgenciaDasPublicacoes().precisam_conferencia;
    const id = criar({ revisada: 0, texto: "Intime-se a parte autora para emendar a petição inicial, no prazo de 15 dias úteis, sob pena de indeferimento." });
    const t = triagensPublicacoes().get(id)!;
    expect(t.prazo_a_lancar).toBe(true);
    expect(t.conferencia_pendente).toBe(true);
    expect(urgenciaDasPublicacoes().precisam_conferencia).toBe(antes + 1);
    expect(listarPublicacoes({ agrupamento: "andamentos", prioridade: "conferir", busca: publicacao(id)!.processo_chave }).items.map(p => p.id)).toEqual([id]);
  });
  it("compromissos do indicador incluem audiência e perícia, no mesmo período da lista", () => {
    const antes = urgenciaDasPublicacoes().compromissos_7_dias;
    const a = criar({ categorias: ["audiencia"], analise: { agendamento: { data: depois(2), horario: "14:00", local: "Sala 1" } } });
    const b = criar({ categorias: ["pericia"], analise: { agendamento: { data: depois(5), horario: "09:00", local: "Rua A" } } });
    const c = criar({ categorias: ["pericia"], analise: { agendamento: { data: depois(15), horario: "09:00", local: "Rua A" } } });
    expect(urgenciaDasPublicacoes().compromissos_7_dias).toBe(antes + 2);
    const encontrados = listarPublicacoes({ agrupamento: "andamentos", prioridade: "compromissos", busca: "9876543212026403" }).items.map(p => p.id);
    expect(encontrados).toEqual(expect.arrayContaining([a, b]));
    expect(encontrados).not.toContain(c);
  });
  it("concluir a triagem mantém um prazo aberto visível e exclui prazo de terceiro do indicador do escritório", () => {
    const id = criar(); prazo(id, hoje);
    concluirComSeguranca({ id, concluida: true });
    expect(listarPublicacoes({ agrupamento: "andamentos", arquivo: "ativos", busca: publicacao(id)!.processo_chave }).items.map(p => p.id)).toContain(id);
    const outro = criar(); prazo(outro, hoje, "terceiro");
    expect(triagensPublicacoes().get(outro)!.vence_hoje).toBe(false);
  });
  it("mantém prazos sem destinatário identificado na conferência mesmo após concluir a triagem", () => {
    const id = criar(); prazo(id, hoje, "nao_identificado");
    concluirComSeguranca({ id, concluida: true, forcar: true, justificativa: "Conferência posterior do destinatário" });
    const t = triagensPublicacoes().get(id)!;
    expect(t.conferencia_pendente).toBe(true);
    expect(t.vence_hoje).toBe(false);
    expect(listarPublicacoes({ agrupamento: "andamentos", arquivo: "ativos", prioridade: "conferir", busca: publicacao(id)!.processo_chave }).items.map(p => p.id)).toContain(id);
  });
  it("o filtro Outros encontra um andamento sem categoria mesmo com sentença no mesmo processo", () => {
    const id = criar(); criar({ chave: publicacao(id)!.processo_chave, categorias: ["sentenca"] });
    expect(listarPublicacoes({ agrupamento: "andamentos", categoria: "outros", busca: publicacao(id)!.processo_chave }).items.map(p => p.id)).toEqual([id]);
  });
  it("desfazer reabre somente os IDs alterados pela conclusão, preservando baixas anteriores", () => {
    const a = criar(); const chave = publicacao(a)!.processo_chave;
    const b = criar({ chave }); const c = criar({ chave });
    concluirComSeguranca({ id: a, concluida: true });
    const resultado = concluirComSeguranca({ id: b, escopo: "processo", concluida: true });
    expect(resultado.ids).toEqual(expect.arrayContaining([b, c]));
    concluirComSeguranca({ id: b, escopo: "processo", concluida: false, ids: resultado.ids });
    expect(detalhesPublicacao(a).concluida).toBe(1);
    expect(detalhesPublicacao(b).concluida).toBe(0);
    expect(detalhesPublicacao(c).concluida).toBe(0);
  });
  it("o lote de andamentos conclui apenas a seleção explícita", () => {
    const a = criar(); const b = criar({ chave: publicacao(a)!.processo_chave });
    concluirLoteComSeguranca([a], { escopo: "andamentos" });
    expect(detalhesPublicacao(a).concluida).toBe(1);
    expect(detalhesPublicacao(b).concluida).toBe(0);
  });
  it("persiste a data manual e reutiliza o compromisso ao repetir a revisão", () => {
    const id = criar({ categorias: ["pericia"], revisada: 0, texto: "Perícia designada. Conferir data no documento." });
    const contato = Number(db.prepare("INSERT INTO contacts(nome,telefone) VALUES ('Triagem cliente','13999990001')").run().lastInsertRowid);
    contatos.push(contato);
    salvarProcessoDaPublicacao(id, { cliente_id: contato, observacoes: "" });
    const dados = { categorias: ["pericia"], resultado: "nao_identificado", agendamento: { data: depois(4), horario: "09:30", local: "Rua A, 10" } };
    revisarPublicacao(id, dados);
    revisarPublicacao(id, dados);
    expect(agendamentoDaPublicacao(publicacao(id)!)).toMatchObject({ horario: "09:30", local: "Rua A, 10" });
    expect(triagensPublicacoes().get(id)!.compromisso?.data).toBe(depois(4));
    expect(db.prepare("SELECT COUNT(*) n FROM pericias_agendadas WHERE card_id=?").get(`djen:${id}`)).toEqual({ n: 1 });
    expect(() => revisarPublicacao(id, { ...dados, agendamento: { data: "2026-02-31", horario: "09:30", local: "Rua A" } })).toThrow();
  });
  it("uma desvinculação explícita não é refeita pela consulta automática", () => {
    const id = criar(); const p = publicacao(id)!;
    const contato = Number(db.prepare("INSERT INTO contacts(nome,telefone,processo,processo_chave) VALUES ('Triagem cliente','13999990002',?,?)").run(p.processo, p.processo_chave).lastInsertRowid);
    contatos.push(contato);
    db.prepare("UPDATE djen_publicacoes SET destinatarios_json=? WHERE id=?").run(JSON.stringify([{ nome: "Triagem cliente" }]), id);
    salvarProcessoDaPublicacao(id, { cliente_id: contato, observacoes: "" });
    salvarProcessoDaPublicacao(id, { cliente_id: null, observacoes: "" });
    listarPublicacoes({ agrupamento: "andamentos", busca: p.processo });
    expect(detalhesPublicacao(id).cliente_id).toBeNull();
  });
});
