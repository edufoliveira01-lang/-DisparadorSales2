import { Router, type Request } from "express";
import { verificarRequisicao } from "../atendimento/assinatura";
import { atendimentoDaInstancia } from "../atendimento/instancia";
import { auditAccess } from "../services/accessService";
import { tratarJsonRpc } from "../atendimento/mcp/servidor";
import { lerAtendimentoIa, montarPromptDoAgente, pendenciasDoAtendimentoIa } from "../services/gestao/atendimentoIa";
import { lerConfigDocumentos, ROTULO_VARIANTE, VARIANTES } from "../services/gestao/documentos";
import { ErroZapSign } from "../zapsign/api";
import { ErroContrato, estadoDoContrato, gerarContrato, type DadosContrato } from "../zapsign/contratos";

/**
 * Contratos pedidos pelo atendimento (Deskcomm). NÃO usa a sessão de ninguém: quem chama é o painel de assinaturas,
 * assinando o corpo com a chave deste escritório (a mesma da entrada direta). Só existe com o módulo de atendimento liberado.
 */
export const integracaoContratosRouter = Router();

const cabecalho = (req: Request, nome: string) => { const v = req.headers[nome]; return Array.isArray(v) ? v[0] : v; };

integracaoContratosRouter.use((req, res, next) => {
  const a = atendimentoDaInstancia();
  if (!a) return void res.status(404).json({ error: "O atendimento não está liberado para este escritório." });
  const corpo = (req as Request & { rawBody?: string }).rawBody ?? "";
  const caminho = req.originalUrl.split("?")[0];
  if (!verificarRequisicao(a.chaveSso, { metodo: req.method, caminho, corpo }, cabecalho(req, "x-sales-timestamp"), cabecalho(req, "x-sales-signature"))) {
    return void res.status(401).json({ error: "Assinatura inválida." });
  }
  res.setHeader("Cache-Control", "no-store");
  next();
});

function erro(res: import("express").Response, e: unknown) {
  if (e instanceof ErroContrato || e instanceof ErroZapSign) return void res.status(e.status).json({ error: e.message });
  console.error("[contratos] erro inesperado:", e instanceof Error ? e.message : e);
  res.status(500).json({ error: "Erro interno ao gerar o contrato." });
}

integracaoContratosRouter.post("/contratos", async (req, res) => {
  try {
    const d = (req.body ?? {}) as DadosContrato;
    const r = await gerarContrato(d, String(d.criado_por || "Atendimento"));
    auditAccess("contrato_gerado_atendimento", null, null, { contrato: r.id, pessoa: r.pessoa_id });
    res.status(201).json(r);
  } catch (e) { erro(res, e); }
});

/** O que o escritório configurou e o atendimento precisa mostrar no formulário: tipos de documento, valores e modelos de honorários. */
/**
 * Servidor de ferramentas (MCP) do escritório, só para o agente de IA do Deskcomm. O painel repassa o JSON-RPC assinado com a chave do escritório,
 * dentro de `{ contato: { telefone }, rpc }`: o telefone vem do Deskcomm (do banco dele), e as ferramentas só enxergam o cliente desse telefone.
 */
integracaoContratosRouter.post("/mcp", (req, res) => {
  const corpo = (req.body ?? {}) as { contato?: { telefone?: unknown }; rpc?: unknown };
  const telefone = typeof corpo.contato?.telefone === "string" ? corpo.contato.telefone : "";
  if (Array.isArray(corpo.rpc)) {
    const r = corpo.rpc.map((m) => tratarJsonRpc(m, { telefone })).filter((x) => x !== null);
    return void (r.length ? res.json(r) : res.status(202).end());
  }
  const r = tratarJsonRpc(corpo.rpc, { telefone });
  if (r === null) return void res.status(202).end();
  res.json(r);
});

/** O prompt do agente de IA deste escritório, já montado do cadastro (Atendimento com IA + dados do escritório). O Deskcomm o guarda como RASCUNHO. */
integracaoContratosRouter.get("/agente/prompt", (_req, res) => {
  const c = lerAtendimentoIa();
  res.json({ prompt: montarPromptDoAgente(c), nome_agente: c.nome_agente, pendencias: pendenciasDoAtendimentoIa(c) });
});

integracaoContratosRouter.get("/contratos/opcoes", (_req, res) => {
  const c = lerConfigDocumentos();
  res.json({
    variantes: VARIANTES.map((v) => ({ id: v, nome: ROTULO_VARIANTE[v] })),
    campos: c.campos.map(({ id, rotulo, tipo, padrao }) => ({ id, rotulo, tipo, padrao })),
    modelos_honorarios: c.modelos_honorarios.map(({ id, nome }) => ({ id, nome })),
  });
});

integracaoContratosRouter.get("/contratos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return void res.status(400).json({ error: "Contrato inválido." });
    res.json(await estadoDoContrato(id));
  } catch (e) { erro(res, e); }
});
