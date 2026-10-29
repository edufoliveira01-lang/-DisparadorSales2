import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

export function LoginBrandingSettings() {
  const { show } = useToast();
  const [branding, setBranding] = useState<{ imageUrl: string | null }>({ imageUrl: null });
  const [image, setImage] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { void api.get<{ imageUrl: string | null }>("/branding").then(setBranding).catch(() => show("Não foi possível carregar a imagem do login.", "error")); }, []);

  async function upload() {
    if (!image) return;
    if (image.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(image.type)) {
      show("Escolha PNG, JPG ou WebP de até 5 MB.", "error"); return;
    }
    setUploading(true);
    try {
      const response = await fetch("/api/branding/image", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": image.type }, body: image });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha no envio.");
      setBranding(result); setImage(null); show("Imagem do login atualizada.", "success");
    } catch (error) { show((error as Error).message, "error"); }
    finally { setUploading(false); }
  }

  return <div className="mt-5 border-t border-zinc-200 pt-5 dark:border-zinc-800">
    <div className="mb-4 flex items-center gap-2"><ImagePlus className="h-5 w-5 text-violet-600" /><div><h3 className="font-semibold">Imagem da tela de login</h3><p className="text-sm text-zinc-500">Personalize o painel esquerdo. PNG, JPG ou WebP, até 5 MB.</p></div></div>
    <div className="grid items-center gap-5 sm:grid-cols-2"><div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-700 to-indigo-500">
      {branding.imageUrl ? <img src={branding.imageUrl} alt="Imagem atual da tela de login" className="h-full w-full object-cover" /> : <span className="px-7 text-center text-xl font-semibold text-white">Seu espaço de trabalho, com a identidade da sua equipe.</span>}
    </div><div className="space-y-3"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImage(event.target.files?.[0] || null)} aria-label="Escolher imagem para o login" className="block w-full text-sm" />
      <button type="button" onClick={() => void upload()} disabled={!image || uploading} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{uploading ? "Enviando…" : "Salvar imagem"}</button>
      {branding.imageUrl && <button type="button" onClick={() => { void api.delete<{ imageUrl: null }>("/branding/image").then((result) => { setBranding(result); show("Imagem removida. O padrão será exibido no login.", "success"); }).catch(() => show("Não foi possível remover a imagem.", "error")); }} className="ml-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm dark:border-zinc-700">Usar padrão</button>}
    </div></div>
  </div>;
}
