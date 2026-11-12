import { ActivityBadge, RegisterAction, type AtividadeProcesso } from "@/components/djen/ActivityBadge";
import { Acompanhamento } from "./Acompanhamento";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronDown, Clock3, GripVertical, History, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";

interface Lista { id: number; nome: string; posicao: number; contar_dias: number; codigo: string | null; regra_categoria: string | null; area: string | null }
const AREAS: [string, string][] = [["previdenciario", "Previdenciário"], ["trabalhista", "Trabalhista"], ["bancario", "Bancário"], ["civel", "Cível / outros"]];
const rotuloArea = (a: string | null) => AREAS.find(([k]) => k === a)?.[1] || "Previdenciário";
const listaServeArea = (l: Lista, area: string) => !l.area || l.area.split(",").includes(area);
const CHAVE_AREA = "disparazap:quadro-area";
interface Cartao {
  atividade?: AtividadeProcesso | null;
  processo_chave: string; lista_id: number; posicao: number; entrou_em: string;
  inicio_espera_em: string | null; modo: "automatico" | "manual";
  etapa_publicacao_id: number | null; etapa_evidencia: string | null;
  sugestao: { codigo: string; lista_nome: string | null; evidencia: string | null } | null;
  numero: string; cliente_nome: string | null;
  publicacao_id: number; data_disponibilizacao: string; situacao: string;
  resumo: string; categorias: string[]; publicacoes_total: number;
  publicacoes_nao_lidas: number; prazos_abertos: number;
  classe: string | null; tribunal: string | null; orgao: string | null;
  area: string | null; area_manual: number;
}
interface Quadro { listas: Lista[]; cartoes: Cartao[] }
interface Movimento { origem: string | null; destino: string; origem_movimento: "automatico" | "manual"; created_at: string }
const normal = (texto: string) => texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const dataBR = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const diasDesde = (data: string) => Math.max(0, Math.floor((Date.parse(`${hoje()}T12:00:00Z`) - Date.parse(`${data}T12:00:00Z`)) / 86400000));
const msg = (e: unknown) => e instanceof ApiError ? e.message : "Não foi possível salvar a alteração no quadro.";
const regras = [
  ["proposta_acordo", "Proposta de acordo"], ["homologacao_acordo", "Acordo homologado"],
  ["precatorio", "Precatório"], ["extincao_execucao", "Execução extinta"],
  ["extincao_processo", "Processo extinto"], ["levantamento_valores", "Levantamento de valores"],
  ["decisao_interlocutoria", "Decisão interlocutória"], ["despacho", "Despacho"], ["intimacao", "Intimação"],
  ["audiencia", "Audiência"], ["citacao_contestacao", "Citação / contestação"], ["vista_laudo", "Vista do laudo"],
  ["transito_julgado", "Trânsito em julgado"], ["arquivamento", "Arquivamento"],
] as const;

export function QuadroProcessos() {
  const { can } = useAuth();
  const canManage = can("processes.manage");
  const { show } = useToast();
  const [publicacaoAberta, setPublicacaoAberta] = useState<number | null>(null);
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [busca, setBusca] = useState(""), [filtro, setFiltro] = useState("todos");
  const [erro, setErro] = useState(""), [busy, setBusy] = useState(false);
  const [nomeNovo, setNomeNovo] = useState(""), [contarNovo, setContarNovo] = useState(false);
  const [regraNova, setRegraNova] = useState("");
  const [editando, setEditando] = useState<number | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState(""), [contarEdicao, setContarEdicao] = useState(false);
  const [regraEdicao, setRegraEdicao] = useState("");
  const [excluir, setExcluir] = useState<Lista | null>(null);
  const [historicoDe, setHistoricoDe] = useState<Cartao | null>(null);
  const [historico, setHistorico] = useState<Movimento[]>([]);
  const [movendo, setMovendo] = useState<Cartao | null>(null);
  const [destino, setDestino] = useState("");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [foco, setFoco] = useState<number | null>(null);
  const [classeFiltro, setClasseFiltro] = useState("");
  const [areaFiltro, setAreaFiltro] = useState(() => { try { return localStorage.getItem(CHAVE_AREA) || ""; } catch { return ""; } });
  const escolherArea = (a: string) => { setAreaFiltro(a); setFoco(null); try { localStorage.setItem(CHAVE_AREA, a); } catch { /* preferência só desta sessão */ } };
  const [areaEdicao, setAreaEdicao] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [vazias, setVazias] = useState(() => { try { return localStorage.getItem("disparazap:quadro-vazias") === "1"; } catch { return false; } });
  const alternarVazias = (v: boolean) => { setVazias(v); try { localStorage.setItem("disparazap:quadro-vazias", v ? "1" : "0"); } catch { /* só desta sessão */ } };
  const [listaArrastada, setListaArrastada] = useState<number | null>(null);
  const [alvoLista, setAlvoLista] = useState<number | null>(null);
  const [alvoCartao, setAlvoCartao] = useState<string | null>(null);
  const [alvoEtapa, setAlvoEtapa] = useState<number | null>(null);
  const [menuEtapas, setMenuEtapas] = useState(false), [buscaEtapa, setBuscaEtapa] = useState("");
  const menuEtapasRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuEtapas) return;
    const fora = (e: MouseEvent) => { if (menuEtapasRef.current && !menuEtapasRef.current.contains(e.target as Node)) setMenuEtapas(false); };
    document.addEventListener("mousedown", fora); return () => document.removeEventListener("mousedown", fora);
  }, [menuEtapas]);
  const [destinoLote, setDestinoLote] = useState("");
  // A roda do mouse rola o quadro na horizontal. Uma coluna que ainda pode rolar na vertical
  // continua rolando por dentro; nas pontas do quadro a página volta a rolar normalmente.
  const quadroRef = useRef<HTMLDivElement | null>(null);
  const quadroPronto = Boolean(quadro);
  useEffect(() => {
    const el = quadroRef.current;
    if (!el) return;
    const aoRolar = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const coluna = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-rolagem-coluna]");
      if (coluna && coluna.scrollHeight > coluna.clientHeight) {
        const descendo = e.deltaY > 0;
        const podeRolar = descendo ? coluna.scrollTop + coluna.clientHeight < coluna.scrollHeight - 1 : coluna.scrollTop > 0;
        if (podeRolar) return;
      }
      const alvo = e.deltaY > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0;
      if (!alvo) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY });
    };
    el.addEventListener("wheel", aoRolar, { passive: false });
    return () => el.removeEventListener("wheel", aoRolar);
  }, [quadroPronto]);

  const carregar = useCallback(async () => {
    try { setQuadro(await api.get<Quadro>("/djen/kanban")); setErro(""); }
    catch (e) { setErro(msg(e)); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useSocketEvent("djen:changed", carregar);
  useSocketEvent("connect", carregar);
  async function acao(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); await carregar(); }
    catch (e) { show(msg(e), "error"); }
    finally { setBusy(false); }
  }
  function abrirHistorico(c: Cartao) {
    setHistoricoDe(c); setHistorico([]);
    void api.get<Movimento[]>(`/djen/kanban/cartoes/${encodeURIComponent(c.processo_chave)}/historico`)
      .then(setHistorico).catch((e) => show(msg(e), "error"));
  }
  /** Coloca a lista `origem` na posição da lista `alvo` (arrastar e soltar ou teclado). */
  function moverListaPara(origem: number, alvo: number) {
    if (!quadro || origem === alvo) return;
    const ids = quadro.listas.map((l) => l.id), de = ids.indexOf(origem), para = ids.indexOf(alvo);
    if (de < 0 || para < 0) return;
    ids.splice(de, 1); ids.splice(para, 0, origem);
    void acao(() => api.put("/djen/kanban/listas/ordem", { ids }));
  }
  /** Rola o quadro quando o cartão ou a lista é levado para perto das bordas (com muitas etapas, o destino pode estar longe). */
  function rolarAoArrastar(e: React.DragEvent) {
    const el = quadroRef.current; if (!el) return;
    const r = el.getBoundingClientRect(), borda = 110;
    if (e.clientX < r.left + borda) el.scrollBy({ left: -34 }); else if (e.clientX > r.right - borda) el.scrollBy({ left: 34 });
  }
  function soltarCartao(chave: string, destino: number, antesDe?: string) {
    setArrastando(null); setAlvoCartao(null); setAlvoEtapa(null);
    const c = quadro?.cartoes.find((x) => x.processo_chave === chave);
    if (!c || !canManage || busy || chave === antesDe) return;
    if (c.lista_id === destino && antesDe === undefined) return;
    void acao(() => api.put(`/djen/kanban/cartoes/${encodeURIComponent(chave)}`, { lista_id: destino, ...(antesDe ? { antes_de: antesDe } : {}) }));
  }

  const codigoDa = (c: Cartao) => quadro?.listas.find((l) => l.id === c.lista_id)?.codigo;
  const termo = normal(busca.trim());
  const areaDoCartao = (c: Cartao) => c.area || "previdenciario";
  const filtrados = quadro?.cartoes.filter((c) =>
    (!areaFiltro || areaDoCartao(c) === areaFiltro) &&
    (!classeFiltro || (c.classe || "Sem classe informada") === classeFiltro) &&
    (!termo || normal(`${c.cliente_nome || ""} ${c.numero} ${c.resumo}`).includes(termo)) &&
    (filtro === "todos" || (filtro === "prazos" && c.prazos_abertos > 0) || (filtro === "nao_lidos" && c.publicacoes_nao_lidas > 0)
      || (filtro === "manual" && c.modo === "manual") || (filtro === "automatico" && c.modo === "automatico")
      || (filtro === "com_atividade" && Boolean(c.atividade))
      || (filtro === "triagem" && codigoDa(c) === "triagem") || (filtro === "sem_etapa" && codigoDa(c) === "aguarda_juizo")
      || (filtro === "escritorio" && codigoDa(c) === "prov_escritorio") || (filtro === "terceiros" && codigoDa(c) === "aguarda_terceiros")),
  ) || [];
  // Classes processuais presentes nos cartões (com contagem), para agrupar e mover de uma vez.
  const classes = (() => {
    const mapa = new Map<string, number>();
    for (const c of quadro?.cartoes || []) if (foco === null || c.lista_id === foco) { const k = c.classe || "Sem classe informada"; mapa.set(k, (mapa.get(k) || 0) + 1); }
    return [...mapa.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  })();
  const alvoLote = filtrados.filter((c) => foco === null || c.lista_id === foco).slice(0, 500);
  const filtrando = Boolean(termo) || filtro !== "todos" || Boolean(classeFiltro) || foco !== null;
  const listasDaArea = quadro?.listas.filter((l) => !areaFiltro || listaServeArea(l, areaFiltro) || filtrados.some((c) => c.lista_id === l.id)) || [];
  const qtdNaLista = (id: number) => filtrados.filter((c) => c.lista_id === id).length;
  const listasVisiveis = listasDaArea.filter((l) => (foco === null || l.id === foco) && (vazias || foco === l.id || qtdNaLista(l.id) > 0 || Boolean(editando === l.id)));
  const vaziasOcultas = listasDaArea.length - listasVisiveis.length;
  const etapaDoFoco = quadro?.listas.find((l) => l.id === foco);
  const contagemPorArea = (a: string) => quadro?.cartoes.filter((c) => areaDoCartao(c) === a).length ?? 0;
  const alternar = (chave: string) => setSelecionados((atual) => atual.includes(chave) ? atual.filter((c) => c !== chave) : [...atual, chave]);
  const moverLote = () => {
    if (!selecionados.length || !destinoLote) return;
    void acao(async () => {
      const r = await api.post<{ movidos: number }>("/djen/kanban/mover-lote", { processos: selecionados, lista_id: Number(destinoLote) });
      show(`${r.movidos} processo(s) movido(s) como etapa manual.`, "success");
      setSelecionados([]); setDestinoLote("");
    });
  };
  return <div className="space-y-5">
    <PageHeader title="Quadro de processos" description="Etapas pelo histórico do DJEN. Arraste um cartão ou use Mover para corrigir sua etapa; a escolha fica mantida até você voltar ao automático."
      actions={<>
        {canManage && <Button variant="outline" disabled={busy} title="Reavalia o histórico de todos os cartões automáticos. Etapas escolhidas manualmente não são alteradas." onClick={() => void acao(async () => {
          const r = await api.post<{ movidos: number; triagem_antes: number; triagem_depois: number }>("/djen/kanban/reclassificar", {});
          show(`Reclassificação concluída: ${r.movidos} cartão(ões) movido(s). Sem etapa identificada: ${r.triagem_antes} → ${r.triagem_depois}.`, "success");
        })}><Sparkles className="h-4 w-4" /> Reclassificar</Button>}
        <Button variant="outline" onClick={() => void carregar()}><RefreshCw className="h-4 w-4" /> Atualizar</Button></>} />
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input aria-label="Buscar processos no quadro" placeholder="Buscar cliente, processo ou andamento…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <Select aria-label="Filtrar cartões" className="w-auto min-w-[180px]" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
        <option value="todos">Todos os processos</option><option value="triagem">Sem etapa identificada</option><option value="sem_etapa">Sem etapa específica (aguardando juízo)</option><option value="escritorio">Providência do escritório</option><option value="terceiros">Aguardando outra parte / terceiros</option><option value="automatico">Etapa automática</option><option value="manual">Etapa manual</option><option value="prazos">Com prazo em aberto</option><option value="nao_lidos">Com publicação não lida</option><option value="com_atividade">Com dias sem providência</option>
      </Select>
      <Select aria-label="Filtrar por classe processual" className="w-auto min-w-[200px] max-w-[320px]" value={classeFiltro} onChange={(e) => setClasseFiltro(e.target.value)}>
        <option value="">Todas as classes processuais</option>
        {classes.map(([nome, n]) => <option key={nome} value={nome}>{nome} ({n})</option>)}
        {classeFiltro && !classes.some(([nome]) => nome === classeFiltro) && <option value={classeFiltro}>{classeFiltro} (0)</option>}
      </Select>
      {canManage && filtrando && alvoLote.length > 0 && <Button size="sm" variant="outline" onClick={() => setSelecionados(alvoLote.map((c) => c.processo_chave))}>Selecionar todos os {alvoLote.length} filtrados</Button>}
      {(classeFiltro || termo || filtro !== "todos") && <Button size="sm" variant="ghost" onClick={() => { setClasseFiltro(""); setBusca(""); setFiltro("todos"); }}>Limpar filtros</Button>}
      <span className="text-xs text-zinc-500">{filtrados.length} de {quadro?.cartoes.length ?? 0} processos</span>
    </div>
    {quadro && <div className="flex flex-wrap items-center gap-2" aria-label="Área do processo">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Área</span>
      <button type="button" onClick={() => escolherArea("")} aria-pressed={areaFiltro === ""} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${areaFiltro === "" ? "border-accent-600 bg-accent-600 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-accent-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>Todas</button>
      {AREAS.map(([k, nome]) => <button key={k} type="button" onClick={() => escolherArea(areaFiltro === k ? "" : k)} aria-pressed={areaFiltro === k} disabled={!contagemPorArea(k) && areaFiltro !== k}
        className={`rounded-full border px-3 py-1 text-xs transition disabled:opacity-40 ${areaFiltro === k ? "border-accent-600 bg-accent-600 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-accent-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>{nome} <strong className="ml-1">{contagemPorArea(k)}</strong></button>)}
    </div>}
    {quadro && <div className="flex flex-wrap items-center gap-3" aria-label="Etapas do quadro">
      <div ref={menuEtapasRef} className="relative">
        <button type="button" onClick={() => setMenuEtapas((v) => !v)} aria-expanded={menuEtapas} className={`flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${etapaDoFoco ? "border-accent-600 bg-accent-50 text-accent-800 dark:bg-accent-500/10 dark:text-accent-200" : "border-zinc-200 bg-white text-zinc-700 hover:border-accent-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`}>
          {etapaDoFoco ? `Etapa: ${etapaDoFoco.nome}` : `Etapas (${listasVisiveis.length} de ${listasDaArea.length} no quadro)`} <ChevronDown className="h-4 w-4" />
        </button>
        {etapaDoFoco && <button type="button" aria-label="Voltar a mostrar todas as etapas" onClick={() => setFoco(null)} className="ml-1 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>}
        {menuEtapas && <div className="absolute left-0 top-12 z-40 w-[320px] rounded-2xl border border-zinc-200 bg-white p-2 shadow-card dark:border-zinc-700 dark:bg-zinc-900">
          <Input autoFocus aria-label="Buscar etapa" placeholder="Buscar etapa…" className="mb-2" value={buscaEtapa} onChange={(e) => setBuscaEtapa(e.target.value)} />
          <ul className="max-h-[360px] overflow-y-auto">
            <li><button type="button" onClick={() => { setFoco(null); setMenuEtapas(false); }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${foco === null ? "font-semibold text-accent-700" : ""}`}>Todas as etapas <span className="text-xs text-zinc-500">{filtrados.length}</span></button></li>
            {listasDaArea.filter((l) => !buscaEtapa.trim() || normal(l.nome).includes(normal(buscaEtapa.trim()))).map((l) => { const n = qtdNaLista(l.id); return (
              <li key={l.id}><button type="button" onClick={() => { setFoco(l.id); setMenuEtapas(false); }} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${foco === l.id ? "font-semibold text-accent-700" : n ? "" : "text-zinc-400"}`}><span className="truncate">{l.nome}</span><span className={`rounded-full px-2 py-0.5 text-xs ${n ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200" : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"}`}>{n}</span></button></li>); })}
          </ul>
        </div>}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={vazias} onChange={(e) => alternarVazias(e.target.checked)} /> Mostrar etapas vazias{!vazias && vaziasOcultas > 0 ? ` (${vaziasOcultas} oculta${vaziasOcultas > 1 ? "s" : ""})` : ""}</label>
      {canManage && <span className="text-xs text-zinc-500">Arraste os <GripVertical className="inline h-3.5 w-3.5" /> do título para reordenar as etapas e os cartões para movê-los ou ordená-los.</span>}
    </div>}
    {canManage && selecionados.length > 0 && <div role="region" aria-label="Ações em lote" className="sticky top-20 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent-300 bg-accent-50 p-3 shadow-sm dark:border-accent-800 dark:bg-accent-950">
      <strong className="text-xs">{selecionados.length} processo(s) selecionado(s)</strong>
      <Select aria-label="Lista de destino do lote" className="w-auto min-w-[220px]" value={destinoLote} onChange={(e) => setDestinoLote(e.target.value)}>
        <option value="">Mover para…</option>{quadro?.listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
      </Select>
      <Button size="sm" disabled={busy || !destinoLote} onClick={moverLote}>Mover selecionados</Button>
      <Button size="sm" variant="ghost" onClick={() => setSelecionados([])}>Limpar seleção</Button>
      <span className="text-[11px] text-zinc-500">O lote vira etapa manual e permanece até você voltar ao automático.</span>
    </div>}
    {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{erro}</p>}
    {!quadro && !erro && <p className="text-sm text-zinc-500">Carregando quadro…</p>}
    {canManage && arrastando && quadro && <div role="region" aria-label="Soltar em qualquer etapa" className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 p-3 shadow-card backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95 lg:left-[251px]">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Solte em qualquer etapa</p>
      <div className="flex max-h-[28vh] flex-wrap gap-2 overflow-y-auto">
        {quadro.listas.map((l) => <div key={l.id} onDragOver={(e) => { e.preventDefault(); setAlvoEtapa(l.id); }} onDragLeave={() => setAlvoEtapa((a) => (a === l.id ? null : a))}
          onDrop={(e) => { e.preventDefault(); soltarCartao(e.dataTransfer.getData("application/x-disparazap-processo"), l.id); }}
          className={`rounded-full border px-3 py-1.5 text-xs transition ${alvoEtapa === l.id ? "border-accent-600 bg-accent-600 text-white" : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"}`}>{l.nome}</div>)}
      </div>
    </div>}
    {quadro && <div ref={quadroRef} className="-mx-4 overflow-x-auto px-4 pb-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex min-h-[420px] w-max items-start gap-3">
        {listasVisiveis.map((lista) => {
          const cartoes = filtrados.filter((c) => c.lista_id === lista.id);
          const totalNaLista = quadro.cartoes.filter((c) => c.lista_id === lista.id).length;
          return <section key={lista.id} aria-label={`${lista.nome}: ${cartoes.length} processos`}
            onDragOver={(e) => { if (!canManage || busy) return; if (listaArrastada !== null) { e.preventDefault(); setAlvoLista(lista.id); rolarAoArrastar(e); } else if (arrastando) { e.preventDefault(); rolarAoArrastar(e); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setAlvoLista((a) => (a === lista.id ? null : a)); } }}
            onDrop={(e) => { e.preventDefault();
              const dl = e.dataTransfer.getData("application/x-disparazap-lista");
              if (dl) { setListaArrastada(null); setAlvoLista(null); moverListaPara(Number(dl), lista.id); return; }
              soltarCartao(e.dataTransfer.getData("application/x-disparazap-processo"), lista.id); }}
            className={`w-[310px] shrink-0 rounded-2xl border border-t-[3px] border-zinc-200/80 bg-zinc-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-900 ${alvoLista === lista.id && listaArrastada !== null && listaArrastada !== lista.id ? "ring-2 ring-accent-500 ring-offset-2 dark:ring-offset-zinc-950" : ""} ${listaArrastada === lista.id ? "opacity-50" : ""} ${lista.codigo === "triagem" ? "border-t-zinc-400" : lista.contar_dias ? "border-t-amber-400" : lista.regra_categoria ? "border-t-accent-500" : "border-t-zinc-300 dark:border-t-zinc-700"}`}>
            {editando === lista.id ? <form className="space-y-2" onSubmit={(e) => {
              e.preventDefault(); void acao(async () => {
                await api.put(`/djen/kanban/listas/${lista.id}`, { nome: nomeEdicao, contar_dias: contarEdicao, regra_categoria: regraEdicao });
                setEditando(null);
              });
            }}>
              <Input autoFocus aria-label="Nome da lista" value={nomeEdicao} onChange={(e) => setNomeEdicao(e.target.value)} maxLength={70} />
              {!lista.codigo && <Select aria-label="Categoria automática desta lista" value={regraEdicao} onChange={(e) => setRegraEdicao(e.target.value)} required>
                <option value="">Escolha a categoria do DJEN</option>{regras.map(([codigo, nome]) => <option key={codigo} value={codigo}>{nome}</option>)}
              </Select>}
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={contarEdicao} onChange={(e) => setContarEdicao(e.target.checked)} /> Contar dias nesta etapa</label>
              <div className="flex gap-2"><Button size="sm" disabled={busy} type="submit">Salvar</Button><Button size="sm" variant="ghost" type="button" onClick={() => setEditando(null)}>Cancelar</Button></div>
            </form> : <div className="mb-3 flex items-center justify-between gap-1 px-1">
              <h2 className="flex min-w-0 items-center gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100" title={lista.nome}>
                {canManage && <span role="button" tabIndex={0} draggable aria-label={`Reordenar a etapa ${lista.nome}: arraste, ou use as setas do teclado`} title="Arraste para reordenar a etapa"
                  onDragStart={(e) => { e.dataTransfer.setData("application/x-disparazap-lista", String(lista.id)); e.dataTransfer.effectAllowed = "move"; const sec = e.currentTarget.closest("section"); if (sec) e.dataTransfer.setDragImage(sec, 24, 24); setListaArrastada(lista.id); }}
                  onDragEnd={() => { setListaArrastada(null); setAlvoLista(null); }}
                  onKeyDown={(e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); const i = listasVisiveis.findIndex((l) => l.id === lista.id), v = listasVisiveis[i + (e.key === "ArrowLeft" ? -1 : 1)]; if (v) moverListaPara(lista.id, v.id); }}
                  className="-ml-1 shrink-0 cursor-grab rounded p-1 text-zinc-400 hover:bg-white hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 active:cursor-grabbing dark:hover:bg-zinc-800"><GripVertical className="h-4 w-4" /></span>}
                <span className="truncate">{lista.nome}</span></h2>
              <span className="flex shrink-0 items-center gap-2">
                {canManage && cartoes.length > 0 && <label className="flex items-center gap-1 text-[10px] text-zinc-500" title="Selecionar todos desta lista"><Checkbox aria-label={`Selecionar todos de ${lista.nome}`} checked={cartoes.every((c) => selecionados.includes(c.processo_chave))}
                  onChange={(e) => setSelecionados((atual) => e.target.checked ? [...new Set([...atual, ...cartoes.map((c) => c.processo_chave)])] : atual.filter((c) => !cartoes.some((x) => x.processo_chave === c)))} /></label>}
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">{cartoes.length}</span>
              </span>
            </div>}
            {canManage && editando !== lista.id && <div className="mb-3 flex items-center gap-1 border-b border-zinc-200 pb-2 dark:border-zinc-800">
              {lista.regra_categoria
                ? <span className="mr-auto max-w-[145px] truncate text-[10px] text-sky-700 dark:text-sky-300" title={`Categoria DJEN: ${regras.find(([codigo]) => codigo === lista.regra_categoria)?.[1] || lista.regra_categoria}`}>DJEN: {regras.find(([codigo]) => codigo === lista.regra_categoria)?.[1] || lista.regra_categoria}</span>
                : lista.contar_dias ? <span className="mr-auto flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300"><CalendarClock className="h-3 w-3" /> Contagem de espera</span>
                  : <span className="mr-auto text-[10px] text-zinc-400">Etapa do processo</span>}
              <button type="button" aria-label={`Editar lista ${lista.nome}`} title="Editar lista" onClick={() => { setEditando(lista.id); setNomeEdicao(lista.nome); setContarEdicao(Boolean(lista.contar_dias)); setRegraEdicao(lista.regra_categoria || ""); }} className="rounded p-1 text-zinc-500 hover:bg-white dark:hover:bg-zinc-800"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label={`Excluir lista ${lista.nome}`} title={lista.codigo ? "Etapa padrão do quadro" : totalNaLista ? "A lista contém processos" : "Excluir lista"} disabled={busy || totalNaLista > 0 || Boolean(lista.codigo)} onClick={() => setExcluir(lista)} className="rounded p-1 text-zinc-500 hover:bg-white disabled:opacity-30 dark:hover:bg-zinc-800"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>}
            {!lista.codigo && !lista.regra_categoria && editando !== lista.id && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">Escolha uma categoria do DJEN em Editar lista para ativar a movimentação automática.</p>}
            <div data-rolagem-coluna className="scrollbar-thin max-h-[min(68vh,780px)] min-h-24 space-y-2 overflow-y-auto pr-1">
              {cartoes.map((card) => <Fragment key={card.processo_chave}>
              {alvoCartao === card.processo_chave && arrastando && arrastando !== card.processo_chave && <div aria-hidden className="h-1.5 rounded-full bg-accent-500" />}
              <article
                draggable={canManage && !busy}
                onDragOver={(e) => { if (canManage && !busy && arrastando && arrastando !== card.processo_chave && listaArrastada === null) { e.preventDefault(); e.stopPropagation(); setAlvoCartao(card.processo_chave); rolarAoArrastar(e); } }}
                onDrop={(e) => { if (listaArrastada !== null || !arrastando) return; e.preventDefault(); e.stopPropagation(); soltarCartao(e.dataTransfer.getData("application/x-disparazap-processo"), lista.id, card.processo_chave); }}
                onDragStart={(e) => { e.dataTransfer.setData("application/x-disparazap-processo", card.processo_chave); e.dataTransfer.effectAllowed = "move"; setArrastando(card.processo_chave); }}
                onDragEnd={() => { setArrastando(null); setAlvoCartao(null); setAlvoEtapa(null); }}
                className={`rounded-xl border bg-white p-3.5 shadow-soft transition-[border-color,box-shadow] hover:shadow-card hover:border-accent-400 dark:bg-zinc-950 ${card.publicacoes_nao_lidas ? "border-l-4 border-l-accent-600 dark:border-zinc-800" : "border-zinc-200 dark:border-zinc-800"}`}>
                <div className="flex items-start gap-2">
                {canManage && <span className="mt-0.5 shrink-0" title="Selecionar para mover em lote"><Checkbox aria-label={`Selecionar processo ${card.numero}`} checked={selecionados.includes(card.processo_chave)} onChange={() => alternar(card.processo_chave)} /></span>}
                <button type="button" onClick={() => setPublicacaoAberta(card.publicacao_id)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
                  <span className="flex items-start justify-between gap-2"><strong className="line-clamp-2 text-[13px] leading-snug text-zinc-900 dark:text-zinc-100">{card.cliente_nome || "Nome a conferir"}</strong></span>
                  <span className="mt-1 block text-[11px] text-zinc-500">{card.numero}</span>
                  {!areaFiltro && card.area && card.area !== "previdenciario" && <span className="mt-1 inline-flex rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">{rotuloArea(card.area)}</span>}
                  {card.classe && <span className="mt-0.5 block truncate text-[10px] text-zinc-400" title={`${card.classe}${card.tribunal ? ` · ${card.tribunal}` : ""}`}>{card.classe}{card.tribunal ? ` · ${card.tribunal}` : ""}</span>}
                  <span className="mt-2 line-clamp-2 block text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{card.situacao || card.resumo}</span>
                  <span className="mt-2 flex flex-wrap gap-1 text-[10px]">
                    {card.publicacoes_nao_lidas > 0 && <span className="rounded bg-accent-50 px-1.5 py-0.5 font-semibold text-accent-700">{card.publicacoes_nao_lidas} não lida(s)</span>}
                    {card.prazos_abertos > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">{card.prazos_abertos} prazo(s) aberto(s)</span>}
                    {card.categorias.slice(0, 1).map((c) => <span key={c} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{c.replaceAll("_", " ")}</span>)}
                  </span>
                </button>
                </div>
                <div className="mt-2"><ActivityBadge atividade={card.atividade} /></div>
                {canManage && card.atividade && <RegisterAction publicacaoId={card.publicacao_id} onSaved={carregar} />}
                <div className="mt-2 text-[10px] text-zinc-500">
                  {(card.modo === "manual" || !card.etapa_publicacao_id) && <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${card.modo === "manual" ? "bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`} title={card.etapa_evidencia || undefined}>
                    {card.modo === "manual" ? "Etapa manual · mantida" : "Fase processual ainda não identificada"}
                  </span>}
                  {card.etapa_evidencia && <p className="mt-1 line-clamp-2 leading-relaxed" title={card.etapa_evidencia}>Base: “{card.etapa_evidencia}”</p>}
                  {card.sugestao && <p className="mt-1 leading-relaxed" title={card.sugestao.evidencia || undefined}>O histórico sugere: {card.sugestao.lista_nome}. Sua escolha manual foi mantida.</p>}
                </div>
                {lista.contar_dias > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <span className="flex items-center gap-1 font-semibold"><Clock3 className="h-3.5 w-3.5" /> {card.inicio_espera_em ? `${diasDesde(card.inicio_espera_em)} dia(s) nesta espera` : "Informe o início da espera"}</span>
                  {canManage && <label className="mt-1 flex items-center gap-2">Desde <input type="date" aria-label={`Início da espera de ${card.numero}`} max={hoje()} value={card.inicio_espera_em || ""} disabled={busy}
                    onChange={(e) => { const data = e.target.value; if (data) void acao(() => api.put(`/djen/kanban/cartoes/${encodeURIComponent(card.processo_chave)}/inicio`, { inicio_em: data })); }}
                    className="max-w-[145px] rounded border border-amber-200 bg-white px-1 py-0.5 text-[11px] text-zinc-800 dark:border-amber-900 dark:bg-zinc-900 dark:text-zinc-100" /></label>}
                </div>}
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  {canManage && <>
                    <button type="button" disabled={busy} onClick={() => { setMovendo(card); setDestino(String(card.lista_id)); setAreaEdicao(card.area_manual ? card.area || "" : ""); }} aria-label={`Mover processo ${card.numero}`} className="mr-auto rounded px-2 py-1 text-xs font-medium text-accent-700 hover:bg-accent-50 disabled:opacity-50">Mover</button>
                    {card.modo === "manual" && <button type="button" disabled={busy} onClick={() => void acao(() => api.put(`/djen/kanban/cartoes/${encodeURIComponent(card.processo_chave)}/automatico`, {}))} className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Voltar ao automático</button>}
                  </>}
                  <button type="button" aria-label={`Histórico das etapas de ${card.numero}`} title="Histórico das etapas" onClick={() => abrirHistorico(card)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><History className="h-4 w-4" /></button>
                </div>
              </article></Fragment>)}
              {!cartoes.length && <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-400 dark:border-zinc-700">Nenhum processo nesta etapa</p>}
            </div>
          </section>;
        })}
        {canManage && <form className="w-[292px] shrink-0 rounded-2xl border border-dashed border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900" onSubmit={(e) => {
          e.preventDefault(); void acao(async () => { await api.post("/djen/kanban/listas", { nome: nomeNovo, contar_dias: contarNovo, regra_categoria: regraNova }); setNomeNovo(""); setContarNovo(false); setRegraNova(""); });
        }}>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Nova lista</h2>
          <Input aria-label="Nome da nova lista" placeholder="Ex.: Proposta de acordo" className="mt-3" value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} maxLength={70} />
          <Select aria-label="Categoria automática da nova lista" className="mt-2" value={regraNova} onChange={(e) => setRegraNova(e.target.value)} required>
            <option value="">Escolha a categoria do DJEN</option>{regras.map(([codigo, nome]) => <option key={codigo} value={codigo}>{nome}</option>)}
          </Select>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">O nome da lista é livre. A categoria escolhida é a regra: quando o DJEN identificar esse ato na publicação, o cartão entra automaticamente na lista. Depois ele pode avançar com um novo andamento.</p>
          <label className="mt-3 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={contarNovo} onChange={(e) => setContarNovo(e.target.checked)} /> Contar dias nesta etapa</label>
          <Button size="sm" type="submit" disabled={busy || nomeNovo.trim().length < 2 || !regraNova} className="mt-3">Criar lista</Button>
        </form>}
      </div>
    </div>}
    <p className="text-[11px] text-zinc-500">As contagens nas listas são dias corridos de acompanhamento interno, desde a data indicada no cartão. Elas não substituem o prazo processual nem presumem vencimento de RPV.</p>
    {publicacaoAberta !== null && <Acompanhamento key={publicacaoAberta} detailId={publicacaoAberta} onCloseDetail={() => { setPublicacaoAberta(null); void carregar(); }} />}
    <Modal open={Boolean(movendo)} onClose={() => { if (!busy) setMovendo(null); }} title="Mover processo" maxWidth="max-w-md" footer={<>
      <Button variant="outline" disabled={busy} onClick={() => setMovendo(null)}>Cancelar</Button>
      <Button disabled={busy || !destino} onClick={() => { if (movendo) void acao(async () => {
        const areaAntes = movendo.area_manual ? movendo.area || "" : "";
        if (areaEdicao !== areaAntes) await api.put(`/djen/kanban/cartoes/${encodeURIComponent(movendo.processo_chave)}/area`, { area: areaEdicao || null });
        if (Number(destino) !== movendo.lista_id) await api.put(`/djen/kanban/cartoes/${encodeURIComponent(movendo.processo_chave)}`, { lista_id: Number(destino) });
        setMovendo(null);
      }); }}>Salvar</Button>
    </>}>
      <p className="mb-3 text-sm">{movendo?.cliente_nome || movendo?.numero}</p>
      <label className="block text-xs font-medium" htmlFor="kanban-area">Área do processo</label>
      <Select id="kanban-area" className="mt-2" value={areaEdicao} onChange={(e) => setAreaEdicao(e.target.value)} disabled={busy}>
        <option value="">Automática (detectada: {rotuloArea(movendo?.area ?? null)})</option>
        {AREAS.map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}
      </Select>
      <p className="mt-1 text-[11px] text-zinc-500">A área define quais etapas se aplicam (ex.: implantação do benefício só no previdenciário). Ao alterá-la, o cartão é reavaliado.</p>
      <label className="mt-4 block text-xs font-medium" htmlFor="kanban-destino">Lista de destino</label>
      <Select id="kanban-destino" className="mt-2" value={destino} onChange={(e) => setDestino(e.target.value)} disabled={busy}>
        {quadro?.listas.filter((l) => l.id === movendo?.lista_id || listaServeArea(l, areaEdicao || movendo?.area || "previdenciario")).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
      </Select>
      <p className="mt-3 text-xs text-zinc-500">A etapa ficará manual. Novas análises e publicações não substituirão sua escolha. Você pode voltar ao automático pelo cartão.</p>
    </Modal>
    <ConfirmDialog open={Boolean(excluir)} title="Excluir lista vazia?" message={`A lista ${excluir?.nome || ""} será removida do quadro.`} confirmLabel="Excluir lista" confirmVariant="danger" loading={busy} onCancel={() => setExcluir(null)} onConfirm={() => {
      if (excluir) void acao(async () => { await api.delete(`/djen/kanban/listas/${excluir.id}`); setExcluir(null); });
    }} />
    <Modal open={Boolean(historicoDe)} onClose={() => setHistoricoDe(null)} title={`Etapas do processo ${historicoDe?.numero || ""}`} maxWidth="max-w-xl" footer={<Button variant="outline" onClick={() => setHistoricoDe(null)}><X className="h-4 w-4" /> Fechar</Button>}>
      {!historico.length ? <p className="text-xs text-zinc-500">Nenhuma mudança de etapa registrada.</p> : <ol className="space-y-2 text-xs">{historico.map((item, i) => <li key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><strong>{item.origem || "Início"} → {item.destino}</strong><span className="mt-1 block text-zinc-500">{item.origem_movimento === "automatico" ? "DJEN · " : "Movimento manual · "}{new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></li>)}</ol>}
    </Modal>
  </div>;
}



