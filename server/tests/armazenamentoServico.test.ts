import { describe, expect, it } from "vitest";
import { enviarDocumento, resolverPastaDoCliente, type RepositorioDeVinculos, type Vinculo } from "../src/armazenamento/servico";
import { driveFalso } from "./helpers/driveFalso";

function repoFalso(): RepositorioDeVinculos & { mapa: Map<number, Vinculo> } {
  const mapa = new Map<number, Vinculo>();
  return { mapa, vinculoDaPessoa: (id) => mapa.get(id) ?? null, salvarVinculo: (v) => void mapa.set(v.pessoaId, v), apagarVinculo: (id) => void mapa.delete(id) };
}
const doc = (extra: object = {}) => ({ pessoaId: 1, nomeDoCliente: "João da Silva", tipo: "DOCUMENTOS PESSOAIS" as const, nomeDoArquivo: "2026-11-10 - RG.pdf", conteudo: Buffer.from("x"), ...extra });

describe("enviar documento", () => {
  it("cliente novo, sem pasta parecida: cria CLIENTES/NOME/TIPO e grava; guarda o vínculo pelo id", async () => {
    const d = driveFalso(["/CLIENTES"]); const repo = repoFalso();
    const r = await enviarDocumento({ ...doc(), drive: d.drive, repo });
    expect(r).toMatchObject({ situacao: "enviado", caminho: "/CLIENTES/JOÃO DA SILVA/DOCUMENTOS PESSOAIS/2026-11-10 - RG.pdf" });
    expect(repo.mapa.get(1)).toMatchObject({ nomePasta: "JOÃO DA SILVA", origem: "auto" });
    expect(repo.mapa.get(1)!.pastaId).toMatch(/^id:/);
  });
  it("a raiz /CLIENTES não existe: o sistema a cria", async () => {
    const d = driveFalso([]); const repo = repoFalso();
    const r = await enviarDocumento({ ...doc(), drive: d.drive, repo });
    expect(r.situacao).toBe("enviado");
    expect([...d.pastas.values()].some((p) => p.caminho === "/CLIENTES")).toBe(true);
  });
  it("pasta idêntica já existe (sem acento/caixa): REUSA, não cria outra", async () => {
    const d = driveFalso(["/CLIENTES", "/CLIENTES/joao da silva"]); const repo = repoFalso();
    const antes = d.pastas.size;
    const r = await enviarDocumento({ ...doc(), drive: d.drive, repo });
    expect(r.situacao).toBe("enviado");
    expect(repo.mapa.get(1)!.nomePasta).toBe("joao da silva");
    // só a pasta do TIPO foi criada
    expect(d.pastas.size).toBe(antes + 1);
  });
  it("pasta PARECIDA («DE» em vez de «DA»): NÃO envia e devolve as candidatas; nada é criado nem vinculado", async () => {
    const d = driveFalso(["/CLIENTES", "/CLIENTES/JOÃO DE SILVA"]); const repo = repoFalso();
    const antes = d.pastas.size;
    const r = await enviarDocumento({ ...doc(), drive: d.drive, repo });
    expect(r.situacao).toBe("aguardando");
    if (r.situacao === "aguardando") expect(r.candidatas[0]!.pasta.nome).toBe("JOÃO DE SILVA");
    expect(d.arquivos).toHaveLength(0);
    expect(d.pastas.size).toBe(antes);
    expect(repo.mapa.size).toBe(0);
  });
  it("com o vínculo gravado, os próximos documentos vão direto, mesmo com a pasta renomeada (o vínculo acompanha)", async () => {
    const d = driveFalso(["/CLIENTES"]); const repo = repoFalso();
    await enviarDocumento({ ...doc(), drive: d.drive, repo });
    const id = repo.mapa.get(1)!.pastaId;
    d.renomear(id, "/CLIENTES/JOÃO DA SILVA (ANTIGO)");
    const r = await enviarDocumento({ ...doc({ nomeDoArquivo: "2026-11-11 - CNIS.pdf", tipo: "DOCUMENTOS ADMINISTRATIVO" }), drive: d.drive, repo });
    expect(r).toMatchObject({ situacao: "enviado", caminho: "/CLIENTES/JOÃO DA SILVA (ANTIGO)/DOCUMENTOS ADMINISTRATIVO/2026-11-11 - CNIS.pdf" });
    expect(repo.mapa.get(1)!.caminho).toBe("/CLIENTES/JOÃO DA SILVA (ANTIGO)");
  });
  it("pasta vinculada apagada no drive: o vínculo é descartado e a busca recomeça pelo nome", async () => {
    const d = driveFalso(["/CLIENTES"]); const repo = repoFalso();
    await enviarDocumento({ ...doc(), drive: d.drive, repo });
    d.apagar(repo.mapa.get(1)!.pastaId);
    const r = await enviarDocumento({ ...doc({ nomeDoArquivo: "2026-11-12 - RG.pdf" }), drive: d.drive, repo });
    expect(r.situacao).toBe("enviado");
  });
  it("pasta vinculada que foi MOVIDA para fora de /CLIENTES: recusa (não envia para fora)", async () => {
    const d = driveFalso(["/CLIENTES"]); const repo = repoFalso();
    await enviarDocumento({ ...doc(), drive: d.drive, repo });
    d.renomear(repo.mapa.get(1)!.pastaId, "/OUTRA/JOÃO DA SILVA");
    await expect(enviarDocumento({ ...doc({ nomeDoArquivo: "2026-11-12 - RG.pdf" }), drive: d.drive, repo })).rejects.toThrow(/só é permitido gravar dentro de/);
  });
  it("sem nome do cliente confirmado, não envia nem cria pasta", async () => {
    const d = driveFalso(["/CLIENTES"]); const repo = repoFalso();
    await expect(enviarDocumento({ ...doc({ nomeDoCliente: "  " }), drive: d.drive, repo })).rejects.toThrow(/nome completo/);
    expect(d.arquivos).toHaveLength(0);
  });
  it("resolverPasta: vínculo manual (escolhido pela equipe) é respeitado", async () => {
    const d = driveFalso(["/CLIENTES", "/CLIENTES/JOÃO DE SILVA"]); const repo = repoFalso();
    const escolhida = [...d.pastas.values()].find((p) => p.caminho.endsWith("JOÃO DE SILVA"))!;
    repo.salvarVinculo({ pessoaId: 1, pastaId: escolhida.id, caminho: escolhida.caminho, nomePasta: "JOÃO DE SILVA", origem: "manual" });
    const r = await resolverPastaDoCliente({ pessoaId: 1, nomeDoCliente: "João da Silva", drive: d.drive, repo });
    expect(r).toMatchObject({ situacao: "pronta", vinculo: { origem: "manual", nomePasta: "JOÃO DE SILVA" } });
  });
});
