import { chatgptLoginBusy } from "../ai/chatgptAuth";
import { licencaPermiteOperar, recursoLiberadoNaLicenca } from "../../licenca/cliente";
import { aiProfile, profileIdentity, type AiProfile } from "../ai/config";
import { createHash } from "node:crypto";
import { db } from "../../db";
import { emitEvent } from "../../websocket";
import {
  analisarComCodex,
  analisarLoteComCodex,
  ErroModeloCodex,
  ErroPublicacaoCodex,
  type ModoAnaliseCodex,
} from "./codexRunner";
import { configuracaoDjen, DjenInputError, publicacaoPorId } from "./store";
import {
  ErroAnaliseCodex,
  analiseDeSeguranca,
  completarComRegraDeSeguranca,
  validarAnaliseCodex,
  VERSAO_CLASSIFICADOR,
  type AnaliseCodex,
  type ContextoPublicacao,
} from "./classifier";
import { registrarHistoricoDjen } from "./history";
import { versaoExemplosClassificacao } from "./teaching";

let timer: ReturnType<typeof setInterval> | null = null;
const atuais = new Map<number, AbortController>();
const execucoesAtuais = new Set<AbortController>();
let encerrando = false;
const changed = () => emitEvent("djen:changed", {});

interface Tarefa {
  id: number;
  texto: string;
  tipo_documento: string;
  classe: string;
  processo: string;
  tribunal: string;
  ia_manual: number;
  perfil: AiProfile;
}

const contexto = (p: Tarefa): ContextoPublicacao => ({
  classe: p.classe,
  processo: p.processo,
  tribunal: p.tribunal,
});

export function statusAnalisesCodex() {
  const config = configuracaoDjen();
  const pendentes = (
    db
      .prepare(
        "SELECT count(*) AS n FROM djen_publicacoes WHERE ia_status='pendente' AND cancelada=0",
      )
      .get() as { n: number }
  ).n;
  const media = (
    db
      .prepare(
        "SELECT AVG(ia_duracao_ms) AS media FROM (SELECT ia_duracao_ms FROM djen_publicacoes WHERE ia_status='concluida' AND ia_duracao_ms IS NOT NULL ORDER BY ia_em DESC,id DESC LIMIT 50)",
      )
      .get() as { media: number | null }
  ).media;
  const ids = [...atuais.keys()];
  const uso = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status<>'cache' THEN 1 ELSE 0 END) AS chamadas,
        SUM(CASE WHEN status='cache' THEN itens ELSE 0 END) AS cache_hits,
        SUM(CASE WHEN status='concluida' AND itens>1 THEN itens-1 ELSE 0 END) AS agrupadas,
        SUM(CASE WHEN status<>'cache' THEN caracteres ELSE 0 END) AS caracteres,
        SUM(CASE WHEN status='falha' THEN 1 ELSE 0 END) AS chamadas_falhas
       FROM djen_codex_execucoes WHERE created_at>=datetime('now','-30 days')`,
    )
    .get() as {
    chamadas: number | null;
    cache_hits: number | null;
    agrupadas: number | null;
    caracteres: number | null;
    chamadas_falhas: number | null;
  };
  const reanalisaveis = (
    db
      .prepare(
        "SELECT count(*) AS n FROM djen_publicacoes WHERE revisada=0 AND cancelada=0 AND ia_status<>'analisando'",
      )
      .get() as { n: number }
  ).n;
  const tamanhoLote =
    config.ia_modo === "economico"
      ? 8
      : config.ia_modo === "equilibrado"
        ? 4
        : 1;
  return {
    provedor: aiProfile(config.ia_modo).provedor,
    modelo: aiProfile(config.ia_modo).modelo,
    executando: ids[0] || null,
    executando_ids: ids,
    execucoes_simultaneas: execucoesAtuais.size,
    simultaneas: config.ia_paralelismo,
    pendentes,
    reanalisaveis,
    falhas: (
      db
        .prepare(
          "SELECT count(*) AS n FROM djen_publicacoes WHERE ia_status='erro' AND cancelada=0",
        )
        .get() as { n: number }
    ).n,
    pausa: config.ia_pausa,
    media_segundos: media ? Math.round(media / 1000) : null,
    estimativa_segundos:
      media && config.ia_ativa && !config.ia_pausa
        ? Math.ceil(
            (pendentes + ids.length) /
              (config.ia_paralelismo * tamanhoLote),
          ) *
          Math.round(media / 1000)
        : null,
    uso_30_dias: {
      chamadas: uso.chamadas || 0,
      cache_hits: uso.cache_hits || 0,
      agrupadas: uso.agrupadas || 0,
      execucoes_evitadas: (uso.cache_hits || 0) + (uso.agrupadas || 0),
      caracteres: uso.caracteres || 0,
      falhas: uso.chamadas_falhas || 0,
    },
  };
}

export function salvarAnaliseCodex(
  id: number,
  texto: string,
  tipoDocumento: string,
  analise: AnaliseCodex,
  perfil: AiProfile = aiProfile(configuracaoDjen().ia_modo),
): boolean {
  const p = publicacaoPorId(id);
  if (
    !p ||
    p.texto !== texto ||
    p.tipo_documento !== tipoDocumento ||
    p.cancelada
  )
    return false;
  db.transaction(() => {
    db.prepare(
      `UPDATE djen_publicacoes SET ia_status='concluida',ia_manual=0,ia_json=?,ia_erro=NULL,ia_em=CURRENT_TIMESTAMP,ia_versao=?,ia_provedor=?,ia_modelo=?,ia_configuracao=?,
      categorias_json=CASE WHEN revisada=0 THEN ? ELSE categorias_json END,
      evidencias_json=CASE WHEN revisada=0 THEN ? ELSE evidencias_json END,
      situacao=CASE WHEN revisada=0 THEN ? ELSE situacao END,
      resultado=CASE WHEN revisada=0 THEN ? ELSE resultado END,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(
      JSON.stringify(analise),
      VERSAO_CLASSIFICADOR,
      perfil.provedor || "codex", perfil.modelo, String(perfil.configuracao || 0),
      JSON.stringify(analise.categorias),
      JSON.stringify(analise.evidencias),
      analise.situacao || "",
      analise.resultado,
      id,
    );
    registrarHistoricoDjen(
      id,
      "analise",
      "Análise da IA concluída. Revisões humanas são preservadas.",
      {
        provedor: perfil.provedor || "codex", modelo: perfil.modelo,
        categorias: analise.categorias,
        resultado: analise.resultado,
        situacao: analise.situacao || "",
      },
    );
  })();
  return true;
}

export function enfileirarAnaliseCodex(id?: number) {
  if (id !== undefined && atuais.has(id))
    throw new DjenInputError("Esta publicação já está em análise.");
  let enfileiradas = 0;
  if (id !== undefined) {
    const p = publicacaoPorId(id);
    if (!p || p.cancelada)
      throw new DjenInputError("Publicação indisponível para análise.");
    enfileiradas = db
      .prepare(
        "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL,ia_manual=1 WHERE id=?",
      )
      .run(id).changes;
  } else
    enfileiradas = db
      .prepare(
        "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL WHERE revisada=0 AND cancelada=0 AND ia_status<>'analisando'",
      )
      .run().changes;
  db.prepare("UPDATE djen_config SET ia_pausa=NULL WHERE id=1").run();
  changed();
  void processarFilaCodex();
  return { ok: true, enfileiradas };
}

function chaveCache(p: Tarefa) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        VERSAO_CLASSIFICADOR,
        profileIdentity(p.perfil),
        versaoExemplosClassificacao(),
        p.tipo_documento,
        p.classe,
        p.processo,
        p.tribunal,
        p.texto,
      ]),
    )
    .digest("hex");
}

function lerCache(p: Tarefa): { analise: AnaliseCodex; perfil: AiProfile } | null {
  if (p.ia_manual) return null;
  const chave = chaveCache(p);
  const row = db
    .prepare(
      "SELECT analise_json FROM djen_analise_cache WHERE chave=? AND versao=?",
    )
    .get(chave, `${VERSAO_CLASSIFICADOR}:${versaoExemplosClassificacao()}`) as { analise_json: string } | undefined;
  if (!row) return null;
  try {
    const saved = JSON.parse(row.analise_json);
    if (!saved.perfil || saved.perfil.provedor !== p.perfil.provedor || saved.perfil.configuracao !== p.perfil.configuracao) return null;
    return { analise: validarAnaliseCodex(saved.analise, p.texto, contexto(p)), perfil: saved.perfil };
  } catch {
    db.prepare("DELETE FROM djen_analise_cache WHERE chave=?").run(chave);
    return null;
  }
}

function gravarCache(p: Tarefa, analise: AnaliseCodex, perfil: AiProfile) {
  db.prepare(
    `INSERT INTO djen_analise_cache(chave,versao,analise_json) VALUES (?,?,?)
     ON CONFLICT(chave) DO UPDATE SET versao=excluded.versao,analise_json=excluded.analise_json,updated_at=CURRENT_TIMESTAMP`,
  ).run(chaveCache(p), `${VERSAO_CLASSIFICADOR}:${versaoExemplosClassificacao()}`, JSON.stringify({ analise, perfil }));
}

function registrarCache(p: Tarefa, perfil: AiProfile) {
  db.prepare(
    "INSERT INTO djen_codex_execucoes(modelo,esforco,modo,itens,caracteres,status,duracao_ms,provedor) VALUES (?,?,?,1,?,'cache',0,?)",
  ).run(perfil.modelo, perfil.esforco, perfil.modo, p.texto.length, perfil.provedor || "codex");
}

function buscarPendentes(config: ReturnType<typeof configuracaoDjen>) {
  const rows = db
    .prepare(
      `SELECT p.id,p.texto,p.tipo_documento,p.classe,p.tribunal,p.ia_manual,pr.numero AS processo
       FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave
       WHERE p.ia_status='pendente' AND p.cancelada=0 AND (? OR p.ia_manual=1)
       ORDER BY p.ia_manual DESC,p.revisada ASC,p.id ASC LIMIT 24`,
    )
    .all(config.ia_ativa && !config.ia_pausa ? 1 : 0) as Tarefa[];
  return rows.map((p) => ({ ...p, perfil: aiProfile(p.ia_manual ? "precisao" : p.texto.length > 20000 && config.ia_modo === "economico" ? "equilibrado" : config.ia_modo) }));
}

function aplicarCache(config: ReturnType<typeof configuracaoDjen>): boolean {
  for (const p of buscarPendentes(config)) {
    const analise = lerCache(p);
    if (!analise) continue;
    const claim = db
      .prepare(
        "UPDATE djen_publicacoes SET ia_status='analisando',ia_erro=NULL,ia_iniciada_em=? WHERE id=? AND ia_status='pendente'",
      )
      .run(new Date().toISOString(), p.id);
    if (!claim.changes) continue;
    if (salvarAnaliseCodex(p.id, p.texto, p.tipo_documento, analise.analise, analise.perfil)) {
      db.prepare("UPDATE djen_publicacoes SET ia_duracao_ms=0 WHERE id=?").run(
        p.id,
      );
      registrarCache(p, analise.perfil);
    }
    changed();
    return true;
  }
  return false;
}

function selecionarGrupo(
  config: ReturnType<typeof configuracaoDjen>,
): Tarefa[] {
  const candidatos = buscarPendentes(config);
  if (!candidatos.length) return [];
  const primeiro = candidatos[0];
  const limites: Record<ModoAnaliseCodex, number> = {
    economico: 8,
    equilibrado: 4,
    precisao: 1,
  };
  const maximo = primeiro.ia_manual ? 1 : limites[config.ia_modo];
  const escolhidos: Tarefa[] = [];
  let caracteres = 0;
  for (const p of candidatos) {
    if (escolhidos.length >= maximo) break;
    if (p.ia_manual !== primeiro.ia_manual) break;
    if (
      escolhidos.length &&
      (p.texto.length > 20000 || caracteres + p.texto.length > 60000)
    )
      break;
    escolhidos.push(p);
    caracteres += p.texto.length;
    if (p.texto.length > 20000) break;
  }
  return db.transaction(() =>
    escolhidos.filter((p) => {
      const claim = db
        .prepare(
          "UPDATE djen_publicacoes SET ia_status='analisando',ia_erro=NULL,ia_iniciada_em=? WHERE id=? AND ia_status='pendente'",
        )
        .run(new Date().toISOString(), p.id);
      return Boolean(claim.changes);
    }),
  )();
}

function precisaAprofundar(analise: AnaliseCodex) {
  return /\b(?:duvid|incert|inconclus|conflit|ileg[ií]vel|texto incompleto|falta de contexto|n[aã]o foi poss[ií]vel)\b/i.test(
    analise.alertas.join(" "),
  );
}

/**
 * A IA falhou: antes de deixar a publicação sem classificação, a regra literal procura perícia/audiência já designada com data e horário.
 * Perder um agendamento é inadmissível; a publicação sai classificada, com alerta de conferência, e a falha da IA fica no histórico.
 */
function recuperarPorRegra(p: Tarefa, motivo: string): boolean {
  try {
    const analise = analiseDeSeguranca(p.texto, contexto(p));
    if (!analise) return false;
    const perfil = { modo: "economico", modelo: "regra literal", esforco: "low", provedor: "regra", configuracao: 0 } as unknown as AiProfile;
    if (!salvarAnaliseCodex(p.id, p.texto, p.tipo_documento, analise, perfil)) return false;
    registrarHistoricoDjen(p.id, "analise", `A IA não concluiu (${motivo.slice(0, 420)}). A publicação foi classificada por regra de segurança: ${analise.categorias.join(", ")} em ${analise.agendamento.data} às ${analise.agendamento.horario}. Confira.`, { provedor: "regra", categorias: analise.categorias });
    return true;
  } catch {
    return false;
  }
}

function marcarErro(p: Tarefa, error: unknown) {
  const erro =
    error instanceof Error ? error.message : "Falha na análise da IA.";
  if (recuperarPorRegra(p, erro)) return erro;
  db.prepare(
    "UPDATE djen_publicacoes SET ia_status='erro',ia_manual=0,ia_erro=? WHERE id=? AND texto=? AND tipo_documento=? AND ia_status='analisando'",
  ).run(erro, p.id, p.texto, p.tipo_documento);
  return erro;
}

function erroDaPublicacao(error: unknown) {
  return (
    error instanceof ErroPublicacaoCodex || error instanceof ErroAnaliseCodex
  );
}

async function executarGrupo(
  grupo: Tarefa[],
  controller: AbortController,
  modo: ModoAnaliseCodex,
) {
  const inicio = Date.now();
  const resultados = new Map<number, AnaliseCodex>();
  const pendentes = new Set(grupo.map((p) => p.id));
  let loteInvalido = false;
  try {
    const perfilInicial = grupo[0].perfil;
    const perfilForte = aiProfile("equilibrado");
    const podeEscalar = perfilInicial.modo === "economico" && perfilInicial.modelo !== perfilForte.modelo;
    let perfilLote = perfilInicial;
    if (grupo.length > 1) {
      try {
        const itens = grupo.map((p) => ({
          id: p.id,
          texto: p.texto,
          tipoDocumento: p.tipo_documento,
          contexto: contexto(p),
        }));
        let lote;
        try {
          lote = await analisarLoteComCodex(
            itens,
            controller.signal,
            perfilInicial,
          );
        } catch (error) {
          if (
            !(error instanceof ErroModeloCodex) ||
            !podeEscalar
          )
            throw error;
          perfilLote = perfilForte;
          lote = await analisarLoteComCodex(itens, controller.signal, perfilLote);
        }
        for (const [id, analise] of lote.resultados)
          resultados.set(id, analise);
        loteInvalido = lote.invalidos.length > 0;
      } catch (error) {
        if (!erroDaPublicacao(error)) throw error;
        // Resposta de lote inválida: repete somente estes itens, isoladamente e com o modelo forte.
        loteInvalido = true;
      }
    }
    for (const p of grupo) {
      let analise = resultados.get(p.id);
      let perfilUsado = perfilLote;
      try {
        if (!analise) {
          const perfilIndividual =
            loteInvalido && podeEscalar
              ? perfilForte
              : perfilInicial;
          perfilUsado = perfilIndividual;
          try {
            analise = await analisarComCodex(
              p.texto,
              p.tipo_documento,
              controller.signal,
              contexto(p),
              perfilIndividual,
            );
          } catch (error) {
            if (
              (!podeEscalar || perfilIndividual.modelo !== perfilInicial.modelo) ||
              (!erroDaPublicacao(error) && !(error instanceof ErroModeloCodex))
            )
              throw error;
            perfilUsado = perfilForte;
            analise = await analisarComCodex(p.texto, p.tipo_documento, controller.signal, contexto(p), perfilUsado);
          }
        } else if (
          podeEscalar &&
          precisaAprofundar(analise)
        ) {
          perfilUsado = perfilForte;
          analise = await analisarComCodex(p.texto, p.tipo_documento, controller.signal, contexto(p), perfilUsado);
        }
        analise = completarComRegraDeSeguranca(analise, p.texto, contexto(p));
        if (salvarAnaliseCodex(p.id, p.texto, p.tipo_documento, analise, perfilUsado)) {
          gravarCache(p, analise, perfilUsado);
          db.prepare(
            "UPDATE djen_publicacoes SET ia_duracao_ms=? WHERE id=?",
          ).run(Date.now() - inicio, p.id);
        }
        pendentes.delete(p.id);
      } catch (error) {
        if (!erroDaPublicacao(error)) throw error;
        marcarErro(p, error);
        pendentes.delete(p.id);
      }
    }
  } catch (error) {
    let mensagem = "Falha na análise da IA.";
    for (const p of grupo)
      if (pendentes.has(p.id)) mensagem = marcarErro(p, error);
    if (!encerrando && !erroDaPublicacao(error))
      db.prepare("UPDATE djen_config SET ia_pausa=? WHERE id=1").run(mensagem);
  } finally {
    for (const p of grupo) atuais.delete(p.id);
    execucoesAtuais.delete(controller);
    changed();
    if (!encerrando && !configuracaoDjen().ia_pausa)
      setImmediate(() => {
        void processarFilaCodex();
      });
  }
}

export async function processarFilaCodex() {
  const tarefas: Promise<void>[] = [];
  while (!encerrando) {
    if (chatgptLoginBusy()) break;
    const config = configuracaoDjen();
    if (execucoesAtuais.size >= config.ia_paralelismo) break;
    if (aplicarCache(config)) continue;
    const grupo = selecionarGrupo(config);
    if (!grupo.length) break;
    const controller = new AbortController();
    execucoesAtuais.add(controller);
    for (const p of grupo) atuais.set(p.id, controller);
    changed();
    tarefas.push(executarGrupo(grupo, controller, config.ia_modo));
  }
  await Promise.all(tarefas);
}

export function iniciarMonitorCodex() {
  if (timer) return;
  encerrando = false;
  db.prepare(
    "UPDATE djen_publicacoes SET ia_status='pendente' WHERE ia_status='analisando'",
  ).run();
  timer = setInterval(() => {
    if (!licencaPermiteOperar() || !recursoLiberadoNaLicenca("ia_habilitada")) return; // sem licença ou plano sem IA: não consome
    void processarFilaCodex();
  }, 30000);
  timer.unref();
  void processarFilaCodex();
}

export function pararMonitorCodex() {
  encerrando = true;
  if (timer) clearInterval(timer);
  timer = null;
  for (const controller of execucoesAtuais) controller.abort();
  execucoesAtuais.clear();
  atuais.clear();
}

