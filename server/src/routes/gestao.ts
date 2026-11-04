import fs from "node:fs";
import express, { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../db";
import { ErroGestao, atualizarPessoa, criarPessoa, excluirPessoa, importarContatos, listarPessoas, obterPessoa } from "../services/gestao/pessoas";
import {
  adicionarAnotacao, adicionarParte, atualizarProcesso, criarProcesso, excluirProcesso, importarDoDjen, linhaDoTempo, listarProcessos,
  obterProcesso, pendentesDeImportacao, removerAnotacao, removerParte, resumoGestao,
} from "../services/gestao/processos";
import { auditAccess } from "../services/accessService";
import { TAMANHO_MAXIMO, excluirArquivo, extensao, listarArquivos, obterArquivo, podeExibir, salvarArquivo, usoDeArmazenamento } from "../services/gestao/arquivos";
import { VARIAVEIS, excluirModelo, gerarDocumento, listarModelos, salvarModelo } from "../services/gestao/modelos";
import { atualizarTarefa, concluirTarefa, criarTarefa, excluirTarefa, listarTarefas, meuPainel, obterTarefa, sincronizarPrazosDjen } from "../services/gestao/tarefas";
import { atualizarLancamento, baixarLancamento, cancelarContrato, cancelarLancamento, criarContrato, criarLancamentos, estornarLancamento, excluirLancamento, fluxoDeCaixa, listarContratos, listarLancamentos, obterContrato, obterLancamento, resumoFinanceiro } from "../services/gestao/financeiro";
import { indicadores } from "../services/gestao/indicadores";
import { hasPermission } from "../services/accessService";
import { recursoLiberadoNaLicenca } from "../licenca/cliente";

/** Gestão do escritório: pessoas (clientes e outras partes), processos e pastas. Permissões: gestao.view / gestao.manage. */
export const gestaoRouter = Router();

// Módulos contratados no plano (SaaS): sem o módulo, a área inteira responde 403.
gestaoRouter.use((req, res, next) => {
  if (!recursoLiberadoNaLicenca("modulo_gestao")) return void res.status(403).json({ error: "O plano atual não inclui o módulo de gestão.", codigo: "modulo_nao_contratado" });
  if (req.path.startsWith("/financeiro") && !recursoLiberadoNaLicenca("modulo_financeiro")) return void res.status(403).json({ error: "O plano atual não inclui o módulo financeiro.", codigo: "modulo_nao_contratado" });
  next();
});

const rota = (fn: (req: Request, res: Response) => unknown): ((req: Request, res: Response, next: NextFunction) => void) => (req, res, next) => {
  try { const r = fn(req, res); if (r !== undefined && !res.headersSent) res.json(r); }
  catch (e) {
    if (e instanceof ErroGestao) return void res.status(e.status).json({ error: e.message });
    next(e);
  }
};
const id = (req: Request, nome = "id") => {
  const n = Number(req.params[nome]);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ErroGestao("Identificador inválido.", 400);
  return n;
};
const usuario = (req: Request) => req.accessUser!;
const nomeDe = (u: { display_name: string | null; username: string }) => u.display_name || u.username;

gestaoRouter.get("/resumo", rota(() => resumoGestao()));
gestaoRouter.get("/responsaveis", rota(() => db.prepare("SELECT id, COALESCE(NULLIF(display_name,''), username) AS nome FROM users WHERE active=1 ORDER BY nome COLLATE NOCASE").all()));

// ---------- pessoas ----------
gestaoRouter.get("/pessoas", rota((req) => listarPessoas({ busca: String(req.query.busca ?? ""), tipo: String(req.query.tipo ?? ""), ativo: String(req.query.ativo ?? ""), pagina: Number(req.query.pagina), limite: Number(req.query.limite) })));
gestaoRouter.post("/pessoas/importar-contatos", rota((req) => { const r = importarContatos(); auditAccess("gestao_contatos_importados", usuario(req).id, null, r); return r; }));
gestaoRouter.post("/pessoas", rota((req, res) => { const p = criarPessoa(req.body || {}); res.status(201); auditAccess("gestao_pessoa_criada", usuario(req).id, null, { pessoa: p.id }); return p; }));
gestaoRouter.get("/pessoas/:id", rota((req) => obterPessoa(id(req))));
gestaoRouter.put("/pessoas/:id", rota((req) => atualizarPessoa(id(req), req.body || {})));
gestaoRouter.delete("/pessoas/:id", rota((req) => { const r = excluirPessoa(id(req)); auditAccess("gestao_pessoa_excluida", usuario(req).id, null, { pessoa: id(req) }); return r; }));

// ---------- processos ----------
gestaoRouter.get("/processos", rota((req) => listarProcessos({
  busca: String(req.query.busca ?? ""), status: String(req.query.status ?? ""), responsavel: String(req.query.responsavel ?? ""), area: String(req.query.area ?? ""),
  pessoa: String(req.query.pessoa ?? ""), pagina: Number(req.query.pagina), limite: Number(req.query.limite),
})));
gestaoRouter.get("/processos/pendentes-importacao", rota(() => ({ pendentes: pendentesDeImportacao() })));
gestaoRouter.post("/processos/importar-djen", rota((req) => { const r = importarDoDjen(usuario(req).id); auditAccess("gestao_processos_importados", usuario(req).id, null, r); return r; }));
gestaoRouter.post("/processos", rota((req, res) => { const p = criarProcesso(req.body || {}, usuario(req).id); res.status(201); auditAccess("gestao_processo_criado", usuario(req).id, null, { processo: p.id, pasta: p.pasta }); return p; }));
gestaoRouter.get("/processos/:id", rota((req) => obterProcesso(id(req))));
gestaoRouter.put("/processos/:id", rota((req) => atualizarProcesso(id(req), req.body || {})));
gestaoRouter.delete("/processos/:id", rota((req) => { const r = excluirProcesso(id(req)); auditAccess("gestao_processo_excluido", usuario(req).id, null, { processo: id(req) }); return r; }));
gestaoRouter.get("/processos/:id/linha-do-tempo", rota((req) => linhaDoTempo(id(req))));
gestaoRouter.post("/processos/:id/partes", rota((req) => adicionarParte(id(req), req.body || {})));
gestaoRouter.delete("/processos/:id/partes/:pessoaId/:papel", rota((req) => removerParte(id(req), id(req, "pessoaId"), String(req.params.papel))));
gestaoRouter.post("/processos/:id/anotacoes", rota((req, res) => { const u = usuario(req); res.status(201); return adicionarAnotacao(id(req), req.body?.texto, { id: u.id, nome: nomeDe(u) }); }));
gestaoRouter.delete("/processos/:id/anotacoes/:anotacaoId", rota((req) => { const u = usuario(req); return removerAnotacao(id(req), id(req, "anotacaoId"), { id: u.id, admin: u.role === "administrador" }); }));

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
gestaoRouter.put("/financeiro/lancamentos/:id", rota((req) => atualizarLancamento(id(req), req.body || {})));
gestaoRouter.post("/financeiro/lancamentos/:id/baixar", rota((req) => { const r = baixarLancamento(id(req), req.body || {}); auditAccess("financeiro_baixa", usuario(req).id, null, { lancamento: r.id }); return r; }));
gestaoRouter.post("/financeiro/lancamentos/:id/estornar", rota((req) => { const r = estornarLancamento(id(req)); auditAccess("financeiro_estorno", usuario(req).id, null, { lancamento: r.id }); return r; }));
gestaoRouter.post("/financeiro/lancamentos/:id/cancelar", rota((req) => cancelarLancamento(id(req), req.body?.cancelar !== false)));
gestaoRouter.delete("/financeiro/lancamentos/:id", rota((req) => { const r = excluirLancamento(id(req)); auditAccess("financeiro_lancamento_excluido", usuario(req).id, null, { lancamento: id(req) }); return r; }));
gestaoRouter.get("/financeiro/contratos", rota((req) => listarContratos(q(req))));
gestaoRouter.post("/financeiro/contratos", rota((req, res) => { const r = criarContrato(req.body || {}, usuario(req).id); res.status(201); auditAccess("financeiro_contrato_criado", usuario(req).id, null, { contrato: r.id }); return r; }));
gestaoRouter.get("/financeiro/contratos/:id", rota((req) => obterContrato(id(req))));
gestaoRouter.post("/financeiro/contratos/:id/cancelar", rota((req) => { const r = cancelarContrato(id(req)); auditAccess("financeiro_contrato_cancelado", usuario(req).id, null, { contrato: id(req) }); return r; }));

// ---------- indicadores ----------
gestaoRouter.get("/indicadores", rota((req) => indicadores(req.query.mes, hasPermission(usuario(req), "financeiro.view") && recursoLiberadoNaLicenca("modulo_financeiro"))));
