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
    <div className={`w-full max-w-full overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-zinc-900 ${
      temDadosNaoIdentificados 
        ? "border-amber-500 border-2 bg-amber-50/30 dark:border-amber-600 dark:bg-amber-900/10" 
        : "border-zinc-200 dark:border-zinc-800"
    }`}>
      {/* Header do Card */}
      <div className="flex items-center gap-3 border-b border-zinc-100 p-3 dark:border-zinc-800">
        <Checkbox checked={selecionado} onChange={onToggleSelecionar} className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{card.nomeCliente}</h3>
          <p className="truncate text-[9px] text-zinc-400">{card.cardNome}</p>
        </div>
        <Badge tone="accent" className="h-5 px-1.5 text-[9px] shrink-0">{card.pericias.length}x</Badge>
      </div>

      {/* Conteúdo do Card */}
      <div className="p-3 space-y-3">
        {card.pericias.map((p, i) => {
          const dErr = checkNaoIdentificado(p.data);
          const hErr = checkNaoIdentificado(p.horario);
          const lErr = checkNaoIdentificado(p.local);
          const tErr = checkNaoIdentificado(p.tipo);
          const nErr = checkNaoIdentificado(p.nome);

          return (
            <div key={i} className={`rounded-lg p-2.5 text-xs ${
              dErr || hErr || lErr || tErr || nErr
                ? "bg-amber-100/40 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                : "bg-zinc-50 dark:bg-zinc-800/50"
            }`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase text-zinc-500 dark:text-zinc-400">
                  {p.tipo || "Perícia"}
                </span>
                {tErr && <span className="text-[8px] bg-amber-500 text-white px-1 rounded font-bold">VERIFICAR</span>}
              </div>
              
              <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1.5">
                <div className={`flex items-center gap-1 ${dErr ? "text-amber-700 dark:text-amber-400 font-bold" : "text-zinc-600 dark:text-zinc-300"}`}>
                  <Calendar className="h-3 w-3" /> <span>{formatDisplayValue(p.data)}</span>
                </div>
                <div className={`flex items-center gap-1 ${hErr ? "text-amber-700 dark:text-amber-400 font-bold" : "text-zinc-600 dark:text-zinc-300"}`}>
                  <Clock className="h-3 w-3" /> <span>{formatDisplayValue(p.horario)}</span>
                </div>
              </div>

              <div className={`flex items-start gap-1 ${lErr ? "text-amber-700 dark:text-amber-400 font-bold" : "text-zinc-500 dark:text-zinc-400"}`}>
                <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                <span className="text-[10px] leading-tight break-words">{formatDisplayValue(p.local)}</span>
              </div>
            </div>
          );
        })}

        {/* Rodapé do Card */}
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {temContatoEfetivo ? (
              <Badge tone="success" className="h-5 text-[9px] px-1.5">OK</Badge>
            ) : card.sugestaoContato ? (
              <button onClick={onUsarSugestao} className="text-[9px] font-bold text-amber-600 underline">Usar Sugestão</button>
            ) : (
              <button onClick={onCadastrarContato} className="text-[9px] font-bold text-red-600 underline">+ Cadastrar</button>
            )}

            {card.ultimoEnvio?.status === "sucesso" && (
              <Badge tone="success" className="h-5 text-[9px] px-1.5">Enviado</Badge>
            )}
          </div>

          <Button 
            size="sm" 
            onClick={onEnviar} 
            loading={enviando} 
            disabled={!temContatoEfetivo || card.pericias.length === 0} 
            className="w-full h-10 text-xs font-bold bg-blue-600 text-white"
          >
            <Send className="h-3.5 w-3.5" /> ENVIAR AGORA
          </Button>
        </div>
      </div>
    </div>
  );
}
