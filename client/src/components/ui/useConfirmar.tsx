import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface Pedido { titulo: string; mensagem: string; confirmar?: string; perigo?: boolean }

/** Substitui `window.confirm`: `confirmar({...})` devolve uma promessa e `dialogo` deve ser renderizado uma vez na tela. */
export function useConfirmar() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirmar = useCallback((p: Pedido) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setPedido(p);
  }), []);
  const fechar = (ok: boolean) => { const r = resolver.current; resolver.current = null; setPedido(null); r?.(ok); };
  const dialogo = (
    <ConfirmDialog
      open={pedido !== null}
      title={pedido?.titulo ?? ""}
      message={pedido?.mensagem ?? ""}
      confirmLabel={pedido?.confirmar ?? "Confirmar"}
      confirmVariant={pedido?.perigo ? "danger" : "primary"}
      onConfirm={() => fechar(true)}
      onCancel={() => fechar(false)}
    />
  );
  return { confirmar, dialogo };
}
