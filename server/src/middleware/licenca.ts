import type { RequestHandler } from "express";
import { licenca } from "../licenca/cliente";

/** Com a licença restrita o sistema vira somente leitura: consulta e exportação continuam, alterações não. */
export const licencaSomenteLeitura: RequestHandler = (req, res, next) => {
  const estado = licenca().estado();
  if (!estado.restrito) return next();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const url = req.originalUrl.split("?")[0];
  if (url.startsWith("/api/auth/") || url.startsWith("/api/license/")) return next(); // entrar/sair e consultar a licença
  res.status(402).json({ error: estado.aviso || "Assinatura inativa: o sistema está em modo somente leitura.", codigo: "licenca_restrita" });
};
