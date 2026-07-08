import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Plus, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Pericia, Template } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

const VARIAVEIS = ["NOME", "TIPO_PERICIA", "DATA", "HORARIO", "LOCAL"];

const EXEMPLO_PERICIAS: Pericia[] = [
  { tipo: "Perícia Médica", data: "15/07/2026", horario: "14:30", local: "Rua Exemplo, 123 - Centro", nome: "Maria da Silva" },
  { tipo: "Perícia Social", data: "16/07/2026", horario: "09:00", local: "Fórum Central, sala 4", nome: "Maria da Silva" },
];

function novoTemplateVazio(): Omit<Template, "id" | "created_at"> {
  return {
    nome: "Novo template",
    conteudo_1_pericia: "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\nQualquer dúvida, estou à disposição!",
    conteudo_2_pericias: "Olá {{NOME}}, tudo bem?\n\nVocê tem as seguintes perícias agendadas:\n\n{{#each PERICIAS}}\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\n{{/each}}\nQualquer dúvida, estou à disposição!",
    modo_envio_2_pericias: "combinada",
  };
}

export function Templates() {
  const { show } = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [form, setForm] = useState<Omit<Template, "id" | "created_at">>(novoTemplateVazio());
  const [aba, setAba] = useState<"1" | "2">("1");
  const [preview1, setPreview1] = useState("");
  const [preview2, setPreview2] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const textarea1Ref = useRef<HTMLTextAreaElement>(null);
  const textarea2Ref = useRef<HTMLTextAreaElement>(null);

  async function carregar() {
    const data = await api.get<Template[]>("/templates");
    setTemplates(data);
    if (data.length > 0 && selecionadoId === null) {
      selecionarTemplate(data[0]);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selecionarTemplate(t: Template) {
    setSelecionadoId(t.id);
    setForm({
      nome: t.nome,
      conteudo_1_pericia: t.conteudo_1_pericia,
      conteudo_2_pericias: t.conteudo_2_pericias,
      conteudo_pericia_medica: t.conteudo_pericia_medica || "",
      conteudo_pericia_social: t.conteudo_pericia_social || "",
      modo_envio_2_pericias: t.modo_envio_2_pericias,
    });
  }

  function novoTemplate() {
    setSelecionadoId(null);
    setForm(novoTemplateVazio());
  }

  async function salvar() {
    setSalvando(true);
    try {
      if (selecionadoId) {
        await api.put(`/templates/${selecionadoId}`, form);
        show("Template atualizado.", "success");
      } else {
        await api.post("/templates", form);
        show("Template criado.", "success");
      }
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar template.", "error");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!selecionadoId) return;
    setExcluindo(true);
    try {
      await api.delete(`/templates/${selecionadoId}`);
      show("Template removido.", "info");
      novoTemplate();
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao remover template.", "error");
    } finally {
      setExcluindo(false);
    }
  }

  function inserirVariavel(aba1or2: "1" | "2", variavel: string) {
    const ref = aba1or2 === "1" ? textarea1Ref.current : textarea2Ref.current;
    const campo = aba1or2 === "1" ? "conteudo_1_pericia" : "conteudo_2_pericias";
    const placeholder = `{{${variavel}}}`;
    if (!ref) {
      setForm((f) => ({ ...f, [campo]: f[campo] + placeholder }));
      return;
    }
    const start = ref.selectionStart ?? ref.value.length;
    const end = ref.selectionEnd ?? ref.value.length;
    const atual = form[campo];
    const novoValor = atual.slice(0, start) + placeholder + atual.slice(end);
    setForm((f) => ({ ...f, [campo]: novoValor }));
    requestAnimationFrame(() => {
      ref.focus();
      ref.setSelectionRange(start + placeholder.length, start + placeholder.length);
    });
  }

  // Preview em tempo real (debounce)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const payload = {
          nome: EXEMPLO_PERICIAS[0].nome,
          conteudo_1_pericia: form.conteudo_1_pericia,
          conteudo_2_pericias: form.conteudo_2_pericias,
          conteudo_pericia_medica: form.conteudo_pericia_medica,
          conteudo_pericia_social: form.conteudo_pericia_social,
          modo_envio_2_pericias: form.modo_envio_2_pericias,
        };

        const r1 = await api.post<{ mensagens: string[] }>("/templates/preview", {
          ...payload,
          pericias: [EXEMPLO_PERICIAS[0]],
        });
        setPreview1(r1.mensagens[0] || "");

        const r2 = await api.post<{ mensagens: string[] }>("/templates/preview", {
          ...payload,
          pericias: EXEMPLO_PERICIAS,
        });
        setPreview2(r2.mensagens);
      } catch {
        // erro de preview não deve interromper a edição
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [
    form.conteudo_1_pericia,
    form.conteudo_2_pericias,
    form.conteudo_pericia_medica,
    form.conteudo_pericia_social,
    form.modo_envio_2_pericias,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Templates</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Edite as mensagens enviadas aos clientes.</p>
        </div>
        <Button onClick={novoTemplate}>
          <Plus className="h-4 w-4" /> Novo template
        </Button>
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-6">
        <div className="space-y-1.5">
          {templates?.map((t) => (
            <button
              key={t.id}
              onClick={() => selecionarTemplate(t)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors",
                selecionadoId === t.id
                  ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              )}
            >
              <MessageSquareText className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.nome}</span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <Label>Nome do template</Label>
                  <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
                </div>
                <div className="w-56">
                  <Label>Envio com 2 perícias</Label>
                  <Select
                    value={form.modo_envio_2_pericias}
                    onChange={(e) => setForm((f) => ({ ...f, modo_envio_2_pericias: e.target.value as "combinada" | "separadas" }))}
                  >
                    <option value="combinada">1 mensagem combinada</option>
                    <option value="separadas">2 mensagens separadas</option>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={() => setAba("1")}
                  className={cn(
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
                    aba === "1" ? "border-accent-500 text-accent-600" : "border-transparent text-zinc-500"
                  )}
                >
                  Mensagem com 1 perícia
                </button>
                <button
                  onClick={() => setAba("2")}
                  className={cn(
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
                    aba === "2" ? "border-accent-500 text-accent-600" : "border-transparent text-zinc-500"
                  )}
                >
                  Mensagem com 2 perícias
                </button>
              </div>

              {aba === "1" ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {VARIAVEIS.map((v) => (
                      <button
                        key={v}
                        onClick={() => inserirVariavel("1", v)}
                        className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    ref={textarea1Ref}
                    rows={9}
                    value={form.conteudo_1_pericia}
                    onChange={(e) => setForm((f) => ({ ...f, conteudo_1_pericia: e.target.value }))}
                    className="font-mono text-[13px]"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-mono text-zinc-500 dark:bg-zinc-800">
                      {"{{#each PERICIAS}} ... {{/each}}"}
                    </span>
                    {VARIAVEIS.map((v) => (
                      <button
                        key={v}
                        onClick={() => inserirVariavel("2", v)}
                        className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-mono text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-400">
                    Dentro de {"{{#each PERICIAS}}"}...{"{{/each}}"}, use {"{{TIPO_PERICIA}}"}, {"{{DATA}}"}, {"{{HORARIO}}"} e{" "}
                    {"{{LOCAL}}"} para cada perícia. {"{{NOME}}"} fica fora do bloco (é o mesmo cliente).
                  </p>
                  {form.modo_envio_2_pericias === "combinada" ? (
                    <Textarea
                      ref={textarea2Ref}
                      rows={11}
                      value={form.conteudo_2_pericias}
                      onChange={(e) => setForm((f) => ({ ...f, conteudo_2_pericias: e.target.value }))}
                      className="font-mono text-[13px]"
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-zinc-400">Perícia Médica</Label>
                        <Textarea
                          rows={11}
                          value={form.conteudo_pericia_medica || form.conteudo_1_pericia}
                          onChange={(e) => setForm((f) => ({ ...f, conteudo_pericia_medica: e.target.value }))}
                          className="font-mono text-[13px]"
                          placeholder="Template para perícia médica..."
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase text-zinc-400">Perícia Social</Label>
                        <Textarea
                          rows={11}
                          value={form.conteudo_pericia_social || form.conteudo_1_pericia}
                          onChange={(e) => setForm((f) => ({ ...f, conteudo_pericia_social: e.target.value }))}
                          className="font-mono text-[13px]"
                          placeholder="Template para perícia social..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                {selecionadoId && (
                  <Button variant="danger" onClick={excluir} loading={excluindo}>
                    <Trash2 className="h-4 w-4" /> Excluir
                  </Button>
                )}
                <Button onClick={salvar} loading={salvando}>
                  <Save className="h-4 w-4" /> Salvar template
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-400">
                Pré-visualização ({aba === "1" ? "1 perícia" : "2 perícias"})
              </p>
              <div className="space-y-3">
                {(aba === "1" ? [preview1] : preview2).map((msg, i) => (
                  <div
                    key={i}
                    className="whitespace-pre-wrap rounded-2xl rounded-tl-none bg-accent-50 px-4 py-3 text-sm text-zinc-800 dark:bg-accent-900/20 dark:text-zinc-200"
                  >
                    {msg || "…"}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
