import { useRef, useState, type ReactNode } from "react";
import { AlignCenter, AlignLeft, AlignRight, ImagePlus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

export type Alinha = "left" | "center" | "right";
const OPCOES: [Alinha, string, typeof AlignLeft][] = [["left", "Esquerda", AlignLeft], ["center", "Centro", AlignCenter], ["right", "Direita", AlignRight]];

/** Esquerda, centro ou direita. */
export function BotoesAlinhamento({ valor, aoMudar, desabilitado }: { valor: Alinha; aoMudar: (v: Alinha) => void; desabilitado?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Alinhamento" className="inline-flex overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
      {OPCOES.map(([v, rotulo, Icone]) => (
        <button key={v} type="button" role="radio" aria-checked={valor === v} disabled={desabilitado} onClick={() => aoMudar(v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${valor === v ? "bg-accent-500/15 text-accent-700 dark:text-accent-300" : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
          <Icone className="h-3.5 w-3.5" /> {rotulo}
        </button>
      ))}
    </div>
  );
}

/** Envia, troca e remove uma imagem do escritório (cabeçalho, rodapé, ícone ou logotipo da ficha). */
export function CartaoImagem({ titulo, descricao, urlBase, tem, aoMudar, podeEditar, altura = "h-16", extra, fundoEscuro, uploadPath }: {
  titulo: string; descricao: ReactNode; urlBase: string; tem: boolean; aoMudar: () => void; podeEditar: boolean; altura?: string; extra?: ReactNode; fundoEscuro?: boolean; uploadPath?: string;
}) {
  const { show } = useToast();
  const entrada = useRef<HTMLInputElement>(null);
  const [versao, setVersao] = useState(0);
  const caminho = uploadPath ?? urlBase.replace(/^\/api/, ""); // o cliente de API já acrescenta /api
  const enviar = async (f: File | undefined) => {
    if (!f) return;
    try { await api.upload(caminho, f); setVersao((v) => v + 1); aoMudar(); show(`${titulo}: imagem salva.`, "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar a imagem.", "error"); }
    finally { if (entrada.current) entrada.current.value = ""; }
  };
  const tirar = async () => {
    try { await api.delete(caminho); setVersao((v) => v + 1); aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível remover.", "error"); }
  };
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titulo}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{descricao}</p>
        </div>
        <Badge tone={tem ? "success" : "neutral"}>{tem ? "Enviada" : "Sem imagem"}</Badge>
      </div>
      <div className={`flex min-h-[5rem] flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-300 p-3 dark:border-zinc-700 ${fundoEscuro ? "bg-zinc-800" : "bg-white dark:bg-zinc-950/40"}`}>
        {tem ? <img key={versao} src={`${urlBase}?v=${versao}&t=${Date.now() % 100000}`} alt={titulo} className={`${altura} max-w-full object-contain`} /> : <span className="flex items-center gap-1.5 text-xs text-zinc-400"><ImagePlus className="h-4 w-4" /> Nenhuma imagem enviada</span>}
      </div>
      {extra}
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => entrada.current?.click()}><ImagePlus className="h-4 w-4" /> {tem ? "Trocar imagem" : "Enviar imagem"}</Button>
          {tem && <Button type="button" size="sm" variant="ghost" className="danger-action" onClick={() => void tirar()}><Trash2 className="h-4 w-4" /> Remover</Button>}
          <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp,.ico,image/x-icon" hidden onChange={(e) => void enviar(e.target.files?.[0])} />
        </div>
      )}
    </div>
  );
}
