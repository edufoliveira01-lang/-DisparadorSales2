import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/components/ui/Modal";

/** true quando a janela tem pelo menos `px` de largura (acompanha o redimensionamento). */
export function useLargura(px: number): boolean {
  const consulta = `(min-width:${px}px)`;
  const [largo, setLargo] = useState(() => typeof window !== "undefined" && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const f = () => setLargo(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [consulta]);
  return largo;
}

/**
 * O painel de detalhes da publicação: em tela LARGA fica fixo ao lado da fila (padrão «fila + detalhe»: dá para trabalhar uma publicação depois da outra
 * sem perder a lista); em tela estreita continua sendo a janela lateral de antes.
 */
export function PainelDeDetalhes({ lado, alvo, open, onClose, footer, children }: {
  lado: boolean;
  alvo: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  if (lado && alvo) {
    if (!open) return null;
    return createPortal(
      <div className="desk-detail">
        <div className="desk-detail-body">{children}</div>
        <div className="desk-detail-footer">{footer}</div>
      </div>,
      alvo,
    );
  }
  return (
    <Modal open={open} onClose={onClose} title="Processo · detalhes e próximos passos" maxWidth="max-w-4xl" footer={footer}>
      {children}
    </Modal>
  );
}
