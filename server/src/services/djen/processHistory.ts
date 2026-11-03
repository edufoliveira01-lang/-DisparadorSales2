import { db } from '../../db';
import { licencaPermiteOperar } from "../../licenca/cliente";
import { emitEvent } from '../../websocket';
import { consultarDjen, DjenApiError, hojeDjen, type AdvogadoDjen, type ContextoConsulta } from './api';
import { importarPublicacoes } from './store';
import { coberturaHistorico, HISTORICO_VALIDADE_MS } from './historyCoverage';
import { atualizarKanbanComNovasPublicacoes } from './kanban';

const mudou = () => emitEvent('djen:changed', {});
const ativo = `(EXISTS (SELECT 1 FROM djen_publicacoes p WHERE p.processo_chave=h.processo_chave AND p.cancelada=0 AND p.concluida=0)
 OR EXISTS (SELECT 1 FROM pericias_agendadas pa WHERE pa.processo_chave=h.processo_chave AND pa.status='ativa' AND pa.data_hora_ms<=strftime('%s','now')*1000))`;

let emCurso: Promise<void> | null = null;
let controller: AbortController | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let primeiro: ReturnType<typeof setTimeout> | null = null;
function incluirProcessos() {
  db.prepare(`INSERT OR IGNORE INTO djen_historico_consultas(processo_chave)
    SELECT processo_chave FROM djen_publicacoes WHERE cancelada=0 AND concluida=0 AND length(processo_chave)=20
    UNION SELECT processo_chave FROM pericias_agendadas WHERE status='ativa' AND length(processo_chave)=20 AND data_hora_ms<=strftime('%s','now')*1000`).run();
}
export function escopoHistorico(processo: string): { inicio: string; fim: string } | null {
  const row = db.prepare(`SELECT MIN(data) AS inicio FROM (
    SELECT data_disponibilizacao AS data FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0
    UNION ALL SELECT date(data_hora_ms/1000,'unixepoch','-3 hours') AS data FROM pericias_agendadas WHERE processo_chave=? AND status='ativa')`).get(processo,processo) as { inicio: string | null };
  const fim = hojeDjen();
  return row.inicio && row.inicio <= fim ? { inicio: row.inicio, fim } : null;
}
/** Nenhuma cobertura é gravada em caso de erro, página ausente ou processo divergente. */
export async function atualizarHistoricoProcesso(processo: string, ctx: ContextoConsulta) {
  if (!/^\d{20}$/.test(processo)) throw new Error('Número CNJ inválido.');
  const escopo = escopoHistorico(processo);
  if (!escopo) return;
  const estado = db.prepare('SELECT revisao FROM djen_historico_consultas WHERE processo_chave=?').get(processo) as { revisao: number } | undefined;
  if (!estado) return;
  const conhecidos = (db.prepare('SELECT comunicacao_id FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0').all(processo) as { comunicacao_id: string }[]).map(p => p.comunicacao_id);
  const recebidos = new Set<string>();
  db.prepare("UPDATE djen_historico_consultas SET status='verificando',erro=NULL WHERE processo_chave=?").run(processo);
  mudou();
  try {
    // O filtro por processo substitui os filtros de advogado; não perde atos posteriores
    // cujo destinatário é outra parte. Cada item é conferido na camada da API.
    const filtro: AdvogadoDjen = { id:0,nome:'',numero_oab:'',uf_oab:'',modo_busca:'oab',ativo:1,cursor_data:null,ultimo_sucesso_em:null,ultimo_erro:null };
    await consultarDjen(filtro,'oab',escopo.inicio,escopo.fim,items => {
      for (const p of items) recebidos.add(p.comunicacao_id);
      importarPublicacoes(items,null,'oab',processo);
    },ctx,processo);
    if (conhecidos.some(id => !recebidos.has(id))) throw new Error('A consulta não reencontrou todas as publicações já conhecidas. Histórico não confirmado.');
    const atual = escopoHistorico(processo);
    if (!atual || atual.inicio < escopo.inicio || atual.fim !== escopo.fim) throw new Error('O período mudou durante a consulta. Histórico será conferido novamente.');
    db.prepare(`UPDATE djen_historico_consultas SET
      status=CASE WHEN revisao=? THEN 'atualizado' ELSE 'pendente' END,
      inicio=?,fim=?,consultado_em=CURRENT_TIMESTAMP,revisao_conferida=?,erro=NULL,
      proxima_tentativa_em=NULL WHERE processo_chave=?`).run(estado.revisao,escopo.inicio,escopo.fim,estado.revisao,processo);
    try { atualizarKanbanComNovasPublicacoes(); } catch { console.error("[DJEN] Histórico atualizado; quadro pendente de revisão."); }
  } catch (e) {
    db.prepare("UPDATE djen_historico_consultas SET status='falha',erro=?,proxima_tentativa_em=datetime('now','+15 minutes') WHERE processo_chave=?")
      .run(e instanceof Error ? e.message.slice(0,500) : 'Falha ao consultar histórico.',processo);
    throw e;
  } finally { mudou(); }
}
export function processarHistoricos(): Promise<void> {
  if (emCurso) return emCurso;
  controller = new AbortController();
  const signal = controller.signal;
  emCurso = (async () => {
    incluirProcessos();
    const rows = db.prepare(`SELECT h.processo_chave FROM djen_historico_consultas h
      WHERE length(h.processo_chave)=20 AND h.processo_chave NOT GLOB '*[^0-9]*'
      AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=CURRENT_TIMESTAMP)
      AND (${ativo} OR (status='pendente' AND EXISTS (SELECT 1 FROM djen_publicacoes p WHERE p.processo_chave=h.processo_chave)))
      ORDER BY CASE WHEN status='pendente' THEN 0 ELSE 1 END,COALESCE(consultado_em,''),processo_chave`).all() as { processo_chave: string }[];
    const ctx: ContextoConsulta = { requests:0,signal };
    let feitos=0;
    for (const p of rows) {
      if (signal.aborted || feitos>=5 || ctx.requests>=100) break;
      if (coberturaHistorico(p.processo_chave).status==='atualizado') continue;
      feitos++;
      try { await atualizarHistoricoProcesso(p.processo_chave,ctx); }
      catch (e) { if (signal.aborted || e instanceof DjenApiError && [403,429].includes(e.status)) break; /* Nova tentativa com espera; não libera alertas. */ }
    }
  })().finally(() => { emCurso=null; controller=null; });
  return emCurso;
}
export function iniciarMonitorHistoricos() {
  if (timer) return;
  db.prepare("UPDATE djen_historico_consultas SET status='pendente' WHERE status='verificando'").run();
  const executar = () => { if (!licencaPermiteOperar()) return; void processarHistoricos().catch(e => console.error('[DJEN] Falha ao atualizar históricos:', e instanceof Error ? e.message : 'Falha interna')); };
  primeiro=setTimeout(executar,15000); primeiro.unref();
  timer=setInterval(executar,60000); timer.unref();
}
export function pararMonitorHistoricos() {
  if (primeiro) clearTimeout(primeiro);
  if (timer) clearInterval(timer);
  primeiro=null; timer=null; controller?.abort();
}
export function resumoHistoricos() {
  const corte = new Date(Date.now()-HISTORICO_VALIDADE_MS).toISOString().replace('T',' ').slice(0,19);
  return db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status='atualizado' AND fim=? AND consultado_em>? AND revisao=revisao_conferida THEN 1 ELSE 0 END) AS atualizados FROM djen_historico_consultas h WHERE ${ativo} AND length(h.processo_chave)=20 AND h.processo_chave NOT GLOB '*[^0-9]*'`).get(hojeDjen(),corte) as { total: number; atualizados: number | null };
}
