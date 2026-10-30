import { db } from "../../db";
import { identificarObrigacoesExternas } from "./obligations";

/** Contagens de cobertura, sem presumir que ausência de publicação prova ausência de laudo. */
export function diagnosticoAcompanhamentos() {
  const pericias = db.prepare(`SELECT
    COUNT(*) AS ativas,
    SUM(CASE WHEN processo_chave='' THEN 1 ELSE 0 END) AS sem_processo,
    SUM(CASE WHEN data_hora_ms>strftime('%s','now')*1000 THEN 1 ELSE 0 END) AS futuras,
    SUM(CASE WHEN data_hora_ms<=strftime('%s','now')*1000 AND data_hora_ms>strftime('%s','now')*1000-60*86400000 THEN 1 ELSE 0 END) AS menos_60_dias
    FROM pericias_agendadas WHERE status='ativa' AND COALESCE(origem,'')<>'audiencia'`).get() as Record<string, number | null>;
  const publicacoes = db.prepare("SELECT texto FROM djen_publicacoes WHERE cancelada=0").all() as { texto: string }[];
  const config = db.prepare("SELECT aguardo_dias FROM djen_config WHERE id=1").get() as { aguardo_dias: number };
  return { pericias: Object.fromEntries(Object.entries(pericias).map(([k, v]) => [k, v || 0])), publicacoes: publicacoes.length,
    ordens_externas: publicacoes.reduce((n, p) => n + identificarObrigacoesExternas(p.texto).length, 0), aguardo_dias: config.aguardo_dias };
}
