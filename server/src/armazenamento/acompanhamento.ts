/**
 * Acompanhamento próprio dos contratos enviados e ainda não assinados.
 *
 * O Sales só registra a assinatura (e guarda o PDF assinado) quando alguém consulta o estado do contrato. Sem isto, a cópia para o drive dependia de
 * um sistema de fora fazer essa consulta. Aqui o próprio Sales confere, de poucos em poucos minutos, os contratos recentes ainda não assinados —
 * só nos escritórios que já ligaram o drive, e uma falha em um contrato nunca derruba os outros.
 */
import { db } from "../db";
import { estadoDoContrato } from "../zapsign/contratos";
import { lerCredenciais } from "./banco";

const MAXIMO_POR_RODADA = 10;
const JANELA_EM_DIAS = 30;
let timer: NodeJS.Timeout | null = null;

export async function conferirContratosPendentes(): Promise<number> {
  if (!lerCredenciais()) return 0;
  let ids: number[];
  try {
    ids = (db.prepare(`SELECT id FROM zapsign_contratos WHERE status <> 'assinado' AND pessoa_id IS NOT NULL
      AND criado_em >= datetime('now', ?) ORDER BY id DESC LIMIT ?`).all(`-${JANELA_EM_DIAS} days`, MAXIMO_POR_RODADA) as { id: number }[]).map((l) => l.id);
  } catch { return 0; }
  let conferidos = 0;
  for (const id of ids) {
    try { await estadoDoContrato(id); conferidos++; } catch { /* ZapSign fora do ar ou sem configuração: tenta na próxima rodada */ }
  }
  return conferidos;
}

export function iniciarAcompanhamentoDeContratos(intervaloMs = 5 * 60_000): void {
  if (timer) return;
  timer = setInterval(() => { void conferirContratosPendentes().catch(() => undefined); }, intervaloMs);
  timer.unref?.();
}
export function pararAcompanhamentoDeContratos(): void { if (timer) clearInterval(timer); timer = null; }
