import { db } from "../../db";
import { emitEvent } from "../../websocket";
import { analisarComCodex } from "./codexRunner";
import { configuracaoDjen, DjenInputError, publicacaoPorId } from "./store";
import type { AnaliseCodex } from "./classifier";
let timer: ReturnType<typeof setInterval> | null = null;
let atual: { id: number; controller: AbortController } | null = null;
let encerrando = false;
const changed = () => emitEvent("djen:changed", {});
export function statusAnalisesCodex() {
  return {
    executando: atual?.id || null,
    pendentes: (
      db
        .prepare(
          "SELECT count(*) AS n FROM djen_publicacoes WHERE ia_status='pendente' AND cancelada=0",
        )
        .get() as { n: number }
    ).n,
    falhas: (
      db
        .prepare(
          "SELECT count(*) AS n FROM djen_publicacoes WHERE ia_status='erro' AND cancelada=0",
        )
        .get() as { n: number }
    ).n,
    pausa: configuracaoDjen().ia_pausa,
  };
}
/** Compare-and-set evita sobrescrever captura nova ou revisão humana feita durante a análise. */
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
  db.prepare(
    `UPDATE djen_publicacoes SET ia_status='concluida',ia_json=?,ia_erro=NULL,ia_em=CURRENT_TIMESTAMP,
    categorias_json=CASE WHEN revisada=0 THEN ? ELSE categorias_json END,
    evidencias_json=CASE WHEN revisada=0 THEN ? ELSE evidencias_json END,
    resultado=CASE WHEN revisada=0 THEN ? ELSE resultado END, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
  ).run(
    JSON.stringify(analise),
    JSON.stringify(analise.categorias),
    JSON.stringify(analise.evidencias),
    analise.resultado,
    id,
  );
  return true;
}
export function enfileirarAnaliseCodex(id?: number) {
  if (atual && (id === atual.id || id === undefined))
    throw new DjenInputError("Aguarde a análise atual antes de reanalisar.");
  if (id !== undefined) {
    const p = publicacaoPorId(id);
    if (!p || p.cancelada)
      throw new DjenInputError("Publicação indisponível para análise.");
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL WHERE id=?",
    ).run(id);
  } else {
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL WHERE revisada=0 AND cancelada=0",
    ).run();
  }
  db.prepare("UPDATE djen_config SET ia_pausa=NULL WHERE id=1").run();
  changed();
  void processarFilaCodex();
  return { ok: true };
}
export async function processarFilaCodex() {
  const config = configuracaoDjen();
  if (encerrando || atual || !config.ia_ativa || config.ia_pausa) return;
  // Revisadas entram somente por solicitação explícita; o histórico da sugestão é preservado.
  const p = db
    .prepare(
      "SELECT id,texto,tipo_documento FROM djen_publicacoes WHERE ia_status='pendente' AND cancelada=0 ORDER BY revisada ASC,id ASC LIMIT 1",
    )
    .get() as { id: number; texto: string; tipo_documento: string } | undefined;
  if (!p) return;
  const controller = new AbortController();
  atual = { id: p.id, controller };
  db.prepare(
    "UPDATE djen_publicacoes SET ia_status='analisando',ia_erro=NULL WHERE id=?",
  ).run(p.id);
  changed();
  try {
    const analise = await analisarComCodex(
      p.texto,
      p.tipo_documento,
      controller.signal,
    );
    salvarAnaliseCodex(p.id, p.texto, p.tipo_documento, analise);
  } catch (error) {
    const erro =
      error instanceof Error ? error.message : "Falha na análise do Codex.";
    db.prepare(
      "UPDATE djen_publicacoes SET ia_status='erro',ia_erro=? WHERE id=? AND texto=? AND tipo_documento=? AND ia_status='analisando'",
    ).run(erro, p.id, p.texto, p.tipo_documento);
    // Pausa visível, sem repetição de chamadas a uma conta desconectada ou sem saldo de uso.
    if (!encerrando)
      db.prepare("UPDATE djen_config SET ia_pausa=? WHERE id=1").run(erro);
  } finally {
    atual = null;
    changed();
    if (!encerrando && !configuracaoDjen().ia_pausa)
      setImmediate(() => {
        void processarFilaCodex();
      });
  }
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
  atual?.controller.abort();
}
