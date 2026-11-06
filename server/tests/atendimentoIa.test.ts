import { describe, expect, it } from "vitest";
import { lerAtendimentoIa, montarPromptDoAgente, pendenciasDoAtendimentoIa, salvarAtendimentoIa, AREAS_PRONTAS } from "../src/services/gestao/atendimentoIa";
import { salvarEscritorio } from "../src/services/gestao/escritorio";

describe("Atendimento com IA — cadastro e prompt do agente", () => {
  it("começa com as áreas prontas desligadas e mostra o que falta", () => {
    const c = lerAtendimentoIa();
    expect(c.areas.map((a) => a.id)).toEqual(AREAS_PRONTAS.map((a) => a.id));
    expect(c.areas.every((a) => !a.ativa)).toBe(true);
    expect(pendenciasDoAtendimentoIa(c, { nome: "", razao_social: "", telefones: [], advogados: [] } as never).join(" ")).toContain("área");
  });

  it("gera o prompt com os dados do escritório, o nome do agente, as áreas e a triagem; áreas próprias entram", () => {
    salvarEscritorio({ nome: "Sales & Associados", cidade: "Santos", uf: "sp", endereco: "Rua A, 10", telefones: ["(13) 3333-4444"], email: "contato@x.com", advogados: [{ tratamento: "Dr.", nome: "Pedro Sales", oab: "OAB/SP 1" }] });
    const salvo = salvarAtendimentoIa({
      nome_agente: "Sofia", horario: "segunda a sexta, das 9h às 18h", urgencia: "(13) 99999-0000",
      honorarios_politica: "Trabalhamos com êxito; o atendente apresenta as condições.",
      areas: [
        { id: "previdenciario", ativa: true }, { id: "trabalhista", ativa: false },
        { nome: "Consumidor", ativa: true, triagem: "O que foi cobrado?\nDesde quando?", documentos: ["Fatura", "Protocolo"] },
      ],
    });
    expect(salvo.areas.find((a) => a.id === "previdenciario")).toMatchObject({ ativa: true });
    expect(salvo.areas.find((a) => a.id === "previdenciario")!.triagem.length).toBeGreaterThan(2); // a área pronta já vem preenchida
    expect(salvo.areas.find((a) => a.nome === "Consumidor")).toMatchObject({ propria: true, ativa: true, triagem: ["O que foi cobrado?", "Desde quando?"] });

    const p = montarPromptDoAgente();
    expect(p).toContain("**Sofia**, assistente virtual do **Sales & Associados**");
    expect(p).toContain("Rua A, 10, Santos/SP");
    expect(p).toContain("(13) 3333-4444");
    expect(p).toContain("Dr. Pedro Sales");
    expect(p).toContain("previdenciário, consumidor"); // só as áreas ligadas
    expect(p).not.toContain("**Trabalhista**");
    expect(p).toContain("O que foi cobrado?");
    expect(p).toContain("Trabalhamos com êxito");
    expect(p).toContain("segunda a sexta, das 9h às 18h");
    expect(p).toContain("(13) 99999-0000");
    expect(p).not.toMatch(/\{\{|\}\}/);
    for (const f of ["consultar_cliente", "andamento_do_processo", "proximos_compromissos", "documentos_do_cliente", "financeiro_do_cliente"]) expect(p).toContain(f);
    expect(p).toContain("Só responda com o que a ferramenta devolveu");
    expect(p).toContain("a rogo");
    expect(p).toContain("crm_enviar_contrato");
    expect(p).toContain("Só use a ferramenta depois que ela confirmar os dados");
    expect(p).toContain("não mande outra igual");
  });
  it("sem política de honorários o agente não informa valores; área ligada exige triagem; chaves {{ }} são removidas", () => {
    salvarAtendimentoIa({ areas: [{ id: "previdenciario", ativa: true }] });
    expect(montarPromptDoAgente()).toContain("não informa valores nem percentuais");
    expect(() => salvarAtendimentoIa({ areas: [{ nome: "Criminal", ativa: true, triagem: "" }] })).toThrow(/triagem/);
    expect(salvarAtendimentoIa({ observacoes: "Use {{isto}}" }).observacoes).toBe("Use isto");
    // volta ao estado inicial para os outros testes
    salvarAtendimentoIa({});
  });
});
