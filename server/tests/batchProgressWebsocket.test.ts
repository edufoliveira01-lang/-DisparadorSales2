import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "../../client/node_modules/socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { initWebsocket } from "../src/websocket";
import { finishBatch, listActiveBatches, startBatch, updateBatch, type BatchProgress } from "../src/services/batchProgressService";
import { db } from "../src/db";
import { createSession } from "../src/services/authService";

const clients: Socket[] = [];
let stop: undefined | (() => Promise<void>);
afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const lote of listActiveBatches()) finishBatch(lote.id);
  await stop?.();
  stop = undefined;
});

async function setup() {
  const http = createServer();
  const server = initWebsocket(http);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  stop = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

async function snapshot(url: string) {
  const account = db.prepare("SELECT id FROM users WHERE role = 'administrador' LIMIT 1").get() as { id: number };
  const session = createSession(account.id);
  const client = connect(url, { autoConnect: false, transports: ["websocket"], forceNew: true, extraHeaders: { Cookie: `session_id=${session}` } });
  clients.push(client);
  const state = new Promise<BatchProgress[]>((resolve) => client.once("batch:state", resolve));
  client.connect();
  return { client, state: await state };
}

describe("recuperação de lote via WebSocket", () => {
  it("entrega o progresso atual para uma nova conexão, como após atualizar a página", async () => {
    const url = await setup();
    const id = startBatch("mensagens", 4);
    updateBatch(id, { processados: 2, enviados: 1, falhas: 1 });
    const first = await snapshot(url);
    expect(first.state).toEqual(listActiveBatches());
    first.client.disconnect();
    updateBatch(id, { processados: 3, enviados: 2 });
    const reconnected = await snapshot(url);
    expect(reconnected.state[0]).toMatchObject({ processados: 3, enviados: 2, falhas: 1 });
  });
  it("recupera estado por solicitação e informa quando não há mais lote ativo", async () => {
    const url = await setup();
    const { client } = await snapshot(url);
    const id = startBatch("lembretes", 2);
    const requested = new Promise<BatchProgress[]>((resolve) => client.once("batch:state", resolve));
    client.emit("batch:request-state");
    expect((await requested)[0].tipo).toBe("lembretes");
    // Recebe o retrato vazio após o término, sem manter aviso preso na interface.
    const empty = new Promise<BatchProgress[]>((resolve) => {
      const listener = (lotes: BatchProgress[]) => {
        if (!lotes.length) { client.off("batch:state", listener); resolve(lotes); }
      };
      client.on("batch:state", listener);
    });
    finishBatch(id);
    expect(await empty).toEqual([]);
  });
});
