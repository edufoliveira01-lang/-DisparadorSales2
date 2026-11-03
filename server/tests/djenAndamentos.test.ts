import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { andamentosNoTexto, andamentoDaPublicacao } from "../src/services/djen/andamentos";
import { analisarPericiasSemLaudo, listarPericiasSemLaudo } from "../src/services/djen/periciaIntegration";

const tipos = (t: string) => andamentosNoTexto(t).map((a) => a.tipo);

describe("andamentos que superam o alerta de perícia sem laudo", () => {
  it("reconhece sentença com dispositivo longo que contém 'deverá' e 'será'", () => {
    const texto = "Ante o exposto, JULGO PROCEDENTE o pedido para condenar o INSS a implantar o benefício, que deverá ser pago com correção, e os valores atrasados serão apurados em liquidação.";
    expect(tipos(texto)).toContain("sentenca");
  });
  it("reconhece 'procedente em parte', 'julgando' e extinção", () => {
    expect(tipos("JULGO PROCEDENTE EM PARTE o pedido da autora.")).toContain("sentenca");
    expect(tipos("Julgo parcialmente procedentes os pedidos.")).toContain("sentenca");
    expect(tipos("A ação foi julgada improcedente.")).toContain("sentenca");
    expect(tipos("Julgo extinto o processo sem resolução do mérito.")).toContain("sentenca");
    expect(tipos("Após análise dos autos, julgo procedente o pedido.")).toContain("sentenca");
  });
  it("não trata hipótese, pedido, negação ou citação como sentença", () => {
    expect(tipos("A parte autora requer que o juízo julgue procedente o pedido.")).not.toContain("sentenca");
    expect(tipos("Não julgo procedente o pedido de tutela neste momento, aguarde-se o laudo.")).not.toContain("sentenca");
    expect(tipos('Conforme precedente: "julgo procedente o pedido" (outro processo).')).not.toContain("sentenca");
    expect(tipos("Aguarde-se a perícia. Após o laudo, será proferida sentença.")).not.toContain("sentenca");
  });
  it("reconhece recurso, contrarrazões, acórdão e trânsito", () => {
    expect(tipos("Recurso inominado interposto pelo INSS. Intime-se a parte autora para contrarrazões.")).toContain("recurso");
    expect(tipos("Recebo o recurso inominado apresentado pela autora.")).toContain("recurso");
    expect(tipos("A Turma Recursal, por unanimidade, negou provimento ao recurso.")).toContain("acordao");
    expect(tipos("Certifico o trânsito em julgado da sentença.")).toContain("transito_julgado");
  });
  it("hipótese de recurso e advertência de cabimento não contam", () => {
    expect(tipos("Interposto recurso, intime-se a parte contrária para contrarrazões.")).not.toContain("recurso");
    expect(tipos("Desta decisão cabe recurso inominado no prazo de 10 dias.")).not.toContain("recurso");
    expect(tipos("Intime-se a autora para manifestar-se em 10 dias.")).toEqual([]);
  });
  it("usa categoria e tipo documental quando o texto é curto", () => {
    expect(andamentoDaPublicacao({ texto: "Vistos.", categorias: ["acordao"] })?.tipo).toBe("acordao");
    expect(andamentoDaPublicacao({ texto: "Vistos.", tipo_documento: "Sentença" })?.tipo).toBe("sentenca");
    expect(andamentoDaPublicacao({ texto: "Intime-se.", categorias: ["pericia"] })).toBeNull();
  });
});

describe("perícias sem laudo", () => {
  const chave = "50150937120264047108";
  beforeEach(() => {
    db.exec("DELETE FROM djen_acompanhamentos_pericia; DELETE FROM pericias_agendadas; DELETE FROM djen_publicacoes; DELETE FROM djen_processos;");
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  });
  const pericia = (data: string) => {
    const ms = Date.parse(`${data}T13:00:00Z`);
    db.prepare(`INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms)
      VALUES ('c1','Perícia médica','pericia medica','medica','PAULO','paulo','','','5015093-71.2026.4.04.7108',?,?,'10:00','Sala 3',?)`).run(chave, data.split("-").reverse().join("/"), ms);
  };
  const publicar = (data: string, texto: string, extra: { tipo?: string; categorias?: string[] } = {}) =>
    db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`c-${Math.random()}`, chave, "TRF4", "JEF", "Procedimento", extra.tipo || "Despacho", "Intimação", data, texto, JSON.stringify(extra.categorias || []));

  it("alerta sem andamento posterior e oculta quando há sentença e recurso", () => {
    pericia("2026-09-02");
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    publicar("2026-09-20", "Intime-se a parte autora para ciência.");
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    publicar("2026-10-10", "Ante o exposto, JULGO PROCEDENTE o pedido. O INSS deverá implantar o benefício, caso não haja recurso.");
    const r = analisarPericiasSemLaudo();
    expect(r.alertas).toHaveLength(0);
    expect(r.superadas[0]).toMatchObject({ andamento: "Sentença / julgamento", data_andamento: "2026-10-10" });
  });
  it("recurso isolado também oculta", () => {
    pericia("2026-09-02");
    publicar("2026-10-25", "Recurso inominado interposto pelo INSS. Intime-se a parte autora para contrarrazões.");
    expect(listarPericiasSemLaudo()).toHaveLength(0);
  });
  it("publicação anterior à perícia não oculta", () => {
    pericia("2026-09-02");
    publicar("2026-08-01", "JULGO PROCEDENTE o pedido de tutela.");
    expect(listarPericiasSemLaudo()).toHaveLength(1);
  });
});

import { listarObrigacoesExternas } from "../src/services/djen/externalFollowUp";
describe("obrigações externas superadas por sentença com dispositivo longo", () => {
  it("não mantém cobrança do INSS depois de sentença que a detecção antiga ignorava", () => {
    const chave = "50000010120264030001";
    db.exec("DELETE FROM djen_acompanhamentos_obrigacoes; DELETE FROM djen_publicacoes; DELETE FROM djen_processos;");
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
    const ins = (data: string, texto: string) => db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(`x-${Math.random()}`, chave, "TJSP", "Vara", "Proc", "Despacho", "Intimação", data, texto);
    ins("2000-01-01", "Intime-se o INSS para apresentar contestação no prazo de 30 dias.");
    expect(listarObrigacoesExternas()).toHaveLength(1);
    ins("2000-03-01", "Ante o exposto, JULGO PROCEDENTE o pedido para condenar o INSS, que deverá pagar as parcelas, caso haja valores em atraso, na forma da lei.");
    expect(listarObrigacoesExternas()).toHaveLength(0);
  });
});
