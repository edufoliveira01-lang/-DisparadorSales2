import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { ConclusaoBloqueada, concluirComSeguranca, concluirLoteComSeguranca, pendenciasDaConclusao } from "../src/services/djen/conclusaoSegura";

let serial = 0;
function publicar(chave: string, data: string, extra: { categorias?: string[]; compromisso?: string; ia?: string; revisada?: number; texto?: string } = {}) {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  return Number(
    db.prepare(
      `INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json,compromisso_estado,ia_status,revisada)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(`conc-${++serial}`, chave, "TRF3", "Vara", "Comum", "Ato ordinatório", "Intimação", data, extra.texto ?? "texto", JSON.stringify(extra.categorias ?? []), extra.compromisso ?? "", extra.ia ?? "concluida", extra.revisada ?? 1).lastInsertRowid,
  );
}
const concluida = (id: number) => (db.prepare("SELECT concluida FROM djen_publicacoes WHERE id=?").get(id) as { concluida: number }).concluida;

beforeEach(() => {
  db.exec("DELETE FROM djen_mensagens; DELETE FROM djen_prazos; DELETE FROM djen_historico; DELETE FROM djen_publicacao_advogados; DELETE FROM djen_publicacoes;");
});

describe("conclusão segura de andamentos", () => {
  it("por padrão conclui SÓ o andamento escolhido, não o grupo do processo", () => {
    const a = publicar("proc-1", "2026-11-01");
    const b = publicar("proc-1", "2026-11-05");
    const r = concluirComSeguranca({ id: b, concluida: true });
    expect(r.total).toBe(1);
    expect(concluida(b)).toBe(1);
    expect(concluida(a)).toBe(0);
  });

  it("com escopo «processo» conclui todos os andamentos abertos", () => {
    const a = publicar("proc-2", "2026-11-01");
    const b = publicar("proc-2", "2026-11-05");
    expect(concluirComSeguranca({ id: b, concluida: true, escopo: "processo" }).total).toBe(2);
    expect(concluida(a)).toBe(1);
  });

  it("perícia fora do controle bloqueia a conclusão", () => {
    const id = publicar("proc-3", "2026-11-01", { categorias: ["pericia"], compromisso: "completar" });
    expect(() => concluirComSeguranca({ id, concluida: true })).toThrow(ConclusaoBloqueada);
    expect(concluida(id)).toBe(0);
    const p = pendenciasDaConclusao([id]);
    expect(p[0]!.tipo).toBe("compromisso");
  });

  it("perícia já no controle não bloqueia", () => {
    const id = publicar("proc-4", "2026-11-01", { categorias: ["pericia"], compromisso: "informado" });
    concluirComSeguranca({ id, concluida: true });
    expect(concluida(id)).toBe(1);
  });

  it("análise da IA que falhou e não foi revisada bloqueia", () => {
    const id = publicar("proc-5", "2026-11-01", { ia: "erro", revisada: 0 });
    expect(() => concluirComSeguranca({ id, concluida: true })).toThrow(ConclusaoBloqueada);
  });

  it("forçar exige justificativa e a deixa no histórico", () => {
    const id = publicar("proc-6", "2026-11-01", { categorias: ["audiencia"], compromisso: "" });
    expect(() => concluirComSeguranca({ id, concluida: true, forcar: true })).toThrow(/explique o motivo/);
    concluirComSeguranca({ id, concluida: true, forcar: true, justificativa: "Audiência já foi lançada na agenda do advogado" });
    expect(concluida(id)).toBe(1);
    const h = db.prepare("SELECT descricao FROM djen_historico WHERE publicacao_id=? AND tipo='conclusao'").get(id) as { descricao: string };
    expect(h.descricao).toMatch(/COM PENDÊNCIAS/);
    expect(h.descricao).toMatch(/agenda do advogado/);
  });

  it("ordem com prazo para o escritório sem prazo lançado bloqueia; com prazo lançado, passa", () => {
    const id = publicar("proc-10", "2026-11-01", { texto: "Intime-se a parte autora para emendar a petição inicial, no prazo de 15 (quinze) dias úteis, sob pena de indeferimento." });
    const pend = pendenciasDaConclusao([id]);
    expect(pend.map((p) => p.tipo)).toContain("prazo_sem_lancamento");
    expect(() => concluirComSeguranca({ id, concluida: true })).toThrow(ConclusaoBloqueada);
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,inicio,termino,status) VALUES (?,?,?,?,?)").run(id, "Emenda", "2026-11-02", "2026-11-24", "aberto");
    expect(pendenciasDaConclusao([id])).toEqual([]);
    concluirComSeguranca({ id, concluida: true });
    expect(concluida(id)).toBe(1);
  });

  it("reabrir não exige conferência", () => {
    const id = publicar("proc-7", "2026-11-01");
    concluirComSeguranca({ id, concluida: true });
    concluirComSeguranca({ id, concluida: false });
    expect(concluida(id)).toBe(0);
  });

  it("o lote também é bloqueado por pendência", () => {
    const ok = publicar("proc-8", "2026-11-01");
    const ruim = publicar("proc-9", "2026-11-01", { categorias: ["pericia"], compromisso: "completar" });
    expect(() => concluirLoteComSeguranca([ok, ruim])).toThrow(ConclusaoBloqueada);
    expect(concluida(ok)).toBe(0);
    expect(concluirLoteComSeguranca([ok]).publicacoes).toBe(1);
  });
});

describe("fila por urgência", () => {
  it("prazo vencido ou que vence hoje aparece antes de uma ciência mais recente", async () => {
    const { listarPublicacoes } = await import("../src/services/djen/store");
    db.exec("DELETE FROM djen_mensagens; DELETE FROM djen_prazos; DELETE FROM djen_historico; DELETE FROM djen_publicacao_advogados; DELETE FROM djen_publicacoes;");
    const antigo = publicar("fila-1", "2026-10-01", { texto: "Intime-se para manifestação." });
    const recente = publicar("fila-2", "2026-11-16", { texto: "Ciência." });
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,inicio,termino,status) VALUES (?,?,?,?,?)").run(antigo, "Manifestação", "2026-10-02", "2026-10-20", "aberto");
    const r = listarPublicacoes({ arquivo: "ativos" }) as { items: { id: number }[] };
    expect(r.items.map((i) => i.id)).toEqual([antigo, recente]);
  });
});
