import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, MessageSquareReply, RefreshCw, SmilePlus, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/phone";
import type { PendingReply } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { AckIndicator } from "@/components/AckIndicator";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const ITENS_POR_PAGINA = 20;

const STATUS_BADGE: Record<PendingReply["status"], { label: string; tone: "warning" | "success" | "neutral" }> = {
  aguardando: { label: "Aguardando resposta", tone: "warning" },
  respondido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Substituído por novo envio", tone: "neutral" },
};

type Filtro = "todos" | "enviado" | "entregue" | "lido" | "respondido";

const FILTRO_OPTIONS: { value: Filtro; label: string }[] = [
  { value: "todos", label: "Todos os status" },
  { value: "enviado", label: "Enviado" },
  { value: "entregue", label: "Entregue" },
  { value: "lido", label: "Lido" },
  { value: "respondido", label: "Respondido" },
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
    case "respondido":
      return item.status === "respondido";
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
  const [paginaResolvidos, setPaginaResolvidos] = useState(0);
  const [apagarAlvo, setApagarAlvo] = useState<PendingReply | null>(null);
  const [confirmMassaAberto, setConfirmMassaAberto] = useState(false);

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
  const resolvidos = useMemo(
    () => pendentes?.filter((p) => p.status !== "aguardando" && combinaFiltro(p, filtro)) ?? [],
    [pendentes, filtro]
  );

  const aguardandoPaginado = useMemo(
    () => aguardando.slice(paginaAguardando * ITENS_POR_PAGINA, (paginaAguardando + 1) * ITENS_POR_PAGINA),
    [aguardando, paginaAguardando]
  );
  const resolvidosPaginado = useMemo(
    () => resolvidos.slice(paginaResolvidos * ITENS_POR_PAGINA, (paginaResolvidos + 1) * ITENS_POR_PAGINA),
    [resolvidos, paginaResolvidos]
  );

  useEffect(() => {
    setPaginaAguardando(0);
    setPaginaResolvidos(0);
  }, [filtro]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(aguardando.length / ITENS_POR_PAGINA) - 1);
    if (paginaAguardando > ultimaPagina) setPaginaAguardando(ultimaPagina);
  }, [aguardando, paginaAguardando]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(resolvidos.length / ITENS_POR_PAGINA) - 1);
    if (paginaResolvidos > ultimaPagina) setPaginaResolvidos(ultimaPagina);
  }, [resolvidos, paginaResolvidos]);

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
      ) : aguardando.length === 0 && resolvidos.length === 0 && filtro !== "todos" ? (
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
                <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                  <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm">
                    <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                      <tr>
                        <th className="w-10 px-5 py-3">
                          <Checkbox
                            checked={aguardandoPaginado.length > 0 && aguardandoPaginado.every((i) => selecionados.has(i.id))}
                            onChange={() => alternarSelecionarTodos(aguardandoPaginado)}
                          />
                        </th>
                        <th className="whitespace-nowrap px-5 py-3">Enviado em</th>
                        <th className="whitespace-nowrap px-5 py-3">Cliente</th>
                        <th className="whitespace-nowrap px-5 py-3">Telefone</th>
                        <th className="whitespace-nowrap px-5 py-3">Entrega</th>
                        <th className="whitespace-nowrap px-5 py-3">Status</th>
                        <th className="whitespace-nowrap px-5 py-3 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {aguardandoPaginado.map((item) => (
                        <tr key={item.id} className="bg-white dark:bg-zinc-900">
                          <td className="px-5 py-3">
                            <Checkbox checked={selecionados.has(item.id)} onChange={() => alternarSelecionado(item.id)} />
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 text-zinc-500 dark:text-zinc-400">
                            {new Date(item.created_at + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                          </td>
                          <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{item.card_nome || "—"}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-zinc-600 dark:text-zinc-400">{formatPhoneDisplay(item.telefone)}</td>
                          <td className="px-5 py-3">
                            <AckIndicator ack={item.ack} />
                          </td>
                          <td className="px-5 py-3">
                            <Badge tone={STATUS_BADGE[item.status].tone}>{STATUS_BADGE[item.status].label}</Badge>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                className="whitespace-nowrap"
                                onClick={() => confirmar(item)}
                                loading={processando === item.id}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar manualmente
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
                      ))}
                    </tbody>
                  </table>
                  </div>
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

          {resolvidos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Histórico recente</h2>
              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                    <tr>
                      <th className="w-10 px-5 py-3">
                        <Checkbox
                          checked={resolvidosPaginado.length > 0 && resolvidosPaginado.every((i) => selecionados.has(i.id))}
                          onChange={() => alternarSelecionarTodos(resolvidosPaginado)}
                        />
                      </th>
                      <th className="whitespace-nowrap px-5 py-3">Resolvido em</th>
                      <th className="whitespace-nowrap px-5 py-3">Cliente</th>
                      <th className="whitespace-nowrap px-5 py-3">Telefone</th>
                      <th className="whitespace-nowrap px-5 py-3">Entrega</th>
                      <th className="whitespace-nowrap px-5 py-3">Como respondeu</th>
                      <th className="whitespace-nowrap px-5 py-3">Status</th>
                      <th className="whitespace-nowrap px-5 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {resolvidosPaginado.map((item) => (
                      <tr key={item.id} className="bg-white dark:bg-zinc-900">
                        <td className="px-5 py-3">
                          <Checkbox checked={selecionados.has(item.id)} onChange={() => alternarSelecionado(item.id)} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-zinc-500 dark:text-zinc-400">
                          {item.resolved_at ? new Date(item.resolved_at + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{item.card_nome || "—"}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-zinc-600 dark:text-zinc-400">{formatPhoneDisplay(item.telefone)}</td>
                        <td className="px-5 py-3">
                          <AckIndicator ack={item.ack} />
                        </td>
                        <td className="max-w-[220px] truncate px-5 py-3 text-zinc-600 dark:text-zinc-400">
                          {item.tipo_resposta === "reacao" ? (
                            <span className="inline-flex items-center gap-1">
                              <SmilePlus className="h-3.5 w-3.5" /> Reação {item.resposta_preview}
                            </span>
                          ) : item.tipo_resposta === "mensagem" ? (
                            <span className="inline-flex items-center gap-1 truncate">
                              <MessageSquareReply className="h-3.5 w-3.5" /> {item.resposta_preview || "Mensagem"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <Badge tone={STATUS_BADGE[item.status].tone}>{STATUS_BADGE[item.status].label}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Apagar"
                              onClick={() => setApagarAlvo(item)}
                              disabled={processando === item.id}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
              <Pagination
                page={paginaResolvidos}
                totalItems={resolvidos.length}
                pageSize={ITENS_POR_PAGINA}
                onPageChange={setPaginaResolvidos}
              />
            </section>
          )}
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
