import fs from "node:fs";
import express, { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../db";
import { ErroGestao, atualizarPessoa, criarPessoa, excluirPessoa, importarContatos, listarPessoas, obterPessoa, previaDaExclusao } from "../services/gestao/pessoas";
import {
  adicionarAnotacao, adicionarParte, atualizarProcesso, criarProcesso, excluirProcesso, importarDoDjen, ignorarPendentesDoDjen, linhaDoTempo, listarProcessos,
  obterProcesso, pendentesDeImportacao, removerAnotacao, removerParte, resumoGestao,
} from "../services/gestao/processos";
import { auditAccess } from "../services/accessService";
import { TAMANHO_MAXIMO, excluirArquivo, extensao, listarArquivos, obterArquivo, podeExibir, salvarArquivo, usoDeArmazenamento } from "../services/gestao/arquivos";
import { VARIAVEIS, excluirModelo, gerarDocumento, listarModelos, salvarModelo } from "../services/gestao/modelos";
import { atualizarTarefa, concluirTarefa, criarTarefa, excluirTarefa, listarTarefas, meuPainel, obterTarefa, sincronizarPrazosDjen } from "../services/gestao/tarefas";
import { atualizarLancamento, baixarLancamento, parcelasParaAbater, historicoDoLancamento, reprogramarVencimento, cancelarContrato, cancelarLancamento, criarContrato, criarLancamentos, estornarLancamento, excluirLancamento, fluxoDeCaixa, listarContratos, listarLancamentos, obterContrato, obterLancamento, resumoFinanceiro } from "../services/gestao/financeiro";
import { indicadores } from "../services/gestao/indicadores";
import { dashboardDoInicio } from "../services/gestao/dashboard";
import { captacao } from "../services/gestao/captacao";
import { AREAS, FONTES_PADRAO, lerFontes, MOTIVOS, obterNegocio, pendentesDePreenchimento, QUALIFICACOES, salvarFontesExtras, salvarNegocio } from "../services/gestao/negocios";
import { hasPermission } from "../services/accessService";
import { consultarCep } from "../services/gestao/cep";
import { adicionarCamposPrevidenciarios, atualizarCampo, criarCampo, excluirCampo, listarCampos, revelarSenha, TIPOS_CAMPO } from "../services/gestao/campos";
import { anotacaoRapida, anotacoesDaPessoa, anotarNaPessoa, removerAnotacaoDaPessoa } from "../services/gestao/anotacoes";
import { fichaDeCadastroHtml, fichaDeExemplo } from "../services/gestao/ficha";
import { PADRAO as FICHA_PADRAO, ROTULO_SECAO, apagarFoto, apagarImagem, apagarLogo, fotoDaPessoa, imagemAtual, lerConfig, logoAtual, nomeDeImagemValido, salvarConfig, salvarFoto, salvarImagem, salvarLogo } from "../services/gestao/fichaConfig";
import { AREAS_PRONTAS, lerAtendimentoIa, montarPromptDoAgente, pendenciasDoAtendimentoIa, salvarAtendimentoIa } from "../services/gestao/atendimentoIa";
import { docxParaModelo } from "../services/gestao/importarDocx";
import { DOCS, ROTULO_VARIANTE, atualizarDocumentoProprio, criarDocumentoProprio, excluirDocumentoProprio, TEXTOS_PADRAO, VARIANTES, VARIAVEIS_DOCUMENTO, kitHtml, lerConfigDocumentos, montarKit, restaurarTexto, salvarConfigDocumentos, type OpcoesKit } from "../services/gestao/documentos";
import { kitDocx } from "../services/gestao/docx";
import { lerEscritorio, salvarEscritorio } from "../services/gestao/escritorio";
import crypto from "node:crypto";
import { agendaDaPessoa, andamentoDoProcesso } from "../services/gestao/integracao";
import { atendimentoDaInstancia } from "../atendimento/instancia";
import { hojeSaoPaulo } from "../services/djen/cache";
import { completarComDataJud, forcarConsulta, iniciarAcompanhamento, situacaoDoAcompanhamento } from "../services/djen/vigia";
import { definirProvedor, provedorAtual } from "../services/canalProvedor";
import { ErroDeskcomm, canalEscolhido, listarCanaisDoDeskcomm, salvarCanaisDoDeskcomm, envioPeloDeskcommLigado, mascaraDeskcomm, salvarTokenDoDeskcomm, testarDeskcomm, tokenDoDeskcomm, urlDoDeskcomm } from "../services/gestao/deskcomm";
import { agendarReconciliacao, contatosSemCadastro, importarArquivoComoClientes, importarContatosEscolhidos } from "../services/gestao/contatosEspelho";
import { boletoEmPdf } from "../services/gestao/boleto";
import { avisosDaParcela, enviarAviso, enviarEmLote, historicoDeAvisos, lerRegua, pausarAvisos, pendentesDaRegua, pessoaPausada, salvarRegua } from "../services/gestao/regua";
import { getSetting, setSetting } from "../services/settingsService";
import { agendarSincronizacaoAsaas, ambienteDoAsaas, cancelarCobranca, chaveDoAsaas, cobrancaDoLancamento, consultarCobranca, ErroAsaas, gerarCobranca, mascara as mascaraAsaas, salvarConfigAsaas, sincronizarCobrancasAlteradas, sincronizarExtrato, taxasDoAsaas, testarAsaas, tokenDoWebhook } from "../services/gestao/asaas";
import { atualizarDoDataJud, chaveDoDataJud, ErroDataJud, mascararChave, salvarChaveDoDataJud } from "../services/djen/datajud";
import { processarHistoricos } from "../services/djen/processHistory";
import { licencaPermiteOperar } from "../licenca/cliente";
import { financeiroDaPessoa } from "../services/gestao/financeiro";
import { recursoLiberadoNaLicenca } from "../licenca/cliente";

/** Gestão do escritório: pessoas (clientes e outras partes), processos e pastas. Permissões: gestao.view / gestao.manage. */
/** Dispara a fila do histórico sem esperar o relógio e sem prender a resposta. */
const kickDoHistorico = () => { if (licencaPermiteOperar()) void processarHistoricos().catch(() => undefined); };
/** Processo novo com número CNJ entra sozinho no acompanhamento do DJEN. */
const acompanharAgora = (chave: string, numero: string) => { try { if (iniciarAcompanhamento(chave, numero)) kickDoHistorico(); } catch (e) { console.error("[gestao] acompanhamento automático:", e instanceof Error ? e.message : e); } };
export const gestaoRouter = Router();
// Ao gravar clientes, processos ou partes, o espelho de contatos dos avisos é recalculado (em segundo plano).
gestaoRouter.use((req, res, next) => { res.on("finish", () => { if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && res.statusCode < 400 && /^\/(pessoas|processos|partes)/.test(req.path)) agendarReconciliacao(); }); next(); });

// Módulos contratados no plano (SaaS): sem o módulo, a área inteira responde 403.
gestaoRouter.use((req, res, next) => {
  if (!recursoLiberadoNaLicenca("modulo_gestao")) return void res.status(403).json({ error: "O plano atual não inclui o módulo de gestão.", codigo: "modulo_nao_contratado" });
  if (req.path.startsWith("/financeiro") && !recursoLiberadoNaLicenca("modulo_financeiro")) return void res.status(403).json({ error: "O plano atual não inclui o módulo financeiro.", codigo: "modulo_nao_contratado" });
  next();
});

const rota = (fn: (req: Request, res: Response) => unknown): ((req: Request, res: Response, next: NextFunction) => void) => (req, res, next) => {
  const falhou = (e: unknown) => { if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message }); next(e); };
  try {
    const r = fn(req, res);
    if (r && typeof (r as Promise<unknown>).then === "function") { (r as Promise<unknown>).then((v) => { if (v !== undefined && !res.headersSent) res.json(v); }, falhou); return; }
    if (r !== undefined && !res.headersSent) res.json(r);
  } catch (e) { falhou(e); }
};
const id = (req: Request, nome = "id") => {
  const n = Number(req.params[nome]);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ErroGestao("Identificador inválido.", 400);
  return n;
};
const usuario = (req: Request) => req.accessUser!;
const nomeDe = (u: { display_name: string | null; username: string }) => u.display_name || u.username;
const quem = (req: Parameters<typeof usuario>[0]) => { const u = usuario(req); return { id: u.id, nome: nomeDe(u) }; };

gestaoRouter.get("/resumo", rota(() => resumoGestao()));
gestaoRouter.get("/responsaveis", rota(() => db.prepare("SELECT id, COALESCE(NULLIF(display_name,''), username) AS nome FROM users WHERE active=1 ORDER BY nome COLLATE NOCASE").all()));

// ---------- pessoas ----------
gestaoRouter.get("/pessoas", rota((req) => listarPessoas({ busca: String(req.query.busca ?? ""), tipo: String(req.query.tipo ?? ""), ativo: String(req.query.ativo ?? ""), filtro: String(req.query.filtro ?? ""), pagina: Number(req.query.pagina), limite: Number(req.query.limite) })));
gestaoRouter.get("/pessoas/contatos-sem-cadastro", rota(() => ({ itens: contatosSemCadastro() })));
gestaoRouter.post("/pessoas/contatos-sem-cadastro/importar", rota((req) => {
  if (!hasPermission(usuario(req), "gestao.manage")) throw new ErroGestao("Sem permissão.", 403);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  if (!ids.length) throw new ErroGestao("Escolha ao menos um contato.", 400);
  const r = importarContatosEscolhidos(ids); auditAccess("gestao_contatos_escolhidos_importados", usuario(req).id, null, r); return r;
}));
gestaoRouter.post("/pessoas/importar-arquivo", rota((req) => {
  if (!hasPermission(usuario(req), "gestao.manage")) throw new ErroGestao("Sem permissão.", 403);
  const content = typeof req.body?.content === "string" ? req.body.content : "";
  let r; try { r = importarArquivoComoClientes(content); } catch { throw new ErroGestao("Não foi possível ler o arquivo, ou nenhum contato com nome e telefone foi encontrado. Use um CSV (Google/Android) ou vCard (.vcf).", 400); }
  auditAccess("gestao_clientes_importados_arquivo", usuario(req).id, null, r); return r;
}));
gestaoRouter.post("/pessoas/importar-contatos", rota((req) => { const r = importarContatos(); auditAccess("gestao_contatos_importados", usuario(req).id, null, r); return r; }));
gestaoRouter.post("/pessoas", rota((req, res) => { const p = criarPessoa(req.body || {}); res.status(201); auditAccess("gestao_pessoa_criada", usuario(req).id, null, { pessoa: p.id }); return p; }));
gestaoRouter.get("/pessoas/:id", rota((req) => obterPessoa(id(req))));
gestaoRouter.put("/pessoas/:id", rota((req) => atualizarPessoa(id(req), req.body || {})));
gestaoRouter.get("/pessoas/:id/exclusao", rota((req) => previaDaExclusao(id(req))));
gestaoRouter.delete("/pessoas/:id", rota((req) => { const r = excluirPessoa(id(req), { cancelarPericias: req.query.cancelar_pericias === "1" }); auditAccess("gestao_pessoa_excluida", usuario(req).id, null, { pessoa: id(req), pericias_canceladas: r.pericias_canceladas }); return r; }));

// ---------- processos ----------
gestaoRouter.get("/processos", rota((req) => listarProcessos({
  busca: String(req.query.busca ?? ""), status: String(req.query.status ?? ""), responsavel: String(req.query.responsavel ?? ""), area: String(req.query.area ?? ""),
  pessoa: String(req.query.pessoa ?? ""), pagina: Number(req.query.pagina), limite: Number(req.query.limite),
})));
gestaoRouter.get("/processos/pendentes-importacao", rota(() => ({ pendentes: pendentesDeImportacao() })));
gestaoRouter.post("/processos/ignorar-djen", rota((req) => { const r = ignorarPendentesDoDjen(); auditAccess("gestao_djen_ignorados", usuario(req).id, null, r); return r; }));
gestaoRouter.post("/processos/importar-djen", rota((req) => { const r = importarDoDjen(usuario(req).id); auditAccess("gestao_processos_importados", usuario(req).id, null, r); return r; }));
gestaoRouter.post("/processos", rota((req, res) => { const p = criarProcesso(req.body || {}, usuario(req).id); res.status(201); acompanharAgora(String((p as { chave?: string }).chave ?? "") || String(p.numero).replace(/\D/g, ""), String(p.numero)); auditAccess("gestao_processo_criado", usuario(req).id, null, { processo: p.id, pasta: p.pasta }); return p; }));
gestaoRouter.get("/processos/:id", rota((req) => obterProcesso(id(req))));
gestaoRouter.put("/processos/:id", rota((req) => atualizarProcesso(id(req), req.body || {})));
gestaoRouter.delete("/processos/:id", rota((req) => { const r = excluirProcesso(id(req)); auditAccess("gestao_processo_excluido", usuario(req).id, null, { processo: id(req) }); return r; }));
gestaoRouter.get("/processos/:id/linha-do-tempo", rota((req) => linhaDoTempo(id(req))));
gestaoRouter.post("/processos/:id/partes", rota((req) => adicionarParte(id(req), req.body || {})));
gestaoRouter.delete("/processos/:id/partes/:pessoaId/:papel", rota((req) => removerParte(id(req), id(req, "pessoaId"), String(req.params.papel))));
gestaoRouter.post("/processos/:id/anotacoes", rota((req, res) => { const u = usuario(req); res.status(201); return adicionarAnotacao(id(req), req.body?.texto, { id: u.id, nome: nomeDe(u) }); }));
gestaoRouter.delete("/processos/:id/anotacoes/:anotacaoId", rota((req) => { const u = usuario(req); return removerAnotacao(id(req), id(req, "anotacaoId"), { id: u.id, admin: u.role === "administrador" }); }));
// anotações no cadastro da pessoa e atalho "anotação rápida" (cliente + processo opcional)
gestaoRouter.get("/pessoas/:id/anotacoes", rota((req) => ({ itens: anotacoesDaPessoa(id(req)) })));
gestaoRouter.post("/pessoas/:id/anotacoes", rota((req, res) => { const u = usuario(req); res.status(201); return anotarNaPessoa(id(req), req.body?.texto, { id: u.id, nome: nomeDe(u) }); }));
gestaoRouter.delete("/pessoas/:id/anotacoes/:anotacaoId", rota((req) => { const u = usuario(req); return removerAnotacaoDaPessoa(id(req), id(req, "anotacaoId"), { id: u.id, admin: u.role === "administrador" }); }));
gestaoRouter.post("/anotacao-rapida", rota((req, res) => { const u = usuario(req); res.status(201); return anotacaoRapida(req.body || {}, { id: u.id, nome: nomeDe(u) }); }));

// ---------- arquivos ----------
const corpoBruto = express.raw({ type: () => true, limit: TAMANHO_MAXIMO + 1024 });
const enviar = (escopo: "processo" | "pessoa") => rota((req, res) => {
  const u = usuario(req);
  const e = escopo === "processo" ? { processoId: id(req) } : { pessoaId: id(req) };
  const a = salvarArquivo(e, req.query.nome, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), { categoria: String(req.query.categoria ?? ""), descricao: String(req.query.descricao ?? "") }, { id: u.id, nome: nomeDe(u) });
  res.status(201);
  const { armazenado: _x, ...publico } = a;
  return publico;
});
gestaoRouter.get("/armazenamento", rota(() => usoDeArmazenamento()));
gestaoRouter.get("/processos/:id/arquivos", rota((req) => listarArquivos({ processoId: id(req) })));
gestaoRouter.post("/processos/:id/arquivos", corpoBruto, enviar("processo"));
gestaoRouter.get("/pessoas/:id/arquivos", rota((req) => listarArquivos({ pessoaId: id(req) })));
gestaoRouter.post("/pessoas/:id/arquivos", corpoBruto, enviar("pessoa"));
gestaoRouter.get("/arquivos/:id/baixar", rota((req, res) => {
  const a = obterArquivo(id(req));
  if (!fs.existsSync(a.caminho)) throw new ErroGestao("O arquivo não está mais no servidor.", 404);
  const inline = req.query.inline === "1" && podeExibir(a);
  res.setHeader("Content-Type", a.mime);
  res.setHeader("Content-Length", String(fs.statSync(a.caminho).size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(a.caminho).pipe(res);
  void extensao;
  return undefined;
}));
gestaoRouter.delete("/arquivos/:id", rota((req) => { const r = excluirArquivo(id(req)); auditAccess("gestao_arquivo_excluido", usuario(req).id, null, { arquivo: id(req) }); return r; }));

// ---------- modelos de documento ----------
gestaoRouter.get("/modelos", rota(() => ({ modelos: listarModelos(), variaveis: VARIAVEIS })));
gestaoRouter.post("/modelos", rota((req, res) => { res.status(201); return salvarModelo(null, req.body || {}); }));
gestaoRouter.put("/modelos/:id", rota((req) => salvarModelo(id(req), req.body || {})));
gestaoRouter.delete("/modelos/:id", rota((req) => excluirModelo(id(req))));
gestaoRouter.post("/modelos/:id/gerar", rota((req) => {
  const u = usuario(req);
  const processoId = Number(req.body?.processo_id) || undefined, pessoaId = Number(req.body?.pessoa_id) || undefined;
  const r = gerarDocumento(id(req), { processoId, pessoaId }, nomeDe(u));
  let arquivo: unknown = null;
  if (req.body?.salvar === true) {
    const alvo = processoId ? { processoId } : pessoaId ? { pessoaId } : null;
    if (!alvo) throw new ErroGestao("Para salvar, escolha o processo ou a pessoa.");
    const { armazenado: _x, ...pub } = salvarArquivo(alvo, `${r.nome}.doc`, Buffer.from(r.documento, "utf8"), { categoria: "Documento gerado" }, { id: u.id, nome: nomeDe(u) });
    arquivo = pub;
  }
  return { nome: r.nome, html: r.html, documento: r.documento, faltando: r.faltando, arquivo };
}));

// ---------- tarefas e meu painel ----------
gestaoRouter.get("/meu-painel", rota((req) => meuPainel(usuario(req).id)));
gestaoRouter.get("/tarefas", rota((req) => listarTarefas({ responsavel: String(req.query.responsavel ?? ""), status: req.query.status === undefined ? undefined : String(req.query.status), processo: String(req.query.processo ?? ""), periodo: String(req.query.periodo ?? ""), busca: String(req.query.busca ?? ""), pagina: Number(req.query.pagina), limite: Number(req.query.limite) }, usuario(req).id)));
gestaoRouter.post("/tarefas/sincronizar-djen", rota(() => sincronizarPrazosDjen(true)));
gestaoRouter.post("/tarefas", rota((req, res) => { res.status(201); return criarTarefa(req.body || {}, usuario(req).id); }));
gestaoRouter.get("/tarefas/:id", rota((req) => obterTarefa(id(req))));
gestaoRouter.put("/tarefas/:id", rota((req) => atualizarTarefa(id(req), req.body || {})));
gestaoRouter.post("/tarefas/:id/concluir", rota((req) => concluirTarefa(id(req), req.body?.concluida !== false)));
gestaoRouter.delete("/tarefas/:id", rota((req) => excluirTarefa(id(req))));

// ---------- financeiro (permissões financeiro.view / financeiro.manage) ----------
const q = (req: Request) => Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : undefined])) as Record<string, string | undefined>;
gestaoRouter.get("/financeiro/resumo", rota((req) => resumoFinanceiro(req.query.mes)));
gestaoRouter.get("/financeiro/fluxo", rota((req) => fluxoDeCaixa(Number(req.query.meses))));
gestaoRouter.get("/financeiro/lancamentos", rota((req) => listarLancamentos(q(req))));
gestaoRouter.post("/financeiro/lancamentos", rota((req, res) => { const r = criarLancamentos(req.body || {}, usuario(req).id); res.status(201); auditAccess("financeiro_lancamento_criado", usuario(req).id, null, { quantidade: r.length }); return r; }));
gestaoRouter.get("/financeiro/lancamentos/:id", rota((req) => obterLancamento(id(req))));
gestaoRouter.put("/financeiro/lancamentos/:id", rota((req) => { const r = atualizarLancamento(id(req), req.body || {}, quem(req)); depoisDeMudar(); return r; }));
// ---------- Asaas: configuração, cobrança (boleto/PIX) e taxas ----------
const erroAsaas = (e: unknown): never => { if (e instanceof ErroAsaas) throw new ErroGestao(e.message, e.status); throw e; };
const gerirIntegracoes = (req: Parameters<typeof usuario>[0]) => { if (!hasPermission(usuario(req), "integrations.manage")) throw new ErroGestao("Sem permissão.", 403); };
const gerirFinanceiro = (req: Parameters<typeof usuario>[0]) => { if (!hasPermission(usuario(req), "financeiro.manage")) throw new ErroGestao("Sem permissão.", 403); };
const urlDoAviso = () => { const a = atendimentoDaInstancia(); return a ? `${a.ponteUrl.replace(/\/ponte\/?$/, "")}/asaas/${a.slug}` : ""; };
const configAsaas = () => ({ configurado: Boolean(chaveDoAsaas()), final: mascaraAsaas(chaveDoAsaas()), ambiente: ambienteDoAsaas(), url_do_aviso: urlDoAviso(), token_do_aviso: chaveDoAsaas() ? tokenDoWebhook() : "" });
const depoisDeMudar = () => { void sincronizarCobrancasAlteradas().catch(() => undefined); };
gestaoRouter.get("/asaas/config", rota((req) => { gerirIntegracoes(req); return configAsaas(); }));
gestaoRouter.put("/asaas/config", rota((req) => { gerirIntegracoes(req); try { salvarConfigAsaas(req.body || {}); } catch (e) { erroAsaas(e); } auditAccess("asaas_config_salva", usuario(req).id, null, {}); return configAsaas(); }));
gestaoRouter.post("/asaas/testar", rota(async (req) => { gerirIntegracoes(req); try { return await testarAsaas(); } catch (e) { return erroAsaas(e); } }));
gestaoRouter.get("/financeiro/lancamentos/:id/cobranca", rota((req) => ({ cobranca: cobrancaDoLancamento(id(req)), configurado: Boolean(chaveDoAsaas()) })));
gestaoRouter.post("/financeiro/lancamentos/:id/cobranca", rota(async (req, res) => { gerirFinanceiro(req); try { const c = await gerarCobranca(id(req), req.body?.tipo, quem(req)); if (lerRegua().salvar_boleto_dropbox) void boletoEmPdf(id(req), { quem: quem(req), copiarParaDrive: true }).catch(() => undefined); auditAccess("asaas_cobranca_gerada", usuario(req).id, null, { lancamento: id(req) }); res.status(201); return { cobranca: c }; } catch (e) { return erroAsaas(e); } }));
gestaoRouter.post("/financeiro/lancamentos/:id/cobranca/enviar", rota(async (req) => { gerirFinanceiro(req); const r = await enviarAviso(id(req), { origem: "manual", quem: quem(req) }); if (r.status === "falhou") throw new ErroGestao(r.motivo || "Não foi possível enviar.", 409); return { resultado: r }; }));
gestaoRouter.get("/financeiro/lancamentos/:id/avisos", rota((req) => ({ avisos: avisosDaParcela(id(req)) })));
gestaoRouter.post("/financeiro/avisos/lote", rota(async (req) => { gerirFinanceiro(req); const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : []; return enviarEmLote(ids, { quem: quem(req) }); }));
gestaoRouter.get("/financeiro/regua", rota(() => ({ canal_ligado: envioPeloDeskcommLigado(), config: lerRegua(), asaas: Boolean(chaveDoAsaas()), pendentes: pendentesDaRegua(), historico: historicoDeAvisos(60) })));
gestaoRouter.put("/financeiro/regua", rota((req) => { gerirFinanceiro(req); return { config: salvarRegua(req.body ?? {}) }; }));
gestaoRouter.get("/pessoas/:id/cobranca-pausa", rota((req) => ({ pausado: pessoaPausada(id(req)) })));
gestaoRouter.put("/pessoas/:id/cobranca-pausa", rota((req) => { gerirFinanceiro(req); pausarAvisos(id(req), Boolean(req.body?.pausado)); return { pausado: pessoaPausada(id(req)) }; }));
const erroDesk = (e: unknown): never => { if (e instanceof ErroDeskcomm) throw new ErroGestao(e.message, e.status); throw e; };
const configDesk = () => ({ configurado: Boolean(tokenDoDeskcomm()), final: mascaraDeskcomm(tokenDoDeskcomm()), atendimento_ligado: Boolean(urlDoDeskcomm()), pronto: envioPeloDeskcommLigado(), canal_padrao: canalEscolhido(), provedor: provedorAtual(), canal_cobranca: canalEscolhido("cobranca") === canalEscolhido() ? "" : canalEscolhido("cobranca"), canal_avisos: canalEscolhido("avisos") === canalEscolhido() ? "" : canalEscolhido("avisos"), canal_djen: canalEscolhido("djen") === canalEscolhido() ? "" : canalEscolhido("djen") });
gestaoRouter.get("/deskcomm/config", rota((req) => { gerirIntegracoes(req); return configDesk(); }));
gestaoRouter.put("/deskcomm/config", rota((req) => { gerirIntegracoes(req); try { if (req.body?.token !== undefined) salvarTokenDoDeskcomm(req.body.token); salvarCanaisDoDeskcomm(req.body ?? {}); if (req.body?.provedor !== undefined) definirProvedor(req.body.provedor); } catch (e) { erroDesk(e); } auditAccess("deskcomm_token_salvo", usuario(req).id, null, {}); return configDesk(); }));
gestaoRouter.get("/deskcomm/canais", rota(async (req) => { gerirIntegracoes(req); try { return { canais: await listarCanaisDoDeskcomm(), padrao: canalEscolhido(), cobranca: canalEscolhido("cobranca") }; } catch (e) { return erroDesk(e); } }));
gestaoRouter.post("/deskcomm/testar", rota(async (req) => { gerirIntegracoes(req); try { return await testarDeskcomm(); } catch (e) { return erroDesk(e); } }));
gestaoRouter.post("/financeiro/lancamentos/:id/cobranca/consultar", rota(async (req) => { gerirFinanceiro(req); try { return { cobranca: await consultarCobranca(id(req)) }; } catch (e) { return erroAsaas(e); } }));
gestaoRouter.post("/financeiro/lancamentos/:id/cobranca/cancelar", rota(async (req) => { gerirFinanceiro(req); try { await cancelarCobranca(id(req), quem(req)); return { cobranca: cobrancaDoLancamento(id(req)) }; } catch (e) { return erroAsaas(e); } }));
gestaoRouter.get("/financeiro/asaas/taxas", rota((req) => {
  const hoje = hojeSaoPaulo(); const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes ?? "")) ? String(req.query.mes) : hoje.slice(0, 7);
  // Abrir a tela já dispara a atualização em segundo plano (se a última tem mais de 2 minutos); a tela se refaz sozinha.
  const ult = Date.parse(getSetting("asaas_extrato_sync_em") || "") || 0; if (Date.now() - ult > 120_000) agendarSincronizacaoAsaas(300);
  return taxasDoAsaas(`${mes}-01`, `${mes}-31`);
}));
gestaoRouter.post("/financeiro/asaas/taxas/sincronizar", rota(async (req) => {
  gerirFinanceiro(req); const hoje = hojeSaoPaulo();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.de ?? "")) ? String(req.body.de) : `${hoje.slice(0, 4)}-01-01`;
  try { const r = await sincronizarExtrato(de, hoje); setSetting("asaas_extrato_sync_em", new Date().toISOString()); setSetting("asaas_extrato_sync_erro", ""); return r; } catch (e) { return erroAsaas(e); }
}));
gestaoRouter.get("/financeiro/lancamentos/:id/parcelas-para-abater", rota((req) => parcelasParaAbater(id(req))));
gestaoRouter.get("/financeiro/lancamentos/:id/historico", rota((req) => ({ itens: historicoDoLancamento(id(req)) })));
gestaoRouter.post("/financeiro/lancamentos/:id/reprogramar", rota((req) => { const r = reprogramarVencimento(id(req), req.body || {}, quem(req)); auditAccess("financeiro_reprogramado", usuario(req).id, null, { lancamento: id(req), parcelas: r.parcelas_movidas }); depoisDeMudar(); return r; }));
gestaoRouter.post("/financeiro/lancamentos/:id/baixar", rota((req) => { const r = baixarLancamento(id(req), req.body || {}, quem(req)); auditAccess("financeiro_baixa", usuario(req).id, null, { lancamento: r.id }); return r; }));
gestaoRouter.post("/financeiro/lancamentos/:id/estornar", rota((req) => { const r = estornarLancamento(id(req)); auditAccess("financeiro_estorno", usuario(req).id, null, { lancamento: r.id }); return r; }));
gestaoRouter.post("/financeiro/lancamentos/:id/cancelar", rota((req) => { const r = cancelarLancamento(id(req), req.body?.cancelar !== false); depoisDeMudar(); return r; }));
gestaoRouter.delete("/financeiro/lancamentos/:id", rota((req) => { const r = excluirLancamento(id(req)); auditAccess("financeiro_lancamento_excluido", usuario(req).id, null, { lancamento: id(req) }); return r; }));
gestaoRouter.get("/financeiro/contratos", rota((req) => listarContratos(q(req))));
gestaoRouter.post("/financeiro/contratos", rota((req, res) => { const r = criarContrato(req.body || {}, usuario(req).id); res.status(201); auditAccess("financeiro_contrato_criado", usuario(req).id, null, { contrato: r.id }); return r; }));
gestaoRouter.get("/financeiro/contratos/:id", rota((req) => obterContrato(id(req))));
gestaoRouter.post("/financeiro/contratos/:id/cancelar", rota((req) => { const r = cancelarContrato(id(req)); auditAccess("financeiro_contrato_cancelado", usuario(req).id, null, { contrato: id(req) }); return r; }));

// ---------- negócio do cliente e captação ----------
const opcoesDoNegocio = () => ({ fontes: lerFontes(), motivos: MOTIVOS, areas: AREAS, qualificacoes: QUALIFICACOES, fontes_padrao: FONTES_PADRAO.map((f) => f.chave) });
gestaoRouter.get("/pessoas/:id/negocio", rota((req) => ({ negocio: obterNegocio(id(req)), ...opcoesDoNegocio() })));
gestaoRouter.put("/pessoas/:id/negocio", rota((req) => {
  const n = salvarNegocio(id(req), req.body || {}, usuario(req).id);
  auditAccess("negocio_do_cliente_salvo", usuario(req).id, null, { pessoa: id(req), qualificacao: n.qualificacao });
  return { negocio: n, ...opcoesDoNegocio() };
}));
gestaoRouter.get("/fontes", rota(() => opcoesDoNegocio()));
gestaoRouter.put("/fontes", rota((req) => { const r = salvarFontesExtras(Array.isArray(req.body?.extras) ? req.body.extras : []); auditAccess("fontes_de_captacao_salvas", usuario(req).id, null, { total: r.length }); return { ...opcoesDoNegocio(), fontes: r }; }));
gestaoRouter.get("/captacao", rota((req) => captacao(req.query.ano, req.query.mes)));
gestaoRouter.get("/captacao/pendentes", rota(() => ({ itens: pendentesDePreenchimento(), ...opcoesDoNegocio() })));

// ---------- indicadores ----------
gestaoRouter.get("/dashboard", rota((req) => dashboardDoInicio(req.query.mes, hasPermission(usuario(req), "financeiro.view") && recursoLiberadoNaLicenca("modulo_financeiro"))));
/** Contratos do ZapSign registrados neste escritório (para conferir o quadro do Início e remover os de teste). */
gestaoRouter.get("/contratos-zapsign", rota(() => ({
  itens: (() => { try { return db.prepare(`SELECT c.id, c.status, c.criado_em, c.assinado_em, c.pessoa_id, p.nome FROM zapsign_contratos c LEFT JOIN gestao_pessoas p ON p.id=c.pessoa_id ORDER BY c.id DESC LIMIT 300`).all(); } catch { return []; } })(),
})));
gestaoRouter.delete("/contratos-zapsign/:id", rota((req) => {
  if (!hasPermission(usuario(req), "gestao.manage")) throw new ErroGestao("Você não tem permissão para remover contratos.", 403);
  const r = db.prepare("DELETE FROM zapsign_contratos WHERE id=?").run(Number(req.params.id));
  if (!r.changes) throw new ErroGestao("Contrato não encontrado.", 404);
  return { ok: true };
}));
gestaoRouter.get("/indicadores", rota((req) => indicadores(req.query.mes, hasPermission(usuario(req), "financeiro.view") && recursoLiberadoNaLicenca("modulo_financeiro"))));

// ---------- CEP, campos personalizados e ficha de cadastro ----------
gestaoRouter.get("/cep/:cep", rota(async (req) => consultarCep(String(req.params.cep))));
gestaoRouter.get("/campos", rota((req) => ({ tipos: TIPOS_CAMPO, campos: listarCampos(String(req.query.entidade ?? "pessoa"), req.query.inativos === "1") })));
gestaoRouter.post("/campos/previdenciarios", rota((req) => { const r = adicionarCamposPrevidenciarios(); auditAccess("gestao_campos_previdenciarios", usuario(req).id, null, r); return r; }));
gestaoRouter.post("/campos", rota((req, res) => { const c = criarCampo(req.body || {}); res.status(201); auditAccess("gestao_campo_criado", usuario(req).id, null, { campo: c.id, nome: c.nome, tipo: c.tipo }); return c; }));
gestaoRouter.put("/campos/:id", rota((req) => atualizarCampo(id(req), req.body || {})));
gestaoRouter.delete("/campos/:id", rota((req) => { const r = excluirCampo(id(req)); auditAccess("gestao_campo_excluido", usuario(req).id, null, { campo: id(req) }); return r; }));
/** Mostrar uma senha guardada é um pedido à parte e fica registrado na auditoria. */
gestaoRouter.post("/campos/:campoId/revelar/:entidadeId", rota((req) => {
  const senha = revelarSenha(id(req, "campoId"), id(req, "entidadeId"));
  auditAccess("gestao_senha_revelada", usuario(req).id, null, { campo: id(req, "campoId"), cadastro: id(req, "entidadeId") });
  return { valor: senha };
}));
gestaoRouter.get("/pessoas/:id/ficha", (req, res, next) => {
  try {
    const comSenhas = req.query.senhas === "1";
    const doc = req.query.formato === "doc";
    const u = usuario(req);
    if (comSenhas && !hasPermission(u, "gestao.manage")) return void res.status(403).type("text").send("Você não tem permissão para imprimir senhas.");
    const html = fichaDeCadastroHtml(id(req), { comSenhas, imprimir: !doc && req.query.imprimir !== "0", emitidaPor: nomeDe(u) });
    if (comSenhas) auditAccess("gestao_ficha_impressa_com_senhas", u.id, null, { pessoa: id(req) });
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
    res.setHeader("Cache-Control", "private, no-store");
    if (doc) { // arquivo para abrir e editar no Word
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`Ficha de cadastro ${id(req)}.doc`)}`);
      return void res.type("application/msword").send(html);
    }
    res.type("html").send(html);
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).type("text").send(e.message);
    next(e);
  }
});

// ---------- modelo da ficha (cabeçalho, seções, logotipo) e foto do cliente ----------
const servirImagem = (img: { arquivo: string; mime: string } | null, res: Response) => {
  if (!img) return void res.status(404).end();
  res.set({ "Content-Type": img.mime, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, no-cache" });
  res.sendFile(img.arquivo);
};
gestaoRouter.get("/ficha/config", rota(() => ({ config: lerConfig(), padrao: FICHA_PADRAO, tem_logo: Boolean(logoAtual()), tem_cabecalho: Boolean(imagemAtual("cabecalho")), rotulo_secao: ROTULO_SECAO })));
gestaoRouter.put("/ficha/config", rota((req) => { const c = salvarConfig(req.body || {}); auditAccess("gestao_ficha_modelo_alterado", usuario(req).id, null); return { config: c, tem_logo: Boolean(logoAtual()) }; }));
gestaoRouter.get("/ficha/previa", (req, res, next) => {
  try {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(fichaDeExemplo(lerConfig(), nomeDe(usuario(req))));
  } catch (e) { next(e); }
});
gestaoRouter.get("/ficha/logo", (_req, res) => servirImagem(logoAtual(), res));
gestaoRouter.post("/ficha/logo", express.raw({ type: () => true, limit: 1024 * 1024 + 1024 }), rota((req) => { salvarLogo(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)); return { ok: true }; }));
gestaoRouter.delete("/ficha/logo", rota(() => { apagarLogo(); return { ok: true }; }));
gestaoRouter.get("/pessoas/:id/foto", rota((req, res) => servirImagem(fotoDaPessoa(id(req)), res)));
gestaoRouter.post("/pessoas/:id/foto", express.raw({ type: () => true, limit: 2 * 1024 * 1024 + 1024 }), rota((req) => { salvarFoto(id(req), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)); return { ok: true }; }));
gestaoRouter.delete("/pessoas/:id/foto", rota((req) => { apagarFoto(id(req)); return { ok: true }; }));

// ---------- dados do escritório e kit de documentos (procuração, contrato…) ----------
const imagensDoEscritorio = () => ({ tem_logo: Boolean(logoAtual()), tem_cabecalho: Boolean(imagemAtual("cabecalho")), tem_rodape: Boolean(imagemAtual("rodape")), tem_favicon: Boolean(imagemAtual("favicon")) });
gestaoRouter.get("/escritorio", rota(() => ({ escritorio: lerEscritorio(), ...imagensDoEscritorio() })));
// cabeçalho e rodapé dos documentos, e ícone do sistema (favicon); o logotipo da ficha segue em /ficha/logo
gestaoRouter.get("/imagens/:nome", (req, res) => { const n = String(req.params.nome); if (!nomeDeImagemValido(n)) return void res.status(404).end(); servirImagem(imagemAtual(n), res); });
gestaoRouter.post("/imagens/:nome", express.raw({ type: () => true, limit: 2 * 1024 * 1024 + 1024 }), rota((req) => {
  const n = String(req.params.nome); if (!nomeDeImagemValido(n)) throw new ErroGestao("Imagem desconhecida.", 404);
  salvarImagem(n, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)); auditAccess("gestao_imagem_escritorio_alterada", usuario(req).id, null, { imagem: n }); return { ok: true, ...imagensDoEscritorio() };
}));
gestaoRouter.delete("/imagens/:nome", rota((req) => { const n = String(req.params.nome); if (!nomeDeImagemValido(n)) throw new ErroGestao("Imagem desconhecida.", 404); apagarImagem(n); return { ok: true, ...imagensDoEscritorio() }; }));
gestaoRouter.put("/escritorio", rota((req) => { const e = salvarEscritorio(req.body || {}); auditAccess("gestao_escritorio_alterado", usuario(req).id, null); return { escritorio: e, ...imagensDoEscritorio() }; }));
/** A configuração dos documentos sem o conteúdo das figuras (só tipo e tamanho), para a tela não carregar megabytes. */
const metaImagens = <T extends { imagens?: { mime: string; b64: string }[] }>(p: T) => ({ ...p, imagens: (p.imagens ?? []).map((i) => ({ mime: i.mime, bytes: Math.round((i.b64.length * 3) / 4) })) });
const semImagens = <C extends { proprios: { imagens?: { mime: string; b64: string }[] }[]; documento?: { imagens?: { mime: string; b64: string }[] } }>(c: C) => ({ ...c, proprios: c.proprios.map(metaImagens), ...(c.documento ? { documento: metaImagens(c.documento) } : {}) });
const configSemImagens = () => semImagens(lerConfigDocumentos());
// ---------- Atendimento com IA (cadastro do agente do Deskcomm) ----------
const atendimentoIaCompleto = () => { const c = lerAtendimentoIa(); return { ...c, pendencias: pendenciasDoAtendimentoIa(c), prompt: montarPromptDoAgente(c), areas_prontas: AREAS_PRONTAS }; };
gestaoRouter.get("/atendimento-ia", rota(() => atendimentoIaCompleto()));
gestaoRouter.put("/atendimento-ia", rota((req) => { salvarAtendimentoIa(req.body || {}); auditAccess("gestao_atendimento_ia_alterado", usuario(req).id, null); return atendimentoIaCompleto(); }));
gestaoRouter.get("/documentos/config", rota(() => ({
  ...configSemImagens(), padroes: TEXTOS_PADRAO, variaveis: [...VARIAVEIS_DOCUMENTO, ...lerConfigDocumentos().campos.map((c) => `campo.${c.id}`)], variantes: VARIANTES.map((v) => ({ id: v, nome: ROTULO_VARIANTE[v] })),
  documentos: [...DOCS.map((d) => ({ id: d.id, nome: d.nome, proprio: false })), ...lerConfigDocumentos().proprios.map((p) => ({ id: p.id, nome: p.nome, proprio: true }))], escritorio_completo: Boolean(lerEscritorio().advogados.length && (lerEscritorio().nome || lerEscritorio().razao_social)),
})));
gestaoRouter.put("/documentos/config", rota((req) => { const c = salvarConfigDocumentos(req.body || {}); auditAccess("gestao_documentos_modelo_alterado", usuario(req).id, null); return semImagens(c); }));
gestaoRouter.post("/documentos/proprios/importar", express.raw({ type: () => true, limit: 5 * 1024 * 1024 }), rota((req) => {
  if (!hasPermission(usuario(req), "gestao.manage")) throw new ErroGestao("Você não tem permissão para criar documentos.", 403);
  const m = docxParaModelo(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), String(req.headers["x-nome-arquivo"] ? decodeURIComponent(String(req.headers["x-nome-arquivo"])) : ""));
  auditAccess("gestao_documento_importado", usuario(req).id, null);
  return m;
}));
gestaoRouter.post("/documentos/proprios", rota((req, res) => { const r = criarDocumentoProprio(req.body || {}); res.status(201); auditAccess("gestao_documento_proprio_criado", usuario(req).id, null, { documento: r.documento.id }); return semImagens(r); }));
gestaoRouter.put("/documentos/proprios/:docId", rota((req) => semImagens(atualizarDocumentoProprio(String(req.params.docId), req.body || {}))));
gestaoRouter.delete("/documentos/proprios/:docId", rota((req) => { const r = excluirDocumentoProprio(String(req.params.docId)); auditAccess("gestao_documento_proprio_excluido", usuario(req).id, null, { documento: String(req.params.docId) }); return semImagens(r); }));
gestaoRouter.post("/documentos/config/restaurar", rota((req) => semImagens(restaurarTexto(String(req.body?.documento ?? ""), String(req.body?.variante ?? "")))));
const CSP_DOC = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:";
const texto = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const qual = (v: unknown) => { const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>; return { nome: texto(o.nome, 120), nacionalidade: texto(o.nacionalidade, 30), estado_civil: texto(o.estado_civil, 30), profissao: texto(o.profissao, 60), rg: texto(o.rg, 30), cpf: texto(o.cpf, 25), endereco: texto(o.endereco, 250), qualidade: texto(o.qualidade, 40) }; };
function opcoesDoKit(b: Record<string, unknown>): OpcoesKit {
  const h = (b.honorarios && typeof b.honorarios === "object" ? b.honorarios : {}) as Record<string, unknown>;
  return {
    pessoaId: Number(b.pessoa_id) || undefined, processoId: Number(b.processo_id) || undefined, variante: String(b.variante ?? "comum") as OpcoesKit["variante"],
    documentos: Array.isArray(b.documentos) ? b.documentos.map(String) : [], data: b.data === "branco" ? "branco" : "hoje",
    honorarios: { beneficios: h.beneficios === undefined || h.beneficios === "" ? undefined : Number(h.beneficios), percentual: h.percentual === undefined || h.percentual === "" ? undefined : Number(h.percentual), parcela: h.parcela === undefined || h.parcela === "" ? undefined : Number(h.parcela) },
    representante: qual(b.representante), a_rogo: qual(b.a_rogo),
    campos: b.campos && typeof b.campos === "object" && !Array.isArray(b.campos) ? Object.fromEntries(Object.entries(b.campos as Record<string, unknown>).slice(0, 40).map(([k, x]) => [k.slice(0, 40), texto(x, 200)])) : undefined,
    modelo_honorarios: b.modelo_honorarios ? texto(b.modelo_honorarios, 20) : undefined,
    testemunhas_rogo: Array.isArray(b.testemunhas_rogo) ? b.testemunhas_rogo.slice(0, 2).map((t) => ({ nome: texto((t as Record<string, unknown>)?.nome, 120), cpf: texto((t as Record<string, unknown>)?.cpf, 25) })) : undefined,
  };
}
/** Os dados do kit (inclusive CPF de terceiros) ficam no servidor por poucos minutos; a janela de impressão só leva um código. */
const kitsPreparados = new Map<string, { userId: number; opcoes: OpcoesKit; expira: number }>();
gestaoRouter.post("/documentos/preparar", rota((req) => {
  const u = usuario(req);
  const opcoes = opcoesDoKit(req.body || {});
  const kit = montarKit(opcoes, nomeDe(u)); // valida tudo agora (cliente, tipo, quem assina)
  const agora = Date.now();
  for (const [k, v] of kitsPreparados) if (v.expira < agora) kitsPreparados.delete(k);
  const token = crypto.randomBytes(18).toString("base64url");
  kitsPreparados.set(token, { userId: u.id, opcoes, expira: agora + 10 * 60_000 });
  auditAccess("gestao_documentos_gerados", u.id, null, { pessoa: opcoes.pessoaId ?? null, processo: opcoes.processoId ?? null, variante: opcoes.variante, documentos: kit.documentos.map((d) => d.id) });
  return { token, faltando: kit.faltando, documentos: kit.documentos.map((d) => d.nome) };
}));
gestaoRouter.get("/documentos/kit/:token", (req, res, next) => {
  try {
    const u = usuario(req);
    const k = kitsPreparados.get(String(req.params.token));
    if (!k || k.userId !== u.id || k.expira < Date.now()) return void res.status(404).type("text").send("Este documento expirou. Gere novamente.");
    const kit = montarKit(k.opcoes, nomeDe(u));
    res.setHeader("Cache-Control", "private, no-store");
    if (req.query.formato === "docx") {
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`Documentos - ${kit.documentos.length === 1 ? kit.documentos[0].nome : "kit do cliente"}.docx`)}`);
      return void res.type("application/vnd.openxmlformats-officedocument.wordprocessingml.document").send(kitDocx(kit));
    }
    res.setHeader("Content-Security-Policy", CSP_DOC);
    res.type("html").send(kitHtml(kit, { imprimir: req.query.imprimir === "1" }));
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).type("text").send(e.message);
    next(e);
  }
});
gestaoRouter.get("/documentos/previa", (req, res, next) => {
  try {
    const variante = VARIANTES.includes(String(req.query.variante) as never) ? String(req.query.variante) : "comum";
    const doc = DOCS.some((d) => d.id === req.query.doc) || lerConfigDocumentos().proprios.some((p) => p.id === req.query.doc) ? String(req.query.doc) : "procuracao";
    const ex = { nome: "NOME DA PESSOA QUE ASSINA", nacionalidade: "brasileiro(a)", estado_civil: "casado(a)", profissao: "", rg: "00.000.000-0", cpf: "000.000.000-00", endereco: "Rua do Exemplo, 100, Bairro, Cidade/UF", qualidade: "mãe" };
    const kit = montarKit({ variante: variante as OpcoesKit["variante"], documentos: [doc], data: "hoje", representante: ex, a_rogo: ex }, nomeDe(usuario(req)), true);
    res.setHeader("Content-Security-Policy", CSP_DOC); res.setHeader("Cache-Control", "private, no-store");
    res.type("html").send(kitHtml(kit, { zoom: 0.62 }));
  } catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).type("text").send(e.message);
    next(e);
  }
});

// ---------- integração com DJEN/perícias e financeiro do cadastro ----------
/** Acompanhamento automático (DJEN por número): situação na ficha e "consultar agora". */
gestaoRouter.get("/processos/:id/acompanhamento", rota((req) => { const r = situacaoDoAcompanhamento(id(req)); if (!r) throw new ErroGestao("Processo não encontrado.", 404); return r; }));
gestaoRouter.post("/processos/:id/acompanhamento", rota((req) => {
  const r = situacaoDoAcompanhamento(id(req));
  if (!r) throw new ErroGestao("Processo não encontrado.", 404);
  if (!r.acompanhavel) throw new ErroGestao(r.motivo, 422);
  const ficha = obterProcesso(id(req)) as { chave?: string; numero: string };
  const chave = /^\d{20}$/.test(String(ficha.chave)) ? String(ficha.chave) : String(ficha.numero).replace(/\D/g, "");
  forcarConsulta(chave); kickDoHistorico(); void completarComDataJud(chave, true);
  return situacaoDoAcompanhamento(id(req));
}));
/** Chave pública do DataJud (CNJ): quem gerencia integrações cola aqui; completa assunto, ajuizamento, órgão e classe dos processos. */
gestaoRouter.get("/datajud", rota((req) => { if (!hasPermission(usuario(req), "integrations.manage")) throw new ErroGestao("Sem permissão.", 403); const c = chaveDoDataJud(); return { configurado: Boolean(c), final: mascararChave(c) }; }));
gestaoRouter.put("/datajud", rota((req) => {
  if (!hasPermission(usuario(req), "integrations.manage")) throw new ErroGestao("Sem permissão.", 403);
  try { salvarChaveDoDataJud(req.body?.chave); } catch (e) { if (e instanceof ErroDataJud) throw new ErroGestao(e.message, e.status); throw e; }
  auditAccess("datajud_chave_salva", usuario(req).id, null, {});
  const c = chaveDoDataJud(); return { configurado: Boolean(c), final: mascararChave(c) };
}));
/** Testa a chave com um processo ativo já cadastrado (consulta de verdade). */
gestaoRouter.post("/datajud/testar", rota(async (req) => {
  if (!hasPermission(usuario(req), "integrations.manage")) throw new ErroGestao("Sem permissão.", 403);
  if (!chaveDoDataJud()) throw new ErroGestao("Cole a chave do DataJud primeiro.", 422);
  const p = db.prepare("SELECT chave FROM gestao_processos WHERE status='ativo' AND length(chave)=20 AND chave NOT GLOB '*[^0-9]*' ORDER BY id DESC LIMIT 1").get() as { chave: string } | undefined;
  if (!p) throw new ErroGestao("Cadastre ao menos um processo com número CNJ para testar a chave.", 422);
  const r = await atualizarDoDataJud(p.chave);
  const linha = db.prepare("SELECT erro FROM gestao_datajud WHERE processo_chave=?").get(p.chave) as { erro: string | null } | undefined;
  return { resultado: r, erro: r === "falha" ? linha?.erro ?? null : null };
}));
gestaoRouter.get("/processos/:id/andamento", rota((req) => andamentoDoProcesso(id(req))));
gestaoRouter.get("/pessoas/:id/agenda", rota((req) => agendaDaPessoa(id(req))));
gestaoRouter.get("/financeiro/pessoas/:id", rota((req) => financeiroDaPessoa(id(req))));
