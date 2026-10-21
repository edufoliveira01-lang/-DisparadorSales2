import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  clients: [] as unknown[],
  qr: vi.fn(),
  telegram: vi.fn(),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.qr } }));
vi.mock("../src/services/telegramService", () => ({
  enviarMensagemTelegram: mocks.telegram,
}));
vi.mock("whatsapp-web.js", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    LocalAuth: class {},
    Client: class extends EventEmitter {
      pupPage = { url: () => "https://web.whatsapp.com/" };
      pupBrowser = { process: () => ({ kill: vi.fn() }) };
      initialize = vi.fn(async () => {});
      destroy = vi.fn(async () => {});
      logout = vi.fn(async () => {});
      getState = vi.fn(async () => "UNPAIRED");
      getWWebVersion = vi.fn(async () => "versao-teste");
      constructor() {
        super();
        mocks.clients.push(this);
      }
    },
  };
});
import { whatsappManager } from "../src/services/whatsappService";
interface FakeClient extends EventEmitter {
  getState: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
}
const manager = whatsappManager as unknown as {
  client: FakeClient | null;
  geracao: number;
  tentativa: number;
  iniciarTentativa: (g: number) => Promise<void>;
  iniciarTentativaSegura: (g: number) => void;
  reconciliarPendentesAoReconectar: () => Promise<void>;
};
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let client: FakeClient;
beforeEach(async () => {
  vi.useFakeTimers();
  mocks.clients.length = 0;
  mocks.qr.mockReset().mockResolvedValue("data:image/png;base64,teste");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify([{ name: "2.3000.1234567890.html" }]), {
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
  vi.spyOn(manager, "reconciliarPendentesAoReconectar").mockResolvedValue();
  manager.geracao++;
  manager.tentativa = 0;
  await manager.iniciarTentativa(manager.geracao);
  client = mocks.clients[0] as FakeClient;
  await vi.advanceTimersByTimeAsync(1);
});
afterEach(async () => {
  await whatsappManager.stop();
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("pareamento por QR e sincronização do WhatsApp", () => {
  it("retira o QR quando o socket confirma o vínculo antes de authenticated", async () => {
    client.emit("qr", "primeiro");
    await vi.advanceTimersByTimeAsync(1);
    expect(whatsappManager.getState().status).toBe("aguardando_qr");
    client.getState.mockResolvedValue("CONNECTED");
    await vi.advanceTimersByTimeAsync(2000);
    expect(whatsappManager.getState()).toMatchObject({
      status: "autenticado",
      qrDataUrl: null,
    });
    expect(whatsappManager.isReady()).toBe(false);
    client.emit("ready");
    expect(whatsappManager.isReady()).toBe(true);
  });
  it("não troca um QR por sucesso só porque houve progresso ou PAIRING", async () => {
    client.getState.mockResolvedValue("PAIRING");
    client.emit("qr", "primeiro");
    await vi.advanceTimersByTimeAsync(1);
    client.emit("loading_screen", 100);
    await vi.advanceTimersByTimeAsync(2001);
    expect(whatsappManager.getState().status).toBe("pareando");
    expect(whatsappManager.isReady()).toBe(false);
  });
  it("a validação do vínculo também tem limite e preserva a sessão", async () => {
    client.getState.mockResolvedValue("PAIRING");
    client.emit("qr", "primeiro");
    await vi.advanceTimersByTimeAsync(2001);
    expect(whatsappManager.getState()).toMatchObject({
      status: "pareando",
      qrDataUrl: null,
    });
    manager.tentativa = 6;
    await vi.advanceTimersByTimeAsync(180001);
    expect(whatsappManager.getState().status).toBe("falha");
    expect(whatsappManager.getState().lastError).toMatch(
      /validação do vínculo/,
    );
    expect(client.logout).not.toHaveBeenCalled();
  });
  it.each(["authenticated", "ready"])(
    "uma imagem atrasada não desfaz o evento %s",
    async (evento) => {
      const qr = deferred<string>();
      mocks.qr.mockReturnValue(qr.promise);
      client.emit("qr", "primeiro");
      client.emit(evento);
      qr.resolve("QR atrasado");
      await vi.advanceTimersByTimeAsync(1);
      expect(whatsappManager.getState().status).toBe(
        evento === "ready" ? "conectado" : "autenticado",
      );
      expect(whatsappManager.getState().qrDataUrl).toBeNull();
    },
  );
  it("a detecção pelo socket também invalida a imagem em preparação", async () => {
    const qr = deferred<string>();
    mocks.qr.mockReturnValue(qr.promise);
    client.emit("qr", "primeiro");
    client.getState.mockResolvedValue("CONNECTED");
    await vi.advanceTimersByTimeAsync(2000);
    qr.resolve("QR atrasado");
    await vi.advanceTimersByTimeAsync(1);
    expect(whatsappManager.getState()).toMatchObject({
      status: "autenticado",
      qrDataUrl: null,
    });
  });
  it("o QR mais antigo não sobrescreve o QR renovado", async () => {
    const antigo = deferred<string>();
    mocks.qr
      .mockReturnValueOnce(antigo.promise)
      .mockResolvedValueOnce("QR novo");
    client.emit("qr", "primeiro");
    client.emit("qr", "segundo");
    await vi.advanceTimersByTimeAsync(1);
    antigo.resolve("QR antigo");
    await vi.advanceTimersByTimeAsync(1);
    expect(whatsappManager.getState().qrDataUrl).toBe("QR novo");
  });
  it("eventos repetidos de autenticação não reiniciam o limite nem regridem a conexão pronta", async () => {
    client.emit("authenticated");
    await vi.advanceTimersByTimeAsync(170000);
    client.emit("authenticated");
    manager.tentativa = 6;
    await vi.advanceTimersByTimeAsync(10001);
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(client.logout).not.toHaveBeenCalled();
    expect(whatsappManager.getState().status).toBe("falha");
    expect(whatsappManager.getState().lastError).toMatch(/3 minutos/);
  });
  it("ready não volta a autenticar nem perde o progresso com eventos atrasados", async () => {
    client.emit("ready");
    client.emit("authenticated");
    client.emit("loading_screen", 20);
    client.emit("qr", "atrasado");
    await vi.advanceTimersByTimeAsync(200001);
    expect(whatsappManager.getState()).toMatchObject({
      status: "conectado",
      qrDataUrl: null,
      syncProgress: 100,
    });
    expect(client.destroy).not.toHaveBeenCalled();
    expect(manager.reconciliarPendentesAoReconectar).toHaveBeenCalledOnce();
  });
  it("reconcilia mensagens novamente quando a biblioteca conclui uma reconexão do mesmo Client", async () => {
    client.emit("ready");
    client.emit("authenticated");
    client.emit("ready");
    expect(whatsappManager.getState().status).toBe("conectado");
    expect(manager.reconciliarPendentesAoReconectar).toHaveBeenCalledTimes(2);
  });
  it("retoma automaticamente a sincronização travada, preservando o profile", async () => {
    const iniciar = vi
      .spyOn(manager, "iniciarTentativaSegura")
      .mockImplementation(() => {});
    client.getState.mockResolvedValue("CONNECTED");
    await vi.advanceTimersByTimeAsync(2001);
    await vi.advanceTimersByTimeAsync(180001);
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(client.logout).not.toHaveBeenCalled();
    expect(whatsappManager.getState().status).toBe("inicializando");
    expect(whatsappManager.getState().lastError).toMatch(/sessão preservada/);
    await vi.advanceTimersByTimeAsync(5001);
    expect(iniciar).toHaveBeenCalledOnce();
  });
  it("Parar cancela o monitor, o watchdog e uma confirmação antiga em andamento", async () => {
    const estado = deferred<string>();
    client.getState.mockReturnValue(estado.promise);
    await vi.advanceTimersByTimeAsync(2000);
    await whatsappManager.stop();
    estado.resolve("CONNECTED");
    client.emit("authenticated");
    client.emit("ready");
    await vi.advanceTimersByTimeAsync(200001);
    expect(whatsappManager.getState()).toMatchObject({
      status: "desconectado",
      qrDataUrl: null,
    });
    expect(client.destroy).toHaveBeenCalledOnce();
  });
  it("não acumula sondagens quando o Chromium trava e encerra após falhas repetidas", async () => {
    client.emit("qr", "primeiro");
    await vi.advanceTimersByTimeAsync(1);
    manager.tentativa = 6;
    client.getState.mockClear().mockReturnValue(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(31000);
    expect(client.getState.mock.calls.length).toBe(3);
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(whatsappManager.getState().status).toBe("falha");
    expect(client.logout).not.toHaveBeenCalled();
  });
  it("duas falhas de navegação não encerram o pareamento que depois responde", async () => {
    client.emit("qr", "primeiro");
    await vi.advanceTimersByTimeAsync(1);
    client.getState
      .mockRejectedValueOnce(new Error("Execution context was destroyed"))
      .mockRejectedValueOnce(new Error("Frame navigated"))
      .mockResolvedValue("CONNECTED");
    await vi.advanceTimersByTimeAsync(6001);
    expect(whatsappManager.getState().status).toBe("autenticado");
    expect(client.destroy).not.toHaveBeenCalled();
  });
});
