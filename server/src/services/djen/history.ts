import { db } from "../../db";
export function registrarHistoricoDjen(
  publicacaoId: number,
  tipo: string,
  descricao: string,
  dados?: unknown,
) {
  db.prepare(
    "INSERT INTO djen_historico(publicacao_id,tipo,descricao,dados_json) VALUES (?,?,?,?)",
  ).run(
    publicacaoId,
    tipo,
    descricao,
    dados === undefined ? null : JSON.stringify(dados),
  );
}
