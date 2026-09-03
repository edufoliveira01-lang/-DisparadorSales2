import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { VARIAVEIS, EXEMPLO_PERICIAS } from "@/lib/templateSamples";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";

type Periodo = "hoje" | "amanha";

const ABAS: { periodo: Periodo; label: string }[] = [
  { periodo: "hoje", label: "Hoje" },
  { periodo: "amanha", label: "Amanhã" },
];

const exemplo = EXEMPLO_PERICIAS[0];

export function TemplatesLembretes() {
  const { show } = useToast();
  const [aba, setAba] = useState<Periodo>("hoje");
  const [mensagens, setMensagens] = useState<Record<Periodo, string>>({ hoje: "", amanha: "" });
  const [salvando, setSalvando] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<Settings>("/settings").then((data) => {
      setMensagens({
        hoje: data.lembrete_hoje_mensagem ?? "",
        amanha: data.lembrete_amanha_mensagem ?? "",
      });
    });
  }, []);

  const mensagem = mensagens[aba];

  function setMensagemAtual(valor: string | ((v: string) => string)) {
    setMensagens((prev) => ({
      ...prev,
      [aba]: typeof valor === "function" ? valor(prev[aba]) : valor,
    }));
  }

  function inserirVariavel(variavel: string) {
    const ref = textareaRef.current;
    const placeholder = `{{${variavel}}}`;
    if (!ref) {
      setMensagemAtual((v) => v + placeholder);
      return;
    }
    const start = ref.selectionStart ?? ref.value.length;
    const end = ref.selectionEnd ?? ref.value.length;
    const novoValor = mensagem.slice(0, start) + placeholder + mensagem.slice(end);
    setMensagemAtual(novoValor);
    requestAnimationFrame(() => {
      ref.focus();
      ref.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  async function salvar() {
    setSalvando(true);
    try {
      await api.put("/settings", {
        lembrete_hoje_mensagem: mensagens.hoje,
        lembrete_amanha_mensagem: mensagens.amanha,
      });
      show("Mensagens de lembrete salvas.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar mensagens de lembrete.", "error");
    } finally {
      setSalvando(false);
    }
  }

  function preview(): string {
    return mensagem
      .replace(/\{\{NOME\}\}/g, exemplo.nome)
      .replace(/\{\{TIPO_PERICIA\}\}/g, exemplo.tipo)
      .replace(/\{\{DATA\}\}/g, exemplo.data)
      .replace(/\{\{HORARIO\}\}/g, exemplo.horario)
      .replace(/\{\{LOCAL\}\}/g, exemplo.local)
      .replace(/\{\{TELEFONE\}\}/g, exemplo.telefone || "")
      .replace(/\{\{WHATSAPP\}\}/g, exemplo.whatsapp || "")
      .replace(/\{\{PROCESSO\}\}/g, exemplo.processo || "")
      .replace(/\{\{PROFISSIONAL_PERITO\}\}/g, exemplo.profissionalPerito || "");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mensagens de Lembrete"
        description={
          <>
            Enviadas pelo botão "Enviar mensagem" no Dashboard, para perícias de hoje e de amanhã — cada período tem sua
            própria mensagem.
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
            {ABAS.map(({ periodo, label }) => (
              <button
                key={periodo}
                onClick={() => setAba(periodo)}
                className={cn(
                  "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
                  aba === periodo ? "border-accent-500 text-accent-600" : "border-transparent text-zinc-500"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            As variáveis são preenchidas com os dados do próprio evento do calendário.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {VARIAVEIS.map((v) => (
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
            rows={6}
            value={mensagem}
            onChange={(e) => setMensagemAtual(e.target.value)}
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
              <Save className="h-4 w-4" /> Salvar mensagens de lembrete
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
