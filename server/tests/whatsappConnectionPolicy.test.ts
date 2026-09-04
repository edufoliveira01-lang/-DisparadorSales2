import { describe, expect, it } from "vitest";
import {
  atrasoRetryConexaoMs,
  deveInvalidarSessao,
  existeInstanciaConcorrenteAtiva,
  motivoImpedeRetryAutomatico,
} from "../src/services/whatsappConnectionPolicy";

describe("política de reconexão do WhatsApp", () => {
  it("não apaga a sessão durante oscilações do pareamento", () => {
    expect(deveInvalidarSessao("UNPAIRED_IDLE", false)).toBe(false);
    expect(deveInvalidarSessao("UNPAIRED", false)).toBe(false);
  });

  it("apaga a sessão em logout ou desvinculação depois de conectado", () => {
    expect(deveInvalidarSessao("LOGOUT", false)).toBe(true);
    expect(deveInvalidarSessao("UNPAIRED", true)).toBe(true);
  });

  it("não insiste automaticamente em bloqueios permanentes", () => {
    expect(motivoImpedeRetryAutomatico("TOS_BLOCK")).toBe(true);
    expect(motivoImpedeRetryAutomatico("PROXYBLOCK")).toBe(true);
    expect(motivoImpedeRetryAutomatico("CONFLICT")).toBe(true);
    expect(motivoImpedeRetryAutomatico("UNPAIRED_IDLE")).toBe(false);
  });

  it("bloqueia apenas outra instância ativa no mesmo servidor", () => {
    const ativo = (pid: number) => pid === 222;
    expect(existeInstanciaConcorrenteAtiva({ hostname: "servidor", pid: 222 }, "servidor", 111, ativo)).toBe(true);
    expect(existeInstanciaConcorrenteAtiva({ hostname: "servidor", pid: 333 }, "servidor", 111, ativo)).toBe(false);
    expect(existeInstanciaConcorrenteAtiva({ hostname: "outro", pid: 222 }, "servidor", 111, ativo)).toBe(false);
    expect(existeInstanciaConcorrenteAtiva({ hostname: "servidor", pid: 111 }, "servidor", 111, ativo)).toBe(false);
  });

  it("aumenta o intervalo entre tentativas e limita em um minuto", () => {
    expect([1, 2, 3, 4, 5, 6].map((tentativa) => atrasoRetryConexaoMs(tentativa))).toEqual([
      5000,
      10000,
      20000,
      40000,
      60000,
      60000,
    ]);
  });
});
