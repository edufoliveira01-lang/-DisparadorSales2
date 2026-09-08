import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock3,
  Gavel,
  Inbox,
  MapPin,
  MessageSquareReply,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Video,
  WifiOff,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { classificarEvento, type CategoriaEvento } from "@/lib/eventVisual";
import type {
  CardViewModel,
  Contact,
  ModoEnvio,
  PendingReply,
  Pericia,
  PericiaAgendada,
  SendLog,
  Settings,
  Template,
} from "@/lib/types";
import { classificarModalidadeAudiencia } from "@/lib/audiencia";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { CardItem } from "@/components/CardItem";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type FiltroStatus = "todos" | "enviado" | "nao_enviado" | "falhou";
type FiltroTipo = "todos" | "medica" | "social" | "audiencia";

const STATUS_OPTIONS: { value: FiltroStatus; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "nao_enviado", label: "Pendentes" },
  { value: "enviado", label: "Enviados" },
  { value: "falhou", label: "Falhas" },
];

const TIPO_OPTIONS: { value: FiltroTipo; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "medica", label: "Médica" },
  { value: "social", label: "Social" },
  { value: "audiencia", label: "Audiência" },
];

const MODALIDADE_POR_MODO: Record<Exclude<ModoEnvio, "template">, "presencial" | "online" | "hibrida"> = {
  audiencia_presencial: "presencial",
  audiencia_online: "online",
  audiencia_hibrida: "hibrida",
};

interface PanoramaDashboard {
  pericias: PericiaAgendada[];
  pendentes: PendingReply[];
  logs: SendLog[];
}

interface PendenciaProcessoLembrete {
  ids: number[];
  nome: string;
  processo: string;
  contato: Pick<Contact, "id" | "nome" | "telefone">;
}

type RetomadaAposProcesso =
  | { tipo: "individual"; pericia: PericiaAgendada; forcar: boolean }
  | { tipo: "lote"; periodo: "hoje" | "proximaData"; eventos: PericiaAgendada[] };

interface FluxoProcessoLembrete {
  pendencias: PendenciaProcessoLembrete[];
  indice: number;
  valor: string;
  retomada: RetomadaAposProcesso;
}

function diaLocalYMD(dataHoraMs: number): string {
  return new Date(dataHoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** "YYYY-MM-DD" -> "dd/mm", para o rótulo do painel "Próximas Perícias". */
function formatarDiaCurto(ymd: string): string {
  const [, mes, dia] = ymd.split("-");
  return `${dia}/${mes}`;
}

function agruparEventosPorDestinatario(eventos: PericiaAgendada[]): PericiaAgendada[][] {
  const grupos = new Map<string, PericiaAgendada[]>();
  for (const evento of eventos) {
    const telefone = evento.telefone_digits || `sem-telefone:${evento.id}`;
    const nome = evento.nome.trim().toLocaleLowerCase("pt-BR");
    const chave = `${diaLocalYMD(evento.data_hora_ms)}|${telefone}|${nome}`;
    const grupo = grupos.get(chave) ?? [];
    grupo.push(evento);
    grupos.set(chave, grupo);
  }
  return Array.from(grupos.values());
}

function toneEventoDashboard(categoria: CategoriaEvento): "neutral" | "accent" | "violet" | "info" | "cyan" | "indigo" {
  if (categoria === "pericia_social") return "violet";
  if (categoria === "audiencia_presencial") return "info";
  if (categoria === "audiencia_online") return "cyan";
  if (categoria === "audiencia_hibrida") return "indigo";
  if (categoria === "tipo_nao_identificado" || categoria === "outro") return "neutral";
  return "accent";
}

function classesIconeEventoDashboard(categoria: CategoriaEvento): string {
  if (categoria === "pericia_social") return "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300";
  if (categoria === "audiencia_presencial") return "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300";
  if (categoria === "audiencia_online") return "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300";
  if (categoria === "audiencia_hibrida") return "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300";
  if (categoria === "tipo_nao_identificado" || categoria === "outro") return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300";
}

export function Dashboard() {
  const { show } = useToast();
  const navigate = useNavigate();

  const [cards, setCards] = useState<CardViewModel[] | null>(null);
  const [panorama, setPanorama] = useState<PanoramaDashboard | null>(null);
  const [carregandoPanorama, setCarregandoPanorama] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const whatsapp = useWhatsapp();

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [contatoOverrides, setContatoOverrides] = useState<Record<string, Contact>>({});
  const [nomeOverrides, setNomeOverrides] = useState<Record<string, string>>({});
  const [periciasOverrides, setPericiasOverrides] = useState<Record<string, Pericia[]>>({});
  const [modoOverrides, setModoOverrides] = useState<Record<string, ModoEnvio>>({});
  const [mensagensAudiencia, setMensagensAudiencia] = useState({ presencial: "", online: "", hibrida: "" });
  const [intervaloEnvio, setIntervaloEnvio] = useState({ min: 5, max: 15 });
  const [enviandoCardId, setEnviandoCardId] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");

  const [preview, setPreview] = useState<{ card: CardViewModel; mensagens: string[]; modo: ModoEnvio } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ ativo: boolean; total: number; aguardandoReconexao?: boolean } | null>(
    null
  );

  const [enviandoLembreteId, setEnviandoLembreteId] = useState<number | null>(null);
  const [lembreteReenvioConfirm, setLembreteReenvioConfirm] = useState<PericiaAgendada | null>(null);
  const [lembreteBatchConfirm, setLembreteBatchConfirm] = useState<{ periodo: "hoje" | "proximaData"; eventos: PericiaAgendada[] } | null>(
    null
  );
  const [lembreteBatchLoading, setLembreteBatchLoading] = useState(false);
  const [lembreteBatchProgress, setLembreteBatchProgress] = useState<{
    ativo: boolean;
    total: number;
    enviados: number;
    falhas: number;
    ignorados: number;
  } | null>(null);
  const [processoLembrete, setProcessoLembrete] = useState<FluxoProcessoLembrete | null>(null);
  const [salvandoProcessoLembrete, setSalvandoProcessoLembrete] = useState(false);

  const [cadastro, setCadastro] = useState<{
    card: CardViewModel;
    nome: string;
    telefone: string;
    processo: string;
    observacoes: string;
    contatoId?: number;
  } | null>(null);
  const [salvandoContato, setSalvandoContato] = useState(false);

  const [edicaoNome, setEdicaoNome] = useState<{ card: CardViewModel; nome: string } | null>(null);
  const [edicaoPericia, setEdicaoPericia] = useState<{ card: CardViewModel; index: number; pericia: Pericia } | null>(null);

  const carregarCards = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const data = await api.get<CardViewModel[]>("/cards");
      setCards(data);
    } catch (err) {
      setCards([]);
      setErro(err instanceof ApiError ? err.message : "Erro ao carregar os cards do Trello.");
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarPanorama = useCallback(async () => {
    setCarregandoPanorama(true);
    try {
      const [pericias, pendentes, logs] = await Promise.all([
        api.get<PericiaAgendada[]>("/pericias-agendadas"),
        api.get<PendingReply[]>("/pending-replies"),
        api.get<SendLog[]>("/logs"),
      ]);
      setPanorama({ pericias, pendentes, logs });
    } catch {
      setPanorama((atual) => atual ?? { pericias: [], pendentes: [], logs: [] });
    } finally {
      setCarregandoPanorama(false);
    }
  }, []);

  useEffect(() => {
    carregarCards();
    carregarPanorama();
    api.get<Template[]>("/templates").then((data) => {
      setTemplates(data);
      if (data.length > 0) setTemplateId(data[0].id);
    });
    api.get<Settings>("/settings").then((data) => {
      setMensagensAudiencia({
        presencial: data.audiencia_presencial_mensagem ?? "",
        online: data.audiencia_online_mensagem ?? "",
        hibrida: data.audiencia_hibrida_mensagem ?? "",
      });
      setIntervaloEnvio({
        min: Number(data.send_interval_min) || 5,
        max: Number(data.send_interval_max) || 15,
      });
    });
  }, [carregarCards, carregarPanorama]);

  useSocketEvent<{ cardId: string; status: "sucesso" | "falha"; erro?: string }>("send:update", (payload) => {
    setEnviandoCardId(null);
    setCards((prev) =>
      prev
        ? prev.map((c) =>
            c.cardId === payload.cardId
              ? { ...c, ultimoEnvio: { status: payload.status, data: new Date().toISOString(), erro: payload.erro || null } }
              : c
          )
        : prev
    );
  });

  useSocketEvent<{ total: number }>("send:batch-started", ({ total }) => {
    setBatchProgress({ ativo: true, total });
    show(`Envio em lote iniciado (${total} card${total > 1 ? "s" : ""}).`, "info");
  });
  useSocketEvent<{ reason: string; total: number }>("send:batch-waiting-reconnect", ({ reason, total }) => {
    setBatchProgress({ ativo: true, total, aguardandoReconexao: true });
    show(reason, "error");
  });
  useSocketEvent("send:batch-resumed", () => {
    setBatchProgress((prev) => (prev ? { ...prev, aguardandoReconexao: false } : prev));
    show("WhatsApp reconectado — envio em lote retomado automaticamente.", "success");
  });
  useSocketEvent<{ reason: string }>("send:batch-paused", ({ reason }) => {
    setBatchProgress(null);
    show(reason, "error");
  });
  useSocketEvent("send:batch-completed", () => {
    setBatchProgress(null);
    show("Envio em lote concluído.", "success");
    setSelecionados(new Set());
    carregarCards();
    carregarPanorama();
  });

  useSocketEvent("pendingReply:resolved", carregarPanorama);

  useSocketEvent<{ total: number; ignorados: number }>("lembrete:batch-started", ({ total, ignorados }) => {
    setLembreteBatchProgress({ ativo: true, total, enviados: 0, falhas: 0, ignorados });
    show(`Envio de lembretes iniciado para ${total} cliente${total === 1 ? "" : "s"}.`, "info");
  });
  useSocketEvent<{ enviados: number; falhas: number; total: number }>("lembrete:update", ({ enviados, falhas, total }) => {
    setLembreteBatchProgress((atual) => ({
      ativo: true,
      total,
      enviados,
      falhas,
      ignorados: atual?.ignorados ?? 0,
    }));
  });
  useSocketEvent<{ reason: string; enviados: number; falhas: number; ignorados: number }>("lembrete:batch-paused", ({ reason, enviados, falhas, ignorados }) => {
    setLembreteBatchProgress(null);
    show(`${reason} Enviados: ${enviados}. Falhas: ${falhas}. Ignorados: ${ignorados}.`, "error");
    carregarPanorama();
  });
  useSocketEvent<{ total: number; enviados: number; falhas: number; ignorados: number }>(
    "lembrete:batch-completed",
    ({ enviados, falhas, ignorados }) => {
    setLembreteBatchProgress(null);
      show(
        `Lembretes concluídos. Enviados: ${enviados}. Falhas: ${falhas}. Ignorados: ${ignorados}.`,
        falhas > 0 ? "error" : "success"
      );
      carregarPanorama();
    }
  );

  function contatoEfetivo(card: CardViewModel): Contact | null {
    return contatoOverrides[card.cardId] || card.contato || null;
  }

  function nomeEfetivo(card: CardViewModel): string {
    return nomeOverrides[card.cardId] ?? card.nomeCliente;
  }

  function periciasEfetivas(card: CardViewModel): Pericia[] {
    return periciasOverrides[card.cardId] ?? card.pericias;
  }

  function processoDoCard(card: CardViewModel): string {
    return periciasEfetivas(card).map((p) => p.processo || "").find((processo) => processo.trim()) || "";
  }

  function criterioContatoEfetivo(card: CardViewModel): CardViewModel["criterioContato"] | "manual" {
    return contatoOverrides[card.cardId] ? "manual" : card.criterioContato;
  }

  /** Aplica os overrides locais (nome, perícias, contato) — são os dados usados na mensagem enviada. */
  function cardEfetivo(card: CardViewModel): CardViewModel {
    return {
      ...card,
      nomeCliente: nomeEfetivo(card),
      pericias: periciasEfetivas(card),
      contato: contatoEfetivo(card),
    };
  }

  /** true quando o card tem uma perícia marcada como audiência (cabeçalho "AUDIÊNCIA" no card do Trello). */
  function temAudiencia(card: CardViewModel): boolean {
    return periciasEfetivas(card).some((p) => p.origem === "audiencia");
  }

  /** Modo de envio detectado automaticamente a partir da descrição do card. */
  function modoDetectado(card: CardViewModel): ModoEnvio {
    const pericia = periciasEfetivas(card).find((p) => p.origem === "audiencia");
    if (!pericia) return "template";
    const modalidade = classificarModalidadeAudiencia(pericia.tipo);
    if (modalidade === "online") return "audiencia_online";
    if (modalidade === "hibrida") return "audiencia_hibrida";
    return "audiencia_presencial";
  }

  /** Modo efetivo: usa o override manual se o usuário tiver ajustado, senão o detectado automaticamente. */
  function modoEfetivo(card: CardViewModel): ModoEnvio {
    return modoOverrides[card.cardId] ?? modoDetectado(card);
  }

  function renderAudienciaLocal(mensagem: string, nome: string, pericia: Pericia): string {
    return mensagem
      .replace(/\{\{NOME\}\}/g, nome)
      .replace(/\{\{TIPO_PERICIA\}\}/g, pericia.tipo)
      .replace(/\{\{DATA\}\}/g, pericia.data)
      .replace(/\{\{HORARIO\}\}/g, pericia.horario)
      .replace(/\{\{LOCAL\}\}/g, pericia.local)
      .replace(/\{\{TELEFONE\}\}/g, pericia.telefone || "")
      .replace(/\{\{WHATSAPP\}\}/g, pericia.whatsapp || "")
      .replace(/\{\{PROCESSO\}\}/g, pericia.processo || "")
      .replace(/\{\{PROFISSIONAL_PERITO\}\}/g, pericia.profissionalPerito || "");
  }

  const cardsFiltrados = useMemo(() => {
    if (!cards) return [];
    const termo = busca.trim().toLowerCase();
    return cards.filter((card) => {
      if (termo) {
        const processoOuProfissional = card.pericias.some(
          (p) =>
            (p.processo || "").toLowerCase().includes(termo) ||
            (p.profissionalPerito || "").toLowerCase().includes(termo)
        );
        if (
          !card.nomeCliente.toLowerCase().includes(termo) &&
          !card.cardNome.toLowerCase().includes(termo) &&
          !processoOuProfissional
        ) {
          return false;
        }
      }
      if (filtroStatus === "enviado" && card.ultimoEnvio?.status !== "sucesso") return false;
      if (filtroStatus === "falhou" && card.ultimoEnvio?.status !== "falha") return false;
      if (filtroStatus === "nao_enviado" && card.ultimoEnvio) return false;

      if (filtroTipo !== "todos") {
        const origens = card.pericias.map((p) => p.origem || "geral");
        if (filtroTipo === "medica" && !origens.includes("medica")) return false;
        if (filtroTipo === "social" && !origens.includes("social")) return false;
        if (filtroTipo === "audiencia" && !origens.includes("audiencia")) return false;
      }
      return true;
    });
  }, [cards, busca, filtroStatus, filtroTipo]);

  const resumo = useMemo(() => {
    const lista = cards ?? [];
    return {
      pendentes: lista.filter((card) => !card.ultimoEnvio).length,
      prontos: lista.filter((card) => Boolean(contatoEfetivo(card)) && periciasEfetivas(card).length > 0).length,
      enviados: lista.filter((card) => card.ultimoEnvio?.status === "sucesso").length,
    };
    // Os overrides fazem parte da revisão atual do usuário e precisam refletir no resumo imediatamente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, contatoOverrides, periciasOverrides]);

  const visaoGeral = useMemo(() => {
    const hoje = hojeYMD();
    const eventosAtivos = (panorama?.pericias ?? []).filter((pericia) => pericia.status === "ativa");
    const pendentesAtivos = (panorama?.pendentes ?? []).filter((item) => item.status === "aguardando");
    const limiteSeteDias = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const logsRecentes = (panorama?.logs ?? []).filter((log) => {
      const data = new Date(log.created_at.endsWith("Z") ? log.created_at : `${log.created_at}Z`).getTime();
      return Number.isFinite(data) && data >= limiteSeteDias;
    });

    const eventosDoDia = (ymd: string) =>
      eventosAtivos.filter((pericia) => diaLocalYMD(pericia.data_hora_ms) === ymd).sort((a, b) => a.data_hora_ms - b.data_hora_ms);

    // Agrupa os eventos futuros por data. O primeiro grupo vira "Próxima data" e os demais
    // permanecem em "Próximos compromissos", incluindo perícias e audiências.
    const diasFuturosComEventos = new Map<string, PericiaAgendada[]>();
    for (const pericia of eventosAtivos) {
      const dia = diaLocalYMD(pericia.data_hora_ms);
      if (dia <= hoje) continue;
      const lista = diasFuturosComEventos.get(dia) ?? [];
      lista.push(pericia);
      diasFuturosComEventos.set(dia, lista);
    }
    const diasFuturosOrdenados = Array.from(diasFuturosComEventos.keys()).sort();
    const proximoDia = diasFuturosOrdenados[0] ?? null;
    const eventosProximaData = proximoDia
      ? [...diasFuturosComEventos.get(proximoDia)!].sort((a, b) => a.data_hora_ms - b.data_hora_ms)
      : [];
    const futurasTodas = diasFuturosOrdenados
      .slice(1)
      .flatMap((dia) => diasFuturosComEventos.get(dia)!)
      .sort((a, b) => a.data_hora_ms - b.data_hora_ms);

    return {
      hoje: eventosDoDia(hoje),
      proximaData: eventosProximaData,
      proximoDiaLabel: proximoDia ? formatarDiaCurto(proximoDia) : null,
      futuras: futurasTodas,
      totalFuturas: futurasTodas.length,
      aguardandoResposta: pendentesAtivos.length,
      entreguesAguardando: pendentesAtivos.filter((item) => item.ack !== null && item.ack >= 2).length,
      enviosRecentes: logsRecentes.length,
      falhasRecentes: logsRecentes.filter((log) => log.status === "falha").length,
    };
  }, [panorama]);

  function iniciarFluxoProcesso(pendencias: PendenciaProcessoLembrete[], retomada: RetomadaAposProcesso) {
    if (pendencias.length === 0) return;
    setProcessoLembrete({
      pendencias,
      indice: 0,
      valor: pendencias[0].processo,
      retomada,
    });
  }

  function pendenciaProcessoDoErro(err: unknown): PendenciaProcessoLembrete | null {
    if (!(err instanceof ApiError) || err.data?.code !== "PROCESSO_NAO_IDENTIFICADO") return null;
    const pendencia = err.data.pendencia as PendenciaProcessoLembrete | undefined;
    if (!pendencia || !Array.isArray(pendencia.ids) || !pendencia.contato?.id) return null;
    return pendencia;
  }

  async function enviarLembreteIndividual(pericia: PericiaAgendada, forcar = false) {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    setEnviandoLembreteId(pericia.id);
    try {
      await api.post(`/pericias-agendadas/${pericia.id}/lembrete`, { forcar });
      show(`${forcar ? "Novo lembrete" : "Lembrete"} enviado para ${pericia.nome}.`, "success");
      setLembreteReenvioConfirm(null);
      carregarPanorama();
    } catch (err) {
      const pendencia = pendenciaProcessoDoErro(err);
      if (pendencia) {
        setLembreteReenvioConfirm(null);
        iniciarFluxoProcesso([pendencia], { tipo: "individual", pericia, forcar });
      } else {
        show(err instanceof ApiError ? err.message : "Erro ao enviar lembrete.", "error");
      }
    } finally {
      setEnviandoLembreteId(null);
    }
  }

  function solicitarLembreteIndividual(pericia: PericiaAgendada) {
    if (pericia.ultimo_lembrete_em) {
      setLembreteReenvioConfirm(pericia);
      return;
    }
    enviarLembreteIndividual(pericia);
  }

  async function abrirConfirmLembreteBatch(periodo: "hoje" | "proximaData") {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    const eventos = visaoGeral[periodo].filter((evento) => !evento.ultimo_lembrete_em);
    if (eventos.length === 0) {
      show("Todos os compromissos deste painel já receberam lembrete.", "info");
      return;
    }
    try {
      const { pendencias } = await api.post<{ pendencias: PendenciaProcessoLembrete[] }>(
        "/pericias-agendadas/validar-lembretes",
        { ids: eventos.map((evento) => evento.id) }
      );
      if (pendencias.length > 0) {
        iniciarFluxoProcesso(pendencias, { tipo: "lote", periodo, eventos });
        return;
      }
      setLembreteBatchConfirm({ periodo, eventos });
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao validar os lembretes.", "error");
    }
  }

  async function confirmarProcessoLembrete() {
    if (!processoLembrete) return;
    const atual = processoLembrete.pendencias[processoLembrete.indice];
    const processo = processoLembrete.valor.trim();
    if (!processo) return;

    setSalvandoProcessoLembrete(true);
    try {
      await api.post("/pericias-agendadas/completar-processo", {
        ids: atual.ids,
        contactId: atual.contato.id,
        processo,
      });

      const proximoIndice = processoLembrete.indice + 1;
      if (proximoIndice < processoLembrete.pendencias.length) {
        const proxima = processoLembrete.pendencias[proximoIndice];
        setProcessoLembrete({ ...processoLembrete, indice: proximoIndice, valor: proxima.processo });
        return;
      }

      const retomada = processoLembrete.retomada;
      setProcessoLembrete(null);
      show("Número do processo salvo. O contato foi confirmado com segurança.", "success");

      if (retomada.tipo === "individual") {
        await enviarLembreteIndividual(retomada.pericia, retomada.forcar);
      } else {
        setLembreteBatchConfirm({ periodo: retomada.periodo, eventos: retomada.eventos });
      }
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar o número do processo.", "error");
    } finally {
      setSalvandoProcessoLembrete(false);
    }
  }

  async function confirmarLembreteBatch() {
    if (!lembreteBatchConfirm) return;
    setLembreteBatchLoading(true);
    try {
      const ids = lembreteBatchConfirm.eventos.map((e) => e.id);
      await api.post("/pericias-agendadas/lembrete-em-massa", { ids });
      const total = agruparEventosPorDestinatario(lembreteBatchConfirm.eventos).length;
      setLembreteBatchProgress({ ativo: true, total, enviados: 0, falhas: 0, ignorados: 0 });
      setLembreteBatchConfirm(null);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao iniciar envio dos lembretes.", "error");
    } finally {
      setLembreteBatchLoading(false);
    }
  }

  function toggleSelecionado(cardId: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleSelecionarTodos() {
    const todosVisiveisSelecionados = cardsFiltrados.every((c) => selecionados.has(c.cardId));
    if (todosVisiveisSelecionados) {
      setSelecionados((prev) => {
        const next = new Set(prev);
        cardsFiltrados.forEach((c) => next.delete(c.cardId));
        return next;
      });
    } else {
      setSelecionados((prev) => {
        const next = new Set(prev);
        cardsFiltrados.forEach((c) => next.add(c.cardId));
        return next;
      });
    }
  }

  function usarSugestao(card: CardViewModel) {
    if (!card.sugestaoContato) return;
    setContatoOverrides((prev) => ({ ...prev, [card.cardId]: card.sugestaoContato! }));
  }

  function abrirCadastro(card: CardViewModel) {
    setCadastro({ card, nome: nomeEfetivo(card), telefone: "", processo: processoDoCard(card), observacoes: "" });
  }

  function abrirEdicaoContato(card: CardViewModel) {
    const contato = contatoEfetivo(card);
    if (!contato) return;
    setCadastro({
      card,
      nome: contato.nome,
      telefone: formatPhoneDisplay(contato.telefone),
      processo: contato.processo || processoDoCard(card),
      observacoes: contato.observacoes || "",
      contatoId: contato.id,
    });
  }

  async function salvarCadastroRapido() {
    if (!cadastro) return;
    setSalvandoContato(true);
    try {
      const payload = {
        nome: cadastro.nome,
        telefone: cadastro.telefone,
        processo: cadastro.processo,
        observacoes: cadastro.observacoes,
      };
      const contato = cadastro.contatoId
        ? await api.put<Contact>(`/contacts/${cadastro.contatoId}`, payload)
        : await api.post<Contact>("/contacts", payload);
      setContatoOverrides((prev) => ({ ...prev, [cadastro.card.cardId]: contato }));
      show(cadastro.contatoId ? "Contato atualizado." : "Contato cadastrado.", "success");
      setCadastro(null);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar contato.", "error");
    } finally {
      setSalvandoContato(false);
    }
  }

  function abrirEdicaoNome(card: CardViewModel) {
    setEdicaoNome({ card, nome: nomeEfetivo(card) });
  }

  function salvarEdicaoNome() {
    if (!edicaoNome || !edicaoNome.nome.trim()) return;
    setNomeOverrides((prev) => ({ ...prev, [edicaoNome.card.cardId]: edicaoNome.nome.trim() }));
    setEdicaoNome(null);
  }

  function abrirEdicaoPericia(card: CardViewModel, index: number) {
    const pericias = periciasEfetivas(card);
    setEdicaoPericia({ card, index, pericia: { ...pericias[index] } });
  }

  function salvarEdicaoPericia() {
    if (!edicaoPericia) return;
    const { card, index, pericia } = edicaoPericia;
    const atuais = periciasEfetivas(card);
    const atualizadas = atuais.map((p, i) => (i === index ? pericia : p));
    setPericiasOverrides((prev) => ({ ...prev, [card.cardId]: atualizadas }));
    setEdicaoPericia(null);
  }

  async function abrirPreview(card: CardViewModel) {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    const contato = contatoEfetivo(card);
    if (!contato) {
      show("Cadastre o contato deste cliente antes de enviar.", "error");
      return;
    }
    const modo = modoEfetivo(card);
    const cardComOverrides = cardEfetivo(card);

    if (modo !== "template") {
      const pericia = cardComOverrides.pericias[0];
      if (!pericia) {
        show("Nenhuma perícia identificada para gerar mensagem.", "error");
        return;
      }
      const mensagemConfigurada = mensagensAudiencia[MODALIDADE_POR_MODO[modo]];
      const mensagem = renderAudienciaLocal(mensagemConfigurada, cardComOverrides.nomeCliente, pericia);
      setPreview({ card: cardComOverrides, mensagens: [mensagem], modo });
      return;
    }

    if (!templateId) {
      show("Selecione um template de mensagem.", "error");
      return;
    }
    try {
      const { mensagens } = await api.post<{ mensagens: string[] }>("/templates/preview", {
        templateId,
        nome: cardComOverrides.nomeCliente,
        pericias: cardComOverrides.pericias,
      });
      setPreview({ card: cardComOverrides, mensagens, modo: "template" });
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao gerar pré-visualização.", "error");
    }
  }

  async function confirmarEnvioIndividual() {
    if (!preview) return;
    const contato = contatoEfetivo(preview.card);
    if (!contato) return;
    if (preview.modo === "template" && !templateId) return;

    setEnviandoCardId(preview.card.cardId);
    setPreview(null);
    try {
      await api.post("/send/single", {
        cardId: preview.card.cardId,
        nomeCliente: preview.card.nomeCliente,
        telefone: contato.telefone,
        contactId: contato.id,
        pericias: preview.card.pericias,
        templateId: preview.modo === "template" ? templateId : undefined,
        modo: preview.modo,
      });
      show(`Mensagem enviada para ${preview.card.nomeCliente}.`, "success");
      // Recarregar cards para refletir possível movimentação no Trello
      carregarCards();
      carregarPanorama();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem.", "error");
    } finally {
      setEnviandoCardId(null);
    }
  }

  const cardsSelecionadosValidos = useMemo(
    () => cardsFiltrados.filter((c) => selecionados.has(c.cardId) && contatoEfetivo(c) && periciasEfetivas(c).length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardsFiltrados, selecionados, contatoOverrides, nomeOverrides, periciasOverrides]
  );

  function abrirConfirmBatch() {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    if (cardsSelecionadosValidos.length === 0) {
      show("Selecione ao menos um card com contato cadastrado.", "error");
      return;
    }
    setBatchConfirm(true);
  }

  async function confirmarBatch() {
    setBatchLoading(true);
    try {
      const items = cardsSelecionadosValidos.map((card) => {
        const contato = contatoEfetivo(card)!;
        const cardComOverrides = cardEfetivo(card);
        return {
          cardId: card.cardId,
          nomeCliente: cardComOverrides.nomeCliente,
          telefone: contato.telefone,
          contactId: contato.id,
          pericias: cardComOverrides.pericias,
          modo: modoEfetivo(card),
        };
      });
      await api.post("/send/batch", {
        items,
        templateId,
        intervalMinSec: intervaloEnvio.min,
        intervalMaxSec: intervaloEnvio.max,
      });
      setBatchConfirm(false);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao iniciar envio em lote.", "error");
    } finally {
      setBatchLoading(false);
    }
  }

  const gruposLembreteBatch = lembreteBatchConfirm
    ? agruparEventosPorDestinatario(lembreteBatchConfirm.eventos)
    : [];
  const pendenciaProcessoAtual = processoLembrete
    ? processoLembrete.pendencias[processoLembrete.indice]
    : null;

  return (
    <div className="space-y-5 md:space-y-6">
      <PageHeader
        title="Dashboard"
        description="Acompanhe os compromissos e pendências do dia, revise os dados do Trello e envie mensagens com segurança."
        actions={<>
          <Badge tone={whatsapp.status === "conectado" ? "success" : "warning"}>
            {whatsapp.status === "conectado" ? (
              <><span className="h-2 w-2 rounded-full bg-accent-500" /> WhatsApp conectado</>
            ) : (
              <><WifiOff className="h-3.5 w-3.5" /> WhatsApp desconectado</>
            )}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              carregarCards();
              carregarPanorama();
            }}
            loading={carregando || carregandoPanorama}
          >
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        </>}
      />

      <section className="surface-panel p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-zinc-950 dark:text-white">Panorama geral</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Situação atual das comunicações e dos últimos sete dias.</p>
          </div>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => navigate("/pendentes")}>
            Ver pendências <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
          <PanoramaItem icon={<MessageSquareReply />} label="Aguardando resposta" value={visaoGeral.aguardandoResposta} tone="accent" />
          <PanoramaItem icon={<CheckCheck />} label="Entregues, sem retorno" value={visaoGeral.entreguesAguardando} tone="warning" />
          <PanoramaItem icon={<Send />} label="Envios em 7 dias" value={visaoGeral.enviosRecentes} tone="info" />
          <PanoramaItem icon={<AlertTriangle />} label="Falhas em 7 dias" value={visaoGeral.falhasRecentes} tone="danger" />
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <StatCard layout="inline" icon={<Clock3 />} label="Pendentes" value={resumo.pendentes} tone="warning" helper="Ainda não enviados" />
        <StatCard layout="inline" icon={<ShieldCheck />} label="Prontos" value={resumo.prontos} tone="accent" helper="Contato e compromisso conferidos" />
        <StatCard layout="inline" icon={<CheckCheck />} label="Enviados" value={resumo.enviados} tone="info" helper="Envios concluídos" />
      </div>

      {lembreteBatchProgress?.ativo && (
        <div className="flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-2.5 text-sm text-accent-700 dark:bg-accent-900/20 dark:text-accent-300">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Enviando lembretes: {lembreteBatchProgress.enviados} de {lembreteBatchProgress.total}
          {lembreteBatchProgress.falhas > 0 && ` · ${lembreteBatchProgress.falhas} falha(s)`}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PainelEventosDashboard
          titulo="Agenda de hoje"
          descricao={`${visaoGeral.hoje.length} ${visaoGeral.hoje.length === 1 ? "compromisso" : "compromissos"} para hoje`}
          eventos={visaoGeral.hoje}
          total={visaoGeral.hoje.length}
          carregando={panorama === null}
          vazio="Nenhum compromisso agendado para hoje."
          somenteHorario
          onVerTudo={() => navigate("/calendario")}
          onEnviarItem={solicitarLembreteIndividual}
          onEnviarTodos={() => abrirConfirmLembreteBatch("hoje")}
          enviandoId={enviandoLembreteId}
          enviandoBatch={Boolean(lembreteBatchProgress?.ativo)}
        />
        <PainelEventosDashboard
          titulo="Próxima data"
          descricao={
            visaoGeral.proximoDiaLabel
              ? `${visaoGeral.proximaData.length} ${visaoGeral.proximaData.length === 1 ? "compromisso" : "compromissos"} em ${visaoGeral.proximoDiaLabel}`
              : "Nenhum compromisso futuro"
          }
          eventos={visaoGeral.proximaData}
          total={visaoGeral.proximaData.length}
          carregando={panorama === null}
          vazio="Nenhum compromisso futuro agendado."
          onVerTudo={() => navigate("/calendario")}
          onEnviarItem={solicitarLembreteIndividual}
          onEnviarTodos={() => abrirConfirmLembreteBatch("proximaData")}
          enviandoId={enviandoLembreteId}
          enviandoBatch={Boolean(lembreteBatchProgress?.ativo)}
        />
        <PainelEventosDashboard
          titulo="Próximos compromissos"
          descricao={`${visaoGeral.totalFuturas} ${visaoGeral.totalFuturas === 1 ? "evento futuro" : "eventos futuros"}`}
          eventos={visaoGeral.futuras}
          total={visaoGeral.totalFuturas}
          carregando={panorama === null}
          vazio="Nenhum compromisso futuro encontrado."
          onVerTudo={() => navigate("/calendario")}
        />
      </section>

      {erro ? (
        <EmptyState
          icon={Inbox}
          title="Não foi possível carregar os cards"
          description={erro}
          action={
            <Button variant="outline" onClick={() => navigate("/configuracoes")}>
              Ir para Configurações
            </Button>
          }
        />
      ) : (
        <>
          <div className="surface-panel p-3 md:p-4">
            <div className="grid grid-cols-2 gap-2 md:hidden">
              <div className="relative col-span-2">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  placeholder="Buscar cliente, processo ou perito…"
                  className="pl-9"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <Select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as FiltroStatus)} className="w-full">
                <option value="todos">Todos os status</option>
                <option value="nao_enviado">Pendentes</option>
                <option value="enviado">Enviados</option>
                <option value="falhou">Falhas</option>
              </Select>
              <Select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as FiltroTipo)} className="w-full">
                <option value="todos">Todos os tipos</option>
                <option value="medica">Perícia médica</option>
                <option value="social">Perícia social</option>
                <option value="audiencia">Audiência</option>
              </Select>
              <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="col-span-2 w-full">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </Select>
            </div>

            <div className="hidden md:block">
              <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_280px]">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Buscar cartões</p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      placeholder="Nome, processo ou profissional/perito…"
                      className="pl-9"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Template de envio</p>
                  <Select value={templateId ?? ""} onChange={(e) => setTemplateId(Number(e.target.value))} className="w-full">
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </Select>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800 xl:flex-row xl:items-center">
                <FiltroRapido
                  label="Situação"
                  options={STATUS_OPTIONS}
                  value={filtroStatus}
                  onChange={(value) => setFiltroStatus(value as FiltroStatus)}
                />
                <div className="hidden h-7 w-px bg-zinc-200 dark:bg-zinc-700 xl:block" />
                <FiltroRapido
                  label="Tipo"
                  options={TIPO_OPTIONS}
                  value={filtroTipo}
                  onChange={(value) => setFiltroTipo(value as FiltroTipo)}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {cardsFiltrados.length} de {cards?.length ?? 0} card(s) exibido(s) · {selecionados.size} selecionado(s)
              </p>
              <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                variant="outline"
                onClick={toggleSelecionarTodos}
                disabled={cardsFiltrados.length === 0 || Boolean(batchProgress)}
              >
                {cardsFiltrados.length > 0 && cardsFiltrados.every((c) => selecionados.has(c.cardId))
                  ? "Desmarcar todos"
                  : "Selecionar todos"}
              </Button>
              <Button className="min-w-0" onClick={abrirConfirmBatch} disabled={selecionados.size === 0 || Boolean(batchProgress)}>
                <Send className="h-4 w-4" /> <span className="truncate">Enviar selecionados ({selecionados.size})</span>
              </Button>
              </div>
            </div>
          </div>

          {batchProgress?.ativo && batchProgress.aguardandoReconexao && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              <WifiOff className="h-4 w-4" /> WhatsApp desconectou — aguardando reconexão para continuar o envio em lote
              automaticamente.
            </div>
          )}
          {batchProgress?.ativo && !batchProgress.aguardandoReconexao && (
            <div className="flex items-center gap-2 rounded-xl bg-accent-50 px-4 py-2.5 text-sm text-accent-700 dark:bg-accent-900/20 dark:text-accent-300">
              <RefreshCw className="h-4 w-4 animate-spin" /> Enviando em lote… acompanhe os status atualizando em tempo real.
            </div>
          )}

          {cards === null ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          ) : cardsFiltrados.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={cards.length === 0 ? "Nenhum card encontrado na lista" : "Nenhum card corresponde aos filtros"}
              description={
                cards.length === 0
                  ? "Verifique se a lista configurada tem cards ou ajuste a lista em Configurações."
                  : "Tente ajustar a busca ou os filtros aplicados."
              }
            />
          ) : (
            <div className="space-y-3">
              {cardsFiltrados.map((card) => (
                <CardItem
                  key={card.cardId}
                  card={cardEfetivo(card)}
                  selecionado={selecionados.has(card.cardId)}
                  onToggleSelecionar={() => toggleSelecionado(card.cardId)}
                  contatoEfetivo={contatoEfetivo(card)}
                  criterioContato={criterioContatoEfetivo(card)}
                  onEnviar={() => abrirPreview(card)}
                  onCadastrarContato={() => abrirCadastro(card)}
                  onEditarContato={() => abrirEdicaoContato(card)}
                  onEditarNome={() => abrirEdicaoNome(card)}
                  onEditarPericia={(index) => abrirEdicaoPericia(card, index)}
                  onUsarSugestao={() => usarSugestao(card)}
                  enviando={enviandoCardId === card.cardId}
                  temAudiencia={temAudiencia(card)}
                  modo={modoEfetivo(card)}
                  onChangeModo={(modo) => setModoOverrides((prev) => ({ ...prev, [card.cardId]: modo }))}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={`Confirmar envio para ${preview?.card.nomeCliente ?? ""}`}
        maxWidth="max-w-xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarEnvioIndividual}>
              <Send className="h-4 w-4" /> Confirmar envio
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {preview?.mensagens.map((msg, i) => (
            <div
              key={i}
              className="whitespace-pre-wrap rounded-2xl rounded-tl-none bg-accent-50 px-4 py-3 text-sm text-zinc-800 dark:bg-accent-900/20 dark:text-zinc-200"
            >
              {msg}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        open={batchConfirm}
        onClose={() => setBatchConfirm(false)}
        title="Confirmar envio em lote"
        description={`${cardsSelecionadosValidos.length} mensagem(ns) será(ão) enviada(s), com intervalo aleatório entre elas.`}
        footer={
          <>
            <Button variant="outline" onClick={() => setBatchConfirm(false)}>
              Cancelar
            </Button>
            <Button onClick={confirmarBatch} loading={batchLoading}>
              <Send className="h-4 w-4" /> Iniciar envio
            </Button>
          </>
        }
      >
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-300">
          {cardsSelecionadosValidos.map((c) => (
            <li key={c.cardId} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              <span>{nomeEfetivo(c)}</span>
              <span className="text-xs text-zinc-400">{periciasEfetivas(c).length} perícia(s)</span>
            </li>
          ))}
        </ul>
        {selecionados.size > cardsSelecionadosValidos.length && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-500">
            {selecionados.size - cardsSelecionadosValidos.length} card(s) selecionado(s) foram ignorados por não terem contato
            cadastrado ou perícia identificada.
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(processoLembrete)}
        onClose={() => setProcessoLembrete(null)}
        title="Informe o número do processo"
        description="Esse dado é necessário para confirmar com segurança o contato da agenda. Após salvar, o envio continuará do ponto em que parou."
        footer={
          <>
            <Button variant="outline" onClick={() => setProcessoLembrete(null)} disabled={salvandoProcessoLembrete}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarProcessoLembrete}
              loading={salvandoProcessoLembrete}
              disabled={!processoLembrete?.valor.trim()}
            >
              Salvar e continuar
            </Button>
          </>
        }
      >
        {processoLembrete && pendenciaProcessoAtual && (
          <div className="space-y-4">
            {processoLembrete.pendencias.length > 1 && (
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Contato {processoLembrete.indice + 1} de {processoLembrete.pendencias.length}
              </p>
            )}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-800/50">
              <p className="font-medium text-zinc-950 dark:text-white">{pendenciaProcessoAtual.contato.nome}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {formatPhoneDisplay(pendenciaProcessoAtual.contato.telefone)}
              </p>
            </div>
            <div>
              <Label>Número do processo</Label>
              <Input
                autoFocus
                value={processoLembrete.valor}
                onChange={(e) => setProcessoLembrete({ ...processoLembrete, valor: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && processoLembrete.valor.trim() && !salvandoProcessoLembrete) {
                    confirmarProcessoLembrete();
                  }
                }}
                placeholder="Ex: 0000000-00.2026.0.00.0000"
              />
              <p className="mt-1 text-xs text-zinc-400">
                O processo será salvo no contato e no compromisso para os próximos lembretes.
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(lembreteBatchConfirm)}
        onClose={() => setLembreteBatchConfirm(null)}
        title={`Enviar lembrete para ${gruposLembreteBatch.length} cliente(s)?`}
        description={
          lembreteBatchConfirm?.periodo === "hoje"
            ? "Será usada a mensagem de Hoje. Compromissos do mesmo cliente serão reunidos em uma única mensagem."
            : `O sistema escolherá a mensagem de Amanhã ou Data futura conforme a data real do compromisso${visaoGeral.proximoDiaLabel ? ` (${visaoGeral.proximoDiaLabel})` : ""}.`
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setLembreteBatchConfirm(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarLembreteBatch} loading={lembreteBatchLoading}>
              <Send className="h-4 w-4" /> Enviar lembretes
            </Button>
          </>
        }
      >
        <ul className="max-h-64 space-y-1.5 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-300">
          {gruposLembreteBatch.map((grupo) => (
            <li key={grupo[0].id} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
              <span className="min-w-0 truncate">{grupo[0].nome}</span>
              <span className="shrink-0 text-xs text-zinc-400">
                {grupo.length} {grupo.length === 1 ? "compromisso" : "compromissos"}
              </span>
            </li>
          ))}
        </ul>
      </Modal>

      <ConfirmDialog
        open={Boolean(lembreteReenvioConfirm)}
        title="Reenviar lembrete?"
        message={`Este compromisso já recebeu um lembrete. Deseja enviar novamente para ${lembreteReenvioConfirm?.nome || "o cliente"}?`}
        confirmLabel="Reenviar"
        loading={enviandoLembreteId === lembreteReenvioConfirm?.id}
        onConfirm={() => lembreteReenvioConfirm && enviarLembreteIndividual(lembreteReenvioConfirm, true)}
        onCancel={() => setLembreteReenvioConfirm(null)}
      />

      <Modal
        open={Boolean(cadastro)}
        onClose={() => setCadastro(null)}
        title={cadastro?.contatoId ? "Editar contato" : "Cadastrar contato"}
        footer={
          <>
            <Button variant="outline" onClick={() => setCadastro(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarCadastroRapido} loading={salvandoContato} disabled={!cadastro?.telefone.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        {cadastro && (
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={cadastro.telefone}
                onChange={(e) => setCadastro({ ...cadastro, telefone: formatPhoneInput(e.target.value) })}
                placeholder="Ex: (11) 99999-8888"
              />
            </div>
            <div>
              <Label>Número do processo</Label>
              <Input
                value={cadastro.processo}
                onChange={(e) => setCadastro({ ...cadastro, processo: e.target.value })}
                placeholder="Ex: 0000000-00.2026.0.00.0000"
              />
              <p className="mt-1 text-xs text-zinc-400">Confirma o vínculo entre o cartão e o contato da Agenda.</p>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={cadastro.observacoes} onChange={(e) => setCadastro({ ...cadastro, observacoes: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(edicaoNome)}
        onClose={() => setEdicaoNome(null)}
        title="Editar nome do cliente"
        description="Esse é o nome usado na variável {{NOME}} da mensagem enviada."
        footer={
          <>
            <Button variant="outline" onClick={() => setEdicaoNome(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicaoNome} disabled={!edicaoNome?.nome.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        {edicaoNome && (
          <div>
            <Label>Nome</Label>
            <Input value={edicaoNome.nome} onChange={(e) => setEdicaoNome({ ...edicaoNome, nome: e.target.value })} />
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(edicaoPericia)}
        onClose={() => setEdicaoPericia(null)}
        title="Editar informações da perícia"
        description="Esses dados são usados nas variáveis da mensagem enviada."
        footer={
          <>
            <Button variant="outline" onClick={() => setEdicaoPericia(null)}>
              Cancelar
            </Button>
            <Button onClick={salvarEdicaoPericia}>Salvar</Button>
          </>
        }
      >
        {edicaoPericia && (
          <div className="space-y-4">
            <div>
              <Label>Tipo de perícia</Label>
              <Input
                value={edicaoPericia.pericia.tipo}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, tipo: e.target.value } })}
              />
            </div>
            <div>
              <Label>Data</Label>
              <Input
                value={edicaoPericia.pericia.data}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, data: e.target.value } })}
                placeholder="Ex: 15/07/2026"
              />
            </div>
            <div>
              <Label>Horário</Label>
              <Input
                value={edicaoPericia.pericia.horario}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, horario: e.target.value } })}
                placeholder="Ex: 14:30"
              />
            </div>
            <div>
              <Label>Local</Label>
              <Input
                value={edicaoPericia.pericia.local}
                onChange={(e) => setEdicaoPericia({ ...edicaoPericia, pericia: { ...edicaoPericia.pericia, local: e.target.value } })}
              />
            </div>
            <div>
              <Label>Telefone informado no cartão</Label>
              <Input
                value={edicaoPericia.pericia.telefone}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, telefone: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label>WhatsApp</Label>
              <Input
                value={edicaoPericia.pericia.whatsapp || ""}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, whatsapp: e.target.value },
                  })
                }
                placeholder="Ex: SIM"
              />
            </div>
            <div>
              <Label>Número do processo</Label>
              <Input
                value={edicaoPericia.pericia.processo || ""}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, processo: e.target.value },
                  })
                }
                placeholder="Ex: 0000000-00.2026.0.00.0000"
              />
            </div>
            <div>
              <Label>Profissional / Perito</Label>
              <Input
                value={edicaoPericia.pericia.profissionalPerito || ""}
                onChange={(e) =>
                  setEdicaoPericia({
                    ...edicaoPericia,
                    pericia: { ...edicaoPericia.pericia, profissionalPerito: e.target.value },
                  })
                }
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function FiltroRapido({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PainelEventosDashboard({
  titulo,
  descricao,
  eventos,
  total,
  carregando,
  vazio,
  somenteHorario = false,
  onVerTudo,
  onEnviarItem,
  onEnviarTodos,
  enviandoId,
  enviandoBatch,
}: {
  titulo: string;
  descricao: string;
  eventos: PericiaAgendada[];
  total: number;
  carregando: boolean;
  vazio: string;
  somenteHorario?: boolean;
  onVerTudo: () => void;
  /** Quando presente, cada evento ganha um botão individual de "Enviar mensagem". */
  onEnviarItem?: (evento: PericiaAgendada) => void;
  /** Quando presente, o cabeçalho ganha um botão "Enviar todos". */
  onEnviarTodos?: () => void;
  enviandoId?: number | null;
  enviandoBatch?: boolean;
}) {
  const [expandido, setExpandido] = useState(false);
  const limiteInicial = 3;
  const eventosVisiveis = expandido ? eventos : eventos.slice(0, limiteInicial);

  return (
    <div className="surface-panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3.5 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-zinc-950 dark:text-white">{titulo}</h2>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{descricao}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onEnviarTodos && (
            <Button
              variant="outline"
              size="icon"
              onClick={onEnviarTodos}
              disabled={eventos.length === 0 || eventos.every((evento) => Boolean(evento.ultimo_lembrete_em)) || enviandoBatch}
              title="Enviar todos"
              aria-label="Enviar lembretes para todos"
            >
              <Send className="h-3.5 w-3.5" />
              <span className="sr-only">Enviar lembretes para todos</span>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onVerTudo} title="Ver calendário" aria-label="Ver calendário">
            <ArrowRight className="h-3.5 w-3.5" />
            <span className="sr-only">Ver calendário</span>
          </Button>
        </div>
      </div>

      {carregando ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
        </div>
      ) : eventos.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
          <CalendarDays className="h-6 w-6 text-zinc-300 dark:text-zinc-700" />
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{vazio}</p>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-zinc-100 dark:divide-zinc-800">
          {eventosVisiveis.map((evento) => {
            const tipo = classificarEvento(evento);
            const jaEnviado = Boolean(evento.ultimo_lembrete_em);
            return (
              <article key={evento.id} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl",
                      classesIconeEventoDashboard(tipo.categoria)
                    )}
                  >
                    {tipo.categoria === "audiencia_online" ? (
                      <Video className="h-4 w-4" />
                    ) : tipo.audiencia ? (
                      <Gavel className="h-4 w-4" />
                    ) : (
                      <CalendarDays className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        {somenteHorario
                          ? evento.horario || "Sem horário"
                          : `${evento.data}${evento.horario ? ` às ${evento.horario}` : ""}`}
                      </span>
                      <Badge tone={toneEventoDashboard(tipo.categoria)} className="px-2 py-0.5">
                        {tipo.rotulo}
                      </Badge>
                      {jaEnviado && (
                        <Badge tone="accent" className="px-2 py-0.5">
                          <CheckCheck className="h-3 w-3" /> Lembrete enviado
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 break-words text-sm font-medium text-zinc-950 dark:text-white">{evento.nome}</p>
                    {evento.local && (
                      <p className="mt-0.5 flex items-start gap-1 text-xs text-zinc-500 dark:text-zinc-400" title={evento.local}>
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> <span className="line-clamp-2">{evento.local}</span>
                      </p>
                    )}
                  </div>
                </div>
                {onEnviarItem && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEnviarItem(evento)}
                      loading={enviandoId === evento.id}
                      disabled={enviandoBatch}
                    >
                      <Send className="h-3.5 w-3.5" /> {jaEnviado ? "Reenviar" : "Enviar"}
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
          {eventos.length > limiteInicial && (
            <button
              type="button"
              onClick={() => setExpandido((valor) => !valor)}
              className="flex w-full items-center justify-center gap-1 px-4 py-3 text-xs font-medium text-accent-700 hover:bg-accent-50/60 dark:text-accent-300 dark:hover:bg-accent-900/20"
            >
              {expandido ? (
                <><ChevronUp className="h-3.5 w-3.5" /> Mostrar menos</>
              ) : (
                <><ChevronDown className="h-3.5 w-3.5" /> Mostrar mais {eventos.length - limiteInicial}</>
              )}
            </button>
          )}
          {total > eventos.length && (
            <button type="button" onClick={onVerTudo} className="w-full px-4 py-3 text-left text-xs font-medium text-accent-700 hover:bg-accent-50/60 dark:text-accent-300 dark:hover:bg-accent-900/20">
              +{total - eventos.length} compromisso(s) no calendário
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PanoramaItem({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "accent" | "warning" | "info" | "danger";
}) {
  const tons = {
    accent: "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    info: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    danger: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  };

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
      <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&>svg]:h-4 [&>svg]:w-4", tons[tone])}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-lg font-bold tabular-nums text-zinc-950 dark:text-white">{value}</p>
        <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:text-xs">{label}</p>
      </div>
    </div>
  );
}
