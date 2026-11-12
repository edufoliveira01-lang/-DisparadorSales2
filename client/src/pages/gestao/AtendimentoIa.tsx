import { useCallback, useEffect, useState } from "react";
import { Bot, Briefcase, Plus, Save, Trash2, Wallet, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Skeleton } from "@/components/ui/Skeleton";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";

interface Area { id: string; nome: string; ativa: boolean; triagem: string[]; documentos: string[]; propria?: boolean }
interface Config { nome_agente: string; areas: Area[]; honorarios_politica: string; horario: string; urgencia: string; observacoes: string; exigir_documentos: boolean; revisao_humana: boolean; pendencias: string[]; prompt: string }

const linhas = (t: string) => t.split("\n");

/** Cadastro do agente de IA do atendimento (Deskcomm): o prompt sai pronto daqui + dos dados do escritório. */
export function AtendimentoIa() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [r, setR] = useState<Config | null>(null);
  const [c, setC] = useState<Omit<Config, "pendencias" | "prompt"> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const aplicar = (x: Config) => { setR(x); setC({ nome_agente: x.nome_agente, areas: x.areas, honorarios_politica: x.honorarios_politica, horario: x.horario, urgencia: x.urgencia, observacoes: x.observacoes, exigir_documentos: x.exigir_documentos, revisao_humana: x.revisao_humana }); };
  const carregar = useCallback(async () => {
    try { aplicar(await api.get<Config>("/gestao/atendimento-ia", { fresh: true } as never)); }
    catch { show("Não foi possível carregar o cadastro do atendimento com IA.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!r || !c) return <div className="space-y-4" role="status" aria-label="Carregando"><Skeleton className="h-16 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>;

  const sujo = JSON.stringify(c) !== JSON.stringify({ nome_agente: r.nome_agente, areas: r.areas, honorarios_politica: r.honorarios_politica, horario: r.horario, urgencia: r.urgencia, observacoes: r.observacoes, exigir_documentos: r.exigir_documentos, revisao_humana: r.revisao_humana });
  const salvar = async () => {
    setSalvando(true);
    try { aplicar(await api.put<Config>("/gestao/atendimento-ia", c)); show("Cadastro salvo. Atualize o agente no Deskcomm para usar o texto novo.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const mudaArea = (i: number, patch: Partial<Area>) => setC({ ...c, areas: c.areas.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const ativas = c.areas.filter((a) => a.ativa).length;
  const rotulo = "mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300";

  return (
    <div className="space-y-5">
      <PageHeader title="Atendimento com IA" description="O agente do WhatsApp é montado a partir daqui e dos dados do escritório. No Deskcomm, «Atualizar agente do escritório» traz o texto pronto como rascunho."
        actions={gerir ? <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar</Button> : undefined} />
      {r.pendencias.length > 0 && (
        <Callout tone="aviso">
          <p className="font-medium">Falta completar para o agente funcionar bem:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{r.pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
        </Callout>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={!gerir} className="min-w-0 space-y-5">
          <SettingsPanel icon={<Bot />} title="Identidade e horário" description={<>Nome, endereço, telefones e advogados vêm de <Link className="underline" to="/configuracoes/escritorio">Dados do escritório</Link>.</>}
            status={<Badge tone={c.nome_agente.trim() ? "success" : "warning"}>{c.nome_agente.trim() ? `Agente: ${c.nome_agente}` : "Sem nome"}</Badge>}>
            <SettingsBlock>
              <SettingRow label="Nome do agente" hint="Como ele se apresenta ao cliente." htmlFor="ia-nome"><Input id="ia-nome" value={c.nome_agente} onChange={(e) => setC({ ...c, nome_agente: e.target.value })} placeholder="Ex.: Sofia" /></SettingRow>
              <SettingRow label="Horário de atendimento humano" hint="Quando a equipe responde." htmlFor="ia-horario"><Input id="ia-horario" value={c.horario} onChange={(e) => setC({ ...c, horario: e.target.value })} placeholder="segunda a sexta, das 9h às 18h" /></SettingRow>
              <SettingRow label="Contato para urgência" hint="Opcional." htmlFor="ia-urg"><Input id="ia-urg" value={c.urgencia} onChange={(e) => setC({ ...c, urgencia: e.target.value })} placeholder="(13) 99999-0000" /></SettingRow>
            </SettingsBlock>
          </SettingsPanel>

          <SettingsPanel icon={<Briefcase />} title="Áreas atendidas" description="Marque as áreas do escritório. Cada uma tem perguntas de triagem e documentos, que você pode editar."
            status={<Badge tone={ativas ? "accent" : "warning"}>{ativas} ativa(s)</Badge>}
            actions={gerir ? <Button type="button" size="sm" variant="outline" onClick={() => setC({ ...c, areas: [...c.areas, { id: "", nome: "", ativa: true, triagem: [], documentos: [], propria: true }] })}><Plus className="h-4 w-4" /> Criar área</Button> : undefined}>
            {c.areas.map((a, i) => (
              <SettingsBlock key={a.id || `nova-${i}`}>
                <div className="flex items-center gap-3">
                  <label className="flex min-w-0 flex-1 items-center gap-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    <Checkbox checked={a.ativa} onChange={(e) => mudaArea(i, { ativa: e.target.checked })} aria-label={`Atender a área ${a.nome}`} />
                    {a.propria ? <Input value={a.nome} onChange={(e) => mudaArea(i, { nome: e.target.value })} aria-label="Nome da área" placeholder="Nome da área" className="max-w-xs" /> : a.nome}
                  </label>
                  {a.propria && <Button type="button" variant="ghost" size="sm" aria-label="Remover área" onClick={() => setC({ ...c, areas: c.areas.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                {a.ativa && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><label className={rotulo}>Perguntas de triagem (uma por linha)</label><Textarea rows={7} value={a.triagem.join("\n")} onChange={(e) => mudaArea(i, { triagem: linhas(e.target.value) })} /></div>
                    <div><label className={rotulo}>Documentos que o escritório pede (um por linha)</label><Textarea rows={7} value={a.documentos.join("\n")} onChange={(e) => mudaArea(i, { documentos: linhas(e.target.value) })} /></div>
                  </div>
                )}
              </SettingsBlock>
            ))}
          </SettingsPanel>

          <SettingsPanel icon={<Wallet />} title="Honorários e regras" description="O que o agente pode dizer e quando ele passa o caso à equipe.">
            <SettingsBlock>
              <SettingRow label="Honorários" hint="Em branco: o agente não informa valores e passa ao atendente." htmlFor="ia-hon">
                <Textarea id="ia-hon" rows={6} maxLength={3000} value={c.honorarios_politica} onChange={(e) => setC({ ...c, honorarios_politica: e.target.value })} placeholder="Ex.: Trabalhamos com êxito; o atendente apresenta as condições." />
              </SettingRow>
              <SettingRow label="Exigir documentos antes do contrato" hint="Desligado: o agente pede os documentos, mas segue para o contrato; eles podem vir depois da assinatura.">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><Checkbox checked={c.exigir_documentos} onChange={(e) => setC({ ...c, exigir_documentos: e.target.checked })} /> {c.exigir_documentos ? "Só envia o contrato após receber os documentos essenciais" : "Segue para o contrato sem esperar os documentos"}</label>
              </SettingRow>
              <SettingRow label="Equipe revisa antes do contrato" hint="Desligado: após o aceite e a confirmação dos dados, o agente envia o contrato sozinho.">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><Checkbox checked={c.revisao_humana} onChange={(e) => setC({ ...c, revisao_humana: e.target.checked })} /> {c.revisao_humana ? "Passa a conversa à equipe, que envia o contrato" : "O agente envia o contrato sozinho"}</label>
              </SettingRow>
              <SettingRow label="Outras orientações" hint="Opcional. Regras próprias do escritório." htmlFor="ia-obs">
                <Textarea id="ia-obs" rows={4} maxLength={3000} value={c.observacoes} onChange={(e) => setC({ ...c, observacoes: e.target.value })} placeholder="Ex.: Sempre pergunte se o cliente já tem advogado." />
              </SettingRow>
            </SettingsBlock>
          </SettingsPanel>
          {gerir && (
            <div className="sticky bottom-3 z-10 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              <SettingsFooter left={sujo ? <span className="font-medium text-amber-700 dark:text-amber-300">Há alterações não salvas.</span> : "Tudo salvo."}>
                <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar alterações</Button>
              </SettingsFooter>
            </div>
          )}
        </fieldset>

        <SettingsPanel className="min-w-0 self-start" icon={<FileText />} title="Texto gerado para o agente" description="É assim que o agente vai ler. Peça a um advogado para revisar antes de publicar no Deskcomm."
          status={sujo ? <Badge tone="warning">Salve para atualizar</Badge> : <Badge tone="success">Atualizado</Badge>}>
          <div className="p-5"><pre className="max-h-[78vh] overflow-auto whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-[13px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-950/40">{r.prompt}</pre></div>
        </SettingsPanel>
      </div>
    </div>
  );
}
