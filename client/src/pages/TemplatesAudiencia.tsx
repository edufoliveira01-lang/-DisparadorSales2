import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { EXEMPLO_AUDIENCIA_ONLINE, EXEMPLO_AUDIENCIA_PRESENCIAL, VARIAVEIS_AUDIENCIA } from "@/lib/audiencia";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export function TemplatesAudiencia() {
  const { show } = useToast();
  const [aba, setAba] = useState<"presencial" | "online">("presencial");
  const [mensagemPresencial, setMensagemPresencial] = useState("");
  const [mensagemOnline, setMensagemOnline] = useState("");
  const [salvando, setSalvando] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<Settings>("/settings").then((data) => {
      setMensagemPresencial(data.audiencia_presencial_mensagem ?? "");
      setMensagemOnline(data.audiencia_online_mensagem ?? "");
    });
  }, []);

  const mensagem = aba === "presencial" ? mensagemPresencial : mensagemOnline;
  const setMensagem = aba === "presencial" ? setMensagemPresencial : setMensagemOnline;
  const exemplo = aba === "presencial" ? EXEMPLO_AUDIENCIA_PRESENCIAL : EXEMPLO_AUDIENCIA_ONLINE;

  function inserirVariavel(variavel: string) {
    const ref = textareaRef.current;
    const placeholder = `{{${variavel}}}`;
    if (!ref) {
      setMensagem((v) => v + placeholder);
      return;
    }
    const start = ref.selectionStart ?? ref.value.length;
    const end = ref.selectionEnd ?? ref.value.length;
    const novoValor = mensagem.slice(0, start) + placeholder + mensagem.slice(end);
    setMensagem(novoValor);
    requestAnimationFrame(() => {
      ref.focus();
      ref.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api.put("/settings", {
        audiencia_presencial_mensagem: mensagemPresencial,
        audiencia_online_mensagem: mensagemOnline,
      });
      show("Mensagens de audiência salvas.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar mensagens de audiência.", "error");
    } finally {
      setSalvando(false);
    }
  }

  function preview(): string {
    return mensagem
      .replace(/\{\{NOME\}\}/g, exemplo.nome)
      .replace(/\{\{DATA\}\}/g, exemplo.data)
      .replace(/\{\{HORARIO\}\}/g, exemplo.horario)
      .replace(/\{\{LOCAL\}\}/g, exemplo.local)
      .replace(/\{\{PROCESSO\}\}/g, exemplo.processo || "");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Mensagens de Audiência</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enviadas automaticamente quando o sistema identifica uma audiência (presencial ou online) na descrição do card,
          no lugar da mensagem de perícia.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setAba("presencial")}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
                aba === "presencial" ? "border-accent-500 text-accent-600" : "border-transparent text-zinc-500"
              )}
            >
              Presencial
            </button>
            <button
              onClick={() => setAba("online")}
              className={cn(
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
                aba === "online" ? "border-accent-500 text-accent-600" : "border-transparent text-zinc-500"
              )}
            >
              Online
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {VARIAVEIS_AUDIENCIA.map((v) => (
              <button
                key={v}
                onClick={() => inserirVariavel(v)}
                className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          <Textarea
            key={aba}
            ref={textareaRef}
            rows={7}
            value={mensagem}
            onChange={(e) => setMensagem(e.target.value)}
            className="font-mono text-[13px]"
          />
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Pré-visualização</p>
            <div className="whitespace-pre-wrap rounded-2xl rounded-tl-none bg-accent-50 px-4 py-3 text-sm text-zinc-800 dark:bg-accent-900/20 dark:text-zinc-200">
              {preview() || "…"}
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={salvar} loading={salvando}>
              <Save className="h-4 w-4" /> Salvar mensagens de audiência
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
