import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { dataBr, dinheiro } from "./comum";

type Tipo = "" | "boleto_pix" | "pix" | "boleto";
interface Resultado { lancamento_id: number; status: "enviado" | "falhou" | "ignorado"; motivo?: string }
interface RespLote { resultados: Resultado[]; enviados: number; falhas: number; ignorados: number }
export interface ItemAviso { id: number; rotulo: string }

/** Confirma e executa o envio de avisos pelo Deskcomm. Nada se configura aqui: textos, boleto/PIX e formato ficam em Configurações → Cobranças e avisos. */
export function AvisoLoteModal({ itens, aoFechar, aoConcluir }: { itens: ItemAviso[]; aoFechar: () => void; aoConcluir: () => void }) {
  const { show } = useToast();
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<RespLote | null>(null);
  const enviar = async () => {
    setEnviando(true);
    try { const x = await api.post<RespLote>("/gestao/financeiro/avisos/lote", { ids: itens.map((i) => i.id) }); setR(x); aoConcluir(); if (!x.falhas) show(`${x.enviados} aviso(s) enviado(s).`, "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar.", "error"); }
    finally { setEnviando(false); }
  };
  const nome = (id: number) => itens.find((i) => i.id === id)?.rotulo ?? `Parcela ${id}`;
  return (
    <Modal open onClose={aoFechar} title={itens.length === 1 ? "Enviar aviso de cobrança" : `Enviar ${itens.length} avisos de cobrança`} description="Sai pelo Deskcomm, na conversa do cliente, com intervalo entre as mensagens." maxWidth="max-w-lg"
      footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={aoFechar}>{r ? "Fechar" : "Cancelar"}</Button>{!r && <Button loading={enviando} onClick={() => void enviar()}><Send className="h-4 w-4" /> Enviar</Button>}</div>}>
      {!r ? (
        <div className="space-y-3 text-sm">
          <ul className="max-h-48 divide-y divide-zinc-100 overflow-auto rounded-lg border border-zinc-200 dark:divide-white/10 dark:border-white/10">{itens.map((i) => <li key={i.id} className="px-3 py-1.5 text-zinc-700 dark:text-zinc-200">{i.rotulo}</li>)}</ul>
          <p className="text-xs text-zinc-500">Texto, boleto/PIX e formato de envio seguem o que está em <a className="underline" href="/configuracoes?secao=cobranca">Configurações → Cobranças e avisos</a>.</p>
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

interface Config { ativa: boolean; antes_dias: number[]; no_dia: boolean; depois_dias: number[]; horario: string }
interface Pendente { lancamento_id: number; pessoa_id: number; nome: string; descricao: string; valor_centavos: number; vencimento: string; regra: string; telefone_ok: boolean }
interface Hist { id: number; regra: string; origem: string; status: string; erro: string | null; atualizado_em: string; pessoa_nome: string | null; descricao: string; valor_centavos: number }
const rotuloRegra = (r: string) => { const [t, n] = r.split(":"); return t === "hoje" ? "No dia" : t === "antes" ? `${n} dia(s) antes` : t === "depois" ? `${n} dia(s) depois` : "Manual"; };

/** Aba «Cobrança automática»: só acompanha (o que sai hoje e o histórico). As opções ficam em Configurações → Cobranças e avisos. */
export function ReguaAutomatica() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("financeiro.manage");
  const [c, setC] = useState<Config | null>(null);
  const [canal, setCanal] = useState(true);
  const [pend, setPend] = useState<Pendente[]>([]);
  const [hist, setHist] = useState<Hist[]>([]);
  const [enviar, setEnviar] = useState(false);
  const ler = useCallback(async () => {
    try { const r = await api.get<{ canal_ligado: boolean; config: Config; pendentes: Pendente[]; historico: Hist[] }>("/gestao/financeiro/regua", { fresh: true } as never); setC(r.config); setCanal(r.canal_ligado); setPend(r.pendentes); setHist(r.historico); }
    catch { show("Não foi possível carregar a cobrança automática.", "error"); }
  }, [show]);
  useEffect(() => { void ler(); }, [ler]);
  if (!c) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const resumo = [c.antes_dias.length ? `${c.antes_dias.join(", ")} dia(s) antes` : "", c.no_dia ? "no dia" : "", c.depois_dias.length ? `${c.depois_dias.join(", ")} dia(s) depois` : ""].filter(Boolean).join(" · ") || "nenhum aviso definido";
  return (
    <div className="space-y-5">
      {!canal && <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">O envio pelo Deskcomm ainda não está ligado: nenhum aviso sai enquanto não houver o token. <a className="underline" href="/configuracoes?secao=deskcomm-envio">Ligar agora</a></p>}
      <section className="surface-panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div><h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Avisos automáticos: {c.ativa ? <Badge tone="success">Ligados</Badge> : <Badge tone="neutral">Desligados</Badge>}</h2><p className="mt-1 text-xs text-zinc-500">{resumo} · a partir das {c.horario} (Brasília)</p></div>
        <a href="/configuracoes?secao=cobranca" className="text-sm text-accent-700 underline dark:text-accent-300">Alterar em Configurações</a>
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
