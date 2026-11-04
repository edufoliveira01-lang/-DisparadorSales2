import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { AREAS, STATUS, dataBr, dinheiro, mesAtual, mesRotulo } from "./comum";
import { BarChart3, ClipboardCheck, AlarmClock, Flame } from "lucide-react";

interface Item { quantidade: number }
interface Ind {
  mes: string;
  tarefas: { atribuidas: number; concluidas: number; atrasadas: number; prazos_fatais_5_dias: number; sem_responsavel: number };
  produtividade: { usuario_id: number; nome: string; atribuidas: number; concluidas: number; atrasadas: number; no_prazo_percentual: number | null; processos_ativos: number }[];
  estoque: { por_status: (Item & { status: string })[]; por_area: (Item & { area: string })[]; por_responsavel: (Item & { responsavel: string })[]; por_tribunal: (Item & { tribunal: string })[]; sem_movimentacao_60_dias: number; parados: { id: number; numero: string; pasta: string; titulo: string; ultimo: string }[]; sem_responsavel: number };
  prospeccao: { novos_clientes_por_mes: (Item & { mes: string })[]; novos_processos_por_mes: (Item & { mes: string })[]; por_origem: (Item & { origem: string })[] };
  receita: { recebido_no_mes_centavos: number; contratado_no_mes_centavos: number; inadimplencia_centavos: number; por_area: { area: string; centavos: number }[]; por_responsavel: { responsavel: string; centavos: number }[] } | null;
}

function Barras({ itens, rotulo, valor = (x: any) => x.quantidade, formato = (n: number) => String(n) }: { itens: any[]; rotulo: (x: any) => string; valor?: (x: any) => number; formato?: (n: number) => string }) {
  const max = Math.max(1, ...itens.map(valor));
  if (!itens.length) return <p className="text-sm text-zinc-500">Sem dados.</p>;
  return <ul className="space-y-2">{itens.map((x, i) => <li key={i} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate text-zinc-700 dark:text-zinc-200">{rotulo(x)}</span><span className="shrink-0 font-medium text-zinc-900 dark:text-zinc-100">{formato(valor(x))}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-accent-500" style={{ width: `${(valor(x) / max) * 100}%` }} /></div></li>)}</ul>;
}
const Cartao = ({ titulo, children, className = "" }: { titulo: string; children: ReactNode; className?: string }) => <section className={`rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}><h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titulo}</h2>{children}</section>;

export function Indicadores() {
  const { show } = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [d, setD] = useState<Ind | null>(null);
  useEffect(() => { api.get<Ind>(`/gestao/indicadores?mes=${mes}`).then(setD).catch(() => show("Não foi possível carregar os indicadores.", "error")); }, [mes, show]);
  return (
    <div className="space-y-5">
      <PageHeader title="Indicadores" description="Produtividade da equipe, estoque de processos, captação de clientes e receita." />
      <label className="block text-sm text-zinc-600 dark:text-zinc-300">Mês de referência <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="ml-2 inline-block h-10 w-44" /></label>
      {!d ? <p className="text-sm text-zinc-500" role="status">Calculando…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={<BarChart3 className="h-5 w-5" />} label="Tarefas com prazo no mês" value={d.tarefas.atribuidas} tone="info" />
            <StatCard icon={<ClipboardCheck className="h-5 w-5" />} label="Concluídas no mês" value={d.tarefas.concluidas} tone="accent" />
            <StatCard icon={<AlarmClock className="h-5 w-5" />} label="Atrasadas agora" value={d.tarefas.atrasadas} tone={d.tarefas.atrasadas ? "danger" : "neutral"} />
            <StatCard icon={<Flame className="h-5 w-5" />} label="Prazos fatais (5 dias)" value={d.tarefas.prazos_fatais_5_dias} tone={d.tarefas.prazos_fatais_5_dias ? "warning" : "neutral"} />
          </div>

          <Cartao titulo={`Produtividade por pessoa — ${mesRotulo(d.mes)}`}>
            {d.produtividade.length === 0 ? <p className="text-sm text-zinc-500">Ainda não há tarefas nem processos com responsável.</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1.5">Pessoa</th><th className="text-right">Atribuídas</th><th className="text-right">Concluídas</th><th className="text-right">Atrasadas</th><th className="text-right">No prazo</th><th className="text-right">Processos ativos</th></tr></thead>
                <tbody>{d.produtividade.map((p) => <tr key={p.usuario_id} className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-2 font-medium text-zinc-900 dark:text-zinc-100">{p.nome}</td><td className="text-right">{p.atribuidas}</td><td className="text-right">{p.concluidas}</td><td className={`text-right ${p.atrasadas ? "font-semibold text-red-600" : ""}`}>{p.atrasadas}</td><td className="text-right">{p.no_prazo_percentual === null ? "—" : `${p.no_prazo_percentual}%`}</td><td className="text-right">{p.processos_ativos}</td></tr>)}</tbody></table></div>)}
          </Cartao>

          <div className="grid gap-4 lg:grid-cols-3">
            <Cartao titulo="Processos por situação"><Barras itens={d.estoque.por_status} rotulo={(x) => STATUS[x.status] || x.status} /></Cartao>
            <Cartao titulo="Processos ativos por área"><Barras itens={d.estoque.por_area} rotulo={(x) => AREAS[x.area] || x.area} /></Cartao>
            <Cartao titulo="Processos ativos por responsável"><Barras itens={d.estoque.por_responsavel} rotulo={(x) => x.responsavel} /></Cartao>
            <Cartao titulo="Processos ativos por tribunal"><Barras itens={d.estoque.por_tribunal} rotulo={(x) => x.tribunal} /></Cartao>
            <Cartao titulo="Novos clientes (6 meses)"><Barras itens={d.prospeccao.novos_clientes_por_mes} rotulo={(x) => mesRotulo(x.mes)} /></Cartao>
            <Cartao titulo="Novos processos (6 meses)"><Barras itens={d.prospeccao.novos_processos_por_mes} rotulo={(x) => mesRotulo(x.mes)} /></Cartao>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Cartao titulo="De onde vêm os clientes (12 meses)"><Barras itens={d.prospeccao.por_origem} rotulo={(x) => x.origem} /><p className="mt-3 text-xs text-zinc-500">Preencha a “origem” no cadastro de cada cliente para este gráfico ficar útil.</p></Cartao>
            <Cartao titulo={`Sem movimentação há 60 dias (${d.estoque.sem_movimentacao_60_dias})`}>
              {d.estoque.parados.length === 0 ? <p className="text-sm text-zinc-500">Nenhum processo ativo parado. Ótimo!</p> : <ul className="space-y-1.5">{d.estoque.parados.map((p) => <li key={p.id}><Link to={`/gestao/processos/${p.id}`} className="flex justify-between gap-2 text-sm hover:underline"><span className="truncate"><b>{p.pasta}</b> · {p.titulo || p.numero}</span><span className="shrink-0 text-xs text-zinc-500">último: {dataBr(p.ultimo)}</span></Link></li>)}</ul>}
              {d.estoque.sem_responsavel > 0 && <p className="mt-3 text-xs text-amber-700">{d.estoque.sem_responsavel} processo(s) ativo(s) sem responsável.</p>}
            </Cartao>
          </div>

          {d.receita && (
            <>
              <h2 className="pt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Receita</h2>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <StatCard icon={<BarChart3 className="h-5 w-5" />} label="Honorários recebidos no mês" value={dinheiro(d.receita.recebido_no_mes_centavos)} tone="accent" />
                <StatCard icon={<BarChart3 className="h-5 w-5" />} label="Contratado no mês" value={dinheiro(d.receita.contratado_no_mes_centavos)} tone="info" />
                <StatCard icon={<AlarmClock className="h-5 w-5" />} label="Em atraso (a receber)" value={dinheiro(d.receita.inadimplencia_centavos)} tone={d.receita.inadimplencia_centavos ? "danger" : "neutral"} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Cartao titulo="Receita por área"><Barras itens={d.receita.por_area} rotulo={(x) => AREAS[x.area] || x.area} valor={(x) => x.centavos} formato={(n) => dinheiro(n)} /></Cartao>
                <Cartao titulo="Receita por responsável pelo processo"><Barras itens={d.receita.por_responsavel} rotulo={(x) => x.responsavel} valor={(x) => x.centavos} formato={(n) => dinheiro(n)} /></Cartao>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
