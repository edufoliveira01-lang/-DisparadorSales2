import { useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  MapPin,
  Pencil,
  Phone,
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
  const statusContato = contato
    ? confirmado || criterioContato === "telefone_card" ? { tom: "success" as const, texto: confirmado ? "Nome e processo confirmados" : "Telefone do cartão" }
      : { tom: "warning" as const, texto: criterioContato === "manual" ? "Contato escolhido manualmente" : "Contato encontrado só pelo nome" }
    : { tom: "danger" as const, texto: card.sugestaoContato ? "Contato precisa de confirmação" : "Sem contato cadastrado" };
  const iniciais = card.nomeCliente.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <>
      <article
        className={cn(
          "rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-zinc-900",
          selecionado ? "border-accent-400 ring-1 ring-accent-200 dark:ring-accent-800" : "border-zinc-200 dark:border-zinc-800",
          !contato && "border-l-4 border-l-red-400",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {can("messages.send") && <span className="mt-1"><Checkbox aria-label={`Selecionar ${card.nomeCliente}`} checked={selecionado} onChange={props.onToggleSelecionar} /></span>}
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-200 sm:flex" aria-hidden="true">{iniciais}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{card.nomeCliente}</h3>
                {can("contacts.manage") && <button type="button" title="Editar nome do cliente" aria-label={`Editar nome de ${card.nomeCliente}`} onClick={props.onEditarNome} className="rounded p-1 text-zinc-400 hover:text-accent-600"><Pencil className="h-3.5 w-3.5" /></button>}
                <Badge tone={statusContato.tom}>{contato ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} {statusContato.texto}</Badge>
                {card.ultimoEnvio && <Badge tone={card.ultimoEnvio.status === "sucesso" ? "success" : "danger"}>{card.ultimoEnvio.status === "sucesso" ? "Aviso enviado" : "Falha no envio"}</Badge>}
                {props.temAudiencia && <Badge tone="info">Envio: {modoLabel}</Badge>}
                {(card.incompleta || dadosNaoIdentificados) && <Badge tone="warning"><AlertTriangle className="h-3 w-3" /> Revisar dados</Badge>}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="whitespace-nowrap font-mono">{processos.join(" · ") || contato?.processo || "Processo não informado"}</span>
                {contato && <span className="inline-flex items-center gap-1 whitespace-nowrap"><Phone className="h-3 w-3" />{formatPhoneDisplay(contato.telefone)}</span>}
              </p>
              <ul className="mt-2 space-y-1.5">
                {card.pericias.map((p, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-300">
                    <span className="font-semibold text-accent-700 dark:text-accent-300">{formatPlaceholder(p.tipo) || "Tipo não identificado"}</span>
                    <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-zinc-400" />{formatPlaceholder(p.data)}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5 text-zinc-400" />{formatPlaceholder(p.horario)}</span>
                    <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-400" /><span className="truncate">{formatPlaceholder(p.local) || "Local não informado"}</span></span>
                    {p.profissionalPerito && <span className="text-zinc-500">· {p.profissionalPerito}</span>}
                    {p.remarcacao && <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300"><RefreshCw className="h-3 w-3" /> Remarcação: de {p.remarcacao.data_anterior} {p.remarcacao.horario_anterior}</span>}
                    {can("calendar.manage") && <button type="button" title="Editar informações da perícia" aria-label={`Editar compromisso ${index + 1} de ${card.nomeCliente}`} onClick={() => props.onEditarPericia(index)} className="ml-auto rounded p-1 text-zinc-400 hover:text-accent-600"><Pencil className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
                {!card.pericias.length && <li className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">Nenhuma perícia identificada. Revise o card de origem.</li>}
              </ul>
              {card.ultimoEnvio && <p className={`mt-1.5 text-[11px] ${card.ultimoEnvio.status === "falha" ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}`}>{card.ultimoEnvio.status === "falha" ? card.ultimoEnvio.erro : `Último aviso: ${new Date(card.ultimoEnvio.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:w-44 sm:flex-col sm:items-stretch">
            {can("messages.send") && <Button size="sm" onClick={props.onEnviar} loading={enviando} disabled={!contato || !card.pericias.length}><Send className="h-3.5 w-3.5" /> Revisar e avisar</Button>}
            {can("contacts.manage") && (contato
              ? <Button size="sm" variant="outline" onClick={props.onEditarContato}>Editar contato</Button>
              : <Button size="sm" variant="outline" onClick={props.onCadastrarContato}><UserPlus className="h-3.5 w-3.5" /> Cadastrar contato</Button>)}
            <button type="button" onClick={() => setDetailsOpen(true)} className="text-center text-xs font-medium text-accent-700 hover:underline dark:text-accent-300">Ver detalhes</button>
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

