import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock, FileText, Gavel, History, MapPin, Pencil, Phone, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { classificarEvento, type CategoriaEvento } from "@/lib/eventVisual";
import type { PericiaAgendada } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface TipoCalendario {
  chave: string;
  rotulo: string;
  audiencia: boolean;
  identificado: boolean;
  categoria: CategoriaEvento;
}

interface EdicaoEvento {
  id: number;
  tipo: string;
  nome: string;
  telefone: string;
  processo: string;
  data: string;
  horario: string;
  local: string;
  whatsapp: string;
  profissionalPerito: string;
  fonte: PericiaAgendada["fonte"];
  tinhaLembrete: boolean;
}

interface RespostaEdicaoEvento {
  ok: true;
  pericia: PericiaAgendada;
  lembrete_resetado: boolean;
}

function textoComparavel(valor: string | null | undefined): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Consolida as variações antigas do banco em categorias estáveis para filtro e cor. */
function classificarTipo(pericia: PericiaAgendada): TipoCalendario {
  const classificacao = classificarEvento(pericia);
  return {
    ...classificacao,
    chave: classificacao.categoria === "outro" ? `outro:${pericia.tipo}` : classificacao.categoria,
  };
}

function toneTipo(tipo: TipoCalendario): "neutral" | "accent" | "violet" | "info" | "cyan" | "indigo" {
  if (tipo.categoria === "pericia_social") return "violet";
  if (tipo.categoria === "audiencia_presencial") return "info";
  if (tipo.categoria === "audiencia_online") return "cyan";
  if (tipo.categoria === "audiencia_hibrida") return "indigo";
  if (!tipo.identificado || tipo.categoria === "outro") return "neutral";
  return "accent";
}

function classesResultadoTipo(categoria: CategoriaEvento): string {
  if (categoria === "pericia_social") return "border-l-violet-500 bg-violet-50/20 dark:border-l-violet-400 dark:bg-violet-950/10";
  if (categoria === "audiencia_presencial") return "border-l-blue-500 bg-blue-50/20 dark:border-l-blue-400 dark:bg-blue-950/10";
  if (categoria === "audiencia_online") return "border-l-cyan-500 bg-cyan-50/20 dark:border-l-cyan-400 dark:bg-cyan-950/10";
  if (categoria === "audiencia_hibrida") return "border-l-indigo-500 bg-indigo-50/20 dark:border-l-indigo-400 dark:bg-indigo-950/10";
  if (categoria === "tipo_nao_identificado" || categoria === "outro") return "border-l-zinc-300 dark:border-l-zinc-700";
  return "border-l-accent-400 dark:border-l-accent-500";
}

function classesDetalheTipo(categoria: CategoriaEvento): string {
  if (categoria === "pericia_social") return "border-violet-200 border-l-4 border-l-violet-500 bg-violet-50/60 dark:border-violet-900 dark:border-l-violet-400 dark:bg-violet-950/20";
  if (categoria === "audiencia_presencial") return "border-blue-200 border-l-4 border-l-blue-500 bg-blue-50/60 dark:border-blue-900 dark:border-l-blue-400 dark:bg-blue-950/20";
  if (categoria === "audiencia_online") return "border-cyan-200 border-l-4 border-l-cyan-500 bg-cyan-50/60 dark:border-cyan-900 dark:border-l-cyan-400 dark:bg-cyan-950/20";
  if (categoria === "audiencia_hibrida") return "border-indigo-200 border-l-4 border-l-indigo-500 bg-indigo-50/60 dark:border-indigo-900 dark:border-l-indigo-400 dark:bg-indigo-950/20";
  if (categoria === "tipo_nao_identificado" || categoria === "outro") return "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/30";
  return "border-accent-200 border-l-4 border-l-accent-500 bg-accent-50/60 dark:border-accent-900 dark:border-l-accent-400 dark:bg-accent-900/20";
}

function classesEventoCalendario(pericia: PericiaAgendada): string {
  if (pericia.status === "substituida") {
    return "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800 dark:text-zinc-600";
  }
  const tipo = classificarTipo(pericia);
  if (tipo.categoria === "pericia_social") return "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300";
  if (tipo.categoria === "audiencia_presencial") return "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
  if (tipo.categoria === "audiencia_online") return "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300";
  if (tipo.categoria === "audiencia_hibrida") return "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300";
  if (!tipo.identificado || tipo.categoria === "outro") return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  return "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300";
}

/** "YYYY-MM-DD" no fuso de São Paulo, para agrupar por dia independente do fuso do navegador. */
function diaLocalYMD(dataHoraMs: number): string {
  return new Date(dataHoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function dataBrasileiraParaInput(data: string): string {
  const match = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function dataInputParaBrasileira(data: string): string {
  const match = data.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : data;
}

function montarEdicaoEvento(pericia: PericiaAgendada): EdicaoEvento {
  return {
    id: pericia.id,
    tipo: pericia.tipo,
    nome: pericia.nome,
    telefone: formatPhoneDisplay(pericia.telefone),
    processo: pericia.processo || "",
    data: dataBrasileiraParaInput(pericia.data),
    horario: pericia.horario || "",
    local: pericia.local || "",
    whatsapp: pericia.whatsapp || "",
    profissionalPerito: pericia.profissional_perito || "",
    fonte: pericia.fonte,
    tinhaLembrete: Boolean(pericia.ultimo_lembrete_em),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function celulaKey(ano: number, mes: number, dia: number): string {
  return `${ano}-${pad2(mes)}-${pad2(dia)}`;
}

/** Soma/subtrai dias a partir de um Y/M/D "puro" (sem hora) — só matemática de calendário, não depende do fuso do navegador. */
function deslocarDias(ano: number, mes: number, dia: number, delta: number): { ano: number; mes: number; dia: number } {
  const d = new Date(ano, mes - 1, dia + delta);
  return { ano: d.getFullYear(), mes: d.getMonth() + 1, dia: d.getDate() };
}

interface Celula {
  ano: number;
  mes: number;
  dia: number;
  noMesAtual: boolean;
}

function montarGrade(ano: number, mes: number): Celula[] {
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const totalDepois = (7 - ((primeiroDiaSemana + diasNoMes) % 7)) % 7;

  const celulas: Celula[] = [];
  for (let i = primeiroDiaSemana; i >= 1; i--) {
    celulas.push({ ...deslocarDias(ano, mes, 1, -i), noMesAtual: false });
  }
  for (let d = 1; d <= diasNoMes; d++) {
    celulas.push({ ano, mes, dia: d, noMesAtual: true });
  }
  for (let i = 1; i <= totalDepois; i++) {
    celulas.push({ ...deslocarDias(ano, mes, diasNoMes, i), noMesAtual: false });
  }
  return celulas;
}

const MAX_VISIVEIS_NA_CELULA = 3;

export function Calendario() {
  const { show } = useToast();
  const [pericias, setPericias] = useState<PericiaAgendada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [{ ano, mes }, setAnoMes] = useState(() => {
    const [y, m] = hojeYMD().split("-").map(Number);
    return { ano: y, mes: m };
  });
  const [busca, setBusca] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("todos");
  const [mostrarSubstituidas, setMostrarSubstituidas] = useState(false);
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(null);
  const [diasExpandidos, setDiasExpandidos] = useState<Set<string>>(() => new Set([hojeYMD()]));
  const [apagarAlvo, setApagarAlvo] = useState<PericiaAgendada | null>(null);
  const [apagando, setApagando] = useState<number | null>(null);
  const [edicao, setEdicao] = useState<EdicaoEvento | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const data = await api.get<PericiaAgendada[]>("/pericias-agendadas");
      setPericias(data);
    } catch (err) {
      const mensagem = err instanceof ApiError ? err.message : "Erro ao carregar o calendário de perícias.";
      setErro(mensagem);
      show(mensagem, "error");
    }
  }, [show]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function confirmarApagar() {
    if (!apagarAlvo) return;
    const alvo = apagarAlvo;
    setApagarAlvo(null);
    setApagando(alvo.id);
    try {
      await api.delete(`/pericias-agendadas/${alvo.id}`);
      show(`"${alvo.nome}" removido do calendário.`, "info");
      setDiaSelecionado(null);
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao apagar o evento.", "error");
    } finally {
      setApagando(null);
    }
  }

  function abrirEdicao(pericia: PericiaAgendada) {
    setDiaSelecionado(null);
    setEdicao(montarEdicaoEvento(pericia));
  }

  async function salvarEdicao() {
    if (!edicao) return;
    if (!edicao.tipo.trim() || !edicao.nome.trim() || !edicao.data) {
      show("Preencha o tipo, o nome do cliente e a data.", "error");
      return;
    }

    setSalvandoEdicao(true);
    try {
      const resposta = await api.put<RespostaEdicaoEvento>(`/pericias-agendadas/${edicao.id}`, {
        tipo: edicao.tipo,
        nome: edicao.nome,
        telefone: edicao.telefone,
        processo: edicao.processo,
        data: dataInputParaBrasileira(edicao.data),
        horario: edicao.horario,
        local: edicao.local,
        whatsapp: edicao.whatsapp,
        profissional_perito: edicao.profissionalPerito,
      });
      const diaAtualizado = diaLocalYMD(resposta.pericia.data_hora_ms);
      const [novoAno, novoMes] = diaAtualizado.split("-").map(Number);
      setAnoMes({ ano: novoAno, mes: novoMes });
      setDiasExpandidos((atuais) => new Set([...atuais, diaAtualizado]));
      setEdicao(null);
      setPericias((atuais) => atuais?.map((item) => item.id === resposta.pericia.id ? resposta.pericia : item) ?? null);
      show(
        resposta.lembrete_resetado
          ? "Evento atualizado. O lembrete anterior permanece no Histórico e um novo lembrete poderá ser enviado."
          : "Evento atualizado com sucesso.",
        "success"
      );
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao editar o evento.", "error");
    } finally {
      setSalvandoEdicao(false);
    }
  }

  const porId = useMemo(() => {
    const map = new Map<number, PericiaAgendada>();
    for (const p of pericias ?? []) map.set(p.id, p);
    return map;
  }, [pericias]);

  const tiposDisponiveis = useMemo(() => {
    const porChave = new Map<string, TipoCalendario>();
    for (const p of pericias ?? []) {
      const categoria = classificarTipo(p);
      porChave.set(categoria.chave, categoria);
    }
    return Array.from(porChave.values()).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  }, [pericias]);

  const filtradas = useMemo(() => {
    if (!pericias) return [];
    const termo = textoComparavel(busca);
    const termoDigits = busca.replace(/\D/g, "");
    return pericias.filter((p) => {
      if (!mostrarSubstituidas && p.status === "substituida") return false;
      const categoria = classificarTipo(p);
      if (tipoFiltro === "audiencias" && !categoria.audiencia) return false;
      if (tipoFiltro !== "todos" && tipoFiltro !== "audiencias" && categoria.chave !== tipoFiltro) return false;
      if (termo) {
        const nomeMatch = textoComparavel(p.nome).includes(termo);
        const processoMatch = textoComparavel(p.processo).includes(termo);
        const telefoneMatch = termoDigits.length > 0 && p.telefone.replace(/\D/g, "").includes(termoDigits);
        if (!nomeMatch && !processoMatch && !telefoneMatch) return false;
      }
      return true;
    });
  }, [pericias, busca, tipoFiltro, mostrarSubstituidas]);

  const porDia = useMemo(() => {
    const map = new Map<string, PericiaAgendada[]>();
    for (const p of filtradas) {
      const key = diaLocalYMD(p.data_hora_ms);
      const lista = map.get(key) ?? [];
      lista.push(p);
      map.set(key, lista);
    }
    for (const lista of map.values()) lista.sort((a, b) => a.data_hora_ms - b.data_hora_ms);
    return map;
  }, [filtradas]);

  const celulas = useMemo(() => montarGrade(ano, mes), [ano, mes]);
  const hoje = hojeYMD();
  const resumo = useMemo(() => {
    const ativos = (pericias ?? []).filter((pericia) => pericia.status !== "substituida");
    return {
      hoje: ativos.filter((pericia) => diaLocalYMD(pericia.data_hora_ms) === hoje).length,
      proximos: ativos.filter((pericia) => diaLocalYMD(pericia.data_hora_ms) >= hoje).length,
      audiencias: ativos.filter(
        (pericia) => diaLocalYMD(pericia.data_hora_ms) >= hoje && classificarTipo(pericia).audiencia
      ).length,
    };
  }, [pericias, hoje]);
  const buscaAtiva = busca.trim().length > 0;
  const gruposDaBusca = useMemo(
    () => Array.from(porDia.entries()).sort(([dataA], [dataB]) => dataA.localeCompare(dataB)),
    [porDia]
  );

  function irParaMesAnterior() {
    setAnoMes(({ ano, mes }) => (mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 }));
  }
  function irParaProximoMes() {
    setAnoMes(({ ano, mes }) => (mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 }));
  }
  function irParaHoje() {
    const [y, m] = hojeYMD().split("-").map(Number);
    setAnoMes({ ano: y, mes: m });
  }
  function alternarDiaExpandido(dia: string) {
    setDiasExpandidos((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(dia)) proximos.delete(dia);
      else proximos.add(dia);
      return proximos;
    });
  }

  const periciasDoDiaSelecionado = diaSelecionado ? porDia.get(diaSelecionado) ?? [] : [];

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Calendário de Perícias"
        description={<>
          <span className="md:hidden">Consulte perícias e audiências agendadas ou importadas.</span>
          <span className="hidden md:inline">Acompanhe compromissos comunicados por WhatsApp e eventos importados do Trello. Duplicidades idênticas são consolidadas automaticamente.</span>
        </>}
      />

      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <StatCard icon={<Clock />} label="Hoje" value={resumo.hoje} tone="warning" />
        <StatCard icon={<CalendarDays />} label="Próximos" value={resumo.proximos} tone="accent" />
        <StatCard icon={<Gavel />} label="Audiências" value={resumo.audiencias} tone="info" />
      </div>

      <div className="surface-panel flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between md:p-4">
        {buscaAtiva ? (
          <div className="flex min-h-10 w-full items-center gap-2 md:w-auto">
            <Search className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Resultados em todos os meses</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {filtradas.length} {filtradas.length === 1 ? "evento encontrado" : "eventos encontrados"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_2.25rem_auto] items-center gap-2 md:flex md:w-auto">
            <Button variant="outline" size="icon" onClick={irParaMesAnterior} title="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-0 text-center text-base font-semibold text-zinc-900 dark:text-zinc-100 md:w-40">
              {NOMES_MES[mes - 1]} {ano}
            </span>
            <Button variant="outline" size="icon" onClick={irParaProximoMes} title="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={irParaHoje}>
              Hoje
            </Button>
          </div>
        )}

        <div className="grid w-full grid-cols-2 items-center gap-2 md:flex md:w-auto md:flex-wrap">
          <div className="relative col-span-2 w-full md:col-auto md:max-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Nome, telefone ou processo…"
              className={cn("pl-9", busca && "pr-9")}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                title="Limpar busca"
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)} className="w-full min-w-0 md:w-44">
            <option value="todos">Todos os tipos</option>
            <option value="audiencias">Todas as audiências</option>
            {tiposDisponiveis.map((tipo) => (
              <option key={tipo.chave} value={tipo.chave}>
                {tipo.rotulo}
              </option>
            ))}
          </Select>
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 md:h-auto md:border-0 md:bg-transparent md:px-0 md:text-sm md:dark:bg-transparent">
            <Checkbox checked={mostrarSubstituidas} onChange={() => setMostrarSubstituidas((v) => !v)} />
            <span className="leading-tight">Mostrar substituídas</span>
          </label>
        </div>
      </div>

      {erro ? (
        <EmptyState
          icon={AlertTriangle}
          title="Não foi possível carregar o calendário"
          description={erro}
          action={
            <Button variant="outline" onClick={carregar}>
              <RefreshCw className="h-4 w-4" /> Tentar de novo
            </Button>
          }
        />
      ) : pericias === null ? (
        <Skeleton className="h-[560px] w-full" />
      ) : pericias.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nenhuma perícia comunicada ainda"
          description="Assim que um envio de WhatsApp for concluído com sucesso, a perícia aparece aqui."
        />
      ) : buscaAtiva ? (
        filtradas.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nenhum evento encontrado"
            description="Não encontramos nome, telefone ou processo correspondente em nenhum mês."
            action={
              <Button variant="outline" onClick={() => setBusca("")}>
                <X className="h-4 w-4" /> Limpar busca
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-col gap-2 border-b border-zinc-200 bg-zinc-50/70 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-800/30 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Resultados para</p>
                <p className="mt-0.5 truncate font-semibold text-zinc-900 dark:text-zinc-100">“{busca.trim()}”</p>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {filtradas.length} {filtradas.length === 1 ? "evento" : "eventos"} em {gruposDaBusca.length} {gruposDaBusca.length === 1 ? "data" : "datas"}
              </p>
            </div>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {gruposDaBusca.map(([data, itens]) => {
                const partes = formatarPartesData(data);
                return (
                  <section key={data} className="md:grid md:grid-cols-[10.5rem_minmax(0,1fr)]">
                    <div className="flex items-center justify-between gap-3 bg-zinc-50/70 px-4 py-3 dark:bg-zinc-800/30 md:block md:border-r md:border-zinc-200 md:px-5 md:py-5 md:dark:border-zinc-800">
                      <div className="flex items-baseline gap-2 md:block">
                        <span className="text-2xl font-bold leading-none text-zinc-900 dark:text-zinc-100 md:text-3xl">{partes.dia}</span>
                        <span className="text-sm font-semibold capitalize text-zinc-700 dark:text-zinc-300 md:mt-1 md:block">{partes.mes}</span>
                      </div>
                      <div className="text-right md:mt-2 md:text-left">
                        <p className="text-xs capitalize text-zinc-500 dark:text-zinc-400">{partes.diaSemana}</p>
                        <p className="text-xs text-zinc-400">{partes.ano} · {itens.length} {itens.length === 1 ? "evento" : "eventos"}</p>
                      </div>
                    </div>
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {itens.map((p) => (
                        <ResultadoBuscaLinha
                          key={p.id}
                          pericia={p}
                          substituidaPor={p.substituida_por_id ? porId.get(p.substituida_por_id) ?? null : null}
                          onEditar={() => abrirEdicao(p)}
                          onExcluir={() => setApagarAlvo(p)}
                          excluindo={apagando === p.id}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <>
          {/* Desktop/tablet: grade mensal tradicional */}
          <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 md:block">
            <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-xs font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="px-2 py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {celulas.map((cel) => {
                const key = celulaKey(cel.ano, cel.mes, cel.dia);
                const itens = porDia.get(key) ?? [];
                const visiveis = itens.slice(0, MAX_VISIVEIS_NA_CELULA);
                const restantes = itens.length - visiveis.length;
                const ehHoje = key === hoje;
                return (
                  <button
                    key={key}
                    onClick={() => itens.length > 0 && setDiaSelecionado(key)}
                    className={cn(
                      "flex min-h-[110px] flex-col gap-1 border-b border-r border-zinc-100 p-1.5 text-left align-top dark:border-zinc-800",
                      !cel.noMesAtual && "bg-zinc-50/60 dark:bg-zinc-900/40",
                      itens.length > 0 && "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                        ehHoje
                          ? "bg-accent-500 text-white"
                          : cel.noMesAtual
                            ? "text-zinc-700 dark:text-zinc-300"
                            : "text-zinc-400 dark:text-zinc-600"
                      )}
                    >
                      {cel.dia}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {visiveis.map((p) => (
                        <span
                          key={p.id}
                          className={cn(
                            "truncate rounded px-1 py-0.5 text-[11px] leading-tight",
                            classesEventoCalendario(p)
                          )}
                          title={`${p.horario ?? ""} · ${p.nome}`}
                        >
                          {p.horario ? `${p.horario} ` : ""}
                          {p.nome}
                        </span>
                      ))}
                      {restantes > 0 && <span className="px-1 text-[11px] font-medium text-zinc-400">+{restantes} mais</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mobile: lista agrupada por dia (grade de mês fica apertada demais em celular) */}
          <div className="space-y-3 md:hidden">
            {celulas
              .filter((c) => c.noMesAtual)
              .map((cel) => {
                const key = celulaKey(cel.ano, cel.mes, cel.dia);
                const itens = porDia.get(key) ?? [];
                if (itens.length === 0) return null;
                const ehHoje = key === hoje;
                const expandido = diasExpandidos.has(key);
                return (
                  <div key={key} className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <button
                      type="button"
                      onClick={() => alternarDiaExpandido(key)}
                      aria-expanded={expandido}
                      aria-controls={`eventos-dia-${key}`}
                      className="flex min-h-12 w-full items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-zinc-100/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500 dark:hover:bg-zinc-800/50"
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm font-semibold",
                          ehHoje ? "text-accent-600 dark:text-accent-400" : "text-zinc-700 dark:text-zinc-300"
                        )}
                      >
                        {cel.dia} de {NOMES_MES[cel.mes - 1]}
                        {ehHoje && " · Hoje"}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                        {itens.length} {itens.length === 1 ? "evento" : "eventos"}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200",
                          expandido && "rotate-180"
                        )}
                      />
                    </button>
                    {expandido && (
                      <div id={`eventos-dia-${key}`} className="space-y-2 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
                        {itens.map((p) => (
                          <PericiaLinha
                            key={p.id}
                            pericia={p}
                            onEditar={() => abrirEdicao(p)}
                            onExcluir={() => setApagarAlvo(p)}
                            excluindo={apagando === p.id}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            {celulas.filter((c) => c.noMesAtual && (porDia.get(celulaKey(c.ano, c.mes, c.dia))?.length ?? 0) > 0).length === 0 && (
              <p className="py-8 text-center text-sm text-zinc-400">Nenhuma perícia neste mês com os filtros atuais.</p>
            )}
          </div>
        </>
      )}

      <Modal
        open={diaSelecionado !== null}
        onClose={() => setDiaSelecionado(null)}
        title={diaSelecionado ? formatarTituloDia(diaSelecionado) : ""}
      >
        <div className="space-y-3">
          {periciasDoDiaSelecionado.map((p) => (
            <PericiaLinha
              key={p.id}
              pericia={p}
              substituidaPor={p.substituida_por_id ? porId.get(p.substituida_por_id) ?? null : null}
              onEditar={() => abrirEdicao(p)}
              onExcluir={() => setApagarAlvo(p)}
              excluindo={apagando === p.id}
            />
          ))}
        </div>
      </Modal>

      <Modal
        open={edicao !== null}
        onClose={() => !salvandoEdicao && setEdicao(null)}
        title="Editar evento"
        description="Revise as informações usadas no calendário e nos próximos lembretes."
        maxWidth="max-w-2xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setEdicao(null)} disabled={salvandoEdicao}>
              Cancelar
            </Button>
            <Button
              onClick={salvarEdicao}
              loading={salvandoEdicao}
              disabled={!edicao?.tipo.trim() || !edicao?.nome.trim() || !edicao?.data}
            >
              <Save className="h-4 w-4" /> Salvar alterações
            </Button>
          </>
        }
      >
        {edicao && (
          <div className="space-y-4">
            {edicao.fonte === "trello_sync" && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                Este evento foi importado. A edição altera o calendário do sistema, mas não modifica o cartão original no Trello.
              </div>
            )}

            <div>
              <Label htmlFor="evento-tipo">Tipo do evento</Label>
              <Input
                id="evento-tipo"
                list="tipos-evento-calendario"
                value={edicao.tipo}
                onChange={(e) => setEdicao({ ...edicao, tipo: e.target.value })}
                placeholder="Ex: Perícia médica ou Audiência online"
              />
              <datalist id="tipos-evento-calendario">
                <option value="Perícia Médica" />
                <option value="Perícia Social" />
                <option value="Perícia" />
                <option value="Audiência Presencial" />
                <option value="Audiência Online" />
                <option value="Audiência Híbrida" />
              </datalist>
            </div>

            <div>
              <Label htmlFor="evento-nome">Nome completo do cliente</Label>
              <Input
                id="evento-nome"
                value={edicao.nome}
                onChange={(e) => setEdicao({ ...edicao, nome: e.target.value })}
                placeholder="Nome do cliente"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="evento-telefone">Telefone</Label>
                <Input
                  id="evento-telefone"
                  inputMode="tel"
                  value={edicao.telefone}
                  onChange={(e) => setEdicao({ ...edicao, telefone: formatPhoneInput(e.target.value) })}
                  placeholder="(11) 99999-9999"
                />
              </div>
              <div>
                <Label htmlFor="evento-whatsapp">WhatsApp</Label>
                <Select
                  id="evento-whatsapp"
                  value={edicao.whatsapp.toUpperCase() === "NÃO" || edicao.whatsapp.toUpperCase() === "NAO" ? "NÃO" : edicao.whatsapp ? "SIM" : ""}
                  onChange={(e) => setEdicao({ ...edicao, whatsapp: e.target.value })}
                >
                  <option value="">Não informado</option>
                  <option value="SIM">Sim</option>
                  <option value="NÃO">Não</option>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="evento-processo">Número do processo</Label>
              <Input
                id="evento-processo"
                value={edicao.processo}
                onChange={(e) => setEdicao({ ...edicao, processo: e.target.value })}
                placeholder="0000000-00.0000.0.00.0000"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="evento-data">Data</Label>
                <Input
                  id="evento-data"
                  type="date"
                  value={edicao.data}
                  onChange={(e) => setEdicao({ ...edicao, data: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="evento-horario">Horário</Label>
                <Input
                  id="evento-horario"
                  type="time"
                  value={edicao.horario}
                  onChange={(e) => setEdicao({ ...edicao, horario: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="evento-local">Local ou link de acesso</Label>
              <Textarea
                id="evento-local"
                rows={3}
                value={edicao.local}
                onChange={(e) => setEdicao({ ...edicao, local: e.target.value })}
                placeholder="Endereço completo ou link da audiência"
              />
            </div>

            <div>
              <Label htmlFor="evento-profissional">Profissional ou perito</Label>
              <Input
                id="evento-profissional"
                value={edicao.profissionalPerito}
                onChange={(e) => setEdicao({ ...edicao, profissionalPerito: e.target.value })}
                placeholder="Nome do profissional responsável"
              />
            </div>

            {edicao.tinhaLembrete && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Ao alterar o evento, o lembrete anterior continuará no Histórico, mas este compromisso ficará disponível para um novo lembrete com os dados corrigidos.
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={apagarAlvo !== null}
        title="Apagar evento do calendário?"
        message={`Isso vai remover em definitivo "${apagarAlvo?.nome}" (${apagarAlvo?.data}${apagarAlvo?.horario ? ` às ${apagarAlvo.horario}` : ""}) do calendário. Essa ação não pode ser desfeita.`}
        loading={apagando === apagarAlvo?.id}
        onConfirm={confirmarApagar}
        onCancel={() => setApagarAlvo(null)}
      />
    </div>
  );
}

function formatarTituloDia(ymd: string): string {
  const [ano, mes, dia] = ymd.split("-").map(Number);
  return `${dia} de ${NOMES_MES[mes - 1]} de ${ano}`;
}

function formatarPartesData(ymd: string): { dia: string; mes: string; ano: number; diaSemana: string } {
  const [ano, mes, dia] = ymd.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia, 12);
  return {
    dia: pad2(dia),
    mes: NOMES_MES[mes - 1],
    ano,
    diaSemana: data.toLocaleDateString("pt-BR", { weekday: "long" }),
  };
}

function ResultadoBuscaLinha({
  pericia,
  substituidaPor,
  onEditar,
  onExcluir,
  excluindo,
}: {
  pericia: PericiaAgendada;
  substituidaPor?: PericiaAgendada | null;
  onEditar: () => void;
  onExcluir: () => void;
  excluindo?: boolean;
}) {
  const tipo = classificarTipo(pericia);
  return (
    <article
      className={cn(
        "group border-l-4 px-4 py-4 transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30 md:px-5",
        pericia.status === "substituida"
          ? "border-l-zinc-300 bg-zinc-50/40 dark:border-l-zinc-700 dark:bg-zinc-800/20"
          : classesResultadoTipo(tipo.categoria)
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              <Clock className="h-3.5 w-3.5" /> {pericia.horario || "Sem horário"}
            </span>
            <Badge tone={toneTipo(tipo)}>{tipo.rotulo}</Badge>
            {pericia.fonte === "trello_sync" && <Badge tone="neutral">Importado</Badge>}
            {pericia.status === "substituida" && <Badge tone="neutral">Substituída</Badge>}
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.25fr)]">
            <div className="min-w-0">
              <p className={cn("break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100", pericia.status === "substituida" && "line-through opacity-60")}>
                {pericia.nome}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <Phone className="h-3.5 w-3.5 shrink-0" /> {formatPhoneDisplay(pericia.telefone)}
              </p>
            </div>
            <div className="min-w-0 space-y-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {pericia.local && <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{pericia.local}</span></p>}
              {pericia.processo && <p className="flex items-start gap-1.5"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-all">Processo: {pericia.processo}</span></p>}
            </div>
          </div>

          {pericia.status === "substituida" && substituidaPor && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-accent-600 dark:text-accent-400">
              <History className="h-3.5 w-3.5" /> Reagendada para {substituidaPor.data} {substituidaPor.horario && `às ${substituidaPor.horario}`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" title="Editar evento" aria-label="Editar evento" onClick={onEditar}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" title="Apagar" aria-label="Apagar evento" onClick={onExcluir} disabled={excluindo}>
            <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function PericiaLinha({
  pericia,
  substituidaPor,
  onEditar,
  onExcluir,
  excluindo,
}: {
  pericia: PericiaAgendada;
  substituidaPor?: PericiaAgendada | null;
  onEditar?: () => void;
  onExcluir?: () => void;
  excluindo?: boolean;
}) {
  const tipo = classificarTipo(pericia);
  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-sm",
        pericia.status === "substituida"
          ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/30"
          : classesDetalheTipo(tipo.categoria)
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 md:flex md:justify-between">
        <div className="min-w-0">
          <p
            className={cn(
              "break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100 md:truncate md:font-medium",
              pericia.status === "substituida" && "line-through opacity-60"
            )}
          >
            {pericia.nome}
          </p>
          <p className="mt-0.5 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{formatPhoneDisplay(pericia.telefone)}</p>
        </div>
        <div className="col-span-2 flex w-full flex-wrap items-center gap-1.5 pt-1 md:w-auto md:shrink-0 md:pt-0">
          <Badge tone={toneTipo(tipo)}>{tipo.rotulo}</Badge>
          {pericia.fonte === "trello_sync" && <Badge tone="neutral">Importado</Badge>}
          {pericia.status === "substituida" && <Badge tone="neutral">Substituída</Badge>}
          {(onEditar || onExcluir) && (
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              {onEditar && (
                <Button variant="ghost" size="icon" title="Editar evento" aria-label="Editar evento" onClick={onEditar}>
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {onExcluir && (
                <Button variant="ghost" size="icon" title="Apagar" aria-label="Apagar evento" onClick={onExcluir} disabled={excluindo}>
                  <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-col items-start gap-1 text-xs text-zinc-500 dark:text-zinc-400 md:flex-row md:flex-wrap md:gap-x-4">
        {pericia.horario && <span>🕐 {pericia.horario}</span>}
        {pericia.local && <span className="break-words leading-relaxed md:truncate">📍 {pericia.local}</span>}
        {pericia.processo && <span className="break-all md:break-normal">Processo: {pericia.processo}</span>}
      </div>
      {pericia.status === "substituida" && substituidaPor && (
        <p className="mt-2 flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400">
          <History className="h-3.5 w-3.5" /> Reagendada para {substituidaPor.data} {substituidaPor.horario && `às ${substituidaPor.horario}`}
        </p>
      )}
    </div>
  );
}
