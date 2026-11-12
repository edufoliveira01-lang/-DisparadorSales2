import { useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, Clock3, Copy, HelpCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { HistoryCoverage, RegisterFulfillment, instanteBR } from "@/components/djen/HistoryCoverage";
import type { AguardandoRetorno } from "@/pages/Acompanhamento";

/** O que aparece na etiqueta e nos painéis: o assunto da ordem, quando ele diz mais que o tipo. */
const tipoVisual = (i: AguardandoRetorno): string => i.assunto || i.tipo;
const dia = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
/** Passou do tempo de espera (ou o prazo ainda precisa ser conferido): é o que a equipe deve olhar primeiro. */
const precisaAtencao = (i: AguardandoRetorno) => (i.dias_espera != null && i.dias_decorridos >= i.dias_espera) || Boolean(i.prazo_pendente) || Boolean(i.prazo_termino && i.prazo_termino < new Date().toISOString().slice(0, 10));
const ORDENS = { antigos: "Mais antigos primeiro", recentes: "Mais recentes primeiro", cliente: "Cliente (A–Z)" } as const;

export type Superado = AguardandoRetorno & { motivo_superada: string; ultimo_andamento_em: string | null };
interface Props {
  itens: AguardandoRetorno[];
  superados?: Superado[];
  tipos: Record<string, string>;
  diasPadrao: number;
  diagnostico: { publicacoes: number; ordens_externas: number } | null;
  ocupado: boolean;
  onAbrir: (publicacaoId: number) => void;
  onCobrado: (item: AguardandoRetorno) => void;
  onAtualizar: () => void | Promise<void>;
}

/** Acompanhamentos: o que o escritório está esperando de alguém (juízo, perito, INSS, outra parte), do que precisa de atenção para o que ainda está no prazo. */
export function AcompanhamentosLista({ itens, superados = [], tipos, diasPadrao, diagnostico, ocupado, onAbrir, onCobrado, onAtualizar }: Props) {
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<keyof typeof ORDENS>("antigos");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [ajuda, setAjuda] = useState(false);
  const [mostrarSuperados, setMostrarSuperados] = useState(false);
  const chave = (i: AguardandoRetorno) => `${i.publicacao_id}:${i.tipo}`;
  const contagem = useMemo(() => { const m: Record<string, number> = {}; for (const i of itens) m[tipoVisual(i)] = (m[tipoVisual(i)] ?? 0) + 1; return m; }, [itens]);
  const visiveis = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR");
    const f = itens.filter((i) => (!tipo || tipoVisual(i) === tipo) && (!t || `${i.processo} ${i.cliente_nome || ""} ${i.motivo}`.toLocaleLowerCase("pt-BR").includes(t)));
    return f.sort((a, b) => ordem === "cliente" ? (a.cliente_nome || "~").localeCompare(b.cliente_nome || "~", "pt-BR") : ordem === "recentes" ? a.dias_decorridos - b.dias_decorridos : b.dias_decorridos - a.dias_decorridos);
  }, [itens, tipo, busca, ordem]);
  const atencao = visiveis.filter(precisaAtencao), noPrazo = visiveis.filter((i) => !precisaAtencao(i));
  const alternar = (k: string) => setAbertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const copiar = (t: string) => { void navigator.clipboard?.writeText(t).catch(() => undefined); };

  const cartao = (i: AguardandoRetorno, urgente: boolean) => {
    const k = chave(i), aberto = abertos.has(k);
    return (
      <article key={k} className={`rounded-2xl border bg-white shadow-sm transition hover:shadow-md dark:bg-zinc-900 ${urgente ? "border-amber-300 border-l-4 border-l-amber-500 dark:border-amber-800 dark:border-l-amber-500" : "border-zinc-200 dark:border-zinc-800"}`}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.cliente_nome || "Cliente não vinculado"}</h3>
              <Badge tone={urgente ? "warning" : "neutral"}>{tipos[tipoVisual(i)] ?? i.tipo}</Badge>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${urgente ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>há {i.dias_decorridos} dia(s){i.dias_espera != null ? ` · espera de ${i.dias_espera}` : ""}</span>
              {i.acompanhamento_status === "cobrado" && <Badge tone="info">Cobrança registrada</Badge>}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
              <span className="font-mono">{i.processo}</span>
              <button type="button" aria-label="Copiar número do processo" title="Copiar número" onClick={() => copiar(i.processo)} className="rounded p-0.5 text-zinc-400 hover:text-accent-600"><Copy className="h-3.5 w-3.5" /></button>
              <span>· aguardando {i.responsavel}</span><span>· publicada em {dia(i.data_disponibilizacao)}</span>
            </p>
            <p className="mt-2 line-clamp-2 text-xs font-medium text-zinc-800 dark:text-zinc-100">{i.motivo}</p>
            {(i.prazo_texto || i.prazo_pendente || (i.prazo_termino && i.historico_djen?.status === "atualizado")) && <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {i.prazo_texto && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Prazo expresso: {i.prazo_texto}</span>}
              {i.prazo_termino && i.historico_djen?.status === "atualizado" && <span className="rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">Data limite a conferir: {dia(i.prazo_termino)}</span>}
              {i.prazo_pendente && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Conferir prazo e termo inicial</span>}
            </div>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:w-44 sm:flex-col sm:items-stretch">
            <Button size="sm" onClick={() => onAbrir(i.publicacao_id)}>Ver processo <ArrowRight className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" disabled={ocupado || i.historico_djen?.status !== "atualizado"} onClick={() => onCobrado(i)} title="Apenas registra uma cobrança que você já realizou; não envia mensagens nem peticiona.">Cobrança feita</Button>
            <RegisterFulfillment endpoint={`/djen/aguardando/${i.publicacao_id}`} tipo={i.tipo} onSaved={onAtualizar} className="w-full" />
          </div>
        </div>
        <button type="button" onClick={() => alternar(k)} aria-expanded={aberto} className="flex w-full items-center gap-1.5 border-t border-zinc-100 px-4 py-2 text-left text-[11px] font-medium text-zinc-500 hover:text-accent-700 dark:border-zinc-800">
          <ChevronDown className={`h-3.5 w-3.5 transition ${aberto ? "rotate-180" : ""}`} /> {aberto ? "Ocultar detalhes" : "Ver detalhes e observações"}
        </button>
        {aberto && <div className="space-y-2 border-t border-zinc-100 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
          <p className="whitespace-pre-wrap leading-relaxed">{i.resumo}</p>
          {i.captured_at && <p className="text-[11px] text-zinc-500">Capturada pelo sistema em {instanteBR(i.captured_at)}</p>}
          <HistoryCoverage historico={i.historico_djen} publicacaoId={i.publicacao_id} />
          <p className="text-[11px] text-zinc-500">{i.prazo_observacao || `Conferir após ${i.dias_espera ?? diasPadrao} dias desde a publicação.`}</p>
          <p className="text-[11px] text-zinc-500">Cumprimento não confirmado. Confira os autos antes de cobrar; uma ordem antiga pode já ter sido cumprida sem publicação no DJEN.</p>
          {i.ultima_cobranca_em && <p className="text-[11px] text-zinc-500">Cobrança marcada como realizada em {dia(i.ultima_cobranca_em)}</p>}
        </div>}
      </article>
    );
  };

  const secao = (titulo: string, subtitulo: string, lista: AguardandoRetorno[], urgente: boolean) => lista.length > 0 && (
    <section className="space-y-3" aria-label={titulo}>
      <div><h2 className={`text-sm font-semibold ${urgente ? "text-amber-900 dark:text-amber-200" : "text-zinc-800 dark:text-zinc-100"}`}>{titulo} <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{lista.length}</span></h2><p className="text-xs text-zinc-500">{subtitulo}</p></div>
      <div className="space-y-3">{lista.map((i) => cartao(i, urgente))}</div>
    </section>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <button type="button" onClick={() => setTipo("")} aria-pressed={!tipo} className={`rounded-2xl border p-3 text-left transition ${!tipo ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"}`}>
          <span className="block text-2xl font-semibold leading-none">{itens.length}</span><span className="mt-1 block text-[11px] text-zinc-500">Todos os acompanhamentos</span>
        </button>
        {Object.entries(tipos).filter(([k]) => contagem[k]).map(([k, rotulo]) => (
          <button key={k} type="button" onClick={() => setTipo(tipo === k ? "" : k)} aria-pressed={tipo === k} className={`rounded-2xl border p-3 text-left transition ${tipo === k ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"}`}>
            <span className="block text-2xl font-semibold leading-none">{contagem[k]}</span><span className="mt-1 block text-[11px] text-zinc-500">{rotulo}</span>
          </button>))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" aria-label="Buscar acompanhamento" placeholder="Buscar cliente, processo ou ordem…" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <Select aria-label="Ordenar" className="sm:max-w-[230px]" value={ordem} onChange={(e) => setOrdem(e.target.value as keyof typeof ORDENS)}>{Object.entries(ORDENS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}</Select>
        <Button variant="ghost" size="sm" onClick={() => setAjuda((v) => !v)} aria-expanded={ajuda}><HelpCircle className="h-4 w-4" /> Como funciona</Button>
      </div>

      {ajuda && <div className="space-y-2 rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs leading-relaxed text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
        <p><b>O que é:</b> ordens e providências que o escritório está esperando de alguém (juízo, perito, INSS, outra parte). O sistema olha as publicações posteriores de cada processo; falta de resposta ou captura incompleta mantém o histórico pendente. Publicação antiga não é pendência atual confirmada.</p>
        <p><b>Prazos:</b> o prazo expresso tem prioridade e não é ampliado para 30 dias. Sem período expresso, o lembrete aparece após {diasPadrao} dias. Atos posteriores de cumprimento ou encerramento da instrução podem tornar uma ordem anterior superada. Confira os autos antes de cobrar.</p>
        <p><b>Botões:</b> «Cobrança feita» só registra uma ação que você já realizou; não envia mensagens nem peticiona. «Já foi cumprido» encerra o acompanhamento, com data e observação.</p>
        {diagnostico && <p className="text-sky-900/80 dark:text-sky-200/80">Cobertura atual: {diagnostico.publicacoes} publicações consultadas · {diagnostico.ordens_externas} ordens externas identificadas. Somente consultas atualizadas entram nos contadores de aviso; ordens resolvidas não aparecem.</p>}
      </div>}

      {itens.length === 0 ? <EmptyState icon={Check} title="Nada aguardando retorno" description="Quando o sistema identificar uma ordem ou providência esperando alguém, ela aparece aqui." />
        : visiveis.length === 0 ? <EmptyState icon={Clock3} title="Nenhum acompanhamento neste filtro" description="Ajuste a busca ou escolha outro tipo." />
        : <>
          {secao("Precisa de atenção", "Passou do tempo de espera ou o prazo precisa ser conferido nos autos.", atencao, true)}
          {secao("Dentro do tempo de espera", "Ainda não chegou a hora de cobrar; ficam aqui só para você acompanhar.", noPrazo, false)}
        </>}

      {superados.length > 0 && <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-white/[0.03]" aria-label="Ordens provavelmente superadas">
        <button type="button" onClick={() => setMostrarSuperados((v) => !v)} aria-expanded={mostrarSuperados} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
          <span><span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Provavelmente superados <span className="ml-1 rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">{superados.length}</span></span><span className="block text-xs text-zinc-500">O processo andou depois da ordem (fase posterior ou movimento por meses). Ficam fora da lista acima; confira se quiser.</span></span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition ${mostrarSuperados ? "rotate-180" : ""}`} />
        </button>
        {mostrarSuperados && <ul className="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {superados.map((i) => (
            <li key={chave(i)} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{i.cliente_nome || "Cliente não vinculado"} <span className="ml-1 text-xs font-normal text-zinc-500">· {tipos[tipoVisual(i)] ?? i.tipo} · <span className="font-mono">{i.processo}</span></span></p>
                <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500" title={i.motivo}>Ordem de {dia(i.data_disponibilizacao)}: {i.motivo}</p>
                <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">{i.motivo_superada}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => onAbrir(i.publicacao_id)}>Ver processo <ArrowRight className="h-3.5 w-3.5" /></Button>
            </li>))}
        </ul>}
      </section>}
    </div>
  );
}
