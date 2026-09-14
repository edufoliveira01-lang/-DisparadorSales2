import type { ReactNode } from "react";
import { AlertTriangle, Check, CheckCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface AckIndicatorProps {
  ack: number | null;
  /** Permite manter “—” em envios que falharam antes de chegar ao WhatsApp. */
  sendStatus?: "sucesso" | "falha";
  /** Quando true, mostra sempre o estado final "Respondida" (verde), independente do ack —
   * usado em Pendentes de Resposta, onde ter uma resposta do cliente é o que importa no fim. */
  respondido?: boolean;
  /** Só o ícone colorido, sem o texto do rótulo (o significado fica no title/tooltip). */
  compact?: boolean;
}

/**
 * Mapeamento de status do whatsapp-web.js:
 * -1: Erro (ACK_ERROR)
 * 0: Pendente (ACK_PENDING)
 * 1: Enviado ao servidor (ACK_SERVER - 1 tique) — cinza
 * 2: Entregue no aparelho (ACK_DEVICE - 2 tiques) — amarelo
 * 3/4: Lido/Reproduzido (ACK_READ/ACK_PLAYED) — azul
 * respondido (PendingReply.status) — verde, tem prioridade sobre o ack
 */
export function AckIndicator({ ack, sendStatus, respondido, compact }: AckIndicatorProps) {
  function render(icon: ReactNode, colorClass: string, label: string, title: string) {
    return (
      <span className={cn("inline-flex items-center gap-1", colorClass)} title={title}>
        {icon}
        {!compact && label}
      </span>
    );
  }

  if (respondido) {
    return render(<Check className="h-3.5 w-3.5" />, "text-emerald-500", "Respondida", "Cliente respondeu");
  }
  if (ack === null || ack === undefined) {
    if (sendStatus === "falha") {
      return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
    }
    return render(<Check className="h-3.5 w-3.5" />, "text-zinc-400", "Enviado", "Mensagem enviada; aguardando confirmação de entrega");
  }
  if (ack <= -1) {
    return render(<AlertTriangle className="h-3.5 w-3.5" />, "text-red-500", "Erro", "Erro ao entregar");
  }
  if (ack === 0) {
    return render(<Clock className="h-3.5 w-3.5" />, "text-zinc-400", "Pendente", "Aguardando confirmação do WhatsApp");
  }
  if (ack === 1) {
    return render(<Check className="h-3.5 w-3.5" />, "text-zinc-400", "Enviado", "Enviado ao servidor do WhatsApp");
  }
  if (ack === 2) {
    return render(<CheckCheck className="h-3.5 w-3.5" />, "text-amber-500", "Entregue", "Entregue no aparelho do cliente");
  }
  // 3 e 4 são lido/reproduzido
  return render(<CheckCheck className="h-3.5 w-3.5" />, "text-blue-500", "Lida", "Mensagem lida pelo cliente");
}
