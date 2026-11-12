import { db } from "../../db";
import { canalPronto, enviarTextoConfirmado, resolverDestino } from "../canalWhatsapp";
import { normalizePhone } from "../../utils/phone";
import { DjenInputError, publicacaoPorId } from "./store";

const envios = new Set<string>();
export async function enviarMensagemDjen(
  id: number,
  data: Record<string, unknown>,
) {
  const p = publicacaoPorId(id);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  if (!p.revisada)
    throw new DjenInputError(
      "Revise a classificação e o inteiro teor antes de avisar o cliente.",
    );
  if (p.cancelada)
    throw new DjenInputError("Esta publicação foi cancelada na origem.");
  if (!p.cliente_id || !p.cliente_nome || !p.cliente_telefone)
    throw new DjenInputError(
      "Vincule um cliente da Agenda com telefone antes de enviar.",
    );
  const telefone = normalizePhone(p.cliente_telefone);
  if (!/^[1-9]\d{9,14}$/.test(telefone))
    throw new DjenInputError(
      "O contato selecionado está sem telefone válido. Corrija na Agenda compartilhada.",
    );
  if (
    Number(data.cliente_id) !== p.cliente_id ||
    typeof data.telefone_confirmado !== "string" ||
    normalizePhone(data.telefone_confirmado) !== telefone
  )
    throw new DjenInputError(
      "O contato mudou desde a revisão. Reabra os detalhes e confira o destinatário.",
    );
  const texto = typeof data.texto === "string" ? data.texto.trim() : "",
    key = typeof data.request_id === "string" ? data.request_id : "";
  if (
    !texto ||
    texto.length > 10000 ||
    !/^[\da-z-]{16,80}$/i.test(key) ||
    data.confirmado !== true
  )
    throw new DjenInputError("Revise a mensagem e confirme o envio.");
  const anterior = db
    .prepare("SELECT * FROM djen_mensagens WHERE request_id=?")
    .get(key) as { publicacao_id: number; status: string } | undefined;
  if (anterior) {
    if (anterior.publicacao_id !== id)
      throw new DjenInputError("Identificador de envio já utilizado.");
    return anterior;
  }
  const recente = db
    .prepare(
      "SELECT id FROM djen_mensagens WHERE publicacao_id=? AND telefone=? AND created_at>=datetime('now','-60 seconds')",
    )
    .get(id, telefone);
  if (recente)
    throw new DjenInputError(
      "Já existe uma tentativa recente para esta publicação. Confira a conversa e o histórico antes de reenviar.",
    );
  if (envios.has(telefone))
    throw new DjenInputError(
      "Já existe um envio processual para este telefone. Aguarde.",
    );
  if (!canalPronto())
    throw new DjenInputError(
      "Conecte o WhatsApp nas configurações compartilhadas antes de enviar.",
    );
  const messageId = Number(
    db
      .prepare(
        "INSERT INTO djen_mensagens(publicacao_id,request_id,cliente_nome,telefone,texto,status) VALUES (?,?,?,?,?,'enviando')",
      )
      .run(id, key, p.cliente_nome, telefone, texto).lastInsertRowid,
  );
  envios.add(telefone);
  let iniciouEnvio = false;
  try {
    const chatId = await resolverDestino(telefone);
    if (!chatId)
      throw new DjenInputError(
        "O telefone do contato não foi encontrado no WhatsApp.",
      );
    iniciouEnvio = true;
    const enviado = await enviarTextoConfirmado(chatId, texto, { nome: p.cliente_nome, finalidade: "djen" });
    db.prepare(
      "UPDATE djen_mensagens SET status='sucesso',whatsapp_message_id=?,ack=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(enviado.messageId, enviado.ack, messageId);
    return db.prepare("SELECT * FROM djen_mensagens WHERE id=?").get(messageId);
  } catch (error) {
    const erro =
      error instanceof Error
        ? error.message
        : "Não foi possível concluir o envio.";
    db.prepare(
      "UPDATE djen_mensagens SET status=?,erro=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(iniciouEnvio ? "incerto" : "falha", erro, messageId);
    throw new DjenInputError(erro);
  } finally {
    envios.delete(telefone);
  }
}
