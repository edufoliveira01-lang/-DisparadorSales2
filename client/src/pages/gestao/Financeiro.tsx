import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Wallet } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { Campo, SeletorPessoa, SeletorProcesso, dataBr, dinheiro, mesAtual, mesRotulo, useAtraso, type Lista } from "./comum";
import type { Responsavel } from "./Processos";

export interface Lanc { id: number; tipo: "receber" | "pagar"; categoria: string; descricao: string; valor_centavos: number; vencimento: string; pago_em: string | null; valor_pago_centavos: number | null; forma_pagamento: string; status: "aberto" | "atrasado" | "pago" | "cancelado"; pessoa_id: number | null; pessoa_nome: string | null; processo_id: number | null; processo_pasta: string | null; beneficiario: string | null; beneficiario_user_id: number | null; reembolsavel: boolean; observacoes: string; contrato_id: number | null }
export interface Contrato { id: number; descricao: string; tipo: string; status: string; pessoa_nome: string | null; processo_pasta: string | null; valor_total_centavos: number; percentual_exito: number | null; recebido_centavos: number; em_aberto_centavos: number; parcelas_atrasadas: number }
interface Resumo { mes: string; receber_previsto_centavos: number; recebido_centavos: number; pagar_previsto_centavos: number; pago_centavos: number; saldo_realizado_centavos: number; inadimplencia_centavos: number; inadimplentes: number; a_receber_30_dias_centavos: number; a_pagar_30_dias_centavos: number; custas_reembolsaveis_centavos: number; por_categoria: { tipo: string; categoria: string; realizado_centavos: number; previsto_centavos: number }[]; comissoes_e_repasses: { beneficiario: string; categoria: string; previsto_centavos: number; pago_centavos: number }[] }
interface Mes { mes: string; receber_previsto_centavos: number; recebido_centavos: number; pagar_previsto_centavos: number; pago_centavos: number; saldo_centavos: number }
export const CAT: Record<string, string> = { honorarios: "Honorários", custas: "Custas", despesa: "Despesa", comissao: "Comissão", repasse: "Repasse", outro: "Outro" };
export const ST_TOM: Record<string, "success" | "danger" | "neutral" | "info"> = { pago: "success", atrasado: "danger", cancelado: "neutral", aberto: "info" };
export const ST_ROT: Record<string, string> = { pago: "Pago", atrasado: "Atrasado", cancelado: "Cancelado", aberto: "Em aberto" };
const ABAS = [["resumo", "Resumo e fluxo de caixa"], ["lancamentos", "Contas a pagar e receber"], ["contratos", "Contratos de honorários"]] as const;
type Aba = typeof ABAS[number][0];

export function Financeiro() {
  const { can } = useAuth();
  const gerir = can("financeiro.manage");
  const [aba, setAba] = useState<Aba>("resumo");
  const [filtroContrato, setFiltroContrato] = useState<number | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Financeiro" description="Controle interno de honorários, contas a pagar e receber, custas, comissões e repasses." />
      <div role="tablist" className="page-tabs">
        {ABAS.map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${aba === k ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5"}`}>{r}</button>)}
      </div>
      {aba === "resumo" && <ResumoFin />}
      {aba === "lancamentos" && <Lancamentos gerir={gerir} contrato={filtroContrato} aoLimparContrato={() => setFiltroContrato(null)} />}
      {aba === "contratos" && <Contratos gerir={gerir} aoVerParcelas={(id) => { setFiltroContrato(id); setAba("lancamentos"); }} />}
    </div>
  );
}

function ResumoFin() {
  const { show } = useToast();
  const [mes, setMes] = useState(mesAtual());
  const [r, setR] = useState<Resumo | null>(null);
  const [fluxo, setFluxo] = useState<Mes[]>([]);
  useEffect(() => { api.get<Resumo>(`/gestao/financeiro/resumo?mes=${mes}`).then(setR).catch(() => show("Não foi possível carregar o resumo.", "error")); }, [mes, show]);
  useEffect(() => { api.get<Mes[]>("/gestao/financeiro/fluxo?meses=6").then(setFluxo).catch(() => undefined); }, []);
  const max = Math.max(1, ...fluxo.flatMap((m) => [m.receber_previsto_centavos, m.recebido_centavos, m.pagar_previsto_centavos, m.pago_centavos]));
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><label className="text-sm text-zinc-600 dark:text-zinc-300">Mês <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="ml-2 inline-block h-10 w-44" /></label></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Recebido no mês" value={dinheiro(r?.recebido_centavos)} tone="accent" helper={`Previsto: ${dinheiro(r?.receber_previsto_centavos)}`} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Pago no mês" value={dinheiro(r?.pago_centavos)} tone="neutral" helper={`Previsto: ${dinheiro(r?.pagar_previsto_centavos)}`} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Saldo realizado" value={dinheiro(r?.saldo_realizado_centavos)} tone={r && r.saldo_realizado_centavos < 0 ? "danger" : "info"} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Em atraso (a receber)" value={dinheiro(r?.inadimplencia_centavos)} tone={r && r.inadimplencia_centavos > 0 ? "danger" : "neutral"} helper={r ? `${r.inadimplentes} cliente(s)` : undefined} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="A receber (30 dias)" value={dinheiro(r?.a_receber_30_dias_centavos)} tone="info" />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="A pagar (30 dias)" value={dinheiro(r?.a_pagar_30_dias_centavos)} tone="warning" helper={r && r.custas_reembolsaveis_centavos > 0 ? `Custas a reembolsar: ${dinheiro(r.custas_reembolsaveis_centavos)}` : undefined} />
      </div>
      <section className="surface-panel p-5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Fluxo de caixa (5 meses atrás até 6 à frente)</h2>
        <div className="mt-4 flex h-44 items-end gap-2 overflow-x-auto" role="img" aria-label="Gráfico de receitas e despesas por mês">
          {fluxo.map((m) => (
            <div key={m.mes} className="flex min-w-[52px] flex-1 flex-col items-center gap-1">
              <div className="flex h-36 items-end gap-0.5">
                {([[m.receber_previsto_centavos, "bg-emerald-200", "Receita prevista"], [m.recebido_centavos, "bg-emerald-500", "Recebido"], [m.pagar_previsto_centavos, "bg-rose-200", "Despesa prevista"], [m.pago_centavos, "bg-rose-500", "Pago"]] as const).map(([v, cor, rot]) => (
                  <div key={rot} title={`${rot}: ${dinheiro(v)}`} className={`w-2.5 rounded-t ${cor}`} style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0 }} />))}
              </div>
              <span className={`text-[11px] ${m.mes === mesAtual() ? "font-bold text-accent-700" : "text-zinc-400"}`}>{mesRotulo(m.mes)}</span>
            </div>))}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-200" />Receita prevista</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Recebido</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-200" />Despesa prevista</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500" />Pago</span></p>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface-panel p-5"><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Por categoria no mês</h2>
          {(r?.por_categoria.length ?? 0) === 0 ? <p className="mt-3 text-sm text-zinc-500">Sem lançamentos neste mês.</p> : <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1">Categoria</th><th className="text-right">Previsto</th><th className="text-right">Realizado</th></tr></thead><tbody>{r!.por_categoria.map((c) => <tr key={c.tipo + c.categoria} className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-1.5">{c.tipo === "receber" ? "Receita" : "Despesa"} · {CAT[c.categoria] || c.categoria}</td><td className="text-right">{dinheiro(c.previsto_centavos)}</td><td className="text-right font-medium">{dinheiro(c.realizado_centavos)}</td></tr>)}</tbody></table>}</section>
        <section className="surface-panel p-5"><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Comissões e repasses no mês</h2>
          {(r?.comissoes_e_repasses.length ?? 0) === 0 ? <p className="mt-3 text-sm text-zinc-500">Nenhuma comissão ou repasse neste mês.</p> : <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1">Beneficiário</th><th className="text-right">Previsto</th><th className="text-right">Pago</th></tr></thead><tbody>{r!.comissoes_e_repasses.map((c) => <tr key={c.beneficiario + c.categoria} className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-1.5">{c.beneficiario} · {CAT[c.categoria]}</td><td className="text-right">{dinheiro(c.previsto_centavos)}</td><td className="text-right font-medium">{dinheiro(c.pago_centavos)}</td></tr>)}</tbody></table>}</section>
      </div>
    </div>
  );
}

export const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
function Lancamentos({ gerir, contrato, aoLimparContrato }: { gerir: boolean; contrato: number | null; aoLimparContrato: () => void }) {
  const { show } = useToast();
  const [tipo, setTipo] = useState("");
  const [status, setStatus] = useState("pendentes");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<(Lista<Lanc> & { soma_centavos: number }) | null>(null);
  const [editando, setEditando] = useState<Lanc | "novo" | null>(null);
  const [baixando, setBaixando] = useState<Lanc | null>(null);
  const [apagar, setApagar] = useState<Lanc | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const carregar = useCallback(async () => {
    try { setDados(await api.get(`/gestao/financeiro/lancamentos?limite=30&pagina=${pagina + 1}&tipo=${tipo}&status=${status}&de=${de}&ate=${ate}&busca=${encodeURIComponent(termo)}${contrato ? `&contrato=${contrato}` : ""}`)); }
    catch { show("Não foi possível carregar os lançamentos.", "error"); }
  }, [pagina, tipo, status, de, ate, termo, contrato, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setPagina(0); }, [tipo, status, de, ate, termo, contrato]);
  useEffect(() => { api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, []);
  const acao = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); show(ok, "success"); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); } };
  const lista = dados?.itens ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_150px_150px_150px]">
          <div className="relative sm:col-span-2 lg:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" placeholder="Descrição, cliente ou processo…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar lançamentos" /></div>
          <Select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Receber e pagar</option><option value="receber">A receber</option><option value="pagar">A pagar</option></Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="pendentes">Pendentes</option><option value="atrasado">Atrasados</option><option value="aberto">Em dia</option><option value="pago">Pagos</option><option value="cancelado">Cancelados</option><option value="">Todos</option></Select>
          <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="Vencimento de" title="Vencimento a partir de" />
          <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Vencimento até" title="Vencimento até" />
        </div>
        {gerir && <Button onClick={() => setEditando("novo")}><Plus className="h-4 w-4" /> Novo lançamento</Button>}
      </div>
      {contrato && <p className="text-sm text-zinc-600 dark:text-zinc-300">Mostrando as parcelas de um contrato. <button className="text-accent-700 underline" onClick={aoLimparContrato}>Ver todos</button></p>}
      {dados && lista.length === 0 ? <EmptyState icon={Wallet} title="Nenhum lançamento" description="Ajuste os filtros ou crie um lançamento." action={gerir ? <Button onClick={() => setEditando("novo")}><Plus className="h-4 w-4" /> Novo lançamento</Button> : undefined} /> : (
        <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
          {lista.map((l) => (
            <li key={l.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[1.6fr_130px_120px_auto] lg:items-center lg:gap-4">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{l.descricao}</p><p className="truncate text-xs text-zinc-500">{CAT[l.categoria]}{l.pessoa_nome ? ` · ${l.pessoa_nome}` : ""}{l.processo_pasta ? ` · Pasta ${l.processo_pasta}` : ""}{l.beneficiario ? ` · ${l.beneficiario}` : ""}{l.reembolsavel ? " · reembolsável" : ""}</p></div>
              <p className={`text-sm font-semibold ${l.tipo === "receber" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{l.tipo === "pagar" ? "− " : ""}{dinheiro(l.valor_centavos)}</p>
              <p className="text-xs text-zinc-500">{l.pago_em ? `Pago em ${dataBr(l.pago_em)}` : `Vence ${dataBr(l.vencimento)}`}</p>
              <div className="flex flex-wrap items-center gap-1.5"><Badge tone={ST_TOM[l.status]}>{ST_ROT[l.status]}</Badge>
                {gerir && (l.status === "aberto" || l.status === "atrasado") && <><Button size="sm" onClick={() => setBaixando(l)}>{l.tipo === "receber" ? "Receber" : "Pagar"}</Button><Button size="sm" variant="ghost" onClick={() => setEditando(l)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => void acao(() => api.post(`/gestao/financeiro/lancamentos/${l.id}/cancelar`, {}), "Lançamento cancelado.")}>Cancelar</Button></>}
                {gerir && l.status === "pago" && <Button size="sm" variant="ghost" onClick={() => void acao(() => api.post(`/gestao/financeiro/lancamentos/${l.id}/estornar`, {}), "Baixa estornada.")}>Estornar</Button>}
                {gerir && l.status === "cancelado" && <><Button size="sm" variant="ghost" onClick={() => void acao(() => api.post(`/gestao/financeiro/lancamentos/${l.id}/cancelar`, { cancelar: false }), "Lançamento reativado.")}>Reativar</Button><Button size="sm" variant="ghost" onClick={() => setApagar(l)}>Excluir</Button></>}
              </div>
            </li>))}
        </ul>
      )}
      {dados && dados.total > 0 && <p className="text-right text-xs text-zinc-500">{dados.total} lançamento(s) · soma dos valores: <b>{dinheiro(dados.soma_centavos)}</b></p>}
      <Pagination page={pagina} totalItems={dados?.total ?? 0} pageSize={30} onPageChange={setPagina} />
      {editando && <LancamentoModal lanc={editando === "novo" ? null : editando} responsaveis={resp} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); void carregar(); }} />}
      {baixando && <BaixaModal lanc={baixando} aoFechar={() => setBaixando(null)} aoSalvar={() => { setBaixando(null); void carregar(); }} />}
      <ConfirmDialog open={Boolean(apagar)} title="Excluir lançamento" message={`Excluir "${apagar?.descricao}"? Não pode ser desfeito.`} confirmLabel="Excluir" onConfirm={() => { const l = apagar!; setApagar(null); void acao(() => api.delete(`/gestao/financeiro/lancamentos/${l.id}`), "Lançamento excluído."); }} onCancel={() => setApagar(null)} />
    </div>
  );
}

export function LancamentoModal({ lanc, responsaveis, aoFechar, aoSalvar, pessoaFixa }: { lanc: Lanc | null; responsaveis: Responsavel[]; aoFechar: () => void; aoSalvar: () => void; pessoaFixa?: { id: number; nome: string } }) {
  const { show } = useToast();
  const [f, setF] = useState({ tipo: lanc?.tipo ?? "receber", categoria: lanc?.categoria ?? "honorarios", descricao: lanc?.descricao ?? "", valor: lanc ? (lanc.valor_centavos / 100).toFixed(2).replace(".", ",") : "", vencimento: lanc?.vencimento ?? hoje(), parcelas: "1", beneficiario_user_id: lanc?.beneficiario_user_id ? String(lanc.beneficiario_user_id) : "", reembolsavel: lanc?.reembolsavel ?? false, observacoes: lanc?.observacoes ?? "" });
  const [pessoa, setPessoa] = useState<{ id: number; nome: string } | null>(lanc?.pessoa_id ? { id: lanc.pessoa_id, nome: lanc.pessoa_nome || "" } : pessoaFixa ?? null);
  const [proc, setProc] = useState<{ id: number; rotulo: string } | null>(lanc?.processo_id ? { id: lanc.processo_id, rotulo: `Pasta ${lanc.processo_pasta}` } : null);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const corpo = { ...f, beneficiario_user_id: f.beneficiario_user_id || null, pessoa_id: pessoa?.id ?? null, processo_id: proc?.id ?? null };
      if (lanc) await api.put(`/gestao/financeiro/lancamentos/${lanc.id}`, corpo); else await api.post("/gestao/financeiro/lancamentos", corpo);
      show("Lançamento salvo.", "success"); aoSalvar();
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const repasse = f.categoria === "comissao" || f.categoria === "repasse";
  return (
    <Modal open onClose={aoFechar} title={lanc ? "Editar lançamento" : "Novo lançamento"} maxWidth="max-w-xl"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-lanc" loading={salvando}>Salvar</Button></div>}>
      <form id="form-lanc" onSubmit={salvar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!lanc && <Campo rotulo="Tipo"><Select value={f.tipo} onChange={(e) => set("tipo", e.target.value as "receber" | "pagar")} className="mt-1.5"><option value="receber">A receber</option><option value="pagar">A pagar</option></Select></Campo>}
          <Campo rotulo="Categoria"><Select value={f.categoria} onChange={(e) => set("categoria", e.target.value)} className="mt-1.5">{Object.entries(CAT).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
        </div>
        <Campo rotulo="Descrição *"><Input required value={f.descricao} onChange={(e) => set("descricao", e.target.value)} className="mt-1.5" /></Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo={lanc ? "Valor (R$) *" : "Valor total (R$) *"}><Input required inputMode="decimal" value={f.valor} onChange={(e) => set("valor", e.target.value)} className="mt-1.5" placeholder="0,00" /></Campo>
          <Campo rotulo="1º vencimento *"><Input required type="date" value={f.vencimento} onChange={(e) => set("vencimento", e.target.value)} className="mt-1.5" /></Campo>
          {!lanc && <Campo rotulo="Parcelas"><Input type="number" min={1} max={120} value={f.parcelas} onChange={(e) => set("parcelas", e.target.value)} className="mt-1.5" /></Campo>}
        </div>
        {repasse && <Campo rotulo="Beneficiário (advogado/colaborador)"><Select value={f.beneficiario_user_id} onChange={(e) => set("beneficiario_user_id", e.target.value)} className="mt-1.5"><option value="">—</option>{responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></Campo>}
        {f.categoria === "custas" && <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={f.reembolsavel} onChange={(e) => set("reembolsavel", e.target.checked)} /> Custa a ser reembolsada pelo cliente</label>}
        {pessoa ? <p className="text-sm">Cliente/pessoa: <b>{pessoa.nome}</b> <button type="button" className="text-xs text-accent-700 underline" onClick={() => setPessoa(null)}>tirar</button></p> : <SeletorPessoa aoEscolher={(p) => setPessoa({ id: p.id, nome: p.nome })} rotulo="Cliente / pessoa (opcional)" />}
        {proc ? <p className="text-sm">Processo: <b>{proc.rotulo}</b> <button type="button" className="text-xs text-accent-700 underline" onClick={() => setProc(null)}>tirar</button></p> : <SeletorProcesso aoEscolher={(p) => setProc({ id: p.id, rotulo: `${p.pasta} · ${p.numero_formatado || p.numero}` })} rotulo="Processo (opcional)" />}
        <Campo rotulo="Observações"><Textarea rows={2} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
      </form>
    </Modal>
  );
}

export function BaixaModal({ lanc, aoFechar, aoSalvar }: { lanc: Lanc; aoFechar: () => void; aoSalvar: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ pago_em: hoje(), valor_pago: (lanc.valor_centavos / 100).toFixed(2).replace(".", ","), forma_pagamento: "PIX" });
  const [salvando, setSalvando] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try { await api.post(`/gestao/financeiro/lancamentos/${lanc.id}/baixar`, f); show(lanc.tipo === "receber" ? "Recebimento registrado." : "Pagamento registrado.", "success"); aoSalvar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível registrar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title={lanc.tipo === "receber" ? "Registrar recebimento" : "Registrar pagamento"} description={`${lanc.descricao} — ${dinheiro(lanc.valor_centavos)}`} maxWidth="max-w-md"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-baixa" loading={salvando}>Confirmar</Button></div>}>
      <form id="form-baixa" onSubmit={salvar} className="space-y-4">
        <Campo rotulo="Data do pagamento"><Input type="date" required max={hoje()} value={f.pago_em} onChange={(e) => setF({ ...f, pago_em: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Valor efetivamente pago (R$)"><Input required inputMode="decimal" value={f.valor_pago} onChange={(e) => setF({ ...f, valor_pago: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Forma de pagamento"><Select value={f.forma_pagamento} onChange={(e) => setF({ ...f, forma_pagamento: e.target.value })} className="mt-1.5">{["PIX", "Boleto", "Transferência", "Dinheiro", "Cartão", "Cheque", "Outro"].map((x) => <option key={x}>{x}</option>)}</Select></Campo>
      </form>
    </Modal>
  );
}

function Contratos({ gerir, aoVerParcelas }: { gerir: boolean; aoVerParcelas: (id: number) => void }) {
  const { show } = useToast();
  const [lista, setLista] = useState<Contrato[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [cancelar, setCancelar] = useState<Contrato | null>(null);
  const carregar = useCallback(async () => { try { setLista(await api.get<Contrato[]>("/gestao/financeiro/contratos")); } catch { show("Não foi possível carregar os contratos.", "error"); } }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const cancelarContrato = async () => {
    if (!cancelar) return;
    try { await api.post(`/gestao/financeiro/contratos/${cancelar.id}/cancelar`, {}); show("Contrato cancelado; parcelas em aberto foram canceladas.", "success"); setCancelar(null); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível cancelar.", "error"); setCancelar(null); }
  };
  return (
    <div className="space-y-4">
      {gerir && <div className="flex justify-end"><Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo contrato</Button></div>}
      {lista && lista.length === 0 ? <EmptyState icon={Wallet} title="Nenhum contrato" description="Cadastre o contrato de honorários: as parcelas viram contas a receber automaticamente." action={gerir ? <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo contrato</Button> : undefined} /> : (
        <ul className="space-y-3">
          {(lista ?? []).map((c) => { const tot = c.recebido_centavos + c.em_aberto_centavos; const pct = tot ? Math.round((c.recebido_centavos / tot) * 100) : 0; return (
            <li key={c.id} className="surface-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.descricao}</p><p className="text-xs text-zinc-500">{c.pessoa_nome || "—"}{c.processo_pasta ? ` · Pasta ${c.processo_pasta}` : ""} · {c.tipo}{c.percentual_exito ? ` · êxito ${(c.percentual_exito / 100).toLocaleString("pt-BR")}%` : ""}</p></div>
                <div className="flex items-center gap-2">{c.parcelas_atrasadas > 0 && <Badge tone="danger">{c.parcelas_atrasadas} atrasada(s)</Badge>}<Badge tone={c.status === "ativo" ? "info" : c.status === "quitado" ? "success" : "neutral"}>{c.status}</Badge></div></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>Recebido {dinheiro(c.recebido_centavos)} · Em aberto {dinheiro(c.em_aberto_centavos)} · Total {dinheiro(c.valor_total_centavos)}</span>
                <span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => aoVerParcelas(c.id)}>Ver parcelas</Button>{gerir && c.status !== "cancelado" && <Button size="sm" variant="ghost" onClick={() => setCancelar(c)}>Cancelar contrato</Button>}</span></div>
            </li>); })}
        </ul>
      )}
      {novo && <ContratoModal aoFechar={() => setNovo(false)} aoSalvar={() => { setNovo(false); void carregar(); }} />}
      <ConfirmDialog open={Boolean(cancelar)} title="Cancelar contrato" message="As parcelas ainda não pagas serão canceladas. Os valores já recebidos continuam registrados." confirmLabel="Cancelar contrato" onConfirm={() => void cancelarContrato()} onCancel={() => setCancelar(null)} />
    </div>
  );
}

export function ContratoModal({ aoFechar, aoSalvar, pessoaFixa }: { aoFechar: () => void; aoSalvar: () => void; pessoaFixa?: { id: number; nome: string } }) {
  const { show } = useToast();
  const [f, setF] = useState({ descricao: "", tipo: "parcelado", valor_total: "", parcelas: "1", primeiro_vencimento: hoje(), percentual_exito: "", observacoes: "" });
  const [pessoa, setPessoa] = useState<{ id: number; nome: string } | null>(pessoaFixa ?? null);
  const [proc, setProc] = useState<{ id: number; rotulo: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!pessoa) { show("Escolha o cliente do contrato.", "error"); return; }
    setSalvando(true);
    try { await api.post("/gestao/financeiro/contratos", { ...f, pessoa_id: pessoa.id, processo_id: proc?.id ?? null }); show("Contrato criado e parcelas lançadas.", "success"); aoSalvar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível criar.", "error"); }
    finally { setSalvando(false); }
  };
  const exito = f.tipo === "exito" || f.tipo === "misto";
  return (
    <Modal open onClose={aoFechar} title="Novo contrato de honorários" description="As parcelas são lançadas como contas a receber." maxWidth="max-w-xl"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-contrato" loading={salvando}>Criar contrato</Button></div>}>
      <form id="form-contrato" onSubmit={salvar} className="space-y-4">
        {pessoa ? <p className="text-sm">Cliente: <b>{pessoa.nome}</b> <button type="button" className="text-xs text-accent-700 underline" onClick={() => setPessoa(null)}>trocar</button></p> : <SeletorPessoa aoEscolher={(p) => setPessoa({ id: p.id, nome: p.nome })} rotulo="Cliente *" />}
        {proc ? <p className="text-sm">Processo: <b>{proc.rotulo}</b> <button type="button" className="text-xs text-accent-700 underline" onClick={() => setProc(null)}>tirar</button></p> : <SeletorProcesso aoEscolher={(p) => setProc({ id: p.id, rotulo: `${p.pasta} · ${p.numero_formatado || p.numero}` })} rotulo="Processo (opcional)" />}
        <Campo rotulo="Descrição *"><Input required value={f.descricao} onChange={(e) => set("descricao", e.target.value)} className="mt-1.5" placeholder="Ex.: Ação de aposentadoria — Maria Silva" /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Modalidade"><Select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className="mt-1.5"><option value="parcelado">Parcelado</option><option value="fixo">Valor fixo (1 vez)</option><option value="exito">Somente êxito</option><option value="misto">Fixo + êxito</option></Select></Campo>
          {exito && <Campo rotulo="Êxito (% do resultado)"><Input inputMode="decimal" value={f.percentual_exito} onChange={(e) => set("percentual_exito", e.target.value)} className="mt-1.5" placeholder="30" /></Campo>}
          <Campo rotulo={f.tipo === "exito" ? "Valor fixo (opcional)" : "Valor total (R$) *"}><Input inputMode="decimal" required={f.tipo !== "exito"} value={f.valor_total} onChange={(e) => set("valor_total", e.target.value)} className="mt-1.5" placeholder="0,00" /></Campo>
          {f.tipo !== "exito" && <Campo rotulo="1º vencimento *"><Input type="date" required value={f.primeiro_vencimento} onChange={(e) => set("primeiro_vencimento", e.target.value)} className="mt-1.5" /></Campo>}
          {(f.tipo === "parcelado" || f.tipo === "misto") && <Campo rotulo="Parcelas"><Input type="number" min={1} max={120} value={f.parcelas} onChange={(e) => set("parcelas", e.target.value)} className="mt-1.5" /></Campo>}
        </div>
        <Campo rotulo="Observações"><Textarea rows={2} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
      </form>
    </Modal>
  );
}
