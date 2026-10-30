import { diagnosticoAcompanhamentos } from "../services/djen/followUpDiagnostics";
import { selectedAiConnection } from "../services/ai/connection";
import {
  statusCalendarios,
  enfileirarCalendarios,
  solicitarCalendario,
  calcularComCalendarioOficial,
} from "../services/djen/officialCalendars/service";
import {
  salvarConfigImportacao,
  salvarAjustes,
  lerCalendario,
} from "../services/djen/officialCalendars/store";
import {
  configPrazos,
  salvarConfigPrazos,
  sugestoesPrazos,
  identificarPrazos,
  concluirPublicacao,
} from "../services/djen/deadlines";
import { enviarPrazoAgenda } from "../services/djen/calendar";
import { registrarHistoricoDjen } from "../services/djen/history";
import { GoogleCalendarError } from "../services/googleCalendarService";
import {
  WorkflowInputError,
  salvarPrazo,
  excluirPrazo,
  adicionarDocumento,
  excluirDocumento,
} from "../services/djen/workflow";
import { Router } from "express";
import { db } from "../db";
import {
  configuracaoDjen,
  salvarConfiguracaoDjen,
  listarAdvogados,
  salvarAdvogado,
  listarPublicacoes,
  listarIdsPublicacoes,
  detalhesPublicacao,
  revisarPublicacao,
  salvarProcessoDaPublicacao,
  resumoDjen,
  DjenInputError,
  listarAndamentosDoProcesso,
} from "../services/djen/store";
import {
  iniciarBusca,
  statusBuscas,
  excluirConsulta,
} from "../services/djen/sync";
import { enviarMensagemDjen } from "../services/djen/messages";
import { emitEvent } from "../websocket";
import { verificarConexaoCodex } from "../services/djen/codexRunner";
import {
  statusAnalisesCodex,
  enfileirarAnaliseCodex,
  processarFilaCodex,
} from "../services/djen/codexAnalysis";
import {
  statusControlePericia,
  adicionarPublicacaoAoControle,
  listarPericiasSemLaudo,
  atualizarAcompanhamentoPericia,
} from "../services/djen/periciaIntegration";
import { listarAguardandoMovimentacao, atualizarAguardandoMovimentacao } from "../services/djen/followUp";
import { listarObrigacoesExternas, atualizarObrigacaoExterna } from "../services/djen/externalFollowUp";
import { concluirProcessosSelecionados } from "../services/djen/bulk";
import { criarExemploClassificacao, excluirExemploClassificacao, listarExemplosClassificacao } from "../services/djen/teaching";
import {
  listarKanban, criarListaKanban, alterarListaKanban, ordenarListasKanban,
  excluirListaKanban, moverCartaoKanban, ativarClassificacaoAutomatica, fixarEtapaManual,
  alterarInicioEsperaKanban, historicoCartaoKanban,
} from "../services/djen/kanban";
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
        if (
          error instanceof DjenInputError ||
          error instanceof WorkflowInputError ||
          error instanceof GoogleCalendarError
        )
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
const acompanhamentos = () => [
  ...listarAguardandoMovimentacao().map((item) => ({
    ...item, tipo: "aguardo_juizo", responsavel: "Juízo", prazo_citado_dias: null,
    dias_decorridos: item.dias_sem_publicacao,
  })),
  ...listarObrigacoesExternas(),
];
const filtroPublicacoes = (req: import("express").Request) => {
  const filtro: Record<string, string> = {};
  for (const key of ["arquivo", "categoria", "resultado", "advogado_id", "situacao", "busca", "inicio", "fim", "pagina"])
    if (typeof req.query[key] === "string") filtro[key] = req.query[key] as string;
    else if (Array.isArray(req.query[key]) && (req.query[key] as unknown[]).every((v) => typeof v === "string"))
      filtro[key] = (req.query[key] as string[]).join(",");
  return filtro;
};
djenRouter.get("/acompanhamentos/diagnostico", wrap((_req, res) => res.json(diagnosticoAcompanhamentos())));
djenRouter.get(
  "/status",
  wrap((_req, res) =>
    res.json({
      ...statusBuscas(),
      resumo: resumoDjen(),
      config: configuracaoDjen(),
      advogados: listarAdvogados(),
      pericias_sem_laudo: listarPericiasSemLaudo().length,
      aguardando_retorno: acompanhamentos().length,
      ia: statusAnalisesCodex(),
      codex: statusAnalisesCodex(), // Compatibilidade com abas da versão anterior.
    }),
  ),
);
djenRouter.get("/kanban", wrap((_req, res) => res.json(listarKanban())));
djenRouter.post("/kanban/listas", wrap((req, res) => { const lista = criarListaKanban(req.body || {}); changed(); res.json(lista); }));
djenRouter.put("/kanban/listas/ordem", wrap((req, res) => { const result = ordenarListasKanban(req.body?.ids); changed(); res.json(result); }));
djenRouter.put("/kanban/listas/:id", wrap((req, res) => { const result = alterarListaKanban(id(req.params.id), req.body || {}); changed(); res.json(result); }));
djenRouter.delete("/kanban/listas/:id", wrap((req, res) => { const result = excluirListaKanban(id(req.params.id)); changed(); res.json(result); }));
djenRouter.put("/kanban/cartoes/:processoChave", wrap((req, res) => {
  const result = moverCartaoKanban(req.params.processoChave, id(String(req.body?.lista_id)), req.body?.antes_de);
  changed(); res.json(result);
}));
djenRouter.put("/kanban/cartoes/:processoChave/automatico", wrap((req, res) => {
  const result = ativarClassificacaoAutomatica(req.params.processoChave);
  changed(); res.json(result);
}));
djenRouter.put("/kanban/cartoes/:processoChave/manual", wrap((req, res) => {
  const result = fixarEtapaManual(req.params.processoChave);
  changed(); res.json(result);
}));
djenRouter.put("/kanban/cartoes/:processoChave/inicio", wrap((req, res) => {
  const result = alterarInicioEsperaKanban(req.params.processoChave, req.body?.inicio_em);
  changed(); res.json(result);
}));
djenRouter.get("/kanban/cartoes/:processoChave/historico", wrap((req, res) => res.json(historicoCartaoKanban(req.params.processoChave))));
djenRouter.put(
  "/config",
  wrap((req, res) => {
    const config = salvarConfiguracaoDjen(req.body);
    changed();
    res.json(config);
    void processarFilaCodex();
  }),
);
djenRouter.get(
  ["/ia/conexao", "/codex/conexao"],
  wrap(async (_req, res) => res.json(await selectedAiConnection())),
);
const somenteAdministrador: import("express").RequestHandler = (req, res, next) => req.accessUser?.role === "administrador"
  ? next() : res.status(403).json({ error: "Somente o administrador pode gerenciar exemplos da IA." });
djenRouter.get(["/ia/exemplos", "/codex/exemplos"], somenteAdministrador, wrap((_req, res) => res.json(listarExemplosClassificacao())));
djenRouter.post(["/ia/exemplos", "/codex/exemplos"], somenteAdministrador, wrap((req, res) => {
  const exemplo = criarExemploClassificacao(req.body || {}, req.accessUser!.id);
  changed(); res.status(201).json(exemplo);
}));
djenRouter.delete(["/ia/exemplos/:id", "/codex/exemplos/:id"], somenteAdministrador, wrap((req, res) => {
  excluirExemploClassificacao(id(req.params.id)); changed(); res.json({ ok: true });
}));
djenRouter.post(
  ["/ia/reanalisar", "/codex/reanalisar"],
  wrap((_req, res) => res.status(202).json(enfileirarAnaliseCodex())),
);
djenRouter.post(
  ["/ia/retomar", "/codex/retomar"],
  wrap((_req, res) => {
    db.prepare("UPDATE djen_config SET ia_pausa=NULL WHERE id=1").run();
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL WHERE ia_status='erro' AND cancelada=0 AND revisada=0",
    ).run();
    void processarFilaCodex();
    changed();
    res.status(202).json({ ok: true });
  }),
);
djenRouter.post(
  "/publicacoes/:id/analise",
  wrap((req, res) =>
    res.status(202).json(enfileirarAnaliseCodex(id(req.params.id))),
  ),
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
    const lista = listarPublicacoes(filtroPublicacoes(req));
    res.json({
      ...lista,
      items: lista.items.map((publicacao) => ({
        ...publicacao,
        pericia_controle: publicacao.categorias.includes("pericia")
          ? statusControlePericia(publicacao.pericia_publicacao_id || publicacao.id)
          : null,
      })),
    });
  }),
);
djenRouter.get(
  "/publicacoes/ids",
  wrap((req, res) => res.json(listarIdsPublicacoes(filtroPublicacoes(req)))),
);
djenRouter.post(
  "/publicacoes/conclusao-em-lote",
  wrap((req, res) => {
    const resultado = concluirProcessosSelecionados(req.body?.ids);
    changed(); res.json(resultado);
  }),
);
djenRouter.get(
  "/publicacoes/:id",
  wrap((req, res) => {
    const publicacaoId = id(req.params.id);
    res.json({
      ...detalhesPublicacao(publicacaoId),
      pericia_controle: statusControlePericia(publicacaoId),
    });
  }),
);
djenRouter.post(
  "/publicacoes/:id/pericia-controle",
  wrap((req, res) => {
    const resultado = adicionarPublicacaoAoControle(id(req.params.id));
    changed();
    res.status(201).json(resultado);
  }),
);
djenRouter.get(
  "/pericias/sem-laudo",
  wrap((req, res) => {
    const dias =
      typeof req.query.dias === "string" ? Number(req.query.dias) : 60;
    res.json(listarPericiasSemLaudo(dias));
  }),
);
djenRouter.get(
  "/aguardando",
  wrap((_req, res) => res.json(acompanhamentos())),
);
djenRouter.put(
  "/aguardando/:id",
  wrap((req, res) => {
    const tipo = req.body?.tipo || "aguardo_juizo";
    res.json(tipo === "aguardo_juizo"
      ? atualizarAguardandoMovimentacao(id(req.params.id), req.body.status)
      : atualizarObrigacaoExterna(id(req.params.id), tipo, req.body.status));
    changed();
  }),
);
djenRouter.put(
  "/pericias/:id/acompanhamento",
  wrap((req, res) => {
    res.json(atualizarAcompanhamentoPericia(id(req.params.id), req.body));
    changed();
  }),
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

djenRouter.get(
  "/publicacoes/:id/andamentos",
  wrap((req, res) =>
    res.json(
      listarAndamentosDoProcesso(
        id(req.params.id),
        Number(req.query.pagina || 1),
      ),
    ),
  ),
);
djenRouter.post(
  "/publicacoes/:id/prazos",
  wrap((req, res) => {
    const n = id(req.params.id);
    const prazo_id = salvarPrazo(n, req.body);
    changed();
    res.status(201).json({ ...detalhesPublicacao(n), prazo_id });
  }),
);
djenRouter.put(
  "/publicacoes/:id/prazos/:prazoId",
  wrap((req, res) => {
    const n = id(req.params.id);
    salvarPrazo(n, req.body, id(req.params.prazoId));
    changed();
    res.json(detalhesPublicacao(n));
  }),
);
djenRouter.delete(
  "/publicacoes/:id/prazos/:prazoId",
  wrap((req, res) => {
    const n = id(req.params.id);
    excluirPrazo(n, id(req.params.prazoId));
    changed();
    res.json(detalhesPublicacao(n));
  }),
);
djenRouter.post(
  "/publicacoes/:id/documentos",
  wrap((req, res) => {
    const n = id(req.params.id);
    adicionarDocumento(n, req.body);
    changed();
    res.status(201).json(detalhesPublicacao(n));
  }),
);
djenRouter.delete(
  "/publicacoes/:id/documentos/:documentoId",
  wrap((req, res) => {
    const n = id(req.params.id);
    excluirDocumento(n, id(req.params.documentoId));
    changed();
    res.json(detalhesPublicacao(n));
  }),
);
djenRouter.get(
  "/publicacoes/:id/documento",
  wrap((req, res) => {
    const p = detalhesPublicacao(id(req.params.id));
    const esc = (s: unknown) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]!,
      );
    res
      .type("html")
      .set(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      )
      .set("X-Content-Type-Options", "nosniff")
      .send(
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Publicação DJEN — ${esc(p.processo)}</title><style>body{max-width:900px;margin:40px auto;padding:20px;font:16px/1.7 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}</style><h1>Publicação DJEN</h1><p>Processo: ${esc(p.processo)} · ${esc(p.tribunal)} · ${esc(p.data_disponibilizacao)}</p><p>${esc(p.orgao)} · ${esc(p.tipo_documento)}</p><pre>${esc(p.texto)}</pre><p>Texto capturado da publicação. Documentos dos autos devem ser consultados no tribunal.</p></html>`,
      );
  }),
);

djenRouter.get(
  "/calendarios",
  wrap((_req, res) => res.json(statusCalendarios())),
);
djenRouter.put(
  "/calendarios/config",
  wrap((req, res) => {
    const config = salvarConfigImportacao(req.body);
    enfileirarCalendarios();
    changed();
    res.json(config);
  }),
);
djenRouter.post(
  "/calendarios/sincronizar",
  wrap((req, res) => {
    const escopos = req.body?.tribunal
      ? [
          {
            tribunal: req.body.tribunal,
            orgao: req.body.orgao,
            ano: req.body.ano,
          },
        ]
      : undefined;
    res.status(202).json(enfileirarCalendarios(escopos, true));
  }),
);
djenRouter.put(
  "/calendarios/:chave/ajustes",
  wrap((req, res) => {
    res.json(salvarAjustes(req.params.chave, req.body));
    changed();
  }),
);
djenRouter.get(
  "/calendarios/:chave/historico",
  wrap((req, res) => {
    if (!lerCalendario(req.params.chave))
      throw new WorkflowInputError("Calendário não encontrado.");
    res.json(
      db
        .prepare(
          "SELECT id,tipo,descricao,created_at FROM djen_calendario_historico WHERE chave=? ORDER BY id DESC LIMIT 20",
        )
        .all(req.params.chave),
    );
  }),
);
djenRouter.get(
  "/prazos/config",
  wrap((_req, res) => res.json(configPrazos())),
);
djenRouter.put(
  "/prazos/config",
  wrap((req, res) => {
    res.json(salvarConfigPrazos(req.body));
    changed();
  }),
);
djenRouter.delete(
  "/buscas/:id",
  wrap((req, res) => {
    excluirConsulta(id(req.params.id));
    changed();
    res.json({ ok: true });
  }),
);
djenRouter.post(
  "/publicacoes/:id/conclusao",
  wrap((req, res) => {
    if (typeof req.body.concluida !== "boolean")
      throw new DjenInputError("Informe a conclusão.");
    const n = id(req.params.id);
    const processo = db
      .prepare("SELECT processo_chave FROM djen_publicacoes WHERE id=?")
      .get(n) as { processo_chave: string } | undefined;
    if (!processo) throw new DjenInputError("Publicação não encontrada.");
    const publicacoes = db
      .prepare("SELECT id FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0")
      .all(processo.processo_chave) as { id: number }[];
    for (const publicacao of publicacoes) {
      concluirPublicacao(publicacao.id, req.body.concluida);
      registrarHistoricoDjen(
        publicacao.id,
        "conclusao",
        req.body.concluida
          ? "Processo concluído pelo usuário; andamentos agrupados foram arquivados."
          : "Processo reaberto pelo usuário; andamentos agrupados voltaram à lista.",
      );
    }
    changed();
    res.json(detalhesPublicacao(n));
  }),
);
djenRouter.post(
  "/publicacoes/:id/leitura",
  wrap((req, res) => {
    if (typeof req.body.lida !== "boolean")
      throw new DjenInputError("Informe a leitura.");
    const n = id(req.params.id);
    const processo = db
      .prepare("SELECT processo_chave FROM djen_publicacoes WHERE id=?")
      .get(n) as { processo_chave: string } | undefined;
    if (!processo) throw new DjenInputError("Publicação não encontrada.");
    db.prepare("UPDATE djen_publicacoes SET lida=? WHERE processo_chave=? AND cancelada=0").run(
      req.body.lida ? 1 : 0,
      processo.processo_chave,
    );
    changed();
    res.json({ ok: true });
  }),
);
djenRouter.get(
  "/publicacoes/:id/prazos/sugestoes",
  wrap((req, res) =>
    res.json(
      (() => {
        const p = detalhesPublicacao(id(req.params.id));
        return {
          ...sugestoesPrazos({ ...p, texto: p.texto || "" }),
          calendario_automatico: solicitarCalendario(
            p.tribunal,
            p.orgao,
            Number(p.data_disponibilizacao.slice(0, 4)),
          ),
        };
      })(),
    ),
  ),
);
djenRouter.post(
  "/publicacoes/:id/prazos/calcular",
  wrap(async (req, res) => {
    const p = detalhesPublicacao(id(req.params.id));
    const candidatos = identificarPrazos(p.texto || "");
    if (candidatos.length && !candidatos.some((c) => c.dias === Number(req.body?.dias) && c.unidade === req.body?.unidade)
        && req.body?.divergencia_confirmada !== true)
      throw new DjenInputError("A quantidade de dias difere do prazo expresso nesta publicação. Confira o texto e confirme a alteração antes de calcular.");
    res.json(await calcularComCalendarioOficial(p.tribunal, p.orgao, req.body));
  }),
);
djenRouter.post(
  "/publicacoes/:id/prazos/:prazoId/agenda",
  wrap(async (req, res) => {
    res.json(
      await enviarPrazoAgenda(id(req.params.id), id(req.params.prazoId)),
    );
    changed();
  }),
);


