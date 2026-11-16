import { useCallback, useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface Sugestao { x: number; y: number; largura: number; altura: number; documento: string; titulo: string }

/** Recorta a caixa da imagem e devolve um JPEG de, no máximo, 480 px de altura. */
function recortar(img: HTMLImageElement, s: Sugestao): Promise<Blob> {
  const sx = s.x * img.naturalWidth, sy = s.y * img.naturalHeight, sw = s.largura * img.naturalWidth, sh = s.altura * img.naturalHeight;
  const escala = Math.min(1, 480 / sh);
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * escala)); c.height = Math.max(1, Math.round(sh * escala));
  c.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return new Promise((ok, erro) => c.toBlob((b) => (b ? ok(b) : erro(new Error("recorte"))), "image/jpeg", 0.9));
}

/** «Encontramos a foto no documento»: mostra o recorte para alguém confirmar. Nada vira foto do cadastro sozinho. */
export function FotoSugerida({ pessoaId, nome, gerir, aoAceitar }: { pessoaId: number; nome: string; gerir: boolean; aoAceitar: () => void }) {
  const { show } = useToast();
  const [s, setS] = useState<Sugestao | null>(null);
  const [pronta, setPronta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const img = useRef<HTMLImageElement | null>(null);
  const prev = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setS(null); setPronta(false); api.get<{ sugestao: Sugestao | null }>(`/gestao/pessoas/${pessoaId}/foto-sugerida`, { fresh: true } as never).then((r) => setS(r.sugestao)).catch(() => undefined); }, [pessoaId]);
  useEffect(() => {
    if (!s) return;
    const i = new Image(); i.crossOrigin = "use-credentials";
    i.onload = () => { img.current = i; const c = prev.current; if (c) { const h = 160, w = Math.round(h * (s.largura * i.naturalWidth) / (s.altura * i.naturalHeight)); c.width = w; c.height = h; c.getContext("2d")!.drawImage(i, s.x * i.naturalWidth, s.y * i.naturalHeight, s.largura * i.naturalWidth, s.altura * i.naturalHeight, 0, 0, w, h); } setPronta(true); };
    i.src = `/api/gestao/pessoas/${pessoaId}/foto-sugerida/imagem`;
  }, [s, pessoaId]);

  const aceitar = useCallback(async () => {
    if (!s || !img.current) return; setOcupado(true);
    try { await api.upload(`/gestao/pessoas/${pessoaId}/foto-sugerida/aceitar`, await recortar(img.current, s)); setS(null); show("Foto do cadastro atualizada.", "success"); aoAceitar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar a foto.", "error"); }
    finally { setOcupado(false); }
  }, [s, pessoaId, show, aoAceitar]);
  const dispensar = async () => { setOcupado(true); try { await api.delete(`/gestao/pessoas/${pessoaId}/foto-sugerida`); setS(null); } catch { show("Não foi possível dispensar.", "error"); } finally { setOcupado(false); } };

  if (!s) return null;
  return (
    <section aria-label="Foto sugerida" className="flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <canvas ref={prev} aria-label={`Foto encontrada no documento de ${nome}`} className="h-40 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700" />
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Camera className="h-4 w-4" /> Encontramos uma foto no {s.documento && s.documento !== "outro" && s.documento !== "nenhum" ? s.documento : "documento"} enviado</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Confira se é {nome.split(" ")[0]} e use como foto do cadastro (aparece na ficha impressa). A cópia do documento usada aqui é apagada assim que você escolher.</p>
        {gerir && <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" loading={ocupado} disabled={!pronta} onClick={() => void aceitar()}>Usar como foto do cadastro</Button><Button size="sm" variant="outline" disabled={ocupado} onClick={() => void dispensar()}>Dispensar</Button></div>}
      </div>
    </section>
  );
}
