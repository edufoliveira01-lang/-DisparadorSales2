import { useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  MapPin,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { CardItem, type CardItemProps } from "./CardItem";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Modal } from "./ui/Modal";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatPlaceholder, cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

export function DispatchCard(props: CardItemProps) {
  const { can } = useAuth();
  const {
    card,
    contatoEfetivo: contato,
    criterioContato,
    selecionado,
    enviando,
  } = props;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const processos = [
    ...new Set(card.pericias.map((p) => p.processo).filter(Boolean)),
  ];
  const confirmado = criterioContato === "nome_processo";
  const dadosNaoIdentificados = card.pericias.some((p) =>
    [p.data, p.horario, p.local, p.tipo].some((value) =>
      value?.includes("NAO_IDENTIFICAD"),
    ),
  );
  const modoLabel = {
    template: "Modelo de perícia",
    audiencia_presencial: "Audiência presencial",
    audiencia_online: "Audiência online",
    audiencia_hibrida: "Audiência híbrida",
  }[props.modo];
  const closeThen = (action: () => void) => () => {
    setDetailsOpen(false);
    action();
  };
  return (
    <>
      <article
        className={cn(
          "dispatch-ticket",
          selecionado
            ? "border-accent-400 ring-1 ring-accent-200 dark:ring-accent-800"
            : "border-zinc-200 dark:border-zinc-800",
        )}
      >
        <div className="dispatch-identity"><span className="client-avatar" aria-hidden="true">{card.nomeCliente.split(" ").filter(Boolean).slice(0,2).map(word=>word[0]).join("")}</span>
          {can("messages.send") && <Checkbox
            aria-label={`Selecionar ${card.nomeCliente}`}
            checked={selecionado}
            onChange={props.onToggleSelecionar}
          />}
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {card.nomeCliente}
            </h3>
            <p className="mt-[6px] break-all text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {processos.join(" · ") ||
                contato?.processo ||
                "Processo não informado"}
              {contato && (
                <span> · {formatPhoneDisplay(contato.telefone)}</span>
              )}
            </p>
          </div>
          {can("contacts.manage") && <Button
            variant="ghost"
            size="icon"
            title="Editar nome do cliente"
            aria-label={`Editar nome de ${card.nomeCliente}`}
            onClick={props.onEditarNome}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>}
        </div>
        <div className="dispatch-schedule">
          {card.pericias.map((p, index) => {
            return (
              <section
                key={index}
                className="rounded-xl border border-zinc-200/70 bg-zinc-50 px-3 py-[11px] text-xs leading-[1.9] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/30 dark:text-zinc-400"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-zinc-700 dark:text-accent-300">
                    {formatPlaceholder(p.tipo) || "Tipo não identificado"}
                  </span>
                  {can("calendar.manage") && <button
                    type="button"
                    title="Editar informações da perícia"
                    aria-label={`Editar compromisso ${index + 1} de ${card.nomeCliente}`}
                    onClick={() => props.onEditarPericia(index)}
                    className="rounded p-1 text-zinc-500 hover:text-accent-600 dark:text-zinc-400"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-zinc-400" />
                    {formatPlaceholder(p.data)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5 text-zinc-400" />
                    {formatPlaceholder(p.horario)}
                  </span>
                </div>
                <p className="mt-1 flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {formatPlaceholder(p.local) || "Local não informado"}
                </p>
                {p.profissionalPerito && (
                  <p className="mt-1">Profissional: {p.profissionalPerito}</p>
                )}
                {p.remarcacao && (
                  <p className="mt-1 flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Remarcação: de {p.remarcacao.data_anterior}{" "}
                      {p.remarcacao.horario_anterior} para{" "}
                      {formatPlaceholder(p.data)} {formatPlaceholder(p.horario)}
                    </span>
                  </p>
                )}
              </section>
            );
          })}
          {!card.pericias.length && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              Nenhuma perícia identificada. Revise o card de origem.
            </p>
          )}
        </div>
        <div className="dispatch-controls">        {(card.incompleta || dadosNaoIdentificados) && (
          <Badge tone="warning" className="mt-3 self-start">
            <AlertTriangle className="h-3 w-3" /> Descrição incompleta · revisar
            dados
          </Badge>
        )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                contato
                  ? confirmado || criterioContato === "telefone_card"
                    ? "success"
                    : "warning"
                  : "danger"
              }
            >
              {contato ? (
                <ShieldCheck className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {contato
                ? confirmado
                  ? "Nome e processo confirmados"
                  : criterioContato === "telefone_card"
                    ? "Telefone do cartão"
                    : criterioContato === "manual"
                      ? "Contato escolhido manualmente"
                      : "Contato encontrado pelo nome"
                : card.sugestaoContato
                  ? "Contato precisa de confirmação"
                  : "Sem contato cadastrado"}
            </Badge>
            {props.temAudiencia && (
              <Badge tone="info">Envio: {modoLabel}</Badge>
            )}
            {card.ultimoEnvio && (
              <Badge
                tone={
                  card.ultimoEnvio.status === "sucesso" ? "success" : "danger"
                }
              >
                {card.ultimoEnvio.status === "sucesso"
                  ? "Aviso enviado"
                  : "Falha no envio"}
              </Badge>
            )}
          </div>
          {card.ultimoEnvio && (
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              {card.ultimoEnvio.status === "falha"
                ? card.ultimoEnvio.erro
                : `Último aviso: ${new Date(card.ultimoEnvio.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
            </p>
          )}
          <div className="ticket-actions">
            {can("messages.send") && <Button
              size="sm"
              onClick={props.onEnviar}
              loading={enviando}
              disabled={!contato || !card.pericias.length}
            >
              <Send className="h-3.5 w-3.5" /> Revisar e avisar
            </Button>}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDetailsOpen(true)}
            >
              Ver detalhes
            </Button>
            {can("contacts.manage") && (contato ? (
              <Button
                size="sm"
                variant="outline"
                onClick={props.onEditarContato}
              >
                Editar contato
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={props.onCadastrarContato}
              >
                <UserPlus className="h-3.5 w-3.5" /> Cadastrar contato
              </Button>
            ))}
          </div>
        </div>
      </article>
      <Modal
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title={`Dados do aviso · ${card.nomeCliente}`}
        description="Confira os dados do compromisso, o contato e o formato da mensagem."
        maxWidth="max-w-3xl"
      >
        <CardItem
          {...props}
          onEnviar={closeThen(props.onEnviar)}
          onCadastrarContato={closeThen(props.onCadastrarContato)}
          onEditarContato={closeThen(props.onEditarContato)}
          onEditarNome={closeThen(props.onEditarNome)}
          onEditarPericia={(index) => {
            setDetailsOpen(false);
            props.onEditarPericia(index);
          }}
          onUsarSugestao={closeThen(props.onUsarSugestao)}
        />
      </Modal>
    </>
  );
}

