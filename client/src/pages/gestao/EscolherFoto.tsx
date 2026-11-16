import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/** Recorte manual da foto do cliente a partir de um documento (imagem, ou as imagens do PDF): arraste um retângulo sobre o rosto. */
export function EscolherFoto({ arquivoId, pessoaId, nome, aberto, aoFechar, aoSalvar }: { arquivoId: number; pessoaId: number; nome: string; aberto: boolean; aoFechar: () => void; aoSalvar: () => void }) {
  const { show } = useToast();
  const [total, setTotal] = useState<number | null>(null);
  const [n, setN] = useState(0);
  const [caixa, setCaixa] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setTotal(null); setN(0); setCaixa(null);
    api.get<{ total: number }>(`/gestao/arquivos/${arquivoId}/imagem-para-foto?total=1`).then((r) => setTotal(r.total)).catch(() => setTotal(0));
  }, [aberto, arquivoId]);

  const ponto = useCallback((e: React.PointerEvent) => {
    const r = img.current!.getBoundingClientRect();
    return { x: Math.min(r.width, Math.max(0, e.clientX - r.left)), y: Math.min(r.height, Math.max(0, e.clientY - r.top)) };
  }, []);
  const comecar = (e: React.PointerEvent) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); inicio.current = ponto(e); setCaixa({ ...inicio.current, w: 0, h: 0 }); };
  const mover = (e: React.PointerEvent) => { if (!inicio.current) return; const p = ponto(e); const i = inicio.current; setCaixa({ x: Math.min(i.x, p.x), y: Math.min(i.y, p.y), w: Math.abs(p.x - i.x), h: Math.abs(p.y - i.y) }); };
  const soltar = () => { inicio.current = null; };

  async function salvar() {
    const el = img.current; if (!el || !caixa || caixa.w < 12 || caixa.h < 12) { show("Arraste um retângulo sobre o rosto.", "info"); return; }
    setSalvando(true);
    try {
      const k = el.naturalWidth / el.getBoundingClientRect().width;
      const sx = caixa.x * k, sy = caixa.y * k, sw = caixa.w * k, sh = caixa.h * k;
      const escala = Math.min(1, 480 / sh);
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * escala)); c.height = Math.max(1, Math.round(sh * escala));
      c.getContext("2d")!.drawImage(el, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const blob: Blob = await new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error("recorte"))), "image/jpeg", 0.9));
      await api.upload(`/gestao/pessoas/${pessoaId}/foto`, blob);
      show("Foto do cadastro atualizada.", "success"); aoSalvar(); aoFechar();
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar a foto.", "error"); }
    finally { setSalvando(false); }
  }

  return (
    <Modal open={aberto} onClose={aoFechar} title="Escolher a foto deste documento" description={`Arraste um retângulo sobre o rosto no documento de ${nome.split(" ")[0]}. A foto do cadastro será substituída.`} maxWidth="max-w-3xl"
      footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={aoFechar}>Cancelar</Button><Button loading={salvando} disabled={!caixa || caixa.w < 12} onClick={() => void salvar()}>Usar esta área como foto</Button></div>}>
      {total === null ? <p className="text-sm text-zinc-500">Carregando o documento…</p> : total === 0 ? <p className="text-sm text-zinc-500">Este arquivo não tem uma imagem que dê para recortar (PDF sem imagem). Envie o documento como foto (jpg ou png).</p> : (
        <div className="space-y-3">
          {total > 1 && <div className="flex gap-2">{Array.from({ length: total }, (_, i) => <Button key={i} size="sm" variant={i === n ? "primary" : "outline"} onClick={() => { setN(i); setCaixa(null); }}>Imagem {i + 1}</Button>)}</div>}
          <div className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700" onPointerDown={comecar} onPointerMove={mover} onPointerUp={soltar} style={{ cursor: "crosshair" }}>
            <img key={n} ref={img} src={`/api/gestao/arquivos/${arquivoId}/imagem-para-foto?n=${n}`} alt="Documento" draggable={false} className="block max-h-[60vh] max-w-full" crossOrigin="use-credentials" />
            {caixa && caixa.w > 2 && <span aria-hidden className="pointer-events-none absolute border-2 border-accent-500 bg-accent-500/20" style={{ left: caixa.x, top: caixa.y, width: caixa.w, height: caixa.h }} />}
          </div>
        </div>)}
    </Modal>
  );
}
