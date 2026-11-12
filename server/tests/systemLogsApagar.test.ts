import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { apagarLogsAntigos, createSystemLog, listSystemLogs } from "../src/services/systemLogsService";

const novo = (titulo: string, diasAtras: number) => {
  const l = createSystemLog({ nivel: "info", categoria: "teste", evento: "e", titulo, origem: "sistema" });
  db.prepare("UPDATE system_logs SET created_at = datetime('now', '-' || ? || ' days') WHERE id = ?").run(diasAtras, l.id);
};

describe("apagar registros antigos da atividade do sistema", () => {
  beforeEach(() => { db.exec("DELETE FROM system_logs"); novo("recente", 1); novo("meio", 40); novo("velho", 120); });

  it("apaga só o que passou do período", () => {
    expect(apagarLogsAntigos(30)).toBe(2);
    expect(listSystemLogs().map((l) => l.titulo)).toEqual(["recente"]);
  });
  it("«todos» limpa tudo", () => {
    expect(apagarLogsAntigos("todos")).toBe(3);
    expect(listSystemLogs()).toHaveLength(0);
  });
  it("recusa períodos inválidos", () => {
    expect(() => apagarLogsAntigos(0)).toThrow();
    expect(() => apagarLogsAntigos("abc")).toThrow();
    expect(() => apagarLogsAntigos(2)).toThrow();
    expect(listSystemLogs()).toHaveLength(3);
  });
});
