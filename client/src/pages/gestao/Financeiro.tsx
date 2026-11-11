import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Copy, Download, ExternalLink, FileText, MessageCircle, Plus, QrCode, Search, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
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
import { cobrarPeloAtendimento, mensagemDeCobranca, type LinkDePagamento } from "./cobranca";
import { useAtendimentoLiberado } from "./AvatarPessoa";
import { AvisoLoteModal, ReguaAutomatica, type ItemAviso } from "./Cobranca";

export interface Lanc { cobranca_status?: string | null; origem_lancamento_id?: number | null; pessoa_telefone?: string | null; id: number; tipo: "receber" | "pagar"; categoria: string; descricao: string; valor_centavos: number; vencimento: string; pago_em: string | null; valor_pago_centavos: number | null; forma_pagamento: string; status: "aberto" | "atrasado" | "pago" | "cancelado"; pessoa_id: number | null; pessoa_nome: string | null; processo_id: number | null; processo_pasta: string | null; beneficiario: string | null; beneficiario_user_id: number | null; reembolsavel: boolean; observacoes: string; contrato_id: number | null }
export interface Contrato { id: number; descricao: string; tipo: string; status: string; pessoa_nome: string | null; processo_pasta: string | null; valor_total_centavos: number; percentual_exito: number | null; recebido_centavos: number; em_aberto_centavos: number; parcelas_atrasadas: number }
interface Devedor { pessoa_id: number; nome: string; telefone: string; total_centavos: number; parcelas: number; mais_antigo: string }
interface Resumo { maiores_devedores?: Devedor[]; mes: string; receber_previsto_centavos: number; recebido_centavos: number; pagar_previsto_centavos: number; pago_centavos: number; saldo_realizado_centavos: number; inadimplencia_centavos: number; inadimplentes: number; a_receber_30_dias_centavos: number; a_pagar_30_dias_centavos: number; custas_reembolsaveis_centavos: number; por_categoria: { tipo: string; categoria: string; realizado_centavos: number; previsto_centavos: number }[]; comissoes_e_repasses: { beneficiario: string; categoria: string; previsto_centavos: number; pago_centavos: number }[] }
interface Mes { mes: string; receber_previsto_centavos: number; recebido_centavos: number; pagar_previsto_centavos: number; pago_centavos: number; saldo_centavos: number }
export const CAT: Record<string, string> = { honorarios: "Honorários", custas: "Custas", despesa: "Despesa", comissao: "Comissão", repasse: "Repasse", outro: "Outro" };
export const ST_TOM: Record<string, "success" | "danger" | "neutral" | "info"> = { pago: "success", atrasado: "danger", cancelado: "neutral", aberto: "info" };
export const ST_ROT: Record<string, string> = { pago: "Pago", atrasado: "Atrasado", cancelado: "Cancelado", aberto: "Em aberto" };
const ABAS = [["resumo", "Resumo e fluxo de caixa"], ["lancamentos", "Contas a pagar e receber"], ["contratos", "Contratos de honorários"], ["regua", "Cobrança automática"], ["taxas", "Taxas do Asaas"]] as const;
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
      {aba === "regua" && <ReguaAutomatica />}
      {aba === "taxas" && <TaxasAsaas />}
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
      <Devedores lista={r?.maiores_devedores ?? []} />
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

/** Quem está devendo (parcelas a receber vencidas): a lista de quem cobrar primeiro, com o texto da cobrança pronto. */
function Devedores({ lista }: { lista: Devedor[] }) {
  const { show } = useToast();
  const { can } = useAuth();
  const [avisando, setAvisando] = useState<ItemAviso[] | null>(null);
  if (lista.length === 0) return null;
  const hojeIso = hoje();
  const dias = (v: string) => Math.max(0, Math.round((Date.parse(`${hojeIso}T12:00:00Z`) - Date.parse(`${v}T12:00:00Z`)) / 86_400_000));
  const cobrar = async (d: Devedor) => {
    try {
      const r = await api.get<{ itens: Lanc[] }>(`/gestao/financeiro/lancamentos?pessoa=${d.pessoa_id}&tipo=receber&status=atrasado&limite=20`);
      setAvisando(r.itens.map((l) => ({ id: l.id, rotulo: `${d.nome} · ${l.descricao} · ${dinheiro(l.valor_centavos)}` })));
    } catch { show("Não foi possível preparar a cobrança.", "error"); }
  };
  return (
    <section className="surface-panel p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><AlertTriangle className="h-4 w-4 text-red-500" /> Quem está em atraso</h2>
      <ul className="mt-3 divide-y divide-zinc-100 dark:divide-white/10">
        {lista.map((d) => (
          <li key={d.pessoa_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 text-sm">
            <Link to={`/gestao/clientes/${d.pessoa_id}?aba=financeiro`} className="min-w-0 flex-1 truncate font-medium text-accent-700 hover:underline dark:text-accent-300">{d.nome}</Link>
            <span className="text-xs text-zinc-500">{d.parcelas} parcela(s) · a mais antiga há {dias(d.mais_antigo)} dia(s)</span>
            <b className="text-red-600 dark:text-red-400">{dinheiro(d.total_centavos)}</b>
            {can("financeiro.manage") && d.telefone && <Button size="sm" variant="outline" onClick={() => void cobrar(d)}><MessageCircle className="h-4 w-4" /> Cobrar</Button>}
          </li>))}
      </ul>
      {avisando && <AvisoLoteModal itens={avisando} aoFechar={() => setAvisando(null)} aoConcluir={() => undefined} />}
    </section>
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
  const [reprog, setReprog] = useState<Lanc | null>(null);
  const [cobrando, setCobrando] = useState<Lanc | null>(null);
  const [sel, setSel] = useState<Map<number, string>>(new Map());
  const [avisando, setAvisando] = useState<ItemAviso[] | null>(null);
  const [apagar, setApagar] = useState<Lanc | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const carregar = useCallback(async () => {
    try { setDados(await api.get(`/gestao/financeiro/lancamentos?limite=30&pagina=${pagina + 1}&tipo=${tipo}&status=${status}&de=${de}&ate=${ate}&busca=${encodeURIComponent(termo)}${contrato ? `&contrato=${contrato}` : ""}`)); }
    catch { show("Não foi possível carregar os lançamentos.", "error"); }
  }, [pagina, tipo, status, de, ate, termo, contrato, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setPagina(0); setSel(new Map()); }, [tipo, status, de, ate, termo, contrato]);
  useEffect(() => { api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, []);
  const acao = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); show(ok, "success"); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); } };
  const rotulo = (l: Lanc) => `${l.pessoa_nome ?? "Sem cliente"} · ${l.descricao} · ${dinheiro(l.valor_centavos)}`;
  const avisavel = (l: Lanc) => l.tipo === "receber" && (l.status === "aberto" || l.status === "atrasado") && Boolean(l.pessoa_id) && Boolean(l.pessoa_telefone);
  const alternar = (l: Lanc) => setSel((m) => { const n = new Map(m); if (n.has(l.id)) n.delete(l.id); else n.set(l.id, rotulo(l)); return n; });
  const exportar = async () => {
    try {
      const linhas: Lanc[] = [];
      for (let p = 1; p <= 20; p++) {
        const r = await api.get<Lista<Lanc>>(`/gestao/financeiro/lancamentos?limite=100&pagina=${p}&tipo=${tipo}&status=${status}&de=${de}&ate=${ate}&busca=${encodeURIComponent(termo)}${contrato ? `&contrato=${contrato}` : ""}`);
        linhas.push(...r.itens); if (r.itens.length < 100) break;
      }
      const cab = ["Vencimento", "Tipo", "Categoria", "Descrição", "Cliente", "Processo", "Valor", "Situação", "Pago em"];
      const csv = [cab, ...linhas.map((l) => [l.vencimento, l.tipo === "receber" ? "A receber" : "A pagar", CAT[l.categoria] ?? l.categoria, l.descricao, l.pessoa_nome ?? "", l.processo_pasta ?? "", (l.valor_centavos / 100).toFixed(2).replace(".", ","), ST_ROT[l.status] ?? l.status, l.pago_em ?? ""])]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
      a.download = `lancamentos-${hoje()}.csv`; a.click();
      show(`${linhas.length} lançamento(s) exportado(s).`, "success");
    } catch { show("Não foi possível exportar.", "error"); }
  };
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
        <div className="flex gap-2"><Button variant="outline" onClick={() => void exportar()}><Download className="h-4 w-4" /> Exportar</Button>{gerir && <Button onClick={() => setEditando("novo")}><Plus className="h-4 w-4" /> Novo lançamento</Button>}</div>
      </div>
      {contrato && <p className="text-sm text-zinc-600 dark:text-zinc-300">Mostrando as parcelas de um contrato. <button className="text-accent-700 underline" onClick={aoLimparContrato}>Ver todos</button></p>}
      {gerir && sel.size > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent-200 bg-accent-50 px-4 py-2 text-sm dark:border-accent-500/30 dark:bg-accent-500/10"><span><b>{sel.size}</b> parcela(s) selecionada(s)</span><span className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSel(new Map())}>Limpar</Button><Button size="sm" onClick={() => setAvisando([...sel].map(([id, rotulo]) => ({ id, rotulo })))}><MessageCircle className="h-4 w-4" /> Enviar aviso pelo WhatsApp</Button></span></div>}
      {gerir && lista.some(avisavel) && <p className="text-right text-xs"><button className="text-accent-700 underline dark:text-accent-300" onClick={() => setSel((m) => { const n = new Map(m); lista.filter(avisavel).forEach((l) => n.set(l.id, rotulo(l))); return n; })}>Selecionar todas desta página</button></p>}
      {dados && lista.length === 0 ? <EmptyState icon={Wallet} title="Nenhum lançamento" description="Ajuste os filtros ou crie um lançamento." action={gerir ? <Button onClick={() => setEditando("novo")}><Plus className="h-4 w-4" /> Novo lançamento</Button> : undefined} /> : (
        <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
          {lista.map((l) => (
            <li key={l.id} className="grid gap-2 px-4 py-3 lg:grid-cols-[auto_1.6fr_130px_120px_auto] lg:items-center lg:gap-4">
              <span className="hidden lg:block">{gerir && avisavel(l) ? <input type="checkbox" aria-label={`Selecionar ${l.descricao}`} checked={sel.has(l.id)} onChange={() => alternar(l)} /> : <span className="inline-block w-[13px]" />}</span>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{l.descricao}</p><p className="truncate text-xs text-zinc-500">{CAT[l.categoria]}{l.origem_lancamento_id ? " · saldo de pagamento parcial" : ""}{l.pessoa_nome ? ` · ${l.pessoa_nome}` : ""}{l.processo_pasta ? ` · Pasta ${l.processo_pasta}` : ""}{l.beneficiario ? ` · ${l.beneficiario}` : ""}{l.reembolsavel ? " · reembolsável" : ""}</p></div>
              <p className={`text-sm font-semibold ${l.tipo === "receber" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{l.tipo === "pagar" ? "− " : ""}{dinheiro(l.valor_centavos)}</p>
              <p className="text-xs text-zinc-500">{l.pago_em ? `Pago em ${dataBr(l.pago_em)}` : `Vence ${dataBr(l.vencimento)}`}</p>
              <div className="flex flex-wrap items-center gap-1.5"><Badge tone={ST_TOM[l.status]}>{ST_ROT[l.status]}</Badge>
                {gerir && l.tipo === "receber" && (l.status === "aberto" || l.status === "atrasado") && l.pessoa_id && <Button size="sm" variant="outline" onClick={() => setCobrando(l)}><QrCode className="h-4 w-4" /> Boleto/PIX</Button>}
                {gerir && avisavel(l) && <Button size="sm" variant="outline" onClick={() => setAvisando([{ id: l.id, rotulo: rotulo(l) }])}><MessageCircle className="h-4 w-4" /> {l.status === "atrasado" ? "Cobrar" : "Avisar"}</Button>}
                {l.cobranca_status && l.status !== "pago" && <Badge tone="info">{l.cobranca_status === "PENDING" ? "Boleto/PIX gerado" : l.cobranca_status === "OVERDUE" ? "Boleto vencido" : l.cobranca_status}</Badge>}
                {gerir && (l.status === "aberto" || l.status === "atrasado") && <><Button size="sm" onClick={() => setBaixando(l)}>{l.tipo === "receber" ? "Receber" : "Pagar"}</Button><Button size="sm" variant="ghost" onClick={() => setReprog(l)}>Nova data</Button><Button size="sm" variant="ghost" onClick={() => setEditando(l)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => void acao(() => api.post(`/gestao/financeiro/lancamentos/${l.id}/cancelar`, {}), "Lançamento cancelado.")}>Cancelar</Button></>}
                {gerir && l.status === "pago" && <Button size="sm" variant="ghost" onClick={() => void acao(() => api.post(`/gestao/financeiro/lancamentos/${l.id}/estornar`, {}), "Baixa estornada.")}>Estornar</Button>}
                {gerir && l.status === "cancelado" && <><Button size="sm" variant="ghost" onClick={() => void acao(() => api.post(`/gestao/financeiro/lancamentos/${l.id}/cancelar`, { cancelar: false }), "Lançamento reativado.")}>Reativar</Button><Button size="sm" variant="ghost" onClick={() => setApagar(l)}>Excluir</Button></>}
              </div>
            </li>))}
        </ul>
      )}
      {dados && dados.total > 0 && <p className="text-right text-xs text-zinc-500">{dados.total} lançamento(s) · soma dos valores: <b>{dinheiro(dados.soma_centavos)}</b></p>}
      <Pagination page={pagina} totalItems={dados?.total ?? 0} pageSize={30} onPageChange={setPagina} />
      {editando && <LancamentoModal lanc={editando === "novo" ? null : editando} responsaveis={resp} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); void carregar(); }} />}
      {avisando && <AvisoLoteModal itens={avisando} aoFechar={() => setAvisando(null)} aoConcluir={() => { setSel(new Map()); void carregar(); }} />}
      {cobrando && <CobrancaModal lanc={cobrando} aoFechar={() => setCobrando(null)} aoMudar={() => void carregar()} />}
      {reprog && <ReprogramarModal lanc={reprog} aoFechar={() => setReprog(null)} aoSalvar={() => { setReprog(null); void carregar(); }} />}
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
      {lanc && <div className="mb-4"><HistoricoDoLancamento id={lanc.id} /></div>}
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

const emCentavos = (v: string) => { const n = Number(String(v).replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const maisUmMes = (dia: string, apos: string) => {
  const soma = (d: string) => { const [a, m, di] = d.split("-").map(Number); const t = a! * 12 + (m! - 1) + 1; const ano = Math.floor(t / 12), mes = (t % 12) + 1; const ult = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(di!, ult)).padStart(2, "0")}`; };
  let v = soma(dia); while (v <= apos) v = soma(v); return v;
};
export function BaixaModal({ lanc, aoFechar, aoSalvar }: { lanc: Lanc; aoFechar: () => void; aoSalvar: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ pago_em: hoje(), valor_pago: (lanc.valor_centavos / 100).toFixed(2).replace(".", ","), forma_pagamento: "PIX" });
  const [restante, setRestante] = useState<"novo" | "manter">("novo");
  const [dataRestante, setDataRestante] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [abatendo, setAbatendo] = useState(false);
  const [alvo, setAlvo] = useState(0);
  const [valorAbater, setValorAbater] = useState("");
  const [parcelas, setParcelas] = useState<{ id: number; descricao: string; valor_centavos: number; vencimento: string }[]>([]);
  useEffect(() => { api.get<{ itens: typeof parcelas }>(`/gestao/financeiro/lancamentos/${lanc.id}/parcelas-para-abater`, { fresh: true } as never).then((r) => setParcelas(r.itens)).catch(() => setParcelas([])); }, [lanc.id]);
  const pago = emCentavos(f.valor_pago);
  const falta = lanc.valor_centavos - pago;
  const parcial = pago > 0 && falta > 0;
  const excedente = pago - lanc.valor_centavos;
  const alvoAtual = parcelas.find((p) => p.id === (alvo || parcelas[0]?.id));
  const sugerida = maisUmMes(lanc.vencimento, f.pago_em);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const r = await api.post<{ saldo?: { valor_centavos: number; vencimento: string } }>(`/gestao/financeiro/lancamentos/${lanc.id}/baixar`, { ...f, ...(parcial ? { restante, vencimento_restante: restante === "novo" ? dataRestante || sugerida : undefined } : {}), ...(excedente > 0 && abatendo && alvoAtual ? { abater: { lancamento_id: alvoAtual.id, valor: valorAbater || (excedente / 100).toFixed(2).replace(".", ",") } } : {}) });
      show(r.saldo ? `Pagamento parcial registrado. Saldo de ${dinheiro(r.saldo.valor_centavos)} lançado para ${dataBr(r.saldo.vencimento)}.` : lanc.tipo === "receber" ? "Recebimento registrado." : "Pagamento registrado.", "success"); aoSalvar();
    }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível registrar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title={lanc.tipo === "receber" ? "Registrar recebimento" : "Registrar pagamento"} description={`${lanc.descricao} — ${dinheiro(lanc.valor_centavos)}`} maxWidth="max-w-md"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-baixa" loading={salvando}>Confirmar</Button></div>}>
      <form id="form-baixa" onSubmit={salvar} className="space-y-4">
        <Campo rotulo="Data do pagamento"><Input type="date" required max={hoje()} value={f.pago_em} onChange={(e) => setF({ ...f, pago_em: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Valor efetivamente pago (R$)"><Input required inputMode="decimal" value={f.valor_pago} onChange={(e) => setF({ ...f, valor_pago: e.target.value })} className="mt-1.5" /></Campo>
        {parcial && (
          <fieldset className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <legend className="px-1 text-xs font-semibold text-amber-900 dark:text-amber-200">Faltam {dinheiro(falta)}. O que fazer com o restante?</legend>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={restante === "novo"} onChange={() => setRestante("novo")} /><span><b>Lançar o restante em uma nova parcela</b><span className="block text-xs text-zinc-600 dark:text-zinc-300">Esta parcela fecha em {dinheiro(pago)} e nasce um saldo de {dinheiro(falta)}.</span></span></label>
            {restante === "novo" && <div className="pl-6"><label className="text-xs text-zinc-600 dark:text-zinc-300">Vencimento do saldo <Input type="date" min={f.pago_em} value={dataRestante || sugerida} onChange={(e) => setDataRestante(e.target.value)} className="mt-1 h-9 w-44" /></label></div>}
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={restante === "manter"} onChange={() => setRestante("manter")} /><span><b>Dar por quitado</b><span className="block text-xs text-zinc-600 dark:text-zinc-300">Só baixa o valor pago (desconto combinado com o cliente). Nada é lançado depois.</span></span></label>
          </fieldset>)}
        {excedente > 0 && (
          <fieldset className="space-y-2 rounded-xl border border-accent-200 bg-accent-50/60 p-3 text-sm dark:border-accent-500/30 dark:bg-accent-500/10">
            <legend className="px-1 text-xs font-semibold text-accent-800 dark:text-accent-200">Pagou {dinheiro(excedente)} a mais. Quer abater em outra parcela?</legend>
            <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={!abatendo} onChange={() => setAbatendo(false)} /><span><b>Só registrar como recebido a mais</b><span className="block text-xs text-zinc-600 dark:text-zinc-300">As outras parcelas continuam como estão.</span></span></label>
            {parcelas.length > 0 && <>
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={abatendo} onChange={() => { setAbatendo(true); setValorAbater((excedente / 100).toFixed(2).replace(".", ",")); }} /><span><b>Abater em uma parcela</b><span className="block text-xs text-zinc-600 dark:text-zinc-300">Você escolhe a parcela e quanto abater.</span></span></label>
              {abatendo && <div className="grid gap-2 pl-6 sm:grid-cols-[1fr_8rem]">
                <Select value={alvoAtual?.id ?? ""} onChange={(e) => setAlvo(Number(e.target.value))} aria-label="Parcela a abater">{parcelas.map((p) => <option key={p.id} value={p.id}>{dataBr(p.vencimento)} · {dinheiro(p.valor_centavos)}</option>)}</Select>
                <Input inputMode="decimal" value={valorAbater} onChange={(e) => setValorAbater(e.target.value)} aria-label="Valor a abater (R$)" />
                {alvoAtual && <p className="text-xs text-zinc-500 sm:col-span-2">A parcela de {dinheiro(alvoAtual.valor_centavos)} passa a {dinheiro(Math.max(0, alvoAtual.valor_centavos - emCentavos(valorAbater)))}.</p>}
              </div>}
            </>}
          </fieldset>)}
        <Campo rotulo="Forma de pagamento"><Select value={f.forma_pagamento} onChange={(e) => setF({ ...f, forma_pagamento: e.target.value })} className="mt-1.5">{["PIX", "Boleto", "Transferência", "Dinheiro", "Cartão", "Cheque", "Outro"].map((x) => <option key={x}>{x}</option>)}</Select></Campo>
      </form>
    </Modal>
  );
}

interface CobrancaAsaas { status: string; billing_type: string; invoice_url: string; bank_slip_url: string; linha_digitavel: string; pix_payload: string; valor_centavos: number; vencimento: string; taxa_centavos: number | null; pago_em: string | null; erro: string | null }
const STATUS_ASAAS: Record<string, { rotulo: string; tom: "success" | "danger" | "neutral" | "info" | "warning" }> = {
  PENDING: { rotulo: "Aguardando pagamento", tom: "info" }, OVERDUE: { rotulo: "Vencida", tom: "danger" }, RECEIVED: { rotulo: "Paga", tom: "success" }, CONFIRMED: { rotulo: "Paga", tom: "success" },
  RECEIVED_IN_CASH: { rotulo: "Paga", tom: "success" }, CANCELADA: { rotulo: "Cancelada", tom: "neutral" }, DELETED: { rotulo: "Cancelada", tom: "neutral" }, REFUNDED: { rotulo: "Estornada", tom: "warning" },
};

/** Boleto/PIX da parcela pelo Asaas: gerar, copiar, mandar pelo WhatsApp, conferir se foi paga e cancelar. */
export function CobrancaModal({ lanc, aoFechar, aoMudar }: { lanc: Lanc; aoFechar: () => void; aoMudar: () => void }) {
  const { show } = useToast();
  const atendimento = useAtendimentoLiberado();
  const [c, setC] = useState<CobrancaAsaas | null | undefined>(undefined);
  const [configurado, setConfigurado] = useState(true);
  const [tipo, setTipo] = useState<"boleto_pix" | "pix" | "boleto">("boleto_pix");
  const [ocupado, setOcupado] = useState("");
  const ler = useCallback(async () => { try { const r = await api.get<{ cobranca: CobrancaAsaas | null; configurado: boolean }>(`/gestao/financeiro/lancamentos/${lanc.id}/cobranca`, { fresh: true } as never); setC(r.cobranca); setConfigurado(r.configurado); } catch { setC(null); } }, [lanc.id]);
  useEffect(() => { void ler(); }, [ler]);
  const rodar = async (qual: string, fn: () => Promise<{ cobranca: CobrancaAsaas | null }>, ok: string) => {
    setOcupado(qual);
    try { const r = await fn(); setC(r.cobranca); show(ok, "success"); aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); }
    finally { setOcupado(""); }
  };
  const copiar = async (t: string, rot: string) => { try { await navigator.clipboard.writeText(t); show(`${rot} copiado.`, "success"); } catch { show("Não consegui copiar. Selecione e copie à mão.", "info"); } };
  const ativa = c && !["CANCELADA", "DELETED", "REFUNDED"].includes(c.status);
  const link: LinkDePagamento | undefined = ativa && c.invoice_url ? { url: c.invoice_url, pix: c.pix_payload || undefined, linha: c.linha_digitavel || undefined } : undefined;
  const enviar = async () => {
    setOcupado("enviar");
    try { await api.post(`/gestao/financeiro/lancamentos/${lanc.id}/cobranca/enviar`, {}); show("Mensagem com o link de pagamento enviada pelo WhatsApp.", "success"); aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar.", "error"); }
    finally { setOcupado(""); }
  };
  const abrirConversa = async () => {
    const ok = await cobrarPeloAtendimento(lanc.pessoa_telefone ?? "", mensagemDeCobranca(lanc.pessoa_nome ?? "", [lanc], link));
    show(ok ? "Texto copiado. Cole na conversa que abriu." : "Conversa aberta (não consegui copiar o texto).", ok ? "success" : "info");
  };
  const st = c ? STATUS_ASAAS[c.status] ?? { rotulo: c.status, tom: "neutral" as const } : null;
  return (
    <Modal open onClose={aoFechar} title="Boleto e PIX" description={`${lanc.descricao} — ${dinheiro(lanc.valor_centavos)} · vence em ${dataBr(lanc.vencimento)}`} maxWidth="max-w-lg"
      footer={<div className="flex w-full justify-end"><Button variant="outline" onClick={aoFechar}>Fechar</Button></div>}>
      {!configurado ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-300">O Asaas ainda não foi ligado neste escritório. Cole a chave de API em <a className="text-accent-700 underline" href="/configuracoes?secao=asaas">Configurações → Asaas (boleto e PIX)</a>.</p>
      ) : c === undefined ? <p className="text-sm text-zinc-500">Carregando…</p> : !c || !ativa ? (
        <div className="space-y-4 text-sm">
          {c && st && <p className="text-xs text-zinc-500">Última cobrança: {st.rotulo}. Você pode gerar uma nova.</p>}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Como o cliente poderá pagar</legend>
            {([["boleto_pix", "Boleto e PIX", "O cliente escolhe na página de pagamento."], ["pix", "Só PIX", "Cai na hora; a tarifa costuma ser menor."], ["boleto", "Só boleto", "Compensa em até 1 dia útil."]] as const).map(([k, r, d]) => (
              <label key={k} className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-white/10"><input type="radio" className="mt-1" checked={tipo === k} onChange={() => setTipo(k)} /><span><b>{r}</b><span className="block text-xs text-zinc-500">{d}</span></span></label>))}
          </fieldset>
          <Button loading={ocupado === "gerar"} onClick={() => void rodar("gerar", () => api.post(`/gestao/financeiro/lancamentos/${lanc.id}/cobranca`, { tipo }), "Cobrança gerada.")}><QrCode className="h-4 w-4" /> Gerar cobrança</Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">{st && <Badge tone={st.tom}>{st.rotulo}</Badge>}{c.pago_em && <span className="text-xs text-zinc-500">paga em {dataBr(c.pago_em)}{c.taxa_centavos ? ` · tarifa ${dinheiro(c.taxa_centavos)}` : ""}</span>}</div>
          {c.erro && <p className="text-xs text-amber-700 dark:text-amber-300">Aviso: {c.erro}</p>}
          {c.invoice_url && <div className="flex gap-2"><Input readOnly value={c.invoice_url} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={() => void copiar(c.invoice_url, "Link")}><Copy className="h-4 w-4" /></Button><a href={c.invoice_url} target="_blank" rel="noopener noreferrer" className="inline-flex"><Button variant="outline" type="button"><ExternalLink className="h-4 w-4" /></Button></a></div>}
          {c.pix_payload && <div><p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">PIX copia e cola</p><div className="flex gap-2"><Input readOnly value={c.pix_payload} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={() => void copiar(c.pix_payload, "PIX")}><Copy className="h-4 w-4" /></Button></div></div>}
          {c.linha_digitavel && <div><p className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Linha digitável do boleto</p><div className="flex gap-2"><Input readOnly value={c.linha_digitavel} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" onClick={() => void copiar(c.linha_digitavel, "Linha digitável")}><Copy className="h-4 w-4" /></Button>{c.bank_slip_url && <a href={c.bank_slip_url} target="_blank" rel="noopener noreferrer" className="inline-flex"><Button variant="outline" type="button"><FileText className="h-4 w-4" /></Button></a>}</div></div>}
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-white/10">
            {lanc.pessoa_telefone && link && !c.pago_em && <Button loading={ocupado === "enviar"} onClick={() => void enviar()}><MessageCircle className="h-4 w-4" /> Enviar pelo WhatsApp</Button>}
            {atendimento && lanc.pessoa_telefone && link && !c.pago_em && <Button variant="outline" onClick={() => void abrirConversa()}>Abrir conversa</Button>}
            <Button variant="outline" loading={ocupado === "consultar"} onClick={() => void rodar("consultar", () => api.post(`/gestao/financeiro/lancamentos/${lanc.id}/cobranca/consultar`, {}), "Situação atualizada.")}>Atualizar situação</Button>
            {!c.pago_em && <Button variant="ghost" loading={ocupado === "cancelar"} onClick={() => void rodar("cancelar", () => api.post(`/gestao/financeiro/lancamentos/${lanc.id}/cobranca/cancelar`, {}), "Cobrança cancelada.")}>Cancelar cobrança</Button>}
          </div>
        </div>
      )}
    </Modal>
  );
}

interface Taxas {
  de: string; ate: string; total_centavos: number; origem: "extrato" | "cobrancas"; extrato_sincronizado_ate: string | null; recebido_centavos: number; cobrancas_pagas: number; taxa_por_cobranca_centavos: number; percentual_do_recebido: number;
  por_forma: { forma: string; pagas: number; recebido_centavos: number; taxa_centavos: number }[]; por_tipo: { tipo: string; rotulo: string; linhas: number; total_centavos: number }[];
  meses: { mes: string; taxa_centavos: number }[]; linhas: { data: string; tipo: string; rotulo: string; descricao: string; valor_centavos: number }[];
}
/** O que o escritório gasta com o Asaas: total, por tipo de tarifa, por forma de pagamento, mês a mês e linha a linha. */
function TaxasAsaas() {
  const { show } = useToast();
  const { can } = useAuth();
  const [mes, setMes] = useState(mesAtual());
  const [t, setT] = useState<Taxas | null>(null);
  const [sinc, setSinc] = useState(false);
  const carregar = useCallback(async () => { try { setT(await api.get<Taxas>(`/gestao/financeiro/asaas/taxas?mes=${mes}`, { fresh: true } as never)); } catch { show("Não foi possível carregar as taxas.", "error"); } }, [mes, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const sincronizar = async () => {
    setSinc(true);
    try { const r = await api.post<{ lidos: number }>("/gestao/financeiro/asaas/taxas/sincronizar", {}); show(`${r.lidos} lançamento(s) do extrato do Asaas atualizado(s).`, "success"); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível buscar o extrato.", "error"); }
    finally { setSinc(false); }
  };
  const maxMes = Math.max(1, ...(t?.meses ?? []).map((m) => m.taxa_centavos));
  const maxTipo = Math.max(1, ...(t?.por_tipo ?? []).map((x) => x.total_centavos));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm text-zinc-600 dark:text-zinc-300">Mês <Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="ml-2 inline-block h-10 w-44" /></label>
        {can("financeiro.manage") && <Button variant="outline" loading={sinc} onClick={() => void sincronizar()}><Download className="h-4 w-4" /> Atualizar do Asaas</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Gasto com taxas no mês" value={dinheiro(t?.total_centavos)} tone={t && t.total_centavos > 0 ? "warning" : "neutral"} helper={t?.origem === "cobrancas" ? "Pela diferença de cada cobrança paga" : t ? "Pelo extrato do Asaas" : undefined} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="% do recebido" value={`${(t?.percentual_do_recebido ?? 0).toLocaleString("pt-BR")}%`} tone="info" helper={`Recebido pelo Asaas: ${dinheiro(t?.recebido_centavos)}`} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Custo por cobrança" value={dinheiro(t?.taxa_por_cobranca_centavos)} tone="neutral" helper={`${t?.cobrancas_pagas ?? 0} cobrança(s) paga(s)`} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Extrato do Asaas" value={t?.extrato_sincronizado_ate ? dataBr(t.extrato_sincronizado_ate) : "—"} tone="neutral" helper="Última data trazida" />
      </div>
      {t && t.origem === "cobrancas" && t.total_centavos === 0 && <p className="text-sm text-zinc-500">Ainda não há cobranças pagas neste mês. Clique em <b>Atualizar do Asaas</b> para trazer o extrato com todas as tarifas, inclusive notificações e transferências.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface-panel p-5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Com o que gastamos</h2>
          {(t?.por_tipo.length ?? 0) === 0 ? <p className="mt-3 text-sm text-zinc-500">Sem tarifas no extrato deste mês. Traga o extrato com o botão acima.</p> : (
            <ul className="mt-3 space-y-3">{t!.por_tipo.map((x) => <li key={x.tipo}><div className="flex justify-between gap-2 text-sm"><span className="min-w-0 truncate">{x.rotulo}</span><b className="shrink-0">{dinheiro(x.total_centavos)}</b></div><div className="mt-1 h-2 rounded-full bg-zinc-100 dark:bg-white/10"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${Math.max(3, (x.total_centavos / maxTipo) * 100)}%` }} /></div><p className="mt-0.5 text-[11px] text-zinc-400">{x.linhas} lançamento(s)</p></li>)}</ul>)}
        </section>
        <section className="surface-panel p-5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Por forma de pagamento</h2>
          {(t?.por_forma.length ?? 0) === 0 ? <p className="mt-3 text-sm text-zinc-500">Nenhuma cobrança paga neste mês.</p> : (
            <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 font-medium">Forma</th><th className="text-right font-medium">Pagas</th><th className="text-right font-medium">Recebido</th><th className="text-right font-medium">Tarifa</th></tr></thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/10">{t!.por_forma.map((f) => <tr key={f.forma}><td className="py-1.5">{f.forma}</td><td className="text-right tabular-nums">{f.pagas}</td><td className="text-right tabular-nums">{dinheiro(f.recebido_centavos)}</td><td className="text-right tabular-nums">{dinheiro(f.taxa_centavos)}</td></tr>)}</tbody></table>)}
        </section>
      </div>
      <section className="surface-panel p-5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Mês a mês</h2>
        {(t?.meses.length ?? 0) === 0 ? <p className="mt-3 text-sm text-zinc-500">Sem histórico ainda.</p> : (
          <div className="mt-4 flex h-36 items-end gap-2 overflow-x-auto" role="img" aria-label="Gasto com taxas do Asaas por mês">{t!.meses.map((m) => <div key={m.mes} className="flex min-w-[52px] flex-1 flex-col items-center gap-1" title={dinheiro(m.taxa_centavos)}><div className="flex h-24 items-end"><div className="w-6 rounded-t bg-amber-500" style={{ height: `${Math.max(3, (m.taxa_centavos / maxMes) * 100)}%` }} /></div><span className={`text-[11px] ${m.mes === mes ? "font-bold text-accent-700" : "text-zinc-400"}`}>{mesRotulo(m.mes)}</span><span className="text-[10px] text-zinc-500">{dinheiro(m.taxa_centavos)}</span></div>)}</div>)}
      </section>
      {(t?.linhas.length ?? 0) > 0 && (
        <section className="surface-panel p-5">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tarifas lançadas no mês</h2>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 font-medium">Data</th><th className="font-medium">Tipo</th><th className="font-medium">Descrição</th><th className="text-right font-medium">Valor</th></tr></thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/10">{t!.linhas.map((l, i) => <tr key={i}><td className="py-1.5 text-zinc-500">{dataBr(l.data)}</td><td>{l.rotulo}</td><td className="max-w-[280px] truncate text-zinc-500">{l.descricao}</td><td className="text-right tabular-nums">{dinheiro(l.valor_centavos)}</td></tr>)}</tbody></table></div>
        </section>)}
    </div>
  );
}

/** Aditamento de data: nova data de vencimento, com o motivo, e (se for parcela de contrato) as seguintes andam junto. */
export function ReprogramarModal({ lanc, aoFechar, aoSalvar }: { lanc: Lanc; aoFechar: () => void; aoSalvar: () => void }) {
  const { show } = useToast();
  const [data, setData] = useState(lanc.vencimento);
  const [motivo, setMotivo] = useState("");
  const [cascata, setCascata] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const r = await api.post<{ parcelas_movidas: number }>(`/gestao/financeiro/lancamentos/${lanc.id}/reprogramar`, { vencimento: data, motivo, cascata });
      show(r.parcelas_movidas > 0 ? `Nova data salva. ${r.parcelas_movidas} parcela(s) seguinte(s) também mudaram.` : "Nova data salva.", "success"); aoSalvar();
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível mudar a data.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title="Nova data de vencimento" description={`${lanc.descricao} — ${dinheiro(lanc.valor_centavos)} · vence em ${dataBr(lanc.vencimento)}`} maxWidth="max-w-md"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-reprog" loading={salvando} disabled={data === lanc.vencimento}>Salvar nova data</Button></div>}>
      <form id="form-reprog" onSubmit={salvar} className="space-y-4">
        <Campo rotulo="Novo vencimento"><Input type="date" required value={data} onChange={(e) => setData(e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Motivo (fica no histórico)"><Input value={motivo} maxLength={200} placeholder="Ex.: cliente pediu mais prazo" onChange={(e) => setMotivo(e.target.value)} className="mt-1.5" /></Campo>
        {lanc.contrato_id && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={cascata} onChange={(e) => setCascata(e.target.checked)} /><span>Mudar também as <b>próximas parcelas</b> deste contrato<span className="block text-xs text-zinc-500">Se a mudança for de mês (mesmo dia), cada parcela anda o mesmo número de meses.</span></span></label>}
      </form>
    </Modal>
  );
}

/** O que já mudou neste lançamento (pagamento parcial, nova data, valor…). */
function HistoricoDoLancamento({ id }: { id: number }) {
  const [itens, setItens] = useState<{ id: number; acao: string; detalhe: string; autor: string; criado_em: string }[] | null>(null);
  useEffect(() => { api.get<{ itens: typeof itens }>(`/gestao/financeiro/lancamentos/${id}/historico`, { fresh: true } as never).then((r) => setItens(r.itens)).catch(() => setItens([])); }, [id]);
  if (!itens || itens.length === 0) return null;
  return (
    <section className="rounded-xl border border-zinc-200 p-3 dark:border-white/10">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Histórico de alterações</h4>
      <ul className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
        {itens.map((h) => <li key={h.id}><span className="text-zinc-400">{dataBr(h.criado_em.slice(0, 10))}{h.autor ? ` · ${h.autor}` : ""}</span> — {h.detalhe}</li>)}
      </ul>
    </section>
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
