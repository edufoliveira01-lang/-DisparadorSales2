import { afterEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { createSystemLog, listSystemLogs, recordSystemLog } from "../src/services/systemLogsService";

const prefixo = `TESTE-LOG-${Date.now()}-`;

describe("logs de sistema", () => {
  afterEach(() => {
    db.prepare("DELETE FROM system_logs WHERE titulo LIKE ?").run(`${prefixo}%`);
  });

  it("registra origem, nível e detalhes estruturados", () => {
    const criado = createSystemLog({
      nivel: "aviso",
      categoria: "notificacao",
      evento: "alerta_entrega",
      titulo: `${prefixo}alerta`,
      mensagem: "Alerta automático enviado.",
      origem: "automatico",
      detalhes: {
        tipo_verificacao: "periodica",
        canais: [{ canal: "Telegram", sucesso: true }],
        envios: [{ id: 321, enviado_em: "2026-09-08T12:00:00.000Z" }],
      },
    });

    expect(criado.id).toBeGreaterThan(0);
    expect(criado.nivel).toBe("aviso");
    expect(criado.origem).toBe("automatico");
    expect(JSON.parse(criado.detalhes_json!)).toMatchObject({
      tipo_verificacao: "periodica",
      canais: [{ canal: "Telegram", sucesso: true }],
      envios: [{ id: 321 }],
    });
  });

  it("lista os registros mais recentes primeiro", () => {
    const primeiro = createSystemLog({
      nivel: "info",
      categoria: "sistema",
      evento: "teste",
      titulo: `${prefixo}primeiro`,
      origem: "sistema",
    });
    const segundo = createSystemLog({
      nivel: "erro",
      categoria: "sistema",
      evento: "teste",
      titulo: `${prefixo}segundo`,
      origem: "sistema",
    });

    const ids = listSystemLogs(20).filter((log) => log.titulo.startsWith(prefixo)).map((log) => log.id);
    expect(ids.indexOf(segundo.id)).toBeLessThan(ids.indexOf(primeiro.id));
  });

  it("oferece gravação segura para não interromper o fluxo principal", () => {
    const criado = recordSystemLog({
      nivel: "info",
      categoria: "sistema",
      evento: "teste_seguro",
      titulo: `${prefixo}seguro`,
      origem: "sistema",
    });
    expect(criado?.titulo).toBe(`${prefixo}seguro`);
  });
});
