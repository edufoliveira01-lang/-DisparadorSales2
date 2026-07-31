import { AlertTriangle, Check, CheckCheck, Clock } from "lucide-react";

/** -1 erro, 0 pendente, 1 enviado ao servidor, 2 entregue (✓✓ cinza), 3 lido (✓✓ azul), 4 áudio reproduzido. */
export function AckIndicator({ ack }: { ack: number | null }) {
  if (ack === null || ack === undefined) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  if (ack === -1) {
    return (
      <span className="inline-flex items-center gap-1 text-red-500" title="Erro ao entregar">
        <AlertTriangle className="h-3.5 w-3.5" /> Erro
      </span>
    );
  }
  if (ack === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-zinc-400" title="Aguardando confirmação do WhatsApp">
        <Clock className="h-3.5 w-3.5" /> Pendente
      </span>
    );
  }
  if (ack === 1) {
    return (
      <span className="inline-flex items-center gap-1 text-zinc-400" title="Enviado ao servidor do WhatsApp">
        <Check className="h-3.5 w-3.5" /> Enviado
      </span>
    );
  }
  if (ack === 2) {
    return (
      <span className="inline-flex items-center gap-1 text-zinc-400" title="Entregue no aparelho do cliente">
        <CheckCheck className="h-3.5 w-3.5" /> Entregue
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-accent-500" title="Lido pelo cliente">
      <CheckCheck className="h-3.5 w-3.5" /> Lido
    </span>
  );
}
