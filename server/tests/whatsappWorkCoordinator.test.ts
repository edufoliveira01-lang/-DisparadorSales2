import assert from "node:assert/strict";
import { it } from "vitest";
import { WhatsappWorkCoordinator } from "../src/services/whatsappWorkCoordinator";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

it("processa uma mensagem uma vez quando message e message_create chegam juntos", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  const wait = gate();
  let calls = 0;
  const work = async () => { calls++; await wait.promise; };
  const first = coordinator.run(client, "mensagem:chat:id", work, 5000);
  const second = coordinator.run(client, "mensagem:chat:id", work, 5000);
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  wait.release();
  await Promise.all([first, second]);
  await coordinator.run(client, "mensagem:chat:id", work, 5000);
  assert.equal(calls, 1);
});

it("permite nova tentativa após falha sem perder o evento", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  let attempts = 0;
  const work = async () => { if (++attempts === 1) throw new Error("rede"); };
  await assert.rejects(coordinator.run(client, "mensagem", work, 5000), /rede/);
  await coordinator.run(client, "mensagem", work, 5000);
  assert.equal(attempts, 2);
});

it("nao mistura eventos de conexoes diferentes", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  let calls = 0;
  await coordinator.run({}, "mesmo-id", async () => { calls++; }, 5000);
  await coordinator.run({}, "mesmo-id", async () => { calls++; }, 5000);
  assert.equal(calls, 2);
});

it("mantem mensagens distintas independentes", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  let calls = 0;
  await Promise.all(["a", "b"].map(key => coordinator.run(client, key, async () => { calls++; }, 5000)));
  assert.equal(calls, 2);
});

it("conferencia periodica compartilha a varredura de reconexao em andamento", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  const wait = gate();
  let scans = 0;
  const first = coordinator.run(client, "conferencia-respostas", async () => { scans++; await wait.promise; });
  const second = coordinator.run(client, "conferencia-respostas", async () => { scans++; });
  wait.release();
  await Promise.all([first, second]);
  assert.equal(scans, 1);
  await coordinator.run(client, "conferencia-respostas", async () => { scans++; });
  assert.equal(scans, 2);
});

it("captura excecoes sincronas e libera a chave para retry", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  await assert.rejects(coordinator.run(client, "id", () => { throw new Error("sincrono"); }), /sincrono/);
  await coordinator.run(client, "id", async () => {});
});

it("permite nova conferencia apos expirar a memoria curta", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  let calls = 0;
  await coordinator.run(client, "id", async () => { calls++; }, 1);
  await new Promise(resolve => setTimeout(resolve, 15));
  await coordinator.run(client, "id", async () => { calls++; }, 1);
  assert.equal(calls, 2);
});

it("limita a memoria de eventos concluidos a 500 entradas", async () => {
  const coordinator = new WhatsappWorkCoordinator();
  const client = {};
  let oldestCalls = 0;
  await coordinator.run(client, "oldest", async () => { oldestCalls++; }, 60000);
  for (let i = 0; i < 500; i++) await coordinator.run(client, String(i), async () => {}, 60000);
  await coordinator.run(client, "oldest", async () => { oldestCalls++; }, 60000);
  assert.equal(oldestCalls, 2);
});
