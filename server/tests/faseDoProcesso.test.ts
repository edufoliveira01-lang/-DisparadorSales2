import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { FASES, definirFase, fasesDoProcesso, resumoDasFases } from "../src/services/gestao/faseDoProcesso";
import { tratarJsonRpc } from "../src/atendimento/mcp/servidor";

const CH = "88888881120268268888";
const ins = (sql: string, ...p: unknown[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
const proc = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('8888888-11.2026.8.26.8888',?,'P-8888','Teste fase','ativo')", CH);
const pessoa = ins("INSERT INTO gestao_pessoas(tipo,nome,telefone) VALUES ('cliente','Zz Fase Teste','(11) 98888-0001')");
db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(proc, pessoa);
const lista = (codigo: string) => (db.prepare("SELECT id,nome FROM djen_kanban_listas WHERE codigo=?").get(codigo) as { id: number; nome: string });

afterAll(() => {
  db.prepare("DELETE FROM djen_kanban_movimentos WHERE processo_chave=?").run(CH);
  db.prepare("DELETE FROM djen_kanban_cartoes WHERE processo_chave=?").run(CH);
  db.prepare("DELETE FROM pericias_agendadas WHERE processo_chave=?").run(CH);
  db.prepare("DELETE FROM djen_processos WHERE chave=?").run(CH);
  db.prepare("DELETE FROM gestao_processos WHERE id=?").run(proc);
  db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(pessoa);
});

describe("fases do processo", () => {
  it("as 9 fases cobrem etapas sem repetir nenhuma", () => {
    expect(FASES).toHaveLength(9);
    const todas = FASES.flatMap((f) => f.codigos);
    expect(new Set(todas).size).toBe(todas.length);
  });

  it("sem quadro e sem publicações: fase não definida", () => {
    const l = fasesDoProcesso(proc);
    expect(l.origem).toBe("nenhuma"); expect(l.atual).toBeNull();
    expect(l.fases.every((f) => f.estado === "futura")).toBe(true);
  });

  it("perícia agendada: a fase é deduzida e a equipe pode confirmar (vira etapa manual do quadro)", () => {
    db.prepare("INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms,status) VALUES ('c','Perícia Médica','periciamedica','','N','n','','','',?,'30/11/2026','09:00','x',?,'ativa')").run(CH, Date.now() + 1e9);
    const d = fasesDoProcesso(proc);
    expect(d.origem).toBe("deduzida"); expect(d.atual?.chave).toBe("pericia");
    expect(d.fases.filter((f) => f.estado === "concluida").map((f) => f.chave)).toEqual(["triagem", "peticao_inicial", "citacao"]);
    const c = definirFase(proc, "pericia");
    expect(c.origem).toBe("quadro"); expect(c.atual?.chave).toBe("pericia");
    expect((db.prepare("SELECT modo FROM djen_kanban_cartoes WHERE processo_chave=?").get(CH) as { modo: string }).modo).toBe("manual");
  });

  it("mudar de etapa guarda o histórico; situação paralela (aguardando juízo) não vira fase", () => {
    definirFase(proc, "sentenca");
    let l = fasesDoProcesso(proc);
    expect(l.atual?.chave).toBe("sentenca");
    expect(l.fases.find((f) => f.chave === "pericia")?.estado).toBe("concluida");
    expect(l.fases.find((f) => f.chave === "pericia")?.saiu_em).toBeTruthy();
    // a equipe move para «Aguardando juízo»: a fase continua sendo Sentença, com a situação em cima
    db.prepare("UPDATE djen_kanban_cartoes SET lista_id=? WHERE processo_chave=?").run(lista("aguarda_juizo").id, CH);
    l = fasesDoProcesso(proc);
    expect(l.atual?.chave).toBe("sentenca"); expect(l.situacao?.nome).toBe(lista("aguarda_juizo").nome);
    expect(resumoDasFases([proc])[proc]).toMatchObject({ rotulo: "Sentença", indice: 5, total: 9 });
    expect(() => definirFase(proc, "inexistente")).toThrow(/fase válida/);
  });

  it("a Helena recebe a fase em linguagem simples, sem prometer prazo", () => {
    const r = tratarJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "andamento_do_processo", arguments: {} } }, { telefone: "5511988880001" }) as any;
    const texto = r.result.content[0].text as string;
    expect(texto).toMatch(/Fase do processo \(6 de 9\): Sentença/);
    expect(texto).toMatch(/NÃO prometa prazo/);
  });
});
