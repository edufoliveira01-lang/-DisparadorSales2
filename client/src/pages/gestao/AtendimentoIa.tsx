import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Campo } from "./comum";

interface Area { id: string; nome: string; ativa: boolean; triagem: string[]; documentos: string[]; propria?: boolean }
interface Config { nome_agente: string; areas: Area[]; honorarios_politica: string; horario: string; urgencia: string; observacoes: string; pendencias: string[]; prompt: string }

const linhas = (t: string) => t.split("\n");

/** Cadastro do agente de IA do atendimento (Deskcomm): o prompt sai pronto daqui + dos dados do escritório. */
export function AtendimentoIa() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [r, setR] = useState<Config | null>(null);
  const [c, setC] = useState<Omit<Config, "pendencias" | "prompt"> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const aplicar = (x: Config) => { setR(x); setC({ nome_agente: x.nome_agente, areas: x.areas, honorarios_politica: x.honorarios_politica, horario: x.horario, urgencia: x.urgencia, observacoes: x.observacoes }); };
  const carregar = useCallback(async () => {
    try { aplicar(await api.get<Config>("/gestao/atendimento-ia", { fresh: true } as never)); }
    catch { show("Não foi possível carregar o cadastro do atendimento com IA.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!r || !c) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;

  const sujo = JSON.stringify(c) !== JSON.stringify({ nome_agente: r.nome_agente, areas: r.areas, honorarios_politica: r.honorarios_politica, horario: r.horario, urgencia: r.urgencia, observacoes: r.observacoes });
  const salvar = async () => {
    setSalvando(true);
    try { aplicar(await api.put<Config>("/gestao/atendimento-ia", c)); show("Cadastro salvo. Atualize o agente no Deskcomm para usar o texto novo.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const mudaArea = (i: number, patch: Partial<Area>) => setC({ ...c, areas: c.areas.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  return (
    <div className="space-y-5">
      <PageHeader title="Atendimento com IA" description="O agente de IA do WhatsApp é montado a partir daqui e dos dados do escritório. No Deskcomm, o botão “Atualizar agente do escritório” traz o texto pronto como rascunho."
        actions={gerir ? <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar</Button> : undefined} />
      {r.pendencias.length > 0 && (
        <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <ul className="list-disc space-y-1 pl-4">{r.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={!gerir} className="space-y-5">
          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Identidade e horário</h2>
            <p className="text-[13px] text-zinc-500">Nome, endereço, telefones e advogados vêm de <a className="underline" href="/configuracoes/escritorio">Dados do escritório</a>.</p>
            <Campo rotulo="Nome do agente"><Input value={c.nome_agente} onChange={(e) => setC({ ...c, nome_agente: e.target.value })} className="mt-1.5" placeholder="Ex.: Sofia" /></Campo>
            <Campo rotulo="Horário de atendimento humano"><Input value={c.horario} onChange={(e) => setC({ ...c, horario: e.target.value })} className="mt-1.5" placeholder="segunda a sexta, das 9h às 18h" /></Campo>
            <Campo rotulo="Contato para urgência (opcional)"><Input value={c.urgencia} onChange={(e) => setC({ ...c, urgencia: e.target.value })} className="mt-1.5" placeholder="(13) 99999-0000" /></Campo>
          </section>

          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Áreas atendidas</h2>
            <p className="text-[13px] text-zinc-500">Marque as áreas do escritório. Cada uma tem perguntas de triagem e documentos: já vêm preenchidos nas áreas prontas, e você pode editar. Também pode criar uma área sua.</p>
            {c.areas.map((a, i) => (
              <div key={a.id || `nova-${i}`} className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={a.ativa} onChange={(e) => mudaArea(i, { ativa: e.target.checked })} />
                    {a.propria ? <Input value={a.nome} onChange={(e) => mudaArea(i, { nome: e.target.value })} aria-label="Nome da área" className="max-w-xs" /> : a.nome}
                  </label>
                  {a.propria && <Button type="button" variant="ghost" size="sm" aria-label="Remover área" onClick={() => setC({ ...c, areas: c.areas.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                {a.ativa && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo rotulo="Perguntas de triagem (uma por linha)"><Textarea rows={7} value={a.triagem.join("\n")} onChange={(e) => mudaArea(i, { triagem: linhas(e.target.value) })} className="mt-1.5 text-[14px]" /></Campo>
                    <Campo rotulo="Documentos que o escritório pede (um por linha)"><Textarea rows={7} value={a.documentos.join("\n")} onChange={(e) => mudaArea(i, { documentos: linhas(e.target.value) })} className="mt-1.5 text-[14px]" /></Campo>
                  </div>
                )}
              </div>
            ))}
            {gerir && <Button type="button" variant="outline" size="sm" onClick={() => setC({ ...c, areas: [...c.areas, { id: "", nome: "", ativa: true, triagem: [], documentos: [], propria: true }] })}><Plus className="h-4 w-4" /> Criar uma área</Button>}
          </section>

          <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Honorários e orientações</h2>
            <Campo rotulo="O que o agente pode dizer sobre honorários">
              <Textarea rows={8} maxLength={3000} value={c.honorarios_politica} onChange={(e) => setC({ ...c, honorarios_politica: e.target.value })} className="mt-1.5 text-[14px]" placeholder="Deixe em branco para o agente NÃO informar valores e passar ao atendente. Ex.: Trabalhamos com êxito; o atendente apresenta as condições." />
            </Campo>
            <Campo rotulo="Outras orientações do escritório (opcional)">
              <Textarea rows={5} maxLength={3000} value={c.observacoes} onChange={(e) => setC({ ...c, observacoes: e.target.value })} className="mt-1.5 text-[14px]" placeholder="Ex.: Não atendemos causas abaixo de determinado valor. Sempre pergunte se o cliente já tem advogado." />
            </Campo>
          </section>
        </fieldset>

        <section className="min-w-0 space-y-2">
          <h2 className="text-base font-semibold">Texto gerado para o agente</h2>
          <p className="text-[13px] text-zinc-500">É assim que o agente vai ler{sujo ? " (salve para atualizar)" : ""}. Peça a um advogado do escritório para revisar antes de publicar no Deskcomm.</p>
          <pre className="max-h-[78vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-[13px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-950/40">{r.prompt}</pre>
        </section>
      </div>
    </div>
  );
}
