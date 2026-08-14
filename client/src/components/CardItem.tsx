import { AlertTriangle, Calendar, CheckCircle2, Clock, Gavel, MapPin, MessageCircle, Pencil, Send, UserPlus, XCircle } from "lucide-react";
import type { CardViewModel, ModoEnvio } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { cn, formatPlaceholder } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";

interface CardItemProps {
  card: CardViewModel;
  selecionado: boolean;
  onToggleSelecionar: () => void;
  temContatoEfetivo: boolean;
  onEnviar: () => void;
  onCadastrarContato: () => void;
  onEditarContato: () => void;
  onEditarNome: () => void;
  onEditarPericia: (index: number) => void;
  onUsarSugestao: () => void;
  enviando: boolean;
  /** true quando o card tem uma perícia marcada como audiência (cabeçalho "AUDIÊNCIA" no Trello). */
  temAudiencia: boolean;
  /** Modo de envio efetivo (auto-detectado ou ajustado manualmente). */
  modo: ModoEnvio;
  onChangeModo: (modo: ModoEnvio) => void;
}

const MODO_LABEL: Record<ModoEnvio, string> = {
  template: "Perícia (template selecionado)",
  audiencia_presencial: "Audiência · Presencial",
  audiencia_online: "Audiência · Online",
};

export function CardItem({
  card,
  selecionado,
  onToggleSelecionar,
  temContatoEfetivo,
  onEnviar,
  onCadastrarContato,
  onEditarContato,
  onEditarNome,
  onEditarPericia,
  onUsarSugestao,
  enviando,
  temAudiencia,
  modo,
  onChangeModo,
}: CardItemProps) {
  const temNaoIdentificado = card.pericias.some(
    (p) =>
      p.data?.includes("NAO_IDENTIFICADA") ||
      p.horario?.includes("NAO_IDENTIFICADO") ||
      p.local?.includes("NAO_IDENTIFICADO") ||
      p.tipo?.includes("NAO_IDENTIFICADO")
  );

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-5 shadow-card transition-shadow hover:shadow-md dark:bg-zinc-900",
        temNaoIdentificado
          ? "border-amber-400 bg-amber-50/30 dark:border-amber-500/50 dark:bg-amber-900/10"
          : "border-zinc-200 dark:border-zinc-800"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox checked={selecionado} onChange={onToggleSelecionar} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{card.nomeCliente}</h3>
              <button
                onClick={onEditarNome}
                title="Editar nome do cliente"
                className="text-zinc-400 hover:text-accent-600 dark:text-zinc-500 dark:hover:text-accent-400"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <Badge tone="accent">{card.pericias.length === 2 ? "2 perícias" : "1 perícia"}</Badge>
              {modo !== "template" && (
                <Badge tone="info">
                  <Gavel className="h-3 w-3" /> {MODO_LABEL[modo]}
                </Badge>
              )}
              {card.incompleta && (
                <Badge tone="warning">
                  <AlertTriangle className="h-3 w-3" /> Descrição incompleta
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              className="shrink-0"
              onClick={onEnviar}
              loading={enviando}
              disabled={!temContatoEfetivo || card.pericias.length === 0}
            >
              <Send className="h-3.5 w-3.5" /> Enviar
            </Button>
          </div>

          <p className="mt-0.5 truncate text-xs text-zinc-400">{card.cardNome}</p>

          <div className="mt-3 space-y-2">
            {card.pericias.map((p, i) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-700 dark:text-zinc-200">{formatPlaceholder(p.tipo) || "(tipo não identificado)"}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" /> {formatPlaceholder(p.data)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> {formatPlaceholder(p.horario)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {formatPlaceholder(p.local)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => onEditarPericia(i)}
                  title="Editar informações da perícia"
                  className="shrink-0 text-zinc-400 hover:text-accent-600 dark:text-zinc-500 dark:hover:text-accent-400"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {card.pericias.length === 0 && (
              <p className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-400 dark:bg-zinc-800/50">
                Nenhuma perícia identificada na descrição deste card.
              </p>
            )}
          </div>

          {temAudiencia && (
            <div className="mt-3 flex items-center gap-2">
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Enviar como:</label>
              <Select
                value={modo}
                onChange={(e) => onChangeModo(e.target.value as ModoEnvio)}
                className="w-56 text-xs"
              >
                <option value="audiencia_presencial">{MODO_LABEL.audiencia_presencial}</option>
                <option value="audiencia_online">{MODO_LABEL.audiencia_online}</option>
                <option value="template">{MODO_LABEL.template}</option>
              </Select>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {temContatoEfetivo ? (
              <div className="flex items-center gap-1.5">
                <Badge tone="success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Contato encontrado
                </Badge>
                <button
                  onClick={onEditarContato}
                  title="Editar contato/número"
                  className="text-zinc-400 hover:text-accent-600 dark:text-zinc-500 dark:hover:text-accent-400"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : card.sugestaoContato ? (
              <div className="flex items-center gap-1.5">
                <Badge tone="warning">Talvez: {card.sugestaoContato.nome}?</Badge>
                <button onClick={onUsarSugestao} className="text-xs font-medium text-accent-600 hover:underline">
                  Usar este contato
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Badge tone="danger">
                  <XCircle className="h-3.5 w-3.5" /> Sem contato cadastrado
                </Badge>
                <button
                  onClick={onCadastrarContato}
                  className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Cadastrar
                </button>
              </div>
            )}

            {card.ultimoEnvio?.status === "sucesso" && (
              <Badge tone="success">
                <MessageCircle className="h-3.5 w-3.5" /> Enviado em {new Date(card.ultimoEnvio.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
              </Badge>
            )}
            {card.ultimoEnvio?.status === "falha" && <Badge tone="danger">Falhou: {card.ultimoEnvio.erro}</Badge>}
          </div>
        </div>
      </div>
    </div>
  );
}
