import { db } from "../../db";
import { dataValida } from "./api";
import { registrarHistoricoDjen } from "./history";
export class WorkflowInputError extends Error {}
function existente(id: number) {
  if (!db.prepare("SELECT id FROM djen_publicacoes WHERE id=?").get(id))
    throw new WorkflowInputError("Publicação não encontrada.");
}
export function dadosAcompanhamento(
  publicacaoId: number,
  processoChave: string,
) {
  return {
    prazos: db
      .prepare(
        "SELECT * FROM djen_prazos WHERE publicacao_id=? ORDER BY termino IS NULL,termino,id",
      )
      .all(publicacaoId),
    documentos: db
      .prepare(
        "SELECT * FROM djen_documentos WHERE publicacao_id=? ORDER BY id DESC",
      )
      .all(publicacaoId),
    historico: db
      .prepare(
        "SELECT h.*,p.data_disponibilizacao FROM djen_historico h JOIN djen_publicacoes p ON p.id=h.publicacao_id WHERE p.processo_chave=? ORDER BY h.id DESC LIMIT 100",
      )
      .all(processoChave),
  };
}
export function salvarPrazo(
  publicacaoId: number,
  data: Record<string, unknown>,
  prazoId?: number,
) {
  existente(publicacaoId);
  const descricao =
    typeof data.descricao === "string" ? data.descricao.trim() : "";
  const inicio =
    data.inicio === "" || data.inicio === null ? null : data.inicio;
  const termino =
    data.termino === "" || data.termino === null ? null : data.termino;
  const status = data.status || "aberto";
  if (
    !descricao ||
    descricao.length > 250 ||
    (inicio !== null && (typeof inicio !== "string" || !dataValida(inicio))) ||
    (termino !== null &&
      (typeof termino !== "string" || !dataValida(termino))) ||
    (typeof inicio === "string" &&
      typeof termino === "string" &&
      inicio > termino) ||
    !["aberto", "concluido", "cancelado"].includes(String(status)) ||
    typeof data.observacoes !== "string" ||
    data.observacoes.length > 5000
  )
    throw new WorkflowInputError(
      "Informe a descrição, datas válidas (início até término) e observações de até 5 mil caracteres.",
    );
  return db.transaction(() => {
    let anterior: unknown;
    if (prazoId) {
      anterior = db
        .prepare("SELECT * FROM djen_prazos WHERE id=? AND publicacao_id=?")
        .get(prazoId, publicacaoId);
      if (!anterior)
        throw new WorkflowInputError("Prazo não encontrado nesta publicação.");
      db.prepare(
        "UPDATE djen_prazos SET descricao=?,inicio=?,termino=?,status=?,observacoes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND publicacao_id=?",
      ).run(
        descricao,
        inicio,
        termino,
        status,
        data.observacoes,
        prazoId,
        publicacaoId,
      );
    } else
      prazoId = Number(
        db
          .prepare(
            "INSERT INTO djen_prazos(publicacao_id,descricao,inicio,termino,status,observacoes) VALUES (?,?,?,?,?,?)",
          )
          .run(
            publicacaoId,
            descricao,
            inicio,
            termino,
            status,
            data.observacoes,
          ).lastInsertRowid,
      );
    registrarHistoricoDjen(
      publicacaoId,
      "prazo",
      anterior
        ? "Prazo atualizado pelo usuário."
        : "Prazo cadastrado pelo usuário.",
      {
        antes: anterior ?? null,
        depois: {
          id: prazoId,
          descricao,
          inicio,
          termino,
          status,
          observacoes: data.observacoes,
        },
      },
    );
    return prazoId;
  })();
}
export function excluirPrazo(publicacaoId: number, prazoId: number) {
  return db.transaction(() => {
    const p = db
      .prepare("SELECT * FROM djen_prazos WHERE id=? AND publicacao_id=?")
      .get(prazoId, publicacaoId);
    if (!p)
      throw new WorkflowInputError("Prazo não encontrado nesta publicação.");
    db.prepare("DELETE FROM djen_prazos WHERE id=? AND publicacao_id=?").run(
      prazoId,
      publicacaoId,
    );
    registrarHistoricoDjen(
      publicacaoId,
      "prazo",
      "Prazo excluído pelo usuário.",
      p,
    );
  })();
}
export function adicionarDocumento(
  publicacaoId: number,
  data: Record<string, unknown>,
) {
  existente(publicacaoId);
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  let url: URL;
  try {
    url = new URL(String(data.url));
  } catch {
    throw new WorkflowInputError(
      "Informe um link HTTPS válido para o documento.",
    );
  }
  if (
    !nome ||
    nome.length > 200 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href.length > 3000
  )
    throw new WorkflowInputError(
      "Informe o nome do documento (até 200 caracteres) e um link HTTPS sem credenciais.",
    );
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(
          "INSERT INTO djen_documentos(publicacao_id,nome,url) VALUES (?,?,?)",
        )
        .run(publicacaoId, nome, url.href).lastInsertRowid,
    );
    registrarHistoricoDjen(
      publicacaoId,
      "documento",
      "Link de documento adicionado.",
      { id, nome, url: url.href },
    );
    return id;
  })();
}
export function excluirDocumento(publicacaoId: number, documentoId: number) {
  return db.transaction(() => {
    const d = db
      .prepare("SELECT * FROM djen_documentos WHERE id=? AND publicacao_id=?")
      .get(documentoId, publicacaoId);
    if (!d)
      throw new WorkflowInputError(
        "Documento não encontrado nesta publicação.",
      );
    db.prepare(
      "DELETE FROM djen_documentos WHERE id=? AND publicacao_id=?",
    ).run(documentoId, publicacaoId);
    registrarHistoricoDjen(
      publicacaoId,
      "documento",
      "Link de documento removido.",
      d,
    );
  })();
}
