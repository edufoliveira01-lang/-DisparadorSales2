import { useEffect, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

// O proxy pode ter um limite menor que o permitido pela API. Mantém a imagem
// abaixo de 1 MB sem exigir que o administrador a redimensione manualmente.
async function prepareImage(file: File): Promise<Blob> {
  const maxUpload = 900 * 1024;
  if (file.size <= maxUpload) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Este navegador não conseguiu preparar a imagem.");
    for (const maxSide of [1920, 1500, 1200, 900]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.7, 0.55]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (blob && blob.type === "image/webp" && blob.size <= maxUpload) return blob;
      }
    }
    throw new Error("Não foi possível reduzir a imagem. Escolha outra imagem com menos detalhes.");
  } finally { URL.revokeObjectURL(url); }
}

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
      const prepared = await prepareImage(image);
      const response = await fetch("/api/branding/image", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": prepared.type }, body: prepared });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json") ? await response.json() as { error?: string; imageUrl: string | null } : null;
      if (!response.ok) throw new Error(result?.error || (response.status === 413 ? "O servidor recusou o tamanho da imagem. Tente um arquivo menor." : `Falha ao enviar a imagem (HTTP ${response.status}).`));
      if (!result) throw new Error("O servidor não retornou a confirmação da imagem. Verifique a conexão e tente novamente.");
      setBranding(result); setImage(null); show("Imagem do login atualizada.", "success");
    } catch (error) { show((error as Error).message, "error"); }
    finally { setUploading(false); }
  }

  const remover = () => { void api.delete<{ imageUrl: null }>("/branding/image").then((result) => { setBranding(result); show("Imagem removida. O padrão será exibido no login.", "success"); }).catch((e) => show(e instanceof Error ? e.message : "Não foi possível remover a imagem.", "error")); };
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent-600 to-accent-800">
          {branding.imageUrl
            ? <img src={branding.imageUrl} alt="Imagem atual da tela de login" className="h-full w-full object-cover" />
            : <span className="flex flex-col items-center gap-2 px-7 text-center text-sm font-medium text-white/90"><ImagePlus className="h-6 w-6" />Imagem padrão do sistema</span>}
        </div>
        <div className="min-w-0 space-y-3">
          <div>
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Imagem do painel esquerdo</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">PNG, JPG ou WebP, até 5 MB. Imagens grandes são reduzidas automaticamente. No celular, a tela de login mostra só o formulário.</p>
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImage(event.target.files?.[0] || null)} aria-label="Escolher imagem para o login"
            className="block w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-50 dark:text-zinc-300 dark:file:border-zinc-700 dark:file:bg-zinc-900 dark:file:text-zinc-200" />
          {image && <p className="truncate text-xs text-zinc-500">Selecionada: {image.name}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void upload()} disabled={!image} loading={uploading}>Salvar imagem</Button>
            {branding.imageUrl && <Button variant="ghost" className="danger-action" onClick={remover}>Remover imagem</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
