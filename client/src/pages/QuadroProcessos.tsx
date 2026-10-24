import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, CalendarClock, Clock3, History, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";

interface Lista { id: number; nome: string; posicao: number; contar_dias: number; codigo: string | null; regra_categoria: string | null }
interface Cartao {
  processo_chave: string; lista_id: number; posicao: number; entrou_em: string;
  inicio_espera_em: string | null; modo: "automatico" | "manual";
  etapa_publicacao_id: number | null; etapa_evidencia: string | null;
  sugestao: { codigo: string; lista_nome: string | null; evidencia: string | null } | null;
  numero: string; cliente_nome: string | null;
  publicacao_id: number; data_disponibilizacao: string; situacao: string;
  resumo: string; categorias: string[]; publicacoes_total: number;
  publicacoes_nao_lidas: number; prazos_abertos: number;
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
] as const;

export function QuadroProcessos() {
  const navigate = useNavigate(), { show } = useToast();
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
  function ordenar(lista: Lista, passo: number) {
    if (!quadro) return;
    const ids = quadro.listas.map((l) => l.id), origem = ids.indexOf(lista.id), destino = origem + passo;
    if (destino < 0 || destino >= ids.length) return;
    [ids[origem], ids[destino]] = [ids[destino], ids[origem]];
    void acao(() => api.put("/djen/kanban/listas/ordem", { ids }));
  }

  const termo = normal(busca.trim());
  const filtrados = quadro?.cartoes.filter((c) =>
    (!termo || normal(`${c.cliente_nome || ""} ${c.numero} ${c.resumo}`).includes(termo)) &&
    (filtro === "todos" || (filtro === "prazos" && c.prazos_abertos > 0) || (filtro === "nao_lidos" && c.publicacoes_nao_lidas > 0)),
  ) || [];
  return <div className="space-y-5">
    <PageHeader title="Quadro dos processos" description="Os cartões são posicionados automaticamente pelo histórico das publicações do DJEN. Quando um fato não é comprovado, o processo aguarda identificação."
      actions={<><Button variant="outline" onClick={() => navigate("/processos")}><ArrowLeft className="h-4 w-4" /> Publicações</Button><Button variant="outline" onClick={() => void carregar()}><RefreshCw className="h-4 w-4" /> Atualizar</Button></>} />
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
        <Input aria-label="Buscar processos no quadro" placeholder="Buscar cliente, processo ou andamento…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <Select aria-label="Filtrar cartões" className="w-auto min-w-[180px]" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
        <option value="todos">Todos os processos</option><option value="prazos">Com prazo em aberto</option><option value="nao_lidos">Com publicação não lida</option>
      </Select>
      <span className="text-xs text-zinc-500">{filtrados.length} de {quadro?.cartoes.length ?? 0} processos</span>
    </div>
    {erro && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{erro}</p>}
    {!quadro && !erro && <p className="text-sm text-zinc-500">Carregando quadro…</p>}
    {quadro && <div className="-mx-4 overflow-x-auto px-4 pb-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex min-h-[420px] w-max items-start gap-3">
        {quadro.listas.map((lista, indice) => {
          const cartoes = filtrados.filter((c) => c.lista_id === lista.id);
          const totalNaLista = quadro.cartoes.filter((c) => c.lista_id === lista.id).length;
          return <section key={lista.id} aria-label={`${lista.nome}: ${cartoes.length} processos`}
            className="w-[292px] shrink-0 rounded-2xl border border-zinc-200 bg-zinc-100/70 p-3 dark:border-zinc-800 dark:bg-zinc-900">
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
              <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100" title={lista.nome}>{lista.nome}</h2>
              <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">{cartoes.length}</span>
            </div>}
            {editando !== lista.id && <div className="mb-3 flex items-center gap-1 border-b border-zinc-200 pb-2 dark:border-zinc-800">
              {lista.regra_categoria
                ? <span className="mr-auto max-w-[145px] truncate text-[10px] text-sky-700 dark:text-sky-300" title={`Categoria DJEN: ${regras.find(([codigo]) => codigo === lista.regra_categoria)?.[1] || lista.regra_categoria}`}>DJEN: {regras.find(([codigo]) => codigo === lista.regra_categoria)?.[1] || lista.regra_categoria}</span>
                : lista.contar_dias ? <span className="mr-auto flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300"><CalendarClock className="h-3 w-3" /> Contagem de espera</span>
                  : <span className="mr-auto text-[10px] text-zinc-400">Etapa do processo</span>}
              <button type="button" disabled={indice === 0 || busy} aria-label={`Mover lista ${lista.nome} à esquerda`} title="Mover lista à esquerda" onClick={() => ordenar(lista, -1)} className="rounded p-1 text-zinc-500 hover:bg-white disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowLeft className="h-3.5 w-3.5" /></button>
              <button type="button" disabled={indice === quadro.listas.length - 1 || busy} aria-label={`Mover lista ${lista.nome} à direita`} title="Mover lista à direita" onClick={() => ordenar(lista, 1)} className="rounded p-1 text-zinc-500 hover:bg-white disabled:opacity-30 dark:hover:bg-zinc-800"><ArrowRight className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label={`Editar lista ${lista.nome}`} title="Editar lista" onClick={() => { setEditando(lista.id); setNomeEdicao(lista.nome); setContarEdicao(Boolean(lista.contar_dias)); setRegraEdicao(lista.regra_categoria || ""); }} className="rounded p-1 text-zinc-500 hover:bg-white dark:hover:bg-zinc-800"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" aria-label={`Excluir lista ${lista.nome}`} title={lista.codigo ? "Etapa padrão do quadro" : totalNaLista ? "A lista contém processos" : "Excluir lista"} disabled={busy || totalNaLista > 0 || Boolean(lista.codigo)} onClick={() => setExcluir(lista)} className="rounded p-1 text-zinc-500 hover:bg-white disabled:opacity-30 dark:hover:bg-zinc-800"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>}
            {!lista.codigo && !lista.regra_categoria && editando !== lista.id && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">Escolha uma categoria do DJEN em Editar lista para ativar a movimentação automática.</p>}
            <div className="scrollbar-thin max-h-[min(68vh,780px)] min-h-24 space-y-2 overflow-y-auto pr-1">
              {cartoes.map((card) => <article key={card.processo_chave}
                className={`rounded-xl border bg-white p-3 shadow-sm transition hover:border-accent-400 dark:bg-zinc-950 ${card.publicacoes_nao_lidas ? "border-l-4 border-l-accent-600 dark:border-zinc-800" : "border-zinc-200 dark:border-zinc-800"}`}>
                <button type="button" onClick={() => navigate(`/processos?abrir=${card.publicacao_id}`)} className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
                  <span className="flex items-start justify-between gap-2"><strong className="line-clamp-2 text-xs leading-snug text-zinc-900 dark:text-zinc-100">{card.cliente_nome || "Nome a conferir"}</strong></span>
                  <span className="mt-1 block text-[11px] text-zinc-500">{card.numero}</span>
                  <span className="mt-2 line-clamp-2 block text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">{card.situacao || card.resumo}</span>
                  <span className="mt-2 flex flex-wrap gap-1 text-[10px]">
                    {card.publicacoes_nao_lidas > 0 && <span className="rounded bg-accent-50 px-1.5 py-0.5 font-semibold text-accent-700">{card.publicacoes_nao_lidas} não lida(s)</span>}
                    {card.prazos_abertos > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">{card.prazos_abertos} prazo(s) aberto(s)</span>}
                    {card.categorias.slice(0, 1).map((c) => <span key={c} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{c.replaceAll("_", " ")}</span>)}
                  </span>
                </button>
                <div className="mt-2 text-[10px] text-zinc-500">
                  <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300" title={card.etapa_evidencia || undefined}>
                    {card.etapa_publicacao_id ? "Etapa automática · DJEN" : "Fase processual ainda não identificada"}
                  </span>
                  {card.etapa_evidencia && <p className="mt-1 line-clamp-2 leading-relaxed" title={card.etapa_evidencia}>Base: “{card.etapa_evidencia}”</p>}
                </div>
                {lista.contar_dias > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <span className="flex items-center gap-1 font-semibold"><Clock3 className="h-3.5 w-3.5" /> {card.inicio_espera_em ? `${diasDesde(card.inicio_espera_em)} dia(s) nesta espera` : "Informe o início da espera"}</span>
                  <label className="mt-1 flex items-center gap-2">Desde <input type="date" aria-label={`Início da espera de ${card.numero}`} max={hoje()} value={card.inicio_espera_em || ""} disabled={busy}
                    onChange={(e) => { const data = e.target.value; if (data) void acao(() => api.put(`/djen/kanban/cartoes/${encodeURIComponent(card.processo_chave)}/inicio`, { inicio_em: data })); }}
                    className="max-w-[145px] rounded border border-amber-200 bg-white px-1 py-0.5 text-[11px] text-zinc-800 dark:border-amber-900 dark:bg-zinc-900 dark:text-zinc-100" /></label>
                </div>}
                <div className="mt-3 flex items-center justify-end gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <button type="button" aria-label={`Histórico das etapas de ${card.numero}`} title="Histórico das etapas" onClick={() => abrirHistorico(card)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><History className="h-4 w-4" /></button>
                </div>
              </article>)}
              {!cartoes.length && <p className="rounded-lg border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-400 dark:border-zinc-700">Nenhum processo nesta etapa</p>}
            </div>
          </section>;
        })}
        <form className="w-[292px] shrink-0 rounded-2xl border border-dashed border-zinc-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900" onSubmit={(e) => {
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
        </form>
      </div>
    </div>}
    <p className="text-[11px] text-zinc-500">As contagens nas listas são dias corridos de acompanhamento interno, desde a data indicada no cartão. Elas não substituem o prazo processual nem presumem vencimento de RPV.</p>
    <ConfirmDialog open={Boolean(excluir)} title="Excluir lista vazia?" message={`A lista ${excluir?.nome || ""} será removida do quadro.`} confirmLabel="Excluir lista" confirmVariant="danger" loading={busy} onCancel={() => setExcluir(null)} onConfirm={() => {
      if (excluir) void acao(async () => { await api.delete(`/djen/kanban/listas/${excluir.id}`); setExcluir(null); });
    }} />
    <Modal open={Boolean(historicoDe)} onClose={() => setHistoricoDe(null)} title={`Etapas do processo ${historicoDe?.numero || ""}`} maxWidth="max-w-xl" footer={<Button variant="outline" onClick={() => setHistoricoDe(null)}><X className="h-4 w-4" /> Fechar</Button>}>
      {!historico.length ? <p className="text-xs text-zinc-500">Nenhuma mudança de etapa registrada.</p> : <ol className="space-y-2 text-xs">{historico.map((item, i) => <li key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"><strong>{item.origem || "Início"} → {item.destino}</strong><span className="mt-1 block text-zinc-500">{item.origem_movimento === "automatico" ? "DJEN · " : "Movimento manual · "}{new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span></li>)}</ol>}
    </Modal>
  </div>;
}
