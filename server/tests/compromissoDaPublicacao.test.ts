import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { refazerPendenciasDoProcesso, resumoDosCompromissos, sincronizarCompromisso } from "../src/services/djen/compromissoDaPublicacao";
import { revisarPublicacao } from "../src/services/djen/store";
import { agendamentoNoTexto } from "../src/services/djen/periciaIntegration";

const CH = "77777771320268267777";
const futuro = new Date(Date.now() + 12 * 86_400_000);
const dd = String(futuro.getDate()).padStart(2, "0"), mm = String(futuro.getMonth() + 1).padStart(2, "0"), aaaa = futuro.getFullYear();
const TEXTO = `Processo 7777777-13.2026.8.26.7777 - Ficam as partes cientes da designação de audiência de instrução para o dia ${dd}/${mm}/${aaaa}, às 14h30, na Sala 3 do Fórum de Jundiaí. Intimem-se.`;
const ins = (sql: string, ...p: unknown[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
let contato = 0, pub = 0;

afterAll(() => {
  db.prepare("DELETE FROM pericias_agendadas WHERE processo_chave=?").run(CH);
  db.prepare("DELETE FROM djen_historico WHERE publicacao_id=?").run(pub);
  db.prepare("DELETE FROM djen_publicacoes WHERE processo_chave=?").run(CH);
  db.prepare("DELETE FROM djen_processos WHERE chave=?").run(CH);
  db.prepare("DELETE FROM contacts WHERE id=?").run(contato);
});

describe("perícia e audiência marcadas viram prioridade e entram em «Avisar» depois da revisão", () => {
  it("o texto é lido quando a IA não preencheu: data, horário e local", () => {
    const a = agendamentoNoTexto(TEXTO, "audiencia");
    expect(a.data).toBe(`${dd}/${mm}/${aaaa}`); expect(a.horario).toMatch(/14\s*h\s*30/i); expect(a.local).toMatch(/Sala 3/);
    expect(agendamentoNoTexto("Processo sem data nenhuma.", "pericia").data).toBeNull();
  });

  it("sem cliente: fica como pendência a completar; vinculado o cliente, entra no controle sozinho", () => {
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(CH, "7777777-13.2026.8.26.7777");
    pub = ins("INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json) VALUES ('zz-comp-1',?,'TJSP','Vara','Classe','Intimação','Intimação',date('now'),?,'[\"audiencia\"]')", CH, TEXTO);
    revisarPublicacao(pub, { categorias: ["audiencia"], resultado: "nao_identificado" });
    let r = db.prepare("SELECT compromisso_estado e,compromisso_motivo m FROM djen_publicacoes WHERE id=?").get(pub) as { e: string; m: string };
    expect(r.e).toBe("completar"); expect(r.m).toMatch(/Vincule o cliente/);
    expect(resumoDosCompromissos().completar.some((x) => x.id === pub)).toBe(true);

    contato = ins("INSERT INTO contacts(nome,telefone) VALUES ('Zz Cliente Compromisso','(11) 95555-0001')");
    db.prepare("UPDATE djen_processos SET cliente_id=? WHERE chave=?").run(contato, CH);
    refazerPendenciasDoProcesso(CH);
    r = db.prepare("SELECT compromisso_estado e,compromisso_motivo m FROM djen_publicacoes WHERE id=?").get(pub) as { e: string; m: string };
    expect(r.e).toBe("informado");
    const linha = db.prepare("SELECT tipo,origem,data,horario,local,nome FROM pericias_agendadas WHERE processo_chave=?").get(CH) as Record<string, string>;
    expect(linha).toMatchObject({ tipo: "Audiência", origem: "audiencia", data: `${dd}/${mm}/${aaaa}`, horario: "14:30", nome: "Zz Cliente Compromisso" });
  });

  it("não duplica ao repetir, e data já passada é ignorada (não vira pendência)", () => {
    sincronizarCompromisso(pub);
    expect((db.prepare("SELECT COUNT(*) n FROM pericias_agendadas WHERE processo_chave=?").get(CH) as { n: number }).n).toBe(1);
    const passada = ins("INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json,revisada) VALUES ('zz-comp-2',?,'TJSP','Vara','Classe','Intimação','Intimação',date('now'),?,'[\"pericia\"]',1)", CH, "Perícia designada para o dia 10/01/2020, às 09h00, na Rua A, 10.");
    expect(sincronizarCompromisso(passada)).toMatchObject({ estado: "ignorado" });
  });

  it("a publicação de perícia/audiência a revisar aparece no resumo", () => {
    const nova = ins("INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json,revisada) VALUES ('zz-comp-3',?,'TJSP','Vara','Classe','Intimação','Intimação',date('now'),'x','[\"pericia\"]',0)", CH);
    expect(resumoDosCompromissos().a_revisar).toBeGreaterThanOrEqual(1);
    void nova;
  });
});
