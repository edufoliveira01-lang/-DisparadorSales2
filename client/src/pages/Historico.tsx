import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History as HistoryIcon, RefreshCw, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { SendLog, Template } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

export function Historico() {
  const { show } = useToast();
  const [logs, setLogs] = useState<SendLog[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [reenviando, setReenviando] = useState<number | null>(null);

  async function carregar() {
    const data = await api.get<SendLog[]>("/logs");
    setLogs(data);
  }

  useEffect(() => {
    carregar();
    api.get<Template[]>("/templates").then((data) => {
      setTemplates(data);
      if (data.length > 0) setTemplateId(data[0].id);
    });
  }, []);

  async function reenviar(log: SendLog) {
    if (!templateId) {
      show("Selecione um template para reenviar.", "error");
      return;
    }
    setReenviando(log.id);
    try {
      await api.post(`/logs/${log.id}/reenviar`, { templateId });
      show(`Mensagem reenviada para ${log.card_nome}.`, "success");
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao reenviar mensagem.", "error");
    } finally {
      setReenviando(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Histórico</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Registro de todas as mensagens enviadas.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-full sm:w-52">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={carregar} className="w-full sm:w-auto">
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </div>
      </div>

      {logs === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nenhum envio registrado ainda" description="Os envios feitos pelo Dashboard aparecerão aqui." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-1">
          {/* Versão Desktop (Tabela) */}
          <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 md:block">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="px-5 py-3">Data/hora</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <tr className="bg-white dark:bg-zinc-900">
                      <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">
                        {new Date(log.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{log.card_nome || "—"}</td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{log.telefone || "—"}</td>
                      <td className="px-5 py-3">
                        {log.status === "sucesso" ? <Badge tone="success">Enviado</Badge> : <Badge tone="danger">Falhou</Badge>}
                        {log.erro && log.status === "falha" && <p className="mt-1 text-xs text-red-500">{log.erro}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setExpandido(expandido === log.id ? null : log.id)}
                            disabled={!log.mensagem_enviada}
                          >
                            {expandido === log.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                          {log.status === "falha" && (
                            <Button variant="outline" size="sm" onClick={() => reenviar(log)} loading={reenviando === log.id}>
                              <RotateCcw className="h-3.5 w-3.5" /> Reenviar
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandido === log.id && log.mensagem_enviada && (
                      <tr className="bg-zinc-50 dark:bg-zinc-800/30">
                        <td colSpan={5} className="px-5 py-4">
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Mensagem enviada</p>
                          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{log.mensagem_enviada}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Versão Mobile (Cards) */}
          <div className="space-y-3 md:hidden">
            {logs.map((log) => (
              <div key={log.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{log.card_nome || "—"}</p>
                      {log.status === "sucesso" ? <Badge tone="success" size="sm">Ok</Badge> : <Badge tone="danger" size="sm">Erro</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(log.created_at).toLocaleString("pt-BR")} · {log.telefone}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setExpandido(expandido === log.id ? null : log.id)}
                      disabled={!log.mensagem_enviada}
                    >
                      {expandido === log.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                {expandido === log.id && log.mensagem_enviada && (
                  <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <p className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">{log.mensagem_enviada}</p>
                  </div>
                )}
                {log.status === "falha" && (
                  <Button variant="outline" size="sm" onClick={() => reenviar(log)} loading={reenviando === log.id} className="mt-3 w-full">
                    <RotateCcw className="h-3.5 w-3.5" /> Reenviar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
