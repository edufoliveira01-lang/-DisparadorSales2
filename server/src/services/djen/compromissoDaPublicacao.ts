import { db } from "../../db";
import { adicionarPublicacaoAoControle, agendamentoDaPublicacao, agendamentoNoTexto, dataHoraAgendamento, publicacao, type CompromissoManual } from "./periciaIntegration";
import { DjenInputError } from "./store";

/**
 * Perícia e audiência marcadas numa publicação são PRIORIDADE: ao revisar a publicação, o compromisso entra sozinho no controle («Avisar» em
 * Perícias e compromissos) e segue o fluxo normal (lembrete ao cliente, agenda). O que faltar (cliente, data, horário) vira pendência no topo.
 */
export type EstadoDoCompromisso = "" | "informado" | "completar" | "ignorado";
export interface ResultadoDoCompromisso { estado: EstadoDoCompromisso; motivo: string; tipo: "" | "pericia" | "audiencia" }

function gravar(id: number, r: ResultadoDoCompromisso) {
  db.prepare("UPDATE djen_publicacoes SET compromisso_estado=?,compromisso_motivo=?,compromisso_tipo=? WHERE id=?").run(r.estado, r.motivo, r.tipo, id);
  return r;
}

/** Tenta levar o compromisso da publicação para o controle e guarda o resultado. Nunca lança. */
export function sincronizarCompromisso(publicacaoId: number, manual: CompromissoManual = {}): ResultadoDoCompromisso {
  const p = publicacao(publicacaoId);
  if (!p) return { estado: "", motivo: "", tipo: "" };
  let categorias: string[] = []; try { categorias = JSON.parse(p.categorias_json || "[]"); } catch { /* sem categorias */ }
  const tipo = categorias.includes("pericia") ? "pericia" : categorias.includes("audiencia") ? "audiencia" : "";
  if (!tipo) return gravar(publicacaoId, { estado: "", motivo: "", tipo: "" });
  const nome = tipo === "pericia" ? "perícia" : "audiência";

  if (!p.cliente_id) return gravar(publicacaoId, { estado: "completar", motivo: `Vincule o cliente ao processo para avisar sobre a ${nome}.`, tipo });
  const da = agendamentoDaPublicacao(p);
  const tx = !da.data || !da.horario ? agendamentoNoTexto(p.texto, tipo) : { data: null, horario: null };
  const data = manual.data || da.data || tx.data, horario = manual.horario || da.horario || tx.horario;
  if (!data || !horario) return gravar(publicacaoId, { estado: "completar", motivo: `A publicação não traz data e horário legíveis da ${nome}: informe-os para avisar o cliente.`, tipo });
  const quando = dataHoraAgendamento(data, horario);
  if (Number.isFinite(quando) && quando < Date.now()) return gravar(publicacaoId, { estado: "ignorado", motivo: `A data da ${nome} já passou.`, tipo });
  try {
    adicionarPublicacaoAoControle(publicacaoId, manual);
    return gravar(publicacaoId, { estado: "informado", motivo: "", tipo });
  } catch (e) {
    return gravar(publicacaoId, { estado: "completar", motivo: e instanceof DjenInputError ? e.message : `Não foi possível levar a ${nome} ao controle.`, tipo });
  }
}

/** O cliente acabou de ser vinculado ao processo: as pendências «vincule o cliente» daquele processo são refeitas. */
export function refazerPendenciasDoProcesso(processoChave: string) {
  const ids = db.prepare("SELECT id FROM djen_publicacoes WHERE processo_chave=? AND revisada=1 AND cancelada=0 AND compromisso_estado='completar'").all(processoChave) as { id: number }[];
  for (const { id } of ids) sincronizarCompromisso(id);
}

/** Quantas publicações de perícia/audiência estão a revisar e quantas a completar (para o painel e a lista). */
export function resumoDosCompromissos() {
  const filtro = "cancelada=0 AND data_disponibilizacao >= date('now','-120 days')";
  const aRevisar = (db.prepare(`SELECT COUNT(*) n FROM djen_publicacoes WHERE ${filtro} AND revisada=0 AND (categorias_json LIKE '%"pericia"%' OR categorias_json LIKE '%"audiencia"%')`).get() as { n: number }).n;
  const completar = db.prepare(`SELECT id,processo_chave,compromisso_tipo AS tipo,compromisso_motivo AS motivo,data_disponibilizacao AS data FROM djen_publicacoes WHERE ${filtro} AND revisada=1 AND compromisso_estado='completar' ORDER BY data_disponibilizacao DESC LIMIT 20`).all() as { id: number; processo_chave: string; tipo: string; motivo: string; data: string }[];
  return { a_revisar: aRevisar, a_completar: completar.length, completar };
}
