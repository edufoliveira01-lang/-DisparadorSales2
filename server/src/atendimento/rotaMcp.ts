import express, { type Request, type Response, type Router } from "express";
import { assinarRequisicao, chaveSso } from "./assinatura";
import { chaveConfere } from "./mcp/chave";

export interface ConfigRotaMcp {
  /** O mesmo segredo que o Deskcomm usa para contratos (CONTRATOS_SEGREDO): dele sai a chave do servidor de ferramentas de cada escritório. */
  segredoDeskcomm: string;
  /** Segredo da ponte: dele sai a chave com que o painel assina para a instância do escritório. */
  segredoAtendimento: string;
  porta: (slug: string) => number | null;
  http?: typeof fetch;
}

/**
 * O servidor de ferramentas do agente de IA, visto de fora: `POST /mcp/<slug>` com `Authorization: Bearer <chave do escritório>`.
 * O painel confere a chave, junta os cabeçalhos do contato que o Deskcomm monta (telefone, id, canal) ao JSON-RPC e repassa à instância do escritório,
 * assinado com a chave dela. A instância só aceita o que o painel assinou; o modelo nunca escolhe de quem são os dados.
 */
export function criarRotaMcp(cfg: ConfigRotaMcp, agora: () => number = () => Math.floor(Date.now() / 1000)): Router {
  const r = express.Router();
  const http = cfg.http ?? fetch;
  r.use(express.json({ limit: "256kb", type: () => true }));

  r.all(/^\/([a-z0-9-]{2,42})$/, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      const slug = req.path.slice(1);
      const auth = String(req.headers.authorization ?? "");
      if (!chaveConfere(cfg.segredoDeskcomm, slug, auth.startsWith("Bearer ") ? auth.slice(7) : undefined)) return void res.status(401).json({ error: "Chave inválida." });
      // Sem sessão e sem fluxo de servidor→cliente: só POST. (O cliente MCP aceita o 405 do GET e do DELETE.)
      if (req.method !== "POST") return void res.status(405).set("Allow", "POST").json({ error: "Método não permitido." });
      const porta = cfg.porta(slug);
      if (!porta) return void res.status(404).json({ error: "Escritório sem instância neste servidor." });
      const h = (n: string) => { const v = req.headers[n]; return String(Array.isArray(v) ? v[0] : v ?? ""); };
      const corpo = JSON.stringify({ contato: { telefone: h("x-deskcomm-contato-telefone").replace(/\D/g, "").slice(0, 20), id: h("x-deskcomm-contato-id").slice(0, 64), canal: h("x-deskcomm-canal").slice(0, 32) }, rpc: req.body });
      const destino = "/api/integracao/mcp";
      const ts = agora();
      const resp = await http(`http://127.0.0.1:${porta}${destino}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-sales-timestamp": String(ts), "x-sales-signature": assinarRequisicao(chaveSso(cfg.segredoAtendimento, slug), { metodo: "POST", caminho: destino, corpo }, ts) },
        body: corpo, signal: AbortSignal.timeout(20_000),
      });
      const texto = await resp.text();
      if (resp.status === 202 || !texto) return void res.status(resp.status === 202 ? 202 : resp.status).end();
      res.status(resp.status).type("application/json").send(texto);
    } catch (e) {
      console.error("[mcp] falha ao repassar:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "Não foi possível falar com o escritório." });
    }
  });
  return r;
}
