import { AlertTriangle, Calendar, CheckCircle2, Clock, MapPin, MessageCircle, Send, UserPlus, XCircle } from "lucide-react";
import type { CardViewModel } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";

interface CardItemProps {
  card: CardViewModel;
  selecionado: boolean;
  onToggleSelecionar: () => void;
  temContatoEfetivo: boolean;
  onEnviar: () => void;
  onCadastrarContato: () => void;
  onUsarSugestao: () => void;
  enviando: boolean;
}

export function CardItem({
  card,
  selecionado,
  onToggleSelecionar,
  temContatoEfetivo,
  onEnviar,
  onCadastrarContato,
  onUsarSugestao,
  enviando,
}: CardItemProps) {
  // Verifica se o card tem alguma informação não identificada para destacá-lo
  const temDadosNaoIdentificados = card.pericias.some(
    (p) =>
      p.data?.includes("NAO_IDENTIFICADA") ||
      p.horario?.includes("NAO_IDENTIFICADO") ||
      p.local?.includes("NAO_IDENTIFICADO") ||
      p.tipo?.includes("NAO_IDENTIFICADO") ||
      card.nomeCliente?.includes("NAO_IDENTIFICADO")
  );

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-card transition-shadow hover:shadow-md dark:bg-zinc-900 ${
      temDadosNaoIdentificados 
        ? "border-amber-400 bg-amber-50/30 dark:border-amber-700 dark:bg-amber-900/10" 
        : "border-zinc-200 dark:border-zinc-800"
    }`}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Checkbox checked={selecionado} onChange={onToggleSelecionar} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-zinc-900 dark:text-zinc-100">{card.nomeCliente}</h3>
            <Badge tone="accent">{card.pericias.length === 2 ? "2 perícias" : "1 perícia"}</Badge>
            {card.incompleta && (
              <Badge tone="warning">
                <AlertTriangle className="h-3 w-3" /> Descrição incompleta
              </Badge>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-zinc-400">{card.cardNome}</p>

          <div className="mt-3 space-y-2">
            {card.pericias.map((p, i) => (
              <div key={i} className={`rounded-xl p-3 text-sm ${
                p.data?.includes("NAO_IDENTIFICADA") || p.horario?.includes("NAO_IDENTIFICADO") || p.local?.includes("NAO_IDENTIFICADO") || p.tipo?.includes("NAO_IDENTIFICADO")
                  ? "bg-amber-100/50 dark:bg-amber-900/20"
                  : "bg-zinc-50 dark:bg-zinc-800/50"
              }`}>
                <p className="font-medium text-zinc-700 dark:text-zinc-200">
                  {p.tipo || "(tipo não identificado)"}
                  {p.tipo?.includes("NAO_IDENTIFICADO") && <span className="ml-2 text-xs text-amber-600 dark:text-amber-500 font-bold">(Verificar)</span>}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className={`flex items-center gap-1 ${p.data?.includes("NAO_IDENTIFICADA") ? "text-amber-600 font-medium" : ""}`}>
                    <Calendar className="h-3.5 w-3.5" /> {p.data || "—"}
                  </span>
                  <span className={`flex items-center gap-1 ${p.horario?.includes("NAO_IDENTIFICADO") ? "text-amber-600 font-medium" : ""}`}>
                    <Clock className="h-3.5 w-3.5" /> {p.horario || "—"}
                  </span>
                  <span className={`flex items-center gap-1 ${p.local?.includes("NAO_IDENTIFICADO") ? "text-amber-600 font-medium" : ""}`}>
                    <MapPin className="h-3.5 w-3.5" /> {p.local || "—"}
                  </span>
                </div>
              </div>
            ))}
            {card.pericias.length === 0 && (
              <p className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-400 dark:bg-zinc-800/50">
                Nenhuma perícia identificada na descrição deste card.
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {temContatoEfetivo ? (
              <Badge tone="success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Contato encontrado
              </Badge>
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
                <MessageCircle className="h-3.5 w-3.5" /> Enviado em {new Date(card.ultimoEnvio.data).toLocaleString("pt-BR")}
              </Badge>
            )}
            {card.ultimoEnvio?.status === "falha" && <Badge tone="danger">Falhou: {card.ultimoEnvio.erro}</Badge>}
          </div>
        </div>

        <Button size="sm" onClick={onEnviar} loading={enviando} disabled={!temContatoEfetivo || card.pericias.length === 0}>
          <Send className="h-3.5 w-3.5" /> Enviar
        </Button>
      </div>
    </div>
  );
}
