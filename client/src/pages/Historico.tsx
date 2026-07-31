import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, History as HistoryIcon, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { SendLog, Template } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { AckIndicator } from "@/components/AckIndicator";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const ITENS_POR_PAGINA = 20;

export function Historico() {
  const { show } = useToast();
  const [logs, setLogs] = useState<SendLog[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [reenviando, setReenviando] = useState<number | null>(null);
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [apagando, setApagando] = useState<number | null>(null);
  const [apagandoSelecionados, setApagandoSelecionados] = useState(false);

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

  useSocketEvent<SendLog>("send:ack-update", (atualizado) => {
    setLogs((prev) => (prev ? prev.map((l) => (l.id === atualizado.id ? atualizado : l)) : prev));
  });

  const logsPaginados = useMemo(
    () => (logs ?? []).slice(pagina * ITENS_POR_PAGINA, (pagina + 1) * ITENS_POR_PAGINA),
    [logs, pagina]
  );

  useEffect(() => {
    if (!logs) return;
    const ultimaPagina = Math.max(0, Math.ceil(logs.length / ITENS_POR_PAGINA) - 1);
    if (pagina > ultimaPagina) setPagina(ultimaPagina);
  }, [logs, pagina]);

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

  async function apagar(log: SendLog) {
    setApagando(log.id);
    try {
      await api.delete(`/logs/${log.id}`);
      show("Registro apagado.", "info");
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(log.id);
        return next;
      });
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao apagar registro.", "error");
    } finally {
      setApagando(null);
    }
  }

  async function apagarSelecionados() {
    if (selecionados.size === 0) return;
    setApagandoSelecionados(true);
    try {
      const ids = Array.from(selecionados);
      await api.post("/logs/apagar-em-massa", { ids });
      show(`${ids.length} registro(s) apagado(s).`, "success");
      setSelecionados(new Set());
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao apagar registros selecionados.", "error");
    } finally {
      setApagandoSelecionados(false);
    }
  }

  function alternarSelecionado(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alternarSelecionarTodos() {
    setSelecionados((prev) => {
      const todosMarcados = logsPaginados.length > 0 && logsPaginados.every((l) => prev.has(l.id));
      const next = new Set(prev);
      for (const log of logsPaginados) {
        if (todosMarcados) next.delete(log.id);
        else next.add(log.id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Histórico</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Registro de todas as mensagens enviadas.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-52">
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
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
            <Button variant="danger" size="sm" onClick={apagarSelecionados} loading={apagandoSelecionados}>
              <Trash2 className="h-3.5 w-3.5" /> Apagar selecionados
            </Button>
          </div>
        </div>
      )}

      {logs === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nenhum envio registrado ainda" description="Os envios feitos pelo Dashboard aparecerão aqui." />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="w-10 px-5 py-3">
                    <Checkbox
                      checked={logsPaginados.length > 0 && logsPaginados.every((l) => selecionados.has(l.id))}
                      onChange={alternarSelecionarTodos}
                    />
                  </th>
                  <th className="px-5 py-3">Data/hora</th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Entrega</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {logsPaginados.map((log) => (
                  <Fragment key={log.id}>
                    <tr className="bg-white dark:bg-zinc-900">
                      <td className="px-5 py-3">
                        <Checkbox checked={selecionados.has(log.id)} onChange={() => alternarSelecionado(log.id)} />
                      </td>
                      <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">
                        {new Date(log.created_at + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                      </td>
                      <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{log.card_nome || "—"}</td>
                      <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{log.telefone || "—"}</td>
                      <td className="px-5 py-3">
                        {log.status === "sucesso" ? <Badge tone="success">Enviado</Badge> : <Badge tone="danger">Falhou</Badge>}
                        {log.erro && log.status === "falha" && <p className="mt-1 text-xs text-red-500">{log.erro}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <AckIndicator ack={log.ack} />
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
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Apagar"
                            onClick={() => apagar(log)}
                            disabled={apagando === log.id}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expandido === log.id && log.mensagem_enviada && (
                      <tr className="bg-zinc-50 dark:bg-zinc-800/30">
                        <td colSpan={7} className="px-5 py-4">
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
          <Pagination page={pagina} totalItems={logs.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPagina} />
        </>
      )}
    </div>
  );
}
