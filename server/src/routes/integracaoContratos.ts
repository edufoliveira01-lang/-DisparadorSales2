import { cobrancaParaOAtendimento, complementoDaCobranca } from "../services/gestao/cobrancaPeloAtendimento";
import { Router, type Request } from "express";
import { verificarRequisicao } from "../atendimento/assinatura";
import { atendimentoDaInstancia } from "../atendimento/instancia";
import { auditAccess } from "../services/accessService";
import { tratarJsonRpc } from "../atendimento/mcp/servidor";
import { lerAtendimentoIa, montarPromptDoAgente, pendenciasDoAtendimentoIa } from "../services/gestao/atendimentoIa";
import { lerConfigDocumentos, ROTULO_VARIANTE, VARIANTES } from "../services/gestao/documentos";
import { ErroZapSign } from "../zapsign/api";
import { ErroContrato, estadoDoContrato, gerarContrato, type DadosContrato } from "../zapsign/contratos";
import { ErroArmazenamento } from "../armazenamento/pastas";
import { baixar, pessoaDoDocumento, receberDocumentoDoChat } from "../armazenamento/chat";
import { podeSugerirFoto, registrarSugestao, sugerirFotoDoDocumento, type CaixaDoRetrato } from "../services/gestao/fotoSugerida";
import { dataPlausivel, leituraConfiavel, lerConteudo } from "../services/gestao/leituraDoDocumento";
import { guardarEssencial, identificarSlot } from "../services/gestao/documentosEssenciais";
import { saudeDoArmazenamento } from "../armazenamento/fila";
import { guardarRetrato } from "../atendimento/indicadores";
import { ErroAsaas, processarWebhook } from "../services/gestao/asaas";
import { anotarPeloAtendimento, clienteParaAnotar, cumprirPeloAtendimento, pendenciasPorTelefone } from "../services/gestao/anotacoes";
import { atualizarCadastroPeloAtendimento } from "../services/gestao/cadastroPeloAtendimento";
import { ErroGestao } from "../services/gestao/erro";

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
  if (e instanceof ErroContrato || e instanceof ErroZapSign || e instanceof ErroArmazenamento) return void res.status(e.status).json({ error: e.message });
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

/**
 * Documento que o CLIENTE mandou pelo chat (fase 2 do Dropbox). O atendimento classifica e manda só o tipo, o título e um LINK TEMPORÁRIO do arquivo:
 * o Sales baixa, guarda numa pasta temporária e envia ao drive depois da assinatura do contrato. Corpo pequeno (sem arquivo dentro).
 */
/** O documento que o cliente mandou também fica no CADASTRO dele (RG, CPF, CNH, comprovante, CNIS) e, se for retrato, vira sugestão de foto. Melhor esforço. */
async function guardarNoCadastro(d: { telefone: string; cpf: string; titulo: string; url: string; origemRef: string; tipo: string; extensao: string }) {
  try {
    const pessoaId = pessoaDoDocumento(d.cpf, d.telefone);
    if (pessoaId === null) return;
    const ext = d.extensao.toLowerCase();
    const candidato = ["DOCUMENTOS PESSOAIS", "DOCUMENTOS ADMINISTRATIVO", "A CLASSIFICAR"].includes(d.tipo) && /^(jpe?g|png|webp|pdf)$/.test(ext);
    let slot = identificarSlot(d.titulo);
    if (!slot && !candidato) return;
    const conteudo = await baixar(d.url, fetch);
    const nome = `${d.titulo}.${ext}`;
    let data: string | null = null, retrato: CaixaDoRetrato | null = null, documento = "";
    if (!slot) { // o título não disse: a IA lê o arquivo
      const r = await lerConteudo(conteudo, nome);
      if (r.situacao !== "ok" || !leituraConfiavel(r.leitura)) return;
      slot = r.leitura.tipo; data = dataPlausivel(r.leitura.data_documento); retrato = r.leitura.retrato; documento = slot.toUpperCase();
    }
    try { guardarEssencial(pessoaId, slot, nome, conteudo, { data, user: { id: null, nome: "Atendimento (WhatsApp)" }, origemRef: d.origemRef }); } catch (e) { console.warn("[documento essencial]", e instanceof Error ? e.message : "falhou"); }
    if ((slot === "rg" || slot === "cnh") && /^(jpe?g|png|webp)$/.test(ext) && !podeSugerirFoto(pessoaId, conteudo)) {
      const r = retrato ? registrarSugestao(pessoaId, conteudo, retrato, documento, d.titulo) : await sugerirFotoDoDocumento(pessoaId, conteudo, d.titulo);
      if (r === "sugerida") auditAccess("foto_sugerida_do_documento", null, null, { pessoa: pessoaId });
    }
  } catch (e) { console.warn("[documento do chat no cadastro]", e instanceof Error ? e.message : "falhou"); }
}
integracaoContratosRouter.post("/documentos", async (req, res) => {
  try {
    const d = (req.body ?? {}) as Record<string, unknown>;
    const r = await receberDocumentoDoChat({
      origemRef: String(d.origem_ref ?? ""), telefone: String(d.telefone ?? ""), cpf: String(d.cpf ?? ""), tipoPasta: String(d.tipo ?? ""),
      titulo: String(d.titulo ?? ""), extensao: String(d.extensao ?? "pdf"), dataDocumento: typeof d.data === "string" ? d.data : undefined, url: String(d.url ?? ""),
    });
    auditAccess("documento_do_chat_recebido", null, null, { situacao: r.situacao, tipo: String(d.tipo ?? "") });
    // O documento também fica no cadastro do cliente e, sendo retrato, vira sugestão de foto: em segundo plano, nunca atrapalha o recebimento.
    void guardarNoCadastro({ telefone: String(d.telefone ?? ""), cpf: String(d.cpf ?? ""), titulo: String(d.titulo ?? ""), url: String(d.url ?? ""), origemRef: String(d.origem_ref ?? ""), tipo: String(d.tipo ?? ""), extensao: String(d.extensao ?? "pdf") });
    res.status(r.situacao === "ja_recebido" ? 200 : 201).json(r);
  } catch (e) { erro(res, e); }
});

/** O retrato dos indicadores do atendimento (leads qualificados, desqualificados…), calculado e empurrado pelo Deskcomm para a tela Início. */
integracaoContratosRouter.post("/indicadores", (req, res) => {
  const r = guardarRetrato(req.body);
  if (!r) return void res.status(400).json({ error: "Retrato inválido." });
  res.status(201).json({ ok: true, meses: r.meses.length });
});

/** Anotação rápida feita no atendimento: o atendente aperta Alt+N na conversa; aqui achamos o cliente pelo telefone e gravamos no cadastro ou no processo. */
integracaoContratosRouter.post("/anotacoes/buscar", (req, res) => {
  try { res.json(clienteParaAnotar((req.body ?? {}).telefone)); } catch (e) { erro(res, e); }
});
/** As pendências (anotações importantes ainda não cumpridas) do cliente desta conversa: o aviso que fica no chat. */
integracaoContratosRouter.post("/anotacoes/pendencias", (req, res) => {
  try { res.json(pendenciasPorTelefone((req.body ?? {}).telefone)); } catch (e) { erro(res, e); }
});
integracaoContratosRouter.post("/anotacoes/cumprir", (req, res) => {
  try {
    const r = cumprirPeloAtendimento(req.body ?? {});
    auditAccess("pendencia_cumprida_pelo_atendimento", null, null, {});
    res.json(r);
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message });
    erro(res, e);
  }
});
integracaoContratosRouter.post("/anotacoes", (req, res) => {
  try {
    const r = anotarPeloAtendimento(req.body ?? {});
    auditAccess("anotacao_pelo_atendimento", null, null, { destino: r.destino });
    res.status(201).json(r);
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message });
    erro(res, e);
  }
});

/** O atendimento (Deskcomm) corrige dados do cadastro do cliente que o próprio cliente informou na conversa: só os campos liberados, com histórico. */
integracaoContratosRouter.post("/cadastro", (req, res) => {
  try {
    const r = atualizarCadastroPeloAtendimento(req.body ?? {});
    auditAccess("cadastro_pelo_atendimento", null, null, { alterados: r.alterados.join(","), ignorados: r.ignorados.join(",") });
    res.status(200).json(r);
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message });
    erro(res, e);
  }
});

/** O agente de atendimento pede o boleto/PIX de uma parcela do PRÓPRIO cliente da conversa (achado pelo telefone). */
integracaoContratosRouter.post("/cobranca", async (req, res) => {
  try {
    const r = await cobrancaParaOAtendimento(req.body ?? {});
    auditAccess("cobranca_pelo_atendimento", null, null, { lancamento: r.lancamento_id });
    res.status(200).json(r);
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message });
    erro(res, e);
  }
});

/** Completa, sem pressa, o PIX e o PDF de uma cobrança já gerada (o atendimento chama de novo até conseguir). */
integracaoContratosRouter.post("/cobranca/complemento", async (req, res) => {
  try { res.status(200).json(await complementoDaCobranca(req.body ?? {})); }
  catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message });
    erro(res, e);
  }
});

/** Aviso de pagamento do Asaas (repassado pelo painel). O token do aviso é conferido aqui; o corpo é o evento do Asaas. */
integracaoContratosRouter.post("/asaas", (req, res) => {
  try { res.json(processarWebhook(String(req.headers["x-asaas-token"] ?? cabecalho(req, "asaas-access-token") ?? ""), req.body)); }
  catch (e) {
    if (e instanceof ErroAsaas) return void res.status(e.status).json({ error: e.message });
    console.error("[asaas] aviso de pagamento:", e instanceof Error ? e.message : e); res.status(500).json({ error: "Erro interno." });
  }
});

/** A saúde do envio ao drive: o atendimento consulta de tempos em tempos e avisa a equipe por WhatsApp quando aparece um problema novo. */
integracaoContratosRouter.get("/armazenamento/saude", (_req, res) => {
  try { res.json(saudeDoArmazenamento()); } catch (e) { erro(res, e); }
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
