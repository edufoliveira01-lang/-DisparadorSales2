import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { createPericiaAgendadaManual, podarPericiasAgendadasAntigas } from "../src/services/periciasAgendadasService";
import { listarPericiasSemLaudo, atualizarAcompanhamentoPericia } from "../src/services/djen/periciaIntegration";
import { identificarObrigacoesExternas } from "../src/services/djen/obligations";
import { sugestoesPrazos } from "../src/services/djen/deadlines";
import { salvarPrazo } from "../src/services/djen/workflow";
import { diagnosticoAcompanhamentos } from "../src/services/djen/followUpDiagnostics";
let serial = 0;
function pericia(dias: number, processo = `123456${++serial}`, tipo = "Perícia Médica") {
  const row = createPericiaAgendadaManual({ tipo, nome: `CLIENTE ${serial}`, telefone: "11999998888", processo, data: "20/12/2030", horario: "14:30", local: "Clínica", whatsapp: "SIM", profissional_perito: "Perito" });
  db.prepare("UPDATE pericias_agendadas SET data_hora_ms=?,created_at=datetime('now','-200 days') WHERE id=?").run(Date.now() - dias * 86400000, row.id);
  return row;
}
function publicar(processo: string, texto: string, categoria = "[]") {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(processo, processo);
  return Number(db.prepare("INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json) VALUES (?,?,'TJSP','Vara','Comum','Despacho','Intimação',date('now'),?,?)").run(`coverage-${++serial}`, processo, texto, categoria).lastInsertRowid);
}
beforeEach(() => { db.exec("DELETE FROM pericias_agendadas; DELETE FROM djen_publicacoes; DELETE FROM djen_processos;"); });
describe("cobertura real do acompanhamento", () => {
  it("só alerta após 60 dias, exclui audiências e encerra com laudo posterior ou resolução", () => {
    pericia(59); const antiga = pericia(61); pericia(100, undefined, "Audiência online");
    expect(listarPericiasSemLaudo().map((p: any) => p.pericia_id)).toEqual([antiga.id]);
    const pub = publicar(antiga.processo_chave, "Laudo pericial juntado.", '["laudo_juntado"]');
    expect(listarPericiasSemLaudo()).toEqual([]);
    db.prepare("UPDATE djen_publicacoes SET cancelada=1 WHERE id=?").run(pub);
    expect(listarPericiasSemLaudo()).toHaveLength(1);
    atualizarAcompanhamentoPericia(antiga.id, { status: "resolvido" });
    expect(listarPericiasSemLaudo()).toEqual([]);
  });
  it("preserva futuro e perícia ativa sem laudo mesmo com cadastro antigo; limpa somente encerradas", () => {
    const futura = pericia(-10); const ativa = pericia(120); const resolvida = pericia(120);
    atualizarAcompanhamentoPericia(resolvida.id, { status: "resolvido" });
    expect(podarPericiasAgendadasAntigas(90)).toBe(1);
    expect(db.prepare("SELECT id FROM pericias_agendadas ORDER BY id").all()).toEqual([{ id: futura.id }, { id: ativa.id }]);
    expect(listarPericiasSemLaudo()).toMatchObject([{ pericia_id: ativa.id }]);
  });
  it("expõe a falta de processo no diagnóstico sem criar alerta sem vínculo", () => {
    pericia(100, ""); expect(listarPericiasSemLaudo()).toEqual([]);
    expect(diagnosticoAcompanhamentos().pericias).toMatchObject({ ativas: 1, sem_processo: 1 });
  });
  it("reconhece Sr. Perito e separa ordem externa de prazo do escritório", () => {
    const texto = "Intime-se o Sr. Perito para apresentar o laudo em 15 (quinze) dias. Intime-se a autora para se manifestar em 5 dias.";
    expect(identificarObrigacoesExternas(texto)).toMatchObject([{ responsavel: "Perito", prazo_citado_dias: 15 }]);
    const s = sugestoesPrazos({ tribunal: "TJSP", orgao: "Vara", texto });
    expect(s.candidatos.map((c) => c.dias)).toEqual([5]); expect(s.obrigacoes_externas).toHaveLength(1);
  });
  it("preserva responsabilidade em edição legada e não presume responsável em prazo antigo", () => {
    const id = publicar("123999", "Ciência."); const data = { descricao: "Manifestação", inicio: "2026-10-01", termino: "2026-10-15", status: "aberto", observacoes: "" };
    const legado = salvarPrazo(id, data); expect(db.prepare("SELECT responsavel FROM djen_prazos WHERE id=?").get(legado)).toEqual({ responsavel: "nao_identificado" });
    const externo = salvarPrazo(id, { ...data, responsavel: "parte_contraria" });
    salvarPrazo(id, { ...data, descricao: "Conferir cumprimento" }, externo);
    expect(db.prepare("SELECT responsavel FROM djen_prazos WHERE id=?").get(externo)).toEqual({ responsavel: "parte_contraria" });
    expect(() => salvarPrazo(id, { ...data, responsavel: "qualquer" })).toThrow();
  });
});
