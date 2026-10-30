import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateOfficeStorage } from "../src/db/officeStorage";

const roots: string[] = [];
const directory = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-storage-")); roots.push(dir); return dir; };
const config = (dir: string, id = "escritorio-a") => ({ OFFICE_ID: id, DATA_DIR: dir, ENCRYPTION_KEY: "chave-exclusiva-de-teste-com-32-caracteres", DJEN_CODEX_HOME: path.join(dir, "codex") });
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("preparação de armazenamento por escritório", () => {
  it("preserva a instalação legada quando não há OFFICE_ID", () => {
    const dir = directory();
    fs.writeFileSync(path.join(dir, "disparador.sqlite3"), "legado");
    validateOfficeStorage(dir, {});
    expect(fs.readdirSync(dir)).toEqual(["disparador.sqlite3"]);
    expect(() => validateOfficeStorage(dir, config(dir))).toThrow(/legados/);
  });
  it("recusa reutilizar o mesmo diretório para outro escritório ou remover sua identidade", () => {
    const dir = directory();
    validateOfficeStorage(dir, config(dir));
    validateOfficeStorage(dir, config(dir));
    expect(() => validateOfficeStorage(dir, config(dir, "escritorio-b"))).toThrow(/outro escritório/);
    expect(() => validateOfficeStorage(dir, {})).toThrow(/OFFICE_ID/);
    const other = directory();
    expect(() => validateOfficeStorage(other, config(other, "escritorio-b"))).not.toThrow();
  });
  it("exige chave e diretórios próprios, inclusive para links simbólicos", () => {
    const dir = directory();
    expect(() => validateOfficeStorage(dir, { ...config(dir), DATA_DIR: "relativo" })).toThrow(/absoluto/);
    expect(() => validateOfficeStorage(dir, { ...config(dir), ENCRYPTION_KEY: "curta" })).toThrow(/ENCRYPTION_KEY/);
    const outside = directory();
    fs.symlinkSync(outside, path.join(dir, "codex"), "dir");
    expect(() => validateOfficeStorage(dir, config(dir))).toThrow(/dentro/);
  });
});
