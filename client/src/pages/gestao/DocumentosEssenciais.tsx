import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Eye, FileQuestion, History, Upload } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { dataBr } from "./comum";

export interface Essencial {
  slot: string; rotulo: string; validade_dias: number | null; situacao: "ok" | "desatualizado" | "faltando";
  atual: { id: number; nome: string; tamanho: number; data: string; idade_dias: number | null; autor: string; exibivel: boolean } | null;
  historico: { id: number; nome: string; data: string; autor: string }[];
}
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const idade = (d: number | null) => (d === null ? "" : d <= 0 ? "de hoje" : d === 1 ? "de ontem" : `de ${d} dias atrás`);

/** Os 5 documentos que todo cliente precisa ter no cadastro. Comprovante e CNIS precisam ser recentes: o mais recente é o atual, os anteriores ficam no histórico. */
export function DocumentosEssenciais({ pessoaId, gerir, aoMudar }: { pessoaId: number; gerir: boolean; aoMudar?: () => void }) {
  const { show } = useToast();
  const [itens, setItens] = useState<Essencial[] | null>(null);
  const [enviando, setEnviando] = useState<Essencial | null>(null);
  const [data, setData] = useState(hoje());
  const [historico, setHistorico] = useState<Essencial | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try { setItens((await api.get<{ itens: Essencial[] }>(`/gestao/pessoas/${pessoaId}/documentos-essenciais`, { fresh: true } as never)).itens); }
    catch { show("Não foi possível carregar os documentos essenciais.", "error"); }
  }, [pessoaId, show]);
  useEffect(() => { setItens(null); void carregar(); }, [carregar]);

  async function enviar(f: File | undefined) {
    if (!f || !enviando) return; setOcupado(true);
    try {
      const r = await api.upload<{ itens: Essencial[] }>(`/gestao/pessoas/${pessoaId}/documentos-essenciais/${enviando.slot}?nome=${encodeURIComponent(f.name)}&data=${data}`, f);
      setItens(r.itens); setEnviando(null); show(`${enviando.rotulo} salvo.`, "success"); aoMudar?.();
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar.", "error"); }
    finally { setOcupado(false); if (entrada.current) entrada.current.value = ""; }
  }
  const link = (id: number, inline = false) => `/api/gestao/arquivos/${id}/baixar${inline ? "?inline=1" : ""}`;
  const faltam = (itens ?? []).filter((i) => i.situacao !== "ok").length;

  return (
    <section aria-label="Documentos essenciais" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Documentos essenciais</h3>
        {itens && <span className="text-xs text-zinc-500">{faltam === 0 ? "Todos em dia." : `${faltam} para enviar ou atualizar.`}</span>}
      </div>
      {itens === null ? <p className="text-sm text-zinc-500">Carregando…</p> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {itens.map((d) => (
            <li key={d.slot} className={`flex flex-col gap-2 rounded-2xl border bg-white p-4 dark:bg-zinc-900 ${d.situacao === "ok" ? "border-zinc-200 dark:border-zinc-700" : d.situacao === "desatualizado" ? "border-amber-300 dark:border-amber-500/40" : "border-dashed border-zinc-300 dark:border-zinc-600"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{d.rotulo}</p>
                {d.situacao === "ok" ? <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />Em dia</Badge>
                  : d.situacao === "desatualizado" ? <Badge tone="warning"><AlertTriangle className="mr-1 inline h-3 w-3" />Desatualizado</Badge>
                  : <Badge tone="neutral"><FileQuestion className="mr-1 inline h-3 w-3" />Faltando</Badge>}
              </div>
              {d.atual ? (
                <div className="min-w-0 text-xs text-zinc-500">
                  <p className="truncate font-medium text-zinc-700 dark:text-zinc-200" title={d.atual.nome}>{d.atual.nome}</p>
                  <p>Documento de {dataBr(d.atual.data)} ({idade(d.atual.idade_dias)}){d.validade_dias ? ` · vale ${d.validade_dias} dias` : ""}</p>
                </div>) : <p className="text-xs text-zinc-500">Ainda não enviado.{d.validade_dias ? ` Precisa ser dos últimos ${d.validade_dias} dias.` : ""}</p>}
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                {d.atual?.exibivel && <a href={link(d.atual.id, true)} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${d.rotulo}`} title="Ver" className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700"><Eye className="h-4 w-4" /></a>}
                {d.atual && <a href={link(d.atual.id)} aria-label={`Baixar ${d.rotulo}`} title="Baixar" className="rounded-lg border border-zinc-200 p-1.5 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700"><Download className="h-4 w-4" /></a>}
                {d.historico.length > 0 && <button type="button" onClick={() => setHistorico(d)} title="Versões anteriores" className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-zinc-600 hover:border-zinc-400 dark:border-zinc-700"><History className="h-4 w-4" />{d.historico.length}</button>}
                {gerir && <Button size="sm" variant={d.situacao === "ok" ? "outline" : "primary"} className="ml-auto" onClick={() => { setData(hoje()); setEnviando(d); }}><Upload className="h-4 w-4" /> {d.atual ? "Enviar novo" : "Enviar"}</Button>}
              </div>
            </li>))}
        </ul>)}

      <Modal open={Boolean(enviando)} onClose={() => setEnviando(null)} title={`Enviar ${enviando?.rotulo ?? ""}`} description="O arquivo é guardado com o nome padrão (AAAA-MM-DD - Documento) e passa a ser o atual. O anterior fica no histórico." maxWidth="max-w-md"
        footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setEnviando(null)}>Cancelar</Button><Button loading={ocupado} onClick={() => entrada.current?.click()}>Escolher arquivo</Button></div>}>
        <label className="block text-sm"><span className="font-medium text-zinc-800 dark:text-zinc-200">Data do documento</span>
          <Input type="date" value={data} max={hoje()} onChange={(e) => setData(e.target.value)} className="mt-1.5" />
          <span className="mt-1 block text-xs text-zinc-500">{enviando?.validade_dias ? `Informe a data impressa no documento (vale ${enviando.validade_dias} dias).` : "Pode deixar a data de hoje."}</span></label>
        <input ref={entrada} type="file" hidden onChange={(e) => void enviar(e.target.files?.[0])} />
      </Modal>
      <Modal open={Boolean(historico)} onClose={() => setHistorico(null)} title={`${historico?.rotulo ?? ""}: versões anteriores`} maxWidth="max-w-md">
        <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{historico?.historico.map((h) => <li key={h.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 truncate">{h.nome} <span className="text-xs text-zinc-500">· {dataBr(h.data)} · {h.autor || "—"}</span></span><a href={link(h.id)} className="text-xs text-accent-700 underline">Baixar</a></li>)}</ul>
      </Modal>
    </section>
  );
}
