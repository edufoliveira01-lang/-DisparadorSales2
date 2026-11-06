import { describe, expect, it, vi } from "vitest";

// O aviso usa os canais de notificação, que carregam o motor do WhatsApp; aqui ele não é necessário.
vi.mock("whatsapp-web.js", () => ({ default: {}, Client: class {}, LocalAuth: class {}, MessageMedia: class {} }));
import { lerEspaco, limiteDeUso, mensagemDeDisco, verificarEspacoEmDisco, type EspacoDoDisco } from "../src/services/espacoEmDisco";

const disco = (usoPct: number, caminho = "/arquivos"): EspacoDoDisco => ({ caminho, totalGb: 427, livreGb: 48, usoPct });
function montar(usoPct: number | (() => number), relogio = { t: 1_000_000 }) {
  const estado = new Map<string, string>();
  const enviados: string[] = [];
  const canal = { nome: "Telegram" as const, enviar: async (t: string) => { enviados.push(t); } };
  const deps = {
    agora: () => relogio.t, env: { ALERTA_DISCO_CAMINHOS: "/arquivos" } as NodeJS.ProcessEnv,
    ler: (c: string) => disco(typeof usoPct === "function" ? usoPct() : usoPct, c), canais: () => [canal],
    estado: { obter: (k: string) => estado.get(k) ?? null, gravar: (k: string, v: string) => void estado.set(k, v) },
  };
  return { deps, enviados, relogio };
}

describe("aviso de pouco espaço em disco", () => {
  it("calcula o uso como o df (usado / usado + disponível)", () => {
    const e = lerEspaco("/x", (() => ({ blocks: 1000, bfree: 150, bavail: 120, bsize: 1024 ** 3 / 1000 })) as never);
    expect(e).toMatchObject({ usoPct: Math.ceil((850 / (850 + 120)) * 100) });
    expect(lerEspaco("/nao-existe", () => { throw new Error("x"); })).toBeNull();
  });
  it("avisa uma vez quando passa do limite e não repete antes de 24 horas", async () => {
    const m = montar(91);
    expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(1);
    expect(m.enviados[0]).toContain("/arquivos está com 91%");
    expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(0);
    m.relogio.t += 23 * 3_600_000; expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(0);
    m.relogio.t += 2 * 3_600_000; expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(1);
    expect(m.enviados).toHaveLength(2);
  });
  it("abaixo do limite não avisa; ao voltar a folga e cruzar de novo, avisa na hora", async () => {
    let uso = 85;
    const m = montar(() => uso);
    expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(0);
    uso = 92; expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(1);
    uso = 80; await verificarEspacoEmDisco(m.deps); // folga: reinicia
    uso = 93; m.relogio.t += 60_000; expect(await verificarEspacoEmDisco(m.deps)).toHaveLength(1);
  });
  it("limite configurável e mensagem clara", () => {
    expect(limiteDeUso({ ALERTA_DISCO_PERCENTUAL: "85" } as never)).toBe(85);
    expect(limiteDeUso({ ALERTA_DISCO_PERCENTUAL: "abc" } as never)).toBe(90);
    expect(mensagemDeDisco(disco(91))).toContain("sobram 48 GB de 427 GB");
  });
});
