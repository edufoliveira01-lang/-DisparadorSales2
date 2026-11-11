import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { escopoHistorico } from "../src/services/djen/processHistory";
import { forcarConsulta, inicioDoAcompanhamento, iniciarAcompanhamento, preencherDoDjen, situacaoDoAcompanhamento } from "../src/services/djen/vigia";

const CHAVE = "50226768820254036100";
let seq = 0;
const ficha = (chave = CHAVE, status = "ativo", extra: Record<string, string> = {}) =>
  Number(db.prepare("INSERT INTO gestao_processos(numero,chave,pasta,status,tribunal,orgao,classe) VALUES (?,?,?,?,?,?,?)")
    .run(chave, chave, `T-${++seq}`, status, extra.tribunal ?? "", extra.orgao ?? "", extra.classe ?? "").lastInsertRowid);
const publicacao = (chave: string, data: string, tribunal = "TRF3", orgao = "1ª Vara Federal", classe = "Procedimento do JEF") => {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  return db.prepare("INSERT INTO djen_publicacoes(comunicacao_id,hash,processo_chave,data_disponibilizacao,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,texto,cancelada) VALUES (?,?,?,?,?,?,?,?,?,?,0)")
    .run(`c${++seq}`, `h${seq}`, chave, data, tribunal, orgao, classe, "Intimação", "I", "texto");
};

beforeEach(() => { db.prepare("DELETE FROM settings WHERE chave=?").run("gestao_djen_ignorados"); db.exec("DELETE FROM djen_publicacoes; DELETE FROM djen_historico_consultas; DELETE FROM djen_processos; DELETE FROM gestao_processos;"); });

describe("acompanhamento automático do processo", () => {
  it("a consulta histórica começa no ano do número CNJ (nunca antes de 2021)", () => {
    expect(inicioDoAcompanhamento(CHAVE, "2026-11-11")).toBe("2025-01-01");
    expect(inicioDoAcompanhamento("00012340120104036100", "2026-11-11")).toBe("2021-01-01");
    expect(inicioDoAcompanhamento("123", "2026-11-11")).toBeNull();
    expect(inicioDoAcompanhamento("00012340120994036100", "2026-11-11")).toBeNull(); // ano no futuro
  });
  it("coloca o processo na fila do DJEN, liga a ficha e não duplica", () => {
    const id = ficha();
    expect(iniciarAcompanhamento(CHAVE)).toBe(true);
    expect(iniciarAcompanhamento(CHAVE)).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM djen_historico_consultas WHERE processo_chave=?").get(CHAVE) as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT djen_chave FROM gestao_processos WHERE id=?").get(id) as { djen_chave: string }).djen_chave).toBe(CHAVE);
    expect(iniciarAcompanhamento("1234567")).toBe(false); // fora do padrão CNJ
  });
  it("processo ativo sem nenhuma publicação conhecida ainda tem escopo de consulta; arquivado não", () => {
    ficha();
    expect(escopoHistorico(CHAVE)?.inicio).toBe("2025-01-01");
    db.exec("UPDATE gestao_processos SET status='arquivado'");
    expect(escopoHistorico(CHAVE)).toBeNull();
  });
  it("com publicação mais antiga que o ano do número, o escopo começa nela", () => {
    ficha(); publicacao(CHAVE, "2024-06-10");
    expect(escopoHistorico(CHAVE)?.inicio).toBe("2024-06-10");
  });
  it("preenche só o que está em branco, com o que o DJEN informa", () => {
    const id = ficha(CHAVE, "ativo", { classe: "Classe digitada" });
    publicacao(CHAVE, "2025-03-01");
    expect(preencherDoDjen(CHAVE).sort()).toEqual(["orgao", "tribunal"]);
    const f = db.prepare("SELECT tribunal,orgao,classe FROM gestao_processos WHERE id=?").get(id) as Record<string, string>;
    expect(f).toEqual({ tribunal: "TRF3", orgao: "1ª Vara Federal", classe: "Classe digitada" });
    expect(preencherDoDjen(CHAVE)).toEqual([]);
  });
  it("a situação mostra o estado da consulta e as publicações; consulta forçada invalida a anterior", () => {
    const id = ficha(); publicacao(CHAVE, "2025-03-01"); publicacao(CHAVE, "2025-04-01");
    iniciarAcompanhamento(CHAVE);
    db.prepare("UPDATE djen_historico_consultas SET status='atualizado',consultado_em=CURRENT_TIMESTAMP WHERE processo_chave=?").run(CHAVE);
    expect(situacaoDoAcompanhamento(id)).toMatchObject({ acompanhavel: true, publicacoes: 2, ultima_publicacao: "2025-04-01", situacao: "atualizado" });
    expect(forcarConsulta(CHAVE)).toBe(true);
    const r = db.prepare("SELECT revisao, revisao_conferida FROM djen_historico_consultas WHERE processo_chave=?").get(CHAVE) as { revisao: number; revisao_conferida: number };
    expect(r.revisao).toBeGreaterThan(r.revisao_conferida);
  });
  it("número sem padrão CNJ: informa que não dá para acompanhar", () => {
    const id = ficha("12345678", "ativo");
    expect(situacaoDoAcompanhamento(id)).toMatchObject({ acompanhavel: false });
  });
});

import { excluirProcesso, ignorarPendentesDoDjen, pendentesDeImportacao } from "../src/services/gestao/processos";

describe("excluir a ficha e o aviso «sem ficha de gestão»", () => {
  it("excluir a ficha leva junto o acompanhamento criado sozinho (sem publicações): o aviso não volta", () => {
    const id = ficha();
    iniciarAcompanhamento(CHAVE);
    expect(excluirProcesso(id)).toEqual({ ok: true });
    expect(pendentesDeImportacao()).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM djen_processos").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM djen_historico_consultas").get()).toEqual({ n: 0 });
  });
  it("com publicações reais do DJEN, o processo segue na lista de pendentes até ser ignorado", () => {
    const id = ficha(); publicacao(CHAVE, "2025-03-01");
    iniciarAcompanhamento(CHAVE);
    excluirProcesso(id);
    expect(pendentesDeImportacao()).toBe(1);
    expect(ignorarPendentesDoDjen()).toEqual({ ignorados: 1 });
    expect(pendentesDeImportacao()).toBe(0);
  });
});
