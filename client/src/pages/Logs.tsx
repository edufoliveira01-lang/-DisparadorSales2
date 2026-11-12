import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CircleX,
  ChevronDown,
  Clipboard,
  Copy,
  Filter,
  Info,
  MoreHorizontal,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { SystemLog } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import { DetalhesNotificacao, formatarDataHora, lerDetalhes, rotuloOrigem } from "@/components/logs/detalhes";
import { cn } from "@/lib/utils";

const ITENS_POR_PAGINA = 20;

type Nivel = SystemLog["nivel"];
type Periodo = "todos" | "24h" | "7d" | "30d";

const PERIODOS: { value: Periodo; label: string; ms: number }[] = [
  { value: "todos", label: "Todo o período", ms: 0 },
  { value: "24h", label: "Últimas 24 horas", ms: 86_400_000 },
  { value: "7d", label: "Últimos 7 dias", ms: 7 * 86_400_000 },
  { value: "30d", label: "Últimos 30 dias", ms: 30 * 86_400_000 },
];

const NIVEIS: Record<Nivel, { label: string; plural: string; icon: typeof Info; icone: string; tile: string }> = {
  erro: { label: "Erro", plural: "Erros", icon: CircleX, icone: "text-red-600 dark:text-red-400", tile: "text-red-700 dark:text-red-300" },
  aviso: { label: "Atenção", plural: "Avisos", icon: AlertTriangle, icone: "text-amber-600 dark:text-amber-400", tile: "text-amber-700 dark:text-amber-300" },
  info: { label: "Informação", plural: "Informações", icon: Info, icone: "text-accent-600 dark:text-accent-300", tile: "" },
};

const CATEGORIAS_NOMES: Record<string, string> = {
  whatsapp: "WhatsApp",
  trello: "Trello",
  djen: "DJEN",
  asaas: "Asaas",
};
const nomeCategoria = (c: string) => CATEGORIAS_NOMES[c.toLowerCase()] ?? c.charAt(0).toUpperCase() + c.slice(1);

function horaRelativa(valor: string): string {
  const t = Date.parse(valor.endsWith("Z") ? valor : `${valor}Z`);
  if (Number.isNaN(t)) return valor;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} d`;
}

function jsonLegivel(bruto: string | null): string {
  if (!bruto) return "";
  try { return JSON.stringify(JSON.parse(bruto), null, 2); } catch { return bruto; }
}

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

export function Logs() {
  const { show } = useToast();
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [nivel, setNivel] = useState<Nivel | "todos">("todos");
  const [categoria, setCategoria] = useState("todas");
  const [periodo, setPeriodo] = useState<Periodo>("todos");
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [pagina, setPagina] = useState(0);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      setLogs(await api.get<SystemLog[]>("/system-logs?limit=500"));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível carregar os registros.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const ts = (log: SystemLog) => Date.parse(`${log.created_at}Z`);
  const noPeriodo = useMemo(() => {
    const ms = PERIODOS.find((p) => p.value === periodo)?.ms ?? 0;
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return logs.filter((log) => {
      if (ms && Date.now() - ts(log) > ms) return false;
      if (!termo) return true;
      return [log.titulo, log.mensagem, log.evento, log.categoria, log.detalhes_json]
        .some((v) => v?.toLocaleLowerCase("pt-BR").includes(termo));
    });
  }, [logs, periodo, busca]);

  const contagemNivel = useMemo(() => {
    const base = noPeriodo.filter((l) => categoria === "todas" || l.categoria === categoria);
    return { total: base.length, erro: base.filter((l) => l.nivel === "erro").length, aviso: base.filter((l) => l.nivel === "aviso").length, info: base.filter((l) => l.nivel === "info").length };
  }, [noPeriodo, categoria]);

  const categorias = useMemo(() => {
    const base = noPeriodo.filter((l) => nivel === "todos" || l.nivel === nivel);
    const mapa = new Map<string, number>();
    for (const l of base) mapa.set(l.categoria, (mapa.get(l.categoria) ?? 0) + 1);
    return Array.from(mapa.entries()).sort((a, b) => b[1] - a[1]);
  }, [noPeriodo, nivel]);

  const filtrados = useMemo(
    () => noPeriodo.filter((l) => (nivel === "todos" || l.nivel === nivel) && (categoria === "todas" || l.categoria === categoria)),
    [noPeriodo, nivel, categoria],
  );

  useEffect(() => { setPagina(0); setAbertos(new Set()); }, [busca, nivel, categoria, periodo]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / ITENS_POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtrados.slice(paginaAtual * ITENS_POR_PAGINA, (paginaAtual + 1) * ITENS_POR_PAGINA);
  const filtrosAtivos = nivel !== "todos" || categoria !== "todas" || periodo !== "todos" || busca.trim() !== "";

  function limparFiltros() { setNivel("todos"); setCategoria("todas"); setPeriodo("todos"); setBusca(""); }
  function alternar(id: number) {
    setAbertos((atuais) => { const p = new Set(atuais); if (p.has(id)) p.delete(id); else p.add(id); return p; });
  }
  async function copiarTexto(texto: string, aviso: string) {
    const ok = await copiar(texto);
    show(ok ? aviso : "Não foi possível copiar.", ok ? "info" : "error");
  }

  const tiles: { chave: Nivel | "todos"; rotulo: string; n: number; tom: string }[] = [
    { chave: "todos", rotulo: "Todas as ocorrências", n: contagemNivel.total, tom: "" },
    { chave: "erro", rotulo: "Erros", n: contagemNivel.erro, tom: NIVEIS.erro.tile },
    { chave: "aviso", rotulo: "Avisos", n: contagemNivel.aviso, tom: NIVEIS.aviso.tile },
    { chave: "info", rotulo: "Informações", n: contagemNivel.info, tom: "" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Atividade do sistema"
        description="Ocorrências e resultados das integrações, da mais recente para a mais antiga."
        actions={<Button variant="outline" onClick={() => void carregar()} loading={carregando}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <button key={t.chave} type="button" aria-pressed={nivel === t.chave} onClick={() => setNivel(nivel === t.chave ? "todos" : t.chave)}
            className={cn("rounded-2xl border p-4 text-left transition", nivel === t.chave ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900")}>
            <span className={cn("block text-2xl font-semibold leading-none", t.n > 0 && t.tom)}>{t.n}</span>
            <span className="mt-1.5 block text-xs text-zinc-500">{t.rotulo}</span>
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, telefone, evento ou erro…" className="pl-9" />
          </div>
          <Select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} className="sm:max-w-[190px]" aria-label="Período">
            {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
          {filtrosAtivos && <Button variant="ghost" onClick={limparFiltros}><X className="h-4 w-4" /> Limpar filtros</Button>}
        </div>
        {categorias.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800" role="group" aria-label="Origem">
            <Filter className="h-3.5 w-3.5 text-zinc-400" aria-hidden />
            {[["todas", "Todas", categorias.reduce((a, [, n]) => a + n, 0)] as [string, string, number], ...categorias.map(([c, n]) => [c, nomeCategoria(c), n] as [string, string, number])].map(([c, rotulo, n]) => (
              <button key={c} type="button" aria-pressed={categoria === c} onClick={() => setCategoria(categoria === c ? "todas" : c)}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-medium transition", categoria === c ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-200" : "border-zinc-200 text-zinc-600 hover:border-accent-400 dark:border-zinc-700 dark:text-zinc-300")}>
                {rotulo} <span className="text-zinc-400">{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {carregando && logs.length === 0 ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : erro ? (
        <EmptyState icon={CircleX} title="Não foi possível carregar os registros" description={erro} action={<Button variant="outline" onClick={() => void carregar()}>Tentar novamente</Button>} />
      ) : filtrados.length === 0 ? (
        <EmptyState icon={ScrollText} title={logs.length ? "Nenhuma ocorrência para esses filtros" : "Nenhuma ocorrência registrada ainda"}
          description={logs.length ? "Escolha outro painel, ajuste a busca ou o período." : "Alertas automáticos, erros e resultados das integrações aparecerão aqui."}
          action={logs.length ? <Button variant="outline" onClick={limparFiltros}>Limpar filtros</Button> : undefined} />
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
            {visiveis.map((log) => {
              const detalhes = lerDetalhes(log);
              const n = NIVEIS[log.nivel] ?? NIVEIS.info;
              const Icone = n.icon;
              const aberto = abertos.has(log.id);
              const json = jsonLegivel(log.detalhes_json);
              return (
                <li key={log.id}>
                  <div className="flex items-center gap-1 pr-2 transition hover:bg-accent-50/40 dark:hover:bg-white/5">
                    <button type="button" aria-expanded={aberto} onClick={() => alternar(log.id)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                      <Icone className={cn("h-4 w-4 shrink-0", n.icone)} aria-label={n.label} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{log.titulo}</span>
                        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{nomeCategoria(log.categoria)} · {rotuloOrigem(log, detalhes)}{log.mensagem ? ` · ${log.mensagem}` : ""}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={formatarDataHora(log.created_at)}>{horaRelativa(log.created_at)}</span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-400 transition", aberto && "rotate-180")} />
                    </button>
                    <MenuSuspenso gatilho={({ aberto: a, alternar: alt }) => (
                      <button type="button" aria-label={`Mais ações para ${log.titulo}`} aria-expanded={a} onClick={alt} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><MoreHorizontal className="h-4 w-4" /></button>
                    )}>
                      {(fechar) => <>
                        <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); void copiarTexto(`${log.titulo}${log.mensagem ? `\n${log.mensagem}` : ""}`, "Texto copiado."); }}><Copy className="h-4 w-4" /> Copiar texto</button>
                        {json && <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); void copiarTexto(json, "Detalhes copiados."); }}><Clipboard className="h-4 w-4" /> Copiar detalhes (JSON)</button>}
                        <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); setCategoria(log.categoria); }}><Filter className="h-4 w-4" /> Ver só {nomeCategoria(log.categoria)}</button>
                      </>}
                    </MenuSuspenso>
                  </div>
                  {aberto && (
                    <div className="space-y-3 bg-zinc-50/60 px-4 pb-4 pt-3 text-sm dark:bg-zinc-900/40">
                      <dl className="grid gap-x-6 gap-y-1 text-xs text-zinc-500 sm:grid-cols-2 dark:text-zinc-400">
                        <div><dt className="inline">Quando: </dt><dd className="inline text-zinc-800 dark:text-zinc-200">{formatarDataHora(log.created_at)}</dd></div>
                        <div><dt className="inline">Nível: </dt><dd className="inline text-zinc-800 dark:text-zinc-200">{n.label}</dd></div>
                        <div><dt className="inline">Evento: </dt><dd className="inline break-all text-zinc-800 dark:text-zinc-200">{log.evento}</dd></div>
                        <div><dt className="inline">Registro: </dt><dd className="inline text-zinc-800 dark:text-zinc-200">#{log.id}</dd></div>
                      </dl>
                      {log.mensagem && <p className="whitespace-pre-wrap break-words text-sm text-zinc-700 dark:text-zinc-300">{log.mensagem}</p>}
                      {detalhes && <DetalhesNotificacao detalhes={detalhes} />}
                      {json && (
                        <details className="rounded-xl border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                          <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-300">Detalhes completos (JSON)</summary>
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="outline" onClick={() => void copiarTexto(json, "Detalhes copiados.")}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
                          </div>
                          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-3 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{json}</pre>
                        </details>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {filtrados.length > ITENS_POR_PAGINA && (
            <Pagination page={paginaAtual} totalItems={filtrados.length} pageSize={ITENS_POR_PAGINA} onPageChange={(p) => { setPagina(p); setAbertos(new Set()); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
          )}
          <p className="text-right text-xs text-zinc-500">{filtrados.length} de {logs.length} ocorrência(s)</p>
        </>
      )}
    </div>
  );
}
