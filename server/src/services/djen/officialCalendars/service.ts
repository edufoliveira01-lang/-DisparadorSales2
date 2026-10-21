import { db } from "../../../db";
import { emitEvent } from "../../../websocket";
import {
  calcularPrazo,
  ErroCoberturaCalendario,
  type CalendarioForense,
} from "../deadlines";
import { WorkflowInputError } from "../workflow";
import { dataValida, hojeDjen } from "../api";
import {
  FonteCalendarioError,
  type EscopoCalendario,
  type LerFonteOficial,
} from "./types";
import { importarFonte, FONTES_SUPORTADAS } from "./providers";
import { norm, chaveEscopo, lerFonteOficial, limparCacheFontes } from "./utils";
import {
  configImportacao,
  criarRegistro,
  lerCalendario,
  listarCalendariosOficiais,
  registrarCalendario,
  calendarioParaCalculo,
  INTERVALO_CALENDARIOS_MS,
  validarEscopo,
} from "./store";
const jobs = new Map<string, Promise<ReturnType<typeof lerCalendario>>>();
const fila = new Map<string, { escopo: EscopoCalendario; forcar: boolean }>();
let timer: ReturnType<typeof setInterval> | null = null,
  primeiro: ReturnType<typeof setTimeout> | null = null,
  parado = false,
  rodando = false;
const mudou = () => emitEvent("djen:changed", {});
export async function sincronizarCalendario(
  e: EscopoCalendario,
  forcar = false,
  ler: LerFonteOficial = lerFonteOficial,
) {
  validarEscopo(e);
  const chave = criarRegistro(e);
  if (jobs.has(chave)) return jobs.get(chave)!;
  const salvo = lerCalendario(chave)!;
  if (
    !forcar &&
    salvo.proxima_tentativa > Date.now() &&
    salvo.status !== "atualizando"
  )
    return salvo;
  const cfg = configImportacao();
  if (!cfg.ativo && !forcar) return salvo;
  const local = cfg.localidades.find(
    (l) => l.tribunal === e.tribunal && norm(l.orgao) === norm(e.orgao),
  );
  const localAtual = () =>
    configImportacao().localidades.find(
      (l) => l.tribunal === e.tribunal && norm(l.orgao) === norm(e.orgao),
    );
  let localMudou = false;
  const job = (async () => {
    db.prepare(
      "UPDATE djen_calendarios_oficiais SET status='atualizando',consultado_em=? WHERE chave=?",
    ).run(new Date().toISOString(), chave);
    mudou();
    try {
      const r = await importarFonte(
          {
            ...e,
            ...(local
              ? {
                  municipio: local.municipio,
                  uf: local.uf,
                  instancia: local.instancia,
                }
              : {}),
          },
          ler,
        ),
        agora = new Date().toISOString();
      if (JSON.stringify(local) !== JSON.stringify(localAtual())) {
        localMudou = true;
        throw new FonteCalendarioError(
          "A localidade mudou durante a consulta. A importação será refeita.",
          "localidade_pendente",
        );
      }
      if (!r.eventos.length || !r.fontes.length)
        throw new FonteCalendarioError(
          "A fonte devolveu um calendário vazio. Nenhum calendário completo foi registrado.",
        );
      const old = JSON.stringify(salvo.eventos),
        json = JSON.stringify(r.eventos);
      db.transaction(() => {
        db.prepare(
          "UPDATE djen_calendarios_oficiais SET status=?,municipio=?,uf=?,eventos_json=?,fontes_json=?,avisos_json=?,erro=NULL,atualizado_em=?,proxima_tentativa=? WHERE chave=?",
        ).run(
          r.eventos.some((x) => x.tipo === "pendencia") ? "parcial" : "ok",
          r.municipio,
          r.uf || null,
          json,
          JSON.stringify(r.fontes),
          JSON.stringify(r.avisos),
          agora,
          Date.now() + INTERVALO_CALENDARIOS_MS,
          chave,
        );
        if (json !== old)
          registrarCalendario(
            chave,
            "importacao",
            "Calendário atualizado automaticamente a partir da fonte oficial.",
            { fontes: r.fontes, antes: salvo.eventos, depois: r.eventos },
          );
      })();
    } catch (error) {
      localMudou ||= JSON.stringify(local) !== JSON.stringify(localAtual());
      const err = localMudou
        ? new FonteCalendarioError(
            "A localidade mudou durante a consulta. A importação será refeita.",
            "localidade_pendente",
          )
        : error instanceof FonteCalendarioError
          ? error
          : new FonteCalendarioError(
              "Não foi possível importar o calendário oficial. Use a alternativa manual ou tente atualizar novamente.",
            );
      db.prepare(
        "UPDATE djen_calendarios_oficiais SET status=?,erro=?,proxima_tentativa=? WHERE chave=?",
      ).run(
        err.motivo,
        err.message,
        localMudou
          ? 0
          : Date.now() +
              (err.motivo === "erro" ? 15 * 60000 : INTERVALO_CALENDARIOS_MS),
        chave,
      );
      if (salvo.status !== err.motivo || salvo.erro !== err.message)
        registrarCalendario(chave, "falha", err.message);
    } finally {
      mudou();
    }
    return lerCalendario(chave);
  })();
  jobs.set(chave, job);
  try {
    return await job;
  } finally {
    jobs.delete(chave);
    if (localMudou && !parado) enfileirarCalendarios([e]);
  }
}
export function escoposUsados(): EscopoCalendario[] {
  return (
    db
      .prepare(
        "SELECT DISTINCT tribunal,orgao,CAST(substr(data_disponibilizacao,1,4) AS INTEGER) AS ano FROM djen_publicacoes WHERE cancelada=0 AND orgao<>'' AND data_disponibilizacao>=? ORDER BY data_disponibilizacao DESC LIMIT 500",
      )
      .all(`${Number(hojeDjen().slice(0, 4)) - 1}-01-01`) as EscopoCalendario[]
  ).filter(
    (e) =>
      e.ano >= 2000 &&
      e.ano <= 2100 &&
      e.orgao.trim().length > 0 &&
      e.orgao.length <= 300 &&
      /^[A-Z0-9-]{2,20}$/.test(e.tribunal),
  );
}
export function statusCalendarios() {
  return {
    config: configImportacao(),
    fontes: FONTES_SUPORTADAS,
    calendarios: listarCalendariosOficiais(),
    escopos: escoposUsados(),
    executando: jobs.size,
    na_fila: fila.size,
  };
}
export function enfileirarCalendarios(
  escopos: EscopoCalendario[] = [
    ...escoposUsados(),
    ...listarCalendariosOficiais().map(({ tribunal, orgao, ano }) => ({
      tribunal,
      orgao,
      ano,
    })),
  ],
  forcar = false,
) {
  if (forcar) limparCacheFontes();
  if (!configImportacao().ativo && !forcar) return { agendados: 0 };
  let agendados = 0;
  for (const e of escopos) {
    const chave = criarRegistro(e),
      c = lerCalendario(chave)!;
    if (
      jobs.has(chave) ||
      fila.has(chave) ||
      (!forcar && c.proxima_tentativa > Date.now())
    )
      continue;
    fila.set(chave, { escopo: e, forcar });
    if (forcar)
      db.prepare(
        "UPDATE djen_calendarios_oficiais SET proxima_tentativa=0 WHERE chave=?",
      ).run(chave);
    agendados++;
  }
  void consumirFila().catch((error) =>
    console.error("[DJEN] Falha na fila de calendários:", error),
  );
  return { agendados };
}
async function consumirFila() {
  if (rodando || parado) return;
  rodando = true;
  try {
    while (fila.size && !parado) {
      const [chave, item] = fila.entries().next().value!;
      fila.delete(chave);
      if (!configImportacao().ativo && !item.forcar) continue;
      await sincronizarCalendario(item.escopo, item.forcar);
    }
  } finally {
    rodando = false;
  }
}

export function iniciarMonitorCalendarios() {
  if (timer) return;
  parado = false;
  db.prepare(
    "UPDATE djen_calendarios_oficiais SET status='pendente',proxima_tentativa=0 WHERE status='atualizando'",
  ).run();
  const executar = () => {
    try {
      if (configImportacao().ativo) enfileirarCalendarios();
    } catch (error) {
      console.error("[DJEN] Falha no monitor de calendários:", error);
    }
  };
  primeiro = setTimeout(executar, 30000);
  primeiro.unref();
  timer = setInterval(executar, 60000);
  timer.unref();
}
export function pararMonitorCalendarios() {
  parado = true;
  if (timer) clearInterval(timer);
  if (primeiro) clearTimeout(primeiro);
  timer = null;
  primeiro = null;
  fila.clear();
}
export function solicitarCalendario(
  tribunal: string,
  orgao: string,
  ano: number,
) {
  const e = { tribunal, orgao, ano };
  validarEscopo(e);
  if (configImportacao().ativo) enfileirarCalendarios([e]);
  return lerCalendario(chaveEscopo(tribunal, orgao, ano)) || null;
}
export async function calcularComCalendarioOficial(
  tribunal: string,
  orgao: string,
  input: Record<string, unknown>,
) {
  const base = String(input.base || "");
  if (!dataValida(base))
    throw new WorkflowInputError("Informe uma data-base válida.");
  // Calendários manuais já conferidos continuam sendo uma alternativa completa.
  let ano = Number(base.slice(0, 4));
  try {
    return calcularPrazo(tribunal, orgao, input);
  } catch (e) {
    if (!(e instanceof ErroCoberturaCalendario)) throw e;
    ano = Number(e.data.slice(0, 4));
  }
  if (!configImportacao().ativo)
    throw new WorkflowInputError(
      "A importação automática está desativada e não há calendário manual cobrindo a data. Ative-a ou preencha o calendário manual.",
    );
  const extras: CalendarioForense[] = [];
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const c = await sincronizarCalendario({ tribunal, orgao, ano }),
      cal = c ? calendarioParaCalculo(c) : null;
    if (!cal)
      throw new WorkflowInputError(
        c?.erro ||
          "Calendário oficial ainda indisponível. Atualize nas configurações ou preencha manualmente.",
      );
    extras.push(cal);
    try {
      return calcularPrazo(tribunal, orgao, input, extras);
    } catch (e) {
      if (!(e instanceof ErroCoberturaCalendario)) throw e;
      const proximo = Number(e.data.slice(0, 4));
      if (proximo === ano) throw e;
      ano = proximo;
    }
  }
  throw new WorkflowInputError(
    "A contagem ultrapassou a cobertura disponível. Complemente o calendário manualmente.",
  );
}
