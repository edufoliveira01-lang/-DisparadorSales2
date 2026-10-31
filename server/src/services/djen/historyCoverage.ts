import { db } from '../../db';
import { hojeDjen } from './api';
export const HISTORICO_VALIDADE_MS = 6 * 60 * 60 * 1000;
export interface CoberturaHistorico {
  status: 'pendente' | 'verificando' | 'atualizado' | 'falha';
  inicio: string | null; fim: string | null; consultado_em: string | null;
  mensagem: string;
}
type Registro = { status: string; inicio: string | null; fim: string | null; consultado_em: string | null; erro: string | null; revisao: number; revisao_conferida: number };
export function coberturaHistorico(processo: string): CoberturaHistorico {
  const row = db.prepare('SELECT * FROM djen_historico_consultas WHERE processo_chave=?').get(processo) as Registro | undefined;
  const instante = row?.consultado_em ? Date.parse(row.consultado_em.replace(' ', 'T') + 'Z') : NaN;
  const atualizado = row?.status === 'atualizado' && row.fim === hojeDjen() && row.revisao === row.revisao_conferida && Number.isFinite(instante) && Date.now() - instante < HISTORICO_VALIDADE_MS;
  const status = atualizado ? 'atualizado' : row?.status === 'verificando' ? 'verificando' : row?.status === 'falha' ? 'falha' : 'pendente';
  return { status, inicio: row?.inicio || null, fim: row?.fim || null, consultado_em: row?.consultado_em || null,
    mensagem: status === 'atualizado' ? 'Publicações posteriores consultadas no DJEN. Cumprimento não confirmado: conferir os autos antes de cobrar.' : status === 'verificando' ? 'Consultando as publicações posteriores deste processo no DJEN.' : status === 'falha' ? 'Não foi possível confirmar o histórico no DJEN. A pendência não representa atraso confirmado.' : 'Histórico pendente de atualização. A publicação antiga não representa uma obrigação atual confirmada.' };
}
/** Captura ou correção nova invalida uma consulta anterior, inclusive durante a atualização. */
export function invalidarHistorico(processo: string) {
  db.prepare(`INSERT INTO djen_historico_consultas(processo_chave,revisao) VALUES (?,1)
    ON CONFLICT(processo_chave) DO UPDATE SET revisao=revisao+1,
    status=CASE WHEN status='verificando' THEN status ELSE 'pendente' END`).run(processo);
}
export function solicitarHistorico(processo: string) {
  if (!/^\d{20}$/.test(processo)) throw new Error('O processo precisa ter um número CNJ válido para consultar seu histórico.');
  db.prepare(`INSERT INTO djen_historico_consultas(processo_chave) VALUES (?) ON CONFLICT(processo_chave) DO UPDATE SET
    status=CASE WHEN status='verificando' THEN status ELSE 'pendente' END,proxima_tentativa_em=NULL`).run(processo);
}
