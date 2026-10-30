import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/services/whatsappService", () => ({ whatsappManager: { processarAckPendente: vi.fn() } }));
import { db } from "../src/db";
import { listAwaitingRepliesPage, resolvePendingReplyIfAwaiting } from "../src/services/pendingRepliesService";

const prefix = "test:pagination:";
afterEach(() => db.prepare("DELETE FROM pending_replies WHERE card_id LIKE ?").run(`${prefix}%`));

describe("recuperação de respostas sem limite da interface", () => {
  it("percorre mais de 200 esperas, mesmo com novas inserções e resolução entre páginas", () => {
    const insert = db.prepare("INSERT INTO pending_replies(card_id,telefone,telefone_digits,status) VALUES (?,?,?,?)");
    const ids: number[] = [];
    db.transaction(() => {
      for (let i = 0; i < 237; i++) ids.push(Number(insert.run(`${prefix}${i}`, "11999999999", String(i), "aguardando").lastInsertRowid));
      insert.run(`${prefix}done`, "11999999999", "999", "respondido");
    })();
    const seen: number[] = [];
    let cursor = 0;
    while (true) {
      const page = listAwaitingRepliesPage(cursor, 5);
      if (!page.length) break;
      for (const pending of page) {
        seen.push(pending.id);
        resolvePendingReplyIfAwaiting(pending.id, "mensagem", "recebi");
        cursor = pending.id;
      }
      if (seen.length === 5) ids.push(Number(insert.run(`${prefix}new`, "11999999999", "new", "aguardando").lastInsertRowid));
    }
    expect(seen.filter((id) => ids.includes(id))).toEqual(ids);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
