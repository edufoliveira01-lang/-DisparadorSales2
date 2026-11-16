import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { criarVinculo, removerVinculo, vinculosDaPessoa, criarPericiaInss, atualizarPericiaInss, listarPericiasInss, periciasInssDaPessoa } from "../src/services/gestao/vinculos";
import { processosDaPessoa, compromissosDaPessoa } from "../src/services/gestao/integracao";
import { tratarJsonRpc } from "../src/atendimento/mcp/servidor";

const ins = (sql: string, ...p: unknown[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
const amanha = new Date(Date.now() - 3 * 3_600_000 + 5 * 86_400_000).toISOString().slice(0, 10);
const chamar = (nome: string, tel: string) => (tratarJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: {} } }, { telefone: tel }) as any).result.content[0].text as string;

describe("vínculo entre clientes (herdeiro) e perícia do INSS", () => {
  const fulano = ins("INSERT INTO gestao_pessoas(tipo,nome,telefone) VALUES ('cliente','Fulano Teste Vinculo','(21) 91111-0001')");
  const ciclano = ins("INSERT INTO gestao_pessoas(tipo,nome,telefone) VALUES ('cliente','Ciclano Teste Vinculo','(21) 92222-0002')");
  const proc = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('4000004-44.2025.8.26.0004','40000044420258260004','P-9004','Fulano','ativo')");
  db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(proc, fulano);
  afterAll(() => {
    db.prepare("DELETE FROM gestao_processos WHERE pasta='P-9004'").run();
    db.prepare("DELETE FROM gestao_pessoas WHERE nome LIKE '%Teste Vinculo'").run();
  });

  it("herdeiro enxerga o caso do falecido; o falecido não enxerga o do herdeiro; cada ficha mostra o seu lado", () => {
    expect(processosDaPessoa(ciclano)).toEqual([]);
    criarVinculo(ciclano, { relacionada_id: fulano, tipo: "herdeiro", observacao: "filho" });
    expect(processosDaPessoa(ciclano)).toContain(proc);
    const lado = vinculosDaPessoa(ciclano)[0]!;
    expect(lado.rotulo).toBe("Herdeiro(a) de"); expect(lado.outra_nome).toBe("Fulano Teste Vinculo"); expect(lado.processos_da_outra).toBe(1);
    const inverso = vinculosDaPessoa(fulano)[0]!;
    expect(inverso.rotulo).toBe("Herdeiro(a):"); expect(inverso.outra_nome).toBe("Ciclano Teste Vinculo"); expect(inverso.direcao).toBe("inverso");
    const outroProc = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('5000005-55.2025.8.26.0005','50000055520258260005','P-9005','Ciclano','ativo')");
    db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(outroProc, ciclano);
    expect(processosDaPessoa(fulano)).not.toContain(outroProc);
    expect(processosDaPessoa(ciclano).sort()).toEqual([proc, outroProc].sort());
    db.prepare("DELETE FROM gestao_processos WHERE pasta='P-9005'").run();
  });

  it("agente: o herdeiro vê o processo vinculado; repetir o vínculo ou vincular a si mesmo é recusado", () => {
    expect(chamar("consultar_cliente", "5521922220002")).toContain("4000004-44.2025.8.26.0004");
    // o nome na publicação pode ser outro (sucessor/familiar): a ferramenta manda informar, não recusar
    expect(chamar("andamento_do_processo", "5521922220002")).toMatch(/NÃO é motivo para recusar/);
    expect(() => criarVinculo(ciclano, { relacionada_id: fulano, tipo: "herdeiro" })).toThrow(/já estão vinculados/);
    expect(() => criarVinculo(ciclano, { relacionada_id: ciclano, tipo: "herdeiro" })).toThrow(/ele mesmo/);
    expect(() => criarVinculo(ciclano, { relacionada_id: fulano, tipo: "xyz" })).toThrow(/tipo/);
  });

  it("remover o vínculo devolve cada ficha ao que era", () => {
    const id = vinculosDaPessoa(ciclano)[0]!.id;
    removerVinculo(fulano, id);
    expect(vinculosDaPessoa(ciclano)).toEqual([]);
    expect(processosDaPessoa(ciclano)).toEqual([]);
  });

  it("perícia agendada com data «dd/mm/aaaa» (como o WhatsApp grava) aparece nos compromissos do cliente", () => {
    const [a, m, d] = amanha.split("-");
    const mp = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('6000006-66.2025.8.26.0006','60000066620258260006','P-9006','Fulano 2','ativo')");
    db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(mp, fulano);
    ins("INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms,status) VALUES ('c','Perícia Médica','periciamedica','medica','Fulano','fulano','','','6000006-66.2025.8.26.0006','60000066620258260006',?,'09:00','Rua do Retiro, 468',?,'ativa')", `${d}/${m}/${a}`, Date.now() + 5 * 86_400_000);
    try {
      const t = chamar("proximos_compromissos", "5521911110001");
      expect(t).toContain("Perícia Médica"); expect(t).toContain(`${d}/${m}/${a}`); expect(t).toContain("Rua do Retiro");
    } finally {
      db.prepare("DELETE FROM pericias_agendadas WHERE processo_chave='60000066620258260006'").run();
      db.prepare("DELETE FROM gestao_processos WHERE pasta='P-9006'").run();
    }
  });

  it("aviso da ficha: lista perícia judicial (data dd/mm/aaaa), audiência e perícia do INSS — só as futuras", () => {
    const [a, m, d] = amanha.split("-");
    const mp = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('7000007-77.2025.8.26.0007','70000077720258260007','P-9007','Fulano 3','ativo')");
    db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(mp, fulano);
    const pe = (tipo: string, data: string) => ins("INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms,status) VALUES ('c',?,?,'',?,?,'','','','70000077720258260007',?,'10:00','Fórum',?,'ativa')", tipo, tipo.toLowerCase(), `N${tipo}`, `n${tipo}`, data, Date.now());
    pe("Perícia Médica", `${d}/${m}/${a}`); pe("Audiência de Instrução", `${d}/${m}/${a}`); pe("Perícia Social", "01/01/2020");
    criarPericiaInss(fulano, { tipo: "medica", data: amanha, horario: "08:00", agencia: "APS Santos" });
    try {
      const c = compromissosDaPessoa(fulano);
      expect(c.map((x) => x.origem).sort()).toEqual(["audiencia", "inss", "judicial"]);
      expect(c.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.data) && x.dias >= 0)).toBe(true);
      expect(c.find((x) => x.origem === "inss")!.rotulo).toBe("Perícia médica no INSS");
    } finally {
      db.prepare("DELETE FROM pericias_agendadas WHERE processo_chave='70000077720258260007'").run();
      db.prepare("DELETE FROM gestao_processos WHERE pasta='P-9007'").run();
      db.prepare("DELETE FROM gestao_pericias_inss WHERE pessoa_id=?").run(fulano);
    }
  });

  it("perícia do INSS: cadastra, lista nas próximas, aparece para o agente e some quando realizada", () => {
    criarPericiaInss(fulano, { tipo: "medica", data: amanha, horario: "09:30", agencia: "APS Santos", protocolo: "123456789", beneficio: "Auxílio por incapacidade" });
    expect(listarPericiasInss().some((x) => x.pessoa_nome === "Fulano Teste Vinculo" && x.agencia === "APS Santos")).toBe(true);
    expect(chamar("proximos_compromissos", "5521911110001")).toContain("Perícia administrativa (INSS)");
    expect(() => criarPericiaInss(fulano, { data: "amanhã" })).toThrow(/data/i);
    const pid = periciasInssDaPessoa(fulano)[0]!.id;
    atualizarPericiaInss(fulano, pid, { status: "realizada", resultado: "favoravel" });
    expect(listarPericiasInss().some((x) => x.pessoa_nome === "Fulano Teste Vinculo")).toBe(false);
    expect(chamar("proximos_compromissos", "5521911110001")).toContain("Nenhuma perícia");
  });
});
