import "./Publicacoes.css";
import { ResumoPublicacao } from "@/components/djen/ResumoPublicacao";
import { ConferirCompromisso } from "@/components/djen/ConferirCompromisso";
import { useConfirmar } from "@/components/ui/useConfirmar";
import { HistoryCoverage, RegisterFulfillment, instanteBR, type CoberturaHistorico } from "@/components/djen/HistoryCoverage";
import { ActivityBadge, RegisterAction, type AtividadeProcesso } from "@/components/djen/ActivityBadge";
import { AcompanhamentosLista } from "@/components/djen/Acompanhamentos";
import { ProcessosSemVinculo } from "@/components/djen/ProcessosSemVinculo";
import { PainelDeDetalhes, useLargura } from "@/components/djen/PainelDeDetalhes";
import { ConcluirAndamento, FaixaDesfazer, dataBR as dataDoAndamento } from "@/components/djen/ConcluirAndamento";
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
  FileCheck2,
  Copy,
  Search,
  Plus,
  RefreshCw,
  ExternalLink,
  Send,
  CheckCheck,
  BriefcaseBusiness,
  AlertCircle,
  FolderOpen,
  Sparkles,
  Clock3,
  ArrowRight,
  ListFilter,
  CalendarDays,
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useAuth } from "@/context/AuthContext";
import { MonitoramentoDjen } from "@/components/djen/DjenMonitoramento";
import { AdvogadosAcompanhados } from "@/components/djen/DjenAdvogados";
import { Callout, SettingRow } from "@/components/ui/Settings";

/** A mensagem de aviso ao cliente: perícia e audiência dizem DATA, HORÁRIO e LOCAL (o essencial); os demais atos usam o texto geral. */
function textoDoAviso(nome: string, processo: string | null | undefined, categorias: string[], situacao: string, tiposTexto: string, ag?: { data: string | null; horario: string | null; local: string | null } | null) {
  const proc = processo || "acompanhado pelo escritório";
  const compromisso = categorias.includes("pericia") ? "perícia" : categorias.includes("audiencia") ? "audiência" : "";
  if (compromisso && ag?.data && ag?.horario) {
    return `Olá, ${nome}. Houve uma publicação no processo ${proc} informando que a ${compromisso} está marcada para ${dataPorExtenso(ag.data)}, às ${horaPorExtenso(ag.horario)}${ag.local ? `, em: ${ag.local}` : ""}.\n\nPor favor, confirme que recebeu esta mensagem. Nossa equipe vai orientar você sobre documentos e como comparecer.\n\nSales & Associados.`;
  }
  if (compromisso) {
    return `Olá, ${nome}. Houve uma publicação no processo ${proc} sobre ${compromisso === "perícia" ? "a sua perícia" : "a sua audiência"}. Nossa equipe vai confirmar a data e o horário e entrar em contato para orientar você.\n\nSales & Associados.`;
  }
  return `Olá, ${nome}. Houve uma nova publicação no processo ${proc}: ${situacao || tiposTexto || "andamento processual"}.\n\nNossa equipe está analisando o conteúdo para orientar você.\n\nSales & Associados.`;
}

type SinalDoCartao = { chave: string; texto: string; tom: "neutral" | "success" | "warning" | "danger" | "accent" | "info" | "violet" | "cyan" | "indigo"; peso: number; dica?: string };
/** Os sinais do cartão em ordem de importância: o que pede ação aparece primeiro; o resto fica recolhido em «+N sinais». */
function sinaisDoCartao(p: Publicacao): SinalDoCartao[] {
  const out: SinalDoCartao[] = [];
  const cats = p.categorias as string[];
  const ehCompromisso = cats.includes("pericia") || cats.includes("audiencia");
  const nomeCompromisso = cats.includes("audiencia") && !cats.includes("pericia") ? "Audiência" : "Perícia";
  if (Boolean(p.cancelada)) out.push({ chave: "cancelada", texto: "Cancelada na origem", tom: "danger", peso: 100 });
  if (p.compromisso_estado === "completar") out.push({ chave: "completar", texto: `⚠ ${p.compromisso_tipo === "audiencia" ? "Audiência" : "Perícia"}: completar dados para avisar`, tom: "warning", peso: 98, dica: p.compromisso_motivo });
  else if (Boolean(p.prioridade_compromisso)) out.push({ chave: "marcada", texto: `● ${nomeCompromisso} marcada · revisar agora`, tom: "danger", peso: 99 });
  if (p.compromisso_estado === "informado") out.push({ chave: "no-controle", texto: "Registrado no controle · conferir aviso", tom: "success", peso: 60 });
  if (p.ia_status === "erro" && !p.revisada) out.push({ chave: "ia-falhou", texto: "IA falhou · revisão necessária", tom: "danger", peso: 95, dica: p.ia_erro ?? undefined });
  if (p.ia_status === "concluida" && p.ia_provedor === "regra" && !p.revisada) out.push({ chave: "regra", texto: "Provisória por regra · conferir", tom: "warning", peso: 94, dica: "A IA não concluiu; uma regra de segurança leu o texto. Confira data, horário e local." });
  if (p.pericia_controle && ehCompromisso) {
    const st = p.pericia_controle.status;
    const texto = st === "duplicidade" ? "Já informada · duplicidade" : st === "redesignacao" ? "Possível redesignação" : st === "cadastrada_nao_informada" ? "No calendário · sem confirmação de aviso" : st === "cadastrada_a_conferir" ? "No calendário · conferir local" : st === "nao_cadastrada" ? "Ainda fora do controle de perícias" : "Dados da perícia incompletos";
    out.push({ chave: "controle", texto, tom: st === "duplicidade" ? "success" : st === "redesignacao" ? "warning" : st === "cadastrada_nao_informada" ? "info" : "neutral", peso: st === "dados_incompletos" ? 90 : 55 });
  }
  if (!p.lida) out.push({ chave: "nao-lida", texto: "● Não lida", tom: "accent", peso: 70 });
  if (Boolean(p.concluida)) out.push({ chave: "concluida", texto: "Concluída", tom: "success", peso: 65 });
  if (p.ia_status === "concluida" && p.ia_provedor !== "regra" && !p.revisada) out.push({ chave: "sugestao", texto: "Sugestão da IA · a conferir", tom: "info", peso: 50, dica: "Classificação sugerida pela IA, ainda não conferida por uma pessoa." });
  if (p.ia_status === "pendente" || p.ia_status === "analisando") out.push({ chave: "andamento", texto: "Classificação em andamento", tom: "neutral", peso: 30 });
  if (p.revisada) out.push({ chave: "revisada", texto: "Revisada por pessoa", tom: "success", peso: 20 });
  for (const c of p.categorias) out.push({ chave: `cat-${c}`, texto: TIPOS[c], tom: (tons[c] as SinalDoCartao["tom"]) ?? "neutral", peso: 40 });
  if (!p.categorias.length) out.push({ chave: "cat-outros", texto: "Outros", tom: "neutral", peso: 35 });
  if (cats.includes("sentenca")) out.push({ chave: "resultado", texto: RESULTADOS[p.resultado], tom: p.resultado === "nao_identificado" ? "neutral" : "info", peso: 45 });
  return out.sort((a, b) => b.peso - a.peso);
}

const MESES_EXTENSO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_DA_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
/** «2026-11-30», «30/11/2026» ou «30 de novembro de 2026» → «30 de novembro de 2026 (segunda-feira)». Texto que não for data fica como veio. */
function dataPorExtenso(valor: string | null | undefined): string {
  if (!valor) return "";
  const v = valor.trim();
  let d = 0, m = 0, a = 0;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const br = v.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/);
  if (iso) { a = +iso[1]!; m = +iso[2]!; d = +iso[3]!; }
  else if (br) { d = +br[1]!; m = +br[2]!; a = +br[3]!; }
  else return v;
  if (m < 1 || m > 12 || d < 1 || d > 31) return v;
  const semana = DIAS_DA_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${d} de ${MESES_EXTENSO[m - 1]} de ${a} (${semana})`;
}
/** «09:00» → «9h»; «16:30» → «16h30». */
function horaPorExtenso(valor: string | null | undefined): string {
  if (!valor) return "";
  const m = valor.trim().match(/^(\d{1,2})\s*(?::|h)\s*(\d{2})?/);
  if (!m) return valor.trim();
  const min = m[2] && m[2] !== "00" ? m[2] : "";
  return `${Number(m[1])}h${min}`;
}

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
  recurso: "Recurso / contrarrazões",
  transito_julgado: "Trânsito em julgado",
  emenda_inicial: "Emenda à inicial",
  citacao_contestacao: "Citação / contestação",
  audiencia: "Audiência",
  implantacao_beneficio: "Implantação do benefício",
  calculos: "Cálculos / contadoria",
  vista_laudo: "Vista do laudo",
  arquivamento: "Arquivamento",
};
const FILTROS = { ...TIPOS, outros: "Outros" };
const ROTULO_SITUACAO: Record<string, string> = { vigente: "Em aberto", decorrido: "Prazo decorrido", cumprida: "Cumprida", superada: "Superada por andamento posterior", revogada: "Revogada" };
const FILTROS_RAPIDOS = [
  ["sentenca", "Sentença"],
  ["acordao", "Acórdão"],
  ["pericia", "Perícia agendada"],
  ["laudo_juntado", "Laudo juntado"],
  ["proposta_acordo", "Proposta de acordo"],
  ["homologacao_acordo", "Acordo homologado"],
  ["rpv", "RPV"],
  ["levantamento_valores", "Levantamento de valores"],
] as const;
type Categoria = keyof typeof TIPOS;
const RESULTADOS = {
  nao_identificado: "Resultado não identificado",
  procedente: "Procedente",
  improcedente: "Improcedente",
  parcial: "Parcialmente procedente",
};
type Resultado = keyof typeof RESULTADOS;
export interface Advogado {
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
export interface Publicacao {
  revisada_por_nome?: string | null;
  revisada_em?: string | null;
  triagem?: {
    prioridade: number; data_prioridade: string | null; motivo: string; vencido: boolean; vence_hoje: boolean;
    compromisso_proximo: boolean; conferencia_pendente: boolean; prazo_a_lancar: boolean; dados_incompletos: boolean; prazo_aberto: boolean;
    responsavel_id: number | null; responsavel_nome: string | null; gestao_processo_id: number | null;
    compromisso: { tipo: "pericia" | "audiencia"; data: string | null; horario: string | null; local: string | null; registro_id: number | null; avisado: boolean } | null;
  } | null;
  prioridade_compromisso?: number;
  compromisso_estado?: string;
  compromisso_motivo?: string;
  compromisso_tipo?: string;
  captured_at?: string;
  historico_djen?: CoberturaHistorico;
  atividade?: AtividadeProcesso | null;
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
  ia_provedor?: string | null;
  ia_modelo?: string | null;
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
  acao?: {
    fonte?: "publicacao" | "ia" | "nao_confirmada";
    tipo: "ciencia" | "cumprimento" | "prazo_explicito";
    descricao: string | null;
    prazo_texto: string | null;
    publicacao_id?: number;
    data_disponibilizacao?: string;
    situacao?: "vigente" | "decorrido" | "cumprida" | "superada" | "revogada";
    situacao_motivo?: string;
    encerradas?: { publicacao_id?: number; descricao: string | null; situacao: string; motivo: string; evidencia?: string | null; data: string | null }[];
  };
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
  historico_djen?: CoberturaHistorico;
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
  publicacoes_posteriores?: number;
  ultima_publicacao_em?: string | null;
}
interface PrazoEscritorio {
  publicacao_id: number; processo: string; cliente_nome: string | null; descricao: string; prazo_texto: string;
  data_disponibilizacao: string; termino: string | null; origem_data: "salvo" | "previsto" | "estimativa" | "decorrido";
  dias_para_vencer: number | null; urgencia: "vencido" | "vence_em_breve" | "decorrido";
  situacao: string; situacao_motivo: string; historico_djen: CoberturaHistorico;
}
interface ProcessoParado {
  publicacao_id: number; processo: string; cliente_nome: string | null; ultima_publicacao_em: string; dias_parado: number;
  ultimo_andamento: string; ultimo_tipo: string | null; historico_djen: CoberturaHistorico;
}
interface PericiaSuperada {
  pericia_id: number;
  nome: string;
  processo: string;
  data: string;
  horario: string | null;
  motivo: string;
  andamento: string | null;
  data_andamento: string | null;
}
export interface AguardandoRetorno {
  assunto?: "honorarios_periciais" | null;
  captured_at?: string;
  historico_djen?: CoberturaHistorico;
  publicacao_id: number;
  tipo: "aguardo_juizo" | "perito_laudo" | "perito_esclarecimentos" | "perito_calculos" | "inss_implantacao" | "parte_contraria" | "terceiro_oficio";
  responsavel: string;
  processo: string;
  cliente_nome: string | null;
  data_disponibilizacao: string;
  dias_decorridos: number;
  dias_espera: number | null;
  prazo_texto?: string | null;
  prazo_termino?: string | null;
  prazo_pendente?: boolean;
  prazo_observacao?: string;
  prazo_citado_dias: number | null;
  motivo: string;
  resumo: string;
  acompanhamento_status: "pendente" | "cobrado";
  ultima_cobranca_em: string | null;
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
export interface Status {
  historicos_djen?: { total: number; atualizados: number | null };
  ia: {
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
  pericias_sem_laudo_conferidas?: number;
  aguardando_retorno_conferidos?: number;
  prazos_escritorio?: number;
  processos_parados?: number;
  aguardando_retorno: number;
  config: {
    automatico: number;
    intervalo_minutos: number;
    janela_inicial_dias: number;
    ia_ativa: number;
    ia_paralelismo: number;
    ia_modo: "economico" | "equilibrado" | "precisao";
    aguardo_dias: number;
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
  recurso: "info",
  transito_julgado: "neutral",
  emenda_inicial: "warning",
  citacao_contestacao: "violet",
  audiencia: "violet",
  implantacao_beneficio: "success",
  calculos: "accent",
  vista_laudo: "warning",
  arquivamento: "neutral",
} as const;
const UFS =
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  );

export function Acompanhamento(props: { detailId?: number; onCloseDetail?: () => void } = {}) {
  const { can } = useAuth();
  return can("processes.manage") ? <AcompanhamentoEditor {...props} /> : <PublicacoesConsulta {...props} />;
}

function PublicacoesConsulta({ detailId, onCloseDetail }: { detailId?: number; onCloseDetail?: () => void }) {
  const { can } = useAuth();
  const { search } = useLocation();
  const abrirId = Number(new URLSearchParams(search).get("abrir"));
  useEffect(() => { if (!detailId && abrirId > 0) void abrirConsulta(abrirId); }, [detailId, abrirId]);
  const [items, setItems] = useState<Publicacao[]>([]);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [total, setTotal] = useState(0);
  const [erroConsulta, setErroConsulta] = useState("");
  const [detalhe, setDetalhe] = useState<Publicacao | null>(null);
  const [aba, setAba] = useState("publicacao");
  const sequencia = useRef(0);
  const [carregando, setCarregando] = useState(false);
  async function abrirConsulta(id: number) {
    const atual = ++sequencia.current;
    setCarregando(true);
    try { const p = await api.get<Publicacao>(`/djen/publicacoes/${id}`); if (atual === sequencia.current) { setDetalhe(p); setAba("publicacao"); setErroConsulta(""); } }
    catch (e) { if (atual === sequencia.current) setErroConsulta(erro(e)); }
    finally { if (atual === sequencia.current) setCarregando(false); }
  }
  useEffect(() => {
    if (detailId) { void abrirConsulta(detailId); return; }
    let ativa = true;
    const timer = window.setTimeout(() => {
      api.get<{ items: Publicacao[]; total: number }>(`/djen/publicacoes?${new URLSearchParams({ busca, pagina: String(pagina + 1), arquivo: "ativos", agrupamento: "andamentos" })}`)
        .then(r => { if (ativa) { setItems(r.items); setTotal(r.total); setErroConsulta(""); } })
        .catch(e => { if (ativa) setErroConsulta(erro(e)); });
    }, 250);
    return () => { ativa = false; window.clearTimeout(timer); };
  }, [busca, pagina, detailId]);
  function fecharConsulta() { sequencia.current++; setDetalhe(null); setCarregando(false); onCloseDetail?.(); }
  return <div className="publicacoes-page space-y-4">
    {!detailId && <><PageHeader title="Publicações" description="Consulta dos andamentos e documentos do escritório." />
    <Input aria-label="Buscar publicações" placeholder="Buscar cliente, processo ou trecho…" value={busca} onChange={e => { setBusca(e.target.value); setPagina(0); }} />
    <p className="text-xs text-zinc-500">{total} andamento(s) encontrado(s)</p>
    <div className="desk desk-readonly"><div className="desk-queue">{items.map(p => <button type="button" key={p.id} className="desk-row desk-row-main" onClick={() => void abrirConsulta(p.id)}><span className="desk-row-top"><span>{p.tipo_documento}</span><span>{p.triagem?.data_prioridade ? dia(p.triagem.data_prioridade) : dia(p.data_disponibilizacao)}</span></span><strong className="desk-row-cliente">{p.cliente_exibicao || p.processo}</strong><span className="desk-row-processo">{p.processo}</span><span className="desk-row-proximo">{p.triagem?.motivo || p.situacao}</span></button>)}</div></div>
    <Pagination page={pagina} totalItems={total} pageSize={25} onPageChange={setPagina} /></>}
    {erroConsulta && <p role="alert" className="text-sm text-red-700">{erroConsulta}</p>}
    <Modal open={Boolean(detalhe) || carregando} onClose={fecharConsulta} title="Consultar publicação" maxWidth="max-w-4xl" footer={<Button variant="outline" onClick={fecharConsulta}>Voltar à fila</Button>}>
      {carregando ? <p role="status">Carregando publicação…</p> : detalhe && <div className="space-y-4"><header className="pub-detail-heading"><h2>{detalhe.cliente_exibicao || detalhe.processo}</h2><p>{detalhe.processo} · {detalhe.tribunal}</p></header>
      <nav className="flex gap-3 border-b" aria-label="Seções da publicação"><Button variant={aba === "publicacao" ? "primary" : "ghost"} size="sm" onClick={() => setAba("publicacao")}>Publicação</Button>{can("deadlines.view") && <Button variant={aba === "prazos" ? "primary" : "ghost"} size="sm" onClick={() => setAba("prazos")}>Prazos</Button>}<Button variant={aba === "historico" ? "primary" : "ghost"} size="sm" onClick={() => setAba("historico")}>Histórico</Button></nav>
      {aba === "publicacao" && <><p className="pub-fulltext">{detalhe.texto}</p><DjenDocumentos id={detalhe.id} certidao={detalhe.certidao_url} tribunal={detalhe.link} documentos={detalhe.documentos} refresh={async () => {}} /></>}
      {aba === "prazos" && <div className="space-y-3">{detalhe.prazos?.length ? detalhe.prazos.map(p => <article key={p.id} className="pub-source"><strong>{p.descricao}</strong><p>{dia(p.inicio || "")} a {dia(p.termino || "")} · {p.status}</p></article>) : <p className="text-xs">Nenhum prazo cadastrado neste andamento.</p>}</div>}
      {aba === "historico" && <DjenHistorico id={detalhe.id} eventos={detalhe.historico} andamentos={detalhe.relacionadas} tipos={TIPOS} total={detalhe.relacionadas_total} abrir={id => void abrirConsulta(id)} />}
      </div>}
    </Modal>
  </div>;
}

function AcompanhamentoEditor({ detailId, onCloseDetail }: { detailId?: number; onCloseDetail?: () => void } = {}) {
  const { user, can } = useAuth();
  const { confirmar, dialogo } = useConfirmar();
  const [conferirCompromisso, setConferirCompromisso] = useState<Publicacao | null>(null);
  const [responsaveis, setResponsaveis] = useState<{ id: number; nome: string }[]>([]);
  const [totalProcessos, setTotalProcessos] = useState(0);
  const quickFiltersKey = `djen-quick-filters:${user.id}`;
  const [quickFilters, setQuickFilters] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(quickFiltersKey) || "null");
      if (Array.isArray(saved)) return [...new Set(saved.filter((key): key is string => typeof key === "string" && key in FILTROS))];
    } catch { /* Usa os atalhos iniciais se o armazenamento estiver indisponível. */ }
    return FILTROS_RAPIDOS.map(([key]) => key);
  });
  const [quickFiltersOpen, setQuickFiltersOpen] = useState(false);
  const [quickFiltersDraft, setQuickFiltersDraft] = useState<string[]>([]);
  const [consultaAberta, setConsultaAberta] = useState(false);
  const [aguardandoAberto, setAguardandoAberto] = useState(false);
  const { pathname, search } = useLocation(),
    navigate = useNavigate(),
    { show } = useToast(),
    whatsapp = useWhatsapp();
  const secao = detailId ? "detalhes" : pathname.endsWith("/advogados")
    ? "advogados"
    : pathname.endsWith("/monitoramento")
      ? "monitoramento"
      : pathname.endsWith("/aguardando")
        ? "aguardando"
      : "publicacoes";
  const [status, setStatus] = useState<Status | null>(null),
    [items, setItems] = useState<Publicacao[]>([]),
    [total, setTotal] = useState(0),
    [carregando, setCarregando] = useState(true),
    [falha, setFalha] = useState("");
  const filtroKey = `publicacoes-filtros:${user.id}`;
  const [filtro, setFiltro] = useState(() => {
    const inicial = {
      agrupamento: "andamentos",
      prioridade: "",
      responsavel: "",
      categoria: "",
      resultado: "",
      advogado_id: "",
      situacao: "",
      arquivo: "ativos",
      busca: "",
      pagina: 1,
    };
    try {
      const salvo = JSON.parse(sessionStorage.getItem(filtroKey) || "null");
      if (salvo && typeof salvo === "object") for (const chave of Object.keys(inicial) as (keyof typeof inicial)[]) {
        if (typeof salvo[chave] === typeof inicial[chave]) Object.assign(inicial, { [chave]: salvo[chave] });
      }
    } catch { /* A consulta funciona também sem armazenamento local. */ }
    inicial.agrupamento = "andamentos";
    inicial.pagina = Math.max(1, Math.floor(inicial.pagina) || 1);
    return inicial;
  });
  const [buscaTexto, setBuscaTexto] = useState(filtro.busca);
  useEffect(() => { try { sessionStorage.setItem(filtroKey, JSON.stringify(filtro)); } catch { /* Sem persistência local. */ } }, [filtro, filtroKey]);
  const filtroAtualRef = useRef(filtro);
  filtroAtualRef.current = filtro;
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
    aguardo_dias: 30,
  });
  const [revisaoAlterada, setRevisaoAlterada] = useState(false);
  const [situacao, setSituacao] = useState("");
  const [abaDetalhe, setAbaDetalhe] = useState<
    "resumo" | "publicacao" | "prazos" | "cliente" | "historico"
  >("resumo");
  const [detalhe, setDetalhe] = useState<Publicacao | null>(null),
    [detalheAberto, setDetalheAberto] = useState(false),
    [carregandoDetalhe, setCarregandoDetalhe] = useState(false),
    [previaDetalhe, setPreviaDetalhe] = useState<Publicacao | null>(null),
    [contatos, setContatos] = useState<Contact[]>([]),
    [categorias, setCategorias] = useState<Categoria[]>([]),
    [resultado, setResultado] = useState<Resultado>("nao_identificado"),
    [processo, setProcesso] = useState({ cliente_id: "", observacoes: "" });
  const [confirmacaoEnvio, setConfirmacaoEnvio] = useState(false);
  const [mostrarSemLaudo, setMostrarSemLaudo] = useState(false);
  const [diagnostico, setDiagnostico] = useState<{ pericias: { ativas: number; sem_processo: number; futuras: number; menos_60_dias: number }; publicacoes: number; ordens_externas: number; aguardo_dias: number } | null>(null);
  const [periciasSemLaudo, setPericiasSemLaudo] = useState<PericiaSemLaudo[]>([]);
  const [periciasSuperadas, setPericiasSuperadas] = useState<PericiaSuperada[]>([]);
  const [prazosEscritorio, setPrazosEscritorio] = useState<PrazoEscritorio[]>([]);
  const [processosParados, setProcessosParados] = useState<ProcessoParado[]>([]);
  const [alertaAberto, setAlertaAberto] = useState<"prazos" | "parados" | null>(null);
  const [carregandoAlerta, setCarregandoAlerta] = useState(false);
  const [diasParado, setDiasParado] = useState(60);
  const [aguardando, setAguardando] = useState<AguardandoRetorno[]>([]);
  const [superados, setSuperados] = useState<(AguardandoRetorno & { motivo_superada: string; ultimo_andamento_em: string | null })[]>([]);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [confirmarLote, setConfirmarLote] = useState(false);
  const [alvoDetalhe, setAlvoDetalhe] = useState<HTMLElement | null>(null);
  const [maisFiltros, setMaisFiltros] = useState(false);
  const largo = useLargura(1100);
  const detalheAoLado = largo && !detailId && secao === "publicacoes" && alvoDetalhe !== null;
  const [concluindo, setConcluindo] = useState<{ id: number; rotulo: string; total: number } | null>(null);
  const [desfazer, setDesfazer] = useState<{ escopo: "andamento" | "processo"; total: number; publicacaoId: number; ids?: number[] } | null>(null);
  const [bloqueioLote, setBloqueioLote] = useState<{ pendencias: { publicacao_id: number; texto: string }[]; total: number } | null>(null);
  const [justificativaLote, setJustificativaLote] = useState("");
  const [removerAdv, setRemoverAdv] = useState<Advogado | null>(null);
  const [selecionandoTodos, setSelecionandoTodos] = useState(false);
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
  const prefetchRef = useRef(new Map<number, { request: Promise<Publicacao>; started: number }>());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function carregarDetalhe(id: number) {
    const cached = prefetchRef.current.get(id);
    if (cached && Date.now() - cached.started < 15_000) return cached.request;
    const request = api.get<Publicacao>(`/djen/publicacoes/${id}`);
    prefetchRef.current.set(id, { request, started: Date.now() });
    void request.catch(() => prefetchRef.current.delete(id));
    return request;
  }
  function anteciparDetalhe(id: number) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => { void carregarDetalhe(id).catch(() => {}); }, 150);
  }
  const [urgencia, setUrgencia] = useState<{ pendentes: number; precisam_conferencia: number; vencidos: number; vencem_hoje: number; compromissos_7_dias: number; datas_a_confirmar: number; prazo_a_lancar: number; novas_para_triagem: number } | null>(null);
  const carregarStatus = useCallback(async () => {
    const data = await api.get<Status>("/djen/status");
    setStatus(data);
    void api.get<NonNullable<typeof urgencia>>("/djen/urgencia").then(setUrgencia).catch(() => setUrgencia(null));
    return data;
  }, []);
  useEffect(() => {
    if (can("gestao.view")) void api.get<{ id: number; nome: string }[]>("/gestao/responsaveis").then(setResponsaveis).catch(() => setResponsaveis([]));
  }, [can]);
  const carregarSemLaudo = useCallback(async () => {
    setCarregandoSemLaudo(true);
    void api.get<NonNullable<typeof diagnostico>>("/djen/acompanhamentos/diagnostico").then(setDiagnostico).catch(() => setDiagnostico(null));
    try {
      const [alertas, superadas] = await Promise.all([
        api.get<PericiaSemLaudo[]>("/djen/pericias/sem-laudo?dias=60"),
        api.get<PericiaSuperada[]>("/djen/pericias/sem-laudo/superadas?dias=60").catch(() => [] as PericiaSuperada[]),
      ]);
      setPericiasSemLaudo(alertas);
      setPericiasSuperadas(superadas);
    } finally {
      setCarregandoSemLaudo(false);
    }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(search);
    const id = Number(params.get("abrir"));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    params.delete("abrir");
    navigate({ pathname, search: params.toString() }, { replace: true });
    void abrir(id);
  // A abertura é acionada apenas por mudança de URL, não por cada atualização da lista.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, pathname, navigate]);
  useEffect(() => {
    const parametros = new URLSearchParams(search);
    if (parametros.get("semLaudo") !== "1") return;
    setMostrarSemLaudo(true);
    void carregarSemLaudo().catch(() => setFalha("Não foi possível carregar as perícias sem laudo."));
    parametros.delete("semLaudo");
    navigate({ pathname, search: parametros.toString() }, { replace: true });
  }, [search, pathname, navigate, carregarSemLaudo]);
  const carregarAlerta = useCallback(async (tipo: "prazos" | "parados", dias = 60) => {
    setAlertaAberto(tipo);
    setCarregandoAlerta(true);
    try {
      if (tipo === "prazos") setPrazosEscritorio(await api.get<PrazoEscritorio[]>("/djen/prazos/escritorio"));
      else setProcessosParados(await api.get<ProcessoParado[]>(`/djen/processos/parados?dias=${dias}`));
    } finally {
      setCarregandoAlerta(false);
    }
  }, []);
  const carregarAguardando = useCallback(async () => {
    void api.get<NonNullable<typeof diagnostico>>("/djen/acompanhamentos/diagnostico").then(setDiagnostico).catch(() => setDiagnostico(null));
    void api.get<typeof superados>("/djen/aguardando/superados").then(setSuperados).catch(() => setSuperados([]));
    setAguardando(await api.get<AguardandoRetorno[]>("/djen/aguardando"));
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
      const r = await api.get<{ items: Publicacao[]; total: number; total_processos?: number }>(
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
        setTotalProcessos(r.total_processos ?? r.total);
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
    if (secao === "aguardando")
      void carregarAguardando().catch((e) => setFalha(erro(e)));
  }, [carregarAguardando, secao]);
  useEffect(() => {
    const timer = setTimeout(
      () => setFiltro((f) => f.busca === buscaTexto ? f : ({ ...f, busca: buscaTexto, pagina: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [buscaTexto]);
  useEffect(() => {
    if (
      !status?.executando &&
      !status?.ia.executando &&
      !(
        status?.config.ia_ativa &&
        (status.ia.executando || status.ia.pendentes) &&
        !status.ia.pausa
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
      (!detalhe.ia_manual && (!status?.config.ia_ativa || status.ia.pausa))
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
  }, [detalhe, status?.config.ia_ativa, status?.ia.pausa, revisaoAlterada]);
  const atualizarEmTempoReal = useCallback(() => {
    prefetchRef.current.clear();
    void carregarStatus().catch((e) => setFalha(erro(e)));
    if (secao === "publicacoes") void carregarLista();
    if (secao === "aguardando") void carregarAguardando();
  }, [carregarStatus, carregarLista, carregarAguardando, secao]);
  useSocketEvent("djen:changed", atualizarEmTempoReal);
  useSocketEvent("connect", atualizarEmTempoReal);
  const filtrar = (key: string, value: string) =>
    setFiltro((f) => ({ ...f, [key]: value, pagina: 1 }));
  useEffect(() => setSelecionados([]), [filtro.categoria, filtro.resultado, filtro.advogado_id, filtro.situacao, filtro.arquivo, filtro.busca, filtro.prioridade, filtro.responsavel]);
  const tiposAguardando: Record<AguardandoRetorno["tipo"] | "honorarios_periciais", string> = {
    honorarios_periciais: "Honorários periciais (antecipação)",
    aguardo_juizo: "Aguardando juízo", perito_laudo: "Laudo pelo perito",
    perito_esclarecimentos: "Esclarecimentos do perito", perito_calculos: "Cálculos periciais",
    inss_implantacao: "Implantação pelo INSS", parte_contraria: "Manifestação da outra parte", terceiro_oficio: "Resposta de terceiro (ofício)",
  };
  const itensSelecionaveis = items.filter(p => !p.concluida);
  const paginaSelecionada = itensSelecionaveis.length > 0 && itensSelecionaveis.every(item => selecionados.includes(item.id));
  async function selecionarTodosFiltrados() {
    setSelecionandoTodos(true);
    try {
      const filtroSolicitado = JSON.stringify({ ...filtro, pagina: 1 });
      const q = new URLSearchParams(Object.fromEntries(Object.entries(filtro).map(([k, v]) => [k, String(v)])));
      const resposta = await api.get<{ ids: number[]; total: number }>(`/djen/publicacoes/ids?${q}`);
      if (JSON.stringify({ ...filtroAtualRef.current, pagina: 1 }) !== filtroSolicitado) return;
      setSelecionados(resposta.ids);
      show(`${resposta.total} andamento(s) selecionado(s) neste filtro.`, "success");
    } catch (e) { show(erro(e), "error"); }
    finally { setSelecionandoTodos(false); }
  }
  async function concluirSelecionados(forcar = false) {
    setSalvando(true);
    try {
      const resultado = await api.post<{ processos: number; publicacoes: number }>("/djen/publicacoes/conclusao-em-lote", { ids: selecionados, escopo: "andamentos", ...(forcar ? { forcar: true, justificativa: justificativaLote.trim() } : {}) });
      setConfirmarLote(false);
      setBloqueioLote(null);
      setJustificativaLote("");
      setSelecionados([]);
      await carregarLista();
      await carregarStatus();
      show(`${resultado.publicacoes} andamento(s) concluído(s).`, "success");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.bloqueada) {
        setConfirmarLote(false);
        setBloqueioLote({ pendencias: (e.data.pendencias as { publicacao_id: number; texto: string }[]) ?? [], total: Number(e.data.total ?? 0) });
      } else show(erro(e), "error");
    }
    finally { setSalvando(false); }
  }
  async function desfazerConclusao() {
    if (!desfazer) return;
    const info = desfazer;
    setDesfazer(null);
    try {
      await api.post(`/djen/publicacoes/${info.publicacaoId}/conclusao`, { concluida: false, escopo: info.escopo, ids: info.ids });
      await carregarLista();
      await carregarStatus();
      show("Conclusão desfeita.", "success");
    } catch (e) { show(erro(e), "error"); }
  }
  async function acao(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setSalvando(true);
    try {
      await fn();
    } catch (e) {
      show(erro(e), "error");
    } finally {
      prefetchRef.current.clear();
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
  const [semVinculoAberto, setSemVinculoAberto] = useState(false);
  async function abrir(id: number) {
    if ((revisaoAlterada || Boolean(detalhe && (processo.cliente_id !== String(detalhe.cliente_id || "") || processo.observacoes !== detalhe.observacoes))) && !(await confirmar({ titulo: "Há uma revisão em edição", mensagem: "Descartar as alterações ainda não salvas para abrir outro andamento?", confirmar: "Descartar e abrir" }))) return;
    const current = ++detailSeq.current;
    setDetalhe(null);
    setPreviaDetalhe(items.find((p) => p.id === id) || null);
    setDetalheAberto(true);
    setCarregandoDetalhe(true);
    try {
      // A lista de contatos pode ser grande; o painel não depende dela para abrir.
      if (!contatos.length && can("contacts.view")) void api.get<Contact[]>("/contacts").then((contacts) => {
        if (current === detailSeq.current) setContatos(contacts);
      }).catch(() => { /* A aba de cliente pode ser recarregada na próxima abertura. */ });
      const p = await carregarDetalhe(id);
      if (current !== detailSeq.current) return;
      setDetalhe(p);
      setPreviaDetalhe(null);
      setCarregandoDetalhe(false);
      setAbaDetalhe("resumo");
      setRevisaoAlterada(false);
      setCategorias(p.categorias);
      setSituacao(p.situacao || "");
      setResultado(p.resultado);
      setProcesso({
        cliente_id: p.cliente_id ? String(p.cliente_id) : "",
        observacoes: p.observacoes || "",
      });

    } catch (e) {
      if (current !== detailSeq.current) return;
      setCarregandoDetalhe(false);
      setDetalheAberto(false);
      show(erro(e), "error");
      if (detailId) onCloseDetail?.();
    }
  }
  async function compor() {
    if (!detalhe) return;
    const contato = contatos.find(c => String(c.id) === processo.cliente_id) || (String(detalhe.cliente_id) === processo.cliente_id && detalhe.cliente_nome && detalhe.cliente_telefone ? { id: detalhe.cliente_id!, nome: detalhe.cliente_nome, telefone: detalhe.cliente_telefone } : null);
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
    if (!detalhe.revisada || revisaoAlterada) {
      setAbaDetalhe("resumo");
      show("Salve a conferência da classificação antes de preparar o aviso.", "info");
      document.getElementById("classificacao-publicacao")?.setAttribute("open", "");
      return;
    }
    if (Number(processo.cliente_id) !== detalhe.cliente_id) {
      setAbaDetalhe("cliente"); show("Salve o vínculo do cliente antes de preparar o aviso.", "info"); return;
    }
    setConfirmacaoEnvio(false);
    setMensagem({
      cliente_id: contato.id,
      cliente_nome: contato.nome,
      telefone: contato.telefone,
      request_id:
        globalThis.crypto?.randomUUID?.() ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      texto: textoDoAviso(contato.nome, detalhe.processo, categorias.map((c) => String(c)), situacao, categorias.map((c) => TIPOS[c]).join(", "), detalhe.triagem?.compromisso || detalhe.analise?.agendamento),
    });
  }
  async function enviar() {
    if (!mensagem || !detalhe || lock.current || !confirmacaoEnvio) return;
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
  useEffect(() => {
    if (!detailId) return;
    void abrir(detailId);
    return () => { detailSeq.current++; };
  }, [detailId]);
  async function copiarDetalhe(texto: string, nome: string) {
    try { await navigator.clipboard.writeText(texto); show(`${nome} copiado.`, "success"); }
    catch { show("Não foi possível copiar. Selecione o texto e use Ctrl+C.", "error"); }
  }
  async function fecharDetalhe() { if ((revisaoAlterada || Boolean(detalhe && (processo.cliente_id !== String(detalhe.cliente_id || "") || processo.observacoes !== detalhe.observacoes))) && !(await confirmar({ titulo: "Há uma revisão em edição", mensagem: "Descartar as alterações ainda não salvas e fechar este andamento?", confirmar: "Descartar e fechar" }))) return; if (!salvando) { detailSeq.current++; if (detalhe) prefetchRef.current.delete(detalhe.id); setDetalheAberto(false); setCarregandoDetalhe(false); setDetalhe(null); setPreviaDetalhe(null); onCloseDetail?.(); } }
  const conteudoAguardando = (
    <AcompanhamentosLista itens={aguardando} superados={superados} tipos={tiposAguardando} diasPadrao={status?.config.aguardo_dias ?? 30} diagnostico={diagnostico ? { publicacoes: diagnostico.publicacoes, ordens_externas: diagnostico.ordens_externas } : null} ocupado={salvando}
      onAbrir={(id) => void abrir(id)} onAtualizar={async () => { await carregarAguardando(); await carregarStatus(); }}
      onCobrado={(item) => void acao(async () => {
        await api.put(`/djen/aguardando/${item.publicacao_id}`, { tipo: item.tipo, status: "cobrado" });
        await carregarAguardando(); await carregarStatus(); show("Cobrança marcada como realizada. Nenhuma mensagem foi enviada.", "success");
      })} />
);
  const titulo =
    secao === "advogados"
      ? "Advogados acompanhados"
      : secao === "monitoramento"
        ? "Monitoramento DJEN"
        : secao === "aguardando"
          ? "Acompanhamentos"
        : "Publicações processuais";
  return (
    <div className={secao === "publicacoes" ? "publicacoes-page" : "space-y-5"}>
      {dialogo}
      <ConferirCompromisso publicacao={conferirCompromisso} aoFechar={() => setConferirCompromisso(null)} aoSalvar={(p) => {
        setDetalhe(p); setCategorias(p.categorias); setSituacao(p.situacao || ""); setResultado(p.resultado); setRevisaoAlterada(false);
        void carregarLista(); void carregarStatus();
        show(p.compromisso_estado === "informado" ? "Compromisso registrado no controle. Confira o aviso ao cliente." : p.compromisso_motivo || "Dados conferidos.", p.compromisso_estado === "informado" ? "success" : "info");
      }} />
      <div hidden={Boolean(detailId)} className="space-y-3">
      {status?.historicos_djen && status.historicos_djen.total > (status.historicos_djen.atualizados || 0) && <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">{status.historicos_djen.total - (status.historicos_djen.atualizados || 0)} histórico(s) aguardando atualização ou conferência no DJEN. Esses casos não são contados como atraso confirmado.</p>}
      <PageHeader
        title={titulo}
        description={
          secao === "publicacoes"
            ? "Decisões, acordos, pagamentos, perícias e demais andamentos dos processos."
            : secao === "aguardando"
              ? "O que estamos esperando de alguém: juízo, peritos, INSS e a outra parte. Comece pelo que precisa de atenção."
            : secao === "advogados"
              ? "Quem o escritório acompanha no DJEN. Pause, edite ou consulte cada advogado pelo menu ⋯."
              : "Situação da sincronização com o DJEN, busca automática e análise por IA."
        }
        actions={
          secao === "advogados" ? undefined : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  void carregarStatus().catch((e) => show(erro(e), "error"));
                  if (secao === "publicacoes") void carregarLista();
                  if (secao === "aguardando") void carregarAguardando();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </Button>
              {secao === "publicacoes" && (
                <Button variant="outline" onClick={() => setSemVinculoAberto(true)}>
                  Sem vínculo
                </Button>
              )}
              {secao === "publicacoes" && (
                <Button onClick={() => setConsultaAberta(true)}>
                  <Search className="h-4 w-4" /> Consultar DJEN
                </Button>
              )}
            </>
          )
        }
      />
      {secao === "publicacoes" && (
        <nav className="process-quick-filters" aria-label="Filtros rápidos de publicações">
          <button type="button" aria-pressed={!filtro.categoria} onClick={() => filtrar("categoria", "")}>Todos</button>
          {quickFilters.map((categoria) => (
            <button key={categoria} type="button" aria-pressed={filtro.categoria.split(",").includes(categoria)}
              onClick={() => filtrar("categoria", filtro.categoria.split(",").includes(categoria) ? filtro.categoria.split(",").filter(c => c !== categoria).join(",") : [...filtro.categoria.split(",").filter(Boolean), categoria].join(","))}>{FILTROS[categoria as keyof typeof FILTROS]}</button>
          ))}
          <button type="button" className="quick-filter-add" aria-label="Personalizar filtros rápidos" title="Adicionar ou organizar filtros rápidos" onClick={() => { setQuickFiltersDraft(quickFilters); setQuickFiltersOpen(true); }}><Plus className="h-4 w-4" /></button>
        </nav>
      )}
      <Modal open={quickFiltersOpen} onClose={() => setQuickFiltersOpen(false)} title="Personalizar filtros rápidos" description="Escolha as categorias que deseja ver abaixo do título.">
        <div className="space-y-3">
          {(Object.entries(FILTROS) as [string, string][]).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
              <input type="checkbox" checked={quickFiltersDraft.includes(key)} onChange={() => setQuickFiltersDraft((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />{label}
            </label>
          ))}
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setQuickFiltersOpen(false)}>Cancelar</Button><Button onClick={() => { setQuickFilters(quickFiltersDraft); try { localStorage.setItem(quickFiltersKey, JSON.stringify(quickFiltersDraft)); } catch { /* A preferência permanece até recarregar. */ } setQuickFiltersOpen(false); }}>Salvar atalhos</Button></div>
        </div>
      </Modal>
      {falha && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {falha}
        </p>
      )}
      {secao === "aguardando" && conteudoAguardando}
      {secao === "publicacoes" && (
        <div className="process-workbench"><aside className="process-filter-rail"><div className="pub-metricas" role="group" aria-label="Prioridades da fila">
          {[
            { label: "Pendentes na fila", value: urgencia?.pendentes, tom: "", icone: "▤", filtro: "" },
            { label: "Vencidos ou vencem hoje", value: urgencia ? urgencia.vencem_hoje + urgencia.vencidos : undefined, tom: "red", icone: "◷", filtro: "urgentes" },
            { label: "Compromissos em 7 dias", value: urgencia?.compromissos_7_dias, tom: "", icone: "▦", filtro: "compromissos" },
            { label: "Precisam de conferência", value: urgencia?.precisam_conferencia, tom: "amber", icone: "!", filtro: "conferir" },
          ].map(({ label, value, tom, icone, filtro: prioridade }) => (
            <button key={label} type="button" aria-pressed={filtro.prioridade === prioridade} onClick={() => {
              setBuscaTexto(""); setFiltro({ agrupamento: "andamentos", prioridade, responsavel: "", categoria: "", resultado: "", advogado_id: "", situacao: "", arquivo: "ativos", busca: "", pagina: 1 });
            }} className={`pub-metrica ${value && tom ? `pub-metrica-${tom}` : ""}`}>
              <span><small>{label}</small><strong>{value ?? "…"}</strong></span><i aria-hidden="true">{icone}</i>
            </button>
          ))}
          <details className="pub-mais-indicadores">
            <summary>Mais indicadores</summary>
            <div className="pub-faixa">
              {[
                { label: "Prazos a lançar", value: urgencia?.prazo_a_lancar ?? 0, tom: "red", title: "Ordem com prazo para o escritório e nenhum prazo lançado", action: () => filtrar("prioridade", "sem_prazo") },
                { label: "Datas a confirmar", value: urgencia?.datas_a_confirmar ?? 0, tom: "amber", title: "Perícias e audiências com dados incompletos", action: () => filtrar("prioridade", "datas") },
                { label: "Não lidos", value: status?.resumo.nao_lidas ?? 0, tom: "", title: "Processos não lidos", action: () => filtrar("situacao", "nao_lidas") },
                { label: "Aguardando retorno", value: status?.aguardando_retorno ?? 0, tom: "", title: "Aguardando retorno", action: () => { setAguardandoAberto(true); void carregarAguardando().catch(e => show(erro(e), "error")); } },
                { label: "Sem laudo · 60 dias", value: status?.pericias_sem_laudo ?? 0, tom: "", title: "Perícias sem laudo identificado em 60 dias", action: () => { setMostrarSemLaudo(true); void carregarSemLaudo(); } },
                { label: "Prazos do escritório", value: status?.prazos_escritorio ?? 0, tom: "", title: "Prazos do escritório vencidos ou a vencer", action: () => void carregarAlerta("prazos").catch((e) => show(erro(e), "error")) },
                { label: "Parados", value: status?.processos_parados ?? 0, tom: "", title: "Processos parados", action: () => void carregarAlerta("parados", diasParado).catch((e) => show(erro(e), "error")) },
              ].map(({ label, value, tom, title, action }) => (
                <button key={label} type="button" title={title} onClick={action} className={`pub-pill ${value > 0 && tom ? `pub-pill-${tom}` : ""}`}>
                  <span>{label}</span><strong>{value}</strong>
                </button>
              ))}
            </div>
          </details>
        </div>
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"><div className="process-filter-heading"><h2 className="text-sm font-semibold">Filtrar publicações</h2><button type="button" className="text-xs text-accent-600 dark:text-accent-300" onClick={() => { setBuscaTexto(""); setFiltro({agrupamento:"andamentos",prioridade:"",responsavel:"",categoria:"",resultado:"",advogado_id:"",situacao:"",arquivo:"ativos",busca:"",pagina:1}); }}>Limpar filtros</button></div>
            <div className="process-filter-search">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" aria-label="Buscar publicações" placeholder="Buscar cliente, processo ou trecho…" value={buscaTexto} onChange={(e) => setBuscaTexto(e.target.value)} />
              </div>
              <Select className="lg:max-w-[210px]" aria-label="Situação dos processos" value={filtro.arquivo} onChange={(e) => filtrar("arquivo", e.target.value)}>
                <option value="ativos">Pendentes e prazos abertos</option>
                <option value="concluidos">Concluídos</option>
                <option value="todos">Todos</option>
              </Select>
              <Button type="button" variant="outline" size="sm" aria-expanded={maisFiltros} onClick={() => setMaisFiltros((v) => !v)}>Mais filtros {maisFiltros ? "▴" : "▾"}</Button>
            </div>
{maisFiltros && <div className="process-filter-fields">{can("gestao.view") && <div><span className="process-filter-label">Responsável interno</span><Select aria-label="Responsável interno" value={filtro.responsavel} onChange={e => filtrar("responsavel", e.target.value)}><option value="">Toda a equipe</option><option value="sem">Sem responsável</option>{responsaveis.map(r => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></div>}<div><span className="process-filter-label">Categorias de andamento</span><MultiSelect inline label="Categorias (múltiplas)" placeholder="Todas as categorias" value={filtro.categoria.split(",").filter(Boolean)} options={Object.entries(FILTROS).map(([value, label]) => ({ value, label }))} onChange={(v) => filtrar("categoria", v.join(","))} /></div><div><span className="process-filter-label">Leitura e pendências</span><MultiSelect inline label="Situação" placeholder="Todas as situações" value={filtro.situacao.split(",").filter(Boolean)} options={[{ value: "nao_lidas", label: "Não lidas" }, { value: "lidas", label: "Lidas" }, { value: "revisar", label: "A revisar" }, { value: "com_prazo", label: "Com prazo em aberto" }]} onChange={(v) => filtrar("situacao", v.join(","))} /></div><><div><span className="process-filter-label">Resultado da sentença</span><MultiSelect inline label="Resultado da sentença" placeholder="Todos os resultados" value={filtro.resultado.split(",").filter(Boolean)} options={Object.entries(RESULTADOS).map(([value, label]) => ({ value, label }))} onChange={(v) => filtrar("resultado", v.join(","))} /></div><div><span className="process-filter-label">Advogado acompanhado no DJEN</span><MultiSelect inline label="Advogado" placeholder={(status?.advogados || []).length ? "Todos os advogados" : "Nenhum advogado acompanhado cadastrado"} value={filtro.advogado_id.split(",").filter(Boolean)} options={(status?.advogados || []).map((a) => ({ value: String(a.id), label: `${a.nome} · ${a.uf_oab} ${a.numero_oab}` }))} onChange={(v) => filtrar("advogado_id", v.join(","))} /></div></></div>}          </section>
          </aside><div className="process-results">
          {(Boolean(status?.ia.pausa) || (status?.ia.pendentes ?? 0) > 0) && <p className="flex items-center gap-2 text-[11px] text-zinc-500"><Sparkles className="h-3.5 w-3.5" />{status?.ia.pausa ? `Análise pausada: ${status.ia.pausa}` : `${status?.ia.pendentes ?? 0} publicação(ões) aguardando classificação pela IA`}. Classificações pendentes aparecem em Outros até a análise.</p>}
          {!urgencia && <p role="status" className="text-xs text-amber-700">Indicadores ainda indisponíveis. Use Atualizar para tentar novamente.</p>}
          {filtro.prioridade && <div className="pub-filter-active"><ListFilter className="h-3.5 w-3.5" />{({ urgentes: "Vencidos ou vencem hoje", compromissos: "Compromissos em 7 dias", conferir: "Precisam de conferência", sem_prazo: "Prazos a lançar", datas: "Dados do compromisso a confirmar" } as Record<string,string>)[filtro.prioridade]}<button type="button" onClick={() => filtrar("prioridade", "")}>Remover filtro ×</button></div>}
          <div
            id="navegacao-publicacoes"
            className="sticky top-20 z-20 scroll-mt-24 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
          >
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{total} andamento(s) · {totalProcessos} processo(s)</p>
            <Pagination
              page={filtro.pagina - 1}
              totalItems={total}
              pageSize={25}
              onPageChange={(p) => setFiltro((f) => ({ ...f, pagina: p + 1 }))}
            />
          </div>
          {filtro.arquivo === "ativos" && items.length > 0 && (
            <div className="pub-selecao flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={paginaSelecionada} onChange={(e) => setSelecionados((atual) => e.target.checked
                  ? [...new Set([...atual, ...itensSelecionaveis.map((item) => item.id)])]
                  : atual.filter((id) => !items.some((item) => item.id === id)))} />
                Selecionar pendentes desta página
              </label>
              {total > items.length && <Button size="sm" variant="ghost" loading={selecionandoTodos} onClick={() => void selecionarTodosFiltrados()}>Selecionar todos os andamentos pendentes do filtro</Button>}
              {selecionados.length > 0 && <>
                <span className="text-zinc-500">{selecionados.length} selecionado(s)</span>
                <Button size="sm" disabled={salvando} onClick={() => setConfirmarLote(true)}>Concluir selecionados</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelecionados([])}>Limpar seleção</Button>
              </>}
            </div>
          )}
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
            <div className="desk">
              <div className="desk-queue" role="list" aria-label="Fila de publicações">
                {items.map((p) => {
                  const sinais = sinaisDoCartao(p);
                  const ativo = detalheAberto && (detalhe?.id === p.id || previaDetalhe?.id === p.id);
                  const prazo = p.proximo_prazo ? `Prazo até ${dia(p.proximo_prazo)}` : p.acao?.tipo === "prazo_explicito" ? "Prazo expresso · conferir" : p.acao?.tipo === "cumprimento" ? "Providência para o escritório" : "";
                  const proximo = p.triagem?.motivo || [p.situacao, prazo].filter(Boolean).join(" · ");
                  const ag = p.triagem?.compromisso;
                  const dataAcao = p.triagem?.data_prioridade;
                  const rotuloData = p.triagem?.vencido ? `Vencido · ${dia(dataAcao || "")}` : p.triagem?.vence_hoje ? "Vence hoje" : dataAcao ? `${ag ? "" : "Até "}${dia(dataAcao)}${ag?.horario ? ` · ${ag.horario}` : ""}` : p.triagem?.prazo_a_lancar ? "Prazo a confirmar" : "Conferir andamento";
                  return (
                    <div
                      key={p.id}
                      role="listitem"
                      className={`desk-row ${ativo ? "desk-row-ativa" : ""}`}
                    >
                      <button
                        type="button"
                        className="desk-row-main"
                        aria-label={`Abrir publicação ${p.id} de ${p.cliente_exibicao || p.processo}`}
                        aria-pressed={ativo}
                        onPointerEnter={() => anteciparDetalhe(p.id)}
                        onPointerLeave={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
                        onClick={() => void abrir(p.id)}
                      >
                        <span className="desk-row-top">
                          <span className="desk-row-tipo">{ag ? ag.tipo === "audiencia" ? "Audiência" : "Perícia" : p.triagem?.prazo_aberto ? "Prazo cadastrado" : p.acao?.tipo === "prazo_explicito" ? "Prazo do escritório" : p.tipo_documento || "Andamento"}</span>
                          <span className={`desk-row-data ${p.triagem?.vencido || p.triagem?.vence_hoje ? "is-urgent" : ""}`}>{rotuloData}</span>
                        </span>
                        <span className="desk-row-cliente">
                          {!p.lida && <span className="desk-row-naolida" aria-label="Não lida" />}
                          {p.cliente_exibicao || "Cliente não identificado"}
                        </span>
                        <span className="desk-row-processo">{p.processo || "processo não informado"} · publicada em {dia(p.data_disponibilizacao)}</span>
                        {proximo && <span className="desk-row-proximo">{proximo}</span>}
                        <span className="desk-row-sinais">
                          {sinais.slice(0, 2).map((x) => <Badge key={x.chave} tone={x.tom} title={x.dica}>{x.texto}</Badge>)}
                          <span className="desk-row-owner">{p.triagem?.responsavel_nome || "Sem responsável"}</span>
                        </span>
                      </button>
                      {filtro.arquivo === "ativos" && !p.concluida && (
                        <label className="desk-row-selecao" title="Selecionar para concluir em lote" onClick={(e) => e.stopPropagation()}>
                          <Checkbox aria-label={`Selecionar andamento ${p.id} do processo ${p.processo}`} checked={selecionados.includes(p.id)} onChange={(e) => setSelecionados((atual) => e.target.checked ? [...new Set([...atual, p.id])] : atual.filter((id) => id !== p.id))} />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="desk-pane" ref={setAlvoDetalhe}>
                {!detalheAberto && (
                  <div className="desk-vazio">
                    <strong>Selecione uma publicação na fila</strong>
                    <span>O texto, o prazo, o cliente e o histórico aparecem aqui, sem perder a lista.</span>
                  </div>
                )}
              </div>
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
        </div></div>
      )}
      {secao === "advogados" && (
        <AdvogadosAcompanhados
          advogados={status?.advogados}
          carregando={!status && !falha}
          ocupado={salvando}
          onAdicionar={() => setFormAdv({ nome: "", numero_oab: "", uf_oab: "SP", modo_busca: "ambos", ativo: true })}
          onEditar={(a) => setFormAdv({ ...a, ativo: Boolean(a.ativo) })}
          onConsultar={(a) => { setConsulta((c) => ({ ...c, advogado_id: String(a.id) })); setConsultaAberta(true); }}
          onRemover={(a) => setRemoverAdv(a)}
          onAlternarAtivo={(a) => void acao(async () => {
            await api.put(`/djen/advogados/${a.id}`, { ...a, ativo: !a.ativo });
            await carregarStatus();
            show(a.ativo ? "Consultas pausadas para este advogado." : "Consultas reativadas para este advogado.", "success");
          })}
        />
      )}
      {secao === "monitoramento" && (
        <MonitoramentoDjen
          status={status}
          config={config}
          setConfig={setConfig}
          salvando={salvando}
          acao={acao}
          atualizarStatus={carregarStatus}
          mostrar={show}
          administrador={user.role === "administrador"}
          onConsultar={() => setConsultaAberta(true)}
        />
      )}
      </div>
      <ProcessosSemVinculo aberto={semVinculoAberto} aoFechar={() => setSemVinculoAberto(false)} aoMudar={() => void carregarLista()} aoAbrirPublicacao={(id) => void abrir(id)} />
      <Modal open={consultaAberta} onClose={() => setConsultaAberta(false)} title="Consultar DJEN" description="Busque novas publicações por período. Resultados repetidos não criam duplicatas." maxWidth="max-w-xl"
        footer={<>
          <Button variant="outline" onClick={() => setConsultaAberta(false)}>Fechar</Button>
          <Button onClick={() => void consultar()} loading={consultando || Boolean(status?.executando)} disabled={!status?.advogados.some((a) => a.ativo)}>
            <Search className="h-4 w-4" />
            Buscar publicações
          </Button>
        </>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="djen-inicio">De</Label>
              <Input id="djen-inicio" type="date" value={consulta.inicio} max={consulta.fim} onChange={(e) => setConsulta({ ...consulta, inicio: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="djen-fim">Até</Label>
              <Input id="djen-fim" type="date" value={consulta.fim} max={hoje()} onChange={(e) => setConsulta({ ...consulta, fim: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="djen-adv">Advogado</Label>
            <Select id="djen-adv" value={consulta.advogado_id} onChange={(e) => setConsulta({ ...consulta, advogado_id: e.target.value })}>
              <option value="">Todos os ativos</option>
              {status?.advogados.filter((a) => a.ativo).map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
            </Select>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Período de até 31 dias por consulta.</p>
          {!status?.advogados.some((a) => a.ativo) && <Callout tone="aviso">Cadastre ao menos um advogado ativo para consultar.</Callout>}
        </div>
      </Modal>
      <Modal open={alertaAberto === "prazos"} onClose={() => setAlertaAberto(null)} title="Prazos do escritório vencidos ou a vencer" maxWidth="max-w-4xl"
        footer={<Button variant="outline" onClick={() => setAlertaAberto(null)}>Fechar</Button>}>
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">Ordens com prazo expresso dirigidas ao escritório, ainda sem cumprimento, revogação ou sentença posterior identificados no DJEN. A data vem do prazo salvo ou da previsão pelo calendário conferido; confirme o termo inicial e o cumprimento nos autos. Não é contagem de prazo jurídico.</p>
          {carregandoAlerta ? <p className="text-sm text-zinc-500">Carregando…</p> : !prazosEscritorio.length ? (
            <EmptyState icon={FileCheck2} title="Nenhum prazo em risco" description="Não há prazos do escritório vencidos ou nos próximos 3 dias sem cumprimento identificado." />
          ) : prazosEscritorio.map((p) => (
            <article key={p.publicacao_id} className={`rounded-xl border p-4 ${p.urgencia === "vencido" || p.urgencia === "decorrido" ? "border-red-200 dark:border-red-900" : "border-amber-200 dark:border-amber-900"}`}>
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{p.cliente_nome || p.processo}</p>
                  <p className="mt-1 text-xs text-zinc-500">{p.processo} · publicado em {dia(p.data_disponibilizacao)}</p>
                  <p className="mt-2 text-xs font-semibold text-red-700 dark:text-red-300">
                    {p.termino ? `${p.urgencia === "vencido" ? `Vencido há ${Math.abs(p.dias_para_vencer ?? 0)} dia(s)` : p.dias_para_vencer === 0 ? "Vence hoje" : `Vence em ${p.dias_para_vencer} dia(s)`} · ${dia(p.termino)} (${p.origem_data === "salvo" ? "prazo salvo" : p.origem_data === "estimativa" ? "estimativa sem calendário conferido" : "previsão pelo calendário"})` : "Decurso de prazo mencionado em publicação posterior"}
                  </p>
                  <p className="mt-2 text-xs"><strong>{p.descricao}</strong>: {p.prazo_texto}</p>
                  {p.situacao === "decorrido" && <p className="mt-1 text-[11px] text-red-700 dark:text-red-300">{p.situacao_motivo}</p>}
                  <HistoryCoverage historico={p.historico_djen} publicacaoId={p.publicacao_id} />
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <Button size="sm" onClick={() => { setAlertaAberto(null); void abrir(p.publicacao_id); }}>Ver processo <ArrowRight className="h-3.5 w-3.5" /></Button>
                  <RegisterFulfillment endpoint={`/djen/prazos/escritorio/${p.publicacao_id}`} onSaved={async () => { await carregarAlerta("prazos"); await carregarStatus(); }} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </Modal>
      <Modal open={alertaAberto === "parados"} onClose={() => setAlertaAberto(null)} title="Processos parados" maxWidth="max-w-4xl"
        footer={<Button variant="outline" onClick={() => setAlertaAberto(null)}>Fechar</Button>}>
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">Processos ativos sem nenhuma publicação capturada no período, excluindo os que têm trânsito, arquivamento, extinção, RPV/precatório ou perícia futura. A ausência de publicação no DJEN não comprova que o processo esteja parado nos autos.</p>
          <label className="flex items-center gap-2 text-xs">Parado há pelo menos
            <select className="rounded-lg border bg-transparent px-2 py-1" value={diasParado} onChange={(e) => { const v = Number(e.target.value); setDiasParado(v); void carregarAlerta("parados", v).catch((er) => show(erro(er), "error")); }}>
              {[30, 45, 60, 90, 120, 180].map((n) => <option key={n} value={n}>{n} dias</option>)}
            </select>
          </label>
          {carregandoAlerta ? <p className="text-sm text-zinc-500">Carregando…</p> : !processosParados.length ? (
            <EmptyState icon={FileCheck2} title="Nenhum processo parado" description="Todos os processos ativos tiveram publicação dentro do período escolhido." />
          ) : processosParados.map((p) => (
            <article key={p.publicacao_id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{p.cliente_nome || p.processo}</p>
                  <p className="mt-1 text-xs text-zinc-500">{p.processo}</p>
                  <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">Sem publicação há {p.dias_parado} dias · última em {dia(p.ultima_publicacao_em)}{p.ultimo_tipo ? ` · ${p.ultimo_tipo}` : ""}</p>
                  <p className="mt-2 line-clamp-3 text-xs text-zinc-600 dark:text-zinc-300">{p.ultimo_andamento}</p>
                  <HistoryCoverage historico={p.historico_djen} publicacaoId={p.publicacao_id} />
                </div>
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <Button size="sm" onClick={() => { setAlertaAberto(null); void abrir(p.publicacao_id); }}>Ver processo <ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Modal>
      <Modal open={aguardandoAberto} onClose={() => setAguardandoAberto(false)} title="Acompanhamentos aguardando retorno" maxWidth="max-w-3xl">{conteudoAguardando}</Modal>
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
              <Input id="adv-nome" autoFocus value={formAdv.nome} onChange={(e) => setFormAdv({ ...formAdv, nome: e.target.value })} />
            </div>
            <div className="grid grid-cols-[1fr_90px] gap-3">
              <div>
                <Label htmlFor="adv-oab">Número da OAB</Label>
                <Input id="adv-oab" disabled={Boolean(formAdv.id)} value={formAdv.numero_oab} placeholder="123456" onChange={(e) => setFormAdv({ ...formAdv, numero_oab: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="adv-uf">UF</Label>
                <Select id="adv-uf" disabled={Boolean(formAdv.id)} value={formAdv.uf_oab} onChange={(e) => setFormAdv({ ...formAdv, uf_oab: e.target.value })}>
                  {UFS.map((uf) => <option key={uf}>{uf}</option>)}
                </Select>
              </div>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">A OAB diferencia homônimos. {formAdv.id ? "OAB e UF não podem ser alteradas." : ""}</p>
            <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800" open={Boolean(formAdv.id) || undefined}>
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">Opções avançadas</summary>
              <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
                <SettingRow label="Como buscar" htmlFor="adv-modo" hint="Resultados achados só pelo nome precisam de conferência antes de avisar o cliente.">
                  <Select id="adv-modo" value={formAdv.modo_busca} onChange={(e) => setFormAdv({ ...formAdv, modo_busca: e.target.value as Advogado["modo_busca"] })}>
                    <option value="ambos">OAB e nome · duas buscas complementares</option>
                    <option value="oab">Somente OAB e UF</option>
                    <option value="nome">Somente nome · exige conferir OAB</option>
                  </Select>
                </SettingRow>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={formAdv.ativo} onChange={(e) => setFormAdv({ ...formAdv, ativo: e.target.checked })} />
                  Advogado ativo nas consultas
                </label>
              </div>
            </details>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={removerAdv !== null}
        title="Remover advogado?"
        message={`«${removerAdv?.nome ?? ""}» deixa de ser acompanhado. Se já houver publicações dele no sistema, a remoção é recusada e o certo é pausar as consultas.`}
        confirmLabel="Remover"
        loading={salvando}
        onConfirm={() => {
          const alvo = removerAdv;
          setRemoverAdv(null);
          if (!alvo) return;
          void acao(async () => {
            await api.delete(`/djen/advogados/${alvo.id}`);
            await carregarStatus();
            show("Advogado removido.", "success");
          });
        }}
        onCancel={() => setRemoverAdv(null)}
      />
      <ConfirmDialog
        open={confirmarLote}
        title="Concluir andamentos selecionados?"
        message={`Os ${selecionados.length} andamentos selecionados terão a triagem concluída. Prazos do escritório ainda abertos continuarão na fila para acompanhamento. Os alertas de obrigações externas continuam no acompanhamento até serem resolvidos.`}
        confirmLabel={`Concluir ${selecionados.length}`}
        confirmVariant="primary"
        loading={salvando}
        onConfirm={() => void concluirSelecionados()}
        onCancel={() => setConfirmarLote(false)}
      />
      <Modal
        presentation="center"
        open={bloqueioLote !== null}
        onClose={() => { setBloqueioLote(null); setJustificativaLote(""); }}
        title="Há pendências nos andamentos selecionados"
        description="A conclusão em lote não esconde trabalho pendente sem confirmação."
        maxWidth="max-w-xl"
        footer={
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => { setBloqueioLote(null); setJustificativaLote(""); }}>Voltar e revisar</Button>
            <Button variant="danger" loading={salvando} disabled={justificativaLote.trim().length < 5} onClick={() => void concluirSelecionados(true)}>Concluir mesmo assim</Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm">
          <div className="max-h-56 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <ul className="list-disc space-y-1 pl-5">{(bloqueioLote?.pendencias ?? []).slice(0, 40).map((x, i) => <li key={i}>{x.texto}</li>)}</ul>
            {(bloqueioLote?.pendencias.length ?? 0) > 40 && <p className="mt-2 text-xs">… e mais {(bloqueioLote?.pendencias.length ?? 0) - 40}.</p>}
          </div>
          <div>
            <Label htmlFor="justificativa-lote">Por que concluir mesmo assim? (obrigatório)</Label>
            <Textarea id="justificativa-lote" value={justificativaLote} onChange={(e) => setJustificativaLote(e.target.value)} rows={3} maxLength={1000} />
            <p className="mt-1 text-xs text-zinc-500">A justificativa fica registrada no histórico de cada andamento concluído.</p>
          </div>
        </div>
      </Modal>
      {concluindo && (
        <ConcluirAndamento
          open
          publicacaoId={concluindo.id}
          rotulo={concluindo.rotulo}
          totalAndamentos={concluindo.total}
          onClose={() => setConcluindo(null)}
          onConcluido={(info) => {
            setDesfazer(info); prefetchRef.current.clear(); setRevisaoAlterada(false);
            const proxima = items.find(p => !info.ids.includes(p.id));
            if (proxima && !detailId) void abrir(proxima.id);
            else { setDetalheAberto(false); setDetalhe(null); onCloseDetail?.(); }
            void carregarLista(); void carregarStatus();
          }}
        />
      )}
      <FaixaDesfazer info={desfazer} onDesfazer={() => void desfazerConclusao()} onFechar={() => setDesfazer(null)} />
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
            Alerta operacional para perícias agendadas há pelo menos 60 dias, sem laudo juntado identificado e sem andamento posterior (sentença, recurso, acórdão, trânsito, cumprimento ou cancelamento da perícia). A agenda não comprova o comparecimento e a ausência de publicação não comprova falta de laudo nos autos. Não é contagem de prazo jurídico.
          </p>
          {diagnostico && <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-xs dark:border-zinc-700 dark:bg-zinc-800"><p className="font-medium">Cobertura do acompanhamento</p><p className="mt-2">{diagnostico.pericias.ativas} registros ativos · {diagnostico.pericias.futuras} futuros · {diagnostico.pericias.menos_60_dias} realizados há menos de 60 dias.</p>{diagnostico.pericias.sem_processo > 0 && <p className="mt-2 text-amber-700">{diagnostico.pericias.sem_processo} registro(s) sem número de processo: complete o cadastro na agenda para permitir o cruzamento com os laudos do DJEN.</p>}<p className="mt-2 text-zinc-500">Somente registros presentes no controle de perícias podem gerar este alerta. Registros anteriormente excluídos não são reconstruídos por esta consulta.</p></div>}
          {carregandoSemLaudo ? (
            <p className="text-sm text-zinc-500">Carregando…</p>
          ) : !periciasSemLaudo.length ? (
            <EmptyState
              icon={FileCheck2}
              title="Nenhuma cobrança pendente"
              description="Não há perícias vencidas sem laudo identificado neste momento."
            />
          ) : (
            <>
              {periciasSemLaudo.some((p) => p.historico_djen?.status !== "atualizado") && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                  Registros com histórico do DJEN ainda não conferido aparecem por último: a publicação posterior (sentença, recurso, laudo) pode ainda não ter sido capturada. Atualize o histórico antes de cobrar.
                </p>
              )}
              {[...periciasSemLaudo].sort((a, b) => Number(a.historico_djen?.status !== "atualizado") - Number(b.historico_djen?.status !== "atualizado")).map((p) => (
              <article
                key={p.pericia_id}
                className={`rounded-xl border p-4 ${p.historico_djen?.status === "atualizado" ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 opacity-80 dark:border-zinc-700"}`}
              >
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="text-sm font-semibold">{p.nome}</p>
                    <p className="mt-1 text-xs text-zinc-500">{p.processo}</p>
                    <HistoryCoverage historico={p.historico_djen} />
                    {p.historico_djen?.status !== "atualizado" && p.historico_djen?.status !== "verificando" && (
                      <Button size="sm" variant="outline" disabled={salvando} onClick={() => void acao(async () => {
                        await api.post(`/djen/pericias/${p.pericia_id}/atualizar-historico`, {});
                        show("Consulta do histórico enfileirada. O alerta será reavaliado ao terminar.", "success");
                        await carregarSemLaudo();
                      })}>Atualizar histórico do DJEN</Button>
                    )}
                    <p className="mt-2 text-xs">
                      Perícia em {p.data}
                      {p.horario ? ` às ${p.horario}` : ""} ·{" "}
                      {p.dias_decorridos} dia(s) decorridos
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {p.publicacoes_posteriores
                        ? `${p.publicacoes_posteriores} publicação(ões) posterior(es) capturada(s), sem sentença, recurso ou laudo identificado · última em ${p.ultima_publicacao_em ? dia(p.ultima_publicacao_em) : "—"}`
                        : "Nenhuma publicação posterior à perícia capturada no DJEN"}
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
                  <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={salvando || p.historico_djen?.status !== "atualizado"}
                      onClick={() =>
                        void acao(async () => {
                          await api.put(
                            `/djen/pericias/${p.pericia_id}/acompanhamento`,
                            { status: "cobrado", observacoes: p.observacoes || "" },
                          );
                          await carregarSemLaudo();
                          await carregarStatus();
                          show("Cobrança marcada como realizada. Nenhuma mensagem foi enviada.", "success");
                        })
                      }
                    >
                      Marcar cobrança realizada
                    </Button>
                    <RegisterFulfillment endpoint={`/djen/pericias/${p.pericia_id}/acompanhamento`} onSaved={async () => { await carregarSemLaudo(); await carregarStatus(); }} />
                  </div>
                </div>
              </article>
              ))}
            </>
          )}
          {!carregandoSemLaudo && periciasSuperadas.length > 0 && (
            <details className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/20">
              <summary className="cursor-pointer font-semibold text-emerald-800 dark:text-emerald-300">
                {periciasSuperadas.length} perícia(s) ocultada(s) por andamento posterior
              </summary>
              <p className="mt-2 text-zinc-500">Estes registros não geram cobrança porque o processo avançou (sentença, recurso, acórdão, laudo etc.) ou a perícia foi cancelada/redesignada. Confira nos autos se necessário.</p>
              <ul className="mt-2 space-y-2">
                {periciasSuperadas.map((p) => (
                  <li key={p.pericia_id} className="rounded-lg bg-white p-2 dark:bg-zinc-900">
                    <strong>{p.nome}</strong> · {p.processo}
                    <br />Perícia em {p.data}{p.horario ? ` às ${p.horario}` : ""} — {p.motivo}{p.data_andamento ? ` (publicado em ${dia(p.data_andamento)})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Modal>
      <PainelDeDetalhes
        lado={detalheAoLado}
        alvo={alvoDetalhe}
        open={detalheAberto && (detalheAoLado || !mensagem)}
        onClose={fecharDetalhe}
        footer={
          <>
            <Button variant="outline" onClick={fecharDetalhe}>
              Fechar
            </Button>
            {detalhe && (
              <>
                <Button
                  variant="ghost"
                  disabled={salvando}
                  onClick={() => void acao(async () => {
                    await api.post(`/djen/publicacoes/${detalhe.id}/leitura`, { lida: !detalhe.lida, escopo: "andamento" });
                    setDetalhe(await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`));
                    await carregarLista();
                    await carregarStatus();
                  })}
                >
                  {detalhe.lida ? "Marcar não lida" : "Marcar lida"}
                </Button>
                {!detalhe.cancelada && (
                  <Button
                    variant="outline"
                    disabled={salvando}
                    onClick={() => {
                      if (detalhe.concluida) {
                        void acao(async () => {
                          await api.post(`/djen/publicacoes/${detalhe.id}/conclusao`, { concluida: false, escopo: "andamento" });
                          setDetalhe(await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`));
                          await carregarLista();
                          await carregarStatus();
                          show("Publicação reaberta.", "success");
                        });
                        return;
                      }
                      setConcluindo({ id: detalhe.id, rotulo: `${detalhe.tipo_documento || "Andamento"} de ${dataDoAndamento(detalhe.data_disponibilizacao)}`, total: detalhe.relacionadas_total ?? 1 });
                    }}
                  >
                    {detalhe.concluida ? "Reabrir" : "Concluir andamento"}
                  </Button>
                )}
              </>
            )}
            {can("messages.send") && <Button variant="outline"
              onClick={() => void acao(compor)}
              disabled={salvando || !detalhe || !detalhe.revisada || revisaoAlterada || Boolean(detalhe?.cancelada)}
            >
              <Send className="h-3.5 w-3.5" />
              Preparar aviso ao cliente
            </Button>}
          </>
        }
      >
        {carregandoDetalhe && <div role="status" className="space-y-3 rounded-xl bg-accent-50 p-5 text-sm text-accent-700 dark:bg-accent-950/30 dark:text-accent-200"><p className="flex items-center gap-3"><RefreshCw className="h-4 w-4 animate-spin" />Carregando histórico e ações do processo…</p>{previaDetalhe && <div className="space-y-2 border-t border-accent-200 pt-3 dark:border-accent-800"><strong className="block">{previaDetalhe.cliente_exibicao || previaDetalhe.processo}</strong><p>Processo {previaDetalhe.processo}</p><p>{previaDetalhe.situacao}</p><p className="whitespace-pre-line text-zinc-600 dark:text-zinc-300">{previaDetalhe.resumo}</p></div>}</div>}
        {detalhe && (
          <div className="space-y-5">
            <header className="pub-detail-heading">
              <div className="pub-detail-topline"><span>ANDAMENTO #{detalhe.id} · DJEN {dia(detalhe.data_disponibilizacao)}</span><div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={salvando || items.findIndex(p => p.id === detalhe.id) <= 0} aria-label="Publicação anterior" onClick={() => { const i = items.findIndex(p => p.id === detalhe.id); if(i > 0) void abrir(items[i - 1].id); }}>‹</Button>
                <Button size="sm" variant="ghost" disabled={salvando || items.findIndex(p => p.id === detalhe.id) < 0 || items.findIndex(p => p.id === detalhe.id) >= items.length - 1} aria-label="Próxima publicação" onClick={() => { const i = items.findIndex(p => p.id === detalhe.id); if(i >= 0 && i < items.length - 1) void abrir(items[i + 1].id); }}>›</Button>
              </div></div>
              <h2>{detalhe.cliente_exibicao || "Cliente não identificado"}<button type="button" aria-label="Copiar nome da parte" onClick={() => void copiarDetalhe(detalhe.cliente_exibicao || "", "Nome da parte")}><Copy className="h-3.5 w-3.5" /></button></h2>
              <p className="pub-detail-process">{detalhe.processo}<button type="button" aria-label="Copiar número do processo" onClick={() => void copiarDetalhe(detalhe.processo, "Número do processo")}><Copy className="h-3.5 w-3.5" /></button><span>· {detalhe.tribunal}</span></p>
              <div className="mt-3 flex flex-wrap gap-2"><Badge tone={detalhe.revisada ? "success" : "warning"}>{detalhe.revisada ? `Categoria conferida${detalhe.revisada_por_nome ? ` por ${detalhe.revisada_por_nome}` : ""}` : "Categoria a conferir"}</Badge>{!detalhe.cliente_vinculado && <button type="button" onClick={() => setAbaDetalhe("cliente")}><Badge tone="warning">Vincular cliente</Badge></button>}{Boolean(detalhe.concluida) && <Badge>Triagem concluída</Badge>}</div>
            </header>
            <nav
              aria-label="Seções dos detalhes do processo" role="tablist"
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
                  onClick={() => setAbaDetalhe(id)} role="tab" aria-selected={abaDetalhe === id}
                  className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${abaDetalhe === id ? "bg-accent-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
            {abaDetalhe === "resumo" && (
              <div className="space-y-5">
                <ResumoPublicacao publicacao={detalhe} ocupado={salvando} responsaveis={responsaveis}
                  aoConferir={() => {
                    if (revisaoAlterada) { show("Salve a classificação em edição antes de conferir o compromisso.", "info"); document.getElementById("classificacao-publicacao")?.setAttribute("open", ""); return; }
                    setConferirCompromisso(detalhe);
                  }}
                  aoClassificar={() => { document.getElementById("classificacao-publicacao")?.setAttribute("open", ""); document.getElementById("classificacao-publicacao")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}
                  aoPrazos={() => setAbaDetalhe("prazos")} aoPublicacao={() => setAbaDetalhe("publicacao")}
                  aoAvisar={() => void acao(compor)} aoAtualizar={async () => { setDetalhe(await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`)); await carregarLista(); await carregarStatus(); }} />
                <details className="pub-disclosure"><summary>Partes e advogados</summary><div className="space-y-2 pt-3 text-xs"><p>{detalhe.destinatarios?.map(d => d.nome).join(" · ") || "Partes não informadas"}</p><p>{detalhe.advogados_publicacao?.map(a => `${a.nome} · OAB ${a.uf_oab} ${a.numero_oab}`).join(" / ")}</p></div></details>
                <details className="pub-disclosure"><summary>Análise pela IA e evidências</summary>
                <section className="rounded-xl border border-accent-200 bg-accent-50/40 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4" /> Análise pela IA
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
                      show("Publicação adicionada à fila da IA.", "success");
                    })
                  }
                >
                  {detalhe.analise
                    ? "Reanalisar com IA"
                    : "Analisar com IA"}
                </Button>
              </div>
              {detalhe.ia_provedor && <p className="mt-2 text-[11px] text-zinc-500">Origem da análise: {detalhe.ia_provedor === "regra" ? "Regra de segurança" : detalhe.ia_provedor === "codex" ? "OpenAI · conta ChatGPT" : detalhe.ia_provedor === "anthropic" ? "Anthropic · API" : "OpenAI · API"}{detalhe.ia_modelo ? ` · ${detalhe.ia_modelo}` : " · registro anterior sem modelo identificado"}</p>}
              <p className="mt-2 text-xs text-zinc-500">
                {detalhe.ia_status === "analisando"
                  ? "Analisando publicação…"
                  : detalhe.ia_status === "pendente"
                    ? detalhe.ia_manual
                      ? "Análise manual na fila; não depende da análise automática."
                      : !status?.config.ia_ativa
                        ? "Análise automática desativada. O botão Analisar com IA funciona manualmente."
                        : status.ia.pausa
                          ? `Fila pausada: ${status.ia.pausa}`
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
                    Sugestão da IA:{" "}
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
                  {detalhe.acao && (
                    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                      <Badge
                        tone={
                          detalhe.acao.tipo === "prazo_explicito"
                            ? "danger"
                            : detalhe.acao.tipo === "cumprimento"
                              ? "warning"
                              : "success"
                        }
                      >
                        {detalhe.acao.tipo === "prazo_explicito"
                          ? "Prazo expresso do escritório"
                          : detalhe.acao.tipo === "cumprimento"
                            ? "Exige providência"
                            : "Ciência / acompanhamento"}
                      </Badge>
                      {detalhe.acao.descricao && (
                        <p className="mt-2">{detalhe.acao.descricao}</p>
                      )}
                      {detalhe.acao.prazo_texto && (
                        <p className="mt-1 text-zinc-500">
                          Prazo informado: {detalhe.acao.prazo_texto}
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
                        Data: dataPorExtenso(detalhe.analise.agendamento.data),
                        Horário: horaPorExtenso(detalhe.analise.agendamento.horario),
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
                </section></details>
              </div>
            )}
            {abaDetalhe === "publicacao" && (
              <div className="space-y-5">
            <section><div className="pub-section-heading"><h3>Inteiro teor da publicação</h3><span className="text-xs text-zinc-500">DJEN · {dia(detalhe.data_disponibilizacao)}</span></div><p className="pub-fulltext">{detalhe.texto}</p></section>
            <DjenDocumentos id={detalhe.id} certidao={detalhe.certidao_url} tribunal={detalhe.link} documentos={detalhe.documentos} refresh={async () => { setDetalhe(await api.get<Publicacao>(`/djen/publicacoes/${detalhe.id}`)); }} />
              </div>
            )}
            {abaDetalhe === "resumo" && (
            <details id="classificacao-publicacao" className="pub-disclosure">
              <summary>
                <CheckCheck className="h-4 w-4" />
                Conferir ou ajustar classificação
              </summary>
              <p className="mt-1 text-xs text-zinc-500">
                Confira a sugestão da IA e o inteiro teor antes de salvar a
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
                {user.role === "administrador" && Boolean(detalhe.revisada) && !revisaoAlterada && <Link className="text-xs font-medium text-violet-700 underline underline-offset-2 dark:text-violet-300" to={`/processos/monitoramento?exemplo=${detalhe.id}`} onClick={() => { detailSeq.current++; setDetalheAberto(false); setDetalhe(null); }}>Usar esta revisão como exemplo para a IA</Link>}
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
                {can("contacts.view") ? <ContactPicker
                  contatos={contatos}
                  value={processo.cliente_id}
                  onChange={(cliente_id) =>
                    setProcesso({ ...processo, cliente_id })
                  }
                  processo={detalhe.processo}
                  onCreated={(c) => setContatos((list) => [...list, c])}
                /> : <p className="text-xs">{detalhe.cliente_nome || "Cliente ainda sem vínculo"}. Seu perfil permite consultar o vínculo atual.</p>}
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
            <HistoryCoverage historico={detalhe.historico_djen} publicacaoId={detalhe.id} />
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
      </PainelDeDetalhes>
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
              Conferi o destinatário, os dados e a mensagem que será enviada.
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
