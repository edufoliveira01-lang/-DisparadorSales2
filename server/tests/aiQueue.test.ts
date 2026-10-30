import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { saveAiConfiguration } from "../src/services/ai/config";
import { iniciarMonitorCodex, pararMonitorCodex, processarFilaCodex } from "../src/services/djen/codexAnalysis";
import { revisarPublicacao } from "../src/services/djen/store";

const text = "O laudo pericial foi juntado aos autos.";
const analysis = { situacao: "Laudo juntado", categorias: ["laudo_juntado"], resultado: "nao_identificado", resumo: "O laudo pericial foi juntado.", justificativa: "A publicação comprova a juntada.", evidencias: [{ categoria: "laudo_juntado", trecho: text }], agendamento: { data: null, horario: null, local: null }, providencia: { tipo: "ciencia", descricao: "Conferir o laudo.", prazo_texto: null, responsavel: "escritorio" }, alertas: [] };
let serial = 0;
const models = (model: string) => ({ economico: model, equilibrado: model, precisao: model });
function publication() {
  const process = `ai-queue-${++serial}`;
  db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(process, process);
  return Number(db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,ia_status)
    VALUES (?,?,?,?,?,?,?,?,?,'pendente')`).run(process, process, "TRF3", "Vara", "Procedimento", "Intimação", "Intimação", "2026-10-01", text).lastInsertRowid);
}
function response(provider: "openai" | "anthropic") {
  return new Response(JSON.stringify(provider === "openai" ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysis) }] }] } : { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(analysis) }] }), { headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
  db.exec("DELETE FROM djen_publicacao_advogados;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;DELETE FROM djen_analise_cache;DELETE FROM djen_codex_execucoes;DELETE FROM settings WHERE chave LIKE 'ai_%';UPDATE djen_config SET ia_ativa=0,ia_modo='precisao',ia_pausa=NULL;");
  vi.stubEnv("ENCRYPTION_KEY", "test-only-very-long-encryption-key-for-ai");
  iniciarMonitorCodex();
});
afterEach(() => { pararMonitorCodex(); db.prepare("DELETE FROM settings WHERE chave LIKE 'ai_%'").run(); db.prepare("UPDATE djen_config SET ia_ativa=0,ia_pausa=NULL WHERE id=1").run(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("fila de análise usando o provedor selecionado", () => {
  it("grava provedor/modelo, reaproveita cache da mesma origem e não reutiliza ao trocar de provedor", async () => {
    saveAiConfiguration({ provider: "openai", models: models("shared-model"), api_key: "openai-test-secret" });
    const fetcher = vi.fn(async (url: string) => response(url.includes("anthropic") ? "anthropic" : "openai")); vi.stubGlobal("fetch", fetcher);
    const id = publication(); db.prepare("UPDATE djen_config SET ia_ativa=1 WHERE id=1").run();
    await processarFilaCodex();
    expect(db.prepare("SELECT ia_status,ia_provedor,ia_modelo FROM djen_publicacoes WHERE id=?").get(id)).toEqual({ ia_status: "concluida", ia_provedor: "openai", ia_modelo: "shared-model" });
    db.prepare("UPDATE djen_publicacoes SET ia_status='pendente' WHERE id=?").run(id); await processarFilaCodex();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(db.prepare("SELECT provedor,modelo FROM djen_codex_execucoes WHERE status='cache'").get()).toEqual({ provedor: "openai", modelo: "shared-model" });
    saveAiConfiguration({ provider: "anthropic", models: models("shared-model"), api_key: "anthropic-test-secret" });
    db.prepare("UPDATE djen_publicacoes SET ia_status='pendente' WHERE id=?").run(id); await processarFilaCodex();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(db.prepare("SELECT ia_provedor FROM djen_publicacoes WHERE id=?").get(id)).toEqual({ ia_provedor: "anthropic" });
  });
  it("preserva a revisão feita enquanto uma resposta da API está em andamento", async () => {
    saveAiConfiguration({ provider: "anthropic", models: models("test-model"), api_key: "test-secret" });
    let resolve!: (r: Response) => void;
    const waiting = new Promise<Response>((done) => { resolve = done; });
    vi.stubGlobal("fetch", vi.fn(() => waiting));
    const id = publication(); db.prepare("UPDATE djen_config SET ia_ativa=1 WHERE id=1").run();
    const run = processarFilaCodex();
    revisarPublicacao(id, { categorias: [], resultado: "nao_identificado" });
    resolve(response("anthropic")); await run;
    expect(db.prepare("SELECT revisada,categorias_json,ia_provedor,ia_status FROM djen_publicacoes WHERE id=?").get(id)).toEqual({ revisada: 1, categorias_json: "[]", ia_provedor: "anthropic", ia_status: "concluida" });
  });
  it("pausa em erro de autenticação sem trocar de provedor ou expor a resposta do serviço", async () => {
    saveAiConfiguration({ provider: "openai", models: models("test-model"), api_key: "test-secret" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response('PRIVATE KEY IN ERROR', { status: 401 })));
    const id = publication(); db.prepare("UPDATE djen_config SET ia_ativa=1 WHERE id=1").run(); await processarFilaCodex();
    const state = db.prepare("SELECT ia_status,ia_erro FROM djen_publicacoes WHERE id=?").get(id) as { ia_status: string; ia_erro: string };
    expect(state.ia_status).toBe("erro"); expect(state.ia_erro).not.toContain("PRIVATE");
    expect((db.prepare("SELECT ia_pausa FROM djen_config WHERE id=1").get() as { ia_pausa: string }).ia_pausa).toContain("Credencial recusada");
    expect(db.prepare("SELECT provedor,status FROM djen_codex_execucoes ORDER BY id DESC LIMIT 1").get()).toEqual({ provedor: "openai", status: "falha" });
  });
});
