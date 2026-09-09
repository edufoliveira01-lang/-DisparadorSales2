import { afterEach, describe, expect, it } from "vitest";
import { deleteSetting, getSetting, setSetting } from "../src/services/settingsService";

const TEST_KEY = "google_refresh_token";
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

afterEach(() => {
  deleteSetting(TEST_KEY);
  if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEncryptionKey;
});

describe("configurações criptografadas", () => {
  it("migra automaticamente um token legado quando ENCRYPTION_KEY passa a ser configurada", () => {
    delete process.env.ENCRYPTION_KEY;
    setSetting(TEST_KEY, "token-legado-de-teste");

    process.env.ENCRYPTION_KEY = "chave-segura-de-teste-com-mais-de-32-caracteres";
    expect(getSetting(TEST_KEY)).toBe("token-legado-de-teste");

    // A segunda leitura já usa o valor regravado com a nova chave.
    expect(getSetting(TEST_KEY)).toBe("token-legado-de-teste");
  });
});
