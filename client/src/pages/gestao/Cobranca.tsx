import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { dataBr, dinheiro } from "./comum";

type Tipo = "" | "boleto_pix" | "pix" | "boleto";
interface Resultado { lancamento_id: number; status: "enviado" | "falhou" | "ignorado"; motivo?: string }
interface RespLote { resultados: Resultado[]; enviados: number; falhas: number; ignorados: number }
export interface ItemAviso { id: number; rotulo: string }

/** Confirma e envia avisos de cobrança pelo WhatsApp do sistema (uma ou várias parcelas, com intervalo entre as mensagens). */
export function AvisoLoteModal({ itens, aoFechar, aoConcluir }: { itens: ItemAviso[]; aoFechar: () => void; aoConcluir: () => void }) {
  const { show } = useToast();
  const [asaas, setAsaas] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("");
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<RespLote | null>(null);
  useEffect(() => { api.get<{ asaas: boolean }>("/gestao/financeiro/regua").then((x) => setAsaas(x.asaas)).catch(() => undefined); }, []);
  const enviar = async () => {
    setEnviando(true);
    try { const x = await api.post<RespLote>("/gestao/financeiro/avisos/lote", { ids: itens.map((i) => i.id), gerar: tipo || false }); setR(x); aoConcluir(); if (!x.falhas) show(`${x.enviados} aviso(s) enviado(s).`, "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar.", "error"); }
    finally { setEnviando(false); }
  };
  const nome = (id: number) => itens.find((i) => i.id === id)?.rotulo ?? `Parcela ${id}`;
  return (
    <Modal open onClose={aoFechar} title={itens.length === 1 ? "Enviar aviso de cobrança" : `Enviar ${itens.length} avisos de cobrança`} description="A mensagem sai pelo Deskcomm, na conversa do cliente, com um intervalo entre uma e outra." maxWidth="max-w-lg"
      footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={aoFechar}>{r ? "Fechar" : "Cancelar"}</Button>{!r && <Button loading={enviando} onClick={() => void enviar()}><Send className="h-4 w-4" /> Enviar agora</Button>}</div>}>
      {!r ? (
        <div className="space-y-4 text-sm">
          <ul className="max-h-40 divide-y divide-zinc-100 overflow-auto rounded-lg border border-zinc-200 dark:divide-white/10 dark:border-white/10">{itens.map((i) => <li key={i.id} className="px-3 py-1.5 text-zinc-700 dark:text-zinc-200">{i.rotulo}</li>)}</ul>
          <label className="block"><span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Link de pagamento na mensagem</span>
            <select className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-900" value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} disabled={!asaas}>
              <option value="">Só o aviso (sem boleto/PIX)</option><option value="boleto_pix">Gerar e enviar boleto e PIX</option><option value="pix">Gerar e enviar só PIX</option><option value="boleto">Gerar e enviar só boleto</option>
            </select>
            <span className="mt-1 block text-xs text-zinc-500">{asaas ? "Parcelas já vencidas recebem apenas o lembrete: para gerar a cobrança, escolha antes uma nova data. Se já existir boleto/PIX, o mesmo link é reaproveitado." : "Ligue o Asaas em Configurações para enviar boleto/PIX junto."}</span></label>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2"><Badge tone="success">{r.enviados} enviado(s)</Badge>{r.falhas > 0 && <Badge tone="danger">{r.falhas} falha(s)</Badge>}{r.ignorados > 0 && <Badge tone="neutral">{r.ignorados} ignorado(s)</Badge>}</div>
          {r.resultados.filter((x) => x.status !== "enviado").map((x) => <p key={x.lancamento_id} className="text-xs text-amber-700 dark:text-amber-300"><b>{nome(x.lancamento_id)}:</b> {x.motivo}</p>)}
        </div>
      )}
    </Modal>
  );
}

interface Config { ativa: boolean; antes_dias: number[]; no_dia: boolean; depois_dias: number[]; horario: string; gerar_cobranca: boolean; tipo: "boleto_pix" | "pix" | "boleto" }
interface Pendente { lancamento_id: number; pessoa_id: number; nome: string; descricao: string; valor_centavos: number; vencimento: string; regra: string; telefone_ok: boolean }
interface Hist { id: number; regra: string; origem: string; status: string; erro: string | null; atualizado_em: string; pessoa_nome: string | null; descricao: string; valor_centavos: number }
const lista = (t: string) => t.split(/[,\s;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90);
const rotuloRegra = (r: string) => { const [t, n] = r.split(":"); return t === "hoje" ? "No dia" : t === "antes" ? `${n} dia(s) antes` : t === "depois" ? `${n} dia(s) depois` : "Manual"; };

/** Aba «Cobrança automática»: a régua de avisos de vencimento (antes, no dia e depois). */
export function ReguaAutomatica() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("financeiro.manage");
  const [c, setC] = useState<Config | null>(null);
  const [asaas, setAsaas] = useState(false);
  const [canal, setCanal] = useState(true);
  const [pend, setPend] = useState<Pendente[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [antes, setAntes] = useState("");
  const [depois, setDepois] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [enviar, setEnviar] = useState(false);
  const ler = useCallback(async () => {
    try { const r = await api.get<{ canal_ligado: boolean; config: Config; asaas: boolean; pendentes: Pendente[]; historico: Hist[] }>("/gestao/financeiro/regua", { fresh: true } as never); setC(r.config); setAsaas(r.asaas); setCanal(r.canal_ligado); setPend(r.pendentes); setHist(r.historico); setAntes(r.config.antes_dias.join(", ")); setDepois(r.config.depois_dias.join(", ")); }
    catch { show("Não foi possível carregar a cobrança automática.", "error"); }
  }, [show]);
  useEffect(() => { void ler(); }, [ler]);
  if (!c) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const salvar = async (parcial: Partial<Config> = {}) => {
    setSalvando(true);
    try { const r = await api.put<{ config: Config }>("/gestao/financeiro/regua", { ...c, antes_dias: lista(antes), depois_dias: lista(depois), ...parcial }); setC(r.config); show("Cobrança automática salva.", "success"); await ler(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <div className="space-y-5">
      {!canal && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">O envio pelo Deskcomm ainda não está ligado: nenhum aviso sai enquanto não houver o token. <a className="underline" href="/configuracoes?secao=deskcomm-envio">Ligar agora</a></p>}
      <section className="surface-panel space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Avisos automáticos de vencimento</h2><p className="text-xs text-zinc-500">O sistema avisa o cliente pelo Deskcomm (WhatsApp do atendimento), no horário abaixo. Cada parcela recebe cada aviso uma única vez.</p></div>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={c.ativa} disabled={!gerir} onChange={(e) => void salvar({ ativa: e.target.checked })} /> {c.ativa ? "Ligada" : "Desligada"}</label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Avisar ANTES do vencimento (dias)</span><Input value={antes} disabled={!gerir} onChange={(e) => setAntes(e.target.value)} placeholder="ex.: 3, 1" /></label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Avisar DEPOIS do vencimento (dias)</span><Input value={depois} disabled={!gerir} onChange={(e) => setDepois(e.target.value)} placeholder="ex.: 1, 7" /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.no_dia} disabled={!gerir} onChange={(e) => setC({ ...c, no_dia: e.target.checked })} /> Avisar no dia do vencimento</label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Horário dos envios (Brasília)</span><Input type="time" value={c.horario} disabled={!gerir} onChange={(e) => setC({ ...c, horario: e.target.value })} className="w-36" /></label>
        </div>
        <div className="space-y-2 rounded-xl border border-zinc-200 p-3 text-sm dark:border-white/10">
          <label className="flex items-center gap-2"><input type="checkbox" checked={c.gerar_cobranca} disabled={!gerir || !asaas} onChange={(e) => setC({ ...c, gerar_cobranca: e.target.checked })} /> Gerar boleto/PIX no Asaas e enviar o link junto (parcelas ainda não vencidas)</label>
          {!asaas && <p className="text-xs text-zinc-500">Ligue o Asaas em Configurações para usar esta opção. Sem ele, o aviso vai só com o lembrete.</p>}
          {c.gerar_cobranca && asaas && <select className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-900" value={c.tipo} disabled={!gerir} onChange={(e) => setC({ ...c, tipo: e.target.value as Config["tipo"] })}><option value="boleto_pix">Boleto e PIX</option><option value="pix">Só PIX</option><option value="boleto">Só boleto</option></select>}
        </div>
        <p className="text-xs text-zinc-500">Clientes com avisos pausados (botão na ficha do cliente) e parcelas sem telefone válido são ignorados. Sem o token do Deskcomm (Configurações → Envio pelo Deskcomm), nada é enviado.</p>
        {gerir && <div className="flex justify-end"><Button loading={salvando} onClick={() => void salvar()}>Salvar</Button></div>}
      </section>
      <section className="surface-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Para enviar hoje ({pend.length})</h2>{gerir && pend.some((p) => p.telefone_ok) && <Button size="sm" variant="outline" onClick={() => setEnviar(true)}><MessageCircle className="h-4 w-4" /> Enviar agora</Button>}</div>
        {pend.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Nada pendente pelas regras de hoje.</p> : (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-white/10">{pend.map((p) => <li key={p.lancamento_id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 truncate"><b>{p.nome}</b> · {p.descricao}</span><span className="flex items-center gap-2 text-xs text-zinc-500">{rotuloRegra(p.regra)} · vence {dataBr(p.vencimento)} · {dinheiro(p.valor_centavos)}{!p.telefone_ok && <Badge tone="danger">sem telefone</Badge>}</span></li>)}</ul>)}
      </section>
      <section className="surface-panel p-5">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Últimos avisos</h2>
        {hist.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Nenhum aviso enviado ainda.</p> : (
          <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-white/10">{hist.map((h) => <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0 truncate"><b>{h.pessoa_nome ?? "—"}</b> · {h.descricao} · {dinheiro(h.valor_centavos)}</span><span className="flex items-center gap-2 text-xs text-zinc-500">{rotuloRegra(h.regra)} · {h.origem} · {dataBr(h.atualizado_em)}<Badge tone={h.status === "enviado" ? "success" : "danger"}>{h.status === "enviado" ? "Enviado" : "Falhou"}</Badge>{h.erro && <span className="text-amber-700 dark:text-amber-300">{h.erro}</span>}</span></li>)}</ul>)}
      </section>
      {enviar && <AvisoLoteModal itens={pend.filter((p) => p.telefone_ok).map((p) => ({ id: p.lancamento_id, rotulo: `${p.nome} · ${p.descricao}` }))} aoFechar={() => setEnviar(false)} aoConcluir={() => void ler()} />}
    </div>
  );
}
