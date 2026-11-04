import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { listarObrigacoesExternas, atualizarObrigacaoExterna } from "../src/services/djen/externalFollowUp";
import { identificarObrigacoesExternas, cumprimentoIdentificado } from "../src/services/djen/obligations";
import { listarIdsPublicacoes, listarPublicacoes } from "../src/services/djen/store";
import { concluirProcessosSelecionados } from "../src/services/djen/bulk";

let serial = 0;
function publicar(chave: string, data: string, texto: string) {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  return Number(db.prepare(
    `INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(`follow-up-${++serial}`, chave, "TJSP", "Vara", "Procedimento comum", "Despacho", "Intimação", data, texto).lastInsertRowid);
}
beforeEach(() => {
  db.exec("DELETE FROM djen_acompanhamentos_obrigacoes; DELETE FROM djen_acompanhamentos_aguardo; DELETE FROM djen_publicacao_advogados; DELETE FROM djen_publicacoes; DELETE FROM djen_processos; UPDATE djen_config SET aguardo_dias=30,ia_ativa=0");
});

describe("obrigações externas capturadas", () => {
  it("distingue destinatário e não toma ordem do INSS como obrigação do perito citado", () => {
    expect(identificarObrigacoesExternas("Intime-se o INSS para manifestar-se sobre o laudo do perito em 10 dias.").map((x) => x.tipo)).toEqual(["parte_contraria"]);
    expect(identificarObrigacoesExternas("Intime-se a autora para manifestar-se sobre o INSS em 10 dias.")).toEqual([]);
    expect(identificarObrigacoesExternas("O INSS foi intimado para implantar o benefício em 30 dias.").map((x) => x.tipo)).toEqual(["inss_implantacao"]);
    expect(identificarObrigacoesExternas("O perito de cálculos foi intimado para apresentar cálculos em 20 dias.").map((x) => x.tipo)).toEqual(["perito_calculos"]);
    expect(identificarObrigacoesExternas("O perito é intimado para manifestação e complementação do laudo em 15 dias.").map((x) => x.tipo)).toEqual(["perito_esclarecimentos"]);
  });
  it("não encerra com publicação irrelevante; encerra só por cumprimento explícito posterior", () => {
    const ordem = publicar("processo-a", "2000-01-01", "Intime-se o perito para complementar o laudo em 15 dias.");
    publicar("processo-a", "2000-02-01", "Foi juntada uma petição da parte autora.");
    expect(listarObrigacoesExternas()).toMatchObject([{ publicacao_id: ordem, tipo: "perito_esclarecimentos", prazo_citado_dias: 15 }]);
    publicar("processo-a", "2000-03-01", "O perito apresentou esclarecimentos aos autos.");
    expect(listarObrigacoesExternas()).toEqual([]);
  });
  it("nova intimação substitui a antiga e pede conferência da ciência pessoal do INSS", () => {
    publicar("processo-b", "2000-01-01", "Intime-se o INSS para implantar o benefício em 30 dias.");
    const recente = publicar("processo-b", new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }), "Intime-se o INSS para implantar o benefício em 30 dias.");
    // Ainda dentro dos 30 dias: não é caso de acompanhamento (só entra o que já passou do prazo).
    expect(listarObrigacoesExternas()).toEqual([]);
    db.prepare("UPDATE djen_publicacoes SET data_disponibilizacao='2000-02-01' WHERE id=?").run(recente);
    // Vencido o menor prazo possível, entra, sem inventar vencimento (a ciência pessoal precisa ser conferida).
    expect(listarObrigacoesExternas()).toMatchObject([{ publicacao_id: recente, tipo: "inss_implantacao", prazo_pendente: true, prazo_termino: null, dias_espera: 30 }]);
    atualizarObrigacaoExterna(recente, "inss_implantacao", "cobrado");
    expect(listarObrigacoesExternas()[0].acompanhamento_status).toBe("cobrado");
    atualizarObrigacaoExterna(recente, "inss_implantacao", "resolvido");
    expect(listarObrigacoesExternas()).toEqual([]);
  });
  it("não usa uma intimação futura como comprovação de implantação", () => {
    expect(cumprimentoIdentificado("inss_implantacao", "Intime-se o INSS para comprovar que o benefício foi implantado.")).toBe(false);
    expect(cumprimentoIdentificado("inss_implantacao", "O benefício será implantado pelo INSS.")).toBe(false);
    expect(cumprimentoIdentificado("perito_laudo", "Aguarde-se o laudo pericial e, após juntado, dê-se vista às partes.")).toBe(false);
    expect(cumprimentoIdentificado("inss_implantacao", "O benefício foi implantado pelo INSS.")).toBe(true);
  });
});

describe("conclusão em lote", () => {
  it("seleciona os processos do filtro e conclui todos os andamentos agrupados sem apagar outros", () => {
    const a = publicar("proc-a", "2000-01-01", "Intime-se o perito para apresentar laudo em 20 dias.");
    publicar("proc-a", "2000-01-02", "Andamento adicional do processo.");
    publicar("proc-b", "2000-01-03", "Outro processo.");
    const selecionados = listarIdsPublicacoes({ arquivo: "ativos", busca: "proc-a" });
    expect(selecionados.total).toBe(1);
    expect(concluirProcessosSelecionados(selecionados.ids)).toEqual({ processos: 1, publicacoes: 2 });
    expect(listarPublicacoes({ arquivo: "ativos" }).total).toBe(1);
    expect(listarPublicacoes({ arquivo: "concluidos" }).total).toBe(1);
    expect(listarObrigacoesExternas()).toMatchObject([{ publicacao_id: a, tipo: "perito_laudo" }]);
    expect(() => concluirProcessosSelecionados(selecionados.ids)).toThrow();
  });
});

