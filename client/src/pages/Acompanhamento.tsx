import { ContactPicker } from "@/components/djen/ContactPicker";
import { MultiSelect } from "@/components/ui/MultiSelect";
import {
  DjenDocumentos,
  DjenPrazos,
  DjenHistorico,
  type Prazo,
  type Documento,
  type Evento,
} from "@/components/djen/Workflow";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Scale,
  Gavel,
  Stethoscope,
  FileCheck2,
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Send,
  CheckCheck,
  BriefcaseBusiness,
  Settings2,
  AlertCircle,
  FolderOpen,
  Sparkles,
  Banknote,
  Handshake,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/phone";
import type { Contact } from "@/lib/types";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";

const TIPOS = {
  sentenca: "Sentença de mérito",
  acordao: "Acórdão",
  pericia: "Perícia agendada",
  laudo_juntado: "Laudo pericial juntado",
  rpv: "RPV",
  precatorio: "Precatório",
  homologacao_acordo: "Homologação de acordo",
  proposta_acordo: "Proposta de acordo",
  extincao_execucao: "Extinção da execução",
  extincao_processo: "Extinção sem mérito",
  cumprimento_sentenca: "Cumprimento de sentença",
  levantamento_valores: "Levantamento de valores",
  decisao_interlocutoria: "Decisão interlocutória",
  despacho: "Despacho",
  intimacao: "Intimação",
};
const FILTROS = { ...TIPOS, outros: "Outros" };
type Categoria = keyof typeof TIPOS;
const RESULTADOS = {
  nao_identificado: "Resultado não identificado",
  procedente: "Procedente",
  improcedente: "Improcedente",
  parcial: "Parcialmente procedente",
};
type Resultado = keyof typeof RESULTADOS;
interface Advogado {
  id: number;
  nome: string;
  numero_oab: string;
  uf_oab: string;
  modo_busca: "ambos" | "oab" | "nome";
  ativo: number;
  ultimo_sucesso_em: string | null;
  ultimo_erro: string | null;
  correspondencia?: string;
}
interface Publicacao {
  id: number;
  comunicacao_id: string;
  processo: string;
  tribunal: string;
  orgao: string;
  classe: string;
  tipo_documento: string;
  tipo_comunicacao: string;
  data_disponibilizacao: string;
  resumo: string;
  situacao: string;
  proximo_prazo: string | null;
  prazos_abertos: number;
  prazos?: Prazo[];
  documentos?: Documento[];
  historico?: Evento[];
  relacionadas_total?: number;
  andamentos_total?: number;
  andamentos_nao_lidos?: number;
  pericia_publicacao_id?: number | null;
  ia_status: string;
  ia_erro: string | null;
  ia_em: string | null;
  analise: {
    situacao?: string;
    categorias: Categoria[];
    resumo: string;
    justificativa: string;
    alertas: string[];
    agendamento: {
      data: string | null;
      horario: string | null;
      local: string | null;
    };
    providencia?: {
      tipo: "ciencia" | "cumprimento" | "prazo_explicito" | "indeterminado";
      descricao: string | null;
      prazo_texto: string | null;
      responsavel:
        | "escritorio"
        | "cliente"
        | "perito"
        | "outra_parte"
        | "indeterminado";
    };
  } | null;
  texto?: string;
  categorias: Categoria[];
  resultado: Resultado;
  revisada: number;
  lida: number;
  concluida: number;
  ia_manual: number;
  cancelada: number;
  advogados: Advogado[];
  cliente_id: number | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  parte_nome?: string | null;
  cliente_exibicao?: string | null;
  cliente_vinculado?: boolean;
  pericia_controle?: {
    status:
      | "nao_cadastrada"
      | "cadastrada_nao_informada"
      | "duplicidade"
      | "redesignacao"
      | "cadastrada_a_conferir"
      | "dados_incompletos";
    informado: boolean;
    mensagem: string;
    agendamento: {
      data: string | null;
      horario: string | null;
      local: string | null;
    };
    existente?: {
      id: number;
      data: string;
      horario: string | null;
      local: string | null;
    } | null;
  } | null;
  observacoes: string;
  link: string | null;
  certidao_url: string | null;
  evidencias: { categoria: Categoria; trecho: string }[];
  destinatarios?: { nome?: string; polo?: string }[];
  advogados_publicacao?: { nome: string; numero_oab: string; uf_oab: string }[];
  relacionadas?: {
    id: number;
    data_disponibilizacao: string;
    categorias_json: string;
    resultado: string;
    resumo: string | null;
    situacao?: string;
    orgao?: string;
    tipo_documento?: string;
  }[];
  mensagens?: {
    id: number;
    request_id: string;
    cliente_nome: string;
    telefone: string;
    texto: string;
    status: string;
    erro: string | null;
    created_at: string;
  }[];
}
interface PericiaSemLaudo {
  pericia_id: number;
  nome: string;
  processo: string;
  data: string;
  horario: string | null;
  local: string | null;
  dias_decorridos: number;
  acompanhamento_status: "pendente" | "cobrado";
  ultima_cobranca_em: string | null;
  observacoes: string;
}
interface Busca {
  id: number;
  status: string;
  inicio: string;
  fim: string;
  novas: number;
  recebidas: number;
  consultas: number;
  erros_json: string;
  started_at: string;
  finished_at: string | null;
}
interface Status {
  codex: {
    executando: number | null;
    executando_ids: number[];
    simultaneas: number;
    media_segundos: number | null;
    estimativa_segundos: number | null;
    pendentes: number;
    reanalisaveis: number;
    falhas: number;
    pausa: string | null;
    uso_30_dias: {
      chamadas: number;
      cache_hits: number;
      agrupadas: number;
      execucoes_evitadas: number;
      caracteres: number;
      falhas: number;
    };
  };
  executando: number | null;
  proxima_execucao: string | null;
  ultimas: Busca[];
  resumo: Record<string, number>;
  advogados: Advogado[];
  pericias_sem_laudo: number;
  config: {
    automatico: number;
    intervalo_minutos: number;
    janela_inicial_dias: number;
    ia_ativa: number;
    ia_paralelismo: number;
    ia_modo: "economico" | "equilibrado" | "precisao";
  };
}
const hoje = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dia = (s: string) =>
  s ? s.slice(0, 10).split("-").reverse().join("/") : "Não informado";
const seteDias = () => {
  const d = new Date(hoje() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
};
const erro = (e: unknown) =>
  e instanceof ApiError ? e.message : "Não foi possível concluir a operação.";
const tons = {
  sentenca: "accent",
  acordao: "info",
  pericia: "violet",
  laudo_juntado: "warning",
  rpv: "info",
  precatorio: "info",
  homologacao_acordo: "success",
  proposta_acordo: "warning",
  extincao_execucao: "neutral",
  extincao_processo: "neutral",
  cumprimento_sentenca: "accent",
  levantamento_valores: "success",
  decisao_interlocutoria: "violet",
  despacho: "neutral",
  intimacao: "warning",
} as const;
const UFS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  );

export function Acompanhamento() {
  const { pathname } = useLocation(),
    navigate = useNavigate(),
    { show } = useToast(),
    whatsapp = useWhatsapp();
  const secao = pathname.endsWith("/advogados")
    ? "advogados"
    : pathname.endsWith("/monitoramento")
      ? "monitoramento"
      : "publicacoes";
  const [status, setStatus] = useState<Status | null>(null),
    [items, setItems] = useState<Publicacao[]>([]),
    [total, setTotal] = useState(0),
    [carregando, setCarregando] = useState(true),
    [falha, setFalha] = useState("");
  const [filtro, setFiltro] = useState({
      categoria: "",
      resultado: "",
      advogado_id: "",
      situacao: "",
      arquivo: "ativos",
      busca: "",
      pagina: 1,
    }),
    [buscaTexto, setBuscaTexto] = useState("");
  const [consulta, setConsulta] = useState({
      inicio: seteDias(),
      fim: hoje(),
      advogado_id: "",
    }),
    [consultando, setConsultando] = useState(false);
  const [formAdv, setFormAdv] = useState<{
    id?: number;
    nome: string;
    numero_oab: string;
    uf_oab: string;
    modo_busca: "ambos" | "oab" | "nome";
    ativo: boolean;
  } | null>(null);
  const [salvando, setSalvando] = useState(false),
    lock = useRef(false);
  const [config, setConfig] = useState({
    automatico: false,
    intervalo_minutos: 60,
    janela_inicial_dias: 7,
    ia_ativa: false,
    ia_paralelismo: 2,
    ia_modo: "economico" as "economico" | "equilibrado" | "precisao",
  });
  const [conexaoCodex, setConexaoCodex] = useState<{
    conectado: boolean;
    mensagem: string;
  } | null>(null);
  const [revisaoAlterada, setRevisaoAlterada] = useState(false);
  const [situacao, setSituacao] = useState("");
  const [abaDetalhe, setAbaDetalhe] = useState<
    "resumo" | "publicacao" | "prazos" | "cliente" | "historico"
  >("resumo");
  const [detalhe, setDetalhe] = useState<Publicacao | null>(null),
    [contatos, setContatos] = useState<Contact[]>([]),
    [categorias, setCategorias] = useState<Categoria[]>([]),
    [resultado, setResultado] = useState<Resultado>("nao_identificado"),
    [processo, setProcesso] = useState({ cliente_id: "", observacoes: "" });
  const [confirmacaoEnvio, setConfirmacaoEnvio] = useState(false);
  const [mostrarSemLaudo, setMostrarSemLaudo] = useState(false);
  const [periciasSemLaudo, setPericiasSemLaudo] = useState<PericiaSemLaudo[]>([]);
  const [carregandoSemLaudo, setCarregandoSemLaudo] = useState(false);
  const [mensagem, setMensagem] = useState<{
      texto: string;
      request_id: string;
      cliente_id: number;
      cliente_nome: string;
      telefone: string;
    } | null>(null),
    [enviando, setEnviando] = useState(false);
  const seq = useRef(0),
    detailSeq = useRef(0);
  const carregarStatus = useCallback(async () => {
    const data = await api.get<Status>("/djen/status");
    setStatus(data);
    return data;
  }, []);
  const carregarSemLaudo = useCallback(async () => {
    setCarregandoSemLaudo(true);
    try {
      setPericiasSemLaudo(
        await api.get<PericiaSemLaudo[]>("/djen/pericias/sem-laudo?dias=60"),
      );
    } finally {
      setCarregandoSemLaudo(false);
    }
  }, []);
  const carregarLista = useCallback(async () => {
    const current = ++seq.current;
    setCarregando(true);
    try {
      const q = new URLSearchParams(
        Object.fromEntries(
          Object.entries(filtro).map(([k, v]) => [k, String(v)]),
        ),
      );
      const r = await api.get<{ items: Publicacao[]; total: number }>(
        "/djen/publicacoes?" + q,
      );
      if (current === seq.current) {
        const ultimaPagina = Math.max(1, Math.ceil(r.total / 25));
        if (filtro.pagina > ultimaPagina) {
          setFiltro((f) => ({ ...f, pagina: ultimaPagina }));
          return;
        }
        setItems(r.items);
        setTotal(r.total);
        setFalha("");
      }
    } catch (e) {
      if (current === seq.current) setFalha(erro(e));
    } finally {
      if (current === seq.current) setCarregando(false);
    }
  }, [filtro]);
  useEffect(() => {
    void carregarStatus()
      .then((s) =>
        setConfig({
          ...s.config,
          automatico: Boolean(s.config.automatico),
          ia_ativa: Boolean(s.config.ia_ativa),
        }),
      )
      .catch((e) => setFalha(erro(e)));
  }, [carregarStatus]);
  useEffect(() => {
    if (secao === "publicacoes") void carregarLista();
  }, [carregarLista, secao]);
  useEffect(() => {
    const timer = setTimeout(
      () => setFiltro((f) => ({ ...f, busca: buscaTexto, pagina: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [buscaTexto]);
  useEffect(() => {
    if (
      !status?.executando &&
      !status?.codex.executando &&
      !(
        status?.config.ia_ativa &&
        (status.codex.executando || status.codex.pendentes) &&
        !status.codex.pausa
      )
    )
      return;
    const timer = setInterval(() => {
      void carregarStatus()
        .then(() => {
          if (secao === "publicacoes") void carregarLista();
        })
        .catch((e) => setFalha(erro(e)));
    }, 2500);
    return () => clearInterval(timer);
  }, [status, carregarStatus, carregarLista, secao]);
  useEffect(() => {
    if (
      !detalhe ||
      !["pendente", "analisando"].includes(detalhe.ia_status) ||
      (!detalhe.ia_manual && (!status?.config.ia_ativa || status.codex.pausa))
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .get<Publicacao>(`/djen/publicacoes/${detalhe.id}`)
        .then((p) => {
          if (!active) return;
          setDetalhe(p);
          if (!revisaoAlterada && p.ia_status === "concluida") {
            setCategorias(p.categorias);
            setSituacao(p.situacao || "");
            setResultado(p.resultado);
          }
        })
        .catch(() => {});
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [detalhe, status?.config.ia_ativa, status?.codex.pausa, revisaoAlterada]);
  const atualizarEmTempoReal = useCallback(() => {
    void carregarStatus().catch((e) => setFalha(erro(e)));
    if (secao === "publicacoes") void carregarLista();
  }, [carregarStatus, carregarLista, secao]);
  useSocketEvent("djen:changed", atualizarEmTempoReal);
  useSocketEvent("connect", atualizarEmTempoReal);
  const filtrar = (key: string, value: string) =>
    setFiltro((f) => ({ ...f, [key]: value, pagina: 1 }));
  async function acao(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setSalvando(true);
    try {
      await fn();
    } catch (e) {
      show(erro(e), "error");
    } finally {
      lock.current = false;
      setSalvando(false);
    }
  }
  async function consultar() {
    if (consultando || status?.executando) return;
    setConsultando(true);
    try {
      await api.post("/djen/buscar", {
        inicio: consulta.inicio,
        fim: consulta.fim,
        ...(consulta.advogado_id
          ? { advogado_ids: [Number(consulta.advogado_id)] }
          : {}),
      });
      await carregarStatus();
      show(
        "Consulta iniciada. Você pode acompanhar o resultado nesta área.",
        "success",
      );
    } catch (e) {
      show(erro(e), "error");
    } finally {
      setConsultando(false);
    }
  }
  async function abrir(id: number) {
    const current = ++detailSeq.current;
    try {
      const [p, c] = await Promise.all([
        api.get<Publicacao>(`/djen/publicacoes/${id}`),
        api.get<Contact[]>("/contacts"),
      ]);
      if (current !== detailSeq.current) return;
      setDetalhe(p);
      setAbaDetalhe("resumo");
      setContatos(c);
      setRevisaoAlterada(false);
      setCategorias(p.categorias);
      setSituacao(p.situacao || "");
      setResultado(p.resultado);
      setProcesso({
        cliente_id: p.cliente_id ? String(p.cliente_id) : "",
        observacoes: p.observacoes || "",
      });
      await api.post(`/djen/publicacoes/${id}/lida`);
      void carregarLista();
      void carregarStatus();
    } catch (e) {
      show(erro(e), "error");
    }
  }
  async function compor() {
    if (!detalhe) return;
    const contato = contatos.find((c) => String(c.id) === processo.cliente_id);
    if (!contato) {
      setAbaDetalhe("cliente");
      show(
        "Busque ou cadastre o cliente abaixo e selecione seu telefone.",
        "error",
      );
      window.setTimeout(() => {
        document
          .getElementById("cliente-processo-area")
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
        document.getElementById("buscar-cliente-processo")?.focus();
      });
      return;
    }
    const atualizado = await api.put<Publicacao>(
      `/djen/publicacoes/${detalhe.id}/processo`,
      { ...processo, cliente_id: contato.id },
    );
    setDetalhe(atualizado);
    setConfirmacaoEnvio(false);
    setMensagem({
      cliente_id: contato.id,
      cliente_nome: contato.nome,
      telefone: contato.telefone,
      request_id:
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      texto: `Olá, ${contato.nome}. Houve uma nova publicação no processo ${detalhe.processo || "acompanhado pelo escritório"}: ${situacao || categorias.map((c) => TIPOS[c]).join(", ") || "andamento processual"}.\n\nNossa equipe está analisando o conteúdo para orientar você.\n\nSales & Associados.`,
    });
  }
  async function enviar() {
    if (!mensagem || !detalhe || lock.current || !confirmacaoEnvio) return;
    lock.current = true;
    setEnviando(true);
    try {
      if (!detalhe.revisada || revisaoAlterada) {
        setDetalhe(
          await api.put<Publicacao>(`/djen/publicacoes/${detalhe.id}/revisao`, {
            categorias,
            resultado,
            situacao,
          }),
        );
        setRevisaoAlterada(false);
      }
      const r = await api.post<{ mensagem: { status: string } }>(
        `/djen/publicacoes/${detalhe.id}/mensagem`,
        {
          ...mensagem,
          telefone_confirmado: mensagem.telefone,
          confirmado: true,
        },
      );
      if (r.mensagem.status === "sucesso")
        show("Mensagem confirmada no WhatsApp.", "success");
      else
        show(
          "Há uma tentativa anterior sem confirmação de sucesso. Confira o histórico e a conversa.",
          "error",
        );
      setMensagem(null);
      setDetalhe(await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`));
    } catch (e) {
      show(erro(e), "error");
      setMensagem(null);
      setDetalhe(
        await api
          .get<Publicacao>(`/djen/publicacoes/${detalhe.id}`)
          .catch(() => detalhe),
      );
    } finally {
      lock.current = false;
      setEnviando(false);
    }
  }
  const titulo =
    secao === "advogados"
      ? "Advogados acompanhados"
      : secao === "monitoramento"
        ? "Monitoramento DJEN"
        : "Publicações processuais";
  return (
    <div className="space-y-5">
      <PageHeader
        title={titulo}
        description={
          secao === "publicacoes"
            ? "Decisões, acordos, pagamentos, perícias e demais andamentos dos processos."
            : secao === "advogados"
              ? "Cadastre um ou mais advogados pelo nome completo, número da OAB e UF."
              : "Consulte o DJEN por período e acompanhe a execução de cada busca."
        }
        actions={
          secao === "advogados" ? (
            <Button
              onClick={() =>
                setFormAdv({
                  nome: "",
                  numero_oab: "",
                  uf_oab: "SP",
                  modo_busca: "ambos",
                  ativo: true,
                })
              }
            >
              <Plus className="h-4 w-4" />
              Adicionar advogado
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void carregarStatus().catch((e) => show(erro(e), "error"));
                  if (secao === "publicacoes") void carregarLista();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </Button>
              {secao === "publicacoes" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setMostrarSemLaudo(true);
                      void carregarSemLaudo().catch((e) => show(erro(e), "error"));
                    }}
                  >
                    <AlertCircle className="h-4 w-4" />
                    Sem laudo ({status?.pericias_sem_laudo ?? 0})
                  </Button>
                  <Button onClick={() => navigate("/processos/monitoramento")}>
                    <Search className="h-4 w-4" />
                    Consultar DJEN
                  </Button>
                </>
              )}
            </>
          )
        }
      />
      {falha && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {falha}
        </p>
      )}
      {secao === "publicacoes" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-4">
            {(
              [
                { tipo: "sentenca", Icon: Scale },
                { tipo: "acordao", Icon: Gavel },
                { tipo: "pericia", Icon: Stethoscope },
                { tipo: "laudo_juntado", Icon: FileCheck2 },
                { tipo: "rpv", Icon: Banknote },
                { tipo: "homologacao_acordo", Icon: Handshake },
                { tipo: "proposta_acordo", Icon: Handshake },
                { tipo: "outros", Icon: FolderOpen },
              ] as const
            ).map(({ tipo, Icon }) => (
              <button
                key={tipo}
                onClick={() =>
                  filtrar(
                    "categoria",
                    filtro.categoria.split(",").includes(tipo)
                      ? filtro.categoria
                          .split(",")
                          .filter((v) => v !== tipo)
                          .join(",")
                      : [
                          ...filtro.categoria.split(",").filter(Boolean),
                          tipo,
                        ].join(","),
                  )
                }
                aria-pressed={filtro.categoria.split(",").includes(tipo)}
                className={`flex min-h-[104px] flex-col justify-between rounded-xl border bg-white p-4 text-left dark:bg-zinc-900 ${filtro.categoria.split(",").includes(tipo) ? "border-accent-400" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <span className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {FILTROS[tipo]}
                  <Icon className="h-4 w-4 text-accent-500" />
                </span>
                <strong className="mt-2 block text-[26px] font-semibold text-[#496a54] dark:text-zinc-100">
                  {status?.resumo[tipo] ?? 0}
                </strong>
              </button>
            ))}
          </div>
          <p className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Sparkles className="h-3.5 w-3.5" />
            {status?.codex.pausa
              ? `Análise pausada: ${status.codex.pausa}`
              : status?.config.ia_ativa
                ? `Codex: ${status.codex.pendentes} na fila${status.codex.executando_ids.length ? ` · ${status.codex.executando_ids.length} em análise` : ""}.`
                : "Análise automática desativada. Use Analisar com Codex nos detalhes ou configure a análise automática em Monitoramento DJEN."}{" "}
            Publicações sem classificação ficam em Outros.
            {status?.config.ia_ativa && (
              <span>
                Tempo médio:{" "}
                {status.codex.media_segundos === null
                  ? "medindo…"
                  : `${status.codex.media_segundos}s`}{" "}
                · Previsão da fila:{" "}
                {status.codex.pausa
                  ? "pausada"
                  : status.codex.estimativa_segundos === null
                    ? "medindo…"
                    : `${Math.ceil(status.codex.estimativa_segundos / 60)} min (estimativa)`}
              </span>
            )}
          </p>
          <section className="surface-panel p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input
                aria-label="Buscar publicações"
                placeholder="Buscar processo, cliente ou trecho…"
                value={buscaTexto}
                onChange={(e) => setBuscaTexto(e.target.value)}
              />
              <MultiSelect
                label="Categoria da publicação"
                placeholder="Todas as categorias"
                value={filtro.categoria.split(",").filter(Boolean)}
                options={Object.entries(FILTROS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(v) => filtrar("categoria", v.join(","))}
              />
              <MultiSelect
                label="Resultado da sentença"
                placeholder="Todos os resultados"
                value={filtro.resultado.split(",").filter(Boolean)}
                options={Object.entries(RESULTADOS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                onChange={(v) => filtrar("resultado", v.join(","))}
              />
              <MultiSelect
                label="Advogado das publicações"
                placeholder="Todos os advogados"
                value={filtro.advogado_id.split(",").filter(Boolean)}
                options={(status?.advogados || []).map((a) => ({
                  value: String(a.id),
                  label: `${a.nome} · ${a.uf_oab} ${a.numero_oab}`,
                }))}
                onChange={(v) => filtrar("advogado_id", v.join(","))}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {total} publicação(ões) · {status?.resumo.nao_lidas ?? 0} não
                lidas
              </p>
              <MultiSelect
                label="Situação das publicações"
                placeholder="Todas as situações"
                value={filtro.situacao.split(",").filter(Boolean)}
                options={[
                  { value: "nao_lidas", label: "Não lidas" },
                  { value: "lidas", label: "Lidas" },
                  { value: "revisar", label: "A revisar" },
                  { value: "com_prazo", label: "Com prazo em aberto" },
                ]}
                onChange={(v) => filtrar("situacao", v.join(","))}
              />
            </div>
          </section>
          <div
            id="navegacao-publicacoes"
            className="sticky top-20 z-20 scroll-mt-24 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="arquivo-publicacoes">Exibir</Label>
              <Select
                id="arquivo-publicacoes"
                className="max-w-xs"
                value={filtro.arquivo}
                onChange={(e) => filtrar("arquivo", e.target.value)}
              >
                <option value="ativos">Pendentes de conclusão</option>
                <option value="concluidos">Concluídas</option>
                <option value="todos">Todas</option>
              </Select>
              {total > 25 && (
                <>
                  <Label htmlFor="ir-pagina-publicacoes">Página</Label>
                  <Select
                    id="ir-pagina-publicacoes"
                    className="max-w-[100px]"
                    value={filtro.pagina}
                    onChange={(e) =>
                      setFiltro((f) => ({
                        ...f,
                        pagina: Number(e.target.value),
                      }))
                    }
                  >
                    {Array.from(
                      { length: Math.max(1, Math.ceil(total / 25)) },
                      (_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ),
                    )}
                  </Select>
                </>
              )}
            </div>
            <Pagination
              page={filtro.pagina - 1}
              totalItems={total}
              pageSize={25}
              onPageChange={(p) => setFiltro((f) => ({ ...f, pagina: p + 1 }))}
            />
          </div>
          {status?.executando && (
            <p className="flex items-center gap-2 text-xs text-accent-600">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Busca em andamento. Os resultados serão atualizados aqui.
            </p>
          )}
          {!carregando && !items.length ? (
            <EmptyState
              icon={Search}
              title={
                status?.advogados.length
                  ? "Nenhuma publicação neste filtro"
                  : "Cadastre o primeiro advogado"
              }
              description={
                status?.advogados.length
                  ? "Execute uma consulta ao DJEN ou ajuste os filtros para ver as publicações capturadas."
                  : "A captura começa após cadastrar nome, OAB e UF. O controle de perícias permanece separado."
              }
              action={
                <Button
                  variant="outline"
                  onClick={() =>
                    navigate(
                      status?.advogados.length
                        ? "/processos/monitoramento"
                        : "/processos/advogados",
                    )
                  }
                >
                  {status?.advogados.length
                    ? "Consultar DJEN"
                    : "Adicionar advogado"}
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {items.map((p) => (
                <article
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir processo ${p.processo}`}
                  onClick={(e) => {
                    if (
                      !(e.target as HTMLElement).closest("button,a,input,label")
                    )
                      void abrir(p.id);
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.target === e.currentTarget &&
                      (e.key === "Enter" || e.key === " ")
                    ) {
                      e.preventDefault();
                      void abrir(p.id);
                    }
                  }}
                  className={`surface-panel cursor-pointer p-5 transition-colors hover:border-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 ${!p.lida ? "border-l-4 border-l-accent-600 bg-accent-50/40 shadow-sm dark:bg-accent-950/20" : "opacity-85"}`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2">
                        {p.categorias.length ? (
                          p.categorias.map((c) => (
                            <Badge key={c} tone={tons[c]}>
                              {TIPOS[c]}
                            </Badge>
                          ))
                        ) : (
                          <Badge>Outros</Badge>
                        )}
                        {p.categorias.includes("sentenca") && (
                          <Badge
                            tone={
                              p.resultado === "nao_identificado"
                                ? "neutral"
                                : "info"
                            }
                          >
                            {RESULTADOS[p.resultado]}
                          </Badge>
                        )}
                        {p.pericia_controle && (
                          <Badge
                            tone={
                              p.pericia_controle.status === "duplicidade"
                                ? "success"
                                : p.pericia_controle.status === "redesignacao"
                                  ? "warning"
                                  : p.pericia_controle.status ===
                                      "cadastrada_nao_informada"
                                    ? "info"
                                    : "neutral"
                            }
                          >
                            {p.pericia_controle.status === "duplicidade"
                              ? "Já informada · duplicidade"
                              : p.pericia_controle.status === "redesignacao"
                                ? "Possível redesignação"
                                : p.pericia_controle.status ===
                                    "cadastrada_nao_informada"
                                  ? "No calendário · sem confirmação de aviso"
                                  : p.pericia_controle.status ===
                                      "cadastrada_a_conferir"
                                    ? "No calendário · conferir local"
                                    : p.pericia_controle.status ===
                                        "nao_cadastrada"
                                      ? "Ainda fora do controle de perícias"
                                      : "Dados da perícia incompletos"}
                          </Badge>
                        )}
                        {!p.lida ? (
                          <Badge tone="accent">● Não lida</Badge>
                        ) : (
                          <Badge>Lida</Badge>
                        )}
                        {Boolean(p.concluida) && (
                          <Badge tone="success">Concluída</Badge>
                        )}
                        {!p.revisada && <Badge tone="warning">A revisar</Badge>}
                        {p.ia_status === "pendente" && (
                          <Badge>Aguardando Codex</Badge>
                        )}
                        {p.ia_status === "analisando" && (
                          <Badge tone="info">Codex analisando</Badge>
                        )}
                        {p.ia_status === "erro" && (
                          <Badge tone="danger">Falha na análise</Badge>
                        )}
                        {Boolean(p.cancelada) && (
                          <Badge tone="danger">Cancelada na origem</Badge>
                        )}
                      </div>
                      <h2 className="mt-3 break-all text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {p.processo || "Processo não informado"}
                      </h2>
                      {Boolean(p.andamentos_total && p.andamentos_total > 1) && (
                        <p className="mt-1 text-[11px] font-medium text-accent-700 dark:text-accent-300">
                          {p.andamentos_total} andamentos agrupados neste processo
                          {p.andamentos_nao_lidos
                            ? ` · ${p.andamentos_nao_lidos} não lido${p.andamentos_nao_lidos > 1 ? "s" : ""}`
                            : ""}
                        </p>
                      )}
                      <p
                        className={`mt-1 text-xs font-medium ${p.cliente_vinculado ? "text-zinc-700 dark:text-zinc-200" : "text-amber-700 dark:text-amber-300"}`}
                      >
                        {p.cliente_exibicao
                          ? `Cliente: ${p.cliente_exibicao}${p.cliente_vinculado ? "" : " · vínculo pendente"}`
                          : "Cliente não identificado na publicação"}
                      </p>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {p.tribunal} · {p.orgao} · Disponibilizada em{" "}
                        {dia(p.data_disponibilizacao)}
                      </p>
                      {p.situacao && (
                        <p className="mt-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
                          {p.situacao}
                        </p>
                      )}
                      {p.proximo_prazo && (
                        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                          Término do próximo prazo: {dia(p.proximo_prazo)} ·{" "}
                          {p.prazos_abertos} em aberto
                        </p>
                      )}
                      <p className="mt-3 line-clamp-3 whitespace-pre-line break-words text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                        {p.resumo}
                      </p>
                      <p className="mt-3 text-[10px] text-zinc-500">
                        {p.advogados
                          .map(
                            (a) =>
                              `${a.nome} · OAB ${a.uf_oab} ${a.numero_oab}`,
                          )
                          .join(" / ")}
                      </p>
                      {p.advogados.some((a) => a.correspondencia !== "oab") && (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          Correspondência da busca a conferir no inteiro teor e
                          na OAB.
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-[180px]">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={salvando}
                        onClick={() =>
                          void acao(async () => {
                            await api.post(
                              `/djen/publicacoes/${p.id}/conclusao`,
                              { concluida: !p.concluida },
                            );
                            await carregarLista();
                            await carregarStatus();
                            show(
                              p.concluida
                                ? "Publicação reaberta."
                                : "Publicação concluída. Consulte-a no filtro Concluídas.",
                              "success",
                            );
                          })
                        }
                      >
                        {p.concluida ? "Reabrir" : "Concluir"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={salvando}
                        onClick={() =>
                          void acao(async () => {
                            await api.post(
                              `/djen/publicacoes/${p.id}/leitura`,
                              { lida: !p.lida },
                            );
                            await carregarLista();
                            await carregarStatus();
                          })
                        }
                      >
                        {p.lida ? "Marcar não lida" : "Marcar lida"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="self-start"
                        onClick={() => void abrir(p.id)}
                      >
                        Ver detalhes
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          <Pagination
            page={filtro.pagina - 1}
            totalItems={total}
            pageSize={25}
            onPageChange={(pagina) => {
              setFiltro((f) => ({ ...f, pagina: pagina + 1 }));
              document
                .getElementById("navegacao-publicacoes")
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}
          />
        </>
      )}
      {secao === "advogados" && (
        <section className="surface-panel overflow-hidden">
          {!status?.advogados.length ? (
            <EmptyState
              icon={BriefcaseBusiness}
              title="Nenhum advogado cadastrado"
              description="Adicione os advogados cujas publicações o escritório vai acompanhar."
            />
          ) : (
            status.advogados.map((a) => (
              <article
                key={a.id}
                className="flex flex-col gap-3 border-b border-zinc-200 p-5 last:border-b-0 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold">
                    {a.nome}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    OAB {a.uf_oab} {a.numero_oab} ·{" "}
                    {a.modo_busca === "ambos"
                      ? "Consulta por OAB e por nome"
                      : a.modo_busca === "oab"
                        ? "Consulta por OAB"
                        : "Consulta por nome · conferir OAB"}
                  </p>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Última captura concluída:{" "}
                    {a.ultimo_sucesso_em
                      ? dia(a.ultimo_sucesso_em)
                      : "Ainda não realizada"}
                  </p>
                  {a.ultimo_erro && (
                    <p className="mt-2 max-w-2xl break-words text-xs text-red-600 dark:text-red-300">
                      {a.ultimo_erro}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={a.ativo ? "success" : "neutral"}>
                    {a.ativo ? "Ativo" : "Pausado"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFormAdv({ ...a, ativo: Boolean(a.ativo) })
                    }
                  >
                    Editar
                  </Button>
                </div>
              </article>
            ))
          )}
        </section>
      )}
      {secao === "monitoramento" && (
        <>
          <section className="surface-panel p-5">
            <h2 className="text-sm font-semibold">Consultar publicações</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Consulte até 31 dias por execução. Resultados repetidos não criam
              publicações duplicadas.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label htmlFor="djen-inicio">Disponibilização inicial</Label>
                <Input
                  id="djen-inicio"
                  type="date"
                  value={consulta.inicio}
                  max={consulta.fim}
                  onChange={(e) =>
                    setConsulta({ ...consulta, inicio: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="djen-fim">Disponibilização final</Label>
                <Input
                  id="djen-fim"
                  type="date"
                  value={consulta.fim}
                  max={hoje()}
                  onChange={(e) =>
                    setConsulta({ ...consulta, fim: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="djen-adv">Advogados</Label>
                <Select
                  id="djen-adv"
                  value={consulta.advogado_id}
                  onChange={(e) =>
                    setConsulta({ ...consulta, advogado_id: e.target.value })
                  }
                >
                  <option value="">Todos os ativos</option>
                  {status?.advogados
                    .filter((a) => a.ativo)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.nome}
                      </option>
                    ))}
                </Select>
              </div>
              <Button
                className="self-end"
                onClick={() => void consultar()}
                loading={consultando || Boolean(status?.executando)}
                disabled={!status?.advogados.some((a) => a.ativo)}
              >
                <Search className="h-4 w-4" />
                Buscar publicações
              </Button>
            </div>
          </section>
          <section className="surface-panel p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 className="h-4 w-4" />
              Monitoramento automático
            </h2>
            <label className="mt-4 flex items-center gap-2 text-xs">
              <Checkbox
                checked={config.automatico}
                onChange={(e) =>
                  setConfig({ ...config, automatico: e.target.checked })
                }
              />
              Consultar periodicamente os advogados ativos
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="djen-intervalo">Intervalo em minutos</Label>
                <Input
                  id="djen-intervalo"
                  type="number"
                  min={30}
                  max={1440}
                  value={config.intervalo_minutos}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      intervalo_minutos: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label htmlFor="djen-janela">
                  Dias na primeira captura automática
                </Label>
                <Input
                  id="djen-janela"
                  type="number"
                  min={1}
                  max={31}
                  value={config.janela_inicial_dias}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      janela_inicial_dias: Number(e.target.value),
                    })
                  }
                />
              </div>
              <Button
                variant="outline"
                className="self-end"
                loading={salvando}
                onClick={() =>
                  void acao(async () => {
                    await api.put("/djen/config", config);
                    await carregarStatus();
                    show("Monitoramento salvo.", "success");
                  })
                }
              >
                Salvar monitoramento
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
              As buscas automáticas revisitam os últimos dias para captar
              publicações disponibilizadas com atraso. Não há envio automático
              de mensagens nem criação de eventos no calendário de perícias.
            </p>
          </section>
          <section className="surface-panel space-y-4 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4" /> Classificação e resumos com Codex
            </h2>
            <p className="text-xs leading-relaxed text-zinc-500">
              Use sua conta ChatGPT no Codex instalado no servidor. A análise lê
              o inteiro teor capturado e não altera o controle de perícias.
              Publicações inconclusivas ficam em Outros para conferência.
            </p>
            <p className="text-xs text-zinc-500">
              Primeira conexão: execute{" "}
              <code className="break-all">
                npm run codex:login --prefix server
              </code>{" "}
              no servidor, com o mesmo usuário do PM2, e conclua o login no link
              informado pelo Codex.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                loading={salvando}
                onClick={() =>
                  void acao(async () => {
                    setConexaoCodex(await api.get("/djen/codex/conexao"));
                  })
                }
              >
                Verificar conexão
              </Button>
              {conexaoCodex && (
                <span className="text-xs text-zinc-500">
                  {conexaoCodex.mensagem}
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={config.ia_ativa}
                onChange={(e) =>
                  setConfig({ ...config, ia_ativa: e.target.checked })
                }
              />{" "}
              Analisar automaticamente as publicações capturadas
            </label>
            <p className="text-xs text-zinc-500">
              A primeira ativação analisa as publicações pendentes, incluindo as
              antigas sem revisão. As revisões salvas são preservadas. O uso
              está sujeito aos limites da conta Codex.
            </p>
            <div className="max-w-md">
              <Label htmlFor="codex-modo">Modo de análise</Label>
              <Select
                id="codex-modo"
                value={config.ia_modo}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    ia_modo: e.target.value as
                      | "economico"
                      | "equilibrado"
                      | "precisao",
                  })
                }
              >
                <option value="economico">Econômico — lotes de até 8</option>
                <option value="equilibrado">
                  Equilibrado — modelo forte, lotes de até 4
                </option>
                <option value="precisao">
                  Máxima precisão — análise individual
                </option>
              </Select>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                No modo econômico, casos duvidosos são encaminhados
                automaticamente ao modelo mais forte. Publicações extensas
                continuam sendo analisadas individualmente e sem cortes.
              </p>
            </div>
            <div className="max-w-xs">
              <Label htmlFor="codex-paralelismo">Análises simultâneas</Label>
              <Select
                id="codex-paralelismo"
                value={config.ia_paralelismo}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    ia_paralelismo: Number(e.target.value),
                  })
                }
              >
                <option value={1}>1 por vez (menor pico de uso)</option>
                <option value={2}>2 simultâneas</option>
                <option value={3}>3 simultâneas</option>
              </Select>
              <p className="mt-1 text-[11px] text-zinc-500">
                Cada execução pode conter um lote. Esta opção muda a velocidade,
                não a quantidade total de texto analisado.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                size="sm"
                loading={salvando}
                onClick={() =>
                  void acao(async () => {
                    await api.put("/djen/config", config);
                    await carregarStatus();
                    show("Configuração do Codex salva.", "success");
                  })
                }
              >
                Salvar configuração do Codex
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={salvando}
                disabled={
                  !status?.config.ia_ativa || Boolean(status?.codex.executando)
                }
                onClick={() => {
                  const quantidade = status?.codex.reanalisaveis ?? 0;
                  if (
                    !window.confirm(
                      `Reanalisar ${quantidade} publicação(ões) sem revisão? Textos já analisados poderão usar o cache; os demais consumirão o limite do Codex.`,
                    )
                  )
                    return;
                  void acao(async () => {
                    const resposta = await api.post<{ enfileiradas: number }>(
                      "/djen/codex/reanalisar",
                      {},
                    );
                    await carregarStatus();
                    show(
                      `${resposta.enfileiradas} publicação(ões) adicionada(s) à fila.`,
                      "success",
                    );
                  });
                }}
              >
                Reanalisar publicações sem revisão
              </Button>
              {status?.codex.pausa && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={salvando}
                  disabled={!status.config.ia_ativa}
                  onClick={() =>
                    void acao(async () => {
                      await api.post("/djen/codex/retomar", {});
                      await carregarStatus();
                    })
                  }
                >
                  Retomar análises
                </Button>
              )}
            </div>
            {status?.codex.pausa && (
              <p
                role="alert"
                className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              >
                {status.codex.pausa}
              </p>
            )}
            <p className="text-xs text-zinc-500">
              {status?.codex.pendentes ?? 0} na fila ·{" "}
              {status?.codex.falhas ?? 0} com falha
              {status?.codex.executando ? " · análise em andamento" : ""}
            </p>
            {status && (
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                  <p className="text-[11px] text-zinc-500">
                    Execuções em 30 dias
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {status.codex.uso_30_dias.chamadas}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-950/30">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    Execuções evitadas
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                    {status.codex.uso_30_dias.execucoes_evitadas}
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                  <p className="text-[11px] text-zinc-500">
                    Reaproveitadas do cache
                  </p>
                  <p className="mt-1 text-lg font-semibold">
                    {status.codex.uso_30_dias.cache_hits}
                  </p>
                </div>
              </div>
            )}
          </section>
          <section className="surface-panel p-5">
            <h2 className="text-sm font-semibold">
              Últimas consultas (5 mais recentes)
            </h2>
            {!status?.ultimas.length ? (
              <p className="mt-3 text-xs text-zinc-500">
                Nenhuma consulta executada.
              </p>
            ) : (
              status.ultimas.map((b) => (
                <article
                  key={b.id}
                  className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs">
                      {dia(b.inicio)} a {dia(b.fim)} · {b.novas} novas
                      publicações · {b.consultas} consultas à API
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={salvando || b.status === "executando"}
                        aria-label={`Excluir registro da consulta ${b.id}`}
                        onClick={() =>
                          void acao(async () => {
                            await api.delete(`/djen/buscas/${b.id}`);
                            await carregarStatus();
                            show(
                              "Registro da consulta excluído. As publicações foram preservadas.",
                              "success",
                            );
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Badge
                        tone={
                          b.status === "concluida"
                            ? "success"
                            : b.status === "executando"
                              ? "info"
                              : "warning"
                        }
                      >
                        {(
                          {
                            concluida: "Concluída",
                            executando: "Em andamento",
                            falha: "Falha",
                            parcial: "Parcial · precisa completar",
                            interrompida: "Interrompida",
                          } as Record<string, string>
                        )[b.status] || b.status}
                      </Badge>
                    </div>
                  </div>
                  {(
                    JSON.parse(b.erros_json || "[]") as {
                      advogado: string;
                      erro: string;
                    }[]
                  ).map((e, i) => (
                    <p
                      key={i}
                      className="mt-2 break-words text-xs text-red-600 dark:text-red-300"
                    >
                      {e.advogado}: {e.erro}
                    </p>
                  ))}
                </article>
              ))
            )}
          </section>
        </>
      )}
      <Modal
        open={Boolean(formAdv)}
        onClose={() => {
          if (!salvando) setFormAdv(null);
        }}
        title={formAdv?.id ? "Editar advogado" : "Adicionar advogado"}
        footer={
          <>
            <Button
              variant="outline"
              disabled={salvando}
              onClick={() => setFormAdv(null)}
            >
              Cancelar
            </Button>
            <Button
              loading={salvando}
              onClick={() =>
                void acao(async () => {
                  if (!formAdv) return;
                  await (formAdv.id
                    ? api.put(`/djen/advogados/${formAdv.id}`, formAdv)
                    : api.post("/djen/advogados", formAdv));
                  setFormAdv(null);
                  await carregarStatus();
                  show("Advogado salvo.", "success");
                })
              }
            >
              Salvar advogado
            </Button>
          </>
        }
      >
        {formAdv && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="adv-nome">Nome completo</Label>
              <Input
                id="adv-nome"
                autoFocus
                value={formAdv.nome}
                onChange={(e) =>
                  setFormAdv({ ...formAdv, nome: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-3">
              <div>
                <Label htmlFor="adv-oab">Número da OAB</Label>
                <Input
                  id="adv-oab"
                  disabled={Boolean(formAdv.id)}
                  value={formAdv.numero_oab}
                  placeholder="123456"
                  onChange={(e) =>
                    setFormAdv({ ...formAdv, numero_oab: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="adv-uf">UF</Label>
                <Select
                  id="adv-uf"
                  disabled={Boolean(formAdv.id)}
                  value={formAdv.uf_oab}
                  onChange={(e) =>
                    setFormAdv({ ...formAdv, uf_oab: e.target.value })
                  }
                >
                  {UFS.map((uf) => (
                    <option key={uf}>{uf}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="adv-modo">Como buscar</Label>
              <Select
                id="adv-modo"
                value={formAdv.modo_busca}
                onChange={(e) =>
                  setFormAdv({
                    ...formAdv,
                    modo_busca: e.target.value as Advogado["modo_busca"],
                  })
                }
              >
                <option value="ambos">
                  OAB e nome · duas buscas complementares
                </option>
                <option value="oab">Somente OAB e UF</option>
                <option value="nome">Somente nome · exige conferir OAB</option>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={formAdv.ativo}
                onChange={(e) =>
                  setFormAdv({ ...formAdv, ativo: e.target.checked })
                }
              />
              Advogado ativo nas consultas
            </label>
            <p className="text-xs leading-relaxed text-zinc-500">
              A OAB diferencia homônimos. Resultados encontrados apenas pelo
              nome precisam de conferência antes de avisar o cliente.
            </p>
          </div>
        )}
      </Modal>
      <Modal
        open={mostrarSemLaudo}
        onClose={() => setMostrarSemLaudo(false)}
        title="Perícias realizadas sem laudo identificado"
        maxWidth="max-w-4xl"
        footer={
          <Button variant="outline" onClick={() => setMostrarSemLaudo(false)}>
            Fechar
          </Button>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            Alerta operacional somente para perícias realizadas há pelo menos 60 dias sem
            publicação de laudo identificada no mesmo processo. Não é contagem de
            prazo jurídico.
          </p>
          {carregandoSemLaudo ? (
            <p className="text-sm text-zinc-500">Carregando…</p>
          ) : !periciasSemLaudo.length ? (
            <EmptyState
              icon={FileCheck2}
              title="Nenhuma cobrança pendente"
              description="Não há perícias vencidas sem laudo identificado neste momento."
            />
          ) : (
            periciasSemLaudo.map((p) => (
              <article
                key={p.pericia_id}
                className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{p.nome}</p>
                    <p className="mt-1 text-xs text-zinc-500">{p.processo}</p>
                    <p className="mt-2 text-xs">
                      Perícia em {p.data}
                      {p.horario ? ` às ${p.horario}` : ""} ·{" "}
                      {p.dias_decorridos} dia(s) decorridos
                    </p>
                    {p.local && (
                      <p className="mt-1 text-xs text-zinc-500">{p.local}</p>
                    )}
                    {p.ultima_cobranca_em && (
                      <p className="mt-2 text-xs text-amber-700">
                        Cobrança registrada em {p.ultima_cobranca_em}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={salvando}
                      onClick={() =>
                        void acao(async () => {
                          await api.put(
                            `/djen/pericias/${p.pericia_id}/acompanhamento`,
                            { status: "cobrado", observacoes: p.observacoes || "" },
                          );
                          await carregarSemLaudo();
                          await carregarStatus();
                          show("Cobrança registrada.", "success");
                        })
                      }
                    >
                      Registrar cobrança
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={salvando}
                      onClick={() =>
                        void acao(async () => {
                          await api.put(
                            `/djen/pericias/${p.pericia_id}/acompanhamento`,
                            { status: "resolvido", observacoes: p.observacoes || "" },
                          );
                          await carregarSemLaudo();
                          await carregarStatus();
                          show("Acompanhamento concluído.", "success");
                        })
                      }
                    >
                      Concluir
                    </Button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </Modal>
      <Modal
        open={Boolean(detalhe) && !mensagem}
        onClose={() => {
          if (!salvando) {
            detailSeq.current++;
            setDetalhe(null);
          }
        }}
        title="Detalhes da publicação e do processo"
        maxWidth="max-w-6xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
            <Button
              onClick={() => void acao(compor)}
              disabled={salvando || Boolean(detalhe?.cancelada)}
            >
              <Send className="h-3.5 w-3.5" />
              Avisar cliente pelo WhatsApp
            </Button>
          </>
        }
      >
        {detalhe && (
          <div className="space-y-5">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-800/30">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    Processo
                  </p>
                  <h3 className="mt-1 break-all text-base font-semibold">
                    {detalhe.processo || "Processo não informado"}
                  </h3>
                  <p
                    className={`mt-2 text-sm font-semibold ${detalhe.cliente_vinculado ? "text-zinc-800 dark:text-zinc-100" : "text-amber-700 dark:text-amber-300"}`}
                  >
                    {detalhe.cliente_exibicao
                      ? `Cliente: ${detalhe.cliente_exibicao}${detalhe.cliente_vinculado ? "" : " · vínculo pendente"}`
                      : "Cliente não identificado na publicação"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(detalhe.categorias.length
                    ? detalhe.categorias
                    : (["outros"] as const)
                  ).map((c) => (
                    <Badge
                      key={c}
                      tone={c === "outros" ? "neutral" : tons[c]}
                    >
                      {c === "outros" ? "Outros" : TIPOS[c]}
                    </Badge>
                  ))}
                  <Badge tone={detalhe.revisada ? "success" : "warning"}>
                    {detalhe.revisada ? "Revisada" : "A revisar"}
                  </Badge>
                </div>
              </div>
              <details className="mt-4 text-xs">
                <summary className="cursor-pointer font-medium text-accent-600">
                  Ver dados do processo e links oficiais
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                  ["Tribunal", detalhe.tribunal],
                  ["Órgão julgador", detalhe.orgao],
                  ["Classe", detalhe.classe],
                  ["Tipo de documento", detalhe.tipo_documento],
                  ["Tipo de comunicação", detalhe.tipo_comunicacao],
                  [
                    "Disponibilização no DJEN",
                    dia(detalhe.data_disponibilizacao),
                  ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[10px] text-zinc-500">{label}</p>
                      <p className="mt-1 break-words">
                        {value || "Não informado na publicação"}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-accent-600">
                  {detalhe.certidao_url && (
                    <a
                      href={detalhe.certidao_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Certidão oficial DJEN
                    </a>
                  )}
                  {detalhe.link && (
                    <a
                      href={detalhe.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Consultar no tribunal
                    </a>
                  )}
                </div>
              </details>
            </div>
            <nav
              aria-label="Seções dos detalhes do processo"
              className="sticky top-0 z-10 -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white/95 p-1 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
            >
              {(
                [
                  ["resumo", "Visão geral"],
                  ["publicacao", "Publicação"],
                  [
                    "prazos",
                    `Prazos${detalhe.prazos?.length ? ` (${detalhe.prazos.length})` : ""}`,
                  ],
                  ["cliente", detalhe.cliente_nome ? "Cliente" : "Vincular cliente"],
                  ["historico", "Histórico"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAbaDetalhe(id)}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${abaDetalhe === id ? "bg-accent-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {abaDetalhe === "resumo" && (
              <div className="space-y-5">
                <section>
              <h3 className="text-sm font-semibold">
                Partes e advogados da publicação
              </h3>
              <div className="mt-2 grid gap-3 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/40">
                <p>
                  {detalhe.destinatarios
                    ?.map(
                      (d) =>
                        `${d.nome || "Parte não identificada"}${d.polo ? ` (${d.polo})` : ""}`,
                    )
                    .join(" · ") || "Partes não informadas pelo DJEN."}
                </p>
                <p className="text-zinc-500">
                  {detalhe.advogados_publicacao
                    ?.map((a) => `${a.nome} · OAB ${a.uf_oab} ${a.numero_oab}`)
                    .join(" / ") ||
                    "Advogados não detalhados na resposta da fonte."}
                </p>
              </div>
                </section>
                <section className="rounded-xl border border-accent-200 bg-accent-50/40 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" /> Análise pelo Codex
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  loading={salvando}
                  disabled={
                    detalhe.ia_status === "analisando" ||
                    Boolean(detalhe.ia_manual)
                  }
                  onClick={() =>
                    void acao(async () => {
                      await api.post(
                        `/djen/publicacoes/${detalhe.id}/analise`,
                        {},
                      );
                      const p = await api.get<Publicacao>(
                        `/djen/publicacoes/${detalhe.id}`,
                      );
                      setDetalhe(p);
                      if (!revisaoAlterada) {
                        setCategorias(p.categorias);
                        setSituacao(p.situacao || "");
                        setResultado(p.resultado);
                      }
                      await carregarStatus();
                      show("Publicação adicionada à fila do Codex.", "success");
                    })
                  }
                >
                  {detalhe.analise
                    ? "Reanalisar com Codex"
                    : "Analisar com Codex"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {detalhe.ia_status === "analisando"
                  ? "Analisando publicação…"
                  : detalhe.ia_status === "pendente"
                    ? detalhe.ia_manual
                      ? "Análise manual na fila; não depende da análise automática."
                      : !status?.config.ia_ativa
                        ? "Análise automática desativada. O botão Analisar com Codex funciona manualmente."
                        : status.codex.pausa
                          ? `Fila pausada: ${status.codex.pausa}`
                          : "Aguardando análise na fila."
                    : detalhe.ia_status === "erro"
                      ? detalhe.ia_erro
                      : detalhe.analise
                        ? "Análise concluída. Confira os fatos antes de avisar o cliente."
                        : "Análise ainda não solicitada."}
              </p>
              {detalhe.analise && (
                <div className="mt-3 space-y-3 text-xs leading-relaxed [overflow-wrap:anywhere]">
                  <p className="font-medium">
                    Sugestão do Codex:{" "}
                    {detalhe.analise.categorias
                      .map((c) => TIPOS[c])
                      .join(" · ") || "Outros"}
                  </p>
                  {detalhe.analise.situacao && (
                    <p className="font-medium">{detalhe.analise.situacao}</p>
                  )}
                  <p className="whitespace-pre-wrap">
                    {detalhe.analise.resumo}
                  </p>
                  {detalhe.analise.providencia && (
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                      <Badge
                        tone={
                          detalhe.analise.providencia.tipo === "prazo_explicito"
                            ? "danger"
                            : detalhe.analise.providencia.tipo === "cumprimento"
                              ? "warning"
                              : detalhe.analise.providencia.tipo === "ciencia"
                                ? "success"
                                : "neutral"
                        }
                      >
                        {detalhe.analise.providencia.tipo === "prazo_explicito"
                          ? "Prazo explícito"
                          : detalhe.analise.providencia.tipo === "cumprimento"
                            ? "Exige providência"
                            : detalhe.analise.providencia.tipo === "ciencia"
                              ? "Somente ciência"
                              : "Providência a conferir"}
                      </Badge>
                      {detalhe.analise.providencia.descricao && (
                        <p className="mt-2">{detalhe.analise.providencia.descricao}</p>
                      )}
                      {detalhe.analise.providencia.prazo_texto && (
                        <p className="mt-1 text-zinc-500">
                          Prazo informado: {detalhe.analise.providencia.prazo_texto}
                        </p>
                      )}
                    </div>
                  )}
                  <p className="text-zinc-500">
                    {detalhe.analise.justificativa}
                  </p>
                  {Object.values(detalhe.analise.agendamento).some(Boolean) && (
                    <div className="grid gap-2 sm:grid-cols-3">
                      {Object.entries({
                        Data: detalhe.analise.agendamento.data,
                        Horário: detalhe.analise.agendamento.horario,
                        Local: detalhe.analise.agendamento.local,
                      }).map(([label, value]) => (
                        <p key={label}>
                          <strong>{label}:</strong> {value || "Não informado"}
                        </p>
                      ))}
                    </div>
                  )}
                  {detalhe.pericia_controle && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20">
                      <p className="font-semibold">Controle de perícias</p>
                      <p className="mt-1">{detalhe.pericia_controle.mensagem}</p>
                      {detalhe.pericia_controle.existente && (
                        <p className="mt-1 text-zinc-500">
                          Registro atual: {detalhe.pericia_controle.existente.data}
                          {detalhe.pericia_controle.existente.horario
                            ? ` às ${detalhe.pericia_controle.existente.horario}`
                            : ""}
                          {detalhe.pericia_controle.existente.local
                            ? ` · ${detalhe.pericia_controle.existente.local}`
                            : ""}
                        </p>
                      )}
                      {!["duplicidade", "dados_incompletos"].includes(
                        detalhe.pericia_controle.status,
                      ) && (
                        <Button
                          className="mt-3"
                          size="sm"
                          variant={
                            detalhe.pericia_controle.status === "redesignacao"
                              ? "primary"
                              : "outline"
                          }
                          loading={salvando}
                          onClick={() =>
                            void acao(async () => {
                              await api.post(
                                `/djen/publicacoes/${detalhe.id}/pericia-controle`,
                                {},
                              );
                              const atualizado = await api.get<Publicacao>(
                                `/djen/publicacoes/${detalhe.id}`,
                              );
                              setDetalhe(atualizado);
                              await carregarStatus();
                              show(
                                detalhe.pericia_controle?.status === "redesignacao"
                                  ? "Redesignação registrada no controle de perícias."
                                  : "Perícia adicionada ao controle.",
                                "success",
                              );
                            })
                          }
                        >
                          {detalhe.pericia_controle.status === "redesignacao"
                            ? "Registrar redesignação"
                            : "Adicionar ao controle de perícias"}
                        </Button>
                      )}
                    </div>
                  )}
                  {detalhe.analise.alertas.map((a, i) => (
                    <p
                      key={i}
                      className="rounded-lg bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                    >
                      {a}
                    </p>
                  ))}
                  {Boolean(detalhe.revisada) && (
                    <p className="text-zinc-500">
                      Sua revisão salva foi preservada. Para adotar outra
                      classificação, ajuste e salve abaixo.
                    </p>
                  )}
                  <p className="text-[11px] text-zinc-500">
                    Resumo limitado a esta publicação; o histórico abaixo contém
                    somente o que foi capturado pelo sistema.
                  </p>
                </div>
              )}
                </section>
              </div>
            )}
            {abaDetalhe === "publicacao" && (
              <div className="space-y-5">
            <DjenDocumentos
              key={`docs-${detalhe.id}`}
              id={detalhe.id}
              certidao={detalhe.certidao_url}
              tribunal={detalhe.link}
              documentos={detalhe.documentos}
              refresh={async () => {
                setDetalhe(
                  await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`),
                );
              }}
            />
            <details open>
              <summary className="cursor-pointer text-sm font-semibold">
                Inteiro teor da publicação
              </summary>
              <p className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 p-4 text-xs leading-relaxed [overflow-wrap:anywhere] dark:border-zinc-800">
                {detalhe.texto}
              </p>
            </details>
              </div>
            )}
            {abaDetalhe === "resumo" && (
            <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <CheckCheck className="h-4 w-4" />
                Conferir ou ajustar classificação
              </summary>
              <p className="mt-1 text-xs text-zinc-500">
                Confira a sugestão do Codex e o inteiro teor antes de salvar a
                revisão. Sem categoria aplicável, selecione Outros.
              </p>
              <div className="mt-3">
                <Label htmlFor="situacao-andamento">
                  Situação / assunto do andamento
                </Label>
                <Input
                  id="situacao-andamento"
                  maxLength={250}
                  value={situacao}
                  placeholder="Ex.: RPV paga · execução extinta"
                  onChange={(e) => {
                    setSituacao(e.target.value);
                    setRevisaoAlterada(true);
                  }}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {Object.entries(TIPOS).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={categorias.includes(key as Categoria)}
                      onChange={(e) => {
                        setRevisaoAlterada(true);
                        setCategorias((c) =>
                          e.target.checked
                            ? [...c, key as Categoria]
                            : c.filter((v) => v !== key),
                        );
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs">
                <Checkbox
                  checked={categorias.length === 0}
                  onChange={() => {
                    setCategorias([]);
                    setRevisaoAlterada(true);
                  }}
                />
                Outros
              </label>
              {categorias.includes("sentenca") && (
                <div className="mt-4">
                  <Label htmlFor="resultado-revisao">
                    Resultado da sentença
                  </Label>
                  <Select
                    id="resultado-revisao"
                    value={resultado}
                    onChange={(e) => {
                      setRevisaoAlterada(true);
                      setResultado(e.target.value as Resultado);
                    }}
                  >
                    {Object.entries(RESULTADOS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {detalhe.evidencias.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer text-zinc-500">
                    Ver trechos que motivaram a identificação
                  </summary>
                  {detalhe.evidencias.map((e, i) => (
                    <p
                      key={i}
                      className="mt-2 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {TIPOS[e.categoria]}: {e.trecho}
                    </p>
                  ))}
                </details>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  loading={salvando}
                  onClick={() =>
                    void acao(async () => {
                      const p = await api.put<Publicacao>(
                        `/djen/publicacoes/${detalhe.id}/revisao`,
                        { categorias, resultado, situacao },
                      );
                      setDetalhe(p);
                      setRevisaoAlterada(false);
                      void carregarLista();
                      show("Revisão salva.", "success");
                    })
                  }
                >
                  Salvar revisão
                </Button>
                <Badge tone={detalhe.revisada ? "success" : "warning"}>
                  {detalhe.revisada
                    ? "Classificação revisada"
                    : "Aguardando revisão"}
                </Badge>
              </div>
            </details>
            )}
            {abaDetalhe === "prazos" && (
            <DjenPrazos
              key={`prazos-${detalhe.id}`}
              id={detalhe.id}
              data={detalhe.data_disponibilizacao}
              prazos={detalhe.prazos}
              refresh={async () => {
                setDetalhe(
                  await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`),
                );
                void carregarLista();
              }}
            />
            )}
            {abaDetalhe === "cliente" && (
            <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 id="cliente-processo-area" className="text-sm font-semibold">
                Cliente e anotações do processo
              </h3>
              <div className="mt-3">
                <ContactPicker
                  contatos={contatos}
                  value={processo.cliente_id}
                  onChange={(cliente_id) =>
                    setProcesso({ ...processo, cliente_id })
                  }
                  processo={detalhe.processo}
                  onCreated={(c) => setContatos((list) => [...list, c])}
                />
              </div>
              <div className="mt-3">
                <Label htmlFor="obs-processo">Anotações internas</Label>
                <Textarea
                  id="obs-processo"
                  rows={3}
                  maxLength={10000}
                  value={processo.observacoes}
                  onChange={(e) =>
                    setProcesso({ ...processo, observacoes: e.target.value })
                  }
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                loading={salvando}
                onClick={() =>
                  void acao(async () => {
                    const atualizado = await api.put<Publicacao>(
                      `/djen/publicacoes/${detalhe.id}/processo`,
                      {
                        ...processo,
                        cliente_id: processo.cliente_id
                          ? Number(processo.cliente_id)
                          : null,
                      },
                    );
                    setDetalhe(atualizado);
                    await carregarLista();
                    show("Dados do processo salvos.", "success");
                  })
                }
              >
                Salvar dados do processo
              </Button>
              <p className="mt-3 text-[11px] text-zinc-500">
                Selecione o cliente e use Avisar cliente pelo WhatsApp para
                preparar a mensagem. A revisão e o destinatário serão conferidos
                antes do envio.
              </p>
            </section>
            )}
            {abaDetalhe === "historico" && (
              <div className="space-y-5">
            <DjenHistorico
              key={`hist-${detalhe.id}`}
              id={detalhe.id}
              andamentos={detalhe.relacionadas}
              total={detalhe.relacionadas_total}
              eventos={detalhe.historico}
              tipos={TIPOS}
              abrir={(id) => void abrir(id)}
            />
            <section>
              <h3 className="text-sm font-semibold">
                Mensagens desta publicação
              </h3>
              {!detalhe.mensagens?.length ? (
                <p className="mt-2 text-xs text-zinc-500">
                  Nenhuma mensagem enviada por este acompanhamento.
                </p>
              ) : (
                detalhe.mensagens.map((m) => (
                  <div
                    key={m.id}
                    className="mt-2 rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800"
                  >
                    <p>
                      {m.cliente_nome} · {formatPhoneDisplay(m.telefone)} ·{" "}
                      {dia(m.created_at)}
                    </p>
                    <Badge
                      className="mt-2"
                      tone={m.status === "sucesso" ? "success" : "warning"}
                    >
                      {m.status === "sucesso"
                        ? "Confirmada no WhatsApp"
                        : m.status === "incerto"
                          ? "Resultado incerto · confira a conversa"
                          : m.status === "enviando"
                            ? "Envio em andamento"
                            : "Falha antes do envio"}
                    </Badge>
                    <p className="mt-2 whitespace-pre-wrap">{m.texto}</p>
                    {m.erro && (
                      <p className="mt-2 text-red-600 dark:text-red-300">
                        {m.erro}
                      </p>
                    )}
                  </div>
                ))
              )}
            </section>
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={Boolean(mensagem)}
        onClose={() => {
          if (!enviando) setMensagem(null);
        }}
        title="Revisar mensagem ao cliente"
        description="Confira o destinatário e ajuste o texto antes de confirmar."
        footer={
          <>
            <Button
              variant="outline"
              disabled={enviando}
              onClick={() => setMensagem(null)}
            >
              Voltar aos detalhes
            </Button>
            <Button
              loading={enviando}
              disabled={
                !mensagem?.texto.trim() ||
                !confirmacaoEnvio ||
                whatsapp.status !== "conectado"
              }
              onClick={() => void enviar()}
            >
              <Send className="h-3.5 w-3.5" />
              Confirmar envio por WhatsApp
            </Button>
          </>
        }
      >
        {mensagem && (
          <div className="space-y-4">
            {whatsapp.status !== "conectado" && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                O WhatsApp está desconectado.{" "}
                <Link to="/configuracoes?whatsapp=1" className="underline">
                  Conectar nas configurações
                </Link>{" "}
                para concluir o envio.
              </p>
            )}
            <label className="flex items-start gap-2 text-xs">
              <Checkbox
                checked={confirmacaoEnvio}
                onChange={(e) => setConfirmacaoEnvio(e.target.checked)}
              />
              Conferi o inteiro teor, a classificação, o destinatário e a
              mensagem. Ao confirmar o envio, a revisão da classificação será
              salva.
            </label>
            <div className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800">
              <p className="font-semibold">{mensagem.cliente_nome}</p>
              <p className="mt-1 text-zinc-500">
                {formatPhoneDisplay(mensagem.telefone)}
              </p>
            </div>
            <div>
              <Label htmlFor="mensagem-processual">Mensagem</Label>
              <Textarea
                id="mensagem-processual"
                rows={9}
                maxLength={10000}
                value={mensagem.texto}
                onChange={(e) =>
                  setMensagem({ ...mensagem, texto: e.target.value })
                }
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

