import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, ListChecks, RefreshCw, MoreHorizontal, CalendarClock, UserCheck, AlertTriangle } from "lucide-react";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { PRIORIDADES, PRIORIDADE_TOM, dataBr, useAtraso, type Lista } from "./comum";
import { TarefaModal, type Tarefa } from "./TarefaModal";
import type { Responsavel } from "./Processos";

const TAM = 30;
interface Resumo { atrasadas: number; hoje: number; proximos_7_dias: number; fatais_5_dias: number }
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
type Grupo = "atrasadas" | "hoje" | "semana" | "depois" | "sem_prazo" | "feitas";
const GRUPOS: { chave: Grupo; rotulo: string; tom: string }[] = [
  { chave: "atrasadas", rotulo: "Atrasadas", tom: "text-red-600 dark:text-red-400" }, { chave: "hoje", rotulo: "Hoje", tom: "text-amber-600 dark:text-amber-400" },
  { chave: "semana", rotulo: "Próximos 7 dias", tom: "text-accent-700 dark:text-accent-300" }, { chave: "depois", rotulo: "Mais adiante", tom: "text-zinc-600 dark:text-zinc-300" },
  { chave: "sem_prazo", rotulo: "Sem prazo", tom: "text-zinc-500" }, { chave: "feitas", rotulo: "Concluídas", tom: "text-zinc-500" },
];
function grupoDe(t: Tarefa, hoje: string): Grupo {
  if (!t.aberta) return "feitas";
  if (!t.prazo) return "sem_prazo";
  if (t.prazo < hoje) return "atrasadas";
  if (t.prazo === hoje) return "hoje";
  return t.prazo <= somarDias(hoje, 7) ? "semana" : "depois";
}
export function Tarefas() {
  const { user, can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [responsavel, setResponsavel] = useState("eu");
  const [status, setStatus] = useState("abertas");
  const [periodo, setPeriodo] = useState("");
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<Lista<Tarefa> | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [editando, setEditando] = useState<Tarefa | "nova" | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<Lista<Tarefa>>(`/gestao/tarefas?limite=${TAM}&pagina=${pagina + 1}&responsavel=${responsavel}&status=${status}&periodo=${periodo}&busca=${encodeURIComponent(termo)}`)); }
    catch { show("Não foi possível carregar as tarefas.", "error"); }
  }, [pagina, responsavel, status, periodo, termo, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setPagina(0); }, [responsavel, status, periodo, termo]);
  const lerResumo = useCallback(() => { api.get<{ tarefas?: Resumo }>("/gestao/dashboard", { fresh: true } as never).then((d) => setResumo(d.tarefas ?? null)).catch(() => undefined); }, []);
  useEffect(() => { lerResumo(); }, [lerResumo]);
  useEffect(() => { api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, []);

  const concluir = async (t: Tarefa) => {
    try { await api.post(`/gestao/tarefas/${t.id}/concluir`, { concluida: t.aberta }); await carregar(); lerResumo(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível atualizar.", "error"); }
  };
  const sincronizar = async () => {
    setSincronizando(true);
    try { const r = await api.post<{ criadas: number; atualizadas: number }>("/gestao/tarefas/sincronizar-djen", {}); show(`${r.criadas} tarefa(s) criada(s) a partir dos prazos do DJEN.`, "success"); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível sincronizar.", "error"); }
    finally { setSincronizando(false); }
  };
  /** Ações rápidas da linha: adiar o prazo ou assumir a tarefa, sem abrir o formulário. */
  const mudar = async (t: Tarefa, corpo: Record<string, unknown>, ok: string) => {
    try { await api.put(`/gestao/tarefas/${t.id}`, corpo); show(ok, "success"); await carregar(); lerResumo(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível atualizar.", "error"); }
  };
  const adiar = (t: Tarefa, dias: number) => { const base = t.prazo && t.prazo > hojeSP() ? t.prazo : hojeSP(); return mudar(t, { prazo: somarDias(base, dias) }, `Prazo movido para ${dataBr(somarDias(base, dias))}.`); };
  const lista = dados?.itens ?? [];
  const hoje = hojeSP();
  const porGrupo = GRUPOS.map((g) => ({ ...g, itens: lista.filter((t) => grupoDe(t, hoje) === g.chave) })).filter((g) => g.itens.length > 0);
  const chips: { rotulo: string; valor: number | undefined; tom: string; aoClicar: () => void }[] = [
    { rotulo: "Atrasadas", valor: resumo?.atrasadas, tom: "text-red-600", aoClicar: () => { setResponsavel(""); setStatus("abertas"); setPeriodo("atrasadas"); } },
    { rotulo: "Hoje", valor: resumo?.hoje, tom: "text-amber-600", aoClicar: () => { setResponsavel(""); setStatus("abertas"); setPeriodo("hoje"); } },
    { rotulo: "Próximos 7 dias", valor: resumo?.proximos_7_dias, tom: "text-accent-700", aoClicar: () => { setResponsavel(""); setStatus("abertas"); setPeriodo("semana"); } },
    { rotulo: "Prazos fatais (5 dias)", valor: resumo?.fatais_5_dias, tom: "text-red-600", aoClicar: () => { setResponsavel(""); setStatus("abertas"); setPeriodo("semana"); setBusca(""); } },
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="Tarefas" description="Prazos e afazeres do escritório. Os prazos do DJEN dos processos com ficha entram aqui sozinhos."
        actions={gerir ? <div className="flex gap-2"><Button variant="outline" loading={sincronizando} onClick={() => void sincronizar()}><RefreshCw className="h-4 w-4" /> Buscar prazos do DJEN</Button><Button onClick={() => setEditando("nova")}><Plus className="h-4 w-4" /> Nova tarefa</Button></div> : undefined} />
      {resumo && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {chips.map((c) => (
            <button key={c.rotulo} type="button" onClick={c.aoClicar} className="surface-panel flex items-center justify-between gap-2 px-4 py-3 text-left transition hover:border-accent-300 dark:hover:border-accent-500/40">
              <span className="text-xs text-zinc-500">{c.rotulo}</span>
              <span className={`text-xl font-semibold tabular-nums ${c.valor ? c.tom : "text-zinc-400"} dark:brightness-125`}>{c.valor ?? "…"}</span>
            </button>))}
        </div>)}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_190px_150px_150px]">
        <div className="relative sm:col-span-2 lg:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" placeholder="Buscar tarefa, processo ou pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar tarefas" /></div>
        <Select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} aria-label="Responsável"><option value="eu">Minhas tarefas</option><option value="">Todas as pessoas</option><option value="sem">Sem responsável</option>{resp.filter((r) => r.id !== user.id).map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="abertas">Em aberto</option><option value="concluida">Concluídas</option><option value="">Todas</option></Select>
        <Select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período"><option value="">Qualquer prazo</option><option value="atrasadas">Atrasadas</option><option value="hoje">Hoje</option><option value="semana">Próximos 7 dias</option></Select>
      </div>
      {dados && lista.length === 0 ? (
        <EmptyState icon={ListChecks} title="Nenhuma tarefa por aqui" description={status === "abertas" && responsavel === "eu" ? "Você está em dia. Crie uma tarefa ou veja as de toda a equipe." : "Ajuste os filtros ou crie uma tarefa."} action={gerir ? <Button onClick={() => setEditando("nova")}><Plus className="h-4 w-4" /> Nova tarefa</Button> : undefined} />
      ) : (
        <div className="space-y-4">
          {porGrupo.map((g) => (
            <section key={g.chave}>
              <h2 className={`mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider ${g.tom}`}>{g.chave === "atrasadas" && <AlertTriangle className="h-3.5 w-3.5" />}{g.rotulo} <span className="font-normal text-zinc-400">· {g.itens.length}</span></h2>
              <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-white/10">
                {g.itens.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-violet-600" checked={!t.aberta} disabled={!gerir || t.status === "cancelada"} onChange={() => void concluir(t)} aria-label={t.aberta ? `Concluir ${t.titulo}` : `Reabrir ${t.titulo}`} />
                  <button type="button" onClick={() => setEditando(t)} className="min-w-0 flex-1 text-left">
                    <span className={`block text-sm font-semibold ${t.aberta ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through"}`}>{t.titulo}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      {t.prazo && <span className={t.atrasada ? "font-semibold text-red-600" : ""}>{t.atrasada ? "Atrasada · " : "Prazo "}{dataBr(t.prazo)}</span>}
                      {t.processo_pasta && <span>Pasta {t.processo_pasta}</span>}
                      <span>{t.responsavel || "Sem responsável"}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {t.prazo_fatal && t.aberta && <Badge tone="danger">Fatal</Badge>}
                    {t.origem === "djen" && <Badge tone="info">DJEN</Badge>}
                    {t.aberta && t.prioridade !== "normal" && <Badge tone={PRIORIDADE_TOM[t.prioridade]}>{PRIORIDADES[t.prioridade]}</Badge>}
                    {t.processo_id && <Link to={`/gestao/processos/${t.processo_id}`} className="text-xs text-accent-700 hover:underline">Abrir</Link>}
                    {gerir && t.aberta && (
                      <MenuSuspenso gatilho={({ alternar }) => <button type="button" onClick={alternar} aria-label={`Ações da tarefa ${t.titulo}`} className="topbar-icon !h-8 !w-8"><MoreHorizontal className="h-4 w-4" /></button>}>
                        {(fechar) => (<>
                          <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); void adiar(t, 1); }}><CalendarClock className="h-4 w-4" /> Adiar 1 dia</button>
                          <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); void adiar(t, 7); }}><CalendarClock className="h-4 w-4" /> Adiar 1 semana</button>
                          {t.responsavel_user_id !== user.id && <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); void mudar(t, { responsavel_user_id: user.id }, "Tarefa assumida por você."); }}><UserCheck className="h-4 w-4" /> Assumir</button>}
                        </>)}
                      </MenuSuspenso>)}
                  </div>
                </li>
                ))}
              </ul>
            </section>))}
        </div>
      )}
      <Pagination page={pagina} totalItems={dados?.total ?? 0} pageSize={TAM} onPageChange={setPagina} />
      {editando && <TarefaModal tarefa={editando === "nova" ? null : editando} responsaveis={resp} meuId={user.id} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); void carregar(); }} />}
    </div>
  );
}
