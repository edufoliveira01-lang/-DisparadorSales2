import { describe, expect, it } from "vitest";
import { renderMessages } from "../src/services/templateRenderer";
import type { Pericia } from "../src/services/parserService";

const template = {
  conteudo_1_pericia: "Olá {{NOME}}, sua perícia de {{TIPO_PERICIA}} é em {{DATA}} às {{HORARIO}} em {{LOCAL}}.",
  conteudo_2_pericias:
    "Olá {{NOME}}.{{#each PERICIAS}} [{{TIPO_PERICIA}} {{DATA}} {{HORARIO}} {{LOCAL}}]{{/each}}",
  modo_envio_2_pericias: "combinada" as const,
};

const p1: Pericia = {
  tipo: "Médica",
  data: "01/01/2026",
  horario: "10:00",
  local: "Local A",
  nome: "Ana",
  telefone: "(11) 99999-9999",
  whatsapp: "SIM",
  processo: "5001306-35.2026.4.03.6321",
  profissionalPerito: "Dra. Maria Souza",
};
const p2: Pericia = { tipo: "Social", data: "02/01/2026", horario: "11:00", local: "Local B", nome: "Ana" };

describe("renderMessages", () => {
  it("renderiza 1 mensagem para 1 perícia", () => {
    const result = renderMessages(template, "Ana", [p1]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("Olá Ana, sua perícia de Médica é em 01/01/2026 às 10:00 em Local A.");
  });

  it("renderiza 1 mensagem combinada para 2 perícias no modo 'combinada'", () => {
    const result = renderMessages(template, "Ana", [p1, p2]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("[Médica 01/01/2026 10:00 Local A]");
    expect(result[0]).toContain("[Social 02/01/2026 11:00 Local B]");
  });

  it("renderiza 2 mensagens separadas para 2 perícias no modo 'separadas'", () => {
    const result = renderMessages({ ...template, modo_envio_2_pericias: "separadas" }, "Ana", [p1, p2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Olá Ana, sua perícia de Médica é em 01/01/2026 às 10:00 em Local A.");
    expect(result[1]).toBe("Olá Ana, sua perícia de Social é em 02/01/2026 às 11:00 em Local B.");
  });

  it("retorna array vazio quando não há perícias", () => {
    expect(renderMessages(template, "Ana", [])).toEqual([]);
  });

  it("renderiza telefone, WhatsApp, processo e profissional/perito", () => {
    const completo = {
      ...template,
      conteudo_1_pericia:
        "{{NOME}} | {{TELEFONE}} | {{WHATSAPP}} | {{PROCESSO}} | {{PROFISSIONAL_PERITO}}",
    };
    const result = renderMessages(completo, "Ana", [p1]);

    expect(result[0]).toBe(
      "Ana | (11) 99999-9999 | SIM | 5001306-35.2026.4.03.6321 | Dra. Maria Souza"
    );
  });
});
