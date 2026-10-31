import { db } from '../../db';
export interface AtividadeProcesso { desde: string; dias: number; nivel: 'verde' | 'amarelo' | 'vermelho'; ultima_providencia_em: string | null }
const diaSP = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export function medirInatividade(criado: string, providencia: string | null, agora = new Date()): AtividadeProcesso | null {
  const instante = (s: string) => Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  const inicio = instante(criado), ultima = providencia ? instante(providencia) : Number.NaN;
  const desde = Math.max(inicio, Number.isFinite(ultima) ? ultima : inicio);
  if (!Number.isFinite(desde)) return null;
  const dias = Math.max(0, Math.round((Date.parse(diaSP(agora) + 'T12:00:00Z') - Date.parse(diaSP(new Date(desde)) + 'T12:00:00Z')) / 86400000));
  return { desde: new Date(desde).toISOString(), dias, nivel: dias >= 30 ? 'vermelho' : dias >= 15 ? 'amarelo' : 'verde', ultima_providencia_em: providencia };
}
/** Uma consulta agregada por tela; leitura e reclassificação automática não contam como providência. */
export function atividadesProcessos(): Map<string, AtividadeProcesso> {
  const rows = db.prepare(`SELECT p.processo_chave,MIN(p.created_at) AS criado FROM djen_publicacoes p
    WHERE p.cancelada=0 AND p.concluida=0 GROUP BY p.processo_chave`).all() as { processo_chave: string; criado: string }[];
  const ultimas = db.prepare(`SELECT p.processo_chave,MAX(h.created_at) AS ultima FROM djen_historico h
    JOIN djen_publicacoes p ON p.id=h.publicacao_id WHERE p.cancelada=0
    AND h.tipo IN ('providencia','mensagem','envio','prazo','documento','pericia','processo','revisao','conclusao') GROUP BY p.processo_chave
    UNION ALL SELECT p.processo_chave,MAX(m.finished_at) AS ultima FROM djen_mensagens m JOIN djen_publicacoes p ON p.id=m.publicacao_id WHERE m.status='sucesso' AND p.cancelada=0 GROUP BY p.processo_chave
    UNION ALL SELECT processo_chave,MAX(created_at) AS ultima FROM djen_kanban_movimentos WHERE origem_movimento='manual' GROUP BY processo_chave`).all() as { processo_chave: string; ultima: string }[];
  const porProcesso = new Map<string, string>();
  for (const h of ultimas) if (h.ultima > (porProcesso.get(h.processo_chave) || '')) porProcesso.set(h.processo_chave, h.ultima);
  const agora = new Date();
  const saida = new Map<string, AtividadeProcesso>();
  for (const p of rows) {
    const atividade = medirInatividade(p.criado, porProcesso.get(p.processo_chave) || null, agora);
    if (atividade) saida.set(p.processo_chave, atividade);
  }
  return saida;
}
