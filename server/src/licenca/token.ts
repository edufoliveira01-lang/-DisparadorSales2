/**
 * Licença assinada (Ed25519). O painel assina; cada instância só precisa da chave pública, então
 * não consegue forjar nem estender a própria licença. Formato: `v1.<carga base64url>.<assinatura>`.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as assinar, verify as conferir } from "node:crypto";
import type { Entitlements } from "./entitlements";

export type StatusLicenca = "teste" | "ativa" | "carencia" | "suspensa" | "cancelada";

export interface CargaLicenca {
  v: 1;
  escritorio_id: string;
  slug: string;
  nome: string;
  plano: string;
  /** Rótulo calculado pelo painel no momento da emissão; a instância reavalia pelas datas. */
  status: StatusLicenca;
  entitlements: Entitlements;
  /** Fim do período pago/de teste (ISO). null = sem vencimento (cortesia). */
  vence_em: string | null;
  /** Último instante da carência (ISO). Após ele, a instância fica somente leitura. */
  carencia_ate: string | null;
  emitida_em: string;
  /** Renovada a cada verificação. Sem contato além disso (+ tolerância), a instância restringe. */
  valido_ate: string;
  tolerancia_offline_dias: number;
  mensagem?: string | null;
}

export const gerarParDeChaves = () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privada: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publica: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
};

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function assinarLicenca(carga: CargaLicenca, chavePrivadaPem: string): string {
  const corpo = b64(JSON.stringify(carga));
  const assinatura = assinar(null, Buffer.from(`v1.${corpo}`), createPrivateKey(chavePrivadaPem));
  return `v1.${corpo}.${b64(assinatura)}`;
}

/** Retorna a carga somente se a assinatura confere e o formato é o esperado. */
export function verificarLicenca(token: unknown, chavePublicaPem: string): CargaLicenca | null {
  try {
    if (typeof token !== "string" || token.length > 8000) return null;
    const [versao, corpo, assinatura] = token.split(".");
    if (versao !== "v1" || !corpo || !assinatura) return null;
    const ok = conferir(null, Buffer.from(`v1.${corpo}`), createPublicKey(chavePublicaPem), Buffer.from(assinatura, "base64url"));
    if (!ok) return null;
    const carga = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as CargaLicenca;
    if (carga.v !== 1 || typeof carga.escritorio_id !== "string" || typeof carga.valido_ate !== "string" || typeof carga.emitida_em !== "string") return null;
    return carga;
  } catch { return null; }
}

export interface EstadoLicenca {
  status: StatusLicenca | "sem_contato";
  /** Somente leitura: bloqueia alterações e rotinas automáticas, mantém consulta e exportação. */
  restrito: boolean;
  aviso: string | null;
  vence_em: string | null;
  dias_restantes: number | null;
}

const DIA = 86_400_000;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Estado atual a partir da licença e do relógio local. Usa as datas da própria licença, então uma
 * assinatura vencida avança para carência e suspensão no momento certo mesmo sem contato com o painel.
 */
export function avaliarLicenca(carga: CargaLicenca, agora: Date = new Date()): EstadoLicenca {
  const t = agora.getTime();
  const vence = carga.vence_em ? Date.parse(carga.vence_em) : null;
  const carencia = carga.carencia_ate ? Date.parse(carga.carencia_ate) : null;
  const dias = vence === null ? null : Math.ceil((vence - t) / DIA);
  const base = { vence_em: carga.vence_em, dias_restantes: dias };

  if (carga.status === "cancelada") return { ...base, status: "cancelada", restrito: true, aviso: carga.mensagem || "Assinatura cancelada. O sistema está em modo somente leitura; exporte seus dados em Backup." };
  // Suspensa pelo painel (inadimplência vencida ou decisão do administrador): restringe até uma nova licença.
  if (carga.status === "suspensa")
    return { ...base, status: "suspensa", restrito: true, aviso: carga.mensagem || "Assinatura suspensa. O sistema está em modo somente leitura. Regularize o pagamento para voltar a operar." };

  // Sem contato com o painel por tempo demais: restringe, para uma licença cancelada não durar para sempre.
  const limiteSemContato = Date.parse(carga.valido_ate) + (carga.tolerancia_offline_dias || 0) * DIA;
  if (t > limiteSemContato)
    return { ...base, status: "sem_contato", restrito: true, aviso: "Não foi possível validar a licença há muitos dias. Verifique a conexão do servidor com o painel de licenças." };

  if (vence !== null && t > vence) {
    if (carencia !== null && t <= carencia)
      return { ...base, status: "carencia", restrito: false, aviso: `Pagamento em atraso desde ${fmt(carga.vence_em!)}. Regularize até ${fmt(carga.carencia_ate!)} para evitar o modo somente leitura.` };
    return { ...base, status: "suspensa", restrito: true, aviso: "Assinatura vencida. O sistema está em modo somente leitura. Regularize o pagamento para voltar a operar." };
  }
  if (t > Date.parse(carga.valido_ate))
    return { ...base, status: carga.status === "teste" ? "teste" : "ativa", restrito: false, aviso: "Sem contato recente com o painel de licenças; o sistema segue funcionando por tempo limitado." };
  if (carga.status === "teste" && dias !== null)
    return { ...base, status: "teste", restrito: false, aviso: `Período de teste: ${dias} dia(s) restante(s).` };
  if (dias !== null && dias <= 5)
    return { ...base, status: "ativa", restrito: false, aviso: `Sua assinatura vence em ${dias} dia(s) (${fmt(carga.vence_em!)}).` };
  return { ...base, status: "ativa", restrito: false, aviso: null };
}
