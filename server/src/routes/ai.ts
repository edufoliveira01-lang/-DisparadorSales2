import { Router, type RequestHandler, type Request, type Response } from "express";
import { db } from "../db";
import { AiInputError, aiConfiguration, isProvider, publicAiConfiguration, removeAiCredential, requireModel, saveAiConfiguration } from "../services/ai/config";
import { AiProviderError, listAiModels, testAiApi } from "../services/ai/apiProvider";
import { cancelChatgptLogin, chatgptLoginBusy, chatgptLoginStatus, disconnectChatgpt, listChatgptModels, startChatgptLogin } from "../services/ai/chatgptAuth";
import { executarAnaliseEstruturada, verificarConexaoCodex } from "../services/djen/codexRunner";
import { statusAnalisesCodex } from "../services/djen/codexAnalysis";
import { auditAccess } from "../services/accessService";
import { emitEvent } from "../websocket";
import { SettingDecryptionError } from "../services/settingsService";

export const aiRouter = Router();
aiRouter.use((req, res, next) => {
  const origin = req.get("origin");
  if (!origin) return next();
  const host = req.get("host");
  const allowed = new Set([`${req.protocol}://${host}`]);
  // O Nginx termina o HTTPS e encaminha HTTP para o Express. O Host continua
  // sendo o do painel; aceite seu HTTPS sem confiar em headers de proxy arbitrários.
  if (host && req.protocol === "http") allowed.add(`https://${host}`);
  try { if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin); } catch { /* Uma URL inválida não libera outra origem. */ }
  if (!allowed.has(origin)) return res.status(403).json({ error: "Origem não autorizada para gerenciar a IA." });
  next();
});
const wrap = (fn: (req: Request, res: Response) => unknown): RequestHandler => async (req, res, next) => {
  try { await fn(req, res); }
  catch (error) {
    if (error instanceof AiInputError) res.status(400).json({ error: error.message });
    else if (error instanceof AiProviderError) res.status(error.status).json({ error: error.message });
    else if (error instanceof SettingDecryptionError) res.status(400).json({ error: "A credencial da IA não pode ser lida com a chave desta instalação. Cadastre-a novamente." });
    else { res.status(502).json({ error: "Não foi possível concluir a operação da IA. Confira a conexão e tente novamente." }); }
  }
};
const assertIdle: RequestHandler = (_req, res, next) => {
  if (statusAnalisesCodex().execucoes_simultaneas || chatgptLoginBusy()) return res.status(409).json({ error: "Aguarde as análises ou a autorização em andamento antes de alterar a conexão da IA." });
  next();
};
const changed = () => emitEvent("djen:changed", {});
aiRouter.get("/config", wrap((_req, res) => { res.json(publicAiConfiguration()); }));
aiRouter.put("/config", assertIdle, wrap((req, res) => {
  const config = saveAiConfiguration(req.body || {});
  auditAccess("ia_configurada", req.accessUser!.id, null, { provedor: config.provider, modelos: config.models[config.provider], revisao: config.revision });
  changed(); res.json(config);
}));
aiRouter.delete("/credentials/:provider", assertIdle, wrap((req, res) => {
  const provider = req.params.provider;
  if (provider !== "openai" && provider !== "anthropic") throw new AiInputError("Provedor por API inválido.");
  const result = removeAiCredential(provider); auditAccess("ia_credencial_removida", req.accessUser!.id, null, { provedor: provider }); changed(); res.json(result);
}));
aiRouter.post("/models", wrap(async (req, res) => {
  const provider = req.body?.provider;
  if (!isProvider(provider)) throw new AiInputError("Selecione um provedor válido.");
  const models = provider === "codex" ? await listChatgptModels() : await listAiModels(provider, req.body?.api_key);
  res.json({ models, message: "O catálogo não garante acesso nem suporte à análise estruturada. Teste o modelo selecionado." });
}));
aiRouter.post("/test", wrap(async (req, res) => {
  const provider = req.body?.provider;
  if (!isProvider(provider)) throw new AiInputError("Selecione um provedor válido.");
  const model = requireModel(req.body?.model);
  if (provider !== "codex") { res.json(await testAiApi(provider, model, req.body?.api_key)); return; }
  if (chatgptLoginBusy()) throw new AiInputError("Conclua a autorização antes de testar o modelo.");
  const result = await executarAnaliseEstruturada("Teste de conexão. Retorne ok igual a true.", { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, { modo: "precisao", modelo: model, esforco: "low", provedor: "codex" }, 1, 0);
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) throw new AiInputError("O modelo não concluiu o teste estruturado.");
  res.json({ conectado: true, mensagem: "Conta e modelo verificados com uma pequena requisição de teste." });
}));
aiRouter.get("/chatgpt/status", wrap(async (req, res) => { res.json({ connection: await verificarConexaoCodex(), login: chatgptLoginStatus(req.accessUser!.id) }); }));
aiRouter.post("/chatgpt/login", assertIdle, wrap(async (req, res) => { res.json(await startChatgptLogin(req.accessUser!.id, req.cookies.session_id)); }));
aiRouter.post("/chatgpt/cancel", wrap(async (req, res) => { res.json(await cancelChatgptLogin(req.accessUser!.id, req.body?.id)); }));
aiRouter.post("/chatgpt/logout", assertIdle, wrap(async (_req, res) => {
  if (aiConfiguration().provider === "codex") db.prepare("UPDATE djen_config SET ia_pausa=? WHERE id=1").run("Conta ChatGPT desconectada. Conecte novamente ou selecione um provedor por API antes de retomar a fila.");
  await disconnectChatgpt(); changed(); res.json({ ok: true });
}));

