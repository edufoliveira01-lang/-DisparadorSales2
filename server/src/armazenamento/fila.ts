/**
 * Armazenamento externo — a FILA de envio ao drive.
 *
 * O envio nunca trava a assinatura nem o atendimento: quem produz o documento só ENFILEIRA (uma linha no banco). Um processo em segundo plano
 * (`iniciarFilaDoArmazenamento`, a cada minuto) manda cada item ao drive, com nova tentativa e espera crescente quando o drive falha. Um
 * documento que cai numa pasta PARECIDA fica `aguardando_pasta` até a equipe escolher — o sistema nunca adivinha entre nomes diferentes.
 */
import fs from "node:fs";
import { db } from "../db";
import { obterArquivo } from "../services/gestao/arquivos";
import { lerConexao, lerCredenciais, repositorioDeVinculos } from "./banco";
import { criarClienteDropbox } from "./dropbox";
import {
  casarPasta, dentroDaRaiz, ehTipoDePasta, ErroArmazenamento, nomeDaPastaDoCliente, nomeDoArquivo, RAIZ_DOS_CLIENTES, caminhoDoCliente,
  type PastaExistente, type TipoDePasta,
} from "./pastas";
import { enviarDocumento, type Drive } from "./servico";

/** Depois de tantas tentativas o item vira `erro` e espera alguém reenviar pela tela. */
export const MAXIMO_DE_TENTATIVAS = 6;
const ESPERA_MAXIMA_MIN = 120;

export interface ItemDaFila {
  id: number; pessoa_id: number; arquivo_id: number; tipo_pasta: string; titulo: string; extensao: string; data_documento: string;
  status: "pendente" | "aguardando_pasta" | "enviado" | "erro"; tentativas: number; proxima_tentativa_em: number; ultimo_erro: string;
  candidatas: string; caminho_final: string; criado_em: string; enviado_em: string | null;
}

/** Espera antes da próxima tentativa: 2, 4, 8, 16, 32 minutos… até 2 horas. */
export const esperaEmMinutos = (tentativas: number) => Math.min(2 ** Math.max(tentativas, 1), ESPERA_MAXIMA_MIN);

/**
 * Enfileira a cópia de um arquivo que já está guardado no Sales. Idempotente por arquivo (chamar de novo não duplica).
 * Só enfileira quando o escritório JÁ começou a configurar o drive (credenciais salvas): sem isso a fila não acumula lixo.
 */
export function enfileirarCopia(d: { pessoaId: number; arquivoId: number; tipoPasta: TipoDePasta; titulo: string; extensao?: string; dataDocumento?: Date | string }): boolean {
  if (!lerCredenciais()) return false;
  if (!ehTipoDePasta(d.tipoPasta)) throw new ErroArmazenamento("Tipo de pasta inválido.");
  const quando = d.dataDocumento instanceof Date ? d.dataDocumento.toISOString() : d.dataDocumento || new Date().toISOString();
  const r = db.prepare(
    "INSERT OR IGNORE INTO armazenamento_fila(pessoa_id,arquivo_id,tipo_pasta,titulo,extensao,data_documento) VALUES (?,?,?,?,?,?)",
  ).run(d.pessoaId, d.arquivoId, d.tipoPasta, d.titulo, (d.extensao || "pdf").replace(/^\./, ""), quando);
  return r.changes > 0;
}

const pessoaDe = (id: number) => db.prepare("SELECT nome FROM gestao_pessoas WHERE id=?").get(id) as { nome: string } | undefined;

function marcarErro(item: ItemDaFila, e: unknown, agora: number): void {
  const tentativas = item.tentativas + 1;
  const mensagem = (e instanceof ErroArmazenamento ? e.message : e instanceof Error ? e.message : "Falha desconhecida.").slice(0, 400);
  const definitivo = tentativas >= MAXIMO_DE_TENTATIVAS;
  db.prepare("UPDATE armazenamento_fila SET status=?, tentativas=?, ultimo_erro=?, proxima_tentativa_em=? WHERE id=?")
    .run(definitivo ? "erro" : "pendente", tentativas, mensagem, agora + esperaEmMinutos(tentativas) * 60_000, item.id);
}

async function processarItem(item: ItemDaFila, drive: Drive, agora: number): Promise<"enviado" | "aguardando" | "falha"> {
  try {
    const pessoa = pessoaDe(item.pessoa_id);
    if (!pessoa) throw new ErroArmazenamento("O cadastro do cliente não existe mais.");
    if (!ehTipoDePasta(item.tipo_pasta)) throw new ErroArmazenamento("Tipo de pasta inválido.");
    let arquivo;
    try { arquivo = obterArquivo(item.arquivo_id); } catch { throw new ErroArmazenamento("O arquivo não existe mais no sistema."); }
    const conteudo = fs.readFileSync(arquivo.caminho);
    const r = await enviarDocumento({
      pessoaId: item.pessoa_id, nomeDoCliente: pessoa.nome, tipo: item.tipo_pasta, conteudo, drive, repo: repositorioDeVinculos,
      nomeDoArquivo: nomeDoArquivo(item.data_documento, item.titulo, item.extensao),
    });
    if (r.situacao === "aguardando") {
      db.prepare("UPDATE armazenamento_fila SET status='aguardando_pasta', candidatas=?, ultimo_erro='' WHERE id=?")
        .run(JSON.stringify(r.candidatas.map((c) => ({ id: c.pasta.id, nome: c.pasta.nome, caminho: c.pasta.caminho, nota: Math.round(c.nota * 100) / 100 }))), item.id);
      return "aguardando";
    }
    db.prepare("UPDATE armazenamento_fila SET status='enviado', caminho_final=?, ultimo_erro='', enviado_em=CURRENT_TIMESTAMP WHERE id=?").run(r.caminho, item.id);
    return "enviado";
  } catch (e) {
    marcarErro(item, e, agora);
    console.error("[armazenamento] envio falhou:", e instanceof Error ? e.message : e);
    return "falha";
  }
}

let emAndamento = false;

/** Manda ao drive os itens vencidos (até 10 por rodada). Uma rodada por vez. */
export async function processarFila(deps: { drive?: Drive | null; agora?: number } = {}): Promise<{ enviados: number; aguardando: number; falhas: number }> {
  const zero = { enviados: 0, aguardando: 0, falhas: 0 };
  if (emAndamento) return zero;
  emAndamento = true;
  try {
    let drive = deps.drive;
    if (drive === undefined) {
      const c = lerConexao();
      drive = c ? criarClienteDropbox(c) : null;
    }
    if (!drive) return zero; // sem conexão: os itens ficam pendentes até conectar
    const agora = deps.agora ?? Date.now();
    const itens = db.prepare("SELECT * FROM armazenamento_fila WHERE status='pendente' AND proxima_tentativa_em <= ? ORDER BY id LIMIT 10").all(agora) as ItemDaFila[];
    const saida = { ...zero };
    for (const item of itens) {
      const r = await processarItem(item, drive, agora);
      if (r === "enviado") saida.enviados++; else if (r === "aguardando") saida.aguardando++; else saida.falhas++;
    }
    return saida;
  } finally { emAndamento = false; }
}

let timer: NodeJS.Timeout | null = null;
/** Liga a fila em segundo plano (uma rodada por minuto). */
export function iniciarFilaDoArmazenamento(intervaloMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => { void processarFila().catch((e) => console.error("[armazenamento] rodada falhou:", e instanceof Error ? e.message : e)); }, intervaloMs);
  timer.unref?.();
}
export function pararFilaDoArmazenamento(): void { if (timer) clearInterval(timer); timer = null; }

/** Resumo para a tela: quantos em cada situação + os últimos itens. */
export function situacaoDaFila() {
  const contagem = db.prepare("SELECT status, COUNT(*) n FROM armazenamento_fila GROUP BY status").all() as Array<{ status: string; n: number }>;
  const por: Record<string, number> = { pendente: 0, aguardando_pasta: 0, enviado: 0, erro: 0 };
  for (const c of contagem) por[c.status] = c.n;
  const recentes = db.prepare(
    `SELECT f.id, f.status, f.titulo, f.tipo_pasta, f.caminho_final, f.ultimo_erro, f.tentativas, f.criado_em, f.enviado_em, p.nome AS cliente
     FROM armazenamento_fila f LEFT JOIN gestao_pessoas p ON p.id=f.pessoa_id ORDER BY f.id DESC LIMIT 20`).all();
  return { ...por, recentes };
}

/** Clientes com documento esperando a equipe escolher a pasta, com as candidatas. */
export function pendenciasDePasta() {
  const linhas = db.prepare(
    `SELECT f.pessoa_id, p.nome, COUNT(*) AS documentos, MIN(f.candidatas) AS candidatas
     FROM armazenamento_fila f JOIN gestao_pessoas p ON p.id=f.pessoa_id WHERE f.status='aguardando_pasta' GROUP BY f.pessoa_id ORDER BY MIN(f.id)`,
  ).all() as Array<{ pessoa_id: number; nome: string; documentos: number; candidatas: string }>;
  return linhas.map((l) => ({ pessoa_id: l.pessoa_id, nome: l.nome, documentos: l.documentos, candidatas: JSON.parse(l.candidatas || "[]") as Array<{ id: string; nome: string; caminho: string; nota: number }> }));
}

const reenfileirarDaPessoa = (pessoaId: number) =>
  db.prepare("UPDATE armazenamento_fila SET status='pendente', proxima_tentativa_em=0 WHERE pessoa_id=? AND status='aguardando_pasta'").run(pessoaId);

/** A equipe escolheu a pasta do cliente: grava o vínculo (pelo identificador) e libera os documentos que esperavam. */
export async function vincularPasta(pessoaId: number, pastaId: string, drive: Drive): Promise<{ caminho: string; liberados: number }> {
  if (!pessoaDe(pessoaId)) throw new ErroArmazenamento("Cliente não encontrado.", 404);
  if (typeof pastaId !== "string" || !pastaId.startsWith("id:")) throw new ErroArmazenamento("Escolha uma pasta da lista.");
  const meta = await drive.metadados(pastaId);
  if (meta.tipo !== "folder") throw new ErroArmazenamento("O item escolhido não é uma pasta.");
  const caminho = dentroDaRaiz(meta.caminho);
  repositorioDeVinculos.salvarVinculo({ pessoaId, pastaId: meta.id, caminho, nomePasta: meta.nome, origem: "manual" });
  return { caminho, liberados: reenfileirarDaPessoa(pessoaId).changes };
}

/** "Nenhuma destas": cria a pasta nova com o nome do cadastro e libera os documentos. */
export async function vincularCriandoPasta(pessoaId: number, drive: Drive): Promise<{ caminho: string; liberados: number }> {
  const pessoa = pessoaDe(pessoaId);
  if (!pessoa) throw new ErroArmazenamento("Cliente não encontrado.", 404);
  const nome = nomeDaPastaDoCliente(pessoa.nome);
  const criada = await drive.criarPasta(caminhoDoCliente(nome));
  const caminho = dentroDaRaiz(criada.caminho || caminhoDoCliente(nome));
  repositorioDeVinculos.salvarVinculo({ pessoaId, pastaId: criada.id, caminho, nomePasta: criada.nome || nome, origem: "manual" });
  return { caminho, liberados: reenfileirarDaPessoa(pessoaId).changes };
}

/** Reenvia um item que falhou de vez. */
export function reenviar(id: number): boolean {
  return db.prepare("UPDATE armazenamento_fila SET status='pendente', tentativas=0, proxima_tentativa_em=0, ultimo_erro='' WHERE id=? AND status IN ('erro','pendente')").run(id).changes > 0;
}

export interface SugestaoDeVinculo {
  pessoa_id: number; nome: string;
  resultado: "exato" | "parecido" | "nenhum";
  pasta?: PastaExistente;
  candidatas?: Array<{ id: string; nome: string; caminho: string; nota: number }>;
}

/**
 * "Vincular pastas do Dropbox" (o legado, uma vez só): para cada cliente ATIVO sem vínculo, o que o nome dele casa nas pastas que já existem.
 * Não grava nada — é a lista para a equipe confirmar um a um (`vincularPasta`). Uma única leitura das pastas serve para todos.
 */
export async function sugestoesDeVinculo(drive: Drive, limite = 500): Promise<{ total_de_pastas: number; sugestoes: SugestaoDeVinculo[] }> {
  let pastas: PastaExistente[] = [];
  try { pastas = await drive.listarPastas(RAIZ_DOS_CLIENTES); } catch (e) { if (!(e instanceof ErroArmazenamento) || e.status !== 404) throw e; }
  const clientes = db.prepare(
    `SELECT p.id, p.nome FROM gestao_pessoas p
     WHERE p.tipo='cliente' AND p.ativo=1 AND NOT EXISTS (SELECT 1 FROM armazenamento_pastas a WHERE a.pessoa_id=p.id)
     ORDER BY p.nome COLLATE NOCASE LIMIT ?`).all(limite) as Array<{ id: number; nome: string }>;
  const sugestoes: SugestaoDeVinculo[] = clientes.map((c) => {
    const r = casarPasta(c.nome, pastas);
    if (r.tipo === "exato") return { pessoa_id: c.id, nome: c.nome, resultado: "exato", pasta: r.pasta };
    if (r.tipo === "parecido") return { pessoa_id: c.id, nome: c.nome, resultado: "parecido", candidatas: r.candidatas.map((x) => ({ id: x.pasta.id, nome: x.pasta.nome, caminho: x.pasta.caminho, nota: Math.round(x.nota * 100) / 100 })) };
    return { pessoa_id: c.id, nome: c.nome, resultado: "nenhum" };
  });
  return { total_de_pastas: pastas.length, sugestoes };
}
