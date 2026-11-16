import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Eye, FileText, Pencil, Trash2, Upload, History } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { dataBr, tamanho } from "./comum";
import { EscolherFoto } from "./EscolherFoto";
import { Camera } from "lucide-react";

interface Versao { id: number; nome: string; tamanho: number; versao: number; autor: string; criado_em: string; categoria: string }
interface Arq extends Versao { exibivel: boolean; descricao: string; versoes: Versao[]; slot?: string; data_documento?: string; mime?: string }
const TIPOS_ESSENCIAIS: [string, string][] = [["rg", "RG"], ["cpf", "CPF"], ["cnh", "CNH"], ["comprovante", "Comprovante de residência"], ["cnis", "CNIS"]];
interface Uso { usado_bytes: number; limite_bytes: number | null; limite_mb: number | null }
const MAX = 25 * 1024 * 1024;

/** Arquivos de uma pasta (processo) ou de uma pessoa: envio, versões, visualização e download. */
export function Arquivos({ escopo, id, aoMudar }: { escopo: "processos" | "pessoas"; id: number; aoMudar?: () => void }) {
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
  const [editar, setEditar] = useState<Arq | null>(null);
  const [fotoDe, setFotoDe] = useState<Arq | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [tipoDoc, setTipoDoc] = useState("");
  const [dataDoc, setDataDoc] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
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
      try {
        const r = await api.upload<{ identificado_como?: string | null; nome?: string }>(`/gestao/${escopo}/${id}/arquivos?nome=${encodeURIComponent(f.name)}&categoria=${encodeURIComponent(categoria)}`, f); ok++;
        if (r?.identificado_como) show(`Identificado como ${r.identificado_como}${r.nome && r.nome !== f.name ? ` e renomeado para ${r.nome}` : ""}.`, "success");
      }
      catch (e) { show(`${f.name}: ${e instanceof ApiError ? e.message : "falha no envio."}`, "error"); }
    }
    if (ok) show(`${ok} arquivo(s) enviado(s).`, "success");
    setEnviando(false); if (entrada.current) entrada.current.value = ""; await carregar(); if (ok) aoMudar?.();
  };
  function abrirEdicao(a: Arq) { setEditar(a); setNovoNome(a.nome); setTipoDoc(a.slot ?? ""); setDataDoc((a.data_documento || a.criado_em).slice(0, 10)); }
  const [identificando, setIdentificando] = useState(false);
  async function identificar() {
    const a = editar; if (!a) return; setIdentificando(true);
    try {
      const r = await api.post<{ situacao: string; slot?: string; nome?: string; foto?: boolean; motivo_foto?: string }>(`/gestao/arquivos/${a.id}/identificar`, {});
      if (r.situacao === "classificado") { show(`Identificado como ${TIPOS_ESSENCIAIS.find(([k]) => k === r.slot)?.[1] ?? r.slot} e renomeado para ${r.nome}.${r.foto ? " Achei também a foto: confira o cartão no alto da ficha." : r.motivo_foto && (r.slot === "rg" || r.slot === "cnh") ? ` A foto não foi sugerida: ${r.motivo_foto}.` : ""}`, "success"); setEditar(null); await carregar(); aoMudar?.(); }
      else if (r.situacao === "so_foto") { show("Não tive certeza de que documento é, mas achei a foto: confira o cartão “Encontramos uma foto” no alto da ficha.", "success"); setEditar(null); aoMudar?.(); }
      else show(r.situacao === "sem_ia" ? "A IA ainda não pode ler este arquivo: conecte a conta ChatGPT ou cadastre uma chave de API em Configurações → Central de IA." : r.situacao === "pdf_sem_leitor" ? "O servidor ainda não consegue abrir PDFs para a IA (falta instalar o pacote poppler-utils). Imagens funcionam; para PDF, classifique à mão por enquanto." : r.situacao === "nao_identificado" ? `Não consegui ter certeza do tipo deste documento nem achar a foto${r.motivo_foto ? ` (${r.motivo_foto})` : ""}. Você pode escolher o tipo à mão e usar o botão da câmera para recortar a foto.` : "Este tipo ou tamanho de arquivo não pode ser lido.", "info");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível identificar.", "error"); }
    finally { setIdentificando(false); }
  }
  async function salvarEdicao() {
    const a = editar; if (!a) return; setSalvandoEdicao(true);
    try {
      if ((a.slot ?? "") !== tipoDoc) await api.put(`/gestao/arquivos/${a.id}/classificar`, { slot: tipoDoc, data: dataDoc, padronizar: Boolean(tipoDoc) && novoNome === a.nome });
      if (novoNome !== a.nome) await api.put(`/gestao/arquivos/${a.id}/nome`, { nome: novoNome });
      show("Arquivo atualizado.", "success"); setEditar(null); await carregar(); aoMudar?.();
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvandoEdicao(false); }
  }
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
                  <p className="truncate text-xs text-zinc-500">{tamanho(a.tamanho)} · {dataBr(a.criado_em)} · {a.autor || "—"}{a.categoria ? ` · ${a.categoria}` : ""}{a.slot ? " · documento essencial" : ""}</p></div>
                <div className="flex shrink-0 items-center gap-1">
                  {a.versoes.length > 0 && <button type="button" title="Versões anteriores" aria-label="Versões anteriores" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setAbertas((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}><History className="h-4 w-4" /></button>}
                  {a.exibivel && <a href={link(a, true)} target="_blank" rel="noopener noreferrer" title="Ver" aria-label={`Ver ${a.nome}`} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Eye className="h-4 w-4" /></a>}
                  <a href={link(a)} title="Baixar" aria-label={`Baixar ${a.nome}`} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Download className="h-4 w-4" /></a>
                  {gerir && escopo === "pessoas" && ((a.mime ?? "").startsWith("image/") || a.mime === "application/pdf" || /\.(pdf|jpe?g|png|webp)$/i.test(a.nome)) && <button type="button" title="Escolher a foto do cliente neste documento" aria-label={`Escolher a foto do cliente em ${a.nome}`} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setFotoDe(a)}><Camera className="h-4 w-4" /></button>}
                  {gerir && <button type="button" title="Renomear ou classificar" aria-label={`Renomear ou classificar ${a.nome}`} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => abrirEdicao(a)}><Pencil className="h-4 w-4" /></button>}
                  {gerir && <button type="button" title="Apagar" aria-label={`Apagar ${a.nome}`} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" onClick={() => setApagar(a)}><Trash2 className="h-4 w-4" /></button>}
                </div>
              </div>
              {abertas.has(a.id) && <ul className="ml-8 mt-2 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-700">{a.versoes.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-xs text-zinc-500"><span>v{v.versao} · {tamanho(v.tamanho)} · {dataBr(v.criado_em)} · {v.autor}</span><span className="flex gap-2"><a className="text-accent-700 hover:underline" href={link(v)}>Baixar</a>{gerir && <button type="button" className="hover:text-red-600" onClick={() => setApagar(v)}>Apagar</button>}</span></li>))}</ul>}
            </li>
          ))}
        </ul>
      )}
      {escopo === "pessoas" && fotoDe && <EscolherFoto arquivoId={fotoDe.id} pessoaId={id} nome="cliente" aberto aoFechar={() => setFotoDe(null)} aoSalvar={() => { aoMudar?.(); void carregar(); }} />}
      {escopo === "pessoas" && (
        <Modal open={Boolean(editar)} onClose={() => setEditar(null)} title="Renomear ou classificar" description="Se este arquivo é um dos documentos essenciais, escolha qual: ele passa a valer no lugar do anterior, pela data do documento." maxWidth="max-w-md"
          footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setEditar(null)}>Cancelar</Button><Button loading={salvandoEdicao} onClick={() => void salvarEdicao()}>Salvar</Button></div>}>
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50"><span className="text-xs text-zinc-600 dark:text-zinc-300">Deixe o sistema ler o arquivo e descobrir que documento é, a data e o nome certo.</span><Button size="sm" variant="outline" loading={identificando} onClick={() => void identificar()}>Identificar automaticamente</Button></div>
            <label className="block"><span className="font-medium text-zinc-800 dark:text-zinc-200">Este arquivo é</span>
              <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"><option value="">Outro documento (comum)</option>{TIPOS_ESSENCIAIS.map(([k, r]) => <option key={k} value={k}>{r}</option>)}</select></label>
            {tipoDoc && <label className="block"><span className="font-medium text-zinc-800 dark:text-zinc-200">Data do documento</span><Input type="date" value={dataDoc} onChange={(e) => setDataDoc(e.target.value)} className="mt-1.5" /><span className="mt-1 block text-xs text-zinc-500">Ao classificar, o nome vira o padrão (AAAA-MM-DD - Documento), a menos que você mude o nome abaixo.</span></label>}
            <label className="block"><span className="font-medium text-zinc-800 dark:text-zinc-200">Nome do arquivo</span><Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="mt-1.5" maxLength={180} /></label>
          </div>
        </Modal>)}
      <ConfirmDialog open={Boolean(apagar)} title="Apagar arquivo" message={`Apagar ${apagar?.nome} (v${apagar?.versao})? O arquivo é removido do servidor e não pode ser recuperado.`} confirmLabel="Apagar" onConfirm={() => void excluir()} onCancel={() => setApagar(null)} />
    </div>
  );
}
