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
  sentenca: "Sentença",
  acordao: "Acórdão",
  pericia: "Publicação de perícia",
  laudo_juntado: "Laudo pericial juntado",
};
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
  texto?: string;
  categorias: Categoria[];
  resultado: Resultado;
  revisada: number;
  lida: number;
  cancelada: number;
  advogados: Advogado[];
  cliente_id: number | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
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
  executando: number | null;
  proxima_execucao: string | null;
  ultimas: Busca[];
  resumo: Record<string, number>;
  advogados: Advogado[];
  config: {
    automatico: number;
    intervalo_minutos: number;
    janela_inicial_dias: number;
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
  });
  const [detalhe, setDetalhe] = useState<Publicacao | null>(null),
    [contatos, setContatos] = useState<Contact[]>([]),
    [categorias, setCategorias] = useState<Categoria[]>([]),
    [resultado, setResultado] = useState<Resultado>("nao_identificado"),
    [processo, setProcesso] = useState({ cliente_id: "", observacoes: "" });
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
        setConfig({ ...s.config, automatico: Boolean(s.config.automatico) }),
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
    if (!status?.executando) return;
    const timer = setInterval(() => {
      void carregarStatus()
        .then(() => {
          if (secao === "publicacoes") void carregarLista();
        })
        .catch((e) => setFalha(erro(e)));
    }, 2500);
    return () => clearInterval(timer);
  }, [status?.executando, carregarStatus, carregarLista, secao]);
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
      setContatos(c);
      setCategorias(p.categorias);
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
  function compor() {
    if (
      !detalhe?.cliente_id ||
      !detalhe.cliente_nome ||
      !detalhe.cliente_telefone
    )
      return;
    setMensagem({
      cliente_id: detalhe.cliente_id,
      cliente_nome: detalhe.cliente_nome,
      telefone: detalhe.cliente_telefone,
      request_id: crypto.randomUUID(),
      texto: `Olá, ${detalhe.cliente_nome}. Houve uma nova publicação no processo ${detalhe.processo || "acompanhado pelo escritório"}, disponibilizada em ${dia(detalhe.data_disponibilizacao)}: ${detalhe.categorias.map((c) => TIPOS[c]).join(", ") || "andamento processual"}.\n\nNossa equipe vai analisar o conteúdo e orientar você.\n\nSales & Associados.`,
    });
  }
  async function enviar() {
    if (!mensagem || !detalhe || lock.current) return;
    lock.current = true;
    setEnviando(true);
    try {
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
            ? "Sentenças, acórdãos, publicações de perícia e juntadas de laudo em um acompanhamento próprio."
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
                <Button onClick={() => navigate("/processos/monitoramento")}>
                  <Search className="h-4 w-4" />
                  Consultar DJEN
                </Button>
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
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {(
              [
                { tipo: "sentenca", Icon: Scale },
                { tipo: "acordao", Icon: Gavel },
                { tipo: "pericia", Icon: Stethoscope },
                { tipo: "laudo_juntado", Icon: FileCheck2 },
              ] as const
            ).map(({ tipo, Icon }) => (
              <button
                key={tipo}
                onClick={() =>
                  filtrar("categoria", filtro.categoria === tipo ? "" : tipo)
                }
                aria-pressed={filtro.categoria === tipo}
                className={`rounded-xl border bg-white p-4 text-left dark:bg-zinc-900 ${filtro.categoria === tipo ? "border-accent-400" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <span className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {TIPOS[tipo]}
                  <Icon className="h-4 w-4 text-accent-500" />
                </span>
                <strong className="mt-2 block text-[26px] font-semibold text-[#496a54] dark:text-zinc-100">
                  {status?.resumo[tipo] ?? 0}
                </strong>
              </button>
            ))}
          </div>
          <section className="surface-panel p-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input
                aria-label="Buscar publicações"
                placeholder="Buscar processo, cliente ou trecho…"
                value={buscaTexto}
                onChange={(e) => setBuscaTexto(e.target.value)}
              />
              <Select
                aria-label="Categoria da publicação"
                value={filtro.categoria}
                onChange={(e) => filtrar("categoria", e.target.value)}
              >
                <option value="">Todas as publicações</option>
                {Object.entries(TIPOS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
                <option value="outras">Outras · conferir inteiro teor</option>
              </Select>
              <Select
                aria-label="Resultado da sentença"
                value={filtro.resultado}
                onChange={(e) => filtrar("resultado", e.target.value)}
              >
                <option value="">Todos os resultados</option>
                {Object.entries(RESULTADOS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Advogado das publicações"
                value={filtro.advogado_id}
                onChange={(e) => filtrar("advogado_id", e.target.value)}
              >
                <option value="">Todos os advogados</option>
                {status?.advogados.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome} · {a.uf_oab} {a.numero_oab}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {total} publicação(ões) · {status?.resumo.nao_lidas ?? 0} não
                lidas
              </p>
              <Select
                className="max-w-[190px]"
                aria-label="Situação das publicações"
                value={filtro.situacao}
                onChange={(e) => filtrar("situacao", e.target.value)}
              >
                <option value="">Todas as situações</option>
                <option value="nao_lidas">Não lidas</option>
                <option value="revisar">A revisar</option>
              </Select>
            </div>
          </section>
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
                <article key={p.id} className="surface-panel p-5">
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
                          <Badge>Outra publicação</Badge>
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
                        {!p.lida && <Badge tone="accent">Não lida</Badge>}
                        {!p.revisada && <Badge tone="warning">A revisar</Badge>}
                        {Boolean(p.cancelada) && (
                          <Badge tone="danger">Cancelada na origem</Badge>
                        )}
                      </div>
                      <h2 className="mt-3 break-all text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {p.processo || "Processo não informado"}
                      </h2>
                      <p className="mt-1 text-[11px] text-zinc-500">
                        {p.tribunal} · {p.orgao} · Disponibilizada em{" "}
                        {dia(p.data_disponibilizacao)}
                      </p>
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
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => void abrir(p.id)}
                    >
                      Ver detalhes
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <Pagination
            page={filtro.pagina}
            totalItems={total}
            pageSize={25}
            onPageChange={(pagina) => setFiltro((f) => ({ ...f, pagina }))}
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
          <section className="surface-panel p-5">
            <h2 className="text-sm font-semibold">Últimas consultas</h2>
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
        open={Boolean(detalhe) && !mensagem}
        onClose={() => {
          if (!salvando) {
            detailSeq.current++;
            setDetalhe(null);
          }
        }}
        title="Detalhes da publicação e do processo"
        maxWidth="max-w-4xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setDetalhe(null)}>
              Fechar
            </Button>
            <Button
              onClick={compor}
              disabled={
                !detalhe?.revisada ||
                !detalhe.cliente_id ||
                Boolean(detalhe.cancelada) ||
                whatsapp.status !== "conectado"
              }
            >
              <Send className="h-3.5 w-3.5" />
              Avisar cliente pelo WhatsApp
            </Button>
          </>
        }
      >
        {detalhe && (
          <div className="space-y-5">
            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="break-all text-base font-semibold">
                {detalhe.processo || "Processo não informado"}
              </h3>
              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
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
            </div>
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
            <details open>
              <summary className="cursor-pointer text-sm font-semibold">
                Inteiro teor da publicação
              </summary>
              <p className="mt-3 max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 p-4 text-xs leading-relaxed [overflow-wrap:anywhere] dark:border-zinc-800">
                {detalhe.texto}
              </p>
            </details>
            <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <CheckCheck className="h-4 w-4" />
                Conferir classificação
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                A triagem usa sinais explícitos do documento. Confira o inteiro
                teor e confirme ou ajuste os tipos identificados.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {Object.entries(TIPOS).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={categorias.includes(key as Categoria)}
                      onChange={(e) =>
                        setCategorias((c) =>
                          e.target.checked
                            ? [...c, key as Categoria]
                            : c.filter((v) => v !== key),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              {categorias.includes("sentenca") && (
                <div className="mt-4">
                  <Label htmlFor="resultado-revisao">
                    Resultado da sentença
                  </Label>
                  <Select
                    id="resultado-revisao"
                    value={resultado}
                    onChange={(e) => setResultado(e.target.value as Resultado)}
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
                        { categorias, resultado },
                      );
                      setDetalhe(p);
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
            </section>
            <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold">
                Cliente e anotações do processo
              </h3>
              <div className="mt-3">
                <Label htmlFor="cliente-processo">
                  Contato da Agenda compartilhada
                </Label>
                <Select
                  id="cliente-processo"
                  value={processo.cliente_id}
                  onChange={(e) =>
                    setProcesso({ ...processo, cliente_id: e.target.value })
                  }
                >
                  <option value="">Selecione o cliente com segurança</option>
                  {contatos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome} · {formatPhoneDisplay(c.telefone)}
                      {c.processo ? ` · ${c.processo}` : ""}
                    </option>
                  ))}
                </Select>
                <Link
                  to="/agenda"
                  className="mt-2 inline-block text-xs text-accent-600"
                >
                  Abrir Agenda de contatos
                </Link>
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
                    setDetalhe(
                      await api.put<Publicacao>(
                        `/djen/publicacoes/${detalhe.id}/processo`,
                        {
                          ...processo,
                          cliente_id: processo.cliente_id
                            ? Number(processo.cliente_id)
                            : null,
                        },
                      ),
                    );
                    show("Dados do processo salvos.", "success");
                  })
                }
              >
                Salvar dados do processo
              </Button>
              <p className="mt-3 text-[11px] text-zinc-500">
                Para avisar o cliente, salve a revisão, vincule o contato e
                conecte o WhatsApp nas configurações compartilhadas.
              </p>
            </section>
            <section>
              <h3 className="text-sm font-semibold">
                Outras publicações capturadas deste processo
              </h3>
              <div className="mt-2 space-y-2">
                {detalhe.relacionadas
                  ?.filter((p) => p.id !== detalhe.id)
                  .map((p) => (
                    <button
                      key={p.id}
                      className="block text-left text-xs text-accent-600"
                      onClick={() => void abrir(p.id)}
                    >
                      {dia(p.data_disponibilizacao)} ·{" "}
                      {(JSON.parse(p.categorias_json) as Categoria[])
                        .map((c) => TIPOS[c])
                        .join(", ") || "Outra publicação"}
                    </button>
                  ))}
                {(detalhe.relacionadas?.length || 0) <= 1 && (
                  <p className="text-xs text-zinc-500">
                    Nenhuma outra publicação capturada para este processo.
                  </p>
                )}
              </div>
            </section>
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
              disabled={!mensagem?.texto.trim()}
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
