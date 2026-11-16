import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CircleDashed } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { dataBr } from "./comum";

export interface FaseNaLinha { chave: string; rotulo: string; explicacao: string; estado: "concluida" | "atual" | "futura" | "pulada"; entrou_em: string | null; saiu_em: string | null; dias_na_fase: number | null; limite_dias: number; atrasada: boolean }
export interface Evento { publicacao_id?: number; data: string; tipo: "etapa" | "publicacao" | "pericia" | "datajud" | "prazo" | "desfecho"; titulo: string; detalhe: string }
export interface Linha {
  origem: "quadro" | "deduzida" | "nenhuma"; fases: FaseNaLinha[]; eventos: Evento[];
  atual: { chave: string; rotulo: string; explicacao: string; indice: number; atrasada: boolean; dias: number | null } | null;
  situacao: { nome: string; desde: string | null; dias: number | null } | null;
  desfecho?: { codigo: string; rotulo: string; em: string | null; observacao: string; arquivado: boolean } | null;
}
const ROTULO_DO_EVENTO: Record<Evento["tipo"], string> = { etapa: "Etapa", publicacao: "DJEN", pericia: "Perícia", datajud: "DataJud", prazo: "Prazo", desfecho: "Conclusão" };

/** As 9 fases do processo numa linha, com a fase atual em destaque, o tempo nela e o histórico detalhado por data. */
export function LinhaDasFases({ processoId, gerir, aoMudar }: { processoId: number; gerir: boolean; aoMudar?: () => void }) {
  const { show } = useToast();
  const [l, setL] = useState<Linha | null>(null);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [escolha, setEscolha] = useState("");
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try { setL(await api.get<Linha>(`/gestao/processos/${processoId}/fases`, { fresh: true } as never)); }
    catch { show("Não foi possível carregar as fases do processo.", "error"); }
  }, [processoId, show]);
  useEffect(() => { setL(null); setFiltro(null); void carregar(); }, [carregar]);

  async function definir(fase: string) {
    setSalvando(true);
    try { setL(await api.put<Linha>(`/gestao/processos/${processoId}/fase`, { fase })); setEscolha(""); show("Fase definida.", "success"); aoMudar?.(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível definir a fase.", "error"); }
    finally { setSalvando(false); }
  }

  const eventos = useMemo(() => {
    if (!l) return [];
    const f = filtro ? l.fases.find((x) => x.chave === filtro) : null;
    if (!f || !f.entrou_em) return l.eventos;
    return l.eventos.filter((e) => e.data >= f.entrou_em! && (!f.saiu_em || e.data <= f.saiu_em));
  }, [l, filtro]);

  if (!l) return <p className="text-sm text-zinc-500">Carregando as fases…</p>;
  const atual = l.fases.find((f) => f.estado === "atual");

  return (
    <section aria-label="Fases do processo" className="space-y-4 surface-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Fases do processo</h2>
        {l.origem === "deduzida" && <Badge tone="warning">Fase estimada pelas publicações</Badge>}
      </div>

      <ol className="flex gap-0 overflow-x-auto pb-2" role="list">
        {l.fases.map((f, i) => {
          const ativa = f.estado === "atual";
          const cor = f.estado === "concluida" ? "bg-emerald-500 text-white" : ativa ? (f.atrasada ? "bg-red-600 text-white ring-4 ring-red-100 dark:ring-red-500/20" : "bg-accent-600 text-white ring-4 ring-accent-100 dark:ring-accent-500/20") : f.estado === "pulada" ? "border border-dashed border-zinc-400 bg-white text-zinc-400 dark:bg-zinc-900" : "border border-zinc-300 bg-white text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900";
          return (
            <li key={f.chave} className="relative flex min-w-[104px] flex-1 flex-col items-center px-1 text-center">
              {i > 0 && <span aria-hidden className={`absolute left-0 right-1/2 top-4 h-0.5 ${l.fases[i - 1]!.estado === "concluida" || (l.fases[i - 1]!.estado === "atual" && false) ? "bg-emerald-400" : ativa || f.estado === "concluida" ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-700"}`} />}
              {i < l.fases.length - 1 && <span aria-hidden className={`absolute left-1/2 right-0 top-4 h-0.5 ${f.estado === "concluida" ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-700"}`} />}
              <button type="button" onClick={() => setFiltro((c) => (c === f.chave ? null : f.chave))} title={f.explicacao} aria-pressed={filtro === f.chave}
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${cor} ${filtro === f.chave ? "outline outline-2 outline-offset-2 outline-zinc-900 dark:outline-zinc-100" : ""}`}>
                {f.estado === "concluida" ? <Check className="h-4 w-4" /> : f.estado === "pulada" ? <CircleDashed className="h-4 w-4" /> : i + 1}
              </button>
              <span className={`mt-2 text-xs leading-tight ${ativa ? "font-semibold text-zinc-900 dark:text-zinc-100" : "text-zinc-500"}`}>{f.rotulo}</span>
              <span className="mt-0.5 text-[10px] text-zinc-400">{f.estado === "concluida" && f.entrou_em ? dataBr(f.entrou_em) : ativa && f.dias_na_fase !== null ? `há ${f.dias_na_fase} d` : f.estado === "pulada" ? "não houve" : ""}</span>
            </li>);
        })}
      </ol>

      {l.desfecho ? null : l.atual ? (
        <div className={`rounded-xl border p-3 text-sm ${l.atual.atrasada ? "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10" : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50"}`}>
          <p className="flex flex-wrap items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">Fase atual: {l.atual.rotulo}
            {l.situacao && <Badge tone="warning">{l.situacao.nome}{l.situacao.dias !== null ? ` · há ${l.situacao.dias} d` : ""}</Badge>}
            {l.atual.atrasada && atual && <Badge tone="danger"><AlertTriangle className="mr-1 inline h-3 w-3" />{atual.dias_na_fase} dias nesta fase (esperado até {atual.limite_dias})</Badge>}</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">{l.atual.explicacao}</p>
        </div>
      ) : <p className="rounded-xl border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-600">Fase não definida: ainda não há publicações nem etapa no quadro para este processo.{gerir ? " Escolha a fase abaixo." : ""}</p>}

      {gerir && !l.desfecho && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={escolha} onChange={(e) => setEscolha(e.target.value)} aria-label="Definir a fase" className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"><option value="">{l.origem === "deduzida" ? "Confirmar ou corrigir a fase…" : "Definir a fase…"}</option>{l.fases.map((f) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}</select>
          <Button size="sm" variant="outline" loading={salvando} disabled={!escolha} onClick={() => void definir(escolha)}>Definir</Button>
          {l.origem === "deduzida" && l.atual && <Button size="sm" loading={salvando} onClick={() => void definir(l.atual!.chave)}>Confirmar “{l.atual.rotulo}”</Button>}
        </div>)}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Histórico{filtro ? ` · ${l.fases.find((f) => f.chave === filtro)?.rotulo}` : ""}</h3>{filtro && <button type="button" className="text-xs text-accent-700 underline" onClick={() => setFiltro(null)}>Ver tudo</button>}</div>
        {eventos.length === 0 ? <p className="text-sm text-zinc-500">Nada registrado{filtro ? " nesta fase" : ""} ainda.</p> : (
          <ul className="max-h-80 space-y-2 overflow-y-auto border-l border-zinc-200 pl-4 dark:border-zinc-700">
            {eventos.map((e, i) => (
              <li key={`${e.data}-${e.titulo}-${i}`} className="relative text-sm">
                <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-zinc-400" />
                <p className="text-xs text-zinc-500">{dataBr(e.data)} · {ROTULO_DO_EVENTO[e.tipo]}</p>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">{e.titulo}</p>
                {e.detalhe && <p className="line-clamp-2 text-xs text-zinc-500">{e.detalhe}</p>}
                {e.publicacao_id && <Link to={`/processos?abrir=${e.publicacao_id}`} className="text-xs text-accent-700 underline dark:text-accent-300">Abrir a publicação</Link>}
                {e.tipo === "pericia" && <Link to="/pericias" className="text-xs text-accent-700 underline dark:text-accent-300">Ver em Perícias e compromissos</Link>}
              </li>))}
          </ul>)}
      </div>
    </section>
  );
}
