import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Banco isolado, com o mesmo esquema e as mesmas restrições da aplicação.
vi.mock("../src/db", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { runMigrations } = await import("../src/db/migrations");
  const database = new Database(":memory:");
  runMigrations(database);
  return { db: database };
});

import { db } from "../src/db";
import { contactsRouter } from "../src/routes/contacts";
import { createContact, deleteContact, deleteContacts, getContact } from "../src/services/contactsService";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/contacts", contactsRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  db.exec(`
    DROP TRIGGER IF EXISTS impedir_exclusao_teste;
    DELETE FROM pending_replies;
    DELETE FROM send_logs;
    DELETE FROM contacts;
  `);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  db.close();
});

function criarEnvio(contactId: number) {
  const info = db.prepare(`
    INSERT INTO send_logs
      (card_id, card_nome, contact_id, telefone, pericias_json, mensagem_enviada,
       status, whatsapp_message_id, ack, tipo_envio, remarcacoes_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("card-teste", "CLIENTE TESTE", contactId, "5513999990001",
    '[{"tipo":"Médica","data":"20/10/2026"}]', "Mensagem original", "sucesso",
    "mensagem-teste", 3, "disparo", '[{"dataAnterior":"19/10/2026"}]');
  return db.prepare("SELECT * FROM send_logs WHERE id = ?").get(info.lastInsertRowid) as Record<string, unknown>;
}

function criarPendencia(sendLogId: unknown) {
  const info = db.prepare(`
    INSERT INTO pending_replies
      (card_id, telefone, telefone_digits, send_log_id, whatsapp_message_id, status)
    VALUES ('card-teste', '5513999990001', '5513999990001', ?, 'mensagem-teste', 'aguardando')
  `).run(sendLogId);
  return db.prepare("SELECT * FROM pending_replies WHERE id = ?").get(info.lastInsertRowid);
}

function conferirIntegridade() {
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("foreign_key_check")).toEqual([]);
}

describe("exclusão de contatos preservando o histórico", () => {
  it("remove pela API um contato com vários envios sem perder dados ou pendências", async () => {
    const contato = createContact("CLIENTE TESTE", "13999990001");
    const envios = [criarEnvio(contato.id), criarEnvio(contato.id)];
    const pendencia = criarPendencia(envios[0].id);

    const response = await fetch(`${baseUrl}/contacts/${contato.id}`, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(getContact(contato.id)).toBeUndefined();
    expect(db.prepare("SELECT * FROM send_logs ORDER BY id").all()).toEqual(
      envios.map((envio) => ({ ...envio, contact_id: null }))
    );
    expect(db.prepare("SELECT * FROM pending_replies").all()).toEqual([pendencia]);
    conferirIntegridade();
  });

  it("continua removendo contatos sem histórico", () => {
    const contato = createContact("SEM HISTÓRICO", "13999990002");
    deleteContact(contato.id);
    expect(getContact(contato.id)).toBeUndefined();
    conferirIntegridade();
  });

  it("apaga em massa contatos com e sem histórico e preserva o contato não selecionado", async () => {
    const comHistorico = createContact("COM HISTÓRICO", "13999990001");
    const semHistorico = createContact("SEM HISTÓRICO", "13999990002");
    const manter = createContact("MANTER", "13999990003");
    const envio = criarEnvio(comHistorico.id);
    const envioMantido = criarEnvio(manter.id);
    const pendencia = criarPendencia(envio.id);

    const response = await fetch(`${baseUrl}/contacts/apagar-em-massa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [comHistorico.id, semHistorico.id, comHistorico.id, -1] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, apagados: 2 });
    expect(getContact(comHistorico.id)).toBeUndefined();
    expect(getContact(semHistorico.id)).toBeUndefined();
    expect(getContact(manter.id)).toEqual(manter);
    expect(db.prepare("SELECT * FROM send_logs ORDER BY id").all()).toEqual([
      { ...envio, contact_id: null }, envioMantido,
    ]);
    expect(db.prepare("SELECT * FROM pending_replies").all()).toEqual([pendencia]);
    conferirIntegridade();
  });

  it.each(["individual", "em massa"])("reverte a desvinculação e a exclusão %s se ocorrer falha", (modo) => {
    const primeiro = createContact("PRIMEIRO", "13999990001");
    const bloqueado = createContact("BLOQUEADO", "13999990002");
    const envios = [criarEnvio(primeiro.id), criarEnvio(bloqueado.id)];
    const pendencia = criarPendencia(envios[1].id);
    db.exec(`
      CREATE TRIGGER impedir_exclusao_teste BEFORE DELETE ON contacts
      WHEN OLD.id = ${bloqueado.id}
      BEGIN SELECT RAISE(ABORT, 'Falha simulada'); END;
    `);

    expect(() => modo === "individual"
      ? deleteContact(bloqueado.id)
      : deleteContacts([primeiro.id, bloqueado.id])).toThrow("Falha simulada");

    expect(getContact(primeiro.id)).toEqual(primeiro);
    expect(getContact(bloqueado.id)).toEqual(bloqueado);
    expect(db.prepare("SELECT * FROM send_logs ORDER BY id").all()).toEqual(envios);
    expect(db.prepare("SELECT * FROM pending_replies").all()).toEqual([pendencia]);
    conferirIntegridade();
  });

  it("ignora listas vazias e IDs inexistentes sem alterar outros registros", () => {
    const contato = createContact("MANTER", "13999990001");
    const envio = criarEnvio(contato.id);
    expect(deleteContacts([])).toBe(0);
    expect(deleteContacts([-1])).toBe(0);
    deleteContact(-1);
    expect(getContact(contato.id)).toEqual(contato);
    expect(db.prepare("SELECT * FROM send_logs").all()).toEqual([envio]);
    conferirIntegridade();
  });

  it("mantém o retorno 404 para um contato inexistente", async () => {
    const response = await fetch(`${baseUrl}/contacts/-1`, { method: "DELETE" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Contato não encontrado." });
  });
});
