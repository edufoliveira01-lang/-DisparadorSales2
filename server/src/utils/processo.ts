/**
 * Chave estável para comparar números de processo independentemente de pontos e hífens.
 * Processos CNJ são formados por dígitos; valores sem dígitos não são usados no vínculo.
 */
export function normalizeProcesso(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}
