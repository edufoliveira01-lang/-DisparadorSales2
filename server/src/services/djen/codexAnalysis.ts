import { db } from "../../db";
import { emitEvent } from "../../websocket";
import { analisarComCodex, ErroPublicacaoCodex } from "./codexRunner";
import { configuracaoDjen, DjenInputError, publicacaoPorId } from "./store";
import {
  ErroAnaliseCodex,
  VERSAO_CLASSIFICADOR,
  type AnaliseCodex,
} from "./classifier";
import { registrarHistoricoDjen } from "./history";
let timer: ReturnType<typeof setInterval> | null = null;
const atuais = new Map<number, AbortController>();
let encerrando = false;
const changed = () => emitEvent("djen:changed", {});
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
  return {
    executando: ids[0] || null,
    executando_ids: ids,
    simultaneas: config.ia_paralelismo,
    pendentes,
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
        ? Math.ceil((pendentes + ids.length) / config.ia_paralelismo) *
          Math.round(media / 1000)
        : null,
  };
}
export function salvarAnaliseCodex(
  id: number,
  texto: string,
  tipoDocumento: string,
  analise: AnaliseCodex,
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
      `UPDATE djen_publicacoes SET ia_status='concluida',ia_manual=0,ia_json=?,ia_erro=NULL,ia_em=CURRENT_TIMESTAMP,ia_versao=?,
      categorias_json=CASE WHEN revisada=0 THEN ? ELSE categorias_json END,
      evidencias_json=CASE WHEN revisada=0 THEN ? ELSE evidencias_json END,
      situacao=CASE WHEN revisada=0 THEN ? ELSE situacao END,
      resultado=CASE WHEN revisada=0 THEN ? ELSE resultado END,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(
      JSON.stringify(analise),
      VERSAO_CLASSIFICADOR,
      JSON.stringify(analise.categorias),
      JSON.stringify(analise.evidencias),
      analise.situacao || "",
      analise.resultado,
      id,
    );
    registrarHistoricoDjen(
      id,
      "analise",
      "Análise do Codex concluída. Revisões humanas são preservadas.",
      {
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
  if (id !== undefined) {
    const p = publicacaoPorId(id);
    if (!p || p.cancelada)
      throw new DjenInputError("Publicação indisponível para análise.");
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL,ia_manual=1 WHERE id=?",
    ).run(id);
  } else
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL WHERE revisada=0 AND cancelada=0 AND ia_status<>'analisando'",
    ).run();
  db.prepare("UPDATE djen_config SET ia_pausa=NULL WHERE id=1").run();
  changed();
  void processarFilaCodex();
  return { ok: true };
}
interface Tarefa {
  id: number;
  texto: string;
  tipo_documento: string;
  classe: string;
  processo: string;
  tribunal: string;
}
async function executar(p: Tarefa, controller: AbortController) {
  const inicio = Date.now();
  try {
    const analise = await analisarComCodex(
      p.texto,
      p.tipo_documento,
      controller.signal,
      { classe: p.classe, processo: p.processo, tribunal: p.tribunal },
    );
    if (salvarAnaliseCodex(p.id, p.texto, p.tipo_documento, analise))
      db.prepare("UPDATE djen_publicacoes SET ia_duracao_ms=? WHERE id=?").run(
        Date.now() - inicio,
        p.id,
      );
  } catch (error) {
    const erro =
      error instanceof Error ? error.message : "Falha na análise do Codex.";
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='erro',ia_manual=0,ia_erro=? WHERE id=? AND texto=? AND tipo_documento=? AND ia_status='analisando'",
    ).run(erro, p.id, p.texto, p.tipo_documento);
    if (
      !encerrando &&
      !(error instanceof ErroPublicacaoCodex) &&
      !(error instanceof ErroAnaliseCodex)
    )
      db.prepare("UPDATE djen_config SET ia_pausa=? WHERE id=1").run(erro);
  } finally {
    atuais.delete(p.id);
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
    const config = configuracaoDjen();
    if (atuais.size >= config.ia_paralelismo) break;
    const p = db
      .prepare(
        "SELECT p.id,p.texto,p.tipo_documento,p.classe,p.tribunal,pr.numero AS processo FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave WHERE p.ia_status='pendente' AND p.cancelada=0 AND (? OR p.ia_manual=1) ORDER BY p.ia_manual DESC,p.revisada ASC,p.id ASC LIMIT 1",
      )
      .get(config.ia_ativa && !config.ia_pausa ? 1 : 0) as Tarefa | undefined;
    if (!p) break;
    const claim = db
      .prepare(
        "UPDATE djen_publicacoes SET ia_status='analisando',ia_erro=NULL,ia_iniciada_em=? WHERE id=? AND ia_status='pendente'",
      )
      .run(new Date().toISOString(), p.id);
    if (!claim.changes) continue;
    const controller = new AbortController();
    atuais.set(p.id, controller);
    changed();
    tarefas.push(executar(p, controller));
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
    void processarFilaCodex();
  }, 30000);
  timer.unref();
  void processarFilaCodex();
}
export function pararMonitorCodex() {
  encerrando = true;
  if (timer) clearInterval(timer);
  timer = null;
  for (const c of atuais.values()) c.abort();
}
