export function normalizarMotivoDesconexao(motivo: unknown): string {
  return String(motivo ?? "").trim().toUpperCase();
}

export interface IdentidadeLockWhatsapp {
  hostname: string;
  pid: number;
}

export function existeInstanciaConcorrenteAtiva(
  lock: IdentidadeLockWhatsapp | null,
  hostnameAtual: string,
  pidAtual: number,
  processoAtivo: (pid: number) => boolean
): boolean {
  return Boolean(
    lock &&
    lock.hostname === hostnameAtual &&
    lock.pid !== pidAtual &&
    processoAtivo(lock.pid)
  );
}

/**
 * LOGOUT sempre encerra a sessão. UNPAIRED só invalida uma sessão que já havia chegado a
 * conectado; durante o pareamento, UNPAIRED_IDLE e UNPAIRED podem ser estados transitórios.
 */
export function deveInvalidarSessao(motivo: unknown, estavaConectado: boolean): boolean {
  const valor = normalizarMotivoDesconexao(motivo);
  return valor === "LOGOUT" || (valor === "UNPAIRED" && estavaConectado);
}

/** Bloqueios que não melhoram com uma nova tentativa automática. */
export function motivoImpedeRetryAutomatico(motivo: unknown): boolean {
  const valor = normalizarMotivoDesconexao(motivo);
  return ["LOGOUT", "CONFLICT", "TOS_BLOCK", "SMB_TOS_BLOCK", "PROXYBLOCK"].includes(valor);
}

/** Retry progressivo para evitar um ciclo rápido de abrir e fechar o Chromium. */
export function atrasoRetryConexaoMs(tentativa: number, baseMs = 5000): number {
  const expoente = Math.max(0, Math.min(4, Math.trunc(tentativa) - 1));
  return Math.min(60000, baseMs * 2 ** expoente);
}
