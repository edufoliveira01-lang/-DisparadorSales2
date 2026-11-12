import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Um menu que abre ao clicar, fecha ao clicar fora, rolar a página ou com Esc. O gatilho recebe `{ aberto, alternar }`.
 * O menu é desenhado fora do contêiner (no corpo da página), então listas e cartões com `overflow-hidden` não o cortam.
 */
export function MenuSuspenso({ gatilho, children }: { gatilho: (e: { aberto: boolean; alternar: () => void }) => ReactNode; children: (fechar: () => void) => ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const [estilo, setEstilo] = useState<CSSProperties | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!raiz.current?.contains(alvo) && !menu.current?.contains(alvo)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    const fechar = (e: Event) => { if (!(e.target instanceof Node) || !menu.current?.contains(e.target)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [aberto]);

  // Posiciona abaixo do botão, alinhado à direita; se faltar espaço embaixo, abre para cima.
  useLayoutEffect(() => {
    if (!aberto || !raiz.current || !menu.current) { setEstilo(null); return; }
    const r = raiz.current.getBoundingClientRect();
    const altura = menu.current.offsetHeight;
    const largura = menu.current.offsetWidth;
    const cabeEmbaixo = r.bottom + 8 + altura <= window.innerHeight - 8;
    const top = cabeEmbaixo ? r.bottom + 8 : Math.max(8, r.top - 8 - altura);
    const left = Math.min(Math.max(8, r.right - largura), window.innerWidth - largura - 8);
    setEstilo({ position: "fixed", top, left, right: "auto", marginTop: 0 });
  }, [aberto]);

  return (
    <div ref={raiz} className="relative">
      {gatilho({ aberto, alternar: () => setAberto((v) => !v) })}
      {aberto && createPortal(
        <div ref={menu} className="menu-pop animate-fade-in" role="menu" style={estilo ?? { position: "fixed", top: 0, left: 0, right: "auto", marginTop: 0, visibility: "hidden" }}>{children(() => setAberto(false))}</div>,
        document.body,
      )}
    </div>
  );
}
