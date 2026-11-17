import { db } from "../../db";

/**
 * A FAIXA DE URGÊNCIA da tela Publicações — o que olhar ANTES de qualquer outra coisa, às 8h da manhã:
 * prazos vencidos sem baixa, prazos que vencem hoje, perícias/audiências nos próximos 7 dias, datas a confirmar (compromisso sem dados completos)
 * e publicações novas que ninguém conferiu. Tudo calculado na hora, só de andamentos abertos (não concluídos, não cancelados).
 */
export function urgenciaDasPublicacoes(agora = new Date()) {
  const hoje = new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10); // Brasília
  const n = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
  const abertas = "p.cancelada=0 AND p.concluida=0";
  const vencidos = n(`SELECT COUNT(DISTINCT p.processo_chave) n FROM djen_prazos d JOIN djen_publicacoes p ON p.id=d.publicacao_id WHERE d.status='aberto' AND d.termino<? AND ${abertas}`, hoje);
  const vencemHoje = n(`SELECT COUNT(DISTINCT p.processo_chave) n FROM djen_prazos d JOIN djen_publicacoes p ON p.id=d.publicacao_id WHERE d.status='aberto' AND d.termino=? AND ${abertas}`, hoje);
  const agoraMs = agora.getTime();
  const compromissos = n("SELECT COUNT(*) n FROM pericias_agendadas WHERE status='ativa' AND data_hora_ms BETWEEN ? AND ?", agoraMs, agoraMs + 7 * 86_400_000);
  const aConfirmar = n(`SELECT COUNT(*) n FROM djen_publicacoes p WHERE ${abertas} AND p.compromisso_estado='completar'`);
  const novas = n(`SELECT COUNT(*) n FROM djen_publicacoes p WHERE ${abertas} AND p.revisada=0`);
  return { vencidos, vencem_hoje: vencemHoje, compromissos_7_dias: compromissos, datas_a_confirmar: aConfirmar, novas_para_triagem: novas, hoje };
}
