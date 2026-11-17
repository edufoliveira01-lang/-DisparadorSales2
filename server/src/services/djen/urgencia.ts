import { db } from "../../db";
import { hojeSaoPaulo } from "./cache";
import { triagensPublicacoes } from "./triagem";

/** Contagens de andamentos, com os mesmos critérios da fila e dos filtros. */
export function urgenciaDasPublicacoes() {
  const linhas = db.prepare("SELECT id,concluida FROM djen_publicacoes WHERE cancelada=0").all() as { id: number; concluida: number }[];
  const mapa = triagensPublicacoes();
  const abertas = linhas.filter(p => !p.concluida || mapa.get(p.id)?.prazo_aberto).map(p => mapa.get(p.id)!);
  const count = (condicao: (t: typeof abertas[number]) => boolean) => abertas.filter(condicao).length;
  return {
    pendentes: abertas.length,
    vencidos: count(t => t.vencido), vencem_hoje: count(t => t.vence_hoje),
    compromissos_7_dias: count(t => t.compromisso_proximo),
    datas_a_confirmar: count(t => t.dados_incompletos), prazo_a_lancar: count(t => t.prazo_a_lancar),
    novas_para_triagem: count(t => t.conferencia_pendente), precisam_conferencia: count(t => t.conferencia_pendente), hoje: hojeSaoPaulo(),
  };
}
