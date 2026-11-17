/**
 * Indicadores do ATENDIMENTO (Deskcomm) para a tela Início: o Deskcomm calcula e EMPURRA um retrato pelo mesmo canal assinado dos contratos
 * (`POST /api/integracao/indicadores`); aqui só se guarda (em `settings`) e se lê. Nada é calculado no Sales a partir do atendimento.
 */
import { getSetting, setSetting } from "../services/settingsService";

const CHAVE = "atendimento_indicadores";

export interface MesDoAtendimento {
  mes: string;
  /** Leads que nasceram neste mês. */
  novos: number;
  /** Chegaram a proposta, contrato ou documentos (ou fecharam). */
  qualificados: number;
  desqualificados: number;
  /** Perdidos por outro motivo (sem interesse etc.). */
  sem_interesse: number;
  /** Ainda em novo contato ou triagem. */
  em_andamento: number;
  /** Quantos leads do mês vieram de cada fonte (o texto de fonte como o atendimento guarda). */
  fontes?: Record<string, number>;
}
export interface EtapaAgora { nome: string; total: number; posicao: number }
/** Quem JÁ É CLIENTE (funil de clientes do atendimento): acompanhado à parte, fora da conta de captação (leads). */
export interface ClientesNoAtendimento { abertos: number; por_etapa: EtapaAgora[] }
export interface RetratoDoAtendimento { gerado_em: string; meses: MesDoAtendimento[]; por_etapa: EtapaAgora[]; abertos: number; clientes?: ClientesNoAtendimento }

const inteiro = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
const texto = (v: unknown, max = 80) => String(v ?? "").slice(0, max);

const fontesDe = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v && typeof v === "object" ? v : {}) as Record<string, unknown>).slice(0, 30).map(([k, n]) => [texto(k, 60), inteiro(n)]));

/** Valida e normaliza o que veio do atendimento (nunca confia no formato). Devolve `null` se não tem o mínimo. */
export function normalizarRetrato(bruto: unknown): RetratoDoAtendimento | null {
  const b = (bruto ?? {}) as Record<string, unknown>;
  if (!Array.isArray(b.meses)) return null;
  const meses = b.meses.slice(0, 36).flatMap((m): MesDoAtendimento[] => {
    const x = (m ?? {}) as Record<string, unknown>;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(x.mes))) return [];
    return [{ mes: String(x.mes), novos: inteiro(x.novos), qualificados: inteiro(x.qualificados), desqualificados: inteiro(x.desqualificados), sem_interesse: inteiro(x.sem_interesse), em_andamento: inteiro(x.em_andamento), fontes: fontesDe(x.fontes) }];
  });
  const por_etapa = (Array.isArray(b.por_etapa) ? b.por_etapa : []).slice(0, 30).map((e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    return { nome: texto(x.nome), total: inteiro(x.total), posicao: inteiro(x.posicao) };
  }).filter((e) => e.nome);
  const c = (b.clientes && typeof b.clientes === "object" ? b.clientes : null) as Record<string, unknown> | null;
  const clientes: ClientesNoAtendimento | undefined = c ? {
    abertos: inteiro(c.abertos),
    por_etapa: (Array.isArray(c.por_etapa) ? c.por_etapa : []).slice(0, 30).map((e) => { const x = (e ?? {}) as Record<string, unknown>; return { nome: texto(x.nome), total: inteiro(x.total), posicao: inteiro(x.posicao) }; }).filter((e) => e.nome),
  } : undefined;
  return { gerado_em: new Date().toISOString(), meses, por_etapa, abertos: inteiro(b.abertos), ...(clientes ? { clientes } : {}) };
}

export function guardarRetrato(bruto: unknown): RetratoDoAtendimento | null {
  const r = normalizarRetrato(bruto);
  if (r) setSetting(CHAVE, JSON.stringify(r));
  return r;
}

export function lerRetrato(): RetratoDoAtendimento | null {
  try {
    const v = getSetting(CHAVE);
    return v ? (JSON.parse(v) as RetratoDoAtendimento) : null;
  } catch {
    return null;
  }
}
