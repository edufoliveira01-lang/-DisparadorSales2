/**
 * A tela CAPTAÇÃO: quantos entraram, quantos fecharam, quantos o escritório qualificou, mês a mês no ano, e por fonte, tipo de atendimento, responsável,
 * área e motivo. «Entraram» soma duas portas: o atendimento pelo WhatsApp (o Deskcomm conta todos os leads que chegaram, inclusive os que nunca assinaram)
 * e os clientes presenciais cadastrados aqui. «Fecharam» é contrato assinado; as qualificações são as registradas pela equipe, pelo MÊS DO FECHAMENTO.
 */
import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { lerRetrato } from "../../atendimento/indicadores";
import { AREAS, garantirNegociosDosAssinados, lerFontes, MOTIVOS, normalizarFonte, pendentesDePreenchimento } from "./negocios";

const mesValido = (m: unknown) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? String(m) : "");
const anoValido = (a: unknown, padrao: string) => (/^20\d{2}$/.test(String(a)) ? String(a) : padrao);
const rotulo = (lista: readonly { chave: string; rotulo: string }[], chave: string, vazio = "Não informado") => lista.find((o) => o.chave === chave)?.rotulo ?? (chave ? chave : vazio);

export interface LinhaMensal { mes: string; entraram_atendimento: number; entraram_presencial: number; entraram: number; fecharam: number; qualificados: number; nao_qualificados: number; aguardando: number; nao_informada: number }
const zero = (mes: string): LinhaMensal => ({ mes, entraram_atendimento: 0, entraram_presencial: 0, entraram: 0, fecharam: 0, qualificados: 0, nao_qualificados: 0, aguardando: 0, nao_informada: 0 });

interface LinhaDeNegocio { fonte: string; tipo_atendimento: string; qualificacao: string; motivo: string; area: string; entrada: string; fechamento: string; responsavel: string | null }

export function captacao(anoBruto: unknown, mesBruto: unknown) {
  garantirNegociosDosAssinados();
  const hoje = hojeSaoPaulo();
  const ano = anoValido(anoBruto, hoje.slice(0, 4));
  const mesFiltro = mesValido(mesBruto);
  const meses = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`);
  const tabela = new Map(meses.map((m) => [m, zero(m)]));
  const periodo = (data: string) => (mesFiltro ? data.slice(0, 7) === mesFiltro : data.slice(0, 4) === ano);

  const linhas = db.prepare(
    `SELECT n.fonte, n.tipo_atendimento, n.qualificacao, n.motivo, n.area,
            COALESCE(NULLIF(n.data_entrada,''), n.data_fechamento) AS entrada, n.data_fechamento AS fechamento,
            COALESCE(NULLIF(u.display_name,''), u.username) AS responsavel
     FROM gestao_negocios n LEFT JOIN users u ON u.id=n.fechado_por_user_id`,
  ).all() as LinhaDeNegocio[];

  const fontes = lerFontes();
  const porFonte = new Map<string, { entraram: number; fecharam: number; qualificados: number; nao_qualificados: number }>();
  const fonteDe = (chave: string) => { const k = chave || "sem_fonte"; if (!porFonte.has(k)) porFonte.set(k, { entraram: 0, fecharam: 0, qualificados: 0, nao_qualificados: 0 }); return porFonte.get(k)!; };
  const porAtendimento = new Map<string, { fecharam: number; qualificados: number }>();
  const porResponsavel = new Map<string, { fecharam: number; qualificados: number; nao_qualificados: number }>();
  const porArea = new Map<string, { fecharam: number; qualificados: number }>();
  const motivos = new Map<string, number>();
  const funil = { entraram: 0, fecharam: 0, qualificados: 0, protocolados: 0 };

  for (const l of linhas) {
    const eMes = l.entrada.slice(0, 7);
    if (l.tipo_atendimento === "presencial" && tabela.has(eMes)) { tabela.get(eMes)!.entraram_presencial++; }
    if (l.tipo_atendimento === "presencial" && l.entrada && periodo(l.entrada)) { fonteDe(l.fonte).entraram++; funil.entraram++; }
    const fMes = l.fechamento.slice(0, 7);
    const linhaF = tabela.get(fMes);
    if (linhaF && l.fechamento) {
      linhaF.fecharam++;
      if (l.qualificacao === "qualificado") linhaF.qualificados++; else if (l.qualificacao === "nao_qualificado") linhaF.nao_qualificados++; else if (l.qualificacao === "aguardando") linhaF.aguardando++; else linhaF.nao_informada++;
    }
    if (l.fechamento && periodo(l.fechamento)) {
      funil.fecharam++;
      const f = fonteDe(l.fonte); f.fecharam++;
      const a = porAtendimento.get(l.tipo_atendimento) ?? { fecharam: 0, qualificados: 0 }; a.fecharam++;
      const r = porResponsavel.get(l.responsavel ?? "") ?? { fecharam: 0, qualificados: 0, nao_qualificados: 0 }; r.fecharam++;
      const ar = porArea.get(l.area) ?? { fecharam: 0, qualificados: 0 }; ar.fecharam++;
      if (l.qualificacao === "qualificado") { f.qualificados++; a.qualificados++; r.qualificados++; ar.qualificados++; funil.qualificados++; }
      if (l.qualificacao === "nao_qualificado") { f.nao_qualificados++; r.nao_qualificados++; motivos.set(l.motivo, (motivos.get(l.motivo) ?? 0) + 1); }
      porAtendimento.set(l.tipo_atendimento, a); porResponsavel.set(l.responsavel ?? "", r); porArea.set(l.area, ar);
    }
  }

  // entraram pelo atendimento (WhatsApp): o retrato que o Deskcomm empurra
  const retrato = lerRetrato();
  for (const m of retrato?.meses ?? []) {
    const linha = tabela.get(m.mes);
    if (linha) linha.entraram_atendimento = m.novos;
    if (periodo(`${m.mes}-01`)) {
      funil.entraram += m.novos;
      for (const [bruta, qtd] of Object.entries(m.fontes ?? {})) fonteDe(normalizarFonte(bruta) || "sem_fonte").entraram += qtd;
    }
  }
  const total = zero(ano);
  for (const l of tabela.values()) {
    l.entraram = l.entraram_atendimento + l.entraram_presencial;
    for (const k of Object.keys(total) as (keyof LinhaMensal)[]) if (k !== "mes") (total[k] as number) += l[k] as number;
  }
  const de = mesFiltro ? `${mesFiltro}-01` : `${ano}-01-01`;
  const ate = mesFiltro ? `${mesFiltro}-31` : `${ano}-12-31`;
  funil.protocolados = (db.prepare("SELECT COUNT(*) v FROM gestao_processos WHERE data_distribuicao<>'' AND data_distribuicao>=? AND data_distribuicao<=?").get(de, ate) as { v: number }).v;

  const ordenar = <T extends { entraram?: number; fecharam?: number }>(a: T, b: T) => (b.entraram ?? 0) - (a.entraram ?? 0) || (b.fecharam ?? 0) - (a.fecharam ?? 0);
  return {
    ano, mes: mesFiltro || null, atualizado_em_atendimento: retrato?.gerado_em ?? null,
    meses: [...tabela.values()], total,
    por_fonte: [...porFonte].map(([chave, v]) => ({ chave, rotulo: chave === "sem_fonte" ? "Sem fonte informada" : rotulo(fontes, chave), ...v })).sort(ordenar),
    por_atendimento: [...porAtendimento].map(([chave, v]) => ({ chave, rotulo: chave === "presencial" ? "Presencial" : chave === "online" ? "Online" : "Não informado", ...v })),
    por_responsavel: [...porResponsavel].map(([nome, v]) => ({ nome: nome || "Não informado", ...v })).sort((a, b) => b.fecharam - a.fecharam),
    por_area: [...porArea].map(([chave, v]) => ({ chave, rotulo: rotulo(AREAS, chave), ...v })).sort((a, b) => b.fecharam - a.fecharam),
    motivos: [...motivos].map(([chave, total]) => ({ chave, rotulo: rotulo(MOTIVOS, chave), total })).sort((a, b) => b.total - a.total),
    funil, pendentes: pendentesDePreenchimento(1000).length,
  };
}
