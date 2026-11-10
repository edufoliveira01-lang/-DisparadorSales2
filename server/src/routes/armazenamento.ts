import { Router, type Request, type Response } from "express";
import { auditAccess } from "../services/accessService";
import {
  configPublica, consumirEstado, desconectar, lerConexao, lerCredenciais, novoEstado, salvarConexao, salvarCredenciais,
} from "../armazenamento/banco";
import { criarClienteDropbox, trocarCodigo, urlDeAutorizacao, type ClienteDropbox } from "../armazenamento/dropbox";
import {
  pendenciasDePasta, processarFila, reenviar, situacaoDaFila, sugestoesDeVinculo, vincularCriandoPasta, vincularPasta,
} from "../armazenamento/fila";
import { ErroArmazenamento, RAIZ_DOS_CLIENTES } from "../armazenamento/pastas";

/**
 * Armazenamento externo (Dropbox): conexão, vínculo cliente → pasta e fila de envio.
 * Montado em `/api/armazenamento` (e só o retorno do OAuth em `/api/dropbox/retorno`). Permissão: `integrations.manage` (ver `middleware/access.ts`), a mesma das demais integrações.
 * Nada secreto volta para a tela: só o final da App key e o nome da conta.
 */
export const armazenamentoRouter = Router();
export const dropboxRetornoRouter = Router();

/** O endereço de retorno do OAuth — o que o dono cadastra no app do Dropbox. Atrás de proxy, vale o protocolo repassado por ele. */
export function redirectUriDoDropbox(req: Request): string {
  if (process.env.DROPBOX_REDIRECT_URI) return process.env.DROPBOX_REDIRECT_URI;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0]!.trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}/api/dropbox/retorno`;
}

const paraConfiguracoes = (resultado: "connected" | "error", mensagem?: string) => {
  const p = new URLSearchParams({ secao: "dropbox", dropbox: resultado });
  if (mensagem) p.set("message", mensagem.slice(0, 300));
  return `/configuracoes?${p.toString()}`;
};

function erro(res: Response, e: unknown): void {
  if (e instanceof ErroArmazenamento) return void res.status(e.status >= 400 && e.status < 600 ? e.status : 502).json({ error: e.message });
  console.error("[armazenamento] erro inesperado:", e instanceof Error ? e.message : e);
  res.status(500).json({ error: "Não foi possível concluir. Tente novamente." });
}

function clienteConectado(): ClienteDropbox {
  const c = lerConexao();
  if (!c) throw new ErroArmazenamento("O Dropbox ainda não está conectado. Conecte em Configurações.", 409);
  return criarClienteDropbox(c);
}

armazenamentoRouter.get("/dropbox", (req, res) => {
  res.json({ ...configPublica(), fila: situacaoDaFila(), redirect_uri: redirectUriDoDropbox(req), pasta_raiz: RAIZ_DOS_CLIENTES });
});

armazenamentoRouter.put("/dropbox/credenciais", (req, res) => {
  try {
    const r = salvarCredenciais(req.body || {});
    auditAccess("armazenamento_credenciais", req.accessUser!.id, null, { provedor: "dropbox" });
    res.json(r);
  } catch (e) { erro(res, e); }
});

/** Começa a conexão: leva a pessoa à tela de autorização do Dropbox. */
armazenamentoRouter.get("/dropbox/conectar", (req, res) => {
  const cred = lerCredenciais();
  if (!cred) return void res.redirect(paraConfiguracoes("error", "Salve a App key e a App secret do Dropbox antes de conectar."));
  const state = novoEstado(req.accessUser?.id ?? null);
  res.redirect(urlDeAutorizacao({ appKey: cred.appKey, redirectUri: redirectUriDoDropbox(req), state }));
});

dropboxRetornoRouter.get("/retorno", async (req, res) => {
  try {
    if (req.query.error) throw new ErroArmazenamento("A autorização no Dropbox foi cancelada.");
    if (!consumirEstado(req.query.state, req.accessUser?.id ?? null)) throw new ErroArmazenamento("A solicitação de conexão expirou. Tente conectar de novo.");
    const cred = lerCredenciais();
    if (!cred) throw new ErroArmazenamento("Salve a App key e a App secret do Dropbox antes de conectar.");
    const code = String(req.query.code || "");
    if (!code) throw new ErroArmazenamento("O Dropbox não devolveu o código de autorização.");
    const t = await trocarCodigo({ ...cred, code, redirectUri: redirectUriDoDropbox(req) });
    const conta = await criarClienteDropbox({ ...cred, refreshToken: t.refreshToken }).conta();
    salvarConexao({ refreshToken: t.refreshToken, conta: { nome: conta.nome, email: conta.email, tipo: conta.tipo, raizDeNomes: conta.raizDeNomes } });
    auditAccess("armazenamento_conectado", req.accessUser!.id, null, { provedor: "dropbox", tipo_de_conta: conta.tipo, equipe: conta.ehEquipe });
    res.redirect(paraConfiguracoes("connected"));
  } catch (e) {
    res.redirect(paraConfiguracoes("error", e instanceof Error ? e.message : "Não foi possível conectar o Dropbox."));
  }
});

armazenamentoRouter.delete("/dropbox", (req, res) => {
  desconectar();
  auditAccess("armazenamento_desconectado", req.accessUser!.id, null, { provedor: "dropbox" });
  res.json(configPublica());
});

/** Confere a conexão de verdade (pergunta a conta ao Dropbox). */
armazenamentoRouter.post("/dropbox/testar", async (_req, res) => {
  try {
    const conta = await clienteConectado().conta();
    res.json({ ok: true, conta: { nome: conta.nome, email: conta.email, tipo: conta.tipo, equipe: conta.ehEquipe } });
  } catch (e) { erro(res, e); }
});

/** Documentos esperando a equipe escolher a pasta (nomes parecidos). */
armazenamentoRouter.get("/pendencias", (_req, res) => res.json({ pendencias: pendenciasDePasta() }));

/** As pastas que já existem em CLIENTES, para escolher uma. */
armazenamentoRouter.get("/pastas", async (_req, res) => {
  try { res.json({ pastas: await clienteConectado().listarPastas(RAIZ_DOS_CLIENTES) }); } catch (e) { erro(res, e); }
});

/** O legado, uma vez só: o que o nome de cada cliente sem vínculo casa nas pastas existentes. Não grava nada. */
armazenamentoRouter.get("/sugestoes", async (_req, res) => {
  try { res.json(await sugestoesDeVinculo(clienteConectado())); } catch (e) { erro(res, e); }
});

armazenamentoRouter.post("/vincular", async (req, res) => {
  try {
    const pessoaId = Number(req.body?.pessoa_id);
    if (!Number.isInteger(pessoaId) || pessoaId <= 0) throw new ErroArmazenamento("Cliente inválido.");
    const r = await vincularPasta(pessoaId, String(req.body?.pasta_id ?? ""), clienteConectado());
    auditAccess("armazenamento_pasta_vinculada", req.accessUser!.id, null, { pessoa_id: pessoaId, origem: "manual" });
    void processarFila().catch(() => undefined);
    res.json(r);
  } catch (e) { erro(res, e); }
});

/** "Nenhuma destas": cria a pasta nova com o nome do cadastro. */
armazenamentoRouter.post("/vincular-nova", async (req, res) => {
  try {
    const pessoaId = Number(req.body?.pessoa_id);
    if (!Number.isInteger(pessoaId) || pessoaId <= 0) throw new ErroArmazenamento("Cliente inválido.");
    const r = await vincularCriandoPasta(pessoaId, clienteConectado());
    auditAccess("armazenamento_pasta_criada", req.accessUser!.id, null, { pessoa_id: pessoaId });
    void processarFila().catch(() => undefined);
    res.json(r);
  } catch (e) { erro(res, e); }
});

armazenamentoRouter.post("/reenviar", (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) return void res.status(400).json({ error: "Item inválido." });
  res.json({ ok: reenviar(id) });
});

/** "Enviar agora": roda uma rodada da fila sem esperar o minuto. */
armazenamentoRouter.post("/processar", async (_req, res) => {
  try { res.json(await processarFila()); } catch (e) { erro(res, e); }
});
