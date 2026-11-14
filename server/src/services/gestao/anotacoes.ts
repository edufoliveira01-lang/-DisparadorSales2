import { db } from "../../db";
import { ErroGestao } from "./erro";
import { adicionarAnotacao } from "./processos";

const limpar = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, 4000);
type Quem = { id: number | null; nome: string };
export interface AnotacaoItem { id: number; origem: "cadastro" | "processo"; processo_id: number | null; processo_rotulo: string | null; autor: string; texto: string; criado_em: string; importante: boolean; cumprida_em: string | null; cumprida_por: string | null }
/** Uma pendência: anotação marcada como importante que ninguém deu por cumprida ainda. */
export type Pendencia = AnotacaoItem;
const marcada = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

function pessoaExiste(id: number) {
  if (!db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(id)) throw new ErroGestao("Pessoa não encontrada.", 404);
}
/** Anotação direta no cadastro da pessoa, sem precisar abrir processo. */
export function anotarNaPessoa(pessoaId: number, texto: unknown, quem: Quem, importante: unknown = false) {
  pessoaExiste(pessoaId);
  const t = limpar(texto);
  if (t.length < 2) throw new ErroGestao("Escreva a anotação.");
  const r = db.prepare("INSERT INTO gestao_anotacoes_pessoa(pessoa_id,user_id,autor,texto,importante) VALUES (?,?,?,?,?)").run(pessoaId, quem.id, quem.nome, t, marcada(importante) ? 1 : 0);
  db.prepare("UPDATE gestao_pessoas SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(pessoaId);
  return { ok: true, id: Number(r.lastInsertRowid) };
}
/** Atalho global: anota no processo escolhido (que precisa ser do cliente) ou, sem processo, no cadastro do cliente. */
export function anotacaoRapida(d: { pessoa_id?: unknown; processo_id?: unknown; texto?: unknown; importante?: unknown }, quem: Quem) {
  const pessoaId = Number(d.pessoa_id), processoId = Number(d.processo_id) || 0;
  if (!Number.isSafeInteger(pessoaId) || pessoaId <= 0) throw new ErroGestao("Escolha o cliente.");
  pessoaExiste(pessoaId);
  if (processoId) {
    const liga = db.prepare("SELECT 1 FROM gestao_partes WHERE processo_id=? AND pessoa_id=?").get(processoId, pessoaId);
    if (!liga) throw new ErroGestao("Este processo não pertence ao cliente escolhido.");
    adicionarAnotacao(processoId, d.texto, quem, marcada(d.importante));
    return { ok: true, destino: "processo" as const, processo_id: processoId };
  }
  anotarNaPessoa(pessoaId, d.texto, quem, d.importante);
  return { ok: true, destino: "cadastro" as const, processo_id: null };
}
export function removerAnotacaoDaPessoa(pessoaId: number, anotacaoId: number, user: { id: number; admin: boolean }) {
  const a = db.prepare("SELECT user_id FROM gestao_anotacoes_pessoa WHERE id=? AND pessoa_id=?").get(anotacaoId, pessoaId) as { user_id: number | null } | undefined;
  if (!a) throw new ErroGestao("Anotação não encontrada.", 404);
  if (!user.admin && a.user_id !== user.id) throw new ErroGestao("Só quem escreveu (ou um administrador) pode apagar a anotação.", 403);
  db.prepare("DELETE FROM gestao_anotacoes_pessoa WHERE id=?").run(anotacaoId);
  return { ok: true };
}
type LinhaCad = { id: number; autor: string; texto: string; criado_em: string; importante: number; cumprida_em: string | null; cumprida_por: string | null };
type LinhaProc = LinhaCad & { processo_id: number; pasta: string; numero: string };
const dePessoa = (r: LinhaCad): AnotacaoItem => ({ id: r.id, origem: "cadastro", processo_id: null, processo_rotulo: null, autor: r.autor, texto: r.texto, criado_em: r.criado_em, importante: r.importante === 1, cumprida_em: r.cumprida_em, cumprida_por: r.cumprida_por });
const deProcesso = (r: LinhaProc): AnotacaoItem => ({ id: r.id, origem: "processo", processo_id: r.processo_id, processo_rotulo: `${r.pasta} · ${r.numero}`, autor: r.autor, texto: r.texto, criado_em: r.criado_em, importante: r.importante === 1, cumprida_em: r.cumprida_em, cumprida_por: r.cumprida_por });
const COLS = "id,autor,texto,criado_em,importante,cumprida_em,cumprida_por";
const COLS_A = "a.id,a.autor,a.texto,a.criado_em,a.importante,a.cumprida_em,a.cumprida_por";
const DOS_PROCESSOS = "a.processo_id IN (SELECT processo_id FROM gestao_partes WHERE pessoa_id=?)";
/** Tudo o que foi anotado sobre a pessoa: no cadastro e nos processos dela, do mais recente ao mais antigo. */
export function anotacoesDaPessoa(pessoaId: number): AnotacaoItem[] {
  pessoaExiste(pessoaId);
  const cad = db.prepare(`SELECT ${COLS} FROM gestao_anotacoes_pessoa WHERE pessoa_id=? ORDER BY id DESC LIMIT 300`).all(pessoaId) as LinhaCad[];
  const proc = db.prepare(`SELECT ${COLS_A},p.id AS processo_id,p.pasta,p.numero FROM gestao_anotacoes a JOIN gestao_processos p ON p.id=a.processo_id WHERE ${DOS_PROCESSOS} ORDER BY a.id DESC LIMIT 300`).all(pessoaId) as LinhaProc[];
  return [...cad.map(dePessoa), ...proc.map(deProcesso)]
    .sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0)).slice(0, 300);
}

/** As pendências da pessoa: anotações marcadas como IMPORTANTES que ainda não foram cumpridas (do cadastro e dos processos dela), as mais antigas primeiro. */
export function pendenciasDaPessoa(pessoaId: number): Pendencia[] {
  pessoaExiste(pessoaId);
  const cad = db.prepare(`SELECT ${COLS} FROM gestao_anotacoes_pessoa WHERE pessoa_id=? AND importante=1 AND cumprida_em IS NULL ORDER BY id LIMIT 100`).all(pessoaId) as LinhaCad[];
  const proc = db.prepare(`SELECT ${COLS_A},p.id AS processo_id,p.pasta,p.numero FROM gestao_anotacoes a JOIN gestao_processos p ON p.id=a.processo_id WHERE ${DOS_PROCESSOS} AND a.importante=1 AND a.cumprida_em IS NULL ORDER BY a.id LIMIT 100`).all(pessoaId) as LinhaProc[];
  return [...cad.map(dePessoa), ...proc.map(deProcesso)].sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));
}

/** Dá a pendência por CUMPRIDA (some do aviso, a anotação continua no histórico) ou a reabre. Qualquer pessoa da equipe pode: o aviso é de quem atender o cliente. */
export function cumprirPendencia(origem: "cadastro" | "processo", anotacaoId: number, quem: Quem, cumprida = true) {
  const tabela = origem === "processo" ? "gestao_anotacoes" : "gestao_anotacoes_pessoa";
  const a = db.prepare(`SELECT id,importante FROM ${tabela} WHERE id=?`).get(anotacaoId) as { id: number; importante: number } | undefined;
  if (!a) throw new ErroGestao("Anotação não encontrada.", 404);
  if (a.importante !== 1) throw new ErroGestao("Esta anotação não está marcada como importante.");
  if (cumprida) db.prepare(`UPDATE ${tabela} SET cumprida_em=CURRENT_TIMESTAMP, cumprida_por=? WHERE id=?`).run(quem.nome.slice(0, 80), anotacaoId);
  else db.prepare(`UPDATE ${tabela} SET cumprida_em=NULL, cumprida_por=NULL WHERE id=?`).run(anotacaoId);
  return { ok: true };
}
/** Marca (ou desmarca) uma anotação já existente como importante, para quem esqueceu de marcar na hora. */
export function marcarComoImportante(origem: "cadastro" | "processo", anotacaoId: number, importante: boolean) {
  const tabela = origem === "processo" ? "gestao_anotacoes" : "gestao_anotacoes_pessoa";
  const r = db.prepare(`UPDATE ${tabela} SET importante=?, cumprida_em=NULL, cumprida_por=NULL WHERE id=?`).run(importante ? 1 : 0, anotacaoId);
  if (r.changes === 0) throw new ErroGestao("Anotação não encontrada.", 404);
  return { ok: true };
}

// ---- Anotação feita pelo ATENDIMENTO (Deskcomm): o atendente anota sem sair da conversa ----
const soNumeros = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** As grafias do mesmo celular BR (com e sem o 9º dígito), só dígitos, sem o 55: a busca compara os dois. */
function variantesDoTelefone(tel: string): string[] {
  let d = soNumeros(tel);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11 && d[2] === "9") return [d, d.slice(0, 2) + d.slice(3)];
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) return [d, d.slice(0, 2) + "9" + d.slice(2)];
  return d.length >= 8 ? [d] : [];
}
export interface ClienteParaAnotar {
  encontrado: boolean;
  pessoa?: { id: number; nome: string };
  processos?: { id: number; pasta: string; numero: string; titulo: string; status: string }[];
  recentes?: { autor: string; texto: string; criado_em: string; onde: string }[];
  /** Anotações importantes ainda não cumpridas — o atendente as vê na conversa. */
  pendencias?: { id: number; origem: "cadastro" | "processo"; autor: string; texto: string; criado_em: string; onde: string }[];
}
/** A pessoa do cadastro que tem este telefone (principal ou segundo), preferindo cliente. */
export function pessoaPorTelefone(telefone: unknown): { id: number; nome: string } | null {
  const vars = variantesDoTelefone(String(telefone ?? ""));
  if (vars.length === 0) return null;
  const limpa = (c: string) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${c},' ',''),'-',''),'(',''),')',''),'+','')`;
  const onde = vars.map(() => `(${limpa("telefone")} LIKE ? OR ${limpa("telefone2")} LIKE ?)`).join(" OR ");
  const args = vars.flatMap((v) => [`%${v}`, `%${v}`]);
  return (db.prepare(`SELECT id, nome FROM gestao_pessoas WHERE ativo=1 AND (${onde}) ORDER BY (tipo='cliente') DESC, id DESC LIMIT 1`).get(...args) as { id: number; nome: string } | undefined) ?? null;
}
const resumoDaPendencia = (a: AnotacaoItem) => ({ id: a.id, origem: a.origem, autor: a.autor, texto: a.texto.slice(0, 500), criado_em: a.criado_em, onde: a.processo_rotulo ?? "Cadastro" });
/** Acha o cliente pelo telefone da conversa (cadastro ou segundo telefone) e devolve o que o atendente precisa para anotar. */
export function clienteParaAnotar(telefone: unknown): ClienteParaAnotar {
  const p = pessoaPorTelefone(telefone);
  if (!p) return { encontrado: false };
  const processos = db.prepare(`SELECT p.id, p.pasta, p.numero, p.titulo, p.status FROM gestao_processos p JOIN gestao_partes x ON x.processo_id=p.id WHERE x.pessoa_id=? ORDER BY (p.status='ativo') DESC, p.id DESC LIMIT 30`).all(p.id) as NonNullable<ClienteParaAnotar["processos"]>;
  const recentes = anotacoesDaPessoa(p.id).slice(0, 3).map((a) => ({ autor: a.autor, texto: a.texto.slice(0, 300), criado_em: a.criado_em, onde: a.processo_rotulo ?? "Cadastro" }));
  return { encontrado: true, pessoa: p, processos, recentes, pendencias: pendenciasDaPessoa(p.id).map(resumoDaPendencia) };
}
/** Só as pendências do cliente desta conversa (o aviso que fica no chat do atendimento). */
export function pendenciasPorTelefone(telefone: unknown): { encontrado: boolean; pessoa?: { id: number; nome: string }; pendencias: ReturnType<typeof resumoDaPendencia>[] } {
  const p = pessoaPorTelefone(telefone);
  if (!p) return { encontrado: false, pendencias: [] };
  return { encontrado: true, pessoa: p, pendencias: pendenciasDaPessoa(p.id).map(resumoDaPendencia) };
}
/** Quem é o autor de uma ação do atendimento: o usuário do Sales (pelo e-mail) ou "Nome (atendimento)". */
export function autorDoAtendimento(d: { autor_nome?: unknown; autor_email?: unknown }): Quem {
  const email = String(d.autor_email ?? "").trim().toLowerCase();
  const u = email ? db.prepare("SELECT id, COALESCE(NULLIF(display_name,''), username) AS nome FROM users WHERE lower(email)=? AND active=1").get(email) as { id: number; nome: string } | undefined : undefined;
  const nome = (u?.nome || String(d.autor_nome ?? "").trim() || "Atendimento").slice(0, 80);
  return { id: u?.id ?? null, nome: u ? nome : `${nome} (atendimento)` };
}
/** Grava a anotação do atendente. Quando o e-mail dele é de um usuário do Sales, a anotação fica no nome dele e ele pode apagá-la lá. */
export function anotarPeloAtendimento(d: { pessoa_id?: unknown; processo_id?: unknown; texto?: unknown; importante?: unknown; autor_nome?: unknown; autor_email?: unknown }) {
  return anotacaoRapida({ pessoa_id: d.pessoa_id, processo_id: d.processo_id, texto: d.texto, importante: d.importante }, autorDoAtendimento(d));
}

/** O atendente dá a pendência por cumprida pelo chat: o autor é o usuário do Sales (pelo e-mail) ou "Nome (atendimento)". */
export function cumprirPeloAtendimento(d: { origem?: unknown; id?: unknown; cumprida?: unknown; autor_nome?: unknown; autor_email?: unknown }) {
  const origem = d.origem === "processo" ? "processo" : "cadastro";
  const id = Number(d.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroGestao("Escolha a pendência.");
  return cumprirPendencia(origem, id, autorDoAtendimento(d), d.cumprida !== false);
}
