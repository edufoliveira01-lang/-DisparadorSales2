import { Badge } from "@/components/ui/Badge";

interface StatusBadgeProps {
  /** Status do envio em si (send_logs.status). Ausente para pendentes de resposta, que só
   * existem quando o envio deu certo. */
  sendStatus?: "sucesso" | "falha";
  ack: number | null;
  /** Status do pending_reply correlato (mesmo whatsapp_message_id), quando esse envio está (ou
   * esteve) sob monitoramento de resposta. */
  respostaStatus?: "aguardando" | "respondido" | "cancelado" | null;
}

/**
 * Etiqueta única de status, usada em Histórico e Pendentes de Resposta: Enviado (ainda sem
 * confirmação de entrega) → Entregue (confirmado no aparelho, sem monitoramento de resposta) ou
 * Aguardando resposta (monitoramento ativo) → Concluído (cliente respondeu/confirmou). Erro cobre
 * tanto falha no envio quanto falha reportada pelo próprio WhatsApp (ack negativo).
 */
export function StatusBadge({ sendStatus, ack, respostaStatus }: StatusBadgeProps) {
  if (sendStatus === "falha" || (ack !== null && ack !== undefined && ack <= -1)) {
    return <Badge tone="danger">Erro</Badge>;
  }
  if (respostaStatus === "respondido") {
    return <Badge tone="success">Concluído</Badge>;
  }
  if (respostaStatus === "aguardando") {
    return <Badge tone="info">Aguardando resposta</Badge>;
  }
  if (ack !== null && ack !== undefined && ack >= 2) {
    return <Badge tone="warning">Entregue</Badge>;
  }
  return <Badge tone="neutral">Enviado</Badge>;
}
