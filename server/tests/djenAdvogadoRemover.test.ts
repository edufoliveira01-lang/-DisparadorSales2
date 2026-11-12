import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { runDjenMigrations } from "../src/db/djenMigrations";
import { DjenInputError, listarAdvogados, removerAdvogado, salvarAdvogado } from "../src/services/djen/store";

runDjenMigrations(db);

describe("remover advogado acompanhado", () => {
  beforeEach(() => {
    db.exec("DELETE FROM djen_mensagens;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;DELETE FROM djen_advogados;");
  });

  it("remove um advogado sem histórico", () => {
    const a = salvarAdvogado({ nome: "SEM HISTORICO", numero_oab: "111111", uf_oab: "SP", modo_busca: "ambos" });
    removerAdvogado(a.id);
    expect(listarAdvogados().find((x) => x.id === a.id)).toBeUndefined();
  });

  it("recusa remover quem tem publicações vinculadas e orienta a pausar", () => {
    const a = salvarAdvogado({ nome: "COM HISTORICO", numero_oab: "222222", uf_oab: "SP", modo_busca: "ambos" });
    const pub = db.prepare("SELECT sql FROM sqlite_master WHERE name='djen_publicacoes'").get() as { sql: string };
    expect(pub.sql).toContain("djen_publicacoes");
    // vínculo mínimo: desliga FKs só para inserir a linha de ligação sem montar uma publicação completa
    db.pragma("foreign_keys = OFF");
    db.prepare("INSERT INTO djen_publicacao_advogados(publicacao_id,advogado_id,correspondencia) VALUES (999999,?,?)").run(a.id, "oab");
    db.pragma("foreign_keys = ON");
    expect(() => removerAdvogado(a.id)).toThrow(DjenInputError);
    expect(() => removerAdvogado(a.id)).toThrow(/pause as consultas/);
    expect(listarAdvogados().some((x) => x.id === a.id)).toBe(true);
    db.exec("DELETE FROM djen_publicacao_advogados;");
  });

  it("avisa quando o advogado não existe", () => {
    expect(() => removerAdvogado(424242)).toThrow(/não encontrado/);
  });
});
