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
    // Remove barras invertidas que podem vir do escape de markdown/texto
    const clean = val.replace(/\\/g, "").toUpperCase();
    return clean.includes("NAO_IDENTIFICADO") || clean.includes("NAO_IDENTIFICADA");
  };

  const formatDisplayValue = (val?: string) => {
    if (!val) return "—";
    if (checkNaoIdentificado(val)) {
      // Remove barras e troca sublinhados por espaços para ficar legível
      return val.replace(/\\/g, "").replace(/_/g, " ").toUpperCase();
    }
    return val;
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
    <div className={`w-full overflow-hidden rounded-2xl border bg-white shadow-sm transition-shadow hover:shadow-md dark:bg-zinc-900 ${
      temDadosNaoIdentificados 
        ? "border-amber-500 border-2 bg-amber-50/30 dark:border-amber-600 dark:bg-amber-900/10" 
        : "border-zinc-200 dark:border-zinc-800"
    }`}>
      {/* Header do Card - Sempre visível */}
      <div className="flex items-center justify-between border-b border-zinc-100 p-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-center gap-3">
          <Checkbox checked={selecionado} onChange={onToggleSelecionar} className="h-5 w-5" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-zinc-900 dark:text-zinc-100">{card.nomeCliente}</h3>
            <p className="truncate text-[10px] text-zinc-400">{card.cardNome}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
           <Badge tone="accent" className="px-2 py-0.5 text-[10px]">{card.pericias.length}x</Badge>
        </div>
      </div>

      {/* Conteúdo do Card */}
      <div className="p-4 space-y-4">
        {/* Perícias */}
        <div className="space-y-2">
          {card.pericias.map((p, i) => {
            const dErr = checkNaoIdentificado(p.data);
            const hErr = checkNaoIdentificado(p.horario);
            const lErr = checkNaoIdentificado(p.local);
            const tErr = checkNaoIdentificado(p.tipo);
            const nErr = checkNaoIdentificado(p.nome);

            return (
              <div key={i} className={`rounded-xl p-3 text-sm ${
                dErr || hErr || lErr || tErr || nErr
                  ? "bg-amber-100/50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800"
                  : "bg-zinc-50 dark:bg-zinc-800/50"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    {p.tipo || "Perícia"}
                  </span>
                  {tErr && <Badge tone="warning" className="text-[9px] h-4">VERIFICAR</Badge>}
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className={`flex items-center gap-1.5 ${dErr ? "text-amber-700 dark:text-amber-400 font-bold" : "text-zinc-600 dark:text-zinc-300"}`}>
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs">{formatDisplayValue(p.data)}</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${hErr ? "text-amber-700 dark:text-amber-400 font-bold" : "text-zinc-600 dark:text-zinc-300"}`}>
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs">{formatDisplayValue(p.horario)}</span>
                  </div>
                </div>

                <div className={`flex items-start gap-1.5 ${lErr ? "text-amber-700 dark:text-amber-400 font-bold" : "text-zinc-500 dark:text-zinc-400"}`}>
                  <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="text-[11px] leading-tight break-words">{formatDisplayValue(p.local)}</span>
                </div>

                {nErr && (
                  <div className="mt-2 flex items-center gap-1 text-[9px] font-bold text-amber-600 uppercase">
                    <AlertTriangle className="h-3 w-3" /> Nome não identificado
                  </div>
                )}
              </div>
            );
          })}
          {card.pericias.length === 0 && (
            <div className="rounded-xl bg-zinc-50 p-3 text-center text-xs text-zinc-400 dark:bg-zinc-800/50">
              Nenhuma perícia encontrada na descrição.
            </div>
          )}
        </div>

        {/* Status e Contato */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap gap-2">
            {temContatoEfetivo ? (
              <Badge tone="success" className="h-6 text-[10px]">
                <CheckCircle2 className="h-3 w-3" /> Contato OK
              </Badge>
            ) : card.sugestaoContato ? (
              <button onClick={onUsarSugestao} className="group">
                <Badge tone="warning" className="h-6 text-[10px] group-hover:bg-amber-100 transition-colors">
                  Sugestão: {card.sugestaoContato.nome}
                </Badge>
              </button>
            ) : (
              <button onClick={onCadastrarContato} className="group">
                <Badge tone="danger" className="h-6 text-[10px] group-hover:bg-red-100 transition-colors">
                  <UserPlus className="h-3 w-3" /> Cadastrar Contato
                </Badge>
              </button>
            )}

            {card.ultimoEnvio?.status === "sucesso" && (
              <Badge tone="success" className="h-6 text-[10px]">
                <MessageCircle className="h-3 w-3" /> {new Date(card.ultimoEnvio.data).toLocaleDateString("pt-BR")}
              </Badge>
            )}
          </div>

          <Button 
            size="sm" 
            onClick={onEnviar} 
            loading={enviando} 
            disabled={!temContatoEfetivo || card.pericias.length === 0} 
            className="h-9 px-5 text-xs font-bold sm:w-auto w-full"
          >
            <Send className="h-3.5 w-3.5" /> Enviar Mensagem
          </Button>
        </div>
      </div>
    </div>
  );
}
