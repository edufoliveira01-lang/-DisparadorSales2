import express, { type Request, type Response, type Router } from "express";
import { assinarRequisicao, chaveSso } from "./assinatura";

export interface ConfigRotaAsaas {
  /** Segredo da ponte: dele sai a chave de cada escritório (a mesma da entrada direta). */
  segredoAtendimento: string;
  /** Porta da instância do escritório neste servidor, ou null se não houver. */
  porta: (slug: string) => number | null;
  http?: typeof fetch;
}

/**
 * Recebe o aviso de pagamento do Asaas (URL pública do painel: POST /asaas/<escritório>) e o entrega à instância do escritório,
 * assinando com a chave dele. O Asaas se identifica pelo token do aviso (header `asaas-access-token`), que a instância confere.
 */
export function criarRotaAsaas(cfg: ConfigRotaAsaas, agora: () => number = () => Math.floor(Date.now() / 1000)): Router {
  const r = express.Router();
  const http = cfg.http ?? fetch;
  r.use(express.raw({ type: () => true, limit: "256kb" }));
  r.post(/^\/([a-z0-9-]{2,42})$/, async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    try {
      const slug = String(req.params[0]);
      const porta = cfg.porta(slug);
      if (!porta) return void res.status(404).json({ error: "Escritório sem instância neste servidor." });
      const corpo = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      const destino = "/api/integracao/asaas";
      const ts = agora();
      const token = req.headers["asaas-access-token"];
      const resp = await http(`http://127.0.0.1:${porta}${destino}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json", "x-asaas-token": Array.isArray(token) ? token[0]! : token ?? "",
          "x-sales-timestamp": String(ts), "x-sales-signature": assinarRequisicao(chaveSso(cfg.segredoAtendimento, slug), { metodo: "POST", caminho: destino, corpo }, ts),
        },
        body: corpo, signal: AbortSignal.timeout(30_000),
      });
      res.status(resp.status).type("application/json").send((await resp.text()) || "{}");
    } catch (e) {
      console.error("[asaas] falha ao repassar o aviso:", e instanceof Error ? e.message : e);
      res.status(502).json({ error: "Não foi possível falar com o escritório." });
    }
  });
  return r;
}
