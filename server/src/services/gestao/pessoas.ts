import { normalizePhone } from "../../utils/phone";
import { deletePericiaAgendada } from "../periciasAgendadasService";
import { db } from "../../db";
import { soDigitos, documentoValido, formatarDocumento, emailValido, dataValida, UFS, pisValido, formatarPis, formatarCep } from "./validacao";

import { ErroGestao } from "./erro";
import { salvarValores, valoresDe } from "./campos";
import { fotoDaPessoa } from "./fichaConfig";
export { ErroGestao };

export const TIPOS_PESSOA = ["cliente", "parte_contraria", "testemunha", "perito", "outro"] as const;
export type TipoPessoa = typeof TIPOS_PESSOA[number];
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export interface Pessoa {
  id: number; tipo: TipoPessoa; pessoa_juridica: number; nome: string; documento: string; rg: string; email: string; telefone: string; telefone2: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string;
  data_nascimento: string; profissao: string; estado_civil: string; origem: string; observacoes: string;
  escolaridade: string; pis: string; nome_mae: string; filiacao: string; nacionalidade: string; sexo: string;
  contact_id: number | null; ativo: number; criado_em: string; atualizado_em: string;
}

function limpar(d: Record<string, unknown>, atual?: Pessoa) {
  const nome = txt(d.nome ?? atual?.nome, 200);
  if (nome.length < 2) throw new ErroGestao("Informe o nome.");
  const tipo = (d.tipo ?? atual?.tipo ?? "cliente") as TipoPessoa;
  if (!TIPOS_PESSOA.includes(tipo)) throw new ErroGestao("Tipo de pessoa inválido.");
  const documento = soDigitos(d.documento ?? atual?.documento ?? "");
  if (!documentoValido(documento)) throw new ErroGestao("CPF ou CNPJ inválido. Confira os dígitos (ou deixe em branco).");
  const email = txt(d.email ?? atual?.email, 254).toLowerCase();
  if (!emailValido(email)) throw new ErroGestao("E-mail inválido.");
  const uf = txt(d.uf ?? atual?.uf, 2).toUpperCase();
  if (uf && !UFS.has(uf)) throw new ErroGestao("UF inválida.");
  const nasc = txt(d.data_nascimento ?? atual?.data_nascimento, 10);
  if (!dataValida(nasc)) throw new ErroGestao("Data de nascimento inválida (use AAAA-MM-DD).");
  const pis = soDigitos(d.pis ?? atual?.pis ?? "");
  if (!pisValido(pis)) throw new ErroGestao("PIS/NIT inválido. Confira os 11 dígitos (ou deixe em branco).");
  const pj = d.pessoa_juridica !== undefined ? (d.pessoa_juridica ? 1 : 0) : atual ? atual.pessoa_juridica : documento.length === 14 ? 1 : 0;
  return {
    tipo, pessoa_juridica: pj, nome, documento, rg: txt(d.rg ?? atual?.rg, 30), email,
    telefone: txt(d.telefone ?? atual?.telefone, 30), telefone2: txt(d.telefone2 ?? atual?.telefone2, 30),
    cep: soDigitos(d.cep ?? atual?.cep).slice(0, 8), logradouro: txt(d.logradouro ?? atual?.logradouro, 200), numero: txt(d.numero ?? atual?.numero, 20),
    complemento: txt(d.complemento ?? atual?.complemento, 100), bairro: txt(d.bairro ?? atual?.bairro, 100), cidade: txt(d.cidade ?? atual?.cidade, 100), uf,
    data_nascimento: nasc, profissao: txt(d.profissao ?? atual?.profissao, 100), estado_civil: txt(d.estado_civil ?? atual?.estado_civil, 40),
    origem: txt(d.origem ?? atual?.origem, 100), observacoes: txt(d.observacoes ?? atual?.observacoes, 4000),
    escolaridade: txt(d.escolaridade ?? atual?.escolaridade, 60), nacionalidade: txt(d.nacionalidade ?? atual?.nacionalidade, 40), sexo: ["M", "F"].includes(txt(d.sexo ?? atual?.sexo, 1).toUpperCase()) ? txt(d.sexo ?? atual?.sexo, 1).toUpperCase() : "", pis, nome_mae: txt(d.nome_mae ?? atual?.nome_mae, 200), filiacao: txt(d.filiacao ?? atual?.filiacao, 300),
  };
}
const CAMPOS = ["tipo", "pessoa_juridica", "nome", "documento", "rg", "email", "telefone", "telefone2", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "data_nascimento", "profissao", "estado_civil", "origem", "observacoes", "escolaridade", "pis", "nome_mae", "filiacao", "nacionalidade", "sexo"] as const;

const visao = (p: Pessoa) => ({ ...p, documento_formatado: formatarDocumento(p.documento), pis_formatado: formatarPis(p.pis), cep_formatado: formatarCep(p.cep), ativo: Boolean(p.ativo), pessoa_juridica: Boolean(p.pessoa_juridica) });

/** Telefone "a conferir": vazio ou sem DDD + 8/9 dígitos (o aviso não chega). Aproxima pelo tamanho em dígitos (10 a 13 com o 55). */
const FONE_DIGITOS = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(p.telefone,' ',''),'-',''),'(',''),')',''),'+','')";
const SQL_FONE_CONFERIR = `(LENGTH(${FONE_DIGITOS})<10 OR LENGTH(${FONE_DIGITOS})>13)`;
const SQL_SEM_PROCESSO = "NOT EXISTS (SELECT 1 FROM gestao_partes g WHERE g.pessoa_id=p.id)";
export function listarPessoas(f: { busca?: string; tipo?: string; ativo?: string; pagina?: number; limite?: number; filtro?: string }) {
  const onde: string[] = []; const par: unknown[] = [];
  if (f.tipo && TIPOS_PESSOA.includes(f.tipo as TipoPessoa)) { onde.push("p.tipo=?"); par.push(f.tipo); }
  if (f.ativo === "0" || f.ativo === "1") { onde.push("p.ativo=?"); par.push(Number(f.ativo)); }
  const busca = txt(f.busca, 100);
  if (busca) {
    const d = soDigitos(busca);
    onde.push(`(p.nome LIKE ? ESCAPE '\\' OR p.email LIKE ? ESCAPE '\\' ${d.length >= 3 ? "OR p.documento LIKE ? OR REPLACE(REPLACE(REPLACE(REPLACE(p.telefone,' ',''),'-',''),'(',''),')','') LIKE ?" : ""}
      OR p.id IN (SELECT g.pessoa_id FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id WHERE pr.titulo LIKE ? ESCAPE '\\' OR pr.pasta LIKE ? ${d.length >= 3 ? "OR pr.chave LIKE ?" : ""}))`);
    const like = `%${busca.replace(/[\\%_]/g, "\\$&")}%`;
    par.push(like, like); if (d.length >= 3) par.push(`%${d}%`, `%${d}%`);
    par.push(like, like); if (d.length >= 3) par.push(`%${d}%`);
  }
  const limite = Math.min(100, Math.max(1, Math.trunc(f.limite || 30)));
  const pagina = Math.max(1, Math.trunc(f.pagina || 1));
  // Os painéis de cima contam dentro de tipo/situação, sem a busca e sem o filtro escolhido.
  const base = onde.slice(0, (f.tipo && TIPOS_PESSOA.includes(f.tipo as TipoPessoa) ? 1 : 0) + (f.ativo === "0" || f.ativo === "1" ? 1 : 0)), basePar = par.slice(0, base.length);
  const wb = base.length ? `WHERE ${base.join(" AND ")}` : "";
  const conta = (extra: string) => (db.prepare(`SELECT COUNT(*) n FROM gestao_pessoas p ${wb}${extra ? `${wb ? " AND" : "WHERE"} ${extra}` : ""}`).get(...basePar) as { n: number }).n;
  const resumo = { total: conta(""), sem_processo: conta(SQL_SEM_PROCESSO), com_processo: conta(`NOT ${SQL_SEM_PROCESSO}`), telefone_conferir: conta(SQL_FONE_CONFERIR) };
  if (f.filtro === "sem_processo") onde.push(SQL_SEM_PROCESSO);
  else if (f.filtro === "com_processo") onde.push(`NOT ${SQL_SEM_PROCESSO}`);
  else if (f.filtro === "telefone_conferir") onde.push(SQL_FONE_CONFERIR);
  const w = onde.length ? `WHERE ${onde.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM gestao_pessoas p ${w}`).get(...par) as { n: number }).n;
  const linhas = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM gestao_partes g WHERE g.pessoa_id=p.id) AS processos FROM gestao_pessoas p ${w} ORDER BY p.nome COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...par, limite, (pagina - 1) * limite) as (Pessoa & { processos: number })[];
  const ids = linhas.map((l) => l.id);
  const procs = ids.length ? (db.prepare(`SELECT g.pessoa_id,g.papel,pr.id,pr.pasta,pr.numero,pr.titulo,pr.status,pr.area FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id WHERE g.pessoa_id IN (${ids.map(() => "?").join(",")}) ORDER BY pr.atualizado_em DESC`).all(...ids) as { pessoa_id: number; papel: string; id: number; pasta: string; numero: string; titulo: string; status: string; area: string }[]) : [];
  const porPessoa = new Map<number, typeof procs>();
  for (const x of procs) (porPessoa.get(x.pessoa_id) || porPessoa.set(x.pessoa_id, []).get(x.pessoa_id)!).push(x);
  return { total, pagina, limite, resumo, itens: linhas.map((l) => ({ ...visao(l), processos_lista: (porPessoa.get(l.id) || []).slice(0, 4) })) };
}

export function obterPessoa(id: number) {
  const p = db.prepare("SELECT * FROM gestao_pessoas WHERE id=?").get(id) as Pessoa | undefined;
  if (!p) throw new ErroGestao("Pessoa não encontrada.", 404);
  const processos = db.prepare(`SELECT pr.id,pr.numero,pr.pasta,pr.titulo,pr.status,g.papel FROM gestao_partes g JOIN gestao_processos pr ON pr.id=g.processo_id WHERE g.pessoa_id=? ORDER BY pr.atualizado_em DESC`).all(id);
  return { ...visao(p), processos, campos: valoresDe("pessoa", id), tem_foto: Boolean(fotoDaPessoa(id)) };
}

export function criarPessoa(d: Record<string, unknown>) {
  const v = limpar(d);
  if (v.documento) {
    const dup = db.prepare("SELECT id,nome FROM gestao_pessoas WHERE documento=? LIMIT 1").get(v.documento) as { id: number; nome: string } | undefined;
    if (dup) throw new ErroGestao(`Já existe cadastro com esse documento: ${dup.nome}.`, 409);
  }
  const novoId = db.transaction(() => {
    const info = db.prepare(`INSERT INTO gestao_pessoas(${CAMPOS.join(",")}) VALUES (${CAMPOS.map(() => "?").join(",")})`).run(...CAMPOS.map((c) => v[c]));
    const novo = Number(info.lastInsertRowid);
    salvarValores("pessoa", novo, d.campos);
    return novo;
  })();
  return obterPessoa(novoId);
}

export function atualizarPessoa(id: number, d: Record<string, unknown>) {
  const atual = db.prepare("SELECT * FROM gestao_pessoas WHERE id=?").get(id) as Pessoa | undefined;
  if (!atual) throw new ErroGestao("Pessoa não encontrada.", 404);
  const v = limpar(d, atual);
  if (v.documento) {
    const dup = db.prepare("SELECT id,nome FROM gestao_pessoas WHERE documento=? AND id<>? LIMIT 1").get(v.documento, id) as { id: number; nome: string } | undefined;
    if (dup) throw new ErroGestao(`Já existe cadastro com esse documento: ${dup.nome}.`, 409);
  }
  const ativo = d.ativo === undefined ? atual.ativo : d.ativo ? 1 : 0;
  db.transaction(() => {
    db.prepare(`UPDATE gestao_pessoas SET ${CAMPOS.map((c) => `${c}=?`).join(",")},ativo=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`).run(...CAMPOS.map((c) => v[c]), ativo, id);
    salvarValores("pessoa", id, d.campos);
  })();
  return obterPessoa(id);
}

/** Perícias e audiências ATIVAS ligadas ao telefone da pessoa. Elas não somem com o cadastro e reaparecem para quem usar o mesmo número depois. */
export function periciasDoTelefoneDaPessoa(id: number): { id: number; tipo: string; nome: string; data: string; horario: string | null }[] {
  const p = db.prepare("SELECT telefone,telefone2 FROM gestao_pessoas WHERE id=?").get(id) as { telefone: string; telefone2: string } | undefined;
  if (!p) return [];
  const fones = [...new Set([p.telefone, p.telefone2].map((t) => normalizePhone(t)).filter((t) => t.length >= 8))];
  if (fones.length === 0) return [];
  return db.prepare(`SELECT id,tipo,nome,data,horario FROM pericias_agendadas WHERE status='ativa' AND telefone_digits IN (${fones.map(() => "?").join(",")}) ORDER BY data_hora_ms LIMIT 50`).all(...fones) as never;
}
/** O que o diálogo de exclusão precisa mostrar antes do clique. */
export function previaDaExclusao(id: number) {
  obterPessoa(id);
  const pericias = periciasDoTelefoneDaPessoa(id);
  const processos = (db.prepare("SELECT COUNT(*) n FROM gestao_partes WHERE pessoa_id=?").get(id) as { n: number }).n;
  return { processos, pericias };
}
export function excluirPessoa(id: number, opcoes: { cancelarPericias?: boolean } = {}) {
  obterPessoa(id);
  const n = (db.prepare("SELECT COUNT(*) n FROM gestao_partes WHERE pessoa_id=?").get(id) as { n: number }).n;
  if (n > 0) throw new ErroGestao(`Esta pessoa participa de ${n} processo(s). Inative o cadastro em vez de excluir.`, 409);
  // Escolhido no diálogo: cancelar as perícias do telefone junto (senão voltam a aparecer para quem usar o número depois).
  const pericias = opcoes.cancelarPericias ? periciasDoTelefoneDaPessoa(id) : [];
  db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(id);
  let canceladas = 0;
  for (const x of pericias) { try { if (deletePericiaAgendada(x.id)) canceladas++; } catch { /* segue com as demais */ } }
  return { ok: true, pericias_canceladas: canceladas };
}

/** Cria o cadastro completo a partir de um contato antigo (idempotente: um contato gera uma única pessoa). */
export function pessoaDoContato(contactId: number): number | null {
  const ja = db.prepare("SELECT id FROM gestao_pessoas WHERE contact_id=?").get(contactId) as { id: number } | undefined;
  if (ja) return ja.id;
  const c = db.prepare("SELECT id,nome,telefone,observacoes FROM contacts WHERE id=?").get(contactId) as { id: number; nome: string; telefone: string; observacoes: string | null } | undefined;
  if (!c || c.nome.trim().length < 2) return null;
  const info = db.prepare("INSERT INTO gestao_pessoas(tipo,nome,telefone,observacoes,origem,contact_id) VALUES ('cliente',?,?,?,'Contatos do sistema',?)").run(c.nome.trim().slice(0, 200), c.telefone, c.observacoes || "", c.id);
  return Number(info.lastInsertRowid);
}
export function importarContatos() {
  let criadas = 0;
  db.transaction(() => {
    for (const c of db.prepare("SELECT id FROM contacts").all() as { id: number }[]) {
      const antes = db.prepare("SELECT id FROM gestao_pessoas WHERE contact_id=?").get(c.id);
      if (!antes && pessoaDoContato(c.id)) criadas++;
    }
  })();
  return { criadas, total: (db.prepare("SELECT COUNT(*) n FROM gestao_pessoas").get() as { n: number }).n };
}
