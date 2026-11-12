import { remarcacoesDoLog, comparacaoRemarcacao } from "@/lib/remarcacaoHistorico";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  BriefcaseBusiness,
  Calendar,
  CalendarClock,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  History as HistoryIcon,
  MoreHorizontal,
  MapPin,
  MessageSquareReply,
  NotebookPen,
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
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";

const ITENS_POR_PAGINA = 20;

type Ordenacao = "recentes" | "antigos" | "az" | "za";

const ORDENACAO_OPTIONS: { value: Ordenacao; label: string }[] = [
  { value: "recentes", label: "Mais recentes primeiro" },
  { value: "antigos", label: "Mais antigos primeiro" },
  { value: "az", label: "Nome (A-Z)" },
  { value: "za", label: "Nome (Z-A)" },
];

type FiltroEnvio = "todos" | "falha" | "nao_entregue" | "entregue" | "lido" | "respondido" | "remarcacao";
const iniciais = (nome: string | null) => (nome || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
function combinaEnvio(log: SendLog, f: FiltroEnvio): boolean {
  switch (f) {
    case "todos": return true;
    case "falha": return log.status === "falha";
    case "nao_entregue": return log.status === "sucesso" && (log.ack === null || log.ack < 2);
    case "entregue": return log.status === "sucesso" && log.ack === 2 && log.resposta_status !== "respondido";
    case "lido": return log.status === "sucesso" && log.ack !== null && log.ack >= 3 && log.resposta_status !== "respondido";
    case "respondido": return log.resposta_status === "respondido";
    case "remarcacao": return remarcacoesDoLog(log).length > 0;
  }
}

/** Data local (America/Sao_Paulo) no formato YYYY-MM-DD, para comparar com o valor de um <input type="date">. */
function dataLocalYMD(createdAtUtc: string): string {
  return new Date(createdAtUtc + "Z").toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function formatarDataHora(data?: string | null): string | null {
  if (!data) return null;
  return new Date(data + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function temRespostaRecebida(log: SendLog): boolean {
  return log.resposta_status === "respondido";
}

function temFinalizacaoSemResposta(log: SendLog): boolean {
  return log.resposta_status === "cancelado";
}

function RespostaRecebida({ log, integrada = false }: { log: SendLog; integrada?: boolean }) {
  const respondidoEm = formatarDataHora(log.resposta_resolved_at);
  if (!temRespostaRecebida(log)) return null;

  const reacao = log.resposta_tipo === "reacao";
  const confirmacaoManual = log.resposta_preview === "Confirmado manualmente";
  const IconeResposta = confirmacaoManual ? CheckCheck : reacao ? SmilePlus : MessageSquareReply;
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
          {confirmacaoManual ? "Recebimento confirmado manualmente" : "Mensagem recebida"}
        </p>
        <span className="rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
          {confirmacaoManual ? "Manual" : reacao ? "Reação" : "Mensagem"}
        </span>
      </div>
      <div className="mt-2.5 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <IconeResposta className="mt-0.5 h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
        <p className="min-w-0 whitespace-pre-wrap break-words font-medium">{conteudo}</p>
      </div>
      {respondidoEm && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {confirmacaoManual ? "Confirmado em" : "Recebida em"} {respondidoEm}
        </p>
      )}
    </div>
  );
}

function FinalizacaoSemResposta({ log }: { log: SendLog }) {
  if (!temFinalizacaoSemResposta(log)) return null;
  const finalizadoEm = formatarDataHora(log.resposta_resolved_at);
  const observacao = log.resposta_observacao_finalizacao || "Espera encerrada sem observação registrada.";

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/70 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
          Espera finalizada sem resposta
        </p>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          Encerramento
        </span>
      </div>
      <div className="mt-2.5 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="min-w-0 whitespace-pre-wrap break-words font-medium">{observacao}</p>
      </div>
      {finalizadoEm && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Finalizada em {finalizadoEm}</p>
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

function ResumoRemarcacao({ log }: { log: SendLog }) {
  const changes = remarcacoesDoLog(log);
  if (!changes.length) return null;
  return <span className="mt-1.5 block min-w-0 space-y-1">
    <Badge tone="warning"><CalendarClock className="h-3 w-3" /> Remarcação</Badge>
    {changes.map((change, index) => <span key={index} className="block break-words text-xs font-normal text-zinc-500 dark:text-zinc-400">{comparacaoRemarcacao(change)}</span>)}
  </span>;
}

function DetalhesRemarcacao({ log }: { log: SendLog }) {
  const changes = remarcacoesDoLog(log);
  if (!changes.length) return null;
  return <div className="min-w-0 space-y-3 border-b border-zinc-100 p-4 dark:border-zinc-800">
    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300"><CalendarClock className="h-4 w-4 shrink-0" /> {log.status === "falha" ? "Tentativa de comunicar remarcação" : log.tipo_envio === "reenvio" ? "Informações da remarcação reenviadas" : "Remarcação comunicada"}</p>
    {changes.map((change, index) => <div key={index} className="min-w-0 space-y-2">
      <p className="break-words text-xs font-medium text-zinc-600 dark:text-zinc-300">{change.origem === "audiencia" ? "Audiência" : change.origem === "social" ? "Perícia social" : change.origem === "medica" ? "Perícia médica" : change.tipo}{change.processo ? ` · Processo: ${change.processo}` : ""}</p>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {[{ title: "Anterior", event: change.anterior }, { title: "Novo agendamento", event: change.novo }].map(({ title, event }) => <div key={title} className="min-w-0 rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
          <p className="mb-2 font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
          <p className="break-words text-zinc-600 dark:text-zinc-300">Data: {event.data || "Não informada"}</p>
          <p className="mt-1 break-words text-zinc-600 dark:text-zinc-300">Horário: {event.horario || "Não informado"}</p>
          <p className="mt-1 break-words text-zinc-500 dark:text-zinc-400">Local: {event.local || "Não informado"}</p>
        </div>)}
      </div>
    </div>)}
  </div>;
}

function PainelAgendamento({ log }: { log: SendLog }) {
  const pericias = periciasDoLog(log);
  if (pericias.length === 0) return null;

  return (
    <section className="min-w-0 h-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
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
      <DetalhesRemarcacao log={log} />
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
                {pericia.local && <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{pericia.local}</span></p>}
                {pericia.processo && <p className="flex items-start gap-2"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-all">{pericia.processo}</span></p>}
                {pericia.profissionalPerito && <p className="flex items-start gap-2"><BriefcaseBusiness className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{pericia.profissionalPerito}</span></p>}
                {pericia.telefone && <p className="flex items-start gap-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{formatPhoneDisplay(pericia.telefone)}</span></p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PainelComunicacao({
  log,
  onReenviarInformacoes,
  reenviando,
}: {
  log: SendLog;
  onReenviarInformacoes: (log: SendLog) => void;
  reenviando: boolean;
}) {
  const { can } = useAuth();
  const temMensagem = Boolean(log.mensagem_enviada);
  const temResposta = temRespostaRecebida(log);
  const temFinalizacao = temFinalizacaoSemResposta(log);
  if (!temMensagem && !temResposta && !temFinalizacao) return null;

  return (
    <section className="min-w-0 h-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
          <MessageSquareReply className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Comunicação com o cliente</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {temResposta
              ? "Resposta recebida"
              : temFinalizacao
                ? "Espera finalizada sem resposta"
                : log.tipo_envio === "reenvio"
                  ? "Informações reenviadas"
                  : "Mensagem enviada, aguardando resposta"}
          </p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <RespostaRecebida log={log} integrada />
        <FinalizacaoSemResposta log={log} />
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
        {can("messages.send") && log.tipo_envio !== "lembrete" && log.mensagem_enviada && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onReenviarInformacoes(log)}
            loading={reenviando}
          >
            <Send className="h-3.5 w-3.5" /> Reenviar informações
          </Button>
        )}
      </div>
    </section>
  );
}

export function Historico() {
  const { can } = useAuth();
  const canManage = can("history.manage");
  const canSend = can("messages.send");
  const { show } = useToast();
  const [logs, setLogs] = useState<SendLog[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [reenviando, setReenviando] = useState<number | null>(null);
  const [reenviandoInformacoes, setReenviandoInformacoes] = useState<number | null>(null);
  const [reenviarInformacoesAlvo, setReenviarInformacoesAlvo] = useState<SendLog | null>(null);
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [apagando, setApagando] = useState<number | null>(null);
  const [apagandoSelecionados, setApagandoSelecionados] = useState(false);
  const [apagarAlvo, setApagarAlvo] = useState<SendLog | null>(null);
  const [confirmMassaAberto, setConfirmMassaAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroEnvio>("todos");
  const [reenviarAlvo, setReenviarAlvo] = useState<SendLog | null>(null);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("recentes");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [mostrarPeriodo, setMostrarPeriodo] = useState(false);

  async function carregar() {
    const data = await api.get<SendLog[]>("/logs");
    setLogs(data);
  }

  useEffect(() => {
    carregar();
    api.get<Template[]>("/templates").then((data) => {
      setTemplates(data);
      if (data.length > 0) setTemplateId((data.find(template => template.padrao) || data[0]).id);
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
      if (!combinaEnvio(log, filtro)) return false;
      if (termo) {
        const nomeMatch = (log.card_nome || "").toLowerCase().includes(termo);
        const telefoneMatch = termoDigits.length > 0 && (log.telefone || "").replace(/\D/g, "").includes(termoDigits);
        const mensagemMatch = (log.mensagem_enviada || "").toLowerCase().includes(termo) || remarcacoesDoLog(log).some(change => [comparacaoRemarcacao(change), change.anterior.local, change.novo.local].some(value => value.toLowerCase().includes(termo)));
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
  }, [logs, busca, dataDe, dataAte, ordenacao, filtro]);

  const logsPaginados = useMemo(
    () => logsFiltrados.slice(pagina * ITENS_POR_PAGINA, (pagina + 1) * ITENS_POR_PAGINA),
    [logsFiltrados, pagina]
  );

  const resumo = useMemo(() => {
    const lista = logs ?? [];
    const n = (f: FiltroEnvio) => lista.filter((l) => combinaEnvio(l, f)).length;
    return { todos: lista.length, falha: n("falha"), nao_entregue: n("nao_entregue"), entregue: n("entregue"), lido: n("lido"), respondido: n("respondido"), remarcacao: n("remarcacao") };
  }, [logs]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(logsFiltrados.length / ITENS_POR_PAGINA) - 1);
    if (pagina > ultimaPagina) setPagina(ultimaPagina);
  }, [logsFiltrados, pagina]);

  useEffect(() => {
    setPagina(0);
  }, [busca, dataDe, dataAte, ordenacao, filtro]);

  async function reenviar(log: SendLog) {
    if (!templateId) {
      show("Selecione um template para reenviar.", "error");
      return;
    }
    setReenviarAlvo(null);
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

  async function confirmarReenvioInformacoes() {
    if (!reenviarInformacoesAlvo) return;
    const alvo = reenviarInformacoesAlvo;
    setReenviandoInformacoes(alvo.id);
    try {
      await api.post(`/logs/${alvo.id}/reenviar-informacoes`);
      show(`Informações da perícia reenviadas para ${alvo.card_nome || "cliente"}.`, "success");
      setReenviarInformacoesAlvo(null);
      await carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao reenviar as informações da perícia.", "error");
      setReenviarInformacoesAlvo(null);
    } finally {
      setReenviandoInformacoes(null);
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
  const paineis: [FiltroEnvio, string, number][] = [["todos", "Envios", resumo.todos], ["falha", "Com falha", resumo.falha], ["nao_entregue", "Ainda não entregues", resumo.nao_entregue], ["entregue", "Entregues", resumo.entregue], ["lido", "Lidas", resumo.lido], ["respondido", "Respondidas", resumo.respondido], ["remarcacao", "Remarcações", resumo.remarcacao]];
  const aberto = (log: SendLog) => expandido === log.id;

  return (
    <div className="min-w-0 max-w-full space-y-5 [overflow-wrap:anywhere]">
      <PageHeader
        title="Histórico de envios"
        description="Tudo o que foi enviado aos clientes: entrega, leitura, resposta e os dados usados em cada aviso."
        actions={<Button variant="outline" onClick={carregar}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {paineis.map(([k, rotulo, n]) => (
          <button key={k} type="button" onClick={() => setFiltro(filtro === k && k !== "todos" ? "todos" : k)} aria-pressed={filtro === k}
            className={`rounded-2xl border p-3.5 text-left transition ${filtro === k ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"} ${k === "falha" && n > 0 && filtro !== k ? "border-red-300 dark:border-red-800" : ""}`}>
            <span className={`block text-2xl font-semibold leading-none ${k === "falha" && n > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{n}</span>
            <span className="mt-1.5 block text-xs text-zinc-500">{rotulo}</span>
          </button>))}
      </div>

      <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input aria-label="Buscar no histórico" placeholder="Nome, telefone, processo ou mensagem…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <Select value={ordenacao} onChange={(e) => setOrdenacao(e.target.value as Ordenacao)} className="sm:max-w-[210px]" aria-label="Ordenar">
            {ORDENACAO_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Button variant={periodoAtivo ? "secondary" : "outline"} onClick={() => setMostrarPeriodo((valor) => !valor)}><SlidersHorizontal className="h-4 w-4" /> {periodoAtivo ? "Período aplicado" : "Período"}</Button>
          {canManage && logsPaginados.length > 0 && <label className="flex shrink-0 cursor-pointer items-center gap-2 px-1 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={logsPaginados.every((l) => selecionados.has(l.id))} onChange={alternarSelecionarTodos} /> Marcar esta página</label>}
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

      {logs === null ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nenhum envio registrado ainda" description="Os envios feitos pelo sistema aparecerão aqui." />
      ) : logsFiltrados.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nenhum resultado para esses filtros" description="Escolha outro painel acima, ajuste a busca ou o período." />
      ) : (
        <>
          <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
            {logsPaginados.map((log) => (
              <li key={log.id} className={selecionados.has(log.id) ? "bg-accent-50/50 dark:bg-accent-500/10" : ""}>
                <div className={`flex flex-col gap-3 px-4 py-3 transition hover:bg-accent-50/40 dark:hover:bg-white/5 sm:flex-row sm:items-center ${log.status === "falha" ? "border-l-4 border-l-red-500" : ""}`}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {canManage && <span className="mt-1"><Checkbox aria-label={`Selecionar registro de ${log.card_nome || "cliente"}`} checked={selecionados.has(log.id)} onChange={() => alternarSelecionado(log.id)} /></span>}
                    <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-200 sm:flex">{iniciais(log.card_nome)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{log.card_nome || "Sem nome"}</h3>
                        <StatusBadge sendStatus={log.status} ack={log.ack} respostaStatus={log.resposta_status} />
                        {log.tipo_envio === "lembrete" && <Badge tone="info">Lembrete</Badge>}
                        {log.tipo_envio === "reenvio" && <Badge tone="accent">Reenvio</Badge>}
                        {remarcacoesDoLog(log).length > 0 && <Badge tone="warning"><CalendarClock className="h-3 w-3" /> Remarcação</Badge>}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400"><span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{log.telefone ? formatPhoneDisplay(log.telefone) : "Telefone não informado"}</span><span>{formatarData(log)}</span><AckIndicator ack={log.ack} sendStatus={log.status} respondido={log.resposta_status === "respondido"} /></p>
                      {log.status === "falha" && log.erro ? <p className="mt-1 line-clamp-1 text-xs text-red-600 dark:text-red-400" title={log.erro}>{log.erro}</p> : log.mensagem_enviada ? <p className="mt-1 line-clamp-1 text-xs text-zinc-600 dark:text-zinc-300" title={log.mensagem_enviada}>{log.mensagem_enviada}</p> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canSend && log.status === "falha" && log.tipo_envio === "disparo" && <Button size="sm" onClick={() => setReenviarAlvo(log)} loading={reenviando === log.id}><RotateCcw className="h-3.5 w-3.5" /> Reenviar</Button>}
                    <Button variant="outline" size="sm" aria-expanded={aberto(log)} onClick={() => setExpandido(aberto(log) ? null : log.id)}><ChevronDown className={`h-3.5 w-3.5 transition ${aberto(log) ? "rotate-180" : ""}`} /> {aberto(log) ? "Recolher" : "Detalhes"}</Button>
                    {canManage && <MenuSuspenso gatilho={({ aberto: a, alternar }) => <button type="button" aria-label={`Mais ações para ${log.card_nome || "cliente"}`} aria-expanded={a} onClick={alternar} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><MoreHorizontal className="h-4 w-4" /></button>}>
                      {(fechar) => <button type="button" role="menuitem" className="menu-pop-item text-red-600 dark:text-red-400" onClick={() => { fechar(); setApagarAlvo(log); }}><Trash2 className="h-4 w-4" /> Apagar registro</button>}
                    </MenuSuspenso>}
                  </div>
                </div>
                {aberto(log) && <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/60 px-4 py-4 dark:border-zinc-800 dark:bg-white/[0.02]">
                  {log.erro && log.status === "falha" && <p className="text-xs text-red-500">{log.erro}</p>}
                  <div className="grid min-w-0 gap-4 xl:grid-cols-2"><PainelAgendamento log={log} /><PainelComunicacao log={log} onReenviarInformacoes={setReenviarInformacoesAlvo} reenviando={reenviandoInformacoes === log.id} /></div>
                </div>}
              </li>))}
          </ul>
          {logsFiltrados.length > ITENS_POR_PAGINA && <Pagination page={pagina} totalItems={logsFiltrados.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPagina} />}
          <p className="text-right text-xs text-zinc-500">{logsFiltrados.length} de {logs.length} registro(s)</p>
        </>
      )}

      <Modal open={reenviarAlvo !== null} onClose={() => setReenviarAlvo(null)} title="Reenviar mensagem" description={`Escolha o modelo para reenviar a ${reenviarAlvo?.card_nome || "este cliente"}.`}
        footer={<><Button variant="outline" onClick={() => setReenviarAlvo(null)}>Cancelar</Button><Button onClick={() => reenviarAlvo && void reenviar(reenviarAlvo)} disabled={!templateId}><RotateCcw className="h-4 w-4" /> Reenviar</Button></>}>
        <div><Label className="text-xs">Modelo de mensagem</Label>
          <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-full">{templates.map((template) => <option key={template.id} value={template.id}>{template.nome}</option>)}</Select>
          <p className="mt-2 text-xs text-zinc-500">Os dados do agendamento do registro original são usados no modelo escolhido.</p></div>
      </Modal>
      <ConfirmDialog
        open={reenviarInformacoesAlvo !== null}
        title="Reenviar informações da perícia?"
        message={`A mesma mensagem exibida neste registro será enviada novamente para ${reenviarInformacoesAlvo?.card_nome || "este cliente"}. Isso criará um novo registro no Histórico, sem reabrir a espera por resposta.`}
        confirmLabel="Reenviar informações"
        confirmVariant="primary"
        loading={reenviandoInformacoes === reenviarInformacoesAlvo?.id}
        onConfirm={confirmarReenvioInformacoes}
        onCancel={() => setReenviarInformacoesAlvo(null)}
      />
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

