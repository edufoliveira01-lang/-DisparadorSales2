import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageCircleQuestion,
  MessageSquareReply,
  RefreshCw,
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
import { Pagination } from "@/components/ui/Pagination";
import { SelectableCard } from "@/components/ui/SelectableCard";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const ITENS_POR_PAGINA = 20;

type Filtro = "todos" | "enviado" | "entregue" | "lido";

const FILTRO_OPTIONS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Todos os status" },
  { value: "enviado", label: "Enviado" },
  { value: "entregue", label: "Entregue" },
  { value: "lido", label: "Lido" },
];

function combinaFiltro(item: PendingReply, filtro: Filtro): boolean {
  switch (filtro) {
    case "todos":
      return true;
    case "enviado":
      return item.ack === 1;
    case "entregue":
      return item.ack === 2;
    case "lido":
      return item.ack !== null && item.ack >= 3;
  }
}

export function PendentesResposta() {
  const { show } = useToast();
  const [pendentes, setPendentes] = useState<PendingReply[] | null>(null);
  const [processando, setProcessando] = useState<number | null>(null);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [apagandoSelecionados, setApagandoSelecionados] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [paginaAguardando, setPaginaAguardando] = useState(0);
  const [apagarAlvo, setApagarAlvo] = useState<PendingReply | null>(null);
  const [confirmMassaAberto, setConfirmMassaAberto] = useState(false);
  const [expandido, setExpandido] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const data = await api.get<PendingReply[]>("/pending-replies");
    setPendentes(data);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useSocketEvent("pendingReply:resolved", () => {
    carregar();
  });

  useSocketEvent<PendingReply>("pendingReply:ack-update", (atualizado) => {
    setPendentes((prev) => (prev ? prev.map((p) => (p.id === atualizado.id ? atualizado : p)) : prev));
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
    setProcessando(item.id);
    try {
      await api.post(`/pending-replies/${item.id}/cobrar`);
      show(`Mensagem de cobrança enviada para ${item.card_nome || "cliente"}.`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem de cobrança.", "error");
    } finally {
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
      const todosMarcados = itens.length > 0 && itens.every((i) => prev.has(i.id));
      const next = new Set(prev);
      for (const item of itens) {
        if (todosMarcados) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  const aguardando = useMemo(
    () => pendentes?.filter((p) => p.status === "aguardando" && combinaFiltro(p, filtro)) ?? [],
    [pendentes, filtro]
  );

  const aguardandoPaginado = useMemo(
    () => aguardando.slice(paginaAguardando * ITENS_POR_PAGINA, (paginaAguardando + 1) * ITENS_POR_PAGINA),
    [aguardando, paginaAguardando]
  );

  useEffect(() => {
    setPaginaAguardando(0);
  }, [filtro]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(aguardando.length / ITENS_POR_PAGINA) - 1);
    if (paginaAguardando > ultimaPagina) setPaginaAguardando(ultimaPagina);
  }, [aguardando, paginaAguardando]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Pendentes de Resposta</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Clientes que já receberam a mensagem e aguardam resposta ou reação para o cartão ser movido automaticamente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className="w-full sm:w-44">
            {FILTRO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={carregar}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
      </div>

      {selecionados.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 dark:border-accent-900 dark:bg-accent-900/20">
          <p className="text-sm font-medium text-accent-800 dark:text-accent-300">
            {selecionados.size} registro(s) selecionado(s)
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>
              Limpar seleção
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}>
              <Trash2 className="h-3.5 w-3.5" /> Apagar selecionados
            </Button>
          </div>
        </div>
      )}

      {pendentes === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : pendentes.length === 0 ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Nenhum monitoramento ativo"
          description='Configure uma "lista de confirmação" em Configurações → Trello para que envios passem a aparecer aqui.'
        />
      ) : aguardando.length === 0 && filtro !== "todos" ? (
        <EmptyState
          icon={MessageSquareReply}
          title="Nenhum resultado para esse filtro"
          description="Tente outro status ou volte para “Todos os status”."
        />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Aguardando ({aguardando.length})</h2>
            {aguardando.length === 0 ? (
              <p className="text-sm text-zinc-400">
                {filtro === "todos" ? "Nenhum cliente aguardando resposta no momento." : "Nenhum resultado para esse filtro."}
              </p>
            ) : (
              <>
                {/* Mobile: apenas nome e telefone visíveis; demais detalhes e ações ficam atrás do expandir. */}
                <div className="space-y-3 md:hidden">
                  <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                    <Checkbox
                      checked={aguardandoPaginado.length > 0 && aguardandoPaginado.every((i) => selecionados.has(i.id))}
                      onChange={() => alternarSelecionarTodos(aguardandoPaginado)}
                    />
                    <span>Selecionar todos nesta página</span>
                  </div>
                  {aguardandoPaginado.map((item) => {
                    const aberto = expandido === item.id;
                    return (
                      <SelectableCard key={item.id} checked={selecionados.has(item.id)} onToggle={() => alternarSelecionado(item.id)}>
                        <button
                          className="flex w-full items-center justify-between gap-2 text-left"
                          onClick={() => setExpandido(aberto ? null : item.id)}
                        >
                          <span className="min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100">
                            {item.card_nome || "—"}
                          </span>
                          {aberto ? (
                            <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                          )}
                        </button>

                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                            {formatPhoneDisplay(item.telefone)}
                            <AckIndicator ack={item.ack} respondido={item.status === "respondido"} />
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Apagar (ex: cliente só reagiu e o sistema não detectou)"
                            onClick={() => setApagarAlvo(item)}
                            disabled={processando === item.id}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>

                        {aberto && (
                          <div className="space-y-2 border-t border-zinc-100 pt-2 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                            <div className="flex items-center gap-2">
                              <StatusBadge ack={item.ack} respostaStatus={item.status} />
                            </div>
                            <p>
                              <span className="text-zinc-400 dark:text-zinc-500">Enviado em: </span>
                              {new Date(item.created_at + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                            </p>
                            <div className="flex flex-wrap justify-end gap-1.5 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="whitespace-nowrap"
                                onClick={() => confirmar(item)}
                                loading={processando === item.id}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Perguntar se recebeu / cobrar resposta"
                                onClick={() => cobrar(item)}
                                disabled={processando === item.id}
                              >
                                <MessageCircleQuestion className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Cancelar monitoramento"
                                onClick={() => cancelar(item)}
                                disabled={processando === item.id}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </SelectableCard>
                    );
                  })}
                </div>

                {/* Desktop: tabela compacta de 6 colunas, "Enviado em" no accordion */}
                <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 md:block">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-center text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                      <tr>
                        <th className="w-10 px-5 py-3">
                          <Checkbox
                            checked={aguardandoPaginado.length > 0 && aguardandoPaginado.every((i) => selecionados.has(i.id))}
                            onChange={() => alternarSelecionarTodos(aguardandoPaginado)}
                          />
                        </th>
                        <th className="px-5 py-3">Cliente</th>
                        <th className="px-5 py-3">Telefone</th>
                        <th className="px-5 py-3">Entrega</th>
                        <th className="w-16 px-5 py-3">Status</th>
                        <th className="px-5 py-3">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {aguardandoPaginado.map((item) => {
                        const aberto = expandido === item.id;
                        return (
                          <Fragment key={item.id}>
                            <tr className="bg-white dark:bg-zinc-900">
                              <td className="px-5 py-3 text-center">
                                <Checkbox checked={selecionados.has(item.id)} onChange={() => alternarSelecionado(item.id)} />
                              </td>
                              <td className="max-w-[220px] truncate px-5 py-3 text-left font-medium text-zinc-900 dark:text-zinc-100">
                                {item.card_nome || "—"}
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-center text-zinc-600 dark:text-zinc-400">
                                {formatPhoneDisplay(item.telefone)}
                              </td>
                              <td className="px-5 py-3 text-center">
                                <AckIndicator ack={item.ack} respondido={item.status === "respondido"} />
                              </td>
                              <td className="px-5 py-3 text-center">
                                <StatusBadge ack={item.ack} respostaStatus={item.status} />
                              </td>
                              <td className="px-5 py-3">
                                <div className="flex justify-center gap-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Ver detalhes"
                                    onClick={() => setExpandido(aberto ? null : item.id)}
                                  >
                                    {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="whitespace-nowrap"
                                    onClick={() => confirmar(item)}
                                    loading={processando === item.id}
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Perguntar se recebeu / cobrar resposta"
                                    onClick={() => cobrar(item)}
                                    disabled={processando === item.id}
                                  >
                                    <MessageCircleQuestion className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Cancelar monitoramento"
                                    onClick={() => cancelar(item)}
                                    disabled={processando === item.id}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Apagar (ex: cliente só reagiu e o sistema não detectou)"
                                    onClick={() => setApagarAlvo(item)}
                                    disabled={processando === item.id}
                                  >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {aberto && (
                              <tr className="bg-zinc-50 dark:bg-zinc-800/30">
                                <td colSpan={6} className="px-5 py-4">
                                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                    <span className="text-zinc-400 dark:text-zinc-500">Enviado em: </span>
                                    {new Date(item.created_at + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                                  </p>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={paginaAguardando}
                  totalItems={aguardando.length}
                  pageSize={ITENS_POR_PAGINA}
                  onPageChange={setPaginaAguardando}
                />
              </>
            )}
          </section>
        </>
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
