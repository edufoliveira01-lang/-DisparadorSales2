import { afterEach, describe, expect, it, vi } from "vitest";
import { agruparEventosParaLembrete, detectarPendenciasProcesso, periodoDoEvento } from "../src/services/lembreteUtils";
import { renderLembrete } from "../src/services/templateRenderer";
import { matchContactByNameAndProcess } from "../src/services/matcherService";
import type { Contact } from "../src/services/contactsService";
import type { PericiaAgendada } from "../src/services/periciasAgendadasService";

function evento(id: number, dataIso: string, telefoneDigits = "5511900000000"): PericiaAgendada {
  const data = new Date(dataIso);
  return {
    id,
    card_id: `card-${id}`,
    tipo: id % 2 === 0 ? "Perícia social" : "Perícia médica",
    origem: id % 2 === 0 ? "social" : "medica",
    nome: "CLIENTE EXEMPLO",
    telefone: "(11) 90000-0000",
    telefone_digits: telefoneDigits,
    processo: "0000000-00.2026.0.00.0000",
    data: data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    horario: data.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }),
    local: "Local de exemplo",
    whatsapp: "SIM",
    profissional_perito: "PROFISSIONAL EXEMPLO",
    data_hora_ms: data.getTime(),
    status: "ativa",
    substituida_por_id: null,
    fonte: "trello_sync",
    ultimo_lembrete_em: null,
    ultimo_lembrete_log_id: null,
    lembrete_ack: null,
    created_at: "2026-09-01 12:00:00",
  };
}

describe("lembretes de compromissos", () => {
  afterEach(() => vi.useRealTimers());

  it("separa hoje, amanhã, data futura e data passada", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00-03:00"));

    expect(periodoDoEvento(new Date("2026-09-04T15:00:00-03:00").getTime())).toBe("hoje");
    expect(periodoDoEvento(new Date("2026-09-05T15:00:00-03:00").getTime())).toBe("amanha");
    expect(periodoDoEvento(new Date("2026-09-25T15:00:00-03:00").getTime())).toBe("futuro");
    expect(periodoDoEvento(new Date("2026-09-03T15:00:00-03:00").getTime())).toBeNull();
  });

  it("agrupa compromissos do mesmo cliente, telefone e data", () => {
    const grupos = agruparEventosParaLembrete([
      evento(1, "2026-09-05T10:00:00-03:00"),
      evento(2, "2026-09-05T14:00:00-03:00"),
      evento(3, "2026-09-05T16:00:00-03:00", "5511911111111"),
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos.map((grupo) => grupo.eventos.length).sort()).toEqual([1, 2]);
  });

  it("não agrupa processos diferentes do mesmo nome e telefone", () => {
    const primeiro = evento(1, "2026-09-05T10:00:00-03:00");
    const segundo = { ...evento(2, "2026-09-05T14:00:00-03:00"), processo: "1111111-11.2026.1.11.1111" };
    expect(agruparEventosParaLembrete([primeiro, segundo])).toHaveLength(2);
  });

  it("usa a Agenda somente quando nome completo e processo coincidem", () => {
    const contato: Contact = {
      id: 1,
      nome: "CLIENTE EXEMPLO",
      telefone: "5511900000000",
      processo: "0000000-00.2026.0.00.0000",
      processo_chave: "00000000020260000000",
      observacoes: null,
      created_at: "",
    };
    expect(matchContactByNameAndProcess("cliente exemplo", "00000000020260000000", [contato])?.id).toBe(1);
    expect(matchContactByNameAndProcess("cliente exemplo", "9999999-99.2026.9.99.9999", [contato])).toBeNull();
    expect(matchContactByNameAndProcess("outro cliente", contato.processo, [contato])).toBeNull();
  });

  it("pede o processo quando há um único contato homônimo sem processo e o evento está sem telefone", () => {
    const contato: Contact = {
      id: 7,
      nome: "Cliente Exemplo",
      telefone: "5511988887777",
      processo: null,
      processo_chave: "",
      observacoes: null,
      created_at: "",
    };
    const primeiro = { ...evento(10, "2026-09-05T10:00:00-03:00", ""), telefone: "" };
    const segundo = { ...evento(11, "2026-09-05T14:00:00-03:00", ""), telefone: "" };

    expect(detectarPendenciasProcesso([primeiro, segundo], [contato])).toEqual([
      {
        ids: [10, 11],
        nome: "CLIENTE EXEMPLO",
        processo: "0000000-00.2026.0.00.0000",
        contato: { id: 7, nome: "Cliente Exemplo", telefone: "5511988887777" },
      },
    ]);
  });

  it("não oferece confirmação rápida quando o contato possui outro processo", () => {
    const contato: Contact = {
      id: 8,
      nome: "CLIENTE EXEMPLO",
      telefone: "5511988887777",
      processo: "1111111-11.2026.1.11.1111",
      processo_chave: "11111111120261111111",
      observacoes: null,
      created_at: "",
    };
    const compromisso = { ...evento(12, "2026-09-05T10:00:00-03:00", ""), telefone: "" };

    expect(detectarPendenciasProcesso([compromisso], [contato])).toEqual([]);
  });

  it("não escolhe automaticamente entre contatos homônimos", () => {
    const base: Contact = {
      id: 9,
      nome: "CLIENTE EXEMPLO",
      telefone: "5511988887777",
      processo: null,
      processo_chave: "",
      observacoes: null,
      created_at: "",
    };
    const compromisso = { ...evento(13, "2026-09-05T10:00:00-03:00", ""), telefone: "", processo: null };

    expect(detectarPendenciasProcesso([compromisso], [base, { ...base, id: 10, telefone: "5511977776666" }])).toEqual([]);
  });

  it("renderiza vários compromissos em uma única mensagem", () => {
    const itens = [
      {
        tipo: "Perícia médica",
        data: "05/09/2026",
        horario: "10:00",
        local: "Local A",
        nome: "CLIENTE EXEMPLO",
        telefone: "(11) 90000-0000",
      },
      {
        tipo: "Perícia social",
        data: "05/09/2026",
        horario: "14:00",
        local: "Local B",
        nome: "CLIENTE EXEMPLO",
        telefone: "(11) 90000-0000",
      },
    ];

    const mensagem = renderLembrete("Olá {{NOME}}!\n\n{{COMPROMISSOS}}", "CLIENTE EXEMPLO", itens);
    expect(mensagem).toContain("Perícia médica: 05/09/2026 às 10:00");
    expect(mensagem).toContain("Perícia social: 05/09/2026 às 14:00");
  });
});
