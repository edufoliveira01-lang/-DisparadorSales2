import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { createInFlightGuard } from "@/lib/inFlightGuard";
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
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";
import { useBatchProgress } from "@/context/BatchProgressContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { DispatchCard } from "@/components/DispatchCard";
import { Checkbox } from "@/components/ui/Checkbox";
import { WorkspacePanel } from "@/components/ui/Workspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/context/AuthContext";

const PANORAMA_EVENTS = [
  "send:update", "send:ack-update", "pendingReply:ack-update", "pendingReply:resolved",
  "lembrete:sent", "lembrete:update", "lembrete:batch-completed", "lembrete:batch-paused",
  "send:batch-completed", "send:batch-paused", "dashboard:changed",
] as const;
const CARDS_EVENTS = ["send:batch-completed", "dashboard:changed"] as const;

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

interface PendenciaTelefoneLembrete {
  ids: number[];
  nome: string;
  processo: string;
}

type RetomadaLembrete =
  | { tipo: "individual"; pericia: PericiaAgendada; forcar: boolean }
  | { tipo: "lote"; periodo: "hoje" | "proximaData"; eventos: PericiaAgendada[] };

interface FluxoProcessoLembrete {
  pendencias: PendenciaProcessoLembrete[];
  indice: number;
  valor: string;
  retomada: RetomadaLembrete;
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
  const { can } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();
  const [agendaTab, setAgendaTab] = useState(0);

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
  const [intervaloEnvio, setIntervaloEnvio] = useState({ min: 5, max: 15 });
  const [enviandoCardId, setEnviandoCardId] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");

  const [preview, setPreview] = useState<{ card: CardViewModel; mensagens: string[]; modo: ModoEnvio } | null>(null);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const { lotes } = useBatchProgress();
  const batchProgress = lotes.find((lote) => lote.tipo === "mensagens");
  const lembreteBatchProgress = lotes.find((lote) => lote.tipo === "lembretes");

  const [enviandoLembreteId, setEnviandoLembreteId] = useState<number | null>(null);
  const envioLembreteGuard = useRef(createInFlightGuard<number>()).current;
  const [lembreteReenvioConfirm, setLembreteReenvioConfirm] = useState<PericiaAgendada | null>(null);
  const [lembreteBatchConfirm, setLembreteBatchConfirm] = useState<{ periodo: "hoje" | "proximaData"; eventos: PericiaAgendada[] } | null>(
    null
  );
  const [lembreteBatchLoading, setLembreteBatchLoading] = useState(false);
  const [processoLembrete, setProcessoLembrete] = useState<FluxoProcessoLembrete | null>(null);
  const [salvandoProcessoLembrete, setSalvandoProcessoLembrete] = useState(false);
  const [telefoneLembrete, setTelefoneLembrete] = useState<{
    pendencia: PendenciaTelefoneLembrete;
    retomada: RetomadaLembrete;
    valor: string;
  } | null>(null);
  const [salvandoTelefoneLembrete, setSalvandoTelefoneLembrete] = useState(false);
  const telefoneLembreteGuard = useRef(createInFlightGuard<number>()).current;

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

  const carregarCards = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    if (!silencioso) setErro(null);
    try {
      const data = await api.get<CardViewModel[]>("/cards");
      setCards(data);
    } catch (err) {
      if (!silencioso) {
        setCards([]);
        setErro(err instanceof ApiError ? err.message : "Erro ao carregar os cards do Trello.");
      }
    } finally {
      if (!silencioso) setCarregando(false);
    }
  }, []);

  const carregarPanorama = useCallback(async () => {
    setCarregandoPanorama(true);
    try {
      const [pericias, pendentes, logs] = await Promise.all([
        can("calendar.view") ? api.get<PericiaAgendada[]>("/pericias-agendadas") : Promise.resolve([]),
        can("pending.view") ? api.get<PendingReply[]>("/pending-replies") : Promise.resolve([]),
        can("history.view") ? api.get<SendLog[]>("/logs") : Promise.resolve([]),
      ]);
      setPanorama({ pericias, pendentes, logs });
    } catch {
      setPanorama((atual) => atual ?? { pericias: [], pendentes: [], logs: [] });
    } finally {
      setCarregandoPanorama(false);
    }
  }, [can]);

  useEffect(() => {
    carregarCards();
    carregarPanorama();
    if (can("templates.view")) api.get<Template[]>("/templates").then((data) => {
      setTemplates(data);
      if (data.length > 0) setTemplateId((data.find(t => t.padrao) || data[0]).id);
    });
    if (can("integrations.manage")) api.get<Settings>("/settings").then((data) => {
      setIntervaloEnvio({
        min: Number(data.send_interval_min) || 5,
        max: Number(data.send_interval_max) || 15,
      });
    });
  }, [carregarCards, carregarPanorama, can]);

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

  // ACKs, respostas, envios e alterações em outras telas invalidam os totais.
  useRealtimeRefresh(carregarPanorama, PANORAMA_EVENTS);
  const atualizarCardsEmSegundoPlano = useCallback(() => carregarCards(true), [carregarCards]);
  useRealtimeRefresh(atualizarCardsEmSegundoPlano, CARDS_EVENTS, 60000);
  useSocketEvent("send:batch-completed", () => setSelecionados(new Set()));

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

  function iniciarFluxoProcesso(pendencias: PendenciaProcessoLembrete[], retomada: RetomadaLembrete) {
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

  function abrirTelefoneDoErro(err: unknown, retomada: RetomadaLembrete): boolean {
    if (!(err instanceof ApiError) || err.data?.code !== "TELEFONE_NAO_INFORMADO") return false;
    const pendencia = err.data.pendencia as PendenciaTelefoneLembrete | undefined;
    if (!pendencia || !Array.isArray(pendencia.ids) || !pendencia.nome) return false;
    setLembreteReenvioConfirm(null);
    setLembreteBatchConfirm(null);
    setTelefoneLembrete({ pendencia, retomada, valor: "" });
    return true;
  }

  async function validarEConfirmarLote(periodo: "hoje" | "proximaData", eventos: PericiaAgendada[]) {
    const validacao = await api.post<{
      pendencias: PendenciaProcessoLembrete[];
      telefonesPendentes?: PendenciaTelefoneLembrete[];
      eventos?: PericiaAgendada[];
    }>("/pericias-agendadas/validar-lembretes", { ids: eventos.map(evento => evento.id) });
    const retomada: RetomadaLembrete = { tipo: "lote", periodo, eventos };
    if (validacao.pendencias.length) {
      iniciarFluxoProcesso(validacao.pendencias, retomada);
    } else if (validacao.telefonesPendentes?.length) {
      setTelefoneLembrete({ pendencia: validacao.telefonesPendentes[0], retomada, valor: "" });
    } else {
      setLembreteBatchConfirm({ periodo, eventos: validacao.eventos || eventos });
    }
  }

  async function continuarLembrete(retomada: RetomadaLembrete) {
    if (retomada.tipo === "individual") await enviarLembreteIndividual(retomada.pericia, retomada.forcar);
    else await validarEConfirmarLote(retomada.periodo, retomada.eventos);
  }

  async function confirmarTelefoneLembrete() {
    if (!telefoneLembrete) return;
    const id = telefoneLembrete.pendencia.ids[0];
    if (!telefoneLembreteGuard.tryStart(id)) return;
    setSalvandoTelefoneLembrete(true);
    try {
      await api.post("/pericias-agendadas/completar-telefone", {
        ids: telefoneLembrete.pendencia.ids,
        telefone: telefoneLembrete.valor.trim(),
      });
      const retomada = telefoneLembrete.retomada;
      setTelefoneLembrete(null);
      carregarPanorama();
      await continuarLembrete(retomada);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar o telefone.", "error");
    } finally {
      telefoneLembreteGuard.finish(id);
      setSalvandoTelefoneLembrete(false);
    }
  }

  async function enviarLembreteIndividual(pericia: PericiaAgendada, forcar = false) {
    if (whatsapp.status !== "conectado") {
      show("Conecte o WhatsApp antes de enviar mensagens.", "error");
      navigate("/configuracoes");
      return;
    }
    // useState só desabilita o botão no próximo render. A trava síncrona impede que um clique
    // duplo crie duas requisições antes disso e faça a segunda exibir um falso erro de conflito.
    if (!envioLembreteGuard.tryStart(pericia.id)) return;
    setEnviandoLembreteId(pericia.id);
    try {
      await api.post(`/pericias-agendadas/${pericia.id}/lembrete`, { forcar });
      show(`${forcar ? "Novo lembrete" : "Lembrete"} enviado para ${pericia.nome}.`, "success");
      setLembreteReenvioConfirm(null);
      carregarPanorama();
    } catch (err) {
      if (abrirTelefoneDoErro(err, { tipo: "individual", pericia, forcar })) return;
      const pendencia = pendenciaProcessoDoErro(err);
      if (pendencia) {
        setLembreteReenvioConfirm(null);
        iniciarFluxoProcesso([pendencia], { tipo: "individual", pericia, forcar });
      } else {
        if (err instanceof ApiError && err.data?.code === "LEMBRETE_EM_ANDAMENTO") {
          show("O lembrete já está sendo processado. Aguarde a conclusão.", "info");
        } else {
          show(err instanceof ApiError ? err.message : "Erro ao enviar lembrete.", "error");
        }
      }
    } finally {
      envioLembreteGuard.finish(pericia.id);
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
      await validarEConfirmarLote(periodo, eventos);
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

      carregarPanorama();
      await continuarLembrete(retomada);
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
      setLembreteBatchConfirm(null);
    } catch (err) {
      const retomada: RetomadaLembrete = { tipo: "lote", ...lembreteBatchConfirm };
      if (abrirTelefoneDoErro(err, retomada)) return;
      const pendencia = pendenciaProcessoDoErro(err);
      if (pendencia) {
        setLembreteBatchConfirm(null);
        iniciarFluxoProcesso([pendencia], retomada);
        return;
      }
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

    if (modo === "template" && !templateId) {
      show("Selecione um template de mensagem.", "error");
      return;
    }
    try {
      const { mensagens } = await api.post<{ mensagens: string[] }>("/send/preview", {
        templateId,
        cardId: cardComOverrides.cardId,
        telefone: contato.telefone,
        modo,
        nomeCliente: cardComOverrides.nomeCliente,
        pericias: cardComOverrides.pericias,
      });
      setPreview({ card: cardComOverrides, mensagens, modo });
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
    <div className="space-y-5">
      <PageHeader
        title="Perícias e compromissos"
        description="A agenda do dia e os avisos aos clientes: confira os dados de cada compromisso e envie o aviso pelo WhatsApp."
        actions={<>
          <Badge tone={whatsapp.status === "conectado" ? "success" : "warning"} className="sm:hidden">
            {whatsapp.status === "conectado" ? (
              <><span className="h-2 w-2 rounded-full bg-emerald-500" /> WhatsApp conectado</>
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


      <div className="overview-layout">
        <div className="overview-work">
      {erro ? <EmptyState icon={Inbox} title="Não foi possível carregar os cards" description={erro} action={can("integrations.manage") ? <Button variant="outline" onClick={() => navigate("/configuracoes")}>Ir para Configurações</Button> : undefined} /> : (
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {([["todos", "Todos os avisos", cards?.length ?? 0, `${resumo.prontos} prontos para avisar`], ["nao_enviado", "Para enviar", resumo.pendentes, ""], ["enviado", "Enviados", resumo.enviados, ""], ["falhou", "Com falha", (cards ?? []).filter((c) => c.ultimoEnvio?.status === "falha").length, ""]] as [FiltroStatus, string, number, string][]).map(([k, rotulo, n, ajuda]) => (
              <button key={k} type="button" onClick={() => setFiltroStatus(filtroStatus === k && k !== "todos" ? "todos" : k)} aria-pressed={filtroStatus === k}
                className={`rounded-2xl border p-4 text-left transition ${filtroStatus === k ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"} ${k === "falhou" && n > 0 && filtroStatus !== k ? "border-red-300 dark:border-red-800" : ""}`}>
                <span className={`block text-2xl font-semibold leading-none ${k === "falhou" && n > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{n}</span>
                <span className="mt-1.5 block text-xs text-zinc-500">{rotulo}</span>
                {ajuda && <span className="mt-0.5 block text-[11px] text-zinc-400">{ajuda}</span>}
              </button>))}
            {can("pending.view") && <button type="button" onClick={() => navigate("/pendentes")} className="rounded-2xl border border-accent-200 bg-accent-50 p-4 text-left transition hover:border-accent-500 dark:border-accent-800 dark:bg-accent-500/10">
              <span className="block text-2xl font-semibold leading-none text-accent-700 dark:text-accent-200">{visaoGeral.aguardandoResposta}</span>
              <span className="mt-1.5 flex items-center justify-between text-xs text-accent-800 dark:text-accent-200">Aguardando retorno <ArrowRight className="h-3.5 w-3.5" /></span>
            </button>}
          </div>

          <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_170px_220px]">
              <div className="relative sm:col-span-2 xl:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input aria-label="Buscar avisos" placeholder="Buscar cliente, processo ou perito…" className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} /></div>
              <Select aria-label="Tipo de compromisso" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as FiltroTipo)}>{[["todos", "Todos os tipos"], ["medica", "Perícia médica"], ["social", "Perícia social"], ["audiencia", "Audiência"]].map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select>
              <Select aria-label="Modelo de mensagem" value={templateId ?? ""} onChange={e => setTemplateId(Number(e.target.value))}>{templates.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}</Select>
            </div>
            {can("messages.send") && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={cardsFiltrados.length > 0 && cardsFiltrados.every(c => selecionados.has(c.cardId))} onChange={toggleSelecionarTodos} /> Marcar todos os {cardsFiltrados.length} exibidos{selecionados.size > 0 ? ` · ${selecionados.size} marcado(s)` : ""}</label>
              <Button size="sm" onClick={abrirConfirmBatch} disabled={selecionados.size === 0 || Boolean(batchProgress)}><Send className="h-3.5 w-3.5" /> Enviar selecionados ({selecionados.size})</Button>
            </div>}
          </div>

          {cards === null ? <div className="grid gap-4 p-4 lg:grid-cols-2">{Array.from({length: 4}).map((_, index) => <Skeleton key={index} className="h-64" />)}</div> : cardsFiltrados.length === 0 ? <EmptyState icon={Inbox} title={cards.length === 0 ? "Nenhum aviso para preparar" : "Nenhum aviso corresponde aos filtros"} description={cards.length === 0 ? "Confira a lista do Trello em Configurações." : "Tente ajustar a busca ou os filtros."} /> : (
            <div className="space-y-3">
              {cardsFiltrados.map((card) => (
                <DispatchCard
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
          <p className="text-right text-xs text-zinc-500">{cardsFiltrados.length} de {cards?.length ?? 0} avisos · usam os dados do Trello e os contatos deste serviço; confira antes de enviar.</p>
        </div>
      )}
        </div><aside className="day-rail" aria-label="Sua agenda e retornos">
          <div className="day-rail-heading"><span className="eyebrow">No seu radar</span><p>{new Intl.DateTimeFormat("pt-BR",{weekday:"long",day:"numeric",month:"long",timeZone:"America/Sao_Paulo"}).format(new Date())}</p><button type="button" onClick={() => navigate("/calendario")} aria-label="Abrir calendário completo"><CalendarDays className="h-5 w-5" /></button></div>
          <div className="agenda-switch" role="tablist" aria-label="Período dos compromissos">{["Hoje","Próxima data","Depois"].map((label,index)=><button key={label} type="button" role="tab" aria-selected={agendaTab===index} onClick={()=>setAgendaTab(index)}>{label}</button>)}</div>
          <div key={agendaTab} className="agenda-stage" role="tabpanel" aria-label={["Hoje","Próxima data","Depois"][agendaTab]}>{agendaTab === 0 && (<PainelEventosDashboard
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
          enviandoBatch={Boolean(lembreteBatchProgress)}
        />)}{agendaTab === 1 && (<PainelEventosDashboard
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
          enviandoBatch={Boolean(lembreteBatchProgress)}
        />)}{agendaTab === 2 && (<PainelEventosDashboard
          titulo="Próximos compromissos"
          descricao={`${visaoGeral.totalFuturas} ${visaoGeral.totalFuturas === 1 ? "evento futuro" : "eventos futuros"}`}
          eventos={visaoGeral.futuras}
          total={visaoGeral.totalFuturas}
          carregando={panorama === null}
          vazio="Nenhum compromisso futuro encontrado."
          onVerTudo={() => navigate("/calendario")}
          onEnviarItem={solicitarLembreteIndividual}
          enviandoId={enviandoLembreteId}
          enviandoBatch={Boolean(lembreteBatchProgress)}
          expandirLocalmente={false}
        />)}</div>

          <div className="rail-note"><span className="eyebrow">Últimos sete dias</span><div><span>Mensagens enviadas</span><strong>{visaoGeral.enviosRecentes}</strong></div><div><span>Falhas para revisar</span><strong>{visaoGeral.falhasRecentes}</strong></div><div><span>Entregues sem retorno</span><strong>{visaoGeral.entreguesAguardando}</strong></div></div>
        </aside>
      </div>

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
        open={Boolean(telefoneLembrete)}
        onClose={() => { if (!salvandoTelefoneLembrete) setTelefoneLembrete(null); }}
        title="Informe o telefone do cliente"
        description="Este compromisso está sem telefone válido. Informe o número com DDD para continuar o lembrete."
        footer={<>
          <Button variant="outline" onClick={() => setTelefoneLembrete(null)} disabled={salvandoTelefoneLembrete}>Cancelar</Button>
          <Button onClick={confirmarTelefoneLembrete} loading={salvandoTelefoneLembrete} disabled={!telefoneLembrete?.valor.trim()}>Salvar e continuar</Button>
        </>}
      >
        {telefoneLembrete && <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="font-medium text-zinc-950 dark:text-white">{telefoneLembrete.pendencia.nome}</p>
            {telefoneLembrete.pendencia.processo && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Processo: {telefoneLembrete.pendencia.processo}</p>}
          </div>
          <div>
            <Label htmlFor="telefone-lembrete">Telefone com DDD</Label>
            <Input id="telefone-lembrete" autoFocus type="tel" autoComplete="tel" placeholder="(11) 99999-9999"
              value={telefoneLembrete.valor}
              disabled={salvandoTelefoneLembrete}
              onChange={e => setTelefoneLembrete({ ...telefoneLembrete, valor: e.target.value })}
              onKeyDown={e => { if (e.key === "Enter" && telefoneLembrete.valor.trim()) confirmarTelefoneLembrete(); }} />
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">O telefone será salvo no compromisso para os próximos lembretes.</p>
          </div>
        </div>}
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
  expandirLocalmente = true,
}: {
  titulo: string;
  descricao: string;
  eventos: PericiaAgendada[];
  total: number;
  carregando: boolean;
  vazio: string;
  somenteHorario?: boolean;
  onVerTudo: () => void;
  /** Quando presente, cada evento ganha um botão individual de "Lembrete". */
  onEnviarItem?: (evento: PericiaAgendada) => void;
  /** Quando presente, o painel ganha a ação "Lembrar todos". */
  onEnviarTodos?: () => void;
  enviandoId?: number | null;
  enviandoBatch?: boolean;
  /** Quando falso, mantém o painel compacto e usa a ação inferior para abrir o Calendário. */
  expandirLocalmente?: boolean;
}) {
  const { can } = useAuth();
  const [expandido, setExpandido] = useState(false);
  const limiteInicial = 3;
  const eventosVisiveis =
    expandirLocalmente && expandido ? eventos : eventos.slice(0, limiteInicial);

  return (
    <section className="surface-panel h-full p-5">
      <div className="flex h-5 items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold leading-[20.15px] text-zinc-900 dark:text-zinc-100">
          <CalendarDays className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-300" />
          <span className="truncate">{titulo}</span>
        </h2>
        {can("calendar.view") && <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={onVerTudo}
          title="Ver calendário"
          aria-label="Ver calendário"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>}
      </div>
      <p className="mt-[5px] text-xs leading-relaxed text-zinc-400 dark:text-zinc-400">
        {descricao}
      </p>

      {carregando ? (
        <div className="mt-[13px] space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : eventos.length === 0 ? (
        <div className="py-[27px] text-center">
          <CalendarDays className="mx-auto h-5 w-5 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-400">
            {vazio}
          </p>
        </div>
      ) : (
        <div className="mt-[13px] space-y-3">
          {eventosVisiveis.map((evento) => {
            const tipo = classificarEvento(evento);
            const jaEnviado = Boolean(evento.ultimo_lembrete_em);
            return (
              <article
                key={evento.id}
                className="border-t border-zinc-100 pt-3 dark:border-zinc-800"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex shrink-0 rounded-md p-0.5",
                      classesIconeEventoDashboard(tipo.categoria),
                    )}
                  >
                    {tipo.categoria === "audiencia_online" ? (
                      <Video className="h-3.5 w-3.5" />
                    ) : tipo.audiencia ? (
                      <Gavel className="h-3.5 w-3.5" />
                    ) : (
                      <CalendarDays className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <p className="break-words text-xs font-[550] leading-[18.6px] text-zinc-900 dark:text-zinc-100">
                    {evento.nome}
                  </p>
                </div>
                <div className="mb-[9px] mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs leading-relaxed text-zinc-400 dark:text-zinc-400">
                  <span>
                    {tipo.rotulo} · {evento.data}
                    {evento.horario ? ` · ${evento.horario}` : " · Sem horário"}
                  </span>
                  {jaEnviado && (
                    <Badge tone="accent">
                      <CheckCheck className="h-3 w-3" /> Lembrete enviado
                    </Badge>
                  )}
                </div>
                {evento.local && (
                  <p className="mb-[9px] -mt-1 flex items-start gap-1 text-[10px] leading-[15.5px] text-zinc-500 dark:text-zinc-400">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{evento.local}</span>
                  </p>
                )}
                {can("messages.send") && onEnviarItem && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-[29px] px-2"
                    onClick={() => onEnviarItem(evento)}
                    loading={enviandoId === evento.id}
                    disabled={enviandoBatch || enviandoId != null}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {jaEnviado ? "Reenviar lembrete" : "Lembrete"}
                  </Button>
                )}
              </article>
            );
          })}
          {eventos.length > limiteInicial && (
            <button
              type="button"
              onClick={
                expandirLocalmente
                  ? () => setExpandido((valor) => !valor)
                  : onVerTudo
              }
              className="flex items-center gap-1 py-2 text-[10px] text-accent-700 dark:text-accent-300"
            >
              {!expandirLocalmente ? (
                <>
                  <ArrowRight className="h-3.5 w-3.5" />
                  Ver mais no calendário
                </>
              ) : expandido ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Mostrar menos
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Mostrar mais {eventos.length - limiteInicial}
                </>
              )}
            </button>
          )}
          {total > eventos.length && (
            <button
              type="button"
              onClick={onVerTudo}
              className="py-2 text-[10px] text-accent-700 dark:text-accent-300"
            >
              +{total - eventos.length} compromisso(s) no calendário
            </button>
          )}
        </div>
      )}
      {can("messages.send") && onEnviarTodos && eventos.length > 0 && (
        <Button
          variant="outline"
          className="mt-[13px]"
          onClick={onEnviarTodos}
          disabled={
            eventos.length === 0 ||
            eventos.every((evento) => Boolean(evento.ultimo_lembrete_em)) ||
            enviandoBatch ||
            enviandoId != null
          }
        >
          <Send className="h-3.5 w-3.5" />
          Lembrar todos
        </Button>
      )}
    </section>
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
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 sm:truncate sm:text-xs">{label}</p>
      </div>
    </div>
  );
}

