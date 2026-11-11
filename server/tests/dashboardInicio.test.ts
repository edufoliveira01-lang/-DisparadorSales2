import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import "../src/zapsign/contratos";
import { guardarRetrato, normalizarRetrato } from "../src/atendimento/indicadores";
import { dashboardDoInicio, ultimosMeses } from "../src/services/gestao/dashboard";

const MES = "2026-11";
const contrato = (status: string, criado: string, assinado: string | null) =>
  db.prepare("INSERT INTO zapsign_contratos(doc_token,sign_url,status,criado_em,assinado_em) VALUES ('t','u',?,?,?)").run(status, criado, assinado);
let seq = 0;
const processo = (distribuicao: string, criado = "2026-11-02 10:00:00") => {
  seq++;
  db.prepare("INSERT INTO gestao_processos(numero,chave,pasta,data_distribuicao,criado_em,status) VALUES (?,?,?,?,?, 'ativo')").run(`N${seq}`, `c${seq}`, `p${seq}`, distribuicao, criado);
};
const compromisso = (tipo: string, data: string, lembrete: string | null = null, tel = "13974045973") => {
  seq++;
  db.prepare(
    `INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,data_hora_ms,status,ultimo_lembrete_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'ativa', ?)`,
  ).run(`card${seq}`, tipo, tipo.toLowerCase(), `Cliente ${seq}`, `cliente${seq}`, tel, tel, `P${seq}`, `p${seq}`, data, "09:30", Date.parse(`${data}T12:30:00Z`), lembrete);
};

beforeEach(() => {
  db.exec("DELETE FROM zapsign_contratos; DELETE FROM gestao_processos; DELETE FROM pericias_agendadas; DELETE FROM gestao_tarefas;");
});

describe("meses do gráfico", () => {
  it("devolve os 6 últimos meses, do mais antigo ao mais novo", () => {
    expect(ultimosMeses("2026-11")).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(ultimosMeses("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("dashboard do Início", () => {
  it("conta contratos assinados e enviados no mês, e os que ainda esperam a assinatura", () => {
    contrato("assinado", "2026-11-01 09:00:00", "2026-11-03 10:00:00");
    contrato("assinado", "2026-10-28 09:00:00", "2026-11-05 10:00:00");
    contrato("assinado", "2026-09-10 09:00:00", "2026-09-12 10:00:00");
    contrato("enviado", "2026-11-09 09:00:00", null);
    const c = dashboardDoInicio(MES, false).contratos!;
    expect(c.assinados_mes).toBe(2);
    expect(c.enviados_mes).toBe(2);
    expect(c.aguardando_assinatura).toBe(1);
    expect(c.serie.find((x) => x.mes === "2026-09")?.total).toBe(1);
  });

  it("conta processos protocolados (distribuição) no mês e separa os cadastrados", () => {
    processo("2026-11-04");
    processo("2026-11-20");
    processo("2026-10-15");
    processo("", "2026-11-05 10:00:00");
    const p = dashboardDoInicio(MES, false).processos;
    expect(p.protocolados_mes).toBe(2);
    expect(p.cadastrados_mes).toBe(4);
    expect(p.ativos).toBe(4);
    expect(p.serie.find((x) => x.mes === "2026-10")?.total).toBe(1);
  });

  it("perícias e audiências: separa por tipo e conta quem ainda vai ser avisado", () => {
    const d = dashboardDoInicio("2026-11", false);
    const amanha = new Date(Date.parse(`${d.hoje}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    compromisso("Perícia médica", d.hoje);
    compromisso("Audiência de instrução", amanha);
    compromisso("Perícia médica", amanha, "2026-11-10 08:00:00");
    compromisso("Perícia social", amanha, null, "");
    const r = dashboardDoInicio(d.hoje.slice(0, 7), false).periciasEAudiencias;
    expect(r.hoje).toHaveLength(1);
    expect(r.hoje_total).toBe(1);
    expect(r.proximos.map((c) => c.eh_audiencia).sort()).toEqual([false, false, true]);
    expect(r.semana_total).toBe(4);
    // os de hoje com horário já passado não entram em «para avisar»; os de amanhã sem lembrete entram (3 menos o já avisado)
    expect(r.para_avisar).toBeGreaterThanOrEqual(2);
    expect(r.sem_telefone).toBe(1);
  });

  it("financeiro só aparece para quem pode ver; sem permissão vem nulo", () => {
    expect(dashboardDoInicio(MES, false).financeiro).toBeNull();
    expect(dashboardDoInicio(MES, true).financeiro).not.toBeNull();
  });

  it("um mês inválido cai no mês atual (nunca quebra)", () => {
    expect(dashboardDoInicio("lixo", false).mes).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("retrato do atendimento (empurrado pelo Deskcomm)", () => {
  const retrato = { meses: [{ mes: "2026-11", novos: 40, qualificados: 12, desqualificados: 9, sem_interesse: 6, em_andamento: 13 }, { mes: "lixo", novos: 1 }], por_etapa: [{ nome: "Em triagem", total: 7, posicao: 2 }, { nome: "", total: 3 }], abertos: 20 };
  it("valida: ignora mês inválido e etapa sem nome, e recusa o que não tem meses", () => {
    const r = normalizarRetrato(retrato)!;
    expect(r.meses).toHaveLength(1);
    expect(r.por_etapa).toHaveLength(1);
    expect(normalizarRetrato({ lixo: 1 })).toBeNull();
    expect(normalizarRetrato(null)).toBeNull();
  });
  it("guarda e o painel mostra o mês pedido, com zeros nos meses sem dado", () => {
    guardarRetrato(retrato);
    const a = dashboardDoInicio("2026-11", false).atendimento!;
    expect(a.mes).toMatchObject({ novos: 40, qualificados: 12, desqualificados: 9 });
    expect(a.serie).toHaveLength(6);
    expect(a.serie[0]!.novos).toBe(0);
    expect(a.abertos).toBe(20);
  });
});
