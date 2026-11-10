/**
 * Armazenamento externo — o FLUXO: achar (ou criar) a pasta do cliente e gravar o documento na pasta do tipo.
 *
 * Independe de provedor: recebe um `drive` com as operações comuns (listar pastas, criar pasta, metadados por identificador, enviar) e um
 * repositório de vínculos (pessoa → pasta, pelo IDENTIFICADOR da pasta, que sobrevive a renomeação). Sem rede e sem banco aqui — é o que os
 * testes exercitam com dublês.
 *
 * A REGRA QUE IMPORTA: nunca adivinhar. Nome idêntico (ignorando caixa/acento/pontuação) usa a pasta existente; nome PARECIDO não envia nada e
 * devolve as candidatas para a equipe escolher; nada parecido cria a pasta nova com o nome do cadastro.
 */
import {
  caminhoDoCliente, casarPasta, dentroDaRaiz, ErroItemNaoEncontrado, nomeDaPastaDoCliente, nomeDaPastaDoTipo, raizDosClientes,
  type Candidata, type PastaExistente, type TipoDePasta,
} from "./pastas";

/** O que o provedor precisa saber fazer. O Dropbox implementa; Google Drive e OneDrive implementarão a mesma forma. */
export interface Drive {
  listarPastas(caminho: string): Promise<PastaExistente[]>;
  criarPasta(caminho: string): Promise<{ id: string; nome: string; caminho: string }>;
  metadados(ref: string): Promise<{ id: string; nome: string; caminho: string; tipo: string }>;
  enviar(caminho: string, conteudo: Buffer): Promise<{ id: string; caminho: string }>;
}

export interface Vinculo { pessoaId: number; pastaId: string; caminho: string; nomePasta: string; origem: "auto" | "manual" }

export interface RepositorioDeVinculos {
  vinculoDaPessoa(pessoaId: number): Vinculo | null;
  salvarVinculo(v: Vinculo): void;
  apagarVinculo(pessoaId: number): void;
}

export type Resolucao =
  | { situacao: "pronta"; vinculo: Vinculo }
  | { situacao: "aguardando"; candidatas: Candidata[] };

const naoEncontrado = (e: unknown) => e instanceof ErroItemNaoEncontrado;

async function pastasDosClientes(drive: Drive): Promise<PastaExistente[]> {
  try { return await drive.listarPastas(raizDosClientes()); }
  catch (e) {
    // A pasta-raiz ainda não existe: cria (é só o contêiner dos clientes) e segue com a lista vazia.
    if (naoEncontrado(e)) { await drive.criarPasta(raizDosClientes()); return []; }
    throw e;
  }
}

/** Acha a pasta do cliente (pelo vínculo, ou pelo nome) ou diz que a equipe precisa escolher. */
export async function resolverPastaDoCliente(a: { pessoaId: number; nomeDoCliente: string; drive: Drive; repo: RepositorioDeVinculos }): Promise<Resolucao> {
  const { pessoaId, drive, repo } = a;

  const vinculo = repo.vinculoDaPessoa(pessoaId);
  if (vinculo) {
    try {
      const meta = await drive.metadados(vinculo.pastaId);
      const caminho = dentroDaRaiz(meta.caminho); // a pasta vinculada não pode ter saído de /CLIENTES
      if (caminho !== vinculo.caminho || meta.nome !== vinculo.nomePasta) {
        const atualizado = { ...vinculo, caminho, nomePasta: meta.nome };
        repo.salvarVinculo(atualizado); // renomearam/moveram DENTRO de /CLIENTES: o vínculo acompanha
        return { situacao: "pronta", vinculo: atualizado };
      }
      return { situacao: "pronta", vinculo };
    } catch (e) {
      if (!naoEncontrado(e)) throw e;
      repo.apagarVinculo(pessoaId); // a pasta foi apagada no drive: o vínculo não vale mais, e a busca recomeça pelo nome
    }
  }

  const nome = nomeDaPastaDoCliente(a.nomeDoCliente);
  const existentes = await pastasDosClientes(drive);
  const c = casarPasta(nome, existentes);
  if (c.tipo === "parecido") return { situacao: "aguardando", candidatas: c.candidatas };

  if (c.tipo === "exato") {
    const v: Vinculo = { pessoaId, pastaId: c.pasta.id, caminho: dentroDaRaiz(c.pasta.caminho), nomePasta: c.pasta.nome, origem: "auto" };
    repo.salvarVinculo(v);
    return { situacao: "pronta", vinculo: v };
  }
  const criada = await drive.criarPasta(caminhoDoCliente(nome));
  const v: Vinculo = { pessoaId, pastaId: criada.id, caminho: dentroDaRaiz(criada.caminho || caminhoDoCliente(nome)), nomePasta: criada.nome || nome, origem: "auto" };
  repo.salvarVinculo(v);
  return { situacao: "pronta", vinculo: v };
}

export type ResultadoDoEnvio =
  | { situacao: "enviado"; caminho: string; id: string }
  | { situacao: "aguardando"; candidatas: Candidata[] };

/** Grava o documento em `CLIENTES/NOME DO CLIENTE/TIPO/nome do arquivo`. */
export async function enviarDocumento(a: {
  pessoaId: number; nomeDoCliente: string; tipo: TipoDePasta; nomeDoArquivo: string; conteudo: Buffer; drive: Drive; repo: RepositorioDeVinculos;
}): Promise<ResultadoDoEnvio> {
  const r = await resolverPastaDoCliente(a);
  if (r.situacao === "aguardando") return r;
  const pastaDoTipo = dentroDaRaiz(`${r.vinculo.caminho}/${nomeDaPastaDoTipo(a.tipo)}`);
  await a.drive.criarPasta(pastaDoTipo);
  const up = await a.drive.enviar(`${pastaDoTipo}/${a.nomeDoArquivo}`, a.conteudo);
  return { situacao: "enviado", caminho: up.caminho, id: up.id };
}
