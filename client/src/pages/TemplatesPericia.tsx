import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, MessageSquareText, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Template } from "@/lib/types";
import { VARIAVEIS, EXEMPLO_PERICIAS } from "@/lib/templateSamples";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Callout, SettingsFooter } from "@/components/ui/Settings";
import { EmptyState } from "@/components/ui/EmptyState";
import { AbasInternas, CarregandoModelos, GrupoModelos, ModeloCard, PreviaWhatsApp, VariaveisInseriveis, inserirNoCursor } from "@/components/templates/ModeloEditor";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";

/** Estado do formulário: campos opcionais do Template ficam "" em vez de null, para inputs controlados. */
type TemplateForm = Omit<Template, "id" | "created_at" | "conteudo_pericia_medica" | "conteudo_pericia_social"> & {
  conteudo_pericia_medica: string;
  conteudo_pericia_social: string;
};

function novoTemplateVazio(): TemplateForm {
  return {
    nome: "Novo modelo",
    conteudo_1_pericia: "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\nQualquer dúvida, estou à disposição!",
    conteudo_2_pericias: "Olá {{NOME}}, tudo bem?\n\nVocê tem as seguintes perícias agendadas:\n\n{{#each PERICIAS}}\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\n{{/each}}\nQualquer dúvida, estou à disposição!",
    conteudo_pericia_medica: "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia MÉDICA agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\nQualquer dúvida, estou à disposição!",
    conteudo_pericia_social: "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia SOCIAL agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\nQualquer dúvida, estou à disposição!",
    modo_envio_2_pericias: "combinada",
  };
}

export function TemplatesPericia() {
  const { show } = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [form, setForm] = useState<TemplateForm>(novoTemplateVazio());
  const [aba, setAba] = useState<"1" | "2">("1");
  const [preview1, setPreview1] = useState("");
  const [preview2, setPreview2] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  const textarea1Ref = useRef<HTMLTextAreaElement>(null);
  const textarea2Ref = useRef<HTMLTextAreaElement>(null);
  const textareaMedicaRef = useRef<HTMLTextAreaElement>(null);
  const textareaSocialRef = useRef<HTMLTextAreaElement>(null);
  const focoSeparadas = useRef<"conteudo_pericia_medica" | "conteudo_pericia_social">("conteudo_pericia_medica");

  async function carregar() {
    const data = await api.get<Template[]>("/templates");
    setTemplates(data);
    if (data.length > 0 && selecionadoId === null) {
      selecionarTemplate(data.find(t => t.padrao) || data[0]);
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
        const criado = await api.post<Template>("/templates", form);
        selecionarTemplate(criado);
        show("Template criado.", "success");
      }
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar modelo.", "error");
    } finally {
      setSalvando(false);
    }
  }

  async function definirPadrao() {
    if (!selecionadoId) return;
    try {
      await api.put(`/templates/${selecionadoId}/default`, {});
      await carregar();
      show("Template padrão atualizado.", "success");
    } catch (err) { show(err instanceof ApiError ? err.message : "Erro ao definir padrão.", "error"); }
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

  function inserirVariavel(campo: "conteudo_1_pericia" | "conteudo_2_pericias" | "conteudo_pericia_medica" | "conteudo_pericia_social", variavel: string) {
    const refs = { conteudo_1_pericia: textarea1Ref, conteudo_2_pericias: textarea2Ref, conteudo_pericia_medica: textareaMedicaRef, conteudo_pericia_social: textareaSocialRef };
    inserirNoCursor(refs[campo], form[campo], variavel, (novo) => setForm((f) => ({ ...f, [campo]: novo })));
  }

  // Preview em tempo real (debounce)
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const r1 = await api.post<{ mensagens: string[] }>("/templates/preview", {
          ...form,
          nome: EXEMPLO_PERICIAS[0].nome,
          pericias: [EXEMPLO_PERICIAS[0]],
        });
        setPreview1(r1.mensagens[0] || "");

        const r2 = await api.post<{ mensagens: string[] }>("/templates/preview", {
          ...form,
          nome: EXEMPLO_PERICIAS[0].nome,
          pericias: EXEMPLO_PERICIAS,
        });
        setPreview2(r2.mensagens);
      } catch {
        // erro de preview não deve interromper a edição
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [form]);

  const atual = templates?.find((t) => t.id === selecionadoId);
  const editandoNovo = selecionadoId === null;
  const separadas = form.modo_envio_2_pericias === "separadas";
  const campoVariavel = aba === "1" ? "conteudo_1_pericia" : separadas ? focoSeparadas.current : "conteudo_2_pericias";

  return (
    <div className="space-y-5">
      <PageHeader compact
        title="Mensagens de Perícia"
        description="Textos enviados no agendamento: um para 1 perícia e outro para 2 perícias no mesmo dia."
        actions={<Button onClick={novoTemplate}><MessageSquarePlus className="h-4 w-4" /> Novo modelo</Button>}
      />

      {templates === null ? <CarregandoModelos /> : (
        <div className="space-y-5">
          <div className="surface-panel p-4">
            {templates.length === 0 ? (
              <EmptyState icon={MessageSquareText} title="Nenhum modelo de perícia" description="Preencha o formulário abaixo e salve para criar o primeiro modelo." />
            ) : (
              <GrupoModelos titulo="Modelos salvos">
                {templates.map((t) => (
                  <ModeloCard key={t.id} nome={t.nome} trecho={t.conteudo_1_pericia} padrao={!!t.padrao} selecionado={selecionadoId === t.id} onClick={() => selecionarTemplate(t)} />
                ))}
              </GrupoModelos>
            )}
            {editandoNovo && templates.length > 0 && <p className="mt-3 rounded-lg border border-dashed border-accent-300 bg-accent-50/50 px-3 py-2 text-xs text-accent-700 dark:border-accent-700 dark:bg-accent-900/10 dark:text-accent-300">Novo modelo em edição (ainda não salvo).</p>}
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <section className="surface-panel min-w-0 overflow-hidden">
              <div className="space-y-4 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <Label>Nome do modelo</Label>
                    <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
                  </div>
                  <div className="sm:w-56">
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

                <AbasInternas
                  rotulo="Quantidade de perícias"
                  abas={[{ key: "1" as const, label: "Com 1 perícia" }, { key: "2" as const, label: "Com 2 perícias" }]}
                  valor={aba}
                  onChange={setAba}
                />

                <VariaveisInseriveis
                  variaveis={aba === "2" && !separadas ? VARIAVEIS : VARIAVEIS}
                  onInsert={(v) => inserirVariavel(campoVariavel, v)}
                  fixo={aba === "2" && !separadas ? <span className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-500 dark:bg-zinc-800">{"{{#each PERICIAS}} ... {{/each}}"}</span> : undefined}
                />

                {aba === "1" ? (
                  <Textarea ref={textarea1Ref} rows={10} aria-label="Mensagem com 1 perícia" value={form.conteudo_1_pericia} onChange={(e) => setForm((f) => ({ ...f, conteudo_1_pericia: e.target.value }))} className="font-mono text-[13px]" />
                ) : !separadas ? (
                  <div className="space-y-2">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Dentro de {"{{#each PERICIAS}}"}...{"{{/each}}"}, as variáveis representam cada perícia. {"{{NOME}}"} fica fora do bloco, pois é o mesmo cliente.
                    </p>
                    <Textarea ref={textarea2Ref} rows={12} aria-label="Mensagem com 2 perícias" value={form.conteudo_2_pericias} onChange={(e) => setForm((f) => ({ ...f, conteudo_2_pericias: e.target.value }))} className="font-mono text-[13px]" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-500">Mensagem da Perícia Médica</Label>
                      <Textarea ref={textareaMedicaRef} rows={6} value={form.conteudo_pericia_medica} onFocus={() => { focoSeparadas.current = "conteudo_pericia_medica"; }} onChange={(e) => setForm((f) => ({ ...f, conteudo_pericia_medica: e.target.value }))} className="font-mono text-[13px]" placeholder="Template para perícia médica..." />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-zinc-500">Mensagem da Perícia Social</Label>
                      <Textarea ref={textareaSocialRef} rows={6} value={form.conteudo_pericia_social} onFocus={() => { focoSeparadas.current = "conteudo_pericia_social"; }} onChange={(e) => setForm((f) => ({ ...f, conteudo_pericia_social: e.target.value }))} className="font-mono text-[13px]" placeholder="Template para perícia social..." />
                    </div>
                    <Callout tone="aviso">
                      As mensagens são enviadas separadamente. Se uma perícia não for identificada como médica ou social, o sistema usa o modelo de «1 perícia».
                    </Callout>
                  </div>
                )}
              </div>
              <SettingsFooter left={atual?.padrao ? undefined : selecionadoId ? "Este modelo não é o padrão." : undefined}>
                {selecionadoId && (
                  <Button variant="outline" onClick={definirPadrao} disabled={!!atual?.padrao}>Usar como padrão</Button>
                )}
                {selecionadoId && (
                  <Button variant="outline" className="danger-action" onClick={excluir} loading={excluindo}>
                    <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" /> Excluir
                  </Button>
                )}
                <Button onClick={salvar} loading={salvando}>
                  <Save className="h-4 w-4" /> Salvar modelo
                </Button>
              </SettingsFooter>
            </section>

            <aside className="min-w-0 lg:sticky lg:top-24">
              <PreviaWhatsApp
                titulo={`Prévia no WhatsApp (${aba === "1" ? "1 perícia" : "2 perícias"})`}
                mensagens={aba === "1" ? [preview1] : preview2}
              />
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
