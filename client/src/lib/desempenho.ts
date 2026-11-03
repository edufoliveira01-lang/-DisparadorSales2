/**
 * Modo leve: remove desfoque de fundo, sombras e animações, que pesam em computadores com placa
 * de vídeo integrada ou pouca memória. Em "auto" liga sozinho em máquinas modestas.
 */
export type ModoLeve = "auto" | "ligado" | "desligado";
const CHAVE = "disparazap:modo-leve";

export function lerModoLeve(): ModoLeve {
  try {
    const v = window.localStorage.getItem(CHAVE);
    return v === "ligado" || v === "desligado" ? v : "auto";
  } catch { return "auto"; }
}
export function maquinaModesta(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
export function modoLeveAtivo(modo: ModoLeve = lerModoLeve()): boolean {
  return modo === "ligado" || (modo === "auto" && maquinaModesta());
}
export function aplicarModoLeve(modo: ModoLeve = lerModoLeve()) {
  document.documentElement.classList.toggle("modo-leve", modoLeveAtivo(modo));
}
export function salvarModoLeve(modo: ModoLeve) {
  try { window.localStorage.setItem(CHAVE, modo); } catch { /* sem armazenamento: vale só nesta sessão */ }
  aplicarModoLeve(modo);
}
