import type { CargaLicenca, StatusLicenca } from "../licenca/token";
import { combinarEntitlements, normalizarEntitlements } from "../licenca/entitlements";

export interface EscritorioStatusEntrada {
  status_manual: string | null;
  teste_ate: string | null;
  pago_ate: string | null;
  carencia_dias: number | null;
}
export interface StatusEfetivo {
  status: StatusLicenca;
  vence_em: string | null; // ISO, fim do dia (-03:00)
  carencia_ate: string | null;
}

/** Datas do painel são AAAA-MM-DD; o vencimento vale até o fim desse dia em Brasília. */
export const fimDoDia = (data: string) => `${data}T23:59:59-03:00`;
export const hojeIso = (agora: Date) => new Date(agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Um mês depois, preservando o dia (31 → último dia do mês seguinte). */
export function somarMes(data: string): string {
  const [a, m, d] = data.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m, 1, 12));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
const maior = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : a || b);

export function calcularStatus(e: EscritorioStatusEntrada, agora: Date, carenciaPadraoDias: number): StatusEfetivo {
  const fim = maior(e.pago_ate, e.teste_ate);
  const vence_em = fim ? fimDoDia(fim) : null;
  const carencia_ate = fim ? fimDoDia(somarDias(fim, e.carencia_dias ?? carenciaPadraoDias)) : null;
  if (e.status_manual === "cancelada") return { status: "cancelada", vence_em, carencia_ate };
  if (e.status_manual === "suspensa") return { status: "suspensa", vence_em, carencia_ate };
  if (!fim) return { status: "ativa", vence_em: null, carencia_ate: null }; // cortesia, sem vencimento
  const t = agora.getTime();
  if (t <= Date.parse(vence_em!)) {
    const pago = e.pago_ate && (!e.teste_ate || e.pago_ate >= e.teste_ate);
    return { status: pago ? "ativa" : "teste", vence_em, carencia_ate };
  }
  if (t <= Date.parse(carencia_ate!)) return { status: "carencia", vence_em, carencia_ate };
  return { status: "suspensa", vence_em, carencia_ate };
}

export interface DadosCarga {
  id: string; slug: string; nome: string; plano_id: string;
  entitlements_plano: string; entitlements_escritorio: string;
  status_manual: string | null; teste_ate: string | null; pago_ate: string | null; carencia_dias: number | null;
}
export function montarCarga(d: DadosCarga, agora: Date, opcoes: { carenciaPadraoDias: number; validadeHoras: number; toleranciaOfflineDias: number }): CargaLicenca {
  const st = calcularStatus(d, agora, opcoes.carenciaPadraoDias);
  const entitlements = combinarEntitlements(normalizarEntitlements(JSON.parse(d.entitlements_plano || "{}")), normalizarEntitlements(JSON.parse(d.entitlements_escritorio || "{}")));
  return {
    v: 1, escritorio_id: d.id, slug: d.slug, nome: d.nome, plano: d.plano_id,
    status: st.status, entitlements, vence_em: st.vence_em, carencia_ate: st.carencia_ate,
    emitida_em: agora.toISOString(),
    valido_ate: new Date(agora.getTime() + opcoes.validadeHoras * 3_600_000).toISOString(),
    tolerancia_offline_dias: opcoes.toleranciaOfflineDias,
  };
}
