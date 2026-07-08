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
  const checkNaoIdentificado = (val?: string) => {
    if (!val) return false;
    const upper = val.toUpperCase();
    return upper.includes("NAO_IDENTIFICADO") || upper.includes("NAO_IDENTIFICADA");
  };

  const temDadosNaoIdentificados = checkNaoIdentificado(card.nomeCliente) || card.pericias.some(
    (p) =>
      checkNaoIdentificado(p.data) ||
      checkNaoIdentificado(p.horario) ||
      checkNaoIdentificado(p.local) ||
      checkNaoIdentificado(p.tipo) ||
      checkNaoIdentificado(p.nome)
  );

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-card transition-shadow hover:shadow-md dark:bg-zinc-900 ${
      temDadosNaoIdentificados 
        ? "border-amber-500 border-2 bg-amber-50/50 dark:border-amber-600 dark:bg-amber-900/20" 
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
            {card.pericias.map((p, i) => {
              const dErr = checkNaoIdentificado(p.data);
              const hErr = checkNaoIdentificado(p.horario);
              const lErr = checkNaoIdentificado(p.local);
              const tErr = checkNaoIdentificado(p.tipo);
              const nErr = checkNaoIdentificado(p.nome);

              return (
                <div key={i} className={`rounded-xl p-3 text-sm ${
                  dErr || hErr || lErr || tErr || nErr
                    ? "bg-amber-100 dark:bg-amber-900/40 border border-amber-200 dark:border-amber-800"
                    : "bg-zinc-50 dark:bg-zinc-800/50"
                }`}>
                  <p className="font-medium text-zinc-700 dark:text-zinc-200">
                    {p.tipo || "(tipo não identificado)"}
                    {tErr && <span className="ml-2 text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold">VERIFICAR TIPO</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className={`flex items-center gap-1 ${dErr ? "text-amber-700 dark:text-amber-400 font-bold" : ""}`}>
                      <Calendar className="h-3.5 w-3.5" /> {p.data || "—"}
                      {dErr && <AlertTriangle className="h-3 w-3" />}
                    </span>
                    <span className={`flex items-center gap-1 ${hErr ? "text-amber-700 dark:text-amber-400 font-bold" : ""}`}>
                      <Clock className="h-3.5 w-3.5" /> {p.horario || "—"}
                      {hErr && <AlertTriangle className="h-3 w-3" />}
                    </span>
                    <span className={`flex items-center gap-1 ${lErr ? "text-amber-700 dark:text-amber-400 font-bold" : ""}`}>
                      <MapPin className="h-3.5 w-3.5" /> {p.local || "—"}
                      {lErr && <AlertTriangle className="h-3 w-3" />}
                    </span>
                  </div>
                  {nErr && (
                    <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> NOME NÃO IDENTIFICADO NO BLOCO
                    </p>
                  )}
                </div>
              );
            })}
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
