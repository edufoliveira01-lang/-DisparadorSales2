import { useCallback, useEffect, useState } from "react";
import { Plus, Wallet } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { useToast } from "@/components/ui/Toast";
import { BaixaModal, CAT, ContratoModal, LancamentoModal, ST_ROT, ST_TOM, type Contrato, type Lanc } from "./Financeiro";
import { dataBr, dinheiro } from "./comum";
import type { Responsavel } from "./Processos";

interface Dados { pessoa: { id: number; nome: string }; totais: { contratado_centavos: number; recebido_centavos: number; em_aberto_centavos: number; atrasado_centavos: number; proximo_vencimento: string | null }; contratos: Contrato[]; lancamentos: Lanc[] }

/** A parte financeira dentro do cadastro de cada pessoa: contratos, parcelas, o que já pagou e o que falta. */
export function FinanceiroPessoa({ pessoaId, nome }: { pessoaId: number; nome: string }) {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("financeiro.manage");
  const [d, setD] = useState<Dados | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [contrato, setContrato] = useState(false);
  const [lanc, setLanc] = useState<Lanc | "novo" | null>(null);
  const [baixa, setBaixa] = useState<Lanc | null>(null);
  const carregar = useCallback(async () => { try { setD(await api.get<Dados>(`/gestao/financeiro/pessoas/${pessoaId}`)); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível carregar o financeiro.", "error"); } }, [pessoaId, show]);
  useEffect(() => { void carregar(); api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, [carregar]);
  const estornar = async (l: Lanc) => { try { await api.post(`/gestao/financeiro/lancamentos/${l.id}/estornar`, {}); show("Baixa estornada.", "success"); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível estornar.", "error"); } };
  const pessoaFixa = { id: pessoaId, nome };
  if (!d) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const t = d.totais;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Contratado" value={dinheiro(t.contratado_centavos)} tone="info" />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Já recebido" value={dinheiro(t.recebido_centavos)} tone="accent" />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Em aberto" value={dinheiro(t.em_aberto_centavos)} tone="neutral" helper={t.proximo_vencimento ? `Próximo vencimento: ${dataBr(t.proximo_vencimento)}` : undefined} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Em atraso" value={dinheiro(t.atrasado_centavos)} tone={t.atrasado_centavos > 0 ? "danger" : "neutral"} />
      </div>
      {gerir && <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setLanc("novo")}><Plus className="h-4 w-4" /> Novo lançamento</Button><Button onClick={() => setContrato(true)}><Plus className="h-4 w-4" /> Novo contrato de honorários</Button></div>}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Contratos ({d.contratos.length})</h3>
        {d.contratos.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700">Nenhum contrato de honorários para esta pessoa.</p> : (
          <ul className="space-y-2">{d.contratos.map((c) => { const tot = c.recebido_centavos + c.em_aberto_centavos; const pct = tot ? Math.round((c.recebido_centavos / tot) * 100) : 0; return (
            <li key={c.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.descricao}</p><span className="flex gap-2">{c.parcelas_atrasadas > 0 && <Badge tone="danger">{c.parcelas_atrasadas} atrasada(s)</Badge>}<Badge tone={c.status === "quitado" ? "success" : c.status === "ativo" ? "info" : "neutral"}>{c.status}</Badge></span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1 text-xs text-zinc-500">Recebido {dinheiro(c.recebido_centavos)} de {dinheiro(c.valor_total_centavos)}{c.processo_pasta ? ` · Pasta ${c.processo_pasta}` : ""}</p>
            </li>); })}</ul>)}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Parcelas e lançamentos ({d.lancamentos.length})</h3>
        {d.lancamentos.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700">Nenhum lançamento.</p> : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {d.lancamentos.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{l.descricao}</p><p className="text-xs text-zinc-500">{CAT[l.categoria]} · {l.pago_em ? `Pago em ${dataBr(l.pago_em)}` : `Vence ${dataBr(l.vencimento)}`}</p></div>
                <div className="flex items-center gap-2"><span className={`text-sm font-semibold ${l.tipo === "receber" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{l.tipo === "pagar" ? "− " : ""}{dinheiro(l.valor_centavos)}</span><Badge tone={ST_TOM[l.status]}>{ST_ROT[l.status]}</Badge>
                  {gerir && (l.status === "aberto" || l.status === "atrasado") && <Button size="sm" onClick={() => setBaixa(l)}>{l.tipo === "receber" ? "Receber" : "Pagar"}</Button>}
                  {gerir && l.status === "pago" && <Button size="sm" variant="ghost" onClick={() => void estornar(l)}>Estornar</Button>}</div>
              </li>))}
          </ul>)}
      </section>
      {contrato && <ContratoModal pessoaFixa={pessoaFixa} aoFechar={() => setContrato(false)} aoSalvar={() => { setContrato(false); void carregar(); }} />}
      {lanc && <LancamentoModal lanc={lanc === "novo" ? null : lanc} pessoaFixa={pessoaFixa} responsaveis={resp} aoFechar={() => setLanc(null)} aoSalvar={() => { setLanc(null); void carregar(); }} />}
      {baixa && <BaixaModal lanc={baixa} aoFechar={() => setBaixa(null)} aoSalvar={() => { setBaixa(null); void carregar(); }} />}
    </div>
  );
}
