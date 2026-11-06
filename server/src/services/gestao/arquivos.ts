import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, dataDir } from "../../db";
import { entitlementsAtuais } from "../../licenca/cliente";
import { limiteDe } from "../../licenca/entitlements";
import { ErroGestao } from "./pessoas";

export const TAMANHO_MAXIMO = 25 * 1024 * 1024;
const PASTA = () => path.join(dataDir, "arquivos");

// Somente tipos de documento/mídia. Nada executável ou renderizável pelo navegador (html, svg, js…).
const TIPOS: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", csv: "text/csv", rtf: "application/rtf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  zip: "application/zip", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", mp4: "video/mp4", xml: "application/xml",
};
const EXIBIVEIS = new Set(["pdf", "jpg", "jpeg", "png", "gif", "webp"]);

export interface Arquivo {
  id: number; processo_id: number | null; pessoa_id: number | null; nome: string; armazenado: string; mime: string; tamanho: number; categoria: string; descricao: string;
  grupo: number | null; versao: number; enviado_por: number | null; autor: string; criado_em: string;
}
export const extensao = (nome: string) => path.extname(nome).slice(1).toLowerCase();

export function nomeSeguro(bruto: unknown): string {
  const base = path.basename(String(bruto ?? "").replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (!base || base.startsWith(".")) throw new ErroGestao("Informe o nome do arquivo.");
  if (!TIPOS[extensao(base)]) throw new ErroGestao("Tipo de arquivo não permitido. Use PDF, Word, Excel, imagem, áudio, vídeo, texto ou ZIP.");
  return base;
}

export function usoDeArmazenamento() {
  const usado = (db.prepare("SELECT COALESCE(SUM(tamanho),0) n FROM gestao_arquivos").get() as { n: number }).n;
  const limiteMb = limiteDe(entitlementsAtuais(), "max_armazenamento_mb");
  return { usado_bytes: usado, limite_bytes: limiteMb === null ? null : limiteMb * 1024 * 1024, limite_mb: limiteMb };
}

type Escopo = { processoId?: number; pessoaId?: number };
function conferirEscopo(e: Escopo) {
  if (e.processoId && !db.prepare("SELECT id FROM gestao_processos WHERE id=?").get(e.processoId)) throw new ErroGestao("Processo não encontrado.", 404);
  if (e.pessoaId && !db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(e.pessoaId)) throw new ErroGestao("Pessoa não encontrada.", 404);
  if (!e.processoId && !e.pessoaId) throw new ErroGestao("Informe o processo ou a pessoa.");
}

export function salvarArquivo(e: Escopo, nomeBruto: unknown, conteudo: Buffer, meta: { categoria?: string; descricao?: string }, user: { id: number | null; nome: string }): Arquivo {
  conferirEscopo(e);
  const nome = nomeSeguro(nomeBruto);
  if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw new ErroGestao("O arquivo está vazio.");
  if (conteudo.length > TAMANHO_MAXIMO) throw new ErroGestao(`O arquivo passa de ${TAMANHO_MAXIMO / 1024 / 1024} MB.`, 413);
  const uso = usoDeArmazenamento();
  if (uso.limite_bytes !== null && uso.usado_bytes + conteudo.length > uso.limite_bytes)
    throw new ErroGestao(`O plano atual permite até ${uso.limite_mb} MB de arquivos e o espaço acabou. Apague arquivos antigos ou fale com o suporte para ampliar o plano.`, 402);

  const onde = e.processoId ? "processo_id=?" : "pessoa_id=? AND processo_id IS NULL";
  const anterior = db.prepare(`SELECT id,grupo,versao FROM gestao_arquivos WHERE ${onde} AND lower(nome)=lower(?) ORDER BY versao DESC LIMIT 1`).get(e.processoId ?? e.pessoaId, nome) as { id: number; grupo: number | null; versao: number } | undefined;

  const ano = String(new Date().getFullYear());
  const armazenado = `${ano}/${crypto.randomUUID()}`;
  const destino = path.join(PASTA(), armazenado);
  fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
  fs.writeFileSync(destino, conteudo, { flag: "wx", mode: 0o600 });
  try {
    const info = db.prepare(`INSERT INTO gestao_arquivos(processo_id,pessoa_id,nome,armazenado,mime,tamanho,categoria,descricao,grupo,versao,enviado_por,autor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(e.processoId ?? null, e.processoId ? (e.pessoaId ?? null) : e.pessoaId ?? null, nome, armazenado, TIPOS[extensao(nome)], conteudo.length, String(meta.categoria ?? "").trim().slice(0, 60), String(meta.descricao ?? "").trim().slice(0, 300),
        anterior ? (anterior.grupo ?? anterior.id) : null, anterior ? anterior.versao + 1 : 1, user.id, user.nome);
    const id = Number(info.lastInsertRowid);
    if (!anterior) db.prepare("UPDATE gestao_arquivos SET grupo=id WHERE id=?").run(id);
    if (e.processoId) db.prepare("UPDATE gestao_processos SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(e.processoId);
    return db.prepare("SELECT * FROM gestao_arquivos WHERE id=?").get(id) as Arquivo;
  } catch (err) { fs.rmSync(destino, { force: true }); throw err; }
}

/** Arquivos agrupados por nome: a última versão em destaque, com as anteriores logo abaixo. */
export function listarArquivos(e: Escopo) {
  conferirEscopo(e);
  const linhas = (e.processoId
    ? db.prepare("SELECT * FROM gestao_arquivos WHERE processo_id=? ORDER BY criado_em DESC, id DESC").all(e.processoId)
    : db.prepare("SELECT * FROM gestao_arquivos WHERE pessoa_id=? AND processo_id IS NULL ORDER BY criado_em DESC, id DESC").all(e.pessoaId)) as Arquivo[];
  const grupos = new Map<number, Arquivo[]>();
  for (const l of linhas) { const g = l.grupo ?? l.id; (grupos.get(g) || grupos.set(g, []).get(g)!).push(l); }
  return [...grupos.values()].map((versoes) => {
    const ordenadas = versoes.sort((a, b) => b.versao - a.versao);
    const { armazenado: _a, ...atual } = ordenadas[0];
    return { ...atual, exibivel: EXIBIVEIS.has(extensao(atual.nome)), versoes: ordenadas.slice(1).map(({ armazenado: _b, ...v }) => v) };
  });
}

export function obterArquivo(id: number): Arquivo & { caminho: string } {
  const a = db.prepare("SELECT * FROM gestao_arquivos WHERE id=?").get(id) as Arquivo | undefined;
  if (!a) throw new ErroGestao("Arquivo não encontrado.", 404);
  const caminho = path.resolve(PASTA(), a.armazenado);
  if (!caminho.startsWith(path.resolve(PASTA()) + path.sep)) throw new ErroGestao("Arquivo inválido.", 400);
  return { ...a, caminho };
}
export const podeExibir = (a: Arquivo) => EXIBIVEIS.has(extensao(a.nome));

export function excluirArquivo(id: number) {
  const a = obterArquivo(id);
  db.prepare("DELETE FROM gestao_arquivos WHERE id=?").run(id);
  fs.rmSync(a.caminho, { force: true });
  // se apagou a versão mais recente, o grupo continua válido com as anteriores
  return { ok: true };
}
