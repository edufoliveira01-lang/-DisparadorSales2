import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import "../src/zapsign/contratos";
import { guardarRetrato } from "../src/atendimento/indicadores";
import { captacao } from "../src/services/gestao/captacao";
import { dashboardDoInicio } from "../src/services/gestao/dashboard";
import {
  garantirNegociosDosAssinados, lerFontes, normalizarFonte, obterNegocio, pendentesDePreenchimento, registrarAssinatura, registrarContratoGerado, salvarFontesExtras, salvarNegocio,
} from "../src/services/gestao/negocios";

let seq = 0;
const pessoa = (nome = "Cliente") => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento) VALUES (?, 'cliente', ?)").run(nome, `cpf${++seq}`).lastInsertRowid);
const usuario = () => Number((db.prepare("SELECT id FROM users LIMIT 1").get() as { id: number } | undefined)?.id ?? db.prepare("INSERT INTO users(username,password_hash,role,active) VALUES (?, 'x','administrador',1)").run(`u${++seq}`).lastInsertRowid);
const contratoAssinado = (pessoaId: number, quando: string) => db.prepare("INSERT INTO zapsign_contratos(pessoa_id,doc_token,sign_url,status,criado_em,assinado_em) VALUES (?, 't','u','assinado',?,?)").run(pessoaId, quando, quando);

beforeEach(() => {
  db.exec("DELETE FROM gestao_negocios; DELETE FROM zapsign_contratos; DELETE FROM gestao_processos; DELETE FROM settings WHERE chave IN ('gestao_fontes_extras','atendimento_indicadores');");
});

describe("fonte do lead", () => {
  it("traduz o texto do atendimento para uma fonte do escritório", () => {
    expect(normalizarFonte("meta_ads")).toBe("meta");
    expect(normalizarFonte("Facebook")).toBe("meta");
    expect(normalizarFonte("Google Ads")).toBe("google");
    expect(normalizarFonte("Instagram")).toBe("instagram");
    expect(normalizarFonte("indicação de cliente")).toBe("indicacao_cliente");
    expect(normalizarFonte("indicação parceiro")).toBe("indicacao_parceiro");
    expect(normalizarFonte("site")).toBe("site");
    expect(normalizarFonte("")).toBe("");
    expect(normalizarFonte("panfleto")).toBe("evento");
    expect(normalizarFonte("algo estranho")).toBe("outro");
  });
  it("fontes acrescentadas pelo escritório entram na lista e são reconhecidas", () => {
    const l = salvarFontesExtras(["Rádio Cidade", "rádio cidade", "Google"]);
    expect(l.map((f) => f.rotulo)).toContain("Rádio Cidade");
    expect(l.filter((f) => f.rotulo === "Rádio Cidade")).toHaveLength(1);
    expect(lerFontes().at(-1)!.chave).toBe("outro");
    expect(normalizarFonte("rádio cidade")).toBe("custom_radio_cidade");
  });
});

describe("negócio do cliente", () => {
  it("o contrato gerado cria o negócio online, aguardando análise, com a fonte e a entrada do atendimento — sem pisar no que a equipe preencheu", () => {
    const p = pessoa();
    registrarContratoGerado(p, { fonte: "meta_ads", entrada: "2026-10-20" });
    expect(obterNegocio(p)).toMatchObject({ fonte: "meta", tipo_atendimento: "online", qualificacao: "aguardando", data_entrada: "2026-10-20" });
    salvarNegocio(p, { fonte: "indicacao_cliente" }, usuario());
    registrarContratoGerado(p, { fonte: "google", entrada: "2026-09-01" });
    expect(obterNegocio(p)).toMatchObject({ fonte: "indicacao_cliente", data_entrada: "2026-10-20" });
  });
  it("a assinatura grava a data do fechamento uma vez só", () => {
    const p = pessoa();
    registrarAssinatura(p, "2026-11-05T10:00:00Z");
    registrarAssinatura(p, "2026-11-20T10:00:00Z");
    expect(obterNegocio(p)).toMatchObject({ data_fechamento: "2026-11-05", qualificacao: "aguardando" });
  });
  it("quem decide a qualificação fica registrado; não qualificado exige motivo", () => {
    const p = pessoa();
    const u = usuario();
    expect(() => salvarNegocio(p, { qualificacao: "nao_qualificado" }, u)).toThrow(/motivo/i);
    const n = salvarNegocio(p, { qualificacao: "nao_qualificado", motivo: "prazo_vencido", tipo_atendimento: "presencial", fechado_por_user_id: u }, u);
    expect(n).toMatchObject({ qualificacao: "nao_qualificado", motivo: "prazo_vencido", tipo_atendimento: "presencial" });
    expect(n.qualificado_por).toBeTruthy();
    expect(salvarNegocio(p, { qualificacao: "qualificado" }, u).motivo).toBe("");
  });
  it("recusa valores fora da lista", () => {
    const p = pessoa();
    expect(() => salvarNegocio(p, { fonte: "inventada" }, usuario())).toThrow();
    expect(() => salvarNegocio(p, { tipo_atendimento: "telepatia" }, usuario())).toThrow();
    expect(() => salvarNegocio(p, { fechado_por_user_id: 99999 }, usuario())).toThrow();
    expect(() => salvarNegocio(99999, {}, usuario())).toThrow(/não encontrado/i);
  });
  it("clientes antigos que já assinaram viram «não informada» e aparecem para a equipe preencher", () => {
    const p = pessoa("Antigo");
    contratoAssinado(p, "2026-03-10 09:00:00");
    expect(garantirNegociosDosAssinados()).toBe(1);
    expect(garantirNegociosDosAssinados()).toBe(0);
    expect(obterNegocio(p)).toMatchObject({ qualificacao: "nao_informada", data_fechamento: "2026-03-10" });
    expect(pendentesDePreenchimento().map((x) => (x as { nome: string }).nome)).toContain("Antigo");
  });
});

describe("tela Captação", () => {
  it("conta o ano mês a mês, por fonte, atendimento, responsável e motivo", () => {
    const u = usuario();
    const a = pessoa("A"), b = pessoa("B"), c = pessoa("C"), d = pessoa("D");
    salvarNegocio(a, { fonte: "meta", tipo_atendimento: "online", qualificacao: "qualificado", data_fechamento: "2026-11-03", fechado_por_user_id: u, area: "previdenciario" }, u);
    salvarNegocio(b, { fonte: "meta", tipo_atendimento: "online", qualificacao: "nao_qualificado", motivo: "prazo_vencido", data_fechamento: "2026-11-10" }, u);
    salvarNegocio(c, { fonte: "indicacao_cliente", tipo_atendimento: "presencial", qualificacao: "aguardando", data_entrada: "2026-11-02", data_fechamento: "2026-10-30" }, u);
    salvarNegocio(d, { fonte: "google", tipo_atendimento: "presencial", qualificacao: "qualificado", data_entrada: "2026-10-05", data_fechamento: "2026-10-20" }, u);
    guardarRetrato({ meses: [{ mes: "2026-11", novos: 30, qualificados: 5, desqualificados: 3, sem_interesse: 2, em_andamento: 20, fontes: { meta_ads: 18, Instagram: 12 } }, { mes: "2026-10", novos: 25, fontes: { meta_ads: 25 } }] });
    const r = captacao("2026", null);
    const nov = r.meses.find((m) => m.mes === "2026-11")!;
    expect(nov).toMatchObject({ entraram_atendimento: 30, entraram_presencial: 1, entraram: 31, fecharam: 2, qualificados: 1, nao_qualificados: 1 });
    const out = r.meses.find((m) => m.mes === "2026-10")!;
    expect(out).toMatchObject({ fecharam: 2, qualificados: 1, aguardando: 1, entraram_atendimento: 25, entraram_presencial: 1 });
    expect(r.total.fecharam).toBe(4);
    expect(r.total.qualificados).toBe(2);
    const meta = r.por_fonte.find((f) => f.chave === "meta")!;
    expect(meta).toMatchObject({ entraram: 43, fecharam: 2, qualificados: 1, nao_qualificados: 1 });
    expect(r.por_fonte.find((f) => f.chave === "instagram")?.entraram).toBe(12);
    expect(r.por_atendimento.find((x) => x.chave === "presencial")?.fecharam).toBe(2);
    expect(r.motivos[0]).toMatchObject({ chave: "prazo_vencido", total: 1 });
    expect(r.por_responsavel.some((x) => x.fecharam >= 1)).toBe(true);
    expect(r.funil.fecharam).toBe(4);
  });
  it("filtrando por mês, os recortes olham só aquele mês", () => {
    const u = usuario();
    salvarNegocio(pessoa(), { fonte: "meta", qualificacao: "qualificado", data_fechamento: "2026-11-03" }, u);
    salvarNegocio(pessoa(), { fonte: "google", qualificacao: "qualificado", data_fechamento: "2026-10-03" }, u);
    const r = captacao("2026", "2026-11");
    expect(r.por_fonte.map((f) => f.chave)).toEqual(["meta"]);
    expect(r.meses).toHaveLength(12);
  });
  it("sem nenhum dado, devolve tudo zerado e nunca quebra", () => {
    const r = captacao("lixo", "lixo");
    expect(r.meses).toHaveLength(12);
    expect(r.total.fecharam).toBe(0);
    expect(r.por_fonte).toEqual([]);
  });
});

describe("dashboard usa a qualificação registrada", () => {
  it("conta qualificados, não qualificados e aguardando pelo mês do fechamento", () => {
    const u = usuario();
    salvarNegocio(pessoa(), { qualificacao: "qualificado", data_fechamento: "2026-11-03" }, u);
    salvarNegocio(pessoa(), { qualificacao: "aguardando", data_fechamento: "2026-11-04" }, u);
    salvarNegocio(pessoa(), { qualificacao: "nao_qualificado", motivo: "outro", data_fechamento: "2026-11-05" }, u);
    const n = dashboardDoInicio("2026-11", false).negocios!;
    expect(n).toMatchObject({ fecharam_mes: 3, qualificados_mes: 1, aguardando_mes: 1, nao_qualificados_mes: 1 });
  });
});
