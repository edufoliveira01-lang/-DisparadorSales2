import { describe, expect, it } from "vitest";
import { classificarComplementar } from "../src/services/djen/classificacaoComplementar";
import { CATEGORIAS_DJEN, validarAnaliseCodex, type AnaliseCodex } from "../src/services/djen/classifier";

const cats = (t: string, classe = "") => classificarComplementar(t, { classe }).categorias;

describe("classificação complementar (reduz Outros)", () => {
  it("recurso e contrarrazões", () => {
    expect(cats("Recurso inominado interposto pelo INSS. Intime-se a parte autora para apresentar contrarrazões no prazo de 10 dias.")).toContain("recurso");
    expect(cats("Desta decisão cabe recurso inominado no prazo de 10 dias.")).not.toContain("recurso");
  });
  it("emenda à inicial, citação, audiência, arquivamento, trânsito, cálculos", () => {
    expect(cats("Fica a parte autora regularmente intimada a promover EMENDA À INICIAL, no prazo improrrogável de 15 (quinze) dias.")).toContain("emenda_inicial");
    expect(cats("Recebo a inicial. Cite-se o INSS para contestar a ação.")).toContain("citacao_contestacao");
    expect(cats("Designo audiência de instrução para o dia 10/12/2026, às 14h.")).toContain("audiencia");
    expect(cats("Certifico o trânsito em julgado da sentença. Arquivem-se os autos com baixa definitiva.")).toEqual(expect.arrayContaining(["transito_julgado", "arquivamento"]));
    expect(cats("Remetam-se os autos à contadoria para elaboração dos cálculos de liquidação.")).toContain("calculos");
  });
  it("implantação do benefício e vista do laudo", () => {
    expect(cats("Oficie-se à CEAB para implantar o benefício concedido em tutela de urgência.")).toContain("implantacao_beneficio");
    expect(cats("Intimem-se as partes para manifestação sobre o laudo pericial no prazo de 15 dias.")).toContain("vista_laudo");
    expect(cats("Intime-se o perito para apresentar o laudo no prazo de 30 dias.")).not.toContain("vista_laudo");
  });
  it("hipótese, pedido e negação não classificam", () => {
    expect(cats("A parte autora requer a designação de audiência.")).not.toContain("audiencia");
    expect(cats("Não designo audiência neste momento.")).not.toContain("audiencia");
    expect(cats("Arquivamento provisório pelo prazo de sobrestamento.")).not.toContain("arquivamento");
    expect(cats("Vistos. Aguarde-se.")).toEqual([]);
  });
  it("categorias novas existem no catálogo e passam na validação com evidência literal", () => {
    expect(CATEGORIAS_DJEN).toEqual(expect.arrayContaining(["recurso", "emenda_inicial", "audiencia", "vista_laudo", "arquivamento"]));
    const texto = "Recurso inominado interposto pelo INSS. Intime-se a parte autora para contrarrazões no prazo de 10 dias.";
    const analise: AnaliseCodex = { situacao: "Recurso do INSS", categorias: [], resultado: "nao_identificado", resumo: "INSS recorreu.", justificativa: "Recurso interposto.",
      evidencias: [], agendamento: { data: null, horario: null, local: null }, providencia: { tipo: "ciencia", descricao: null, prazo_texto: null, responsavel: "indeterminado" }, alertas: [] };
    const r = validarAnaliseCodex(analise, texto);
    expect(r.categorias).toContain("recurso");
    expect(r.alertas.join(" ")).not.toMatch(/removida/);
  });
});
