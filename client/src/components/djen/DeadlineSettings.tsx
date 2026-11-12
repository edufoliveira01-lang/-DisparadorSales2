import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { CalendarDays, CalendarRange, ChevronDown, Search } from "lucide-react";
type Calendario = {
  tribunal: string;
  orgao: string;
  inicio: string;
  fim: string;
  fonte: string;
  conferido: boolean;
  feriados: string[];
  suspensoes: { inicio: string; fim: string; motivo: string }[];
};
type Config = {
  calendarId: string;
  calendarName: string;
  calendarios: Calendario[];
};
export function DeadlineSettings({ manualOnly = false, initialCalendar }: { manualOnly?: boolean; initialCalendar?: { tribunal: string; orgao: string; ano: number } } = {}) {
  const parametros = initialCalendar ? new URLSearchParams({ tribunal: initialCalendar.tribunal, orgao: initialCalendar.orgao, ano: String(initialCalendar.ano) }) : new URLSearchParams(window.location.search);
  const anoSolicitado = Number(parametros.get("ano"));
  const ano = Number.isInteger(anoSolicitado) && anoSolicitado >= 2000 && anoSolicitado <= 2100 ? anoSolicitado : new Date().getFullYear(),
    vazio = {
      tribunal: parametros.get("tribunal")?.slice(0, 20) || "",
      orgao: parametros.get("orgao")?.slice(0, 300) || "",
      inicio: `${ano}-01-01`,
      fim: `${ano}-12-31`,
      fonte: "",
      conferido: false,
      feriados: "",
      suspensoes: "",
    };
  const [config, setConfig] = useState<Config | null>(null),
    [agendas, setAgendas] = useState<{ id: string; summary: string }[]>([]),
    [form, setForm] = useState(vazio),
    [indice, setIndice] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [busca, setBusca] = useState(""),
    [filtro, setFiltro] = useState<"todos" | "conferido" | "pendente">("todos");
  const { show } = useToast(),
    falha = (e: unknown) =>
      show(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Não foi possível salvar.",
        "error",
      );
  useEffect(() => {
    void api.get<Config>("/djen/prazos/config").then(setConfig).catch(falha);
  }, []);
  async function salvar(c: Config) {
    if (busy) return;
    setBusy(true);
    try {
      setConfig(await api.put<Config>("/djen/prazos/config", c));
      show("Configurações de prazos salvas.", "success");
    } catch (e) {
      falha(e);
    } finally {
      setBusy(false);
    }
  }
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (config?.calendarios ?? [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (filtro === "todos" || (filtro === "conferido") === c.conferido)
        && (!termo || `${c.tribunal} ${c.orgao}`.toLowerCase().includes(termo)));
  }, [config, busca, filtro]);
  const porTribunal = useMemo(() => {
    const grupos = new Map<string, typeof visiveis>();
    for (const item of visiveis) grupos.set(item.c.tribunal || "Sem sigla", [...(grupos.get(item.c.tribunal || "Sem sigla") ?? []), item]);
    return [...grupos.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [visiveis]);
  if (!config)
    return <div role="status" aria-label="Carregando configuração de prazos" className="surface-panel space-y-3 p-5"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;
  const total = config.calendarios.length;
  const conferidos = config.calendarios.filter((c) => c.conferido).length;
  const salvarCalendario = () => {
    const c: Calendario = {
      ...form,
      tribunal: form.tribunal.trim(),
      orgao: form.orgao.trim(),
      feriados: [...new Set(form.feriados.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean))],
      suspensoes: form.suspensoes
        .split("\n")
        .filter((s) => s.trim())
        .map((s) => {
          const [inicio, fim, ...m] = s.split("|").map((s) => s.trim());
          return { inicio, fim, motivo: m.join("|") };
        }),
    };
    const calendarios = [...config.calendarios];
    if (indice === null) calendarios.push(c);
    else calendarios[indice] = c;
    void salvar({ ...config, calendarios });
  };
  return (
    <div className="space-y-5">
      {!manualOnly && <>
        <SettingsPanel
          icon={<CalendarDays />}
          title="Agenda dos prazos"
          description="Onde os prazos processuais são lançados no Google Agenda. Use uma agenda diferente da das perícias."
          status={config.calendarId
            ? <Badge tone="success">Agenda: {config.calendarName || config.calendarId}</Badge>
            : <Badge tone="warning">Nenhuma agenda selecionada</Badge>}
        >
          <SettingsBlock>
            <SettingRow label="Agenda Google para os prazos" htmlFor="agenda-prazos" hint="Carregue as agendas da conta Google e escolha uma.">
              <Select
                id="agenda-prazos"
                value={config.calendarId}
                onChange={(e) => {
                  const a = agendas.find((a) => a.id === e.target.value);
                  setConfig({ ...config, calendarId: e.target.value, calendarName: a?.summary || "" });
                }}
              >
                <option value="">Nenhuma agenda selecionada</option>
                {config.calendarId && !agendas.some((a) => a.id === config.calendarId) && (
                  <option value={config.calendarId}>{config.calendarName || config.calendarId}</option>
                )}
                {agendas.map((a) => <option key={a.id} value={a.id}>{a.summary}</option>)}
              </Select>
              <Button variant="outline" size="sm" onClick={() => void api.get<typeof agendas>("/google-calendar/calendars").then(setAgendas).catch(falha)}>
                Carregar agendas da conta Google
              </Button>
            </SettingRow>
            <Callout tone="info">O evento é criado no dia do término do prazo; o início e as observações ficam na descrição. Se faltar conta Google, conecte em Configurações → Google Agenda.</Callout>
          </SettingsBlock>
          <SettingsFooter left="A conta Google é a mesma das conexões compartilhadas.">
            <Button loading={busy} onClick={() => void salvar(config)}>Salvar agenda</Button>
          </SettingsFooter>
        </SettingsPanel>

        <SettingsPanel icon={<CalendarRange />} title="Calendários automáticos dos tribunais" description="Feriados e suspensões importados das fontes oficiais, usados na contagem dos prazos.">
          <SettingsBlock>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">Consulte a cobertura, procure por tribunal ou órgão e veja quais fontes precisam de atenção.</p>
            <div><Link to="/processos/calendarios" className="inline-flex"><Button variant="outline" size="sm" tabIndex={-1}>Abrir calendários de prazos</Button></Link></div>
          </SettingsBlock>
        </SettingsPanel>
      </>}

      <details className="surface-panel group overflow-hidden" id="calendario-manual" open={manualOnly || new URLSearchParams(window.location.search).has("manual")}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Calendário manual (alternativa)</h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Use quando não houver fonte automática para o tribunal ou a unidade.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{total} cadastrado(s)</Badge>
            {total > 0 && <Badge tone={conferidos === total ? "success" : "warning"}>{conferidos === total ? "Todos conferidos" : `${total - conferidos} a conferir`}</Badge>}
            <ChevronDown className="h-4 w-4 text-zinc-400 transition-transform group-open:rotate-180" />
          </div>
        </summary>
        <div className="divide-y divide-zinc-100 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <SettingsBlock title="Calendários cadastrados">
            <Callout tone="info">O recesso do CPC (20/12 a 20/01) é aplicado à contagem, separado dos feriados de expediente. O cálculo bloqueia datas fora da cobertura conferida, e um calendário manual conferido tem prioridade sobre a importação no seu período.</Callout>
            {total > 4 && (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input aria-label="Buscar calendário por tribunal ou órgão" className="pl-9" placeholder="Buscar por tribunal ou órgão" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
                <Select aria-label="Filtrar por situação" value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
                  <option value="todos">Todas as situações</option>
                  <option value="conferido">Conferidos</option>
                  <option value="pendente">A conferir</option>
                </Select>
              </div>
            )}
            {total === 0 ? <EmptyState icon={CalendarDays} title="Nenhum calendário manual" description="Cadastre abaixo a cobertura de um tribunal ou unidade." />
              : porTribunal.length === 0 ? <p className="py-4 text-center text-sm text-zinc-500">Nenhum calendário corresponde à busca.</p>
              : <div className="space-y-4">
                {porTribunal.map(([tribunal, itens]) => (
                  <div key={tribunal} className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{tribunal} ({itens.length})</h4>
                    {itens.map(({ c, i }) => (
                      <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-800">
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.orgao || "Geral do tribunal"}</p>
                          <p className="text-zinc-500 dark:text-zinc-400">{c.inicio} a {c.fim} · {c.feriados.length} feriados · {c.suspensoes.length} suspensões</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={c.conferido ? "success" : "warning"}>{c.conferido ? "Conferido" : "A conferir"}</Badge>
                            {c.fonte && <a href={c.fonte} target="_blank" rel="noreferrer" className="text-accent-600 underline dark:text-accent-300">Fonte oficial</a>}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => {
                            setIndice(i);
                            setForm({ ...c, feriados: c.feriados.join("\n"), suspensoes: c.suspensoes.map((s) => `${s.inicio}|${s.fim}|${s.motivo}`).join("\n") });
                            setTimeout(() => document.getElementById("cal-tribunal")?.focus(), 0);
                          }}>Editar</Button>
                          <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" loading={busy} onClick={() => void salvar({ ...config, calendarios: config.calendarios.filter((_, j) => i !== j) })}>Remover calendário</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>}
          </SettingsBlock>

          <SettingsBlock title={indice === null ? "Adicionar calendário forense" : "Editar calendário forense"} description="Informe o órgão exatamente como aparece no andamento.">
            {indice !== null && <Callout tone="aviso">Editando {form.tribunal} · {form.orgao || "Geral do tribunal"}. Use Limpar formulário para cancelar.</Callout>}
            <SettingRow label="Sigla do tribunal" htmlFor="cal-tribunal">
              <Input id="cal-tribunal" placeholder="TJSP, TRF3, TRF4…" value={form.tribunal} onChange={(e) => setForm({ ...form, tribunal: e.target.value.toUpperCase() })} />
            </SettingRow>
            <SettingRow label="Órgão/unidade" htmlFor="cal-orgao" hint="Vazio = calendário geral do tribunal.">
              <Input id="cal-orgao" placeholder="Mesmo nome exibido na publicação" value={form.orgao} onChange={(e) => setForm({ ...form, orgao: e.target.value })} />
            </SettingRow>
            <SettingRow label="Cobertura" htmlFor="cal-inicio" hint="Período em que o calendário vale.">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input id="cal-inicio" type="date" aria-label="Cobertura inicial" value={form.inicio} onChange={(e) => setForm({ ...form, inicio: e.target.value })} />
                <Input id="cal-fim" type="date" aria-label="Cobertura final" value={form.fim} onChange={(e) => setForm({ ...form, fim: e.target.value })} />
              </div>
            </SettingRow>
            <SettingRow label="Fonte oficial" htmlFor="cal-fonte" hint="Link do calendário ou ato do tribunal (.jus.br).">
              <Input id="cal-fonte" placeholder="https://…jus.br/…" value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} />
            </SettingRow>
            <SettingRow label="Feriados e dias sem expediente" htmlFor="cal-feriados" hint="Formato AAAA-MM-DD, um por linha.">
              <Textarea id="cal-feriados" rows={6} value={form.feriados} onChange={(e) => setForm({ ...form, feriados: e.target.value })} />
            </SettingRow>
            <SettingRow label="Suspensões de prazo" htmlFor="cal-suspensoes" hint="Formato início|fim|motivo, uma por linha.">
              <Textarea id="cal-suspensoes" rows={6} placeholder="2026-10-26|2026-10-27|Ato de suspensão…" value={form.suspensoes} onChange={(e) => setForm({ ...form, suspensoes: e.target.value })} />
            </SettingRow>
            <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <Checkbox checked={form.conferido} onChange={(e) => setForm({ ...form, conferido: e.target.checked })} />
              <span>Conferi a cobertura completa na fonte oficial, incluindo feriados locais e suspensões aplicáveis à unidade/processo.</span>
            </label>
          </SettingsBlock>
          <SettingsFooter left={<Link to="/processos/publicacoes" className="text-accent-600 underline dark:text-accent-300">Voltar às publicações</Link>}>
            <Button variant="outline" onClick={() => { setForm(vazio); setIndice(null); }}>Limpar formulário</Button>
            <Button loading={busy} onClick={salvarCalendario}>Salvar calendário</Button>
          </SettingsFooter>
        </div>
      </details>
    </div>
  );
}
