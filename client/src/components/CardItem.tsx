import type { ReactElement } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  UserPlus,
  XCircle,
} from "lucide-react";
import type { CardViewModel, Contact, ModoEnvio } from "@/lib/types";
import { classificarModalidadeAudiencia, type ModalidadeAudiencia } from "@/lib/audiencia";
import { Badge } from "@/components/ui/Badge";
import { cn, formatPlaceholder } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { formatPhoneDisplay } from "@/lib/phone";
import { classificarEvento, type CategoriaEvento } from "@/lib/eventVisual";
import { useAuth } from "@/context/AuthContext";

export interface CardItemProps {
  card: CardViewModel;
  selecionado: boolean;
  onToggleSelecionar: () => void;
  contatoEfetivo: Contact | null;
  criterioContato: CardViewModel["criterioContato"] | "manual";
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
  audiencia_hibrida: "Audiência · Híbrida",
};

const MODALIDADE_LABEL: Record<ModalidadeAudiencia, string> = {
  presencial: "PRESENCIAL",
  online: "ONLINE",
  hibrida: "HÍBRIDA",
};

const OPCOES_MODO_AUDIENCIA: ModoEnvio[] = ["audiencia_presencial", "audiencia_online", "audiencia_hibrida"];

function classesCardAudiencia(modo: ModoEnvio): string {
  if (modo === "audiencia_online") return "border-cyan-300 dark:border-cyan-500/50";
  if (modo === "audiencia_hibrida") return "border-indigo-300 dark:border-indigo-500/50";
  return "border-blue-300 dark:border-blue-500/50";
}

function toneModoAudiencia(modo: ModoEnvio): "info" | "cyan" | "indigo" {
  if (modo === "audiencia_online") return "cyan";
  if (modo === "audiencia_hibrida") return "indigo";
  return "info";
}

function classesSecaoEvento(categoria: CategoriaEvento): string {
  if (categoria === "pericia_medica") return "border-accent-200 bg-accent-50/60 dark:border-accent-900 dark:bg-accent-900/20";
  if (categoria === "pericia_social") return "border-violet-200 bg-violet-50/60 dark:border-violet-900 dark:bg-violet-950/20";
  if (categoria === "audiencia_presencial") return "border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20";
  if (categoria === "audiencia_online") return "border-cyan-200 bg-cyan-50/60 dark:border-cyan-900 dark:bg-cyan-950/20";
  if (categoria === "audiencia_hibrida") return "border-indigo-200 bg-indigo-50/60 dark:border-indigo-900 dark:bg-indigo-950/20";
  return "border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-800/40";
}

export function CardItem({
  card,
  selecionado,
  onToggleSelecionar,
  contatoEfetivo,
  criterioContato,
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
  const { can } = useAuth();
  const temNaoIdentificado = card.pericias.some(
    (p) =>
      p.data?.includes("NAO_IDENTIFICADA") ||
      p.horario?.includes("NAO_IDENTIFICADO") ||
      p.local?.includes("NAO_IDENTIFICADO") ||
      p.tipo?.includes("NAO_IDENTIFICADO")
  );

  const contatoConfirmado = criterioContato === "nome_processo";

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-card transition-shadow hover:shadow-md dark:bg-zinc-900",
        temNaoIdentificado
          ? "border-amber-300 dark:border-amber-500/50"
          : temAudiencia
            ? classesCardAudiencia(modo)
            : "border-zinc-200 dark:border-zinc-800"
      )}
    >
      <div className="p-4 md:p-5">
        <div className="flex items-start gap-3">
          {can("messages.send") && <div className="pt-1">
            <Checkbox checked={selecionado} onChange={onToggleSelecionar} />
          </div>}

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-start gap-2">
                  <h3 className="break-words text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
                    {card.nomeCliente}
                  </h3>
                  {can("calendar.manage") && <button
                    onClick={onEditarNome}
                    title="Editar nome do cliente"
                    className="mt-0.5 shrink-0 text-zinc-400 hover:text-accent-600 dark:text-zinc-500 dark:hover:text-accent-400"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>}
                </div>
                <p className="mt-1 hidden truncate text-xs text-zinc-400 md:block">{card.cardNome}</p>
              </div>
              {can("messages.send") && <Button
                size="sm"
                className="hidden shrink-0 md:inline-flex"
                onClick={onEnviar}
                loading={enviando}
                disabled={!contatoEfetivo || card.pericias.length === 0}
              >
                <Send className="h-3.5 w-3.5" /> Enviar
              </Button>}
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {!temAudiencia && <Badge tone="accent">{card.pericias.length === 2 ? "2 perícias" : "1 perícia"}</Badge>}
              {modo !== "template" && (
                <Badge tone={toneModoAudiencia(modo)}>
                  <Gavel className="h-3 w-3" /> {MODO_LABEL[modo]}
                </Badge>
              )}
              {card.incompleta && (
                <Badge tone="warning">
                  <AlertTriangle className="h-3 w-3" /> Descrição incompleta
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {card.pericias.map((p, i) => (
            <section
              key={i}
              className={cn(
                "relative rounded-xl border p-3.5 md:p-4",
                classesSecaoEvento(classificarEvento(p).categoria)
              )}
            >
              {p.remarcacao && (
                <span
                  className="absolute -left-3 -top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-violet-600 text-white shadow-md dark:border-zinc-900 dark:bg-violet-500"
                  title="Remarcação detectada"
                  aria-label="Remarcação detectada"
                >
                  <RefreshCw className="h-4 w-4" strokeWidth={2.25} />
                </span>
              )}
              <div className="flex items-start justify-between gap-3">
                <div className={cn("min-w-0", p.remarcacao && "pl-3")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">
                      {p.origem === "audiencia"
                        ? `AUDIÊNCIA · ${MODALIDADE_LABEL[classificarModalidadeAudiencia(p.tipo)]}`
                        : formatPlaceholder(p.tipo) || "Tipo não identificado"}
                    </p>
                    {p.remarcacao && (
                      <Badge tone="violet" className="px-2 py-0.5 text-[10px] uppercase tracking-wide">
                        Remarcação
                      </Badge>
                    )}
                  </div>
                  {p.remarcacao && (
                    <p className="mt-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                      {p.remarcacao.data_anterior}
                      {p.remarcacao.horario_anterior ? ` às ${p.remarcacao.horario_anterior}` : ""}
                      {" → "}
                      {formatPlaceholder(p.data)}
                      {p.horario ? ` às ${formatPlaceholder(p.horario)}` : ""}
                    </p>
                  )}
                </div>
                {can("calendar.manage") && <button
                  onClick={() => onEditarPericia(i)}
                  title="Editar informações da perícia"
                  className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-white hover:text-accent-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-accent-400"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <InfoItem icon={<Calendar />} label="Data" value={formatPlaceholder(p.data)} />
                <InfoItem icon={<Clock />} label="Horário" value={formatPlaceholder(p.horario)} />
                <InfoItem className="col-span-2" icon={<MapPin />} label="Local" value={formatPlaceholder(p.local)} />
                {p.processo && <InfoItem className="col-span-2 md:col-span-1" icon={<FileText />} label="Processo" value={p.processo} />}
                {p.profissionalPerito && (
                  <InfoItem
                    className="col-span-2 md:col-span-1"
                    icon={<BriefcaseBusiness />}
                    label="Profissional / Perito"
                    value={p.profissionalPerito}
                  />
                )}
                {p.telefone && <InfoItem icon={<Phone />} label="Telefone do cartão" value={formatPhoneDisplay(p.telefone)} />}
                {p.whatsapp && <InfoItem icon={<Smartphone />} label="WhatsApp" value={p.whatsapp} />}
              </div>
            </section>
          ))}
          {card.pericias.length === 0 && (
            <p className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-400 dark:bg-zinc-800/50">
              Nenhuma perícia identificada na descrição deste card.
            </p>
          )}
        </div>

        {temAudiencia && (
          <div className="mt-3 grid gap-1.5 md:flex md:items-center md:gap-2">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Enviar como</label>
            <Select value={modo} onChange={(e) => onChangeModo(e.target.value as ModoEnvio)} className="w-full text-xs md:w-64">
              {OPCOES_MODO_AUDIENCIA.map((opcao) => (
                <option key={opcao} value={opcao}>
                  {MODO_LABEL[opcao]}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
          {contatoEfetivo ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={contatoConfirmado || criterioContato === "telefone_card" ? "success" : "warning"}>
                    {contatoConfirmado ? <ShieldCheck className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {criterioContato === "nome_processo"
                      ? "Nome e processo confirmados"
                      : criterioContato === "telefone_card"
                        ? "Telefone informado no cartão"
                        : criterioContato === "manual"
                          ? "Contato selecionado manualmente"
                          : "Contato encontrado pelo nome"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {formatPhoneDisplay(contatoEfetivo.telefone)}
                </p>
                {contatoEfetivo.processo && (
                  <p className="mt-0.5 break-all text-xs text-zinc-500 dark:text-zinc-400">Processo: {contatoEfetivo.processo}</p>
                )}
              </div>
              {can("contacts.manage") && <Button variant="ghost" size="sm" className="self-start sm:self-center" onClick={onEditarContato}>
                <Pencil className="h-3.5 w-3.5" /> Editar contato
              </Button>}
            </div>
          ) : card.sugestaoContato ? (
            <div className="space-y-2">
              <Badge tone="warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {criterioContato === "processo_divergente" ? "Nome igual, mas processo diferente" : "Contato precisa de confirmação"}
              </Badge>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Sugestão: <span className="font-medium">{card.sugestaoContato.nome}</span> · {formatPhoneDisplay(card.sugestaoContato.telefone)}
              </p>
              {can("contacts.manage") && <div className="flex flex-wrap gap-3 text-xs font-medium">
                <button onClick={onUsarSugestao} className="text-accent-700 hover:underline dark:text-accent-400">
                  Confirmar esta sugestão
                </button>
                <button onClick={onCadastrarContato} className="flex items-center gap-1 text-accent-700 hover:underline dark:text-accent-400">
                  <UserPlus className="h-3.5 w-3.5" /> Cadastrar outro contato
                </button>
              </div>}
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Badge tone="danger">
                <XCircle className="h-3.5 w-3.5" /> Sem contato cadastrado
              </Badge>
              {can("contacts.manage") && <Button variant="outline" size="sm" onClick={onCadastrarContato}>
                <UserPlus className="h-3.5 w-3.5" /> Cadastrar contato
              </Button>}
            </div>
          )}
        </div>

        {card.ultimoEnvio?.status === "sucesso" && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-accent-700 dark:text-accent-400">
            <MessageCircle className="h-3.5 w-3.5" /> Enviado em{" "}
            {new Date(card.ultimoEnvio.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </p>
        )}
        {card.ultimoEnvio?.status === "falha" && (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">Falhou: {card.ultimoEnvio.erro}</p>
        )}

        <Button
          className="mt-4 w-full md:hidden"
          onClick={onEnviar}
          loading={enviando}
          disabled={!contatoEfetivo || card.pericias.length === 0}
        >
          <Send className="h-4 w-4" /> Enviar mensagem
        </Button>
      </div>
    </article>
  );
}

function InfoItem({
  icon,
  label,
  value,
  className,
}: {
  icon: ReactElement;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2", className)}>
      <span className="mt-0.5 shrink-0 text-zinc-400 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</span>
        <span className="mt-0.5 block break-words leading-relaxed text-zinc-600 dark:text-zinc-300">{value || "Não informado"}</span>
      </span>
    </div>
  );
}
