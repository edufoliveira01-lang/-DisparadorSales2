import { db } from "../../db";
import { DjenInputError } from "./store";
import { concluirPublicacao } from "./deadlines";
import { registrarHistoricoDjen } from "./history";

/** Conclui apenas os processos explicitamente selecionados; tudo em uma transação. */
export function concluirProcessosSelecionados(ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) <= 0))
    throw new DjenInputError("Selecione de 1 a 5.000 processos válidos.");
  const unicos = [...new Set(ids as number[])];
  return db.transaction(() => {
    const processos = new Set<string>();
    const buscar = db.prepare("SELECT processo_chave FROM djen_publicacoes WHERE id=? AND cancelada=0 AND concluida=0");
    for (const n of unicos) {
      const row = buscar.get(n) as { processo_chave: string } | undefined;
      if (!row) throw new DjenInputError("A seleção mudou. Atualize a lista e selecione novamente.");
      processos.add(row.processo_chave);
    }
    const publicacoes = db.prepare("SELECT id FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0 AND concluida=0");
    let total = 0;
    for (const chave of processos) {
      for (const p of publicacoes.all(chave) as { id: number }[]) {
        concluirPublicacao(p.id, true);
        registrarHistoricoDjen(p.id, "conclusao", "Processo concluído em lote pelo usuário; andamentos agrupados foram arquivados.");
        total++;
      }
    }
    return { processos: processos.size, publicacoes: total };
  })();
}
