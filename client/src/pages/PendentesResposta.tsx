import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  MessageCircleQuestion,
  MessageSquareReply,
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
import { AckIndicator } from "@/components/AckIndicator";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { SelectableCard } from "@/components/ui/SelectableCard";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

const ITENS_POR_PAGINA = 20;

type Filtro = "todos" | "enviado" | "entregue" | "lido";
type Ordenacao = "recentes" | "antigos" | "az" | "za";

const FILTRO_OPTIONS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Todos os envios" },
  { value: "enviado", label: "Somente enviados" },
  { value: "entregue", label: "Somente entregues" },
  { value: "lido", label: "Somente lidas" },
];

const ORDENACAO_OPTIONS: { value: Ordenacao; label: string }[] = [
  { value: "recentes", label: "Mais recentes" },
  { value: "antigos", label: "Mais antigos" },
  { value: "az", label: "Nome (A-Z)" },
  { value: "za", label: "Nome (Z-A)" },
];

function combinaFiltro(item: PendingReply, filtro: Filtro): boolean {
  if (filtro === "todos") return true;
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
  const [expandido, setExpandido] = useState<number | null>(null);
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("recentes");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [mostrarPeriodo, setMostrarPeriodo] = useState(false);

  const carregar = useCallback(async () => {
    setPendentes(await api.get<PendingReply[]>("/pending-replies"));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useSocketEvent("pendingReply:resolved", carregar);
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

  async function cancelar(item: PendingReply) {
    setProcessando(item.id);
    try {
      await api.post(`/pending-replies/${item.id}/cancelar`);
      show("Monitoramento cancelado.", "info");
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao cancelar monitoramento.", "error");
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
      entregues: ativos.filter((item) => item.ack !== null && item.ack >= 2).length,
      lidos: ativos.filter((item) => item.ack !== null && item.ack >= 3).length,
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

  return (
    <div className="space-y-5 md:space-y-6">
      <PageHeader
        title="Pendentes de Resposta"
        description="Acompanhe quem recebeu a mensagem, cobre um retorno ou conclua o atendimento manualmente."
        actions={<Button variant="outline" onClick={carregar}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>}
      />

      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <StatCard icon={<Clock3 />} label="Aguardando" value={resumo.total} tone="accent" />
        <StatCard icon={<CheckCheck />} label="Entregues" value={resumo.entregues} tone="warning" />
        <StatCard icon={<Eye />} label="Lidas" value={resumo.lidos} tone="info" />
      </div>

      <section className="surface-panel p-3 md:p-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(280px,1fr)_190px_190px_auto]">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input placeholder="Buscar nome ou telefone…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className="w-full">
            {FILTRO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)} className="w-full">
            {ORDENACAO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Button
            variant={periodoAtivo ? "secondary" : "outline"}
            className="col-span-2 lg:col-span-1"
            onClick={() => setMostrarPeriodo((valor) => !valor)}
          >
            <SlidersHorizontal className="h-4 w-4" /> {periodoAtivo ? "Período aplicado" : "Filtrar período"}
          </Button>
        </div>

        {(mostrarPeriodo || periodoAtivo) && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:flex sm:items-end">
            <div className="min-w-0 sm:w-44">
              <Label className="text-xs">Enviados de</Label>
              <Input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} className="w-full" />
            </div>
            <div className="min-w-0 sm:w-44">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} className="w-full" />
            </div>
            {periodoAtivo && (
              <Button variant="ghost" size="sm" className="col-span-2" onClick={() => { setDataDe(""); setDataAte(""); }}>
                <X className="h-3.5 w-3.5" /> Limpar período
              </Button>
            )}
          </div>
        )}

        <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <CalendarDays className="h-3.5 w-3.5" /> {aguardando.length} de {resumo.total} atendimento(s) exibido(s)
        </p>
      </section>

      {selecionados.size > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 dark:border-accent-900 dark:bg-accent-900/20 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-accent-800 dark:text-accent-300">{selecionados.size} registro(s) selecionado(s)</p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
            <Button variant="outline" className="danger-action" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}>
              <Trash2 className="h-3.5 w-3.5 text-red-500 dark:text-red-400" /> Apagar selecionados
            </Button>
          </div>
        </div>
      )}

      {pendentes === null ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}</div>
      ) : resumo.total === 0 ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Nenhum monitoramento ativo"
          description='Configure uma "lista de confirmação" em Configurações > Trello para acompanhar as respostas após o envio.'
        />
      ) : aguardando.length === 0 ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Nenhum resultado para esses filtros"
          description="Tente ajustar a busca, o status de entrega ou o período selecionado."
        />
      ) : (
        <section className="space-y-3">
          <div>
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Clientes aguardando retorno</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Abra um contato para ver as ações disponíveis.</p>
          </div>

          <div className="flex items-center gap-2 px-1 text-sm text-zinc-500 dark:text-zinc-400">
            <Checkbox
              checked={aguardandoPaginado.length > 0 && aguardandoPaginado.every((item) => selecionados.has(item.id))}
              onChange={() => alternarSelecionarTodos(aguardandoPaginado)}
            />
            <span>Selecionar todos nesta página</span>
          </div>

          <div className="space-y-3 md:hidden">
            {aguardandoPaginado.map((item) => {
              const aberto = expandido === item.id;
              return (
                <SelectableCard key={item.id} checked={selecionados.has(item.id)} onToggle={() => alternarSelecionado(item.id)}>
                  <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setExpandido(aberto ? null : item.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{item.card_nome || "Sem nome"}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                        <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {formatPhoneDisplay(item.telefone)}</span>
                        <AckIndicator ack={item.ack} />
                      </span>
                    </span>
                    {aberto ? <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />}
                  </button>

                  {aberto && (
                    <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <StatusBadge ack={item.ack} respostaStatus={item.status} />
                        <span className="text-xs text-zinc-400">Enviado em {formatarData(item)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button className="col-span-2" size="sm" onClick={() => confirmar(item)} loading={processando === item.id && cobrando !== item.id} disabled={processando !== null}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar recebimento
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => cobrar(item)} loading={cobrando === item.id} disabled={processando !== null}>
                          <MessageCircleQuestion className="h-3.5 w-3.5" /> {cobrando === item.id ? "Confirmando envio…" : "Cobrar resposta"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => cancelar(item)} disabled={processando === item.id}>
                          <X className="h-3.5 w-3.5" /> Cancelar
                        </Button>
                        <Button variant="ghost" size="sm" className="col-span-2 text-red-600 dark:text-red-400" onClick={() => setApagarAlvo(item)} disabled={processando === item.id}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500 dark:text-red-400" /> Apagar registro
                        </Button>
                      </div>
                    </div>
                  )}
                </SelectableCard>
              );
            })}
          </div>

          <div className="hidden gap-3 md:grid xl:grid-cols-2">
            {aguardandoPaginado.map((item) => (
              <article key={item.id} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-soft dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-start gap-3">
                  <Checkbox checked={selecionados.has(item.id)} onChange={() => alternarSelecionado(item.id)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{item.card_nome || "Sem nome"}</h3>
                      <StatusBadge ack={item.ack} respostaStatus={item.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {formatPhoneDisplay(item.telefone)}</span>
                      <AckIndicator ack={item.ack} />
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">Enviado em {formatarData(item)}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <Button size="sm" onClick={() => confirmar(item)} loading={processando === item.id && cobrando !== item.id} disabled={processando !== null}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => cobrar(item)} loading={cobrando === item.id} disabled={processando !== null}>
                    <MessageCircleQuestion className="h-3.5 w-3.5" /> {cobrando === item.id ? "Confirmando envio…" : "Cobrar resposta"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => cancelar(item)} disabled={processando === item.id}>
                    <X className="h-3.5 w-3.5" /> Cancelar
                  </Button>
                  <Button variant="ghost" size="icon" className="ml-auto" title="Apagar registro" onClick={() => setApagarAlvo(item)} disabled={processando === item.id}>
                    <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <Pagination page={paginaAguardando} totalItems={aguardando.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPaginaAguardando} />
        </section>
      )}

      <ConfirmDialog
        open={apagarAlvo !== null}
        title="Apagar registro?"
        message={`Isso vai apagar em definitivo o registro de ${apagarAlvo?.card_nome || "este cliente"}. Essa ação não pode ser desfeita.`}
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
    </div>
  );
}
