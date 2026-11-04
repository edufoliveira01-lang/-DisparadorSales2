import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../db";
import { ErroGestao, atualizarPessoa, criarPessoa, excluirPessoa, importarContatos, listarPessoas, obterPessoa } from "../services/gestao/pessoas";
import {
  adicionarAnotacao, adicionarParte, atualizarProcesso, criarProcesso, excluirProcesso, importarDoDjen, linhaDoTempo, listarProcessos,
  obterProcesso, pendentesDeImportacao, removerAnotacao, removerParte, resumoGestao,
} from "../services/gestao/processos";
import { auditAccess } from "../services/accessService";

/** Gestão do escritório: pessoas (clientes e outras partes), processos e pastas. Permissões: gestao.view / gestao.manage. */
export const gestaoRouter = Router();

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
