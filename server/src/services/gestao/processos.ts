import { db } from "../../db";
import { normalizeProcesso } from "../../utils/processo";
import { mensagemSeExcederLimite } from "../../licenca/cliente";
import { ErroGestao, pessoaDoContato } from "./pessoas";
import { salvarValores, valoresDe } from "./campos";
import { cnjValido, dataValida, formatarCnj, tribunalDoCnj } from "./validacao";
import { getSetting, setSetting } from "../settingsService";
import { limparAcompanhamentoSemUso } from "../djen/vigia";

export const STATUS = ["ativo", "suspenso", "arquivado", "encerrado"] as const;
export const PAPEIS = ["autor", "reu", "terceiro", "testemunha", "perito", "advogado_contrario"] as const;
type Papel = typeof PAPEIS[number];
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

interface Linha {
  id: number; numero: string; chave: string; pasta: string; titulo: string; tribunal: string; orgao: string; comarca: string; classe: string; assunto: string; area: string;
  valor_causa_centavos: number | null; fase: string; status: string; responsavel_user_id: number | null; data_distribuicao: string; observacoes: string;
  djen_chave: string | null; criado_em: string; atualizado_em: string;
}

function proximaPasta(): string {
  const ano = new Date().getFullYear();
  const r = db.prepare("SELECT COALESCE(MAX(CAST(substr(pasta,6) AS INTEGER)),0)+1 AS n FROM gestao_processos WHERE pasta LIKE ?").get(`${ano}/%`) as { n: number };
  return `${ano}/${String(r.n).padStart(4, "0")}`;
}

function valorCausa(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new ErroGestao("Valor da causa inválido.");
  return Math.round(n * 100);
}

function limpar(d: Record<string, unknown>, atual?: Linha) {
  const status = String(d.status ?? atual?.status ?? "ativo");
  if (!(STATUS as readonly string[]).includes(status)) throw new ErroGestao("Situação inválida.");
  const dist = txt(d.data_distribuicao ?? atual?.data_distribuicao, 10);
  if (!dataValida(dist)) throw new ErroGestao("Data de distribuição inválida (use AAAA-MM-DD).");
  let resp: number | null = d.responsavel_user_id === undefined ? (atual?.responsavel_user_id ?? null) : d.responsavel_user_id ? Number(d.responsavel_user_id) : null;
  if (resp !== null && !db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(resp)) throw new ErroGestao("Responsável não encontrado ou inativo.");
  return {
    titulo: txt(d.titulo ?? atual?.titulo, 200), tribunal: txt(d.tribunal ?? atual?.tribunal, 60), orgao: txt(d.orgao ?? atual?.orgao, 200), comarca: txt(d.comarca ?? atual?.comarca, 100),
    classe: txt(d.classe ?? atual?.classe, 150), assunto: txt(d.assunto ?? atual?.assunto, 200), area: txt(d.area ?? atual?.area, 40),
    valor: d.valor_causa === undefined ? (atual?.valor_causa_centavos ?? null) : valorCausa(d.valor_causa), fase: txt(d.fase ?? atual?.fase, 100), status,
    resp, dist, observacoes: txt(d.observacoes ?? atual?.observacoes, 4000),
  };
}

export function listarProcessos(f: { busca?: string; status?: string; responsavel?: string; area?: string; pessoa?: string; pagina?: number; limite?: number }) {
  const onde: string[] = []; const par: unknown[] = [];
  if (f.status && (STATUS as readonly string[]).includes(f.status)) { onde.push("p.status=?"); par.push(f.status); }
  if (f.responsavel === "sem") onde.push("p.responsavel_user_id IS NULL");
  else if (f.responsavel && Number(f.responsavel)) { onde.push("p.responsavel_user_id=?"); par.push(Number(f.responsavel)); }
  if (f.area) { onde.push("p.area=?"); par.push(f.area); }
  if (f.pessoa && Number(f.pessoa)) { onde.push("EXISTS (SELECT 1 FROM gestao_partes g WHERE g.processo_id=p.id AND g.pessoa_id=?)"); par.push(Number(f.pessoa)); }
  const busca = txt(f.busca, 100);
  if (busca) {
    const d = normalizeProcesso(busca);
    const like = `%${busca.replace(/[\\%_]/g, "\\$&")}%`;
    onde.push(`(p.chave LIKE ? OR p.titulo LIKE ? ESCAPE '\\' OR p.pasta LIKE ? OR p.classe LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM gestao_partes g JOIN gestao_pessoas pe ON pe.id=g.pessoa_id WHERE g.processo_id=p.id AND (pe.nome LIKE ? ESCAPE '\\' OR (?<>'' AND pe.documento LIKE ?))))`);
    par.push(`%${d || "∅"}%`, like, like, like, like, d.length >= 3 ? d : "", `%${d}%`);
  }
  const limite = Math.min(100, Math.max(1, Math.trunc(f.limite || 30)));
  const pagina = Math.max(1, Math.trunc(f.pagina || 1));
  const w = onde.length ? `WHERE ${onde.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM gestao_processos p ${w}`).get(...par) as { n: number }).n;
  const itens = db.prepare(`SELECT p.*, u.display_name AS responsavel_nome, u.username AS responsavel_usuario,
      (SELECT group_concat(pe.nome, ' • ') FROM gestao_partes g JOIN gestao_pessoas pe ON pe.id=g.pessoa_id WHERE g.processo_id=p.id AND g.papel='autor') AS autores
    FROM gestao_processos p LEFT JOIN users u ON u.id=p.responsavel_user_id ${w} ORDER BY p.atualizado_em DESC, p.id DESC LIMIT ? OFFSET ?`).all(...par, limite, (pagina - 1) * limite) as (Linha & { responsavel_nome: string | null; responsavel_usuario: string | null; autores: string | null })[];
  return { total, pagina, limite, itens: itens.map((i) => ({ ...i, numero_formatado: formatarCnj(i.numero), responsavel: i.responsavel_nome || i.responsavel_usuario || null })) };
}

export function obterProcesso(id: number) {
  const p = db.prepare("SELECT p.*, u.display_name AS responsavel_nome, u.username AS responsavel_usuario FROM gestao_processos p LEFT JOIN users u ON u.id=p.responsavel_user_id WHERE p.id=?").get(id) as (Linha & { responsavel_nome: string | null; responsavel_usuario: string | null }) | undefined;
  if (!p) throw new ErroGestao("Processo não encontrado.", 404);
  const partes = db.prepare("SELECT g.papel,g.principal,pe.id AS pessoa_id,pe.nome,pe.documento,pe.telefone,pe.email,pe.tipo FROM gestao_partes g JOIN gestao_pessoas pe ON pe.id=g.pessoa_id WHERE g.processo_id=? ORDER BY g.principal DESC, g.papel, pe.nome COLLATE NOCASE").all(id);
  return { ...p, numero_formatado: formatarCnj(p.numero), responsavel: p.responsavel_nome || p.responsavel_usuario || null, tribunal_cnj: tribunalDoCnj(p.numero), partes, campos: valoresDe("processo", id) };
}

type ParteEntrada = { pessoa_id: number; papel: Papel; principal?: boolean };
function validarPartes(partes: unknown): ParteEntrada[] {
  if (partes === undefined) return [];
  if (!Array.isArray(partes) || partes.length > 50) throw new ErroGestao("Partes inválidas.");
  return partes.map((p) => {
    const papel = String((p as ParteEntrada)?.papel) as Papel;
    const pessoa = Number((p as ParteEntrada)?.pessoa_id);
    if (!PAPEIS.includes(papel) || !Number.isSafeInteger(pessoa)) throw new ErroGestao("Parte inválida.");
    if (!db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(pessoa)) throw new ErroGestao("Pessoa da parte não encontrada.");
    return { pessoa_id: pessoa, papel, principal: Boolean((p as ParteEntrada).principal) };
  });
}

export function criarProcesso(d: Record<string, unknown>, userId: number | null) {
  const bruto = txt(d.numero, 40);
  const chave = normalizeProcesso(bruto);
  if (chave.length < 7) throw new ErroGestao("Informe o número do processo.");
  if (chave.length === 20 && !cnjValido(chave)) throw new ErroGestao("Número CNJ inválido: o dígito verificador não confere. Confira o número.");
  const ja = db.prepare("SELECT id,pasta FROM gestao_processos WHERE chave=?").get(chave) as { id: number; pasta: string } | undefined;
  if (ja) throw new ErroGestao(`Este processo já está cadastrado (pasta ${ja.pasta}).`, 409);
  const total = (db.prepare("SELECT COUNT(*) n FROM gestao_processos").get() as { n: number }).n;
  const limite = mensagemSeExcederLimite("max_processos", total);
  if (limite) throw new ErroGestao(limite, 402);
  const v = limpar({ ...d, tribunal: d.tribunal || tribunalDoCnj(chave) || "" });
  const partes = validarPartes(d.partes);
  const djen = db.prepare("SELECT chave FROM djen_processos WHERE chave=?").get(chave) as { chave: string } | undefined;
  const id = db.transaction(() => {
    const info = db.prepare(`INSERT INTO gestao_processos(numero,chave,pasta,titulo,tribunal,orgao,comarca,classe,assunto,area,valor_causa_centavos,fase,status,responsavel_user_id,data_distribuicao,observacoes,djen_chave,criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(chave.length === 20 ? formatarCnj(chave) : bruto, chave, proximaPasta(), v.titulo, v.tribunal, v.orgao, v.comarca, v.classe, v.assunto, v.area, v.valor, v.fase, v.status, v.resp, v.dist, v.observacoes, djen?.chave ?? null, userId);
    const novo = Number(info.lastInsertRowid);
    for (const p of partes) db.prepare("INSERT OR IGNORE INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,?,?)").run(novo, p.pessoa_id, p.papel, p.principal ? 1 : 0);
    salvarValores("processo", novo, d.campos);
    return novo;
  })();
  return obterProcesso(id);
}

export function atualizarProcesso(id: number, d: Record<string, unknown>) {
  const atual = db.prepare("SELECT * FROM gestao_processos WHERE id=?").get(id) as Linha | undefined;
  if (!atual) throw new ErroGestao("Processo não encontrado.", 404);
  const v = limpar(d, atual);
  db.prepare(`UPDATE gestao_processos SET titulo=?,tribunal=?,orgao=?,comarca=?,classe=?,assunto=?,area=?,valor_causa_centavos=?,fase=?,status=?,responsavel_user_id=?,data_distribuicao=?,observacoes=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?`)
    .run(v.titulo, v.tribunal, v.orgao, v.comarca, v.classe, v.assunto, v.area, v.valor, v.fase, v.status, v.resp, v.dist, v.observacoes, id);
  salvarValores("processo", id, d.campos);
  return obterProcesso(id);
}

export function excluirProcesso(id: number) {
  obterProcesso(id);
  const antes = db.prepare("SELECT chave,djen_chave FROM gestao_processos WHERE id=?").get(id) as { chave: string; djen_chave: string | null } | undefined;
  db.prepare("DELETE FROM gestao_processos WHERE id=?").run(id);
  if (antes) { try { limparAcompanhamentoSemUso([antes.chave, antes.djen_chave]); } catch (e) { console.error("[gestao] limpeza do acompanhamento:", e instanceof Error ? e.message : e); } }
  return { ok: true };
}

/** Chaves de processos do DJEN que o escritório mandou ignorar (não aparecem mais no aviso «sem ficha de gestão»). */
const lerIgnorados = (): string[] => { try { const v = JSON.parse(getSetting("gestao_djen_ignorados") || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
export function ignorarPendentesDoDjen(): { ignorados: number } {
  const marcas = lerIgnorados();
  const novos = (db.prepare(`SELECT d.chave FROM djen_processos d WHERE length(d.chave)>=7 AND d.chave NOT LIKE 'comunicacao:%'
    AND NOT EXISTS (SELECT 1 FROM gestao_processos g WHERE g.chave=d.chave OR g.djen_chave=d.chave)`).all() as { chave: string }[]).map((r) => r.chave).filter((c) => !marcas.includes(c));
  setSetting("gestao_djen_ignorados", JSON.stringify([...marcas, ...novos].slice(-2000)));
  return { ignorados: novos.length };
}

export function adicionarParte(processoId: number, d: Record<string, unknown>) {
  obterProcesso(processoId);
  const [p] = validarPartes([d]);
  db.transaction(() => {
    if (p.principal) db.prepare("UPDATE gestao_partes SET principal=0 WHERE processo_id=? AND papel=?").run(processoId, p.papel);
    db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,?,?) ON CONFLICT(processo_id,pessoa_id,papel) DO UPDATE SET principal=excluded.principal").run(processoId, p.pessoa_id, p.papel, p.principal ? 1 : 0);
    db.prepare("UPDATE gestao_processos SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(processoId);
  })();
  return obterProcesso(processoId);
}
export function removerParte(processoId: number, pessoaId: number, papel: string) {
  obterProcesso(processoId);
  db.prepare("DELETE FROM gestao_partes WHERE processo_id=? AND pessoa_id=? AND papel=?").run(processoId, pessoaId, papel);
  return obterProcesso(processoId);
}

export function adicionarAnotacao(processoId: number, texto: unknown, user: { id: number | null; nome: string }) {
  obterProcesso(processoId);
  const t = txt(texto, 4000);
  if (t.length < 2) throw new ErroGestao("Escreva a anotação.");
  db.prepare("INSERT INTO gestao_anotacoes(processo_id,user_id,autor,texto) VALUES (?,?,?,?)").run(processoId, user.id, user.nome, t);
  db.prepare("UPDATE gestao_processos SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(processoId);
  return { ok: true };
}
export function removerAnotacao(processoId: number, anotacaoId: number, user: { id: number; admin: boolean }) {
  const a = db.prepare("SELECT user_id FROM gestao_anotacoes WHERE id=? AND processo_id=?").get(anotacaoId, processoId) as { user_id: number | null } | undefined;
  if (!a) throw new ErroGestao("Anotação não encontrada.", 404);
  if (!user.admin && a.user_id !== user.id) throw new ErroGestao("Só quem escreveu (ou um administrador) pode apagar a anotação.", 403);
  db.prepare("DELETE FROM gestao_anotacoes WHERE id=?").run(anotacaoId);
  return { ok: true };
}

export interface EventoLinhaDoTempo { tipo: "publicacao" | "pericia" | "anotacao" | "cadastro"; data: string; titulo: string; detalhe: string; ref?: number | string; autor?: string }
export function linhaDoTempo(id: number): EventoLinhaDoTempo[] {
  const p = obterProcesso(id);
  const ev: EventoLinhaDoTempo[] = [{ tipo: "cadastro", data: p.criado_em.slice(0, 10), titulo: "Processo cadastrado", detalhe: `Pasta ${p.pasta}` }];
  const chaves = [p.chave, p.djen_chave].filter((c): c is string => Boolean(c));
  for (const c of new Set(chaves)) {
    for (const r of db.prepare("SELECT id,data_disponibilizacao,tipo_documento,orgao,texto FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 200").all(c) as { id: number; data_disponibilizacao: string; tipo_documento: string | null; orgao: string; texto: string }[])
      ev.push({ tipo: "publicacao", data: r.data_disponibilizacao.slice(0, 10), titulo: r.tipo_documento || "Publicação no DJEN", detalhe: `${r.orgao ? r.orgao + " — " : ""}${r.texto.replace(/\s+/g, " ").slice(0, 280)}`, ref: r.id });
    for (const r of db.prepare("SELECT id,tipo,data,horario,local FROM pericias_agendadas WHERE processo_chave=? AND status='ativa' ORDER BY data DESC LIMIT 50").all(c) as { id: number; tipo: string; data: string; horario: string | null; local: string | null }[])
      ev.push({ tipo: "pericia", data: r.data.slice(0, 10), titulo: `Perícia/audiência: ${r.tipo}`, detalhe: [r.horario, r.local].filter(Boolean).join(" · "), ref: r.id });
  }
  for (const r of db.prepare("SELECT id,autor,texto,criado_em FROM gestao_anotacoes WHERE processo_id=? ORDER BY id DESC LIMIT 200").all(id) as { id: number; autor: string; texto: string; criado_em: string }[])
    ev.push({ tipo: "anotacao", data: r.criado_em.slice(0, 10), titulo: "Anotação", detalhe: r.texto, ref: r.id, autor: r.autor });
  return ev.sort((a, b) => b.data.localeCompare(a.data));
}

/** Processos monitorados pelo DJEN que ainda não têm ficha de gestão. */
export function pendentesDeImportacao(): number {
  const ign = lerIgnorados();
  return (db.prepare(`SELECT COUNT(*) n FROM djen_processos d WHERE length(d.chave)>=7 AND d.chave NOT LIKE 'comunicacao:%'
    AND NOT EXISTS (SELECT 1 FROM gestao_processos g WHERE g.chave=d.chave OR g.djen_chave=d.chave)${ign.length ? ` AND d.chave NOT IN (${ign.map(() => "?").join(",")})` : ""}`).get(...ign) as { n: number }).n;
}
export function importarDoDjen(userId: number | null) {
  const linhas = db.prepare(`SELECT d.chave,d.numero,d.cliente_id,d.area,
      (SELECT classe FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 1) AS classe,
      (SELECT orgao FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 1) AS orgao,
      (SELECT tribunal FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 1) AS tribunal
    FROM djen_processos d WHERE length(d.chave)>=7 AND d.chave NOT LIKE 'comunicacao:%'
      AND NOT EXISTS (SELECT 1 FROM gestao_processos g WHERE g.chave=d.chave OR g.djen_chave=d.chave)`).all().filter((l) => !lerIgnorados().includes((l as { chave: string }).chave)) as { chave: string; numero: string; cliente_id: number | null; area: string | null; classe: string | null; orgao: string | null; tribunal: string | null }[];
  let criados = 0; let ignorados = 0;
  const total = (db.prepare("SELECT COUNT(*) n FROM gestao_processos").get() as { n: number }).n;
  db.transaction(() => {
    for (const l of linhas) {
      if (mensagemSeExcederLimite("max_processos", total + criados)) { ignorados++; continue; }
      const numero = l.chave.length === 20 ? formatarCnj(l.chave) : l.numero;
      const info = db.prepare(`INSERT INTO gestao_processos(numero,chave,pasta,tribunal,orgao,classe,area,djen_chave,criado_por) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(numero, l.chave, proximaPasta(), l.tribunal || tribunalDoCnj(l.chave) || "", l.orgao || "", l.classe || "", l.area || "", l.chave, userId);
      criados++;
      if (l.cliente_id) {
        const pessoa = pessoaDoContato(l.cliente_id);
        if (pessoa) db.prepare("INSERT OR IGNORE INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(Number(info.lastInsertRowid), pessoa);
      }
    }
  })();
  return { criados, ignorados_por_limite: ignorados };
}

export function resumoGestao() {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    pessoas: n("SELECT COUNT(*) n FROM gestao_pessoas WHERE ativo=1"),
    clientes: n("SELECT COUNT(*) n FROM gestao_pessoas WHERE ativo=1 AND tipo='cliente'"),
    processos_ativos: n("SELECT COUNT(*) n FROM gestao_processos WHERE status='ativo'"),
    processos_total: n("SELECT COUNT(*) n FROM gestao_processos"),
    sem_responsavel: n("SELECT COUNT(*) n FROM gestao_processos WHERE status='ativo' AND responsavel_user_id IS NULL"),
    pendentes_importacao: pendentesDeImportacao(),
    contatos_sem_cadastro: n("SELECT COUNT(*) n FROM contacts c WHERE NOT EXISTS (SELECT 1 FROM gestao_pessoas p WHERE p.contact_id=c.id)"),
  };
}
