import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import "../src/zapsign/contratos";
import { salvarCredenciais, salvarConexao } from "../src/armazenamento/banco";
import { problemaDoArmazenamento, processarFila, saudeDoArmazenamento, situacaoDaFila } from "../src/armazenamento/fila";
import { diasDoMaisAntigoEsperando, limparEsperaVencida } from "../src/armazenamento/limpeza";
import {
  clienteJaAssinou, documentosEsperandoAssinatura, liberarEsperaDaPessoa, pessoaDoDocumento, receberDocumentoDoChat, urlDeDownloadPermitida,
} from "../src/armazenamento/chat";
import { ErroArmazenamento } from "../src/armazenamento/pastas";
import { driveFalso } from "./helpers/driveFalso";

const PDF = Buffer.from("%PDF-1.4 laudo de teste");
const httpFalso = (corpo: Buffer = PDF, status = 200, cabecalhos: Record<string, string> = {}) =>
  (async () => new Response(corpo, { status, headers: cabecalhos })) as unknown as typeof fetch;

function novaPessoa(nome: string, documento = "", telefone = "", telefone2 = ""): number {
  return Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento,telefone,telefone2) VALUES (?, 'cliente', ?, ?, ?)").run(nome, documento, telefone, telefone2).lastInsertRowid);
}
function assinarContrato(pessoaId: number) {
  db.prepare("INSERT INTO zapsign_contratos(pessoa_id,doc_token,sign_url,status,assinado_em) VALUES (?, 't', 'u', 'assinado', '2026-11-07 12:00:00')").run(pessoaId);
}
const doc = (extra: Record<string, unknown> = {}) => ({
  origemRef: "msg-1", telefone: "(13) 97404-5973", cpf: "225.188.548-00", tipoPasta: "PARTE MÉDICA", titulo: "Laudo da coluna", extensao: "pdf", url: "https://arquivos.exemplo.com/a?assinatura=1", ...extra,
});
const fila = () => db.prepare("SELECT * FROM armazenamento_fila ORDER BY id").all() as Array<Record<string, unknown>>;

beforeEach(() => {
  db.exec("DELETE FROM armazenamento_fila; DELETE FROM armazenamento_espera; DELETE FROM armazenamento_pastas; DELETE FROM armazenamento_config; DELETE FROM zapsign_documentos; DELETE FROM zapsign_contratos; DELETE FROM gestao_pessoas;");
  salvarCredenciais({ appKey: "appkey1234", appSecret: "segredo-do-app-123456" });
  salvarConexao({ refreshToken: "r", conta: { nome: "E", email: "e@x.com", tipo: "pro", raizDeNomes: "" } });
});

describe("endereço do arquivo", () => {
  it("só https público; recusa http, rede interna e endereço torto", () => {
    expect(urlDeDownloadPermitida("https://projeto.supabase.co/storage/v1/object/sign/x?token=1").hostname).toBe("projeto.supabase.co");
    for (const ruim of ["http://x.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://10.0.0.5/a", "https://192.168.1.2/a", "https://172.16.0.1/a", "https://169.254.169.254/a", "https://intranet/a", "https://app.local/a", "nao-e-url"]) {
      expect(() => urlDeDownloadPermitida(ruim), ruim).toThrow(ErroArmazenamento);
    }
  });
});

describe("achar o cliente do documento", () => {
  it("pelo CPF (com ou sem pontuação) e, na falta dele, pelo telefone; telefone repetido não adivinha", () => {
    const a = novaPessoa("ANA LIMA", "225.188.548-00", "(13) 97404-5973");
    expect(pessoaDoDocumento("22518854800", "")).toBe(a);
    expect(pessoaDoDocumento("", "13974045973")).toBe(a);
    expect(pessoaDoDocumento("", "+55 13 97404-5973")).toBe(a);
    novaPessoa("OUTRA PESSOA", "", "13974045973");
    expect(pessoaDoDocumento("", "13974045973")).toBeNull();
    expect(pessoaDoDocumento("22518854800", "")).toBe(a);
  });
});

describe("documento do chat", () => {
  it("sem drive configurado, não baixa nada e avisa o agente", async () => {
    db.exec("DELETE FROM armazenamento_config");
    let baixou = false;
    const r = await receberDocumentoDoChat(doc(), { http: (async () => { baixou = true; return new Response(PDF); }) as unknown as typeof fetch });
    expect(r.situacao).toBe("drive_nao_configurado");
    expect(baixou).toBe(false);
  });

  it("antes da assinatura o documento ESPERA; assinado o contrato, vai para a fila e para o drive, e o arquivo temporário some", async () => {
    const pessoa = novaPessoa("EDUARDO FREITAS OLIVEIRA", "225.188.548-00", "13974045973");
    const r = await receberDocumentoDoChat(doc(), { http: httpFalso(), processar: false });
    expect(r.situacao).toBe("aguardando_assinatura");
    expect(documentosEsperandoAssinatura()).toBe(1);
    expect(fila()).toHaveLength(0);
    expect(clienteJaAssinou(pessoa)).toBe(false);

    assinarContrato(pessoa);
    expect(liberarEsperaDaPessoa(pessoa, { processar: false })).toBe(1);
    expect(documentosEsperandoAssinatura()).toBe(0);
    const [item] = fila();
    expect(item).toMatchObject({ pessoa_id: pessoa, tipo_pasta: "PARTE MÉDICA", titulo: "Laudo da coluna", status: "pendente", origem_ref: "msg-1" });
    expect(Number(item!.arquivo_id)).toBeLessThan(0);
    const temp = String(item!.caminho_temp);
    expect(fs.existsSync(temp)).toBe(true);

    const drive = driveFalso();
    expect(await processarFila({ drive: drive.drive })).toMatchObject({ enviados: 1 });
    expect(drive.arquivos).toHaveLength(1);
    expect(drive.arquivos[0]!.caminho).toMatch(/^\/CLIENTES\/EDUARDO FREITAS OLIVEIRA\/PARTE MÉDICA\/\d{4}-\d{2}-\d{2} - Laudo da coluna\.pdf$/);
    expect(fs.existsSync(temp)).toBe(false);
    expect(situacaoDaFila().enviado).toBe(1);
  });

  it("cliente que já assinou: o documento entra direto na fila", async () => {
    const pessoa = novaPessoa("ANA LIMA", "225.188.548-00", "13974045973");
    assinarContrato(pessoa);
    const r = await receberDocumentoDoChat(doc({ origemRef: "msg-2", tipoPasta: "DOCUMENTOS PESSOAIS", titulo: "RG" }), { http: httpFalso(), processar: false });
    expect(r.situacao).toBe("enfileirado");
    expect(fila().some((f) => f.origem_ref === "msg-2")).toBe(true);
  });

  it("o mesmo documento (mesma mensagem) nunca entra duas vezes", async () => {
    novaPessoa("ANA LIMA", "225.188.548-00");
    expect((await receberDocumentoDoChat(doc(), { http: httpFalso(), processar: false })).situacao).toBe("aguardando_assinatura");
    expect((await receberDocumentoDoChat(doc(), { http: httpFalso(), processar: false })).situacao).toBe("ja_recebido");
    expect(documentosEsperandoAssinatura()).toBe(1);
  });

  it("recusa tipo de pasta inválido, arquivo grande, vazio e link vencido", async () => {
    novaPessoa("ANA LIMA", "225.188.548-00");
    await expect(receberDocumentoDoChat(doc({ tipoPasta: "QUALQUER COISA" }), { http: httpFalso(), processar: false })).rejects.toThrow(/Tipo de pasta/);
    await expect(receberDocumentoDoChat(doc({ origemRef: "g" }), { http: httpFalso(PDF, 200, { "content-length": String(30 * 1024 * 1024) }), processar: false })).rejects.toThrow(/grande demais/);
    await expect(receberDocumentoDoChat(doc({ origemRef: "v" }), { http: httpFalso(Buffer.alloc(0)) })).rejects.toThrow(/vazio/);
    await expect(receberDocumentoDoChat(doc({ origemRef: "e" }), { http: httpFalso(PDF, 403) })).rejects.toThrow(/expirado/);
    expect(documentosEsperandoAssinatura()).toBe(0);
  });

  it("documento de quem tem nome parecido com pasta existente espera a escolha da equipe (não adivinha)", async () => {
    const pessoa = novaPessoa("JOÃO DA SILVA", "529.982.247-25");
    assinarContrato(pessoa);
    await receberDocumentoDoChat(doc({ cpf: "529.982.247-25", telefone: "" }), { http: httpFalso(), processar: false });
    const drive = driveFalso(["/CLIENTES", "/CLIENTES/JOAO DE SILVA"]);
    expect(await processarFila({ drive: drive.drive })).toMatchObject({ aguardando: 1 });
    expect(drive.arquivos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ status: "aguardando_pasta" });
    expect(fs.existsSync(String(fila()[0]!.caminho_temp))).toBe(true);
  });
});

describe("limpeza dos documentos que esperam uma assinatura que não veio", () => {
  const esperar = (ref: string, criadoEm: string, arquivo = "") =>
    db.prepare("INSERT INTO armazenamento_espera(origem_ref,telefone,cpf,tipo_pasta,titulo,extensao,data_documento,caminho_temp,criado_em) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(ref, "13974045973", "", "PARTE MÉDICA", "Laudo", "pdf", "2026-11-01T00:00:00.000Z", arquivo, criadoEm);

  it("apaga a linha e o arquivo temporário do que passou do prazo, e deixa o recente", () => {
    const velho = `/tmp/espera-velho-${process.pid}.bin`;
    fs.writeFileSync(velho, "x");
    esperar("velho", "2026-08-01 10:00:00", velho);
    esperar("novo", "2026-11-05 10:00:00");
    const n = limparEsperaVencida(60, Date.parse("2026-11-11T12:00:00Z"));
    expect(n).toBe(1);
    expect(fs.existsSync(velho)).toBe(false);
    expect((db.prepare("SELECT origem_ref FROM armazenamento_espera").all() as Array<{ origem_ref: string }>).map((r) => r.origem_ref)).toEqual(["novo"]);
  });
  it("diz há quantos dias o mais antigo espera", () => {
    esperar("a", "2026-11-01 12:00:00");
    expect(diasDoMaisAntigoEsperando(Date.parse("2026-11-11T12:00:00Z"))).toBe(10);
    expect(situacaoDaFila().espera_expira_em_dias).toBeGreaterThanOrEqual(7);
  });
});

describe("saúde do armazenamento (o que a equipe é avisada)", () => {
  let pessoaSaude = 0;
  const pessoaDaSaude = () => (pessoaSaude ||= novaPessoa("Cliente da saúde"));
  beforeEach(() => { pessoaSaude = 0; });
  const item = (status: string, erro: string) =>
    db.prepare("INSERT INTO armazenamento_fila(pessoa_id,arquivo_id,tipo_pasta,titulo,extensao,data_documento,status,ultimo_erro) VALUES (?, ?, 'PARTE MÉDICA','Laudo','pdf','2026-11-01',?,?)")
      .run(pessoaDaSaude(), -Math.floor(Math.random() * 1e6) - 1, status, erro);

  it("tudo certo: sem problema", () => {
    expect(saudeDoArmazenamento()).toMatchObject({ ligado: true, problema: null, chave: "ok" });
  });
  it("envio que falhou de vez vira problema, com a chave mudando a cada falha nova", () => {
    item("erro", "expired_access_token");
    const a = problemaDoArmazenamento();
    expect(a.texto).toMatch(/1 envio\(s\).*falharam.*reconecte o Dropbox/i);
    item("erro", "outra falha");
    expect(problemaDoArmazenamento().chave).not.toBe(a.chave);
  });
});
