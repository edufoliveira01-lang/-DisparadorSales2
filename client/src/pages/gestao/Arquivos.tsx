import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Trash2, Upload, History } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { dataBr, tamanho } from "./comum";

interface Versao { id: number; nome: string; tamanho: number; versao: number; autor: string; criado_em: string; categoria: string }
interface Arq extends Versao { exibivel: boolean; descricao: string; versoes: Versao[] }
interface Uso { usado_bytes: number; limite_bytes: number | null; limite_mb: number | null }
const MAX = 25 * 1024 * 1024;

/** Arquivos de uma pasta (processo) ou de uma pessoa: envio, versões, visualização e download. */
export function Arquivos({ escopo, id }: { escopo: "processos" | "pessoas"; id: number }) {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [lista, setLista] = useState<Arq[] | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [categoria, setCategoria] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [apagar, setApagar] = useState<Versao | null>(null);
  const [abertas, setAbertas] = useState<Set<number>>(new Set());
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try { const [a, u] = await Promise.all([api.get<Arq[]>(`/gestao/${escopo}/${id}/arquivos`), api.get<Uso>("/gestao/armazenamento")]); setLista(a); setUso(u); }
    catch { show("Não foi possível carregar os arquivos.", "error"); }
  }, [escopo, id, show]);
  useEffect(() => { void carregar(); }, [carregar]);

  const enviar = async (arquivos: FileList | File[]) => {
    const itens = Array.from(arquivos); if (!itens.length) return;
    setEnviando(true);
    let ok = 0;
    for (const f of itens) {
      if (f.size > MAX) { show(`${f.name}: passa de 25 MB.`, "error"); continue; }
      try { await api.upload(`/gestao/${escopo}/${id}/arquivos?nome=${encodeURIComponent(f.name)}&categoria=${encodeURIComponent(categoria)}`, f); ok++; }
      catch (e) { show(`${f.name}: ${e instanceof ApiError ? e.message : "falha no envio."}`, "error"); }
    }
    if (ok) show(`${ok} arquivo(s) enviado(s).`, "success");
    setEnviando(false); if (entrada.current) entrada.current.value = ""; await carregar();
  };
  const excluir = async () => {
    if (!apagar) return;
    try { await api.delete(`/gestao/arquivos/${apagar.id}`); show("Arquivo apagado.", "success"); setApagar(null); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível apagar.", "error"); setApagar(null); }
  };
  const link = (a: Versao, inline = false) => `/api/gestao/arquivos/${a.id}/baixar${inline ? "?inline=1" : ""}`;
  const pct = uso?.limite_bytes ? Math.min(100, Math.round((uso.usado_bytes / uso.limite_bytes) * 100)) : null;

  return (
    <div className="space-y-4">
      {gerir && (
        <div onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={(e) => { e.preventDefault(); setArrastando(false); void enviar(e.dataTransfer.files); }}
          className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${arrastando ? "border-accent-500 bg-accent-50 dark:bg-accent-950/30" : "border-zinc-300 dark:border-zinc-700"}`}>
          <Upload className="mx-auto h-6 w-6 text-zinc-400" />
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Arraste arquivos aqui ou</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Input className="h-9 w-44" placeholder="Categoria (opcional)" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria" />
            <Button size="sm" loading={enviando} onClick={() => entrada.current?.click()}>Escolher arquivos</Button>
            <input ref={entrada} type="file" multiple hidden onChange={(e) => e.target.files && void enviar(e.target.files)} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">PDF, Word, Excel, imagens, áudio, vídeo, texto e ZIP, até 25 MB cada. Arquivo com o mesmo nome vira uma nova versão.</p>
        </div>
      )}
      {uso && <p className="text-xs text-zinc-500">Espaço usado: {tamanho(uso.usado_bytes)}{uso.limite_bytes ? ` de ${tamanho(uso.limite_bytes)} (${pct}%)` : " (sem limite no plano)"}</p>}
      {lista === null ? <p className="text-sm text-zinc-500">Carregando…</p> : lista.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhum arquivo ainda.</p> : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {lista.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{a.nome}{a.versao > 1 && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">v{a.versao}</span>}</p>
                  <p className="truncate text-xs text-zinc-500">{tamanho(a.tamanho)} · {dataBr(a.criado_em)} · {a.autor || "—"}{a.categoria ? ` · ${a.categoria}` : ""}</p></div>
                <div className="flex shrink-0 items-center gap-1">
                  {a.versoes.length > 0 && <button type="button" title="Versões anteriores" aria-label="Versões anteriores" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setAbertas((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}><History className="h-4 w-4" /></button>}
                  {a.exibivel && <a href={link(a, true)} target="_blank" rel="noopener noreferrer" title="Ver" aria-label={`Ver ${a.nome}`} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Eye className="h-4 w-4" /></a>}
                  <a href={link(a)} title="Baixar" aria-label={`Baixar ${a.nome}`} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /></a>
                  {gerir && <button type="button" title="Apagar" aria-label={`Apagar ${a.nome}`} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" onClick={() => setApagar(a)}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
              {abertas.has(a.id) && <ul className="ml-8 mt-2 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-700">{a.versoes.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-xs text-zinc-500"><span>v{v.versao} · {tamanho(v.tamanho)} · {dataBr(v.criado_em)} · {v.autor}</span><span className="flex gap-2"><a className="text-accent-700 hover:underline" href={link(v)}>Baixar</a>{gerir && <button type="button" className="hover:text-red-600" onClick={() => setApagar(v)}>Apagar</button>}</span></li>))}</ul>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(apagar)} title="Apagar arquivo" message={`Apagar ${apagar?.nome} (v${apagar?.versao})? O arquivo é removido do servidor e não pode ser recuperado.`} confirmLabel="Apagar" onConfirm={() => void excluir()} onCancel={() => setApagar(null)} />
    </div>
  );
}
