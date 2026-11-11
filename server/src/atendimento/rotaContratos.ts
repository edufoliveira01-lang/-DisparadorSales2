import express, { type Request, type Response, type Router } from "express";
import { assinarRequisicao, chaveSso, verificarRequisicao } from "./assinatura";

export interface ConfigRotaContratos {
  /** Segredo compartilhado com o Deskcomm (CONTRATOS_SEGREDO) — só quem o tem pode pedir contratos. */
  segredoDeskcomm: string;
  /** Segredo da ponte: dele sai a chave de cada escritório (a mesma da entrada direta). */
  segredoAtendimento: string;
  /** Porta da instância do escritório neste servidor, ou null se não houver. */
  porta: (slug: string) => number | null;
  http?: typeof fetch;
}

/**
 * Repassa os pedidos de contrato do Deskcomm para a instância do escritório (que tem o cadastro, o kit de documentos e a chave do ZapSign).
 * O Deskcomm não conhece portas nem chaves de escritório: fala só com o painel, com UM segredo; o painel assina de novo, agora com a chave do escritório.
 */
export function criarRotaContratos(cfg: ConfigRotaContratos, agora: () => number = () => Math.floor(Date.now() / 1000)): Router {
  const r = express.Router();
  const http = cfg.http ?? fetch;
  r.use(express.raw({ type: () => true, limit: "128kb" }));

  r.all(/^\/v1\/offices\/([a-z0-9-]{2,42})\/(?:contratos(?:\/(?:\d{1,12}|opcoes))?|agente\/prompt|documentos)$/, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      const metodo = req.method.toUpperCase();
      const corpo = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      const h = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
      if (!verificarRequisicao(cfg.segredoDeskcomm, { metodo, caminho: req.path, corpo }, h("x-sales-timestamp"), h("x-sales-signature"), agora())) {
        return void res.status(401).json({ error: "Assinatura inválida." });
      }
      const agente = /^\/v1\/offices\/([a-z0-9-]+)\/agente\/prompt$/.exec(req.path);
      const documentos = /^\/v1\/offices\/([a-z0-9-]+)\/documentos$/.exec(req.path);
      const m = agente ?? documentos ?? /^\/v1\/offices\/([a-z0-9-]+)\/contratos(?:\/(\d+|opcoes))?$/.exec(req.path)!;
      const slug = m[1], id = agente || documentos ? undefined : m[2];
      if (agente ? metodo !== "GET" : documentos ? metodo !== "POST" : !((metodo === "POST" && !id) || (metodo === "GET" && id))) return void res.status(405).json({ error: "Método não permitido." });
      const porta = cfg.porta(slug);
      if (!porta) return void res.status(404).json({ error: "Escritório sem instância neste servidor." });

      const destino = agente ? "/api/integracao/agente/prompt" : documentos ? "/api/integracao/documentos" : `/api/integracao/contratos${id ? `/${id}` : ""}`;
      const ts = agora();
      const resp = await http(`http://127.0.0.1:${porta}${destino}`, {
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          "x-sales-timestamp": String(ts),
          "x-sales-signature": assinarRequisicao(chaveSso(cfg.segredoAtendimento, slug), { metodo, caminho: destino, corpo }, ts),
        },
        body: metodo === "POST" ? corpo : undefined,
        signal: AbortSignal.timeout(170_000), // converter os documentos em PDF leva alguns segundos
      });
      const texto = await resp.text();
      res.status(resp.status).type("application/json").send(texto || "{}");
    } catch (e) {
      console.error("[contratos] falha ao repassar:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "Não foi possível falar com o escritório. Tente de novo." });
    }
  });
  return r;
}
