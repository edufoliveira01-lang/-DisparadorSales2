import { describe, expect, it } from "vitest";
import { db } from "../src/db";
import { excluirProcessoDoDjen, listarProcessosSemVinculo, processoFoiExcluido, ErroExclusaoDjen } from "../src/services/djen/semVinculo";

const CH = "99999991920268269999", CH2 = "99999992020268269998";
const ins = (sql: string, ...p: unknown[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
const pub = (chave: string, cid: string) => ins("INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto) VALUES (?,?,'TJSP','Vara X','Classe','Despacho','Intimação','2026-11-04','texto')", cid, chave);

describe("processos do DJEN sem vínculo: listar e excluir", () => {
  it("lista só o que não tem cliente nem ficha; exclui com as publicações e não deixa o DJEN recriar", () => {
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(CH, "9999999-19.2026.8.26.9999"); pub(CH, "zz-sv-1"); pub(CH, "zz-sv-2");
    try {
      const l = listarProcessosSemVinculo().find((x) => x.chave === CH);
      expect(l?.publicacoes).toBe(2); expect(l?.tem_ficha).toBe(false);
      expect(excluirProcessoDoDjen(CH).publicacoes).toBe(2);
      expect(listarProcessosSemVinculo().some((x) => x.chave === CH)).toBe(false);
      expect(db.prepare("SELECT 1 FROM djen_processos WHERE chave=?").get(CH)).toBeUndefined();
      expect(processoFoiExcluido(CH)).toBe(true);
    } finally { db.prepare("DELETE FROM djen_publicacoes WHERE comunicacao_id LIKE 'zz-sv-%'").run(); db.prepare("DELETE FROM djen_processos WHERE chave=?").run(CH); }
  });

  it("recusa excluir o que está em uso: ficha em Processos, perícia agendada", () => {
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(CH2, "9999999-20.2026.8.26.9998");
    const g = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('9999999-20.2026.8.26.9998',?, 'P-9998','x','ativo')", CH2);
    try {
      expect(() => excluirProcessoDoDjen(CH2)).toThrow(ErroExclusaoDjen);
      db.prepare("DELETE FROM gestao_processos WHERE id=?").run(g);
      ins("INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms,status) VALUES ('c','Perícia','pericia','','N','n','','','',?,'30/11/2026','09:00','x',?,'ativa')", CH2, Date.now() + 1e9);
      expect(() => excluirProcessoDoDjen(CH2)).toThrow(/perícia/);
    } finally { db.prepare("DELETE FROM pericias_agendadas WHERE processo_chave=?").run(CH2); db.prepare("DELETE FROM gestao_processos WHERE pasta='P-9998'").run(); db.prepare("DELETE FROM djen_processos WHERE chave=?").run(CH2); }
  });
});
