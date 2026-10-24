import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { concluirPublicacao } from "../src/services/djen/deadlines";
import {
  listarKanban, criarListaKanban, alterarListaKanban, ordenarListasKanban,
  excluirListaKanban, moverCartaoKanban, alterarInicioEsperaKanban, historicoCartaoKanban,
} from "../src/services/djen/kanban";

let serial = 0;
function publicar(processo: string, data: string, texto: string) {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(processo, processo);
  return Number(db.prepare(
    `INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(`kanban-${++serial}`, processo, "TRF3", "Vara", "Procedimento", "Despacho", "Intimação", data, texto).lastInsertRowid);
}
beforeEach(() => {
  db.exec("DELETE FROM djen_kanban_movimentos;DELETE FROM djen_kanban_cartoes;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_prazos;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;");
});

describe("quadro processual", () => {
  it("mantém um cartão por processo e não desloca etapas quando chega publicação nova", () => {
    publicar("500001", "2026-10-01", "Petição inicial.");
    publicar("500001", "2026-10-02", "Despacho.");
    publicar("500002", "2026-10-03", "Perícia.");
    const quadro = listarKanban();
    expect(quadro.listas[0].nome).toBe("A classificar");
    expect(quadro.listas.some((l) => l.nome === "Aguardando expedição de RPV" && l.contar_dias === 1)).toBe(true);
    expect(quadro.cartoes).toHaveLength(2);
    const sentenca = quadro.listas.find((l) => l.nome === "Sentença")!;
    moverCartaoKanban("500001", sentenca.id);
    publicar("500001", "2026-10-04", "Nova publicação do mesmo processo.");
    const atualizado = listarKanban().cartoes.find((c) => c.processo_chave === "500001")!;
    expect(atualizado.lista_id).toBe(sentenca.id);
    expect(atualizado.publicacoes_total).toBe(3);
    expect(atualizado.data_disponibilizacao).toBe("2026-10-04");
  });

  it("registra movimentos, reordena e conta dias da espera sem concluir prazo ou publicação", () => {
    const id = publicar("500003", "2026-10-01", "Aguardando expedição.");
    publicar("500004", "2026-10-02", "Outro caso.");
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,inicio,termino,status) VALUES (?,?,?,?,?)")
      .run(id, "Manifestação", "2026-10-02", "2026-10-30", "aberto");
    const rpv = listarKanban().listas.find((l) => l.nome === "Aguardando expedição de RPV")!;
    moverCartaoKanban("500003", rpv.id);
    moverCartaoKanban("500004", rpv.id, "500003");
    alterarInicioEsperaKanban("500003", "2026-08-01");
    expect(() => alterarInicioEsperaKanban("500003", "2999-01-01")).toThrow();
    expect(listarKanban().cartoes.filter((c) => c.lista_id === rpv.id).map((c) => c.processo_chave)).toEqual(["500004", "500003"]);
    concluirPublicacao(id, true);
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "500003")).toMatchObject({ inicio_espera_em: "2026-08-01", prazos_abertos: 1 });
    expect(historicoCartaoKanban("500003")).toMatchObject([{ origem: "A classificar", destino: "Aguardando expedição de RPV" }]);
    expect((db.prepare("SELECT concluida FROM djen_publicacoes WHERE id=?").get(id) as { concluida: number }).concluida).toBe(1);
  });

  it("permite criar, editar, ordenar e excluir somente listas vazias", () => {
    publicar("500005", "2026-10-01", "Proposta de acordo.");
    const quadro = listarKanban();
    const criada = criarListaKanban({ nome: "Proposta de acordo", contar_dias: true }) as { id: number; contar_dias: number };
    expect(criada.contar_dias).toBe(1);
    alterarListaKanban(criada.id, { nome: "Acordo em negociação", contar_dias: false });
    const ids = listarKanban().listas.map((l) => l.id);
    ordenarListasKanban([criada.id, ...ids.filter((id) => id !== criada.id)]);
    expect(listarKanban().listas[0].id).toBe(criada.id);
    publicar("500006", "2026-10-02", "Nova publicação.");
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "500006")!.lista_id).toBe(quadro.listas[0].id);
    moverCartaoKanban("500005", criada.id);
    expect(() => excluirListaKanban(criada.id)).toThrow(/Mova/);
    moverCartaoKanban("500005", quadro.listas[0].id);
    expect(excluirListaKanban(criada.id)).toEqual({ ok: true });
    expect(() => excluirListaKanban(quadro.listas[0].id)).toThrow(/triagem/);
    expect(() => criarListaKanban({ nome: quadro.listas[0].nome })).toThrow(/Já existe/);
  });
});
