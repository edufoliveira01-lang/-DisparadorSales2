import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  MessageCircleQuestion,
  MessageSquareReply,
  MoreHorizontal,
  NotebookPen,
  Phone,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/phone";
import type { PendingReply } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { AckIndicator } from "@/components/AckIndicator";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import { useAuth } from "@/context/AuthContext";

const ITENS_POR_PAGINA = 20;

type Filtro = "todos" | "enviado" | "entregue" | "lido" | "antigos";
type Ordenacao = "recentes" | "antigos" | "az" | "za";

const ORDENACAO_OPTIONS: { value: Ordenacao; label: string }[] = [
  { value: "recentes", label: "Mais recentes" },
  { value: "antigos", label: "Mais antigos" },
  { value: "az", label: "Nome (A-Z)" },
  { value: "za", label: "Nome (Z-A)" },
];

/** Quanto tempo o cliente está sem responder (a partir do envio). */
const idadeMs = (item: PendingReply) => Date.now() - Date.parse(`${item.created_at}Z`);
const DIAS_URGENTE = 2;
function haQuanto(item: PendingReply): string {
  const min = Math.max(0, Math.round(idadeMs(item) / 60000));
  if (min < 60) return `há ${Math.max(1, min)} min`;
  if (min < 60 * 24) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.floor(min / 1440)} dia(s)`;
}
const urgente = (item: PendingReply) => idadeMs(item) >= DIAS_URGENTE * 86_400_000;
const iniciais = (nome: string | null) => (nome || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
function combinaFiltro(item: PendingReply, filtro: Filtro): boolean {
  if (filtro === "todos") return true;
  if (filtro === "antigos") return urgente(item);
  if (filtro === "enviado") return item.ack === 1;
  if (filtro === "entregue") return item.ack === 2;
  return item.ack !== null && item.ack >= 3;
}

function dataLocalYMD(createdAtUtc: string): string {
  return new Date(createdAtUtc + "Z").toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatarData(item: PendingReply): string {
  return new Date(item.created_at + "Z").toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function PendentesResposta() {
  const { can } = useAuth();
  const canManage = can("pending.manage");
  const canSend = can("messages.send");
  const { show } = useToast();
  const [pendentes, setPendentes] = useState<PendingReply[] | null>(null);
  const [processando, setProcessando] = useState<number | null>(null);
  const [cobrando, setCobrando] = useState<number | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [apagandoSelecionados, setApagandoSelecionados] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [paginaAguardando, setPaginaAguardando] = useState(0);
  const [apagarAlvo, setApagarAlvo] = useState<PendingReply | null>(null);
  const [confirmMassaAberto, setConfirmMassaAberto] = useState(false);
  const [finalizarAlvo, setFinalizarAlvo] = useState<PendingReply | null>(null);
  const [observacaoFinalizacao, setObservacaoFinalizacao] = useState("");
  const [expandido, setExpandido] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("antigos");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [mostrarPeriodo, setMostrarPeriodo] = useState(false);

  const carregar = useCallback(async () => {
    setPendentes(await api.get<PendingReply[]>("/pending-replies"));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useRealtimeRefresh(carregar, ["pendingReply:resolved"]);
  useSocketEvent<PendingReply>("pendingReply:ack-update", (atualizado) => {
    setPendentes((prev) => (prev ? prev.map((item) => (item.id === atualizado.id ? atualizado : item)) : prev));
  });

  async function confirmar(item: PendingReply) {
    setProcessando(item.id);
    try {
      await api.post(`/pending-replies/${item.id}/confirmar`);
      show(`Cartão de ${item.card_nome || "cliente"} marcado como concluído.`, "success");
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao confirmar recebimento.", "error");
    } finally {
      setProcessando(null);
    }
  }

  function abrirFinalizacao(item: PendingReply) {
    setObservacaoFinalizacao("");
    setFinalizarAlvo(item);
  }

  async function finalizarEspera() {
    if (!finalizarAlvo) return;
    const item = finalizarAlvo;
    const observacao = observacaoFinalizacao.trim();
    if (observacao.length < 3) {
      show("Informe uma observação com pelo menos 3 caracteres.", "error");
      return;
    }
    setProcessando(item.id);
    try {
      await api.post(`/pending-replies/${item.id}/finalizar`, { observacao });
      show("Espera finalizada e observação registrada no Histórico.", "success");
      setFinalizarAlvo(null);
      setObservacaoFinalizacao("");
      await carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao finalizar a espera.", "error");
    } finally {
      setProcessando(null);
    }
  }

  async function cobrar(item: PendingReply) {
    if (processando !== null) return;
    setProcessando(item.id);
    setCobrando(item.id);
    try {
      await api.post(`/pending-replies/${item.id}/cobrar`);
      show(`Mensagem de cobrança enviada para ${item.card_nome || "cliente"}.`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem de cobrança.", "error");
    } finally {
      setCobrando(null);
      setProcessando(null);
    }
  }

  async function apagar(item: PendingReply) {
    setProcessando(item.id);
    try {
      await api.delete(`/pending-replies/${item.id}`);
      show("Registro apagado.", "info");
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao apagar registro.", "error");
    } finally {
      setProcessando(null);
    }
  }

  async function confirmarApagar() {
    if (!apagarAlvo) return;
    const alvo = apagarAlvo;
    setApagarAlvo(null);
    await apagar(alvo);
  }

  async function apagarSelecionados() {
    if (selecionados.size === 0) return;
    setApagandoSelecionados(true);
    try {
      const ids = Array.from(selecionados);
      await api.post("/pending-replies/apagar-em-massa", { ids });
      show(`${ids.length} registro(s) apagado(s).`, "success");
      setSelecionados(new Set());
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao apagar registros selecionados.", "error");
    } finally {
      setApagandoSelecionados(false);
    }
  }

  async function confirmarApagarSelecionados() {
    setConfirmMassaAberto(false);
    await apagarSelecionados();
  }

  function alternarSelecionado(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alternarSelecionarTodos(itens: PendingReply[]) {
    setSelecionados((prev) => {
      const todosMarcados = itens.length > 0 && itens.every((item) => prev.has(item.id));
      const next = new Set(prev);
      for (const item of itens) {
        if (todosMarcados) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  const aguardando = useMemo(() => {
    const base = pendentes?.filter((item) => item.status === "aguardando" && combinaFiltro(item, filtro)) ?? [];
    const termo = busca.trim().toLowerCase();
    const termoDigits = termo.replace(/\D/g, "");
    const filtrados = base.filter((item) => {
      if (termo) {
        const nomeMatch = (item.card_nome || "").toLowerCase().includes(termo);
        const telefoneMatch = termoDigits.length > 0 && item.telefone.replace(/\D/g, "").includes(termoDigits);
        if (!nomeMatch && !telefoneMatch) return false;
      }
      const dataItem = dataDe || dataAte ? dataLocalYMD(item.created_at) : "";
      if (dataDe && dataItem < dataDe) return false;
      if (dataAte && dataItem > dataAte) return false;
      return true;
    });

    return [...filtrados].sort((a, b) => {
      if (ordenacao === "recentes") return b.created_at.localeCompare(a.created_at);
      if (ordenacao === "antigos") return a.created_at.localeCompare(b.created_at);
      if (ordenacao === "az") return (a.card_nome || "").localeCompare(b.card_nome || "", "pt-BR");
      return (b.card_nome || "").localeCompare(a.card_nome || "", "pt-BR");
    });
  }, [pendentes, filtro, busca, dataDe, dataAte, ordenacao]);

  const resumo = useMemo(() => {
    const ativos = pendentes?.filter((item) => item.status === "aguardando") ?? [];
    return {
      total: ativos.length,
      enviados: ativos.filter((item) => item.ack === 1).length,
      entregues: ativos.filter((item) => item.ack === 2).length,
      lidos: ativos.filter((item) => item.ack !== null && item.ack >= 3).length,
      antigos: ativos.filter(urgente).length,
    };
  }, [pendentes]);

  const aguardandoPaginado = useMemo(
    () => aguardando.slice(paginaAguardando * ITENS_POR_PAGINA, (paginaAguardando + 1) * ITENS_POR_PAGINA),
    [aguardando, paginaAguardando]
  );

  useEffect(() => {
    setPaginaAguardando(0);
  }, [filtro, busca, dataDe, dataAte, ordenacao]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(aguardando.length / ITENS_POR_PAGINA) - 1);
    if (paginaAguardando > ultimaPagina) setPaginaAguardando(ultimaPagina);
  }, [aguardando, paginaAguardando]);

  const periodoAtivo = Boolean(dataDe || dataAte);
  const paineis: [Filtro, string, number][] = [["todos", "Aguardando resposta", resumo.total], ["antigos", `Sem resposta há ${DIAS_URGENTE}+ dias`, resumo.antigos], ["lido", "Lidas, sem resposta", resumo.lidos], ["entregue", "Entregues, não lidas", resumo.entregues], ["enviado", "Ainda não entregues", resumo.enviados]];
  const urgentes = aguardandoPaginado.filter(urgente), recentes = aguardandoPaginado.filter((i) => !urgente(i));
  const linha = (item: PendingReply, alerta: boolean) => (
    <li key={item.id} className={`flex flex-col gap-3 px-4 py-3 transition hover:bg-accent-50/40 dark:hover:bg-white/5 sm:flex-row sm:items-center ${selecionados.has(item.id) ? "bg-accent-50/60 dark:bg-accent-500/10" : ""}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {canManage && <Checkbox aria-label={`Selecionar ${item.card_nome || "cliente"}`} checked={selecionados.has(item.id)} onChange={() => alternarSelecionado(item.id)} />}
        <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-200 sm:flex">{iniciais(item.card_nome)}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.card_nome || "Sem nome"}</h3>
            <StatusBadge ack={item.ack} respostaStatus={item.status} />
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${alerta ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{haQuanto(item)}</span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500 dark:text-zinc-400"><span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{formatPhoneDisplay(item.telefone)}</span><span>Enviada em {formatarData(item)}</span><AckIndicator ack={item.ack} /></p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {canSend && <Button size="sm" onClick={() => cobrar(item)} loading={cobrando === item.id} disabled={processando !== null} title="Envia uma mensagem pedindo o retorno do cliente"><MessageCircleQuestion className="h-3.5 w-3.5" /> {cobrando === item.id ? "Enviando…" : "Cobrar resposta"}</Button>}
        {canManage && <Button size="sm" variant="outline" onClick={() => confirmar(item)} loading={processando === item.id && cobrando !== item.id} disabled={processando !== null} title="O cliente já respondeu: marca o atendimento como concluído"><CheckCircle2 className="h-3.5 w-3.5" /> Já respondeu</Button>}
        {canManage && <MenuSuspenso gatilho={({ aberto, alternar }) => <button type="button" aria-label={`Mais ações para ${item.card_nome || "cliente"}`} aria-expanded={aberto} onClick={alternar} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><MoreHorizontal className="h-4 w-4" /></button>}>
          {(fechar) => <>
            <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); abrirFinalizacao(item); }}><NotebookPen className="h-4 w-4" /> Finalizar espera (sem resposta)</button>
            <button type="button" role="menuitem" className="menu-pop-item text-red-600 dark:text-red-400" onClick={() => { fechar(); setApagarAlvo(item); }}><Trash2 className="h-4 w-4" /> Apagar registro</button>
          </>}
        </MenuSuspenso>}
      </div>
    </li>
  );
  const bloco = (titulo: string, sub: string, lista: PendingReply[], alerta: boolean) => lista.length > 0 && (
    <section className="space-y-2" aria-label={titulo}>
      <div><h2 className={`text-sm font-semibold ${alerta ? "text-amber-900 dark:text-amber-200" : "text-zinc-800 dark:text-zinc-100"}`}>{titulo} <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{lista.length}</span></h2><p className="text-xs text-zinc-500">{sub}</p></div>
      <ul className={`divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800 ${alerta ? "border-l-4 border-l-amber-500" : ""}`}>{lista.map((i) => linha(i, alerta))}</ul>
    </section>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Aguardando resposta"
        description="Clientes que receberam a mensagem e ainda não responderam. Comece pelos que estão esperando há mais tempo."
        actions={<Button variant="outline" onClick={carregar}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {paineis.map(([k, rotulo, n]) => (
          <button key={k} type="button" onClick={() => setFiltro(filtro === k && k !== "todos" ? "todos" : k)} aria-pressed={filtro === k}
            className={`rounded-2xl border p-4 text-left transition ${filtro === k ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"} ${k === "antigos" && n > 0 && filtro !== k ? "border-amber-300 dark:border-amber-700" : ""}`}>
            <span className={`block text-2xl font-semibold leading-none ${k === "antigos" && n > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{n}</span>
            <span className="mt-1.5 block text-xs text-zinc-500">{rotulo}</span>
          </button>))}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input placeholder="Buscar nome ou telefone…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <Select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)} className="sm:max-w-[190px]" aria-label="Ordenar">
            {ORDENACAO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Button variant={periodoAtivo ? "secondary" : "outline"} onClick={() => setMostrarPeriodo((valor) => !valor)}><SlidersHorizontal className="h-4 w-4" /> {periodoAtivo ? "Período aplicado" : "Período"}</Button>
          {canManage && aguardandoPaginado.length > 0 && <label className="flex shrink-0 cursor-pointer items-center gap-2 px-1 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={aguardandoPaginado.every((item) => selecionados.has(item.id))} onChange={() => alternarSelecionarTodos(aguardandoPaginado)} /> Marcar esta página</label>}
        </div>
        {(mostrarPeriodo || periodoAtivo) && (
          <div className="grid grid-cols-2 gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:flex sm:items-end">
            <div className="min-w-0 sm:w-44"><Label className="text-xs">Enviados de</Label><Input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} className="w-full" /></div>
            <div className="min-w-0 sm:w-44"><Label className="text-xs">Até</Label><Input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} className="w-full" /></div>
            {periodoAtivo && <Button variant="ghost" size="sm" className="col-span-2" onClick={() => { setDataDe(""); setDataAte(""); }}><X className="h-3.5 w-3.5" /> Limpar período</Button>}
          </div>
        )}
      </div>

      {canManage && selecionados.size > 0 && (
        <div role="region" aria-label="Ações em lote" className="sticky top-20 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-300 bg-accent-50 px-4 py-2.5 shadow-sm dark:border-accent-800 dark:bg-accent-950">
          <strong className="text-sm">{selecionados.size} registro(s) selecionado(s)</strong>
          <span className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button><Button variant="outline" className="danger-action" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}><Trash2 className="h-3.5 w-3.5" /> Apagar selecionados</Button></span>
        </div>
      )}

      {pendentes === null ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}</div>
      ) : resumo.total === 0 ? (
        <EmptyState icon={MessageSquareReply} title="Ninguém aguardando resposta" description='Quando uma mensagem for enviada a um cliente e ele ainda não responder, o atendimento aparece aqui. Para isso, configure uma "lista de confirmação" em Configurações > Trello.' />
      ) : aguardando.length === 0 ? (
        <EmptyState icon={Clock3} title="Nenhum resultado para esses filtros" description="Escolha outro painel acima, ajuste a busca ou o período." />
      ) : (
        <>
          {bloco(`Sem resposta há ${DIAS_URGENTE} dias ou mais`, "Vale cobrar o retorno ou finalizar a espera.", urgentes, true)}
          {bloco("Esperando há pouco tempo", "Ainda dentro do prazo normal de resposta.", recentes, false)}
          {aguardando.length > ITENS_POR_PAGINA && <Pagination page={paginaAguardando} totalItems={aguardando.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPaginaAguardando} />}
          <p className="text-right text-xs text-zinc-500">{aguardando.length} de {resumo.total} atendimento(s)</p>
        </>
      )}

      <ConfirmDialog
        open={apagarAlvo !== null}
        title="Apagar registro?"
        message={`Isso vai excluir definitivamente o monitoramento de ${apagarAlvo?.card_nome || "este cliente"} e qualquer informação sobre como a espera terminou. A mensagem enviada continuará no Histórico, mas esta ação não pode ser desfeita. Para apenas encerrar a espera, use “Finalizar espera”.`}
        loading={processando === apagarAlvo?.id}
        onConfirm={confirmarApagar}
        onCancel={() => setApagarAlvo(null)}
      />
      <ConfirmDialog
        open={confirmMassaAberto}
        title="Apagar registros selecionados?"
        message={`Isso vai apagar em definitivo ${selecionados.size} registro(s) selecionado(s), em todas as páginas. Essa ação não pode ser desfeita.`}
        confirmLabel="Apagar selecionados"
        loading={apagandoSelecionados}
        onConfirm={confirmarApagarSelecionados}
        onCancel={() => setConfirmMassaAberto(false)}
      />
      <Modal
        open={finalizarAlvo !== null}
        onClose={() => {
          if (processando !== finalizarAlvo?.id) {
            setFinalizarAlvo(null);
            setObservacaoFinalizacao("");
          }
        }}
        title="Finalizar espera sem resposta"
        description={`O atendimento de ${finalizarAlvo?.card_nome || "cliente"} deixará de aparecer como pendente. A observação ficará registrada nos detalhes do Histórico.`}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setFinalizarAlvo(null);
                setObservacaoFinalizacao("");
              }}
              disabled={processando === finalizarAlvo?.id}
            >
              Voltar
            </Button>
            <Button
              onClick={finalizarEspera}
              loading={processando === finalizarAlvo?.id}
              disabled={observacaoFinalizacao.trim().length < 3}
            >
              <NotebookPen className="h-4 w-4" /> Finalizar espera
            </Button>
          </>
        }
      >
        <div>
          <Label htmlFor="observacao-finalizacao">Observação obrigatória</Label>
          <Textarea
            id="observacao-finalizacao"
            autoFocus
            rows={5}
            maxLength={1000}
            value={observacaoFinalizacao}
            onChange={(e) => setObservacaoFinalizacao(e.target.value)}
            placeholder="Ex.: Cliente não respondeu às tentativas de contato e bloqueou o número."
          />
          <p className="mt-1.5 text-right text-xs text-zinc-400">{observacaoFinalizacao.length}/1000</p>
        </div>
      </Modal>
    </div>
  );
}

