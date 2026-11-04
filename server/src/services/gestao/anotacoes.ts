import { db } from "../../db";
import { ErroGestao } from "./erro";
import { adicionarAnotacao } from "./processos";

const limpar = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, 4000);
type Quem = { id: number; nome: string };
export interface AnotacaoItem { id: number; origem: "cadastro" | "processo"; processo_id: number | null; processo_rotulo: string | null; autor: string; texto: string; criado_em: string }

function pessoaExiste(id: number) {
  if (!db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(id)) throw new ErroGestao("Pessoa não encontrada.", 404);
}
/** Anotação direta no cadastro da pessoa, sem precisar abrir processo. */
export function anotarNaPessoa(pessoaId: number, texto: unknown, quem: Quem) {
  pessoaExiste(pessoaId);
  const t = limpar(texto);
  if (t.length < 2) throw new ErroGestao("Escreva a anotação.");
  const r = db.prepare("INSERT INTO gestao_anotacoes_pessoa(pessoa_id,user_id,autor,texto) VALUES (?,?,?,?)").run(pessoaId, quem.id, quem.nome, t);
  db.prepare("UPDATE gestao_pessoas SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(pessoaId);
  return { ok: true, id: Number(r.lastInsertRowid) };
}
/** Atalho global: anota no processo escolhido (que precisa ser do cliente) ou, sem processo, no cadastro do cliente. */
export function anotacaoRapida(d: { pessoa_id?: unknown; processo_id?: unknown; texto?: unknown }, quem: Quem) {
  const pessoaId = Number(d.pessoa_id), processoId = Number(d.processo_id) || 0;
  if (!Number.isSafeInteger(pessoaId) || pessoaId <= 0) throw new ErroGestao("Escolha o cliente.");
  pessoaExiste(pessoaId);
  if (processoId) {
    const liga = db.prepare("SELECT 1 FROM gestao_partes WHERE processo_id=? AND pessoa_id=?").get(processoId, pessoaId);
    if (!liga) throw new ErroGestao("Este processo não pertence ao cliente escolhido.");
    adicionarAnotacao(processoId, d.texto, quem);
    return { ok: true, destino: "processo" as const, processo_id: processoId };
  }
  anotarNaPessoa(pessoaId, d.texto, quem);
  return { ok: true, destino: "cadastro" as const, processo_id: null };
}
export function removerAnotacaoDaPessoa(pessoaId: number, anotacaoId: number, user: { id: number; admin: boolean }) {
  const a = db.prepare("SELECT user_id FROM gestao_anotacoes_pessoa WHERE id=? AND pessoa_id=?").get(anotacaoId, pessoaId) as { user_id: number | null } | undefined;
  if (!a) throw new ErroGestao("Anotação não encontrada.", 404);
  if (!user.admin && a.user_id !== user.id) throw new ErroGestao("Só quem escreveu (ou um administrador) pode apagar a anotação.", 403);
  db.prepare("DELETE FROM gestao_anotacoes_pessoa WHERE id=?").run(anotacaoId);
  return { ok: true };
}
/** Tudo o que foi anotado sobre a pessoa: no cadastro e nos processos dela, do mais recente ao mais antigo. */
export function anotacoesDaPessoa(pessoaId: number): AnotacaoItem[] {
  pessoaExiste(pessoaId);
  const cad = db.prepare("SELECT id,autor,texto,criado_em FROM gestao_anotacoes_pessoa WHERE pessoa_id=? ORDER BY id DESC LIMIT 300").all(pessoaId) as { id: number; autor: string; texto: string; criado_em: string }[];
  const proc = db.prepare(`SELECT a.id,a.autor,a.texto,a.criado_em,p.id AS processo_id,p.pasta,p.numero FROM gestao_anotacoes a JOIN gestao_processos p ON p.id=a.processo_id
    WHERE a.processo_id IN (SELECT processo_id FROM gestao_partes WHERE pessoa_id=?) ORDER BY a.id DESC LIMIT 300`).all(pessoaId) as { id: number; autor: string; texto: string; criado_em: string; processo_id: number; pasta: string; numero: string }[];
  return [
    ...cad.map((r): AnotacaoItem => ({ id: r.id, origem: "cadastro", processo_id: null, processo_rotulo: null, autor: r.autor, texto: r.texto, criado_em: r.criado_em })),
    ...proc.map((r): AnotacaoItem => ({ id: r.id, origem: "processo", processo_id: r.processo_id, processo_rotulo: `${r.pasta} · ${r.numero}`, autor: r.autor, texto: r.texto, criado_em: r.criado_em })),
  ].sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0)).slice(0, 300);
}
