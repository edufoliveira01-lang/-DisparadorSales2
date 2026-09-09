import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleX,
  Clock3,
  Info,
  RefreshCw,
  Search,
  ScrollText,
  Send,
  Smartphone,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import type { SystemLog } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { cn } from "@/lib/utils";

interface ResultadoCanal {
  canal?: string;
  sucesso?: boolean;
  erro?: string | null;
}

interface ItemNotificacao {
  id?: number;
  cliente?: string | null;
  telefone?: string | null;
  enviado_em?: string | null;
  tipo_envio?: string;
  status?: string;
  ack?: number | null;
  erro?: string | null;
}

interface DetalhesLog {
  tipo_verificacao?: string;
  horas_limite?: number;
  detectado_em?: string;
  canais?: ResultadoCanal[];
  envios?: ItemNotificacao[];
  pendentes?: ItemNotificacao[];
  [chave: string]: unknown;
}

function formatarDataHora(valor?: string | null): string {
  if (!valor) return "—";
  const data = new Date(valor.endsWith("Z") ? valor : `${valor}Z`);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatarTelefone(valor?: string | null): string {
  if (!valor) return "Telefone não informado";
  let digitos = valor.replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return valor;
  const corte = digitos.length === 11 ? 7 : 6;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, corte)}-${digitos.slice(corte)}`;
}

function lerDetalhes(log: SystemLog): DetalhesLog | null {
  if (!log.detalhes_json) return null;
  try {
    const detalhes = JSON.parse(log.detalhes_json);
    return detalhes && typeof detalhes === "object" ? detalhes as DetalhesLog : null;
  } catch {
    return null;
  }
}

function rotuloOrigem(log: SystemLog, detalhes: DetalhesLog | null): string {
  if (log.origem === "usuario") return "Ação do usuário";
  if (detalhes?.tipo_verificacao === "inicializacao") return "Automático ao iniciar";
  if (log.origem === "automatico") return "Verificação automática";
  return "Evento do sistema";
}

function badgeNivel(nivel: SystemLog["nivel"]): { tone: "info" | "warning" | "danger"; label: string } {
  if (nivel === "erro") return { tone: "danger", label: "Erro" };
  if (nivel === "aviso") return { tone: "warning", label: "Atenção" };
  return { tone: "info", label: "Informação" };
}

function ackDescricao(ack?: number | null): string {
  if (ack === null || ack === undefined) return "Sem confirmação";
  if (ack < 0) return "Erro confirmado";
  if (ack === 0) return "Pendente";
  if (ack === 1) return "Enviado ao servidor";
  if (ack === 2) return "Entregue";
  if (ack >= 3) return "Lido";
  return `Confirmação ${ack}`;
}

function DetalhesNotificacao({ detalhes }: { detalhes: DetalhesLog }) {
  const itens = detalhes.envios ?? detalhes.pendentes ?? [];
  const camposConhecidos = new Set(["tipo_verificacao", "horas_limite", "detectado_em", "canais", "envios", "pendentes"]);
  const extras = Object.fromEntries(Object.entries(detalhes).filter(([chave]) => !camposConhecidos.has(chave)));

  return (
    <div className="mt-4 space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      {(detalhes.detectado_em || detalhes.horas_limite) && (
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          {detalhes.detectado_em && (
            <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Detectado em</span>
              <p className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">{formatarDataHora(detalhes.detectado_em)}</p>
            </div>
          )}
          {detalhes.horas_limite && (
            <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">Regra que gerou o alerta</span>
              <p className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">Mais de {detalhes.horas_limite}h sem confirmação</p>
            </div>
          )}
        </div>
      )}

      {detalhes.canais && detalhes.canais.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Canais notificados</p>
          <div className="flex flex-wrap gap-2">
            {detalhes.canais.map((canal, index) => (
              <div
                key={`${canal.canal}-${index}`}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                  canal.sucesso
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                )}
              >
                {canal.sucesso ? <CheckCircle2 className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
                <span className="font-medium">{canal.canal || "Canal"}</span>
                <span>{canal.sucesso ? "enviado" : canal.erro || "falhou"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {itens.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {detalhes.envios ? "Envios relacionados" : "Respostas pendentes relacionadas"}
          </p>
          <div className="space-y-2">
            {itens.map((item, index) => (
              <div key={`${item.id}-${index}`} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.id ? `#${item.id} · ` : ""}{item.cliente || "Cliente sem nome"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{formatarTelefone(item.telefone)}</p>
                  </div>
                  <Badge tone={item.status === "falha" ? "danger" : "neutral"}>
                    {item.erro || ackDescricao(item.ack)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Enviado em {formatarDataHora(item.enviado_em)}</span>
                  {item.tipo_envio && <span className="flex items-center gap-1.5"><Send className="h-3.5 w-3.5" /> {item.tipo_envio === "lembrete" ? "Lembrete" : "Disparo"}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {Object.keys(extras).length > 0 && (
        <details className="rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/60">
          <summary className="cursor-pointer font-medium text-zinc-600 dark:text-zinc-300">Dados técnicos</summary>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-zinc-500 dark:text-zinc-400">{JSON.stringify(extras, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function Logs() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [nivel, setNivel] = useState("todos");
  const [categoria, setCategoria] = useState("todas");
  const [abertos, setAbertos] = useState<Set<number>>(new Set());

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      setLogs(await api.get<SystemLog[]>("/system-logs?limit=500"));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível carregar os logs.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregar(); }, []);

  const categorias = useMemo(() => Array.from(new Set(logs.map((log) => log.categoria))).sort(), [logs]);
  const filtrados = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    return logs.filter((log) => {
      if (nivel !== "todos" && log.nivel !== nivel) return false;
      if (categoria !== "todas" && log.categoria !== categoria) return false;
      if (!termo) return true;
      return [log.titulo, log.mensagem, log.evento, log.categoria, log.detalhes_json]
        .some((valor) => valor?.toLocaleLowerCase("pt-BR").includes(termo));
    });
  }, [logs, busca, nivel, categoria]);

  const ultimas24h = logs.filter((log) => Date.now() - new Date(`${log.created_at}Z`).getTime() <= 24 * 60 * 60 * 1000).length;
  const avisos = logs.filter((log) => log.nivel === "aviso").length;
  const erros = logs.filter((log) => log.nivel === "erro").length;

  function alternar(id: number) {
    setAbertos((atuais) => {
      const proximos = new Set(atuais);
      if (proximos.has(id)) proximos.delete(id);
      else proximos.add(id);
      return proximos;
    });
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Logs"
        description="Auditoria de notificações automáticas e erros do sistema, com horários, origem, registros envolvidos e resultado por canal."
        actions={<Button variant="outline" onClick={() => void carregar()} loading={carregando}><RefreshCw className="h-4 w-4" /> Atualizar</Button>}
      />

      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <StatCard icon={<Clock3 />} label="Últimas 24h" value={ultimas24h} tone="info" />
        <StatCard icon={<AlertTriangle />} label="Avisos" value={avisos} tone="warning" />
        <StatCard icon={<CircleX />} label="Erros" value={erros} tone="danger" />
      </div>

      <Card className="p-3 md:p-4">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar cliente, telefone, evento ou erro…" className="pl-9" />
          </div>
          <Select value={nivel} onChange={(e) => setNivel(e.target.value)}>
            <option value="todos">Todos os níveis</option>
            <option value="info">Informações</option>
            <option value="aviso">Avisos</option>
            <option value="erro">Erros</option>
          </Select>
          <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="todas">Todas as categorias</option>
            {categorias.map((item) => <option key={item} value={item}>{item}</option>)}
          </Select>
        </div>
      </Card>

      {carregando ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-36 rounded-2xl" />)}</div>
      ) : erro ? (
        <EmptyState icon={CircleX} title="Não foi possível carregar os logs" description={erro} action={<Button variant="outline" onClick={() => void carregar()}>Tentar novamente</Button>} />
      ) : filtrados.length === 0 ? (
        <EmptyState icon={ScrollText} title={logs.length ? "Nenhum log encontrado" : "Nenhum evento registrado ainda"} description={logs.length ? "Tente alterar os filtros ou a busca." : "Os próximos alertas automáticos e erros aparecerão aqui com todos os detalhes."} />
      ) : (
        <div className="space-y-3">
          {filtrados.map((log) => {
            const detalhes = lerDetalhes(log);
            const nivelVisual = badgeNivel(log.nivel);
            const aberto = abertos.has(log.id);
            const Icone = log.nivel === "erro" ? CircleX : log.nivel === "aviso" ? AlertTriangle : Info;
            return (
              <Card key={log.id} className={cn("overflow-hidden border-l-4", log.nivel === "erro" ? "border-l-red-500" : log.nivel === "aviso" ? "border-l-amber-500" : "border-l-blue-500")}>
                <button type="button" onClick={() => alternar(log.id)} className="w-full p-4 text-left md:p-5" aria-expanded={aberto}>
                  <div className="flex items-start gap-3">
                    <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", log.nivel === "erro" ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400" : log.nivel === "aviso" ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400")}>
                      <Icone className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={nivelVisual.tone}>{nivelVisual.label}</Badge>
                        <Badge>{log.categoria}</Badge>
                        <span className="text-xs text-zinc-400">#{log.id}</span>
                      </div>
                      <h2 className="mt-2 font-semibold text-zinc-900 dark:text-zinc-100">{log.titulo}</h2>
                      {log.mensagem && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{log.mensagem}</p>}
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {formatarDataHora(log.created_at)}</span>
                        <span className="flex items-center gap-1.5">{log.origem === "usuario" ? <UserRound className="h-3.5 w-3.5" /> : log.origem === "automatico" ? <Bot className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />} {rotuloOrigem(log, detalhes)}</span>
                        {log.categoria === "notificacao" && <span className="flex items-center gap-1.5"><BellRing className="h-3.5 w-3.5" /> Notificação administrativa</span>}
                      </div>
                    </div>
                    {aberto ? <ChevronUp className="h-5 w-5 shrink-0 text-zinc-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-zinc-400" />}
                  </div>
                </button>
                {aberto && detalhes && <div className="px-4 pb-4 md:px-5 md:pb-5"><DetalhesNotificacao detalhes={detalhes} /></div>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
