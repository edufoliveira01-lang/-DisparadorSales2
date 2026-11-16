import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";

/** Processos que o DJEN trouxe e ninguém ligou a um cliente (nem a uma ficha em Processos): a fila para vincular ou excluir. */
export interface ProcessoSemVinculo {
  chave: string; numero: string; publicacoes: number; ultima_data: string | null; ultimo_tipo: string | null; orgao: string | null;
  publicacao_id: number | null; pericias_agendadas: number; tem_ficha: boolean;
}

export function listarProcessosSemVinculo(): ProcessoSemVinculo[] {
  const rows = db.prepare(`SELECT d.chave,d.numero,
      (SELECT COUNT(*) FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0) AS publicacoes,
      (SELECT p.data_disponibilizacao FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 1) AS ultima_data,
      (SELECT p.tipo_documento FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 1) AS ultimo_tipo,
      (SELECT p.orgao FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 1) AS orgao,
      (SELECT p.id FROM djen_publicacoes p WHERE p.processo_chave=d.chave AND p.cancelada=0 ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 1) AS publicacao_id,
      (SELECT COUNT(*) FROM pericias_agendadas a WHERE a.processo_chave=d.chave AND a.status='ativa') AS pericias_agendadas,
      EXISTS(SELECT 1 FROM gestao_processos g WHERE g.chave=d.chave OR g.djen_chave=d.chave) AS tem_ficha
    FROM djen_processos d
    WHERE d.cliente_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM gestao_partes gp JOIN gestao_processos g ON g.id=gp.processo_id WHERE g.chave=d.chave OR g.djen_chave=d.chave)
    ORDER BY ultima_data DESC`).all() as (Omit<ProcessoSemVinculo, "tem_ficha"> & { tem_ficha: number })[];
  return rows.map((r) => ({ ...r, tem_ficha: Boolean(r.tem_ficha) }));
}

const lerExcluidos = (): string[] => { try { const v = JSON.parse(getSetting("djen_processos_excluidos") || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
/** Processos que o escritório mandou excluir: o DJEN não os recria na próxima consulta. */
export const processoFoiExcluido = (chave: string) => lerExcluidos().includes(chave);

/** Quem cadastra o processo de novo (ficha em Processos) quer o acompanhamento de volta: sai da lista de excluídos. */
export function reativarProcessoExcluido(chave: string): void {
  const l = lerExcluidos();
  if (l.includes(chave)) setSetting("djen_processos_excluidos", JSON.stringify(l.filter((c) => c !== chave)));
}

export class ErroExclusaoDjen extends Error { constructor(m: string, public status = 409) { super(m); } }

/** Exclui o acompanhamento e todas as publicações dele. Recusa o que está em uso: ficha em Processos, cliente vinculado ou perícia agendada. */
export function excluirProcessoDoDjen(chave: string): { ok: true; publicacoes: number } {
  const p = db.prepare("SELECT chave,cliente_id FROM djen_processos WHERE chave=?").get(chave) as { chave: string; cliente_id: number | null } | undefined;
  if (!p) throw new ErroExclusaoDjen("Processo não encontrado.", 404);
  if (p.cliente_id) throw new ErroExclusaoDjen("Este processo está vinculado a um cliente. Remova o vínculo antes de excluir.");
  if (db.prepare("SELECT 1 FROM gestao_processos WHERE chave=? OR djen_chave=? LIMIT 1").get(chave, chave)) throw new ErroExclusaoDjen("Este processo tem ficha em Processos. Exclua por lá (o acompanhamento sem uso sai junto).");
  const pericias = (db.prepare("SELECT COUNT(*) n FROM pericias_agendadas WHERE processo_chave=? AND status='ativa'").get(chave) as { n: number }).n;
  if (pericias > 0) throw new ErroExclusaoDjen(`Há ${pericias} perícia(s)/audiência(s) agendada(s) para este processo. Cancele-as na Agenda antes de excluir.`);
  let n = 0;
  db.transaction(() => {
    const ids = (db.prepare("SELECT id FROM djen_publicacoes WHERE processo_chave=?").all(chave) as { id: number }[]).map((r) => r.id);
    n = ids.length;
    for (const id of ids) {
      try { db.prepare("DELETE FROM djen_mensagens WHERE publicacao_id=?").run(id); } catch { /* tabela opcional */ }
    }
    db.prepare("DELETE FROM djen_publicacoes WHERE processo_chave=?").run(chave);
    for (const sql of ["DELETE FROM djen_historico_consultas WHERE processo_chave=?", "DELETE FROM gestao_datajud WHERE processo_chave=?", "DELETE FROM djen_kanban_cartoes WHERE processo_chave=?"]) {
      try { db.prepare(sql).run(chave); } catch { /* tabela opcional */ }
    }
    db.prepare("DELETE FROM djen_processos WHERE chave=?").run(chave);
    setSetting("djen_processos_excluidos", JSON.stringify([...new Set([...lerExcluidos(), chave])].slice(-2000)));
  })();
  return { ok: true, publicacoes: n };
}
