/**
 * Armazenamento externo — limpeza dos documentos do chat que esperam uma assinatura que nunca veio.
 *
 * O documento que o cliente manda antes de assinar fica numa pasta temporária (`armazenamento_espera`). Sem prazo, quem nunca assina deixaria o arquivo
 * parado para sempre. Passado o prazo (padrão 60 dias, `ARMAZENAMENTO_ESPERA_DIAS`, mínimo 7), a linha e o arquivo temporário saem.
 */
import fs from "node:fs";
import { db } from "../db";

export const diasDeEspera = (): number => Math.max(7, Number(process.env.ARMAZENAMENTO_ESPERA_DIAS) || 60);

/** `YYYY-MM-DD HH:MM:SS` em UTC, o formato do `CURRENT_TIMESTAMP` do SQLite. */
const textoUtc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** Apaga o que espera há mais de `dias`. Devolve quantos documentos saíram. Nunca lança. */
export function limparEsperaVencida(dias: number = diasDeEspera(), agora: number = Date.now()): number {
  try {
    const corte = textoUtc(agora - dias * 86_400_000);
    const vencidos = db.prepare("SELECT id, caminho_temp FROM armazenamento_espera WHERE criado_em < ?").all(corte) as Array<{ id: number; caminho_temp: string }>;
    for (const v of vencidos) {
      if (v.caminho_temp) { try { fs.unlinkSync(v.caminho_temp); } catch { /* o arquivo já não existe */ } }
      db.prepare("DELETE FROM armazenamento_espera WHERE id=?").run(v.id);
    }
    if (vencidos.length > 0) console.log(`[armazenamento] ${vencidos.length} documento(s) do chat esperando assinatura há mais de ${dias} dias foram descartados.`);
    return vencidos.length;
  } catch (e) {
    console.error("[armazenamento] limpeza falhou:", e instanceof Error ? e.message : e);
    return 0;
  }
}

/** Há quantos dias o documento mais antigo espera (0 se não há nenhum). */
export function diasDoMaisAntigoEsperando(agora: number = Date.now()): number {
  const r = db.prepare("SELECT MIN(criado_em) AS m FROM armazenamento_espera").get() as { m: string | null };
  if (!r.m) return 0;
  const t = Date.parse(`${r.m.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / 86_400_000)) : 0;
}
