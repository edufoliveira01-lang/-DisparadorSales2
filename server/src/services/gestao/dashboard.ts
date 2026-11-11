/**
 * O painel da tela Início: tudo o que o escritório precisa ver de relance, num pedido só. Cada bloco é calculado separado e à prova de falha
 * (um módulo que não existe neste escritório, como o ZapSign ou o Dropbox, só deixa o bloco vazio).
 */
import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { lerRetrato } from "../../atendimento/indicadores";
import { problemaDoArmazenamento } from "../../armazenamento/fila";
import { somarMeses } from "./financeiro";
import { garantirNegociosDosAssinados } from "./negocios";

const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mesValido = (m: unknown, padrao: string) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? String(m) : padrao);
const um = <T>(sql: string, ...p: unknown[]): T => db.prepare(sql).get(...p) as T;
const num = (sql: string, ...p: unknown[]): number => Number((um<{ v: number | null }>(sql, ...p)).v ?? 0);
const tentar = <T>(f: () => T, padrao: T): T => { try { return f(); } catch { return padrao; } };
/** Os últimos `n` meses terminando em `mes` (do mais antigo ao mais novo). */
export const ultimosMeses = (mes: string, n = 6): string[] => Array.from({ length: n }, (_, i) => somarMeses(`${mes}-01`, i - (n - 1)).slice(0, 7));
const fimDoMes = (mes: string) => somarMeses(`${mes}-01`, 1);

export interface Compromisso { id: number; tipo: string; nome: string; data: string; horario: string | null; local: string | null; processo: string | null; eh_audiencia: boolean }

export function dashboardDoInicio(mesBruto: unknown, podeVerReceita: boolean) {
  const hoje = hojeSaoPaulo();
  const mes = mesValido(mesBruto, hoje.slice(0, 7));
  const ini = `${mes}-01`, fim = fimDoMes(mes);
  const meses = ultimosMeses(mes);
  const serie = (contar: (m: string) => number) => meses.map((m) => ({ mes: m, total: tentar(() => contar(m), 0) }));
  const noMes = (coluna: string, m: string) => `substr(${coluna},1,10) >= '${m}-01' AND substr(${coluna},1,10) < '${fimDoMes(m)}'`;

  // ---- contratos (ZapSign) ----
  // Só contam contratos de uma pessoa que ainda existe no cadastro; e o fechamento PRESENCIAL (marcado na aba Negócio, sem assinatura pelo ZapSign) entra junto.
  const viva = "pessoa_id IS NOT NULL";
  const presenciais = (m: string) => num(`SELECT COUNT(*) v FROM gestao_negocios n WHERE n.tipo_atendimento='presencial' AND n.data_fechamento<>'' AND ${noMes("n.data_fechamento", m)}
    AND NOT EXISTS (SELECT 1 FROM zapsign_contratos z WHERE z.pessoa_id=n.pessoa_id AND z.status='assinado')`);
  const zapAssinados = (m: string) => num(`SELECT COUNT(*) v FROM zapsign_contratos WHERE ${viva} AND status='assinado' AND ${noMes("assinado_em", m)}`);
  const contratos = tentar(() => ({
    assinados_mes: zapAssinados(mes) + tentar(() => presenciais(mes), 0),
    assinados_zapsign_mes: zapAssinados(mes),
    presenciais_mes: tentar(() => presenciais(mes), 0),
    enviados_mes: num(`SELECT COUNT(*) v FROM zapsign_contratos WHERE ${viva} AND ${noMes("criado_em", mes)}`),
    aguardando_assinatura: num(`SELECT COUNT(*) v FROM zapsign_contratos WHERE ${viva} AND status='enviado'`),
    aguardando_mais_de_3_dias: num(`SELECT COUNT(*) v FROM zapsign_contratos WHERE ${viva} AND status='enviado' AND substr(criado_em,1,10) <= ?`, somarDias(hoje, -3)),
    serie: serie((m) => zapAssinados(m) + tentar(() => presenciais(m), 0)),
    serie_enviados: serie((m) => num(`SELECT COUNT(*) v FROM zapsign_contratos WHERE ${viva} AND ${noMes("criado_em", m)}`)),
  }), null);

  // ---- negócios fechados no mês e o que o escritório decidiu sobre cada um ----
  tentar(() => garantirNegociosDosAssinados(), 0);
  const negocios = tentar(() => {
    const q = (qualificacao: string) => num(`SELECT COUNT(*) v FROM gestao_negocios WHERE qualificacao=? AND data_fechamento<>'' AND ${noMes("data_fechamento", mes)}`, qualificacao);
    return {
      fecharam_mes: num(`SELECT COUNT(*) v FROM gestao_negocios WHERE data_fechamento<>'' AND ${noMes("data_fechamento", mes)}`),
      qualificados_mes: q("qualificado"), nao_qualificados_mes: q("nao_qualificado"), aguardando_mes: q("aguardando"), nao_informada_mes: q("nao_informada"),
      serie_qualificados: serie((m) => num(`SELECT COUNT(*) v FROM gestao_negocios WHERE qualificacao='qualificado' AND data_fechamento<>'' AND ${noMes("data_fechamento", m)}`)),
      aguardando_analise_total: num("SELECT COUNT(*) v FROM gestao_negocios WHERE qualificacao='aguardando'"),
    };
  }, null);

  // ---- processos ----
  const processos = {
    protocolados_mes: tentar(() => num(`SELECT COUNT(*) v FROM gestao_processos WHERE data_distribuicao<>'' AND ${noMes("data_distribuicao", mes)}`), 0),
    cadastrados_mes: tentar(() => num(`SELECT COUNT(*) v FROM gestao_processos WHERE ${noMes("criado_em", mes)}`), 0),
    ativos: tentar(() => num("SELECT COUNT(*) v FROM gestao_processos WHERE status='ativo'"), 0),
    sem_responsavel: tentar(() => num("SELECT COUNT(*) v FROM gestao_processos WHERE status='ativo' AND responsavel_user_id IS NULL"), 0),
    serie: serie((m) => num(`SELECT COUNT(*) v FROM gestao_processos WHERE data_distribuicao<>'' AND ${noMes("data_distribuicao", m)}`)),
  };

  // ---- clientes ----
  const clientes = {
    novos_mes: tentar(() => num(`SELECT COUNT(*) v FROM gestao_pessoas WHERE tipo='cliente' AND ${noMes("criado_em", mes)}`), 0),
    total: tentar(() => num("SELECT COUNT(*) v FROM gestao_pessoas WHERE tipo='cliente' AND ativo=1"), 0),
  };

  // ---- perícias e audiências ----
  const eAudiencia = "(lower(tipo) LIKE '%audi%' OR lower(tipo_chave) LIKE '%audi%')";
  const compromissosDe = (de: string, ate: string, limite: number): Compromisso[] => tentar(() => (db.prepare(
    `SELECT id, tipo, nome, data, horario, local, processo, ${eAudiencia} AS eh_audiencia FROM pericias_agendadas WHERE status='ativa' AND data >= ? AND data <= ? ORDER BY data_hora_ms LIMIT ?`,
  ).all(de, ate, limite) as Array<Omit<Compromisso, "eh_audiencia"> & { eh_audiencia: number }>).map((c) => ({ ...c, eh_audiencia: Boolean(c.eh_audiencia) })), []);
  const agoraMs = Date.now();
  const periciasEAudiencias = {
    hoje: compromissosDe(hoje, hoje, 20),
    proximos: compromissosDe(somarDias(hoje, 1), somarDias(hoje, 7), 12),
    hoje_total: tentar(() => num("SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND data=?", hoje), 0),
    semana_total: tentar(() => num("SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND data>=? AND data<=?", hoje, somarDias(hoje, 7)), 0),
    pericias_mes: tentar(() => num(`SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND NOT ${eAudiencia} AND ${noMes("data", mes)}`), 0),
    audiencias_mes: tentar(() => num(`SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND ${eAudiencia} AND ${noMes("data", mes)}`), 0),
    /** Compromissos dos próximos 7 dias que ainda não receberam lembrete: a lista de quem vai ser avisado. */
    para_avisar: tentar(() => num("SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND data_hora_ms > ? AND data <= ? AND ultimo_lembrete_em IS NULL", agoraMs, somarDias(hoje, 7)), 0),
    sem_telefone: tentar(() => num("SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND data_hora_ms > ? AND data <= ? AND (telefone_digits IS NULL OR telefone_digits='')", agoraMs, somarDias(hoje, 7)), 0),
    aguardando_resposta: tentar(() => num("SELECT COUNT(*) v FROM pending_replies WHERE status='aguardando'"), 0),
    avisos_hoje: tentar(() => num("SELECT COUNT(*) v FROM send_logs WHERE status='sucesso' AND substr(created_at,1,10)=?", hoje), 0),
    avisos_com_falha_7d: tentar(() => num("SELECT COUNT(*) v FROM send_logs WHERE status='falha' AND substr(created_at,1,10)>=?", somarDias(hoje, -7)), 0),
  };

  // ---- tarefas, publicações e prazos ----
  const abertas = "status IN ('pendente','em_andamento')";
  const tarefas = {
    atrasadas: tentar(() => num(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND prazo < ?`, hoje), 0),
    hoje: tentar(() => num(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND prazo = ?`, hoje), 0),
    proximos_7_dias: tentar(() => num(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND prazo > ? AND prazo <= ?`, hoje, somarDias(hoje, 7)), 0),
    fatais_5_dias: tentar(() => num(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND prazo_fatal=1 AND prazo >= ? AND prazo <= ?`, hoje, somarDias(hoje, 5)), 0),
    sem_responsavel: tentar(() => num(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND responsavel_user_id IS NULL`), 0),
    concluidas_mes: tentar(() => num(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${noMes("concluida_em", mes)}`), 0),
    lista_urgente: tentar(() => db.prepare(`SELECT id, titulo, prazo, prazo_fatal, processo_id FROM gestao_tarefas WHERE ${abertas} AND prazo <= ? ORDER BY prazo_fatal DESC, prazo LIMIT 6`).all(hoje) as Array<{ id: number; titulo: string; prazo: string; prazo_fatal: number; processo_id: number | null }>, []),
  };
  const publicacoes = {
    nao_lidas: tentar(() => num("SELECT COUNT(*) v FROM djen_publicacoes WHERE lida=0 AND cancelada=0"), 0),
    prazos_vencidos: tentar(() => num("SELECT COUNT(*) v FROM djen_prazos WHERE status='aberto' AND termino < ?", hoje), 0),
    prazos_7_dias: tentar(() => num("SELECT COUNT(*) v FROM djen_prazos WHERE status='aberto' AND termino >= ? AND termino <= ?", hoje, somarDias(hoje, 7)), 0),
  };

  // ---- financeiro (só para quem vê) ----
  const financeiro = !podeVerReceita ? null : tentar(() => ({
    recebido_mes_centavos: num(`SELECT COALESCE(SUM(COALESCE(valor_pago_centavos, valor_centavos)),0) v FROM gestao_lancamentos WHERE tipo='receber' AND cancelado=0 AND pago_em IS NOT NULL AND ${noMes("pago_em", mes)}`),
    a_receber_mes_centavos: num(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='receber' AND cancelado=0 AND pago_em IS NULL AND ${noMes("vencimento", mes)}`),
    em_atraso_centavos: num("SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='receber' AND cancelado=0 AND pago_em IS NULL AND vencimento < ?", hoje),
    em_atraso_quantidade: num("SELECT COUNT(*) v FROM gestao_lancamentos WHERE tipo='receber' AND cancelado=0 AND pago_em IS NULL AND vencimento < ?", hoje),
    a_pagar_mes_centavos: num(`SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='pagar' AND cancelado=0 AND pago_em IS NULL AND ${noMes("vencimento", mes)}`),
    serie_recebido: serie((m) => num(`SELECT COALESCE(SUM(COALESCE(valor_pago_centavos, valor_centavos)),0) v FROM gestao_lancamentos WHERE tipo='receber' AND cancelado=0 AND pago_em IS NOT NULL AND ${noMes("pago_em", m)}`)),
  }), null);

  // ---- documentos no Dropbox ----
  const documentos = tentar(() => ({
    enviados_mes: num(`SELECT COUNT(*) v FROM armazenamento_fila WHERE status='enviado' AND ${noMes("enviado_em", mes)}`),
    com_erro: num("SELECT COUNT(*) v FROM armazenamento_fila WHERE status='erro'"),
    aguardando_pasta: num("SELECT COUNT(*) v FROM armazenamento_fila WHERE status='aguardando_pasta'"),
    esperando_assinatura: num("SELECT COUNT(*) v FROM armazenamento_espera"),
    problema: problemaDoArmazenamento().texto,
  }), null);

  // ---- atendimento (retrato enviado pelo Deskcomm) ----
  const retrato = lerRetrato();
  const atendimento = retrato ? {
    atualizado_em: retrato.gerado_em,
    mes: retrato.meses.find((m) => m.mes === mes) ?? { mes, novos: 0, qualificados: 0, desqualificados: 0, sem_interesse: 0, em_andamento: 0 },
    serie: meses.map((m) => retrato.meses.find((x) => x.mes === m) ?? { mes: m, novos: 0, qualificados: 0, desqualificados: 0, sem_interesse: 0, em_andamento: 0 }),
    por_etapa: retrato.por_etapa,
    abertos: retrato.abertos,
  } : null;

  return { hoje, mes, meses, contratos, negocios, processos, clientes, periciasEAudiencias, tarefas, publicacoes, financeiro, documentos, atendimento };
}
