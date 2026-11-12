import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { publicUser } from "../src/services/accessService";
import { getUserById, updateUser } from "../src/services/authService";

describe("página inicial por pessoa", () => {
  afterAll(() => { db.prepare("DELETE FROM users WHERE username = 'pi_ana'").run(); });
  it("guarda no servidor, devolve no usuário público e limpa ao voltar ao padrão", () => {
    const id = Number(db.prepare("INSERT INTO users (username, role, password_hash) VALUES ('pi_ana','gestor','x')").run().lastInsertRowid);
    expect(publicUser(getUserById(id)!).home_page).toBe("");
    updateUser(id, { home_page: "/calendario" });
    expect(publicUser(getUserById(id)!).home_page).toBe("/calendario");
    updateUser(id, { home_page: null });
    expect(publicUser(getUserById(id)!).home_page).toBe("");
  });
});
