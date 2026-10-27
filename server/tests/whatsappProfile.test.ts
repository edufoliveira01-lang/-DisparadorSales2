import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backupWhatsappProfile } from "../src/services/whatsappProfile";
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "whatsapp-profile-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
function createProfile() {
  const profile = path.join(root, "wwebjs_auth", "session");
  fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
  fs.writeFileSync(path.join(profile, "Default", "fixture"), "saved-profile");
  fs.writeFileSync(path.join(root, "whatsapp-session-ready.json"), "saved-marker");
  fs.writeFileSync(path.join(root, "disparador.sqlite3"), "application-data");
  return profile;
}
describe("recuperação reversível do perfil do WhatsApp", () => {
  it("guarda perfil e marcador sem alterar os dados do sistema", () => {
    const profile = createProfile();
    const directory = backupWhatsappProfile(root, () => false)!;
    expect(fs.existsSync(profile)).toBe(false);
    expect(fs.readFileSync(path.join(directory, "session/Default/fixture"), "utf8")).toBe("saved-profile");
    expect(fs.readFileSync(path.join(directory, "session-ready.json"), "utf8")).toBe("saved-marker");
    expect(fs.readFileSync(path.join(root, "disparador.sqlite3"), "utf8")).toBe("application-data");
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
  });
  it("recusa mover um perfil que ainda está aberto", () => {
    const profile = createProfile();
    expect(() => backupWhatsappProfile(root, () => true)).toThrow(/navegador ainda está encerrando/);
    expect(fs.existsSync(profile)).toBe(true);
    expect(fs.existsSync(path.join(root, "whatsapp-session-ready.json"))).toBe(true);
  });
  it("não cria backups vazios se não existe sessão anterior", () => {
    expect(backupWhatsappProfile(root, () => false)).toBeNull();
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it("restaura o perfil se não conseguir mover o marcador", () => {
    const profile = createProfile();
    const rename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from).endsWith("whatsapp-session-ready.json")) throw new Error("cannot move marker");
      rename(from, to);
    });
    expect(() => backupWhatsappProfile(root, () => false)).toThrow("cannot move marker");
    expect(fs.readFileSync(path.join(profile, "Default/fixture"), "utf8")).toBe("saved-profile");
  });
});
