import fs from "node:fs";
import { getSetting, setSetting } from "./settingsService";
import { recordSystemLog } from "./systemLogsService";
import { canaisConfigurados, enviarPeloCanal, type CanalNotificacao } from "./notificationService";

/**
 * Aviso de pouco espaço em disco. Confere de hora em hora os discos do servidor e, quando algum passa do limite (90% por padrão),
 * manda UM aviso pelos canais já configurados (Telegram e/ou Whapi), repetindo no máximo a cada 24 horas por disco.
 * Só roda na instância própria (a do dono do servidor): as dos escritórios não avisam sobre o disco da máquina.
 */
export interface EspacoDoDisco { caminho: string; totalGb: number; livreGb: number; usoPct: number }

const GB = 1024 ** 3;
const REPETIR_APOS_MS = 24 * 3_600_000;

/** Mesma conta do `df` (arredondando para cima): usado / (usado + disponível para usuários). */
export function lerEspaco(caminho: string, statfs: typeof fs.statfsSync = fs.statfsSync): EspacoDoDisco | null {
  try {
    const s = statfs(caminho);
    const usado = (Number(s.blocks) - Number(s.bfree)) * Number(s.bsize);
    const disponivel = Number(s.bavail) * Number(s.bsize);
    if (usado + disponivel <= 0) return null;
    return { caminho, totalGb: Math.round(((usado + disponivel) / GB) * 10) / 10, livreGb: Math.round((disponivel / GB) * 10) / 10, usoPct: Math.ceil((usado / (usado + disponivel)) * 100) };
  } catch { return null; }
}

export const limiteDeUso = (env: NodeJS.ProcessEnv = process.env) => { const n = Number(env.ALERTA_DISCO_PERCENTUAL); return Number.isFinite(n) && n >= 50 && n <= 99 ? n : 90; };
export const caminhosMonitorados = (env: NodeJS.ProcessEnv = process.env) => (env.ALERTA_DISCO_CAMINHOS || "/,/arquivos").split(",").map((c) => c.trim()).filter(Boolean);

export function mensagemDeDisco(e: EspacoDoDisco): string {
  return `⚠️ Pouco espaço em disco no servidor\n\nO disco ${e.caminho} está com ${e.usoPct}% de uso: sobram ${e.livreGb} GB de ${e.totalGb} GB.\n\nLibere espaço (mova arquivos antigos para um HD externo ou aumente o disco) antes que ele encha e o sistema pare de gravar.`;
}

export interface DepsDisco {
  agora?: () => number; ler?: (c: string) => EspacoDoDisco | null; canais?: () => CanalNotificacao[];
  estado?: { obter: (k: string) => string | null; gravar: (k: string, v: string) => void }; env?: NodeJS.ProcessEnv;
}

/** Devolve os discos acima do limite que foram avisados nesta rodada. */
export async function verificarEspacoEmDisco(deps: DepsDisco = {}): Promise<EspacoDoDisco[]> {
  const agora = deps.agora ?? Date.now, ler = deps.ler ?? ((c) => lerEspaco(c));
  const estado = deps.estado ?? { obter: getSetting, gravar: setSetting };
  const limite = limiteDeUso(deps.env);
  const avisados: EspacoDoDisco[] = [];
  for (const caminho of caminhosMonitorados(deps.env)) {
    const e = ler(caminho);
    if (!e) continue;
    const chave = `alerta_disco_${caminho.replace(/[^a-z0-9]+/gi, "_")}`;
    if (e.usoPct < limite - 3) { if (estado.obter(chave)) estado.gravar(chave, ""); continue; } // folga: o próximo cruzamento avisa de novo
    if (e.usoPct < limite) continue;
    const ultimo = Number(estado.obter(chave));
    if (ultimo && agora() - ultimo < REPETIR_APOS_MS) continue;
    const canais = (deps.canais ?? canaisConfigurados)();
    const resultados = await Promise.all(canais.map((c) => enviarPeloCanal(c, mensagemDeDisco(e))));
    recordSystemLog({
      nivel: "aviso", categoria: "sistema", evento: "alerta_disco", titulo: `Pouco espaço em disco: ${e.caminho} com ${e.usoPct}%`,
      mensagem: canais.length ? `Aviso enviado (${resultados.map((r) => `${r.canal}: ${r.sucesso ? "ok" : "falhou"}`).join(", ")}).` : "Nenhum canal de aviso (Telegram/Whapi) está configurado: o aviso só aparece aqui.",
      origem: "automatico", detalhes: { ...e, limite, canais: resultados },
    });
    if (resultados.length === 0 || resultados.some((r) => r.sucesso)) { estado.gravar(chave, String(agora())); avisados.push(e); }
  }
  return avisados;
}
