import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, CheckCircle2, ClipboardList, Download, Flame, Contact, Plus, ArrowRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { dataBr } from "./comum";
import { TarefaModal, type Tarefa } from "./TarefaModal";
import type { Responsavel } from "./Processos";

interface Painel {
  hoje: string;
  numeros: { atribuidas_semana: number; concluidas_semana: number; atrasadas: number; prazos_fatais_5_dias: number; sem_responsavel: number; processos_sob_responsabilidade: number };
  grafico: { dia: string; atribuidas: number; concluidas: number }[];
  atrasadas: Tarefa[]; hoje_lista: Tarefa[]; proximas: Tarefa[]; mais_atrasadas_no_escritorio: { titulo: string; quantidade: number }[];
  djen: { publicacoes_nao_lidas: number; pericias_proximas_total: number; pericias_proximas: { id: number; tipo: string; nome: string; data: string; horario: string | null; local: string | null }[]; prazos_escritorio: { total: number; vencidos: number; lista: { publicacao_id: number; processo: string; cliente_nome: string | null; descricao: string; termino: string | null; urgencia: string }[] } };
}
interface Resumo { pessoas: number; clientes: number; processos_ativos: number; processos_total: number; sem_responsavel: number; pendentes_importacao: number; contatos_sem_cadastro: number }
const DIAS = ["S", "T", "Q", "Q", "S", "S", "D"];

export function GestaoInicio() {
  const { user, can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [p, setP] = useState<Painel | null>(null);
  const [r, setR] = useState<Resumo | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [nova, setNova] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const carregar = useCallback(async () => {
    try { const [a, b] = await Promise.all([api.get<Painel>("/gestao/meu-painel"), api.get<Resumo>("/gestao/resumo")]); setP(a); setR(b); }
    catch { show("Não foi possível carregar o painel.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, [carregar]);

  const concluir = async (t: Tarefa) => { try { await api.post(`/gestao/tarefas/${t.id}/concluir`, {}); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); } };
  const executar = async (chave: string, caminho: string, ok: (x: any) => string) => {
    setOcupado(chave);
    try { const x = await api.post<any>(caminho, {}); show(ok(x), "success"); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); }
    finally { setOcupado(""); }
  };
  const max = Math.max(1, ...(p?.grafico ?? []).flatMap((g) => [g.atribuidas, g.concluidas]));
  return (
    <div className="space-y-6">
      <PageHeader title={`Olá, ${user.display_name || user.username}`} description="Suas tarefas e prazos, e o resumo do escritório." actions={gerir ? <Button onClick={() => setNova(true)}><Plus className="h-4 w-4" /> Nova tarefa</Button> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="Atribuídas na semana" value={p?.numeros.atribuidas_semana ?? "…"} tone="info" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Concluídas na semana" value={p?.numeros.concluidas_semana ?? "…"} tone="accent" />
        <StatCard icon={<AlarmClock className="h-5 w-5" />} label="Atrasadas" value={p?.numeros.atrasadas ?? "…"} tone={p && p.numeros.atrasadas > 0 ? "danger" : "neutral"} />
        <StatCard icon={<Flame className="h-5 w-5" />} label="Prazos fatais (5 dias)" value={p?.numeros.prazos_fatais_5_dias ?? "…"} tone={p && p.numeros.prazos_fatais_5_dias > 0 ? "warning" : "neutral"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tarefas atribuídas e concluídas nesta semana</h2>
          <div className="mt-4 flex h-36 items-end gap-3" role="img" aria-label="Gráfico de tarefas por dia da semana">
            {(p?.grafico ?? []).map((g, i) => (
              <div key={g.dia} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-28 w-full items-end justify-center gap-1">
                  <div title={`${g.atribuidas} atribuída(s)`} className="w-3 rounded-t bg-indigo-400" style={{ height: `${(g.atribuidas / max) * 100}%`, minHeight: g.atribuidas ? 4 : 0 }} />
                  <div title={`${g.concluidas} concluída(s)`} className="w-3 rounded-t bg-emerald-400" style={{ height: `${(g.concluidas / max) * 100}%`, minHeight: g.concluidas ? 4 : 0 }} />
                </div>
                <span className={`text-xs ${g.dia === p?.hoje ? "font-bold text-accent-700" : "text-zinc-400"}`}>{DIAS[i]}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex gap-4 text-xs text-zinc-500"><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-indigo-400" />Atribuídas</span><span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />Concluídas</span></p>
        </section>
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tarefas com mais atrasos no escritório</h2>
          {(p?.mais_atrasadas_no_escritorio.length ?? 0) === 0 ? <p className="mt-3 text-sm text-zinc-500">Nenhuma tarefa atrasada. Bom trabalho!</p> : (
            <ul className="mt-3 space-y-1.5">{p!.mais_atrasadas_no_escritorio.map((m) => <li key={m.titulo} className="flex items-center gap-3 text-sm"><span className="w-8 shrink-0 rounded-md bg-red-50 px-1.5 py-0.5 text-center text-xs font-bold text-red-600 dark:bg-red-950/40">{m.quantidade}</span><span className="truncate text-zinc-700 dark:text-zinc-200">{m.titulo}</span></li>)}</ul>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Lista titulo="Atrasadas" tom="text-red-600" itens={p?.atrasadas ?? []} vazio="Nada atrasado." aoConcluir={gerir ? concluir : undefined} />
        <Lista titulo="Para hoje" tom="text-amber-600" itens={p?.hoje_lista ?? []} vazio="Nada para hoje." aoConcluir={gerir ? concluir : undefined} />
        <Lista titulo="Próximos 7 dias" tom="text-indigo-600" itens={p?.proximas ?? []} vazio="Nada nos próximos dias." aoConcluir={gerir ? concluir : undefined} />
      </div>
      {p && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Publicações, prazos do DJEN e perícias</h2><Link to="/processos" className="text-xs text-accent-700 underline">Abrir Processos e DJEN</Link></div>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Publicações</p><p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{p.djen.publicacoes_nao_lidas}</p><p className="text-xs text-zinc-500">não lidas no DJEN</p><Link to="/processos" className="mt-1 inline-block text-xs text-accent-700 underline">Tratar agora</Link></div>
            <div><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Prazos do escritório</p>{p.djen.prazos_escritorio.total === 0 ? <p className="mt-1 text-sm text-zinc-500">Nenhum prazo vencendo.</p> : <><p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200"><b>{p.djen.prazos_escritorio.total}</b> a cumprir{p.djen.prazos_escritorio.vencidos ? <span className="text-red-600"> · {p.djen.prazos_escritorio.vencidos} vencido(s)</span> : null}</p><ul className="mt-1 space-y-0.5">{p.djen.prazos_escritorio.lista.map((x) => <li key={x.publicacao_id} className="truncate text-xs text-zinc-500">{x.cliente_nome || x.processo} — {x.descricao}{x.termino ? ` (${dataBr(x.termino)})` : ""}</li>)}</ul><Link to="/processos/aguardando" className="mt-1 inline-block text-xs text-accent-700 underline">Ver acompanhamentos</Link></>}</div>
            <div><p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Perícias nos próximos 7 dias ({p.djen.pericias_proximas_total})</p>{p.djen.pericias_proximas.length === 0 ? <p className="mt-1 text-sm text-zinc-500">Nenhuma perícia agendada.</p> : <ul className="mt-1 space-y-0.5">{p.djen.pericias_proximas.map((x) => <li key={x.id} className="truncate text-xs text-zinc-600 dark:text-zinc-300">{dataBr(x.data)}{x.horario ? ` ${x.horario}` : ""} — {x.nome} · {x.tipo}{x.local ? ` · ${x.local}` : ""}</li>)}</ul>}<Link to="/calendario" className="mt-1 inline-block text-xs text-accent-700 underline">Abrir calendário</Link></div>
          </div>
        </section>
      )}
      <p className="text-right text-sm"><Link to="/gestao/tarefas" className="inline-flex items-center gap-1 text-accent-700 hover:underline dark:text-accent-300">Ver todas as tarefas <ArrowRight className="h-4 w-4" /></Link></p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Contact className="h-5 w-5" />} label="Clientes" value={r?.clientes ?? "…"} tone="accent" helper={r ? `${r.pessoas} pessoas` : undefined} />
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="Processos ativos" value={r?.processos_ativos ?? "…"} tone="info" helper={r ? `${r.processos_total} no total` : undefined} />
        <StatCard icon={<ClipboardList className="h-5 w-5" />} label="Meus processos" value={p?.numeros.processos_sob_responsabilidade ?? "…"} tone="neutral" />
        <StatCard icon={<AlarmClock className="h-5 w-5" />} label="Processos sem responsável" value={r?.sem_responsavel ?? "…"} tone={r && r.sem_responsavel > 0 ? "warning" : "neutral"} />
      </div>

      {gerir && r && r.pendentes_importacao > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-200 bg-accent-50/60 p-4 dark:border-accent-900 dark:bg-accent-950/30">
          <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.pendentes_importacao} processo(s) acompanhados no DJEN ainda não têm ficha</p><p className="text-sm text-zinc-600 dark:text-zinc-300">Crie as fichas de uma vez: número, tribunal, classe e cliente já vêm preenchidos.</p></div>
          <Button loading={ocupado === "djen"} onClick={() => executar("djen", "/gestao/processos/importar-djen", (x) => `${x.criados} ficha(s) criada(s).`)}><Download className="h-4 w-4" /> Criar fichas</Button>
        </div>
      )}
      {gerir && r && r.contatos_sem_cadastro > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.contatos_sem_cadastro} contato(s) da agenda podem virar cadastro completo</p><p className="text-sm text-zinc-600 dark:text-zinc-300">Os contatos continuam na agenda e nos avisos; o cadastro novo só acrescenta CPF, endereço e processos.</p></div>
          <Button variant="outline" loading={ocupado === "contatos"} onClick={() => executar("contatos", "/gestao/pessoas/importar-contatos", (x) => `${x.criadas} cadastro(s) criado(s).`)}>Importar contatos</Button>
        </div>
      )}
      {nova && <TarefaModal responsaveis={resp} meuId={user.id} aoFechar={() => setNova(false)} aoSalvar={() => { setNova(false); void carregar(); }} />}
    </div>
  );
}

function Lista({ titulo, tom, itens, vazio, aoConcluir }: { titulo: string; tom: string; itens: Tarefa[]; vazio: string; aoConcluir?: (t: Tarefa) => void }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={`text-sm font-semibold ${tom}`}>{titulo} <span className="font-normal text-zinc-400">({itens.length})</span></h2>
      {itens.length === 0 ? <p className="mt-3 text-sm text-zinc-500">{vazio}</p> : (
        <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
          {itens.map((t) => (
            <li key={t.id} className="flex items-start gap-2 py-2">
              {aoConcluir && <input type="checkbox" className="mt-1 h-4 w-4 accent-violet-600" checked={false} onChange={() => aoConcluir(t)} aria-label={`Concluir ${t.titulo}`} />}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.titulo}</p><p className="truncate text-xs text-zinc-500">{dataBr(t.prazo)}{t.processo_pasta ? ` · Pasta ${t.processo_pasta}` : ""}{t.prazo_fatal ? " · FATAL" : ""}</p></div>
              {t.processo_id && <Link to={`/gestao/processos/${t.processo_id}`} className="text-xs text-accent-700 hover:underline">Abrir</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
