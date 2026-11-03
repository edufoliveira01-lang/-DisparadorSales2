import { db } from "../../db";

/** Mudanças que alteram a situação de uma ordem (baixa, prazo concluído) pedem nova leitura do cartão. */
export function marcarEtapaParaRevisao(publicacaoId: number) {
  db.prepare(`UPDATE djen_kanban_cartoes SET revisar_etapa=1
    WHERE processo_chave=(SELECT processo_chave FROM djen_publicacoes WHERE id=?) AND modo='automatico'`).run(publicacaoId);
}
