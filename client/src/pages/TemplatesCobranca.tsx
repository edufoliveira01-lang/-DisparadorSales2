import { useEffect, useRef, useState } from "react";
import { Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { VARIAVEIS, EXEMPLO_PERICIAS } from "@/lib/templateSamples";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Input";

export function TemplatesCobranca() {
  const { show } = useToast();
  const [mensagem, setMensagem] = useState("");
  const [salvando, setSalvando] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.get<Settings>("/settings").then((data) => setMensagem(data.cobranca_mensagem ?? ""));
  }, []);

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
      await api.put("/settings", { cobranca_mensagem: mensagem });
      show("Mensagem de cobrança salva.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar mensagem de cobrança.", "error");
    } finally {
      setSalvando(false);
    }
  }

  function preview(): string {
    const exemplo = EXEMPLO_PERICIAS[0];
    return mensagem
      .replace(/\{\{NOME\}\}/g, exemplo.nome)
      .replace(/\{\{TIPO_PERICIA\}\}/g, exemplo.tipo)
      .replace(/\{\{DATA\}\}/g, exemplo.data)
      .replace(/\{\{HORARIO\}\}/g, exemplo.horario)
      .replace(/\{\{LOCAL\}\}/g, exemplo.local);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Mensagem de Cobrança</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enviada pelo botão "Cobrar resposta" em Pendentes de Resposta, perguntando ao cliente se recebeu o envio anterior.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {"{{TIPO_PERICIA}}"}, {"{{DATA}}"}, {"{{HORARIO}}"} e {"{{LOCAL}}"} ficam em branco se o sistema não encontrar mais
            os dados originais do envio.
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
            ref={textareaRef}
            rows={6}
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
              <Save className="h-4 w-4" /> Salvar mensagem de cobrança
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
