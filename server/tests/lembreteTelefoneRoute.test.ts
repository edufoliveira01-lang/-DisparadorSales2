import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const wa = vi.hoisted(() => ({ isReady: vi.fn(), resolveChatId: vi.fn(), sendMessage: vi.fn(), processarAckPendente: vi.fn() }));
vi.mock("../src/services/whatsappService", () => ({ whatsappManager: wa }));
vi.mock("../src/services/googleCalendarService", () => ({
  scheduleGoogleCalendarSync: vi.fn(), scheduleGoogleCalendarDelete: vi.fn(), transferGoogleCalendarLinks: vi.fn(),
}));
import { db } from "../src/db";
import { periciasAgendadasRouter } from "../src/routes/periciasAgendadas";
import { createPericiaAgendadaManual, deletePericiaAgendada, getPericiaAgendada } from "../src/services/periciasAgendadasService";
import { createContact, deleteContacts, getContact, listContacts } from "../src/services/contactsService";
import { enviarLembretesEmMassa } from "../src/services/lembreteService";

let server: Server;
let base: string;
let sequencia = 0;
const ids: number[] = [];
function evento(nome = `TESTE TELEFONE ${++sequencia}`, processo = "1234567-00.2030.8.26.0001", tipo = "Perícia médica", telefone = "") {
  const e = createPericiaAgendadaManual({ nome, tipo, processo, telefone, data: "20/12/2030", horario: "10:00", local: "Unidade de teste" });
  ids.push(e.id);
  return e;
}
async function post(path: string, body: unknown) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, body: data };
}
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use(periciasAgendadasRouter);
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  vi.clearAllMocks(); wa.isReady.mockReturnValue(true); wa.resolveChatId.mockResolvedValue("5511999998888@c.us"); wa.sendMessage.mockResolvedValue("MSG-TESTE");
});
afterEach(() => {
  db.prepare("DELETE FROM send_logs WHERE card_nome LIKE 'TESTE TELEFONE %'").run();
  while (ids.length) deletePericiaAgendada(ids.pop()!);
  deleteContacts(listContacts().filter(c => c.nome.startsWith("TESTE TELEFONE ")).map(c => c.id));
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

describe("telefone ausente nos lembretes", () => {
  it("pede o telefone com identificação do cliente sem criar falha de envio", async () => {
    const e = evento();
    const r = await post(`/${e.id}/lembrete`, {});
    expect(r).toMatchObject({ status: 409, body: { code: "TELEFONE_NAO_INFORMADO", pendencia: { ids: [e.id], nome: e.nome, processo: e.processo } } });
    expect(wa.sendMessage).not.toHaveBeenCalled();
    expect(db.prepare("SELECT id FROM send_logs WHERE card_nome = ?").all(e.nome)).toHaveLength(0);
  });
  it("salva o telefone, cadastra pelo nome e processo e permite continuar sem duplicar", async () => {
    const e = evento();
    expect((await post("/completar-telefone", { ids: [e.id], telefone: "(11) 99999-8888" })).status).toBe(200);
    expect(getPericiaAgendada(e.id)?.telefone_digits).toBe("5511999998888");
    expect(listContacts().find(c => c.nome === e.nome)).toMatchObject({ telefone: "5511999998888", processo: e.processo });
    expect((await post(`/${e.id}/lembrete`, {})).status).toBe(200);
    expect((await post(`/${e.id}/lembrete`, {})).status).toBe(409);
    expect(wa.sendMessage).toHaveBeenCalledOnce();
    expect(getPericiaAgendada(e.id)?.ultimo_lembrete_em).toBeTruthy();
  });
  it("valida todo o lote e não começa enviando para outros clientes antes de pedir o número", async () => {
    const sem = evento(); const com = evento(undefined, undefined, undefined, "11999998888");
    const r = await post("/validar-lembretes", { ids: [com.id, sem.id] });
    expect(r.body.telefonesPendentes).toEqual([{ ids: [sem.id], nome: sem.nome, processo: sem.processo }]);
    expect((await post("/lembrete-em-massa", { ids: [com.id, sem.id] })).body.code).toBe("TELEFONE_NAO_INFORMADO");
    await expect(enviarLembretesEmMassa([com.id, sem.id], 0, 0)).rejects.toThrow("Informe o telefone");
    expect(wa.sendMessage).not.toHaveBeenCalled();
  });
  it("não altera homônimos de outro processo nem aceita agrupar clientes distintos", async () => {
    const sem = evento(); const outro = evento(sem.nome, "9999999-00.2030.8.26.0002", "Perícia social");
    const contato = createContact(sem.nome, "11988887777", undefined, outro.processo!);
    expect((await post("/completar-telefone", { ids: [sem.id, outro.id], telefone: "11999998888" })).status).toBe(400);
    expect((await post("/completar-telefone", { ids: [sem.id], telefone: "11999998888" })).status).toBe(200);
    expect(getContact(contato.id)?.telefone).toBe("5511988887777");
    expect(getPericiaAgendada(outro.id)?.telefone_digits).toBe("");
  });
  it("agrupa dois tipos de compromisso do mesmo nome e processo ao pedir telefone", async () => {
    const a = evento(); const b = evento(a.nome, a.processo!, "Perícia social");
    const r = await post("/validar-lembretes", { ids: [a.id, b.id] });
    expect(r.body.telefonesPendentes).toHaveLength(1);
    expect(r.body.telefonesPendentes[0].ids).toEqual([a.id, b.id]);
    expect((await post("/completar-telefone", { ids: [a.id, b.id], telefone: "11999998888" })).status).toBe(200);
    expect(getPericiaAgendada(b.id)?.telefone_digits).toBe("5511999998888");
  });
  it("rejeita telefone incompleto e não sobrescreve um número já preenchido", async () => {
    const e = evento();
    expect((await post("/completar-telefone", { ids: [e.id], telefone: "123" })).status).toBe(400);
    expect(getPericiaAgendada(e.id)?.telefone_digits).toBe("");
    expect((await post("/completar-telefone", { ids: [e.id], telefone: "11999998888" })).status).toBe(200);
    expect((await post("/completar-telefone", { ids: [e.id], telefone: "11911112222" })).status).toBe(400);
    expect(getPericiaAgendada(e.id)?.telefone_digits).toBe("5511999998888");
  });
  it("reutiliza o telefone da Agenda quando nome e processo coincidem", async () => {
    const e = evento(); createContact(e.nome, "11999998888", undefined, e.processo!);
    const r = await post("/validar-lembretes", { ids: [e.id] });
    expect(r.body.telefonesPendentes).toEqual([]);
    expect(r.body.eventos[0].telefone_digits).toBe("5511999998888");
    expect((await post(`/${e.id}/lembrete`, {})).status).toBe(200);
  });
  it("mantém a solicitação de processo quando esse dado permite confirmar um contato existente", async () => {
    const e = evento(); const contato = createContact(e.nome, "11999998888");
    const r = await post(`/${e.id}/lembrete`, {});
    expect(r.body.code).toBe("PROCESSO_NAO_IDENTIFICADO");
    expect(r.body.pendencia.contato.id).toBe(contato.id);
    expect((await post("/completar-processo", { ids: [e.id], contactId: contato.id, processo: e.processo })).status).toBe(200);
    expect((await post(`/${e.id}/lembrete`, {})).status).toBe(200);
  });
  it("não compartilha telefone entre compromissos homônimos sem processo", async () => {
    const a = evento(undefined, ""); const b = evento(a.nome, "", "Perícia social");
    const r = await post("/validar-lembretes", { ids: [a.id, b.id] });
    expect(r.body.telefonesPendentes).toHaveLength(2);
    expect((await post("/completar-telefone", { ids: [a.id, b.id], telefone: "11999998888" })).status).toBe(400);
    expect((await post("/completar-telefone", { ids: [a.id], telefone: "11999998888" })).status).toBe(200);
    expect(getPericiaAgendada(b.id)?.telefone_digits).toBe("");
    expect(listContacts().filter(c => c.nome === a.nome)).toHaveLength(0);
  });
  it("preserva o registro anterior ao completar telefone para reenvio explicitamente confirmado", async () => {
    const e = evento();
    db.prepare("UPDATE pericias_agendadas SET ultimo_lembrete_em = ? WHERE id = ?").run("2030-12-19 10:00:00", e.id);
    expect((await post(`/${e.id}/lembrete`, { forcar: true })).body.code).toBe("TELEFONE_NAO_INFORMADO");
    expect((await post("/completar-telefone", { ids: [e.id], telefone: "11999998888" })).status).toBe(200);
    expect(getPericiaAgendada(e.id)?.ultimo_lembrete_em).toBe("2030-12-19 10:00:00");
    expect((await post(`/${e.id}/lembrete`, { forcar: true })).status).toBe(200);
    expect(wa.sendMessage).toHaveBeenCalledOnce();
  });

});
