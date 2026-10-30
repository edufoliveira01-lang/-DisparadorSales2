import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { getAllSettings } from "../src/services/settingsService";
import { aiConfiguration, aiProfile, profileIdentity, publicAiConfiguration, removeAiCredential, saveAiConfiguration } from "../src/services/ai/config";
import { executeApiStructured, listAiModels, testAiApi } from "../src/services/ai/apiProvider";

const key = "private-test-key-never-return-this";
const models = (name = "test-model") => ({ economico: name, equilibrado: name, precisao: name });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  db.prepare("DELETE FROM settings WHERE chave LIKE 'ai_%'").run();
  vi.stubEnv("ENCRYPTION_KEY", "encryption-key-for-tests-at-least-32-characters");
});
afterEach(() => { db.prepare("DELETE FROM settings WHERE chave LIKE 'ai_%'").run(); db.prepare("UPDATE djen_config SET ia_pausa=NULL WHERE id=1").run(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("configuração e proteção das credenciais de IA", () => {
  it("mantém a conexão existente e os modelos anteriores sem exigir migração de credenciais", () => {
    expect(aiConfiguration()).toMatchObject({ provider: "codex", revision: 0 });
    expect(aiProfile("economico").modelo).toBe("gpt-6-luna");
    expect(aiProfile("precisao").modelo).toBe("gpt-6.1-sol");
  });
  it("criptografa as chaves e nunca as inclui nos dois endpoints de configuração", () => {
    saveAiConfiguration({ provider: "anthropic", models: models(), api_key: key });
    const row = db.prepare("SELECT valor FROM settings WHERE chave='ai_anthropic_api_key'").get() as { valor: string };
    expect(row.valor).not.toContain(key);
    expect(JSON.stringify(publicAiConfiguration())).not.toContain(key);
    expect(getAllSettings().ai_anthropic_api_key).toBe("");
    expect(publicAiConfiguration().credentials.anthropic).toBe(true);
    expect(JSON.stringify(getAllSettings())).not.toContain(key);
  });
  it("preserva a chave ao editar modelos e guarda credenciais independentes por provedor", () => {
    saveAiConfiguration({ provider: "openai", models: models(), api_key: key });
    const first = aiProfile("economico");
    saveAiConfiguration({ provider: "openai", models: models("another-model") });
    expect(profileIdentity(first)).not.toBe(profileIdentity(aiProfile("economico")));
    saveAiConfiguration({ provider: "anthropic", models: models(), api_key: "anthropic-test-key" });
    expect(publicAiConfiguration().credentials).toEqual({ openai: true, anthropic: true });
    expect(profileIdentity({ ...first, provedor: "anthropic" })).not.toBe(profileIdentity(first));
  });
  it("recusa provedor, modelo, chave e criptografia inválidos sem salvar uma configuração parcial", () => {
    expect(() => saveAiConfiguration({ provider: "https://evil.invalid", models: models(), api_key: key })).toThrow();
    expect(() => saveAiConfiguration({ provider: "openai", models: models("bad\nmodel"), api_key: key })).toThrow();
    expect(() => saveAiConfiguration({ provider: "openai", models: models(), api_key: "bad\nkey" })).toThrow();
    vi.stubEnv("ENCRYPTION_KEY", "short");
    expect(() => saveAiConfiguration({ provider: "openai", models: models(), api_key: key })).toThrow(/ENCRYPTION_KEY/);
    expect(aiConfiguration().revision).toBe(0);
  });
  it("impede selecionar o login tradicional em modo hospedado", () => {
    vi.stubEnv("AI_DEPLOYMENT_MODE", "hosted");
    expect(() => saveAiConfiguration({ provider: "codex", models: models() })).toThrow(/hospedado/);
  });
  it("não invalida cache ao salvar a mesma configuração sem trocar a chave", () => {
    const first = saveAiConfiguration({ provider: "openai", models: models(), api_key: key });
    const unchanged = saveAiConfiguration({ provider: "openai", models: models() });
    expect(unchanged.revision).toBe(first.revision);
    const rotated = saveAiConfiguration({ provider: "openai", models: models(), api_key: "rotated-test-key" });
    expect(rotated.revision).toBe(first.revision + 1);
  });
  it("pausa a fila ao remover a credencial ativa e altera a identidade do cache", () => {
    saveAiConfiguration({ provider: "anthropic", models: models(), api_key: key });
    const old = profileIdentity(aiProfile("economico"));
    removeAiCredential("anthropic");
    expect(publicAiConfiguration().credentials.anthropic).toBe(false);
    expect(profileIdentity(aiProfile("economico"))).not.toBe(old);
    expect(db.prepare("SELECT ia_pausa FROM djen_config WHERE id=1").get()).toMatchObject({ ia_pausa: expect.stringContaining("Credencial") });
  });
});

describe("adaptadores estruturados dos provedores", () => {
  it("envia a análise à Responses API, sem armazenar a resposta no provedor", async () => {
    const fetcher = vi.fn(async () => json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await executeApiStructured("openai", "test-model", "test-prompt", { type: "object" }, undefined, key)).toEqual({ ok: true });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options.redirect).toBe("error"); expect(options.headers).toMatchObject({ Authorization: `Bearer ${key}` });
    expect(JSON.parse(String(options.body))).toMatchObject({ model: "test-model", store: false, input: "test-prompt", text: { format: { type: "json_schema", strict: true } } });
    expect(options.body).not.toContain(key);
  });
  it("usa Messages API e output_config da Anthropic, sem passar a credencial no prompt", async () => {
    const fetcher = vi.fn(async () => json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }] })); vi.stubGlobal("fetch", fetcher);
    expect(await testAiApi("anthropic", "claude-test", key)).toMatchObject({ conectado: true });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers).toMatchObject({ "x-api-key": key });
    expect(JSON.parse(String(options.body))).toMatchObject({ model: "claude-test", max_tokens: 512, output_config: { format: { type: "json_schema" } } });
    expect(options.body).not.toContain(key);
  });
  it("percorre o catálogo paginado da Anthropic com a chave somente no cabeçalho", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: [{ id: "model-a", display_name: "A" }], has_more: true, last_id: "model-a" }))
      .mockResolvedValueOnce(json({ data: [{ id: "model-b" }], has_more: false })); vi.stubGlobal("fetch", fetcher);
    expect((await listAiModels("anthropic", key)).map((m) => m.id)).toEqual(["model-a", "model-b"]);
    expect(fetcher.mock.calls[1][0]).toContain("after_id=model-a");
  });
  it.each([401, 403, 400, 404, 429, 500])("sanitiza erros HTTP %s sem expor retorno do provedor", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { message: `${key} PRIVATE-PUBLICATION` } }, status)));
    try { await testAiApi("openai", "test-model", key); throw new Error("missing failure"); }
    catch (error) { expect((error as Error).message).not.toMatch(/private-test-key|PRIVATE-PUBLICATION|missing failure/); }
  });
  it.each([
    { status: "incomplete", output: [] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "```json\n{}\n```" }] }] },
  ])("recusa respostas incompletas, recusadas ou fora do JSON estruturado", async (result) => {
    vi.stubGlobal("fetch", vi.fn(async () => json(result)));
    await expect(executeApiStructured("openai", "test-model", "test", {}, undefined, key)).rejects.toThrow();
  });
  it("não aceita uma saída Anthropic cortada por limite de tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"ok":true}' }] })));
    await expect(testAiApi("anthropic", "test-model", key)).rejects.toThrow(/não foi concluída/);
  });
  it("não considera o catálogo ou uma resposta ok=false como teste de inferência aprovado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":false}' }] })));
    await expect(testAiApi("anthropic", "test-model", key)).rejects.toThrow(/teste estruturado/);
  });
  it("limita o tamanho da resposta e não expõe erros de rede que contenham segredos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(2_000_001))));
    await expect(testAiApi("openai", "test-model", key)).rejects.toThrow(/limite/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(key); }));
    await expect(testAiApi("openai", "test-model", key)).rejects.toThrow(/Não foi possível acessar/);
  });
});
