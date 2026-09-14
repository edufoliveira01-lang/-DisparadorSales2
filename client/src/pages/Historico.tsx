import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  BriefcaseBusiness,
  Calendar,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  History as HistoryIcon,
  Eye,
  MapPin,
  MessageSquareReply,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { classificarEvento, type CategoriaEvento } from "@/lib/eventVisual";
import type { Pericia, SendLog, Template } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { AckIndicator } from "@/components/AckIndicator";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
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

type Ordenacao = "recentes" | "antigos" | "az" | "za";

const ORDENACAO_OPTIONS: { value: Ordenacao; label: string }[] = [
  { value: "recentes", label: "Mais recentes primeiro" },
  { value: "antigos", label: "Mais antigos primeiro" },
  { value: "az", label: "Nome (A-Z)" },
  { value: "za", label: "Nome (Z-A)" },
];

const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Data local (America/Sao_Paulo) no formato YYYY-MM-DD, para comparar com o valor de um <input type="date">. */
function dataLocalYMD(createdAtUtc: string): string {
  return new Date(createdAtUtc + "Z").toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** Primeira letra do nome, maiúscula e sem acento, para comparar com o filtro alfabético. */
function inicialSemAcento(nome: string): string {
  return (nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .charAt(0)
    .toUpperCase();
}

function formatarDataHora(data?: string | null): string | null {
  if (!data) return null;
  return new Date(data + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function temRespostaRecebida(log: SendLog): boolean {
  return log.resposta_status === "respondido" || Boolean(log.resposta_preview || log.resposta_resolved_at);
}

function RespostaRecebida({ log, integrada = false }: { log: SendLog; integrada?: boolean }) {
  const respondidoEm = formatarDataHora(log.resposta_resolved_at);
  if (!temRespostaRecebida(log)) return null;

  const reacao = log.resposta_tipo === "reacao";
  const IconeResposta = reacao ? SmilePlus : MessageSquareReply;
  const conteudo = log.resposta_preview || (reacao ? "Reação recebida" : "Mensagem recebida");

  return (
    <div
      className={cn(
        "rounded-xl border border-accent-200 p-3.5 dark:border-accent-900/70",
        integrada
          ? "bg-accent-50/60 dark:bg-accent-900/15"
          : "bg-white shadow-sm dark:bg-zinc-900/70"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">
          Mensagem recebida
        </p>
        <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
          {reacao ? "Reação" : "Mensagem"}
        </span>
      </div>
      <div className="mt-2.5 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <IconeResposta className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
        <p className="min-w-0 whitespace-pre-wrap break-words font-medium">{conteudo}</p>
      </div>
      {respondidoEm && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Recebida em {respondidoEm}</p>
      )}
    </div>
  );
}

function periciasDoLog(log: SendLog): Pericia[] {
  if (!log.pericias_json) return [];
  try {
    const pericias = JSON.parse(log.pericias_json);
    return Array.isArray(pericias) ? pericias : [];
  } catch {
    return [];
  }
}

function toneEventoHistorico(categoria: CategoriaEvento): "neutral" | "accent" | "violet" | "info" | "cyan" | "indigo" {
  if (categoria === "pericia_social") return "violet";
  if (categoria === "audiencia_presencial") return "info";
  if (categoria === "audiencia_online") return "cyan";
  if (categoria === "audiencia_hibrida") return "indigo";
  if (categoria === "tipo_nao_identificado" || categoria === "outro") return "neutral";
  return "accent";
}

function classesEventoHistorico(categoria: CategoriaEvento): string {
  if (categoria === "pericia_social") return "border-l-violet-500 bg-violet-50/20 dark:border-l-violet-400 dark:bg-violet-950/10";
  if (categoria === "audiencia_presencial") return "border-l-blue-500 bg-blue-50/20 dark:border-l-blue-400 dark:bg-blue-950/10";
  if (categoria === "audiencia_online") return "border-l-cyan-500 bg-cyan-50/20 dark:border-l-cyan-400 dark:bg-cyan-950/10";
  if (categoria === "audiencia_hibrida") return "border-l-indigo-500 bg-indigo-50/20 dark:border-l-indigo-400 dark:bg-indigo-950/10";
  if (categoria === "tipo_nao_identificado" || categoria === "outro") return "border-l-zinc-300 bg-zinc-50/30 dark:border-l-zinc-700 dark:bg-zinc-800/20";
  return "border-l-accent-500 bg-accent-50/20 dark:border-l-accent-400 dark:bg-accent-900/10";
}

function PainelAgendamento({ log }: { log: SendLog }) {
  const pericias = periciasDoLog(log);
  if (pericias.length === 0) return null;

  return (
    <section className="h-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300">
          <Calendar className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Dados do agendamento</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pericias.length} {pericias.length === 1 ? "compromisso registrado" : "compromissos registrados"}
          </p>
        </div>
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {pericias.map((pericia, index) => {
          const tipo = classificarEvento(pericia);
          return (
            <div key={index} className={cn("border-l-4 p-4", classesEventoHistorico(tipo.categoria))}>
              <Badge tone={toneEventoHistorico(tipo.categoria)}>{tipo.rotulo}</Badge>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span>{pericia.data || "Data não informada"}</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                  <Clock className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                  <span>{pericia.horario || "Horário não informado"}</span>
                </div>
              </div>
              <div className="mt-3 space-y-2 text-xs text-zinc-500 dark:text-zinc-400">
                {pericia.local && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{pericia.local}</span></p>}
                {pericia.processo && <p className="flex items-start gap-2"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-all">{pericia.processo}</span></p>}
                {pericia.profissionalPerito && <p className="flex items-start gap-2"><BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{pericia.profissionalPerito}</span></p>}
                {pericia.telefone && <p className="flex items-start gap-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{formatPhoneDisplay(pericia.telefone)}</span></p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PainelComunicacao({ log }: { log: SendLog }) {
  const temMensagem = Boolean(log.mensagem_enviada);
  const temResposta = temRespostaRecebida(log);
  if (!temMensagem && !temResposta) return null;

  return (
    <section className="h-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
          <MessageSquareReply className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Comunicação com o cliente</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {temResposta ? "Resposta recebida" : "Mensagem enviada, aguardando resposta"}
          </p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <RespostaRecebida log={log} integrada />
        {log.mensagem_enviada && (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-800/30">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
              <Send className="h-3.5 w-3.5 text-zinc-400" />
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Mensagem enviada</p>
            </div>
            <div className="max-h-56 overflow-y-auto px-3 py-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{log.mensagem_enviada}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

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
  const [apagarAlvo, setApagarAlvo] = useState<SendLog | null>(null);
  const [confirmMassaAberto, setConfirmMassaAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("recentes");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [letra, setLetra] = useState<string | null>(null);
  const [mostrarPeriodo, setMostrarPeriodo] = useState(false);

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

  // O evento de ack não cobre o desfecho do monitoramento de resposta (cliente respondeu,
  // confirmação manual, cancelamento) — esses vêm de pending_replies, uma tabela separada.
  // Como não sabemos aqui qual log corresponde ao pending resolvido, recarregamos a lista
  // inteira para refletir o novo status/"Concluído" assim que ele acontece.
  useSocketEvent("pendingReply:resolved", () => {
    carregar();
  });

  const logsFiltrados = useMemo(() => {
    if (!logs) return [];
    const termo = busca.trim().toLowerCase();
    const termoDigits = termo.replace(/\D/g, "");
    const filtrados = logs.filter((log) => {
      if (termo) {
        const nomeMatch = (log.card_nome || "").toLowerCase().includes(termo);
        const telefoneMatch = termoDigits.length > 0 && (log.telefone || "").replace(/\D/g, "").includes(termoDigits);
        const mensagemMatch = (log.mensagem_enviada || "").toLowerCase().includes(termo);
        const dadosMatch = periciasDoLog(log).some(
          (pericia) =>
            (pericia.processo || "").toLowerCase().includes(termo) ||
            (pericia.profissionalPerito || "").toLowerCase().includes(termo)
        );
        if (!nomeMatch && !telefoneMatch && !mensagemMatch && !dadosMatch) return false;
      }
      if (dataDe || dataAte) {
        const dataLog = dataLocalYMD(log.created_at);
        if (dataDe && dataLog < dataDe) return false;
        if (dataAte && dataLog > dataAte) return false;
      }
      if (letra && inicialSemAcento(log.card_nome || "") !== letra) return false;
      return true;
    });
    return [...filtrados].sort((a, b) => {
      switch (ordenacao) {
        case "recentes":
          return b.created_at.localeCompare(a.created_at);
        case "antigos":
          return a.created_at.localeCompare(b.created_at);
        case "az":
          return (a.card_nome || "").localeCompare(b.card_nome || "", "pt-BR");
        case "za":
          return (b.card_nome || "").localeCompare(a.card_nome || "", "pt-BR");
      }
    });
  }, [logs, busca, dataDe, dataAte, letra, ordenacao]);

  const logsPaginados = useMemo(
    () => logsFiltrados.slice(pagina * ITENS_POR_PAGINA, (pagina + 1) * ITENS_POR_PAGINA),
    [logsFiltrados, pagina]
  );

  const resumo = useMemo(() => {
    const lista = logs ?? [];
    return {
      envios: lista.length,
      entregues: lista.filter((log) => log.ack !== null && log.ack >= 2).length,
      respondidos: lista.filter(temRespostaRecebida).length,
    };
  }, [logs]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(logsFiltrados.length / ITENS_POR_PAGINA) - 1);
    if (pagina > ultimaPagina) setPagina(ultimaPagina);
  }, [logsFiltrados, pagina]);

  useEffect(() => {
    setPagina(0);
  }, [busca, dataDe, dataAte, letra, ordenacao]);

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

  function formatarData(log: SendLog): string {
    return new Date(log.created_at + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  }

  const periodoAtivo = Boolean(dataDe || dataAte);

  return (
    <div className="space-y-5 md:space-y-6">
      <PageHeader
        title="Histórico"
        description="Consulte mensagens enviadas, dados utilizados, confirmações de entrega e respostas dos clientes."
        actions={<Button variant="outline" onClick={carregar}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>}
      />

      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <StatCard icon={<Send />} label="Envios" value={resumo.envios} tone="accent" />
        <StatCard icon={<CheckCheck />} label="Entregues" value={resumo.entregues} tone="warning" />
        <StatCard icon={<Eye />} label="Respondidas" value={resumo.respondidos} tone="info" />
      </div>

      <section className="surface-panel p-3 md:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(320px,1fr)_240px_auto] lg:items-end lg:gap-4">
          <div>
            <Label className="text-xs">Buscar no histórico</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                placeholder="Nome, telefone, processo ou mensagem…"
                className="pl-9"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Ordenar registros</Label>
            <Select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)} className="w-full">
              {ORDENACAO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
          <Button
            variant={periodoAtivo ? "secondary" : "outline"}
            className="w-full lg:w-auto"
            onClick={() => setMostrarPeriodo((valor) => !valor)}
          >
            <SlidersHorizontal className="h-4 w-4" /> {periodoAtivo ? "Período aplicado" : "Filtrar período"}
          </Button>
        </div>

        {(mostrarPeriodo || periodoAtivo) && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50 sm:flex sm:items-end">
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

        <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 sm:w-72">
            <Label className="text-xs">Template usado somente em reenvios</Label>
            <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-full">
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.nome}</option>
              ))}
            </Select>
          </div>
          <p className="pb-1 text-xs text-zinc-500 dark:text-zinc-400">
            {logsFiltrados.length} de {logs?.length ?? 0} registro(s) exibido(s)
          </p>
        </div>
      </section>

      <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          onClick={() => setLetra(null)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            letra === null
              ? "bg-accent-500 text-white"
              : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          )}
        >
          Todos
        </button>
        {LETRAS.map((l) => (
          <button
            key={l}
            onClick={() => setLetra(letra === l ? null : l)}
            className={cn(
              "h-7 w-7 shrink-0 rounded-md text-xs font-medium transition-colors",
              letra === l
                ? "bg-accent-500 text-white"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
          >
            {l}
          </button>
        ))}
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
            <Button variant="outline" className="danger-action" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}>
              <Trash2 className="h-3.5 w-3.5 text-red-500 dark:text-red-400" /> Apagar selecionados
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
      ) : logsFiltrados.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="Nenhum resultado para esses filtros"
          description="Tente ajustar a busca, o período, a letra ou a ordenação."
        />
      ) : (
        <>
          {/* Mobile: cards compactos (nome + status + entrega), detalhes por trás do expandir */}
          <div className="space-y-3 md:hidden">
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Checkbox
                checked={logsPaginados.length > 0 && logsPaginados.every((l) => selecionados.has(l.id))}
                onChange={alternarSelecionarTodos}
              />
              <span>Selecionar todos nesta página</span>
            </div>
            {logsPaginados.map((log) => {
              const aberto = expandido === log.id;
              return (
                <SelectableCard key={log.id} checked={selecionados.has(log.id)} onToggle={() => alternarSelecionado(log.id)}>
                  <button
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => setExpandido(aberto ? null : log.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{log.card_nome || "Sem nome"}</span>
                      {log.tipo_envio === "lembrete" && (
                        <Badge tone="info" className="mt-1.5"><AlarmClock className="h-3 w-3" /> Lembrete</Badge>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {log.telefone ? formatPhoneDisplay(log.telefone) : "—"}
                        <AckIndicator ack={log.ack} sendStatus={log.status} respondido={log.resposta_status === "respondido"} />
                      </span>
                      <span className="mt-1 block text-xs text-zinc-400">{formatarData(log)}</span>
                    </span>
                    {aberto ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                    )}
                  </button>

                  {aberto && (
                    <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2">
                        <StatusBadge sendStatus={log.status} ack={log.ack} respostaStatus={log.resposta_status} />
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Apagar"
                          aria-label={`Apagar registro de ${log.card_nome || "cliente"}`}
                          onClick={() => setApagarAlvo(log)}
                          disabled={apagando === log.id}
                        >
                          <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                        </Button>
                      </div>
                      {log.erro && log.status === "falha" && <p className="text-xs text-red-500">{log.erro}</p>}
                      <PainelAgendamento log={log} />
                      <PainelComunicacao log={log} />
                      {log.status === "falha" && log.tipo_envio !== "lembrete" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => reenviar(log)}
                          loading={reenviando === log.id}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reenviar
                        </Button>
                      )}
                    </div>
                  )}
                </SelectableCard>
              );
            })}
          </div>

          {/* Desktop: tabela compacta de 6 colunas, detalhes num accordion por linha */}
          <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 md:block">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-center text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="w-10 px-5 py-3">
                    <Checkbox
                      checked={logsPaginados.length > 0 && logsPaginados.every((l) => selecionados.has(l.id))}
                      onChange={alternarSelecionarTodos}
                    />
                  </th>
                  <th className="px-5 py-3">Cliente</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Enviado em</th>
                  <th className="px-5 py-3">Entrega</th>
                  <th className="w-16 px-5 py-3">Status</th>
                  <th className="px-5 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {logsPaginados.map((log) => {
                  const aberto = expandido === log.id;
                  const temAgendamento = periciasDoLog(log).length > 0;
                  const temComunicacao = temRespostaRecebida(log) || Boolean(log.mensagem_enviada);
                  return (
                    <Fragment key={log.id}>
                      <tr
                        className="cursor-pointer bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/40"
                        onClick={() => setExpandido(aberto ? null : log.id)}
                      >
                        <td className="px-5 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selecionados.has(log.id)} onChange={() => alternarSelecionado(log.id)} />
                        </td>
                        <td className="max-w-[240px] break-words px-5 py-3 text-left font-medium text-zinc-900 dark:text-zinc-100">
                          {log.card_nome || "—"}
                          {log.tipo_envio === "lembrete" && (
                            <Badge tone="info" className="ml-2 align-middle"><AlarmClock className="h-3 w-3" /> Lembrete</Badge>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-center text-zinc-600 dark:text-zinc-400">
                          {log.telefone ? formatPhoneDisplay(log.telefone) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
                          {formatarData(log)}
                        </td>
                        <td className="px-5 py-3 text-center">
                          <AckIndicator ack={log.ack} sendStatus={log.status} respondido={log.resposta_status === "respondido"} />
                        </td>
                        <td className="px-5 py-3 text-center">
                          <StatusBadge sendStatus={log.status} ack={log.ack} respostaStatus={log.resposta_status} />
                        </td>
                        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" title="Ver detalhes" onClick={() => setExpandido(aberto ? null : log.id)}>
                              {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                            {log.status === "falha" && log.tipo_envio !== "lembrete" && (
                              <Button variant="outline" size="sm" onClick={() => reenviar(log)} loading={reenviando === log.id}>
                                <RotateCcw className="h-3.5 w-3.5" /> Reenviar
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Apagar"
                              onClick={() => setApagarAlvo(log)}
                              disabled={apagando === log.id}
                            >
                              <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {aberto && (
                        <tr className="bg-zinc-50 dark:bg-zinc-800/30">
                          <td colSpan={7} className="space-y-4 px-5 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Detalhes do registro</p>
                                {log.tipo_envio === "lembrete" && <Badge tone="info"><AlarmClock className="h-3 w-3" /> Lembrete</Badge>}
                              </div>
                              <p className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                <Clock className="h-3.5 w-3.5" /> Enviado em {formatarData(log)}
                              </p>
                            </div>
                            {log.erro && log.status === "falha" && <p className="text-xs text-red-500">{log.erro}</p>}
                            <div className={cn("grid items-stretch gap-4", temAgendamento && temComunicacao && "lg:grid-cols-2")}>
                              <PainelAgendamento log={log} />
                              <PainelComunicacao log={log} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={pagina} totalItems={logsFiltrados.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPagina} />
        </>
      )}

      <ConfirmDialog
        open={apagarAlvo !== null}
        title="Apagar registro?"
        message={`Isso vai apagar em definitivo o registro de envio para ${apagarAlvo?.card_nome || "este cliente"}. Essa ação não pode ser desfeita.`}
        loading={apagando === apagarAlvo?.id}
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
