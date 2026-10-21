import { iniciarMonitorCalendarios, pararMonitorCalendarios, enfileirarCalendarios } from "./officialCalendars/service";
import { db } from "../../db";
import { emitEvent } from "../../websocket";
import {
  iniciarMonitorCodex,
  pararMonitorCodex,
  processarFilaCodex,
} from "./codexAnalysis";
import {
  consultarDjen,
  DjenApiError,
  dataValida,
  hojeDjen,
  somarDias,
  type AdvogadoDjen,
  type ContextoConsulta,
} from "./api";
import {
  configuracaoDjen,
  listarAdvogados,
  importarPublicacoes,
  DjenInputError,
} from "./store";

let atual: { id: number; controller: AbortController } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let proximaExecucao = 0;
export function statusBuscas() {
  return {
    executando: atual?.id || null,
    proxima_execucao: proximaExecucao
      ? new Date(proximaExecucao).toISOString()
      : null,
    ultimas: db
      .prepare("SELECT * FROM djen_buscas ORDER BY id DESC LIMIT 5")
      .all(),
  };
}
export function validarPeriodo(inicio: string, fim: string) {
  if (
    !dataValida(inicio) ||
    !dataValida(fim) ||
    inicio > fim ||
    fim > hojeDjen() ||
    Date.parse(fim) - Date.parse(inicio) > 30 * 86400000
  )
    throw new DjenInputError(
      "Escolha um período válido de até 31 dias, sem datas futuras.",
    );
}
export function iniciarBusca(
  inicio: string,
  fim: string,
  ids?: number[],
  origem: "manual" | "automatico" = "manual",
): number {
  validarPeriodo(inicio, fim);
  if (atual)
    throw new DjenInputError(
      "Já existe uma consulta ao DJEN em andamento. Aguarde a conclusão.",
    );
  const advogados = listarAdvogados().filter(
    (a) => a.ativo && (!ids || ids.includes(a.id)),
  );
  if (!advogados.length)
    throw new DjenInputError(
      "Cadastre e ative ao menos um advogado antes de buscar.",
    );
  const id = Number(
    db
      .prepare("INSERT INTO djen_buscas(origem,inicio,fim) VALUES (?,?,?)")
      .run(origem, inicio, fim).lastInsertRowid,
  );
  const controller = new AbortController();
  atual = { id, controller };
  emitEvent("djen:changed", {});
  void executarBusca(
    id,
    advogados,
    inicio,
    fim,
    origem,
    controller.signal,
  ).finally(() => {
    if (atual?.id === id) atual = null;
    emitEvent("djen:changed", {});
    void processarFilaCodex();
    enfileirarCalendarios();
  });
  return id;
}
async function executarBusca(
  id: number,
  advogados: AdvogadoDjen[],
  inicio: string,
  fim: string,
  origem: string,
  signal: AbortSignal,
) {
  let novas = 0,
    recebidas = 0;
  const erros: { advogado: string; erro: string }[] = [];
  const ctx: ContextoConsulta = { requests: 0, signal };
  try {
    for (const advogado of advogados) {
      const config = configuracaoDjen();
      const inicioAdv =
        origem === "automatico"
          ? advogado.cursor_data
            ? somarDias(advogado.cursor_data, -2)
            : somarDias(fim, -config.janela_inicial_dias + 1)
          : inicio;
      const fimAdv =
        origem === "automatico" &&
        Date.parse(fim) - Date.parse(inicioAdv) > 30 * 86400000
          ? somarDias(inicioAdv, 30)
          : fim;
      try {
        const modos: ("nome" | "oab")[] =
          advogado.modo_busca === "ambos"
            ? ["oab", "nome"]
            : [advogado.modo_busca];
        for (const modo of modos) {
          const numero = advogado.numero_oab,
            sufixo = /^(\d+)([A-Z])$/.exec(numero);
          const variantes =
            modo === "oab" && sufixo
              ? [
                  numero,
                  `${sufixo[1]}-${sufixo[2]}`,
                  `${sufixo[1]}/${sufixo[2]}`,
                ]
              : [numero];
          for (const numero_oab of variantes)
            await consultarDjen(
              { ...advogado, numero_oab },
              modo,
              inicioAdv,
              fimAdv,
              (items) => {
                recebidas += items.length;
                novas += importarPublicacoes(items, advogado, modo);
                db.prepare(
                  "UPDATE djen_buscas SET novas=?,recebidas=?,consultas=? WHERE id=?",
                ).run(novas, recebidas, ctx.requests, id);
                emitEvent("djen:changed", {});
              },
              ctx,
            );
        }
        db.prepare(
          "UPDATE djen_advogados SET ultimo_sucesso_em=CURRENT_TIMESTAMP,ultimo_erro=NULL,cursor_data=CASE WHEN ? THEN ? ELSE cursor_data END WHERE id=?",
        ).run(origem === "automatico" ? 1 : 0, fimAdv, advogado.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Falha na consulta.";
        erros.push({
          advogado: `${advogado.nome} · OAB ${advogado.uf_oab} ${advogado.numero_oab}`,
          erro: message,
        });
        db.prepare("UPDATE djen_advogados SET ultimo_erro=? WHERE id=?").run(
          message,
          advogado.id,
        );
        if (
          signal.aborted ||
          (error instanceof DjenApiError &&
            [403, 429].includes(error.status)) ||
          ctx.requests > 500
        ) {
          if (advogados.indexOf(advogado) < advogados.length - 1)
            erros.push({
              advogado: "Demais advogados",
              erro: "Consultas restantes não executadas após a interrupção. Tente novamente.",
            });
          break;
        }
      }
    }
    db.prepare(
      "UPDATE djen_buscas SET status=?,novas=?,recebidas=?,consultas=?,erros_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(
      erros.length ? (recebidas ? "parcial" : "falha") : "concluida",
      novas,
      recebidas,
      ctx.requests,
      JSON.stringify(erros),
      id,
    );
  } catch (error) {
    erros.push({
      advogado: "Execução",
      erro:
        error instanceof Error ? error.message : "Falha ao salvar a consulta.",
    });
    db.prepare(
      "UPDATE djen_buscas SET status='falha',erros_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(JSON.stringify(erros), id);
  }
}
export function iniciarMonitorDjen(): void {
  iniciarMonitorCodex();
  iniciarMonitorCalendarios();
  db.prepare(
    "UPDATE djen_buscas SET status='interrompida',finished_at=CURRENT_TIMESTAMP,erros_json=? WHERE status='executando'",
  ).run(
    JSON.stringify([
      {
        advogado: "Execução anterior",
        erro: "O servidor reiniciou durante a consulta. Execute novamente para completar a captura.",
      },
    ]),
  );
  db.prepare(
    "UPDATE djen_mensagens SET status='incerto',erro=?,finished_at=CURRENT_TIMESTAMP WHERE status='enviando'",
  ).run(
    "O servidor reiniciou durante o envio. Confira a conversa antes de tentar novamente.",
  );
  if (timer) return;
  const verificar = () => {
    const config = configuracaoDjen();
    if (!config.automatico) {
      proximaExecucao = 0;
      return;
    }
    if (atual || Date.now() < proximaExecucao) return;
    proximaExecucao = Date.now() + config.intervalo_minutos * 60000;
    if (!listarAdvogados().some((a) => a.ativo)) return;
    try {
      const fim = hojeDjen();
      iniciarBusca(
        somarDias(fim, -config.janela_inicial_dias + 1),
        fim,
        undefined,
        "automatico",
      );
    } catch (error) {
      console.error("[DJEN] Falha ao iniciar monitoramento:", error);
    }
  };
  timer = setInterval(verificar, 60000);
  timer.unref();
}
export function pararMonitorDjen(): void {
  pararMonitorCodex();
  pararMonitorCalendarios();
  if (timer) clearInterval(timer);
  timer = null;
  atual?.controller.abort();
}

export function excluirConsulta(id: number) {
  const busca = db.prepare("SELECT status FROM djen_buscas WHERE id=?").get(id) as {status:string}|undefined;
  if (!busca) throw new DjenInputError("Consulta não encontrada.");
  if (busca.status === "executando" || atual?.id === id) throw new DjenInputError("Aguarde a consulta terminar antes de excluir seu registro.");
  db.prepare("DELETE FROM djen_buscas WHERE id=?").run(id);
}
