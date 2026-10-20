import { Router } from "express";
import { db } from "../db";
import {
  configuracaoDjen,
  salvarConfiguracaoDjen,
  listarAdvogados,
  salvarAdvogado,
  listarPublicacoes,
  detalhesPublicacao,
  revisarPublicacao,
  salvarProcessoDaPublicacao,
  resumoDjen,
  DjenInputError,
} from "../services/djen/store";
import { iniciarBusca, statusBuscas } from "../services/djen/sync";
import { enviarMensagemDjen } from "../services/djen/messages";
import { emitEvent } from "../websocket";
export const djenRouter = Router();
const wrap =
  (
    fn: (
      req: import("express").Request,
      res: import("express").Response,
    ) => unknown,
  ): import("express").RequestHandler =>
  (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((error) => {
        if (error instanceof DjenInputError)
          res.status(400).json({ error: error.message });
        else next(error);
      });
  };
const id = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new DjenInputError("Identificador inválido.");
  return n;
};
const changed = () => emitEvent("djen:changed", {});
djenRouter.get(
  "/status",
  wrap((_req, res) =>
    res.json({
      ...statusBuscas(),
      resumo: resumoDjen(),
      config: configuracaoDjen(),
      advogados: listarAdvogados(),
    }),
  ),
);
djenRouter.put(
  "/config",
  wrap((req, res) => {
    const config = salvarConfiguracaoDjen(req.body);
    changed();
    res.json(config);
  }),
);
djenRouter.get(
  "/advogados",
  wrap((_req, res) => res.json(listarAdvogados())),
);
djenRouter.post(
  "/advogados",
  wrap((req, res) => {
    res.status(201).json(salvarAdvogado(req.body));
    changed();
  }),
);
djenRouter.put(
  "/advogados/:id",
  wrap((req, res) => {
    res.json(salvarAdvogado(req.body, id(req.params.id)));
    changed();
  }),
);
djenRouter.post(
  "/buscar",
  wrap((req, res) => {
    const { inicio, fim, advogado_ids } = req.body;
    if (
      typeof inicio !== "string" ||
      typeof fim !== "string" ||
      (advogado_ids !== undefined &&
        (!Array.isArray(advogado_ids) ||
          !advogado_ids.length ||
          advogado_ids.some(
            (n: unknown) => !Number.isInteger(n) || Number(n) <= 0,
          )))
    )
      throw new DjenInputError("Informe o período e os advogados válidos.");
    const busca_id = iniciarBusca(inicio, fim, advogado_ids);
    changed();
    res.status(202).json({ busca_id });
  }),
);
djenRouter.get(
  "/publicacoes",
  wrap((req, res) => {
    const filtro: Record<string, string> = {};
    for (const key of [
      "categoria",
      "resultado",
      "advogado_id",
      "situacao",
      "busca",
      "inicio",
      "fim",
      "pagina",
    ])
      if (typeof req.query[key] === "string")
        filtro[key] = req.query[key] as string;
    res.json(listarPublicacoes(filtro));
  }),
);
djenRouter.get(
  "/publicacoes/:id",
  wrap((req, res) => res.json(detalhesPublicacao(id(req.params.id)))),
);
djenRouter.put(
  "/publicacoes/:id/revisao",
  wrap((req, res) => {
    res.json(revisarPublicacao(id(req.params.id), req.body));
    changed();
  }),
);
djenRouter.put(
  "/publicacoes/:id/processo",
  wrap((req, res) => {
    res.json(salvarProcessoDaPublicacao(id(req.params.id), req.body));
    changed();
  }),
);
djenRouter.post(
  "/publicacoes/:id/lida",
  wrap((req, res) => {
    db.prepare("UPDATE djen_publicacoes SET lida=1 WHERE id=?").run(
      id(req.params.id),
    );
    changed();
    res.json({ ok: true });
  }),
);
djenRouter.post(
  "/publicacoes/:id/mensagem",
  wrap(async (req, res) => {
    const mensagem = await enviarMensagemDjen(id(req.params.id), req.body);
    changed();
    res.json({ mensagem });
  }),
);
