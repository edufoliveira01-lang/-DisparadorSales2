import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, AlertTriangle, BarChart3, CalendarCheck2, ChevronLeft, ChevronRight, ClipboardCheck, Flame, HandCoins, TrendingUp, UserX, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { AREAS, STATUS, dataBr, dinheiro, mesAtual, mesRotulo } from "./comum";

interface Item { quantidade: number }
interface Ind {
  mes: string;
  tarefas: { atribuidas: number; concluidas: number; atrasadas: number; prazos_fatais_5_dias: number; sem_responsavel: number };
  produtividade: { usuario_id: number; nome: string; atribuidas: number; concluidas: number; atrasadas: number; no_prazo_percentual: number | null; processos_ativos: number }[];
  estoque: { por_status: (Item & { status: string })[]; por_area: (Item & { area: string })[]; por_responsavel: (Item & { responsavel: string })[]; por_tribunal: (Item & { tribunal: string })[]; sem_movimentacao_60_dias: number; parados: { id: number; numero: string; pasta: string; titulo: string; ultimo: string }[]; sem_responsavel: number };
  prospeccao: { novos_clientes_por_mes: (Item & { mes: string })[]; novos_processos_por_mes: (Item & { mes: string })[]; por_origem: (Item & { origem: string })[] };
  receita: { recebido_no_mes_centavos: number; contratado_no_mes_centavos: number; inadimplencia_centavos: number; por_area: { area: string; centavos: number }[]; por_responsavel: { responsavel: string; centavos: number }[] } | null;
}

type Aba = "geral" | "equipe" | "processos" | "captacao" | "receita";

const somaMes = (m: string, delta: number) => { const [a, mm] = m.split("-").map(Number); const d = new Date(Date.UTC(a, mm - 1 + delta, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
const mesPorExtenso = (m: string) => { const [a, mm] = m.split("-").map(Number); return `${["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"][mm - 1]} de ${a}`; };

/** Barras horizontais finas, uma cor só (a quantidade é o que importa), com o valor à direita. */
function Barras({ itens, rotulo, valor = (x) => x.quantidade, formato = (n) => String(n), vazio = "Sem dados neste período." }: { itens: any[]; rotulo: (x: any) => string; valor?: (x: any) => number; formato?: (n: number) => string; vazio?: string }) {
  const max = Math.max(1, ...itens.map(valor));
  if (!itens.length) return <p className="py-4 text-center text-sm text-zinc-400">{vazio}</p>;
  return (
    <ul className="space-y-3">
      {itens.map((x, i) => {
        const v = valor(x);
        return (
          <li key={i} title={`${rotulo(x)}: ${formato(v)}`}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-zinc-700 dark:text-zinc-200">{rotulo(x)}</span>
              <span className="shrink-0 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formato(v)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" role="img" aria-label={`${rotulo(x)}: ${formato(v)}`}>
              <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Colunas por mês (série única), com o valor em cima e o mês embaixo. */
function Colunas({ itens, vazio = "Sem dados neste período." }: { itens: { mes: string; quantidade: number }[]; vazio?: string }) {
  const max = Math.max(1, ...itens.map((x) => x.quantidade));
  if (!itens.length || itens.every((x) => x.quantidade === 0)) return <p className="py-6 text-center text-sm text-zinc-400">{vazio}</p>;
  return (
    <div className="flex h-44 items-end gap-3" role="img" aria-label={itens.map((x) => `${mesRotulo(x.mes)}: ${x.quantidade}`).join(", ")}>
      {itens.map((x) => (
        <div key={x.mes} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${mesRotulo(x.mes)}: ${x.quantidade}`}>
          <span className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{x.quantidade}</span>
          <div className="w-full max-w-[44px] rounded-t-md bg-accent-500" style={{ height: `${Math.max(3, (x.quantidade / max) * 100)}%` }} />
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{mesRotulo(x.mes)}</span>
        </div>
      ))}
    </div>
  );
}

const Cartao = ({ titulo, descricao, children, className = "" }: { titulo: string; descricao?: string; children: ReactNode; className?: string }) => (
  <section className={cn("surface-panel p-5", className)}>
    <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titulo}</h2>
    {descricao && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{descricao}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

type Tom = "accent" | "ok" | "aviso" | "perigo" | "neutro";
const TONS: Record<Tom, string> = {
  accent: "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300",
  ok: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
  aviso: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  perigo: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
  neutro: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
function Numero({ icone, rotulo, valor, tom = "neutro", nota, onClick }: { icone: ReactNode; rotulo: string; valor: ReactNode; tom?: Tom; nota?: string; onClick?: () => void }) {
  const conteudo = (
    <>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]", TONS[tom])}>{icone}</span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tabular-nums text-zinc-900 dark:text-zinc-100">{valor}</span>
        <span className="mt-1 block truncate text-xs text-zinc-500 dark:text-zinc-400">{rotulo}</span>
        {nota && <span className="block truncate text-[11px] text-zinc-400">{nota}</span>}
      </span>
    </>
  );
  const base = "surface-panel flex items-center gap-3 p-4 text-left";
  return onClick
    ? <button type="button" onClick={onClick} className={cn(base, "transition hover:border-accent-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500")}>{conteudo}</button>
    : <div className={base}>{conteudo}</div>;
}

export function Indicadores() {
  const { show } = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [d, setD] = useState<Ind | null>(null);
  const [falha, setFalha] = useState(false);
  const [aba, setAba] = useState<Aba>("geral");
  const hoje = mesAtual();

  useEffect(() => {
    let ativo = true;
    setD(null); setFalha(false);
    api.get<Ind>(`/gestao/indicadores?mes=${mes}`).then((r) => { if (ativo) setD(r); }).catch(() => { if (ativo) { setFalha(true); show("Não foi possível carregar os indicadores.", "error"); } });
    return () => { ativo = false; };
  }, [mes, show]);

  const abas = useMemo(() => ([
    ["geral", "Visão geral"], ["equipe", "Equipe"], ["processos", "Processos"], ["captacao", "Captação"], ...(d?.receita ? [["receita", "Receita"] as const] : []),
  ] as [Aba, string][]), [d?.receita]);
  useEffect(() => { if (aba === "receita" && d && !d.receita) setAba("geral"); }, [aba, d]);

  const atencao = d ? [
    { n: d.tarefas.atrasadas, rotulo: "tarefa(s) atrasada(s)", tom: "perigo" as Tom, icone: <AlarmClock />, to: "/gestao/tarefas" },
    { n: d.tarefas.prazos_fatais_5_dias, rotulo: "prazo(s) fatal(is) nos próximos 5 dias", tom: "aviso" as Tom, icone: <Flame />, to: "/gestao/tarefas" },
    { n: d.estoque.sem_movimentacao_60_dias, rotulo: "processo(s) ativo(s) sem movimentação há 60 dias", tom: "aviso" as Tom, icone: <AlertTriangle />, ir: "processos" as Aba },
    { n: d.estoque.sem_responsavel, rotulo: "processo(s) ativo(s) sem responsável", tom: "aviso" as Tom, icone: <UserX />, ir: "processos" as Aba },
    { n: d.tarefas.sem_responsavel, rotulo: "tarefa(s) sem responsável", tom: "aviso" as Tom, icone: <UserX />, to: "/gestao/tarefas" },
    ...(d.receita && d.receita.inadimplencia_centavos > 0 ? [{ n: -1, texto: `${dinheiro(d.receita.inadimplencia_centavos)} em atraso a receber`, rotulo: "", tom: "perigo" as Tom, icone: <HandCoins />, ir: "receita" as Aba }] : []),
  ].filter((x) => x.n !== 0) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Indicadores"
        description="Como o escritório está: tarefas e prazos, produtividade da equipe, processos, captação de clientes e receita."
        actions={
          <div className="flex items-center gap-1.5" role="group" aria-label="Mês de referência">
            <Button variant="outline" size="icon" onClick={() => setMes(somaMes(mes, -1))} title="Mês anterior" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[10.5rem] text-center text-sm font-semibold text-zinc-900 dark:text-zinc-100" aria-live="polite">{mesPorExtenso(mes)}</span>
            <Button variant="outline" size="icon" onClick={() => setMes(somaMes(mes, 1))} disabled={mes >= hoje} title="Próximo mês" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></Button>
            {mes !== hoje && <Button variant="ghost" size="sm" onClick={() => setMes(hoje)}>Mês atual</Button>}
          </div>
        }
      />

      <div className="page-tabs" role="tablist" aria-label="Assuntos dos indicadores">
        {abas.map(([chave, rotulo]) => (
          <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}
            className={cn("rounded-md px-4 py-2 text-xs font-medium", aba === chave ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" : "text-zinc-500 dark:text-zinc-400")}>{rotulo}</button>
        ))}
      </div>

      {falha ? (
        <EmptyState icon={BarChart3} title="Não foi possível carregar" description="Confira a conexão e tente de novo." action={<Button variant="outline" onClick={() => setMes((m) => m)}>Tentar de novo</Button>} />
      ) : !d ? (
        <div className="space-y-3" role="status" aria-label="Calculando indicadores"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div><Skeleton className="h-64 w-full" /></div>
      ) : (
        <>
          {aba === "geral" && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Numero icone={<CalendarCheck2 />} rotulo="Tarefas com prazo no mês" valor={d.tarefas.atribuidas} tom="accent" />
                <Numero icone={<ClipboardCheck />} rotulo="Concluídas no mês" valor={d.tarefas.concluidas} tom="ok" nota={d.tarefas.atribuidas ? `${Math.round((d.tarefas.concluidas / d.tarefas.atribuidas) * 100)}% das com prazo no mês` : undefined} />
                <Numero icone={<AlarmClock />} rotulo="Atrasadas agora" valor={d.tarefas.atrasadas} tom={d.tarefas.atrasadas ? "perigo" : "neutro"} />
                <Numero icone={<Flame />} rotulo="Prazos fatais (5 dias)" valor={d.tarefas.prazos_fatais_5_dias} tom={d.tarefas.prazos_fatais_5_dias ? "aviso" : "neutro"} />
              </div>
              {d.receita && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Numero icone={<Wallet />} rotulo="Recebido no mês" valor={dinheiro(d.receita.recebido_no_mes_centavos)} tom="ok" onClick={() => setAba("receita")} />
                  <Numero icone={<TrendingUp />} rotulo="Contratado no mês" valor={dinheiro(d.receita.contratado_no_mes_centavos)} tom="accent" onClick={() => setAba("receita")} />
                  <Numero icone={<HandCoins />} rotulo="Em atraso (a receber)" valor={dinheiro(d.receita.inadimplencia_centavos)} tom={d.receita.inadimplencia_centavos ? "perigo" : "neutro"} onClick={() => setAba("receita")} />
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-5">
                <Cartao titulo="Atenção agora" descricao="O que merece uma olhada primeiro." className="lg:col-span-3">
                  {atencao.length === 0 ? (
                    <p className="py-6 text-center text-sm text-emerald-700 dark:text-emerald-300">Nada pendente. Tarefas em dia e processos com responsável.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {atencao.map((a, i) => {
                        const texto = "texto" in a && a.texto ? a.texto : <><b className="tabular-nums">{a.n}</b> {a.rotulo}</>;
                        const linha = (
                          <>
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", TONS[a.tom])}>{a.icone}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">{texto}</span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
                          </>
                        );
                        const cls = "flex items-center gap-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40";
                        return <li key={i}>{"to" in a && a.to ? <Link to={a.to} className={cls}>{linha}</Link> : <button type="button" className={cn(cls, "w-full")} onClick={() => setAba((a as { ir: Aba }).ir)}>{linha}</button>}</li>;
                      })}
                    </ul>
                  )}
                </Cartao>
                <Cartao titulo="Novos clientes" descricao="Últimos 6 meses." className="lg:col-span-2"><Colunas itens={d.prospeccao.novos_clientes_por_mes} /></Cartao>
              </div>
            </div>
          )}

          {aba === "equipe" && (
            <Cartao titulo={`Produtividade por pessoa — ${mesPorExtenso(d.mes)}`} descricao="Tarefas com prazo no mês e processos ativos sob responsabilidade de cada pessoa.">
              {d.produtividade.length === 0 ? <EmptyState icon={BarChart3} title="Sem dados ainda" description="Atribua tarefas e responsáveis aos processos para acompanhar a produtividade." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead><tr className="text-left text-xs text-zinc-500"><th className="py-2 font-medium">Pessoa</th><th className="text-right font-medium">Atribuídas</th><th className="text-right font-medium">Concluídas</th><th className="text-right font-medium">Atrasadas</th><th className="w-44 pl-4 font-medium">No prazo</th><th className="text-right font-medium">Processos ativos</th></tr></thead>
                    <tbody>
                      {d.produtividade.map((p) => (
                        <tr key={p.usuario_id} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-3 pr-3"><span className="flex items-center gap-2.5"><span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-200">{p.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}</span><span className="font-medium text-zinc-900 dark:text-zinc-100">{p.nome}</span></span></td>
                          <td className="text-right tabular-nums">{p.atribuidas}</td>
                          <td className="text-right tabular-nums">{p.concluidas}</td>
                          <td className={cn("text-right tabular-nums", p.atrasadas > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{p.atrasadas}</td>
                          <td className="pl-4">
                            {p.no_prazo_percentual == null ? <span className="text-xs text-zinc-400">—</span> : (
                              <span className="flex items-center gap-2" title={`${p.no_prazo_percentual}% concluídas no prazo`}>
                                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><span className="block h-full rounded-full bg-accent-500" style={{ width: `${Math.min(100, p.no_prazo_percentual)}%` }} /></span>
                                <span className="w-10 text-right text-xs font-semibold tabular-nums">{p.no_prazo_percentual}%</span>
                              </span>
                            )}
                          </td>
                          <td className="text-right tabular-nums">{p.processos_ativos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Cartao>
          )}

          {aba === "processos" && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <Cartao titulo="Por situação"><Barras itens={d.estoque.por_status} rotulo={(x) => STATUS[x.status] || x.status} /></Cartao>
                <Cartao titulo="Ativos por área"><Barras itens={d.estoque.por_area} rotulo={(x) => AREAS[x.area] || x.area} /></Cartao>
                <Cartao titulo="Ativos por responsável"><Barras itens={d.estoque.por_responsavel} rotulo={(x) => x.responsavel} />{d.estoque.sem_responsavel > 0 && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{d.estoque.sem_responsavel} processo(s) ativo(s) sem responsável.</p>}</Cartao>
                <Cartao titulo="Ativos por tribunal"><Barras itens={d.estoque.por_tribunal} rotulo={(x) => x.tribunal} /></Cartao>
              </div>
              <Cartao titulo={`Sem movimentação há 60 dias (${d.estoque.sem_movimentacao_60_dias})`} descricao="Processos ativos que não andam: vale conferir se estão parados de verdade.">
                {d.estoque.parados.length === 0 ? <p className="py-4 text-center text-sm text-emerald-700 dark:text-emerald-300">Nenhum processo ativo parado. Ótimo!</p> : (
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {d.estoque.parados.map((p) => (
                      <li key={p.id}><Link to={`/gestao/processos/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40"><span className="min-w-0 truncate"><b>{p.pasta}</b> · {p.titulo || p.numero}</span><span className="shrink-0 text-xs text-zinc-500">último andamento: {dataBr(p.ultimo)}</span></Link></li>
                    ))}
                  </ul>
                )}
              </Cartao>
            </div>
          )}

          {aba === "captacao" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Cartao titulo="Novos clientes" descricao="Últimos 6 meses."><Colunas itens={d.prospeccao.novos_clientes_por_mes} /></Cartao>
              <Cartao titulo="Novos processos" descricao="Últimos 6 meses."><Colunas itens={d.prospeccao.novos_processos_por_mes} /></Cartao>
              <Cartao titulo="De onde vêm os clientes" descricao="Últimos 12 meses, pela «origem» preenchida no cadastro." className="lg:col-span-2">
                <Barras itens={d.prospeccao.por_origem} rotulo={(x) => x.origem} vazio="Nenhuma origem preenchida ainda." />
                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">Preencha a «origem» no cadastro de cada cliente para este gráfico ficar útil.</p>
              </Cartao>
            </div>
          )}

          {aba === "receita" && d.receita && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Numero icone={<Wallet />} rotulo="Honorários recebidos no mês" valor={dinheiro(d.receita.recebido_no_mes_centavos)} tom="ok" />
                <Numero icone={<TrendingUp />} rotulo="Contratado no mês" valor={dinheiro(d.receita.contratado_no_mes_centavos)} tom="accent" />
                <Numero icone={<HandCoins />} rotulo="Em atraso (a receber)" valor={dinheiro(d.receita.inadimplencia_centavos)} tom={d.receita.inadimplencia_centavos ? "perigo" : "neutro"} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Cartao titulo="Receita por área"><Barras itens={d.receita.por_area} rotulo={(x) => AREAS[x.area] || x.area} valor={(x) => x.centavos} formato={(n) => dinheiro(n)} /></Cartao>
                <Cartao titulo="Receita por responsável pelo processo"><Barras itens={d.receita.por_responsavel} rotulo={(x) => x.responsavel} valor={(x) => x.centavos} formato={(n) => dinheiro(n)} /></Cartao>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
