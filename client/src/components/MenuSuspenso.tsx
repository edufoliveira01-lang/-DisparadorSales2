import { type ReactNode, useEffect, useRef, useState } from "react";

/** Um menu que abre ao clicar, fecha ao clicar fora ou com Esc. O gatilho recebe `{ aberto, alternar }`. */
export function MenuSuspenso({ gatilho, children }: { gatilho: (e: { aberto: boolean; alternar: () => void }) => ReactNode; children: (fechar: () => void) => ReactNode }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", tecla); };
  }, [aberto]);
  return (
    <div ref={raiz} className="relative">
      {gatilho({ aberto, alternar: () => setAberto((v) => !v) })}
      {aberto && <div className="menu-pop animate-fade-in" role="menu">{children(() => setAberto(false))}</div>}
    </div>
  );
}
