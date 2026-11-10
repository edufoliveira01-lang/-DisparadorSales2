import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { salvarArquivo } from "../src/services/gestao/arquivos";
import {
  configPublica, consumirEstado, desconectar, lerConexao, lerCredenciais, novoEstado, repositorioDeVinculos, salvarConexao, salvarCredenciais,
} from "../src/armazenamento/banco";
import {
  enfileirarCopia, esperaEmMinutos, MAXIMO_DE_TENTATIVAS, pendenciasDePasta, processarFila, reenviar, situacaoDaFila, sugestoesDeVinculo, vincularCriandoPasta, vincularPasta,
} from "../src/armazenamento/fila";
import { driveFalso } from "./helpers/driveFalso";

const SECRET = "segredo-do-app-123456";
const CONTA = { nome: "Escritório", email: "e@x.com", tipo: "pro", raizDeNomes: "" };

function novaPessoa(nome: string): number {
  const r = db.prepare("INSERT INTO gestao_pessoas(nome,tipo) VALUES (?, 'cliente')").run(nome);
  return Number(r.lastInsertRowid);
}
function novoPdf(pessoaId: number, nome = "Contrato assinado.pdf"): number {
  return salvarArquivo({ pessoaId }, nome, Buffer.from("%PDF-1.4 teste"), { categoria: "Contrato assinado" }, { id: null, nome: "teste" }).id;
}
const fila = () => db.prepare("SELECT * FROM armazenamento_fila ORDER BY id").all() as Array<Record<string, unknown>>;

beforeEach(() => {
  db.exec("DELETE FROM armazenamento_fila; DELETE FROM armazenamento_pastas; DELETE FROM armazenamento_estados; DELETE FROM armazenamento_config;");
});

describe("conexão com o drive", () => {
  it("a secret e o token ficam CRIPTOGRAFADOS no banco e nunca voltam para a tela", () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    salvarConexao({ refreshToken: "refresh-token-secreto", conta: CONTA });
    const bruto = JSON.stringify(db.prepare("SELECT * FROM armazenamento_config").get());
    expect(bruto).not.toContain(SECRET);
    expect(bruto).not.toContain("refresh-token-secreto");
    const publico = JSON.stringify(configPublica());
    expect(publico).not.toContain(SECRET);
    expect(publico).not.toContain("refresh-token-secreto");
    expect(configPublica()).toMatchObject({ credenciais_salvas: true, conectado: true, app_key_final: "…1234", conta: { nome: "Escritório" } });
    expect(lerConexao()).toMatchObject({ appKey: "appkey1234", appSecret: SECRET, refreshToken: "refresh-token-secreto" });
  });
  it("valida as credenciais e não conecta sem elas", () => {
    expect(() => salvarCredenciais({ appKey: "", appSecret: "" })).toThrow(/App key/);
    expect(() => salvarCredenciais({ appKey: "curta", appSecret: SECRET })).toThrow(/inválida/);
    expect(() => salvarConexao({ refreshToken: "x", conta: CONTA })).toThrow(/antes de conectar/);
    expect(lerConexao()).toBeNull();
  });
  it("salvar de novo sem a secret mantém a anterior; trocar de app derruba a conexão antiga", () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    salvarConexao({ refreshToken: "r", conta: CONTA });
    salvarCredenciais({ appKey: "appkey1234" });
    expect(lerCredenciais()).toMatchObject({ appSecret: SECRET });
    expect(configPublica().conectado).toBe(true);
    salvarCredenciais({ appKey: "outraapp99", appSecret: "outra-secret-123" });
    expect(configPublica().conectado).toBe(false);
  });
  it("desconectar apaga o acesso e mantém as credenciais do app", () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    salvarConexao({ refreshToken: "r", conta: CONTA });
    desconectar();
    expect(configPublica()).toMatchObject({ conectado: false, credenciais_salvas: true, conta: null });
    expect(lerConexao()).toBeNull();
  });
  it("o state do OAuth vale uma vez, 10 minutos e só para quem começou", () => {
    const t0 = 1_000_000;
    const s1 = novoEstado(7, t0);
    expect(consumirEstado(s1, 7, t0 + 1000)).toBe(true);
    expect(consumirEstado(s1, 7, t0 + 1000)).toBe(false); // já usado
    const s2 = novoEstado(7, t0);
    expect(consumirEstado(s2, 8, t0 + 1000)).toBe(false); // outra pessoa
    const s3 = novoEstado(7, t0);
    expect(consumirEstado(s3, 7, t0 + 11 * 60_000)).toBe(false); // expirou
    expect(consumirEstado("lixo", 7)).toBe(false);
    expect(consumirEstado(undefined, 7)).toBe(false);
  });
});

describe("vínculo cliente → pasta", () => {
  it("grava, lê, atualiza e apaga; apagar o cliente apaga o vínculo", () => {
    const id = novaPessoa("ANA LIMA");
    repositorioDeVinculos.salvarVinculo({ pessoaId: id, pastaId: "id:1", caminho: "/CLIENTES/ANA LIMA", nomePasta: "ANA LIMA", origem: "auto" });
    expect(repositorioDeVinculos.vinculoDaPessoa(id)).toMatchObject({ pastaId: "id:1", origem: "auto" });
    repositorioDeVinculos.salvarVinculo({ pessoaId: id, pastaId: "id:2", caminho: "/CLIENTES/ANA L.", nomePasta: "ANA L.", origem: "manual" });
    expect(repositorioDeVinculos.vinculoDaPessoa(id)).toMatchObject({ pastaId: "id:2", origem: "manual" });
    db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(id);
    expect(repositorioDeVinculos.vinculoDaPessoa(id)).toBeNull();
  });
});

describe("a fila de envio", () => {
  it("sem credenciais salvas não enfileira nada; com elas, é idempotente por arquivo", () => {
    const p = novaPessoa("JOÃO DA SILVA"); const a = novoPdf(p);
    expect(enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "CONTRATOS E PROCURAÇÕES", titulo: "Procuração (assinado)" })).toBe(false);
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    expect(enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "CONTRATOS E PROCURAÇÕES", titulo: "Procuração (assinado)" })).toBe(true);
    expect(enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "CONTRATOS E PROCURAÇÕES", titulo: "Procuração (assinado)" })).toBe(false);
    expect(fila()).toHaveLength(1);
  });

  it("envia ao drive: cria a pasta do cliente e grava com o nome AAAA-MM-DD - Título.pdf", async () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    const p = novaPessoa("João da Silva"); const a = novoPdf(p);
    enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "CONTRATOS E PROCURAÇÕES", titulo: "Procuração (assinado)", dataDocumento: "2026-11-10T15:00:00Z" });
    const d = driveFalso(["/CLIENTES"]);
    const r = await processarFila({ drive: d.drive });
    expect(r).toEqual({ enviados: 1, aguardando: 0, falhas: 0 });
    expect(d.arquivos[0]!.caminho).toBe("/CLIENTES/JOÃO DA SILVA/CONTRATOS E PROCURAÇÕES/2026-11-10 - Procuração (assinado).pdf");
    expect(fila()[0]).toMatchObject({ status: "enviado", caminho_final: d.arquivos[0]!.caminho });
    expect(repositorioDeVinculos.vinculoDaPessoa(p)).toMatchObject({ nomePasta: "JOÃO DA SILVA" });
  });

  it("pasta PARECIDA: fica aguardando a equipe; ao escolher a pasta, o documento sai", async () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    const p = novaPessoa("João da Silva"); const a = novoPdf(p);
    enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "DOCUMENTOS PESSOAIS", titulo: "RG" });
    const d = driveFalso(["/CLIENTES", "/CLIENTES/JOÃO DE SILVA"]);
    expect(await processarFila({ drive: d.drive })).toEqual({ enviados: 0, aguardando: 1, falhas: 0 });
    expect(d.arquivos).toHaveLength(0);
    const pend = pendenciasDePasta();
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ pessoa_id: p, documentos: 1 });
    expect(pend[0]!.candidatas[0]).toMatchObject({ nome: "JOÃO DE SILVA" });
    expect(situacaoDaFila().aguardando_pasta).toBe(1);

    const escolhida = pend[0]!.candidatas[0]!.id;
    const v = await vincularPasta(p, escolhida, d.drive);
    expect(v).toMatchObject({ caminho: "/CLIENTES/JOÃO DE SILVA", liberados: 1 });
    expect(await processarFila({ drive: d.drive })).toEqual({ enviados: 1, aguardando: 0, falhas: 0 });
    expect(d.arquivos[0]!.caminho).toMatch(/^\/CLIENTES\/JOÃO DE SILVA\/DOCUMENTOS PESSOAIS\/\d{4}-\d{2}-\d{2} - RG\.pdf$/);
    expect(pendenciasDePasta()).toHaveLength(0);
  });

  it("«Nenhuma destas»: cria a pasta com o nome do cadastro e libera", async () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    const p = novaPessoa("João da Silva"); const a = novoPdf(p);
    enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "DOCUMENTOS PESSOAIS", titulo: "RG" });
    const d = driveFalso(["/CLIENTES", "/CLIENTES/JOÃO DE SILVA"]);
    await processarFila({ drive: d.drive });
    const v = await vincularCriandoPasta(p, d.drive);
    expect(v.caminho).toBe("/CLIENTES/JOÃO DA SILVA");
    await processarFila({ drive: d.drive });
    expect(d.arquivos[0]!.caminho).toContain("/CLIENTES/JOÃO DA SILVA/DOCUMENTOS PESSOAIS/");
  });

  it("falha do drive: tenta de novo com espera crescente e vira erro depois de 6 tentativas; Reenviar recomeça", async () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    const p = novaPessoa("Ana Lima"); const a = novoPdf(p);
    enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "PARTE MÉDICA", titulo: "Laudo" });
    const d = driveFalso(["/CLIENTES"]);
    d.drive.enviar = async () => { throw new Error("Dropbox fora do ar"); };
    let agora = Date.now();
    for (let i = 1; i < MAXIMO_DE_TENTATIVAS; i++) {
      expect(await processarFila({ drive: d.drive, agora })).toMatchObject({ falhas: 1 });
      const item = fila()[0]!;
      expect(item).toMatchObject({ status: "pendente", tentativas: i, ultimo_erro: "Dropbox fora do ar" });
      expect(Number(item.proxima_tentativa_em)).toBeGreaterThanOrEqual(agora + esperaEmMinutos(i) * 60_000);
      // antes da hora, a rodada não mexe no item
      expect(await processarFila({ drive: d.drive, agora })).toEqual({ enviados: 0, aguardando: 0, falhas: 0 });
      agora = Number(item.proxima_tentativa_em) + 1;
    }
    await processarFila({ drive: d.drive, agora });
    expect(fila()[0]).toMatchObject({ status: "erro", tentativas: MAXIMO_DE_TENTATIVAS });

    expect(reenviar(Number(fila()[0]!.id))).toBe(true);
    d.drive.enviar = async (caminho, c) => ({ id: "id:ok", caminho: caminho + c.length });
    expect(await processarFila({ drive: d.drive, agora: Date.now() })).toMatchObject({ enviados: 1 });
  });

  it("arquivo apagado do sistema: erro claro (não trava a fila)", async () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    const p = novaPessoa("Ana Lima");
    enfileirarCopia({ pessoaId: p, arquivoId: 999_999, tipoPasta: "PARTE MÉDICA", titulo: "Laudo" });
    const d = driveFalso(["/CLIENTES"]);
    await processarFila({ drive: d.drive });
    expect(fila()[0]!.ultimo_erro).toMatch(/não existe mais/);
  });

  it("sem conexão, a rodada não faz nada e os itens esperam", async () => {
    salvarCredenciais({ appKey: "appkey1234", appSecret: SECRET });
    const p = novaPessoa("Ana Lima"); const a = novoPdf(p);
    enfileirarCopia({ pessoaId: p, arquivoId: a, tipoPasta: "PARTE MÉDICA", titulo: "Laudo" });
    expect(await processarFila({ drive: null })).toEqual({ enviados: 0, aguardando: 0, falhas: 0 });
    expect(fila()[0]).toMatchObject({ status: "pendente", tentativas: 0 });
  });
});

describe("«Vincular pastas do Dropbox» (o legado)", () => {
  it("sugere por cliente sem vínculo: idêntico, parecido ou nenhum — e não grava nada", async () => {
    db.exec("DELETE FROM gestao_pessoas");
    const a = novaPessoa("ANA LIMA"); const b = novaPessoa("João da Silva"); const c = novaPessoa("Carlos Eduardo Pereira"); const jaVinculada = novaPessoa("Bia Souza");
    repositorioDeVinculos.salvarVinculo({ pessoaId: jaVinculada, pastaId: "id:9", caminho: "/CLIENTES/BIA SOUZA", nomePasta: "BIA SOUZA", origem: "manual" });
    const d = driveFalso(["/CLIENTES", "/CLIENTES/ana lima", "/CLIENTES/JOÃO DE SILVA"]);
    const r = await sugestoesDeVinculo(d.drive);
    expect(r.total_de_pastas).toBe(2);
    const por = Object.fromEntries(r.sugestoes.map((s) => [s.pessoa_id, s]));
    expect(por[a]).toMatchObject({ resultado: "exato", pasta: { nome: "ana lima" } });
    expect(por[b]).toMatchObject({ resultado: "parecido", candidatas: [{ nome: "JOÃO DE SILVA" }] });
    expect(por[c]).toMatchObject({ resultado: "nenhum" });
    expect(por[jaVinculada]).toBeUndefined();
    expect(repositorioDeVinculos.vinculoDaPessoa(a)).toBeNull();
  });
});

describe("o gancho do ZapSign", () => {
  it("o arquivo assinado pode ser lido do disco pelo caminho que a fila usa", () => {
    const p = novaPessoa("Ana Lima"); const a = novoPdf(p);
    const lido = db.prepare("SELECT armazenado FROM gestao_arquivos WHERE id=?").get(a) as { armazenado: string };
    expect(lido.armazenado).toBeTruthy();
    expect(fs.existsSync(`${process.env.DATA_DIR}/arquivos/${lido.armazenado}`)).toBe(true);
  });
});
