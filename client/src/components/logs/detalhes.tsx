import { CheckCircle2, CircleX, Clock3, Send } from "lucide-react";
import type { SystemLog } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
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

export interface DetalhesLog {
  tipo_verificacao?: string;
  horas_limite?: number;
  detectado_em?: string;
  canais?: ResultadoCanal[];
  envios?: ItemNotificacao[];
  pendentes?: ItemNotificacao[];
  regra_alerta?: "falha_envio" | "nao_entregue" | "falha_ou_nao_entregue" | "nao_respondida";
  [chave: string]: unknown;
}

export function formatarDataHora(valor?: string | null): string {
  if (!valor) return "—";
  const data = new Date(valor.endsWith("Z") ? valor : `${valor}Z`);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function formatarTelefone(valor?: string | null): string {
  if (!valor) return "Telefone não informado";
  let digitos = valor.replace(/\D/g, "");
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) digitos = digitos.slice(2);
  if (digitos.length !== 10 && digitos.length !== 11) return valor;
  const corte = digitos.length === 11 ? 7 : 6;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, corte)}-${digitos.slice(corte)}`;
}

export function lerDetalhes(log: SystemLog): DetalhesLog | null {
  if (!log.detalhes_json) return null;
  try {
    const detalhes = JSON.parse(log.detalhes_json);
    return detalhes && typeof detalhes === "object" ? detalhes as DetalhesLog : null;
  } catch {
    return null;
  }
}

export function rotuloOrigem(log: SystemLog, detalhes: DetalhesLog | null): string {
  if (log.origem === "usuario") return "Ação do usuário";
  if (detalhes?.tipo_verificacao === "inicializacao") return "Automático ao iniciar";
  if (log.origem === "automatico") return "Verificação automática";
  return "Evento do sistema";
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

function descricaoRegra(detalhes: DetalhesLog): string {
  const horas = detalhes.horas_limite;
  const falhas = detalhes.envios?.filter((item) => item.status === "falha").length ?? 0;
  const totalEnvios = detalhes.envios?.length ?? 0;
  if (detalhes.regra_alerta === "falha_envio") return "Falha no envio da mensagem";
  if (detalhes.regra_alerta === "falha_ou_nao_entregue") {
    return horas ? `Falha no envio ou mensagem não entregue após ${horas}h` : "Falha no envio ou mensagem não entregue";
  }
  if (!detalhes.regra_alerta && totalEnvios > 0 && falhas === totalEnvios) return "Falha no envio da mensagem";
  if (!detalhes.regra_alerta && falhas > 0) {
    return horas ? `Falha no envio ou mensagem não entregue após ${horas}h` : "Falha no envio ou mensagem não entregue";
  }
  if (detalhes.regra_alerta === "nao_respondida" || detalhes.pendentes) {
    return horas ? `Mensagem entregue e sem resposta após ${horas}h` : "Mensagem entregue e sem resposta";
  }
  if (detalhes.regra_alerta === "nao_entregue" || detalhes.envios) {
    return horas ? `Mensagem não entregue após ${horas}h` : "Mensagem não entregue";
  }
  return horas ? `Prazo de ${horas}h ultrapassado` : "Regra automática";
}

export function DetalhesNotificacao({ detalhes }: { detalhes: DetalhesLog }) {
  const itens = detalhes.envios ?? detalhes.pendentes ?? [];
  const rotuloItem = detalhes.envios ? "Envio" : "Pendente";
  const camposConhecidos = new Set(["tipo_verificacao", "regra_alerta", "horas_limite", "detectado_em", "canais", "envios", "pendentes"]);
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
              <p className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">{descricaoRegra(detalhes)}</p>
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
                      {item.id ? `${rotuloItem} #${item.id} · ` : ""}{item.cliente || "Cliente sem nome"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{formatarTelefone(item.telefone)}</p>
                  </div>
                  <Badge tone={item.status === "falha" ? "danger" : "neutral"}>
                    {item.erro || ackDescricao(item.ack)}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> Enviado em {formatarDataHora(item.enviado_em)}</span>
                  {item.tipo_envio && <span className="flex items-center gap-1.5"><Send className="h-3.5 w-3.5" /> {item.tipo_envio === "lembrete" ? "Lembrete" : item.tipo_envio === "reenvio" ? "Reenvio" : "Disparo"}</span>}
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
