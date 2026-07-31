import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MessageSquareReply, RefreshCw, SmilePlus, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { PendingReply } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const STATUS_BADGE: Record<PendingReply["status"], { label: string; tone: "warning" | "success" | "neutral" }> = {
  aguardando: { label: "Aguardando resposta", tone: "warning" },
  respondido: { label: "Concluído", tone: "success" },
  cancelado: { label: "Substituído por novo envio", tone: "neutral" },
};

export function PendentesResposta() {
  const { show } = useToast();
  const [pendentes, setPendentes] = useState<PendingReply[] | null>(null);
  const [processando, setProcessando] = useState<number | null>(null);

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

  const aguardando = pendentes?.filter((p) => p.status === "aguardando") ?? [];
  const resolvidos = pendentes?.filter((p) => p.status !== "aguardando") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Pendentes de Resposta</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Clientes que já receberam a mensagem e aguardam resposta ou reação para o cartão ser movido automaticamente.
          </p>
        </div>
        <Button variant="outline" onClick={carregar}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </div>

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
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Aguardando ({aguardando.length})</h2>
            {aguardando.length === 0 ? (
              <p className="text-sm text-zinc-400">Nenhum cliente aguardando resposta no momento.</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                    <tr>
                      <th className="px-5 py-3">Enviado em</th>
                      <th className="px-5 py-3">Cliente</th>
                      <th className="px-5 py-3">Telefone</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {aguardando.map((item) => (
                      <tr key={item.id} className="bg-white dark:bg-zinc-900">
                        <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">
                          {new Date(item.created_at).toLocaleString("pt-BR")}
                        </td>
                        <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{item.card_nome || "—"}</td>
                        <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{item.telefone}</td>
                        <td className="px-5 py-3">
                          <Badge tone={STATUS_BADGE[item.status].tone}>{STATUS_BADGE[item.status].label}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => confirmar(item)}
                              loading={processando === item.id}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar manualmente
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => cancelar(item)} disabled={processando === item.id}>
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {resolvidos.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Histórico recente</h2>
              <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                    <tr>
                      <th className="px-5 py-3">Resolvido em</th>
                      <th className="px-5 py-3">Cliente</th>
                      <th className="px-5 py-3">Telefone</th>
                      <th className="px-5 py-3">Como respondeu</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {resolvidos.map((item) => (
                      <tr key={item.id} className="bg-white dark:bg-zinc-900">
                        <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">
                          {item.resolved_at ? new Date(item.resolved_at).toLocaleString("pt-BR") : "—"}
                        </td>
                        <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{item.card_nome || "—"}</td>
                        <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{item.telefone}</td>
                        <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
