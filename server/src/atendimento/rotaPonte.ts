import express, { type Request, type Response, type Router } from "express";
import { lerTokenSso, verificarRequisicao } from "./assinatura";
import type { BancoAtendimento } from "./banco";
import { ErroPonte, adicionarMembros, prepararEntrada, provisionarEmpresa, reativarEmpresa, revogarMembros, statusDaEmpresa, suspenderEmpresa, type ResultadoMembro } from "./ponteLocal";

/** Configuração da ponte embutida no painel (variáveis ATENDIMENTO_*). */
export interface ConfigPonteInterna { supabaseUrl: string; chaveServico: string; atorId: string; urlDeskcomm: string; segredo: string }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function pagina(res: Response, status: number, html: string) {
  // Sobrescreve a política do painel: aqui o formulário precisa enviar o navegador ao DeskcommCRM (outro endereço).
  res.status(status).set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action *", "Referrer-Policy": "no-referrer" });
  res.send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#222">${html}</body></html>`);
}

/**
 * Ponte entre o painel/sistema Sales e o DeskcommCRM, montada em `/ponte` do painel. Não altera o DeskcommCRM:
 * fala com o Supabase dele (funções SQL e API de usuários) usando a chave de serviço.
 */
export function criarRotaPonte(db: BancoAtendimento, cfg: ConfigPonteInterna, agora: () => number = () => Math.floor(Date.now() / 1000)): Router {
  const r = express.Router();
  const usados = new Map<string, number>(); // código de entrada já usado (uso único)
  r.use(express.raw({ type: () => true, limit: "64kb" }));
  r.get("/health", (_req, res) => { res.set("Cache-Control", "no-store").json({ ok: true }); });

  r.get("/sso", async (req: Request, res: Response) => {
    try {
      const t = lerTokenSso(cfg.segredo, String(req.query.t || ""), agora());
      for (const [k, exp] of usados) if (exp < agora()) usados.delete(k);
      if (!t || usados.has(t.jti)) return pagina(res, 400, "<p>Este link de entrada expirou. Volte ao sistema e clique em Atendimento de novo.</p>");
      usados.set(t.jti, t.exp);
      const e = await prepararEntrada(db, t.slug, t.email);
      if (e.org_status !== "active") return pagina(res, 403, "<p>O atendimento deste escritório está suspenso. Fale com o administrador do sistema.</p>");
      const destino = `${cfg.urlDeskcomm.replace(/\/$/, "")}/auth/confirm`;
      return pagina(res, 200, `<form id="f" method="post" action="${esc(destino)}"><input type="hidden" name="token_hash" value="${esc(e.token_hash)}"><input type="hidden" name="type" value="magiclink"><input type="hidden" name="next" value="/app"><p>Entrando no atendimento…</p><noscript><button type="submit">Continuar</button></noscript></form><script>document.getElementById('f').submit()</script>`);
    } catch (e) {
      if (e instanceof ErroPonte) return pagina(res, e.status, `<p>${esc(e.message)}</p>`);
      console.error("[ponte] erro inesperado:", e instanceof Error ? e.message : e);
      return pagina(res, 500, "<p>Erro interno. Tente novamente.</p>");
    }
  });

  r.all(/^\/v1\/.*/, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      const metodo = req.method.toUpperCase();
      const corpo = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      const h = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
      if (!verificarRequisicao(cfg.segredo, { metodo, caminho: req.path, corpo }, h("x-sales-timestamp"), h("x-sales-signature"), agora())) return res.status(401).json({ error: "Assinatura inválida." });
      let dados: Record<string, unknown> = {};
      if (corpo) { try { dados = JSON.parse(corpo) as Record<string, unknown>; } catch { return res.status(400).json({ error: "JSON inválido." }); } }
      const rota = req.path.split("/").filter(Boolean); // v1, offices, :slug, acao
      if (rota[1] !== "offices") return res.status(404).json({ error: "Não encontrado." });
      const ator = { atorId: cfg.atorId, urlPublica: cfg.urlDeskcomm };
      if (metodo === "POST" && rota.length === 2) return res.status(201).json(await provisionarEmpresa(db, ator, dados as never));
      const slug = rota[2] || "";
      if (metodo === "GET" && rota.length === 3) return res.json(await statusDaEmpresa(db, slug));
      if (metodo === "POST" && rota[3] === "suspend") return res.json(await suspenderEmpresa(db, ator, slug, String(dados.reason ?? "")));
      if (metodo === "POST" && rota[3] === "members") {
        const adicionar = Array.isArray(dados.members) && dados.members.length > 0, remover = Array.isArray(dados.remove) && dados.remove.length > 0;
        if (!adicionar && !remover) throw new ErroPonte("Informe pessoas para adicionar (members) ou remover (remove).", 400, "membros_invalidos");
        const saida: { slug: string; org_id?: string; resultados: ResultadoMembro[]; removidos: ResultadoMembro[] } = { slug, resultados: [], removidos: [] };
        if (adicionar) { const r = await adicionarMembros(db, ator, slug, dados.members as never); saida.org_id = r.org_id; saida.resultados = r.resultados; }
        if (remover) saida.removidos = (await revogarMembros(db, ator, slug, dados.remove as string[])).resultados; // depois de adicionar: nunca deixa a empresa sem administrador
        return res.json(saida);
      }
      if (metodo === "POST" && rota[3] === "reactivate") return res.json(await reativarEmpresa(db, ator, slug));
      return res.status(404).json({ error: "Não encontrado." });
    } catch (e) {
      if (e instanceof ErroPonte) return res.status(e.status).json({ error: e.message, codigo: e.codigo });
      console.error("[ponte] erro inesperado:", e instanceof Error ? e.message : e);
      return res.status(500).json({ error: "Erro interno." });
    }
  });
  return r;
}

/** Lê as variáveis ATENDIMENTO_* do painel; `null` quando a ponte embutida não está configurada. */
export function lerConfigPonteInterna(env: NodeJS.ProcessEnv = process.env): ConfigPonteInterna | null {
  const supabaseUrl = (env.ATENDIMENTO_SUPABASE_URL || "").trim(), chaveServico = (env.ATENDIMENTO_SUPABASE_CHAVE || "").trim();
  const atorId = (env.ATENDIMENTO_ATOR_ID || "").trim(), urlDeskcomm = (env.ATENDIMENTO_URL || "").trim().replace(/\/+$/, ""), segredo = (env.ATENDIMENTO_SEGREDO || "").trim();
  if (!supabaseUrl || !chaveServico || !atorId) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(atorId)) throw new Error("ATENDIMENTO_ATOR_ID deve ser o UUID do administrador da plataforma no DeskcommCRM.");
  if (!/^https:\/\//.test(urlDeskcomm)) throw new Error("ATENDIMENTO_URL deve ser o endereço https do DeskcommCRM.");
  if (segredo.length < 32) throw new Error("ATENDIMENTO_SEGREDO precisa ter pelo menos 32 caracteres.");
  return { supabaseUrl, chaveServico, atorId, urlDeskcomm, segredo };
}
