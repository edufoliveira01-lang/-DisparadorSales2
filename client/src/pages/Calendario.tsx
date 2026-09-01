import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, History, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { PericiaAgendada } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

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

function rotuloNormalizado(valor: string): string {
  const limpo = valor.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  return limpo ? limpo.charAt(0).toLocaleUpperCase("pt-BR") + limpo.slice(1) : "Tipo não identificado";
}

/** Consolida as variações antigas do banco em categorias estáveis para filtro e cor. */
function classificarTipo(pericia: PericiaAgendada): TipoCalendario {
  const tipo = textoComparavel(pericia.tipo);
  const origem = textoComparavel(pericia.origem);
  const nome = textoComparavel(pericia.nome);
  const nomeIndicaAudiencia = ["AUDIENCIA", "[AUDIENCIA]", "ONLINE", "[ONLINE]"].includes(nome);

  if (tipo.includes("AUDIENCIA") || tipo.includes("ONLINE") || origem === "AUDIENCIA" || nomeIndicaAudiencia) {
    return { chave: "audiencia", rotulo: "Audiência", audiencia: true, identificado: true };
  }
  if (tipo.includes("SOCIAL") || origem === "SOCIAL") {
    return { chave: "pericia_social", rotulo: "Perícia social", audiencia: false, identificado: true };
  }
  if (tipo.includes("MEDICA") || origem === "MEDICA") {
    return { chave: "pericia_medica", rotulo: "Perícia médica", audiencia: false, identificado: true };
  }
  if (!tipo || tipo.includes("TIPO NAO IDENTIFICADO")) {
    return { chave: "tipo_nao_identificado", rotulo: "Tipo não identificado", audiencia: false, identificado: false };
  }
  if (tipo === "PERICIA") {
    return { chave: "pericia", rotulo: "Perícia", audiencia: false, identificado: true };
  }

  return {
    chave: `outro:${tipo}`,
    rotulo: rotuloNormalizado(pericia.tipo),
    audiencia: false,
    identificado: true,
  };
}

function classesEventoCalendario(pericia: PericiaAgendada): string {
  if (pericia.status === "substituida") {
    return "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800 dark:text-zinc-600";
  }
  if (classificarTipo(pericia).audiencia) {
    return "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300";
  }
  return "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300";
}

/** "YYYY-MM-DD" no fuso de São Paulo, para agrupar por dia independente do fuso do navegador. */
function diaLocalYMD(dataHoraMs: number): string {
  return new Date(dataHoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function hojeYMD(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
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
  const [apagarAlvo, setApagarAlvo] = useState<PericiaAgendada | null>(null);
  const [apagando, setApagando] = useState<number | null>(null);

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
    const termo = busca.trim().toLowerCase();
    const termoDigits = termo.replace(/\D/g, "");
    return pericias.filter((p) => {
      if (!mostrarSubstituidas && p.status === "substituida") return false;
      if (tipoFiltro !== "todos" && classificarTipo(p).chave !== tipoFiltro) return false;
      if (termo) {
        const nomeMatch = p.nome.toLowerCase().includes(termo);
        const processoMatch = (p.processo || "").toLowerCase().includes(termo);
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

  const periciasDoDiaSelecionado = diaSelecionado ? porDia.get(diaSelecionado) ?? [] : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Calendário de Perícias</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Perícias já comunicadas ao cliente por WhatsApp, mais o que foi importado manualmente do Trello (badge
            "Importado"). Eventos com o mesmo tipo, nome, data e horário são consolidados automaticamente.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={irParaMesAnterior} title="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-40 text-center text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {NOMES_MES[mes - 1]} {ano}
          </span>
          <Button variant="outline" size="icon" onClick={irParaProximoMes} title="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={irParaHoje}>
            Hoje
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input placeholder="Nome, telefone ou processo…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)} className="w-44">
            <option value="todos">Todos os tipos</option>
            {tiposDisponiveis.map((tipo) => (
              <option key={tipo.chave} value={tipo.chave}>
                {tipo.rotulo}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <Checkbox checked={mostrarSubstituidas} onChange={() => setMostrarSubstituidas((v) => !v)} />
            Mostrar substituídas
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
                return (
                  <div key={key} className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className={cn("mb-2 text-sm font-semibold", ehHoje ? "text-accent-600 dark:text-accent-400" : "text-zinc-700 dark:text-zinc-300")}>
                      {cel.dia} de {NOMES_MES[cel.mes - 1]}
                      {ehHoje && " · Hoje"}
                    </p>
                    <div className="space-y-2">
                      {itens.map((p) => (
                        <PericiaLinha key={p.id} pericia={p} onExcluir={() => setApagarAlvo(p)} excluindo={apagando === p.id} />
                      ))}
                    </div>
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
              onExcluir={() => setApagarAlvo(p)}
              excluindo={apagando === p.id}
            />
          ))}
        </div>
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

function PericiaLinha({
  pericia,
  substituidaPor,
  onExcluir,
  excluindo,
}: {
  pericia: PericiaAgendada;
  substituidaPor?: PericiaAgendada | null;
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
          : tipo.audiencia
            ? "border-blue-300 border-l-4 border-l-blue-500 bg-blue-50/70 shadow-sm dark:border-blue-800 dark:border-l-blue-400 dark:bg-blue-950/30"
            : "border-zinc-200 dark:border-zinc-800"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("truncate font-medium text-zinc-900 dark:text-zinc-100", pericia.status === "substituida" && "line-through opacity-60")}>
            {pericia.nome}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{formatPhoneDisplay(pericia.telefone)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge tone={tipo.audiencia ? "info" : tipo.identificado ? "accent" : "neutral"}>{tipo.rotulo}</Badge>
          {pericia.fonte === "trello_sync" && <Badge tone="neutral">Importado</Badge>}
          {pericia.status === "substituida" && <Badge tone="neutral">Substituída</Badge>}
          {onExcluir && (
            <Button variant="ghost" size="icon" title="Apagar" onClick={onExcluir} disabled={excluindo}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {pericia.horario && <span>🕐 {pericia.horario}</span>}
        {pericia.local && <span className="truncate">📍 {pericia.local}</span>}
        {pericia.processo && <span>Processo: {pericia.processo}</span>}
      </div>
      {pericia.status === "substituida" && substituidaPor && (
        <p className="mt-2 flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400">
          <History className="h-3.5 w-3.5" /> Reagendada para {substituidaPor.data} {substituidaPor.horario && `às ${substituidaPor.horario}`}
        </p>
      )}
    </div>
  );
}
