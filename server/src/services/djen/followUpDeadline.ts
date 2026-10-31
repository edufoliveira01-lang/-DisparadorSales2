import type { ObrigacaoDetectada } from './obligations';
import { calcularPrazo, type CalendarioForense } from './deadlines';
import { lerCalendario, calendarioParaCalculo } from './officialCalendars/store';
import { chaveEscopo } from './officialCalendars/utils';

export interface PrazoAcompanhamento {
  prazo_texto: string | null; prazo_unidade: string | null;
  prazo_termino: string | null; prazo_observacao: string;
  prazo_pendente: boolean; dias_espera: number | null; exibir: boolean;
}
/** Somente calendários já importados/conferidos: a leitura de alertas não dispara downloads. */
export function prazoDoAcompanhamento(ordem: ObrigacaoDetectada, pub: { tribunal: string; orgao: string; data_disponibilizacao: string }, padrao: number, hoje: string): PrazoAcompanhamento {
  const base = pub.data_disponibilizacao.slice(0, 10);
  const decorrido = Math.floor((Date.parse(hoje + 'T12:00:00Z') - Date.parse(base + 'T12:00:00Z')) / 86400000);
  const r: PrazoAcompanhamento = { prazo_texto: ordem.prazo_texto || null, prazo_unidade: ordem.unidade || null,
    prazo_termino: null, prazo_pendente: false, dias_espera: ordem.prazo_citado_dias, exibir: false, prazo_observacao: '' };
  if (!Number.isFinite(decorrido) || decorrido < 0) return r;
  if (!ordem.prazo_texto && !ordem.prazo_citado_dias) return { ...r, dias_espera: padrao, exibir: decorrido >= padrao,
    prazo_observacao: `Sem período expresso: lembrete operacional após ${padrao} dias corridos da disponibilização.` };
  const pendente = (motivo: string) => ({ ...r, exibir: true, prazo_pendente: true, prazo_observacao: motivo });
  if (ordem.unidade === 'data_expressa') {
    const m = ordem.prazo_texto?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const data = m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : '';
    if (!data || !Number.isFinite(Date.parse(data + 'T12:00:00Z')) || new Date(data + 'T12:00:00Z').toISOString().slice(0,10) !== data) return pendente('Data expressa inválida: conferir no ato.');
    return { ...r, prazo_termino: data, exibir: hoje > data, prazo_observacao: 'Data limite expressamente indicada no ato.' };
  }
  if (ordem.alerta || !ordem.prazo_citado_dias) return pendente(ordem.alerta || 'Período expresso: confira unidade e termo inicial; não foi substituído por 30 dias.');
  if (/\b(?:inss|ceab|autarquia)\b/i.test(ordem.responsavel) || /(?:intima[cç][aã]o pessoal|ci[eê]ncia pessoal|domic[ií]lio|a partir|contad[oa]s? d|a contar|ap[oó]s)/i.test(ordem.trecho))
    return pendente('Prazo expresso: conferir a ciência/intimação pessoal ou o evento inicial nos autos antes de contar.');
  try {
    const extras: CalendarioForense[] = [];
    const ano = Number(base.slice(0,4));
    for (let a = ano; a <= ano + 3; a++) {
      const c = lerCalendario(chaveEscopo(pub.tribunal, pub.orgao, a));
      const calculavel = c && calendarioParaCalculo(c);
      if (calculavel) extras.push(calculavel);
    }
    const p = calcularPrazo(pub.tribunal, pub.orgao, { dias: ordem.prazo_citado_dias, base, marco: 'disponibilizacao',
      confirmado: true, regime: 'cpc', unidade: ordem.unidade === 'corridos' ? 'corridos' : 'uteis' }, extras);
    return { ...r, prazo_termino: p.termino, exibir: hoje > p.termino,
      prazo_observacao: 'Previsão CPC pelo DJEN e calendário conferido. Confira destinatário, termo inicial e eventual regime especial nos autos.' };
  } catch (e) {
    return pendente(e instanceof Error ? e.message : 'Calendário sem cobertura: conferir prazo expresso.');
  }
}
