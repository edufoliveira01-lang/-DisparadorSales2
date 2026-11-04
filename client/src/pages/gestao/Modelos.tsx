import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Plus, Printer, Download, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { Campo, SeletorPessoa, SeletorProcesso } from "./comum";

interface Modelo { id: number; nome: string; categoria: string; conteudo: string; ativo: number }
interface Gerado { nome: string; html: string; documento: string; faltando: string[]; arquivo: unknown }

export function Modelos() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [dados, setDados] = useState<{ modelos: Modelo[]; variaveis: string[] } | null>(null);
  const [edicao, setEdicao] = useState<Partial<Modelo> | null>(null);
  const [gerando, setGerando] = useState<Modelo | null>(null);
  const [apagar, setApagar] = useState<Modelo | null>(null);
  const carregar = useCallback(async () => { try { setDados(await api.get("/gestao/modelos", { fresh: true } as never)); } catch { show("Não foi possível carregar os modelos.", "error"); } }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const excluir = async () => {
    if (!apagar) return;
    try { await api.delete(`/gestao/modelos/${apagar.id}`); setApagar(null); show("Modelo excluído.", "success"); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível excluir.", "error"); setApagar(null); }
  };
  const grupos = (dados?.modelos ?? []).reduce<Record<string, Modelo[]>>((a, m) => { (a[m.categoria || "Outros"] ||= []).push(m); return a; }, {});
  return (
    <div className="space-y-5">
      <PageHeader title="Modelos livres" description="Para qualquer outro documento que o escritório use (cartas, recibos, requerimentos…). Os dados do cliente e do processo entram sozinhos."
        actions={gerir ? <Button onClick={() => setEdicao({ nome: "", categoria: "", conteudo: "" })}><Plus className="h-4 w-4" /> Novo modelo</Button> : undefined} />
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Procuração, hipossuficiência, contrato, declaração e termo agora ficam no <Link className="font-medium underline" to="/configuracoes/documentos">Kit de documentos</Link> (com logotipo, rodapé, a rogo e representado) e saem pelo botão <b>Gerar documentos</b> do cliente. Os três modelos simples abaixo são do sistema antigo: pode excluí-los se não precisar mais; os que você criar aqui continuam funcionando.</p>
      {dados && dados.modelos.length === 0 ? <EmptyState icon={FileText} title="Nenhum modelo" description="Crie o primeiro modelo de documento." /> : (
        Object.entries(grupos).map(([cat, itens]) => (
          <section key={cat}><h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{cat}</h2>
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {itens.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="flex items-center gap-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><FileText className="h-4 w-4 text-zinc-400" />{m.nome}</span>
                  <span className="flex gap-2"><Button size="sm" onClick={() => setGerando(m)}>Gerar documento</Button>{gerir && <Button size="sm" variant="outline" onClick={() => setEdicao(m)}>Editar</Button>}{gerir && <Button size="sm" variant="ghost" onClick={() => setApagar(m)}>Excluir</Button>}</span>
                </li>))}
            </ul></section>))
      )}
      {edicao && dados && <EditorModelo modelo={edicao} variaveis={dados.variaveis} aoFechar={() => setEdicao(null)} aoSalvar={() => { setEdicao(null); void carregar(); }} />}
      {gerando && <GerarModal modelo={gerando} aoFechar={() => setGerando(null)} />}
      <ConfirmDialog open={Boolean(apagar)} title="Excluir modelo" message={`Excluir o modelo "${apagar?.nome}"?`} confirmLabel="Excluir" onConfirm={() => void excluir()} onCancel={() => setApagar(null)} />
    </div>
  );
}

function EditorModelo({ modelo, variaveis, aoFechar, aoSalvar }: { modelo: Partial<Modelo>; variaveis: string[]; aoFechar: () => void; aoSalvar: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ nome: modelo.nome ?? "", categoria: modelo.categoria ?? "", conteudo: modelo.conteudo ?? "" });
  const [salvando, setSalvando] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const inserir = (v: string) => {
    const el = area.current; const t = `{{${v}}}`;
    if (!el) { setF((x) => ({ ...x, conteudo: x.conteudo + t })); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    setF((x) => ({ ...x, conteudo: x.conteudo.slice(0, a) + t + x.conteudo.slice(b) }));
    setTimeout(() => { el.focus(); el.setSelectionRange(a + t.length, a + t.length); }, 0);
  };
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try { if (modelo.id) await api.put(`/gestao/modelos/${modelo.id}`, f); else await api.post("/gestao/modelos", f); show("Modelo salvo.", "success"); aoSalvar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title={modelo.id ? "Editar modelo" : "Novo modelo"} maxWidth="max-w-3xl"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-modelo" loading={salvando}>Salvar</Button></div>}>
      <form id="form-modelo" onSubmit={salvar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Campo rotulo="Nome *"><Input required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} className="mt-1.5" /></Campo><Campo rotulo="Categoria"><Input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className="mt-1.5" placeholder="Procuração, Contrato…" /></Campo></div>
        <Campo rotulo="Texto do documento *"><Textarea ref={area} required rows={14} value={f.conteudo} onChange={(e) => setF({ ...f, conteudo: e.target.value })} className="mt-1.5 font-mono text-[13px]" /></Campo>
        <p className="text-xs text-zinc-500">Dica: uma linha começando com “# ” vira título centralizado; linha em branco separa parágrafos.</p>
        <div><p className="mb-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">Clique para inserir um dado automático:</p><div className="flex flex-wrap gap-1.5">{variaveis.map((v) => <button key={v} type="button" onClick={() => inserir(v)} className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:border-accent-400 hover:bg-accent-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-accent-950/30">{`{{${v}}}`}</button>)}</div></div>
      </form>
    </Modal>
  );
}

export function GerarModal({ modelo, aoFechar, pessoaInicial, processoInicial }: { modelo: { id: number; nome: string }; aoFechar: () => void; pessoaInicial?: { id: number; nome: string }; processoInicial?: { id: number; rotulo: string } }) {
  const { show } = useToast();
  const { can } = useAuth();
  const [proc, setProc] = useState<{ id: number; rotulo: string } | null>(processoInicial ?? null);
  const [pessoa, setPessoa] = useState<{ id: number; nome: string } | null>(pessoaInicial ?? null);
  const [r, setR] = useState<Gerado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const gerar = async (salvar: boolean) => {
    if (!proc && !pessoa) { show("Escolha o processo ou a pessoa.", "error"); return; }
    setOcupado(true);
    try { const x = await api.post<Gerado>(`/gestao/modelos/${modelo.id}/gerar`, { processo_id: proc?.id, pessoa_id: pessoa?.id, salvar }); setR(x); if (salvar) show("Documento salvo na pasta.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível gerar.", "error"); }
    finally { setOcupado(false); }
  };
  const baixar = () => {
    if (!r) return; const url = URL.createObjectURL(new Blob(["﻿", r.documento], { type: "application/msword" }));
    const a = document.createElement("a"); a.href = url; a.download = `${r.nome}.doc`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const imprimir = () => {
    if (!r) return; const w = window.open("", "_blank"); if (!w) return;
    w.document.write(r.documento); w.document.close(); w.focus(); w.print();
  };
  return (
    <Modal open onClose={aoFechar} title={`Gerar: ${modelo.nome}`} description="Escolha de onde vêm os dados do cliente." maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>{proc ? <p className="text-sm">Processo: <b>{proc.rotulo}</b> <button className="text-xs text-accent-700 underline" onClick={() => { setProc(null); setR(null); }}>trocar</button></p> : <SeletorProcesso aoEscolher={(p) => { setProc({ id: p.id, rotulo: `${p.pasta} · ${p.numero_formatado || p.numero}` }); setR(null); }} rotulo="Processo (usa o autor principal como cliente)" />}</div>
          <div>{pessoa ? <p className="text-sm">Cliente: <b>{pessoa.nome}</b> <button className="text-xs text-accent-700 underline" onClick={() => { setPessoa(null); setR(null); }}>trocar</button></p> : <SeletorPessoa aoEscolher={(p) => { setPessoa({ id: p.id, nome: p.nome }); setR(null); }} rotulo="Ou escolha o cliente diretamente" />}</div>
        </div>
        <Button loading={ocupado} onClick={() => void gerar(false)}>Gerar prévia</Button>
        {r && (
          <>
            {r.faltando.length > 0 && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Faltam dados no cadastro: {r.faltando.map((f) => `{{${f}}}`).join(", ")}. Eles aparecem como “________” para preencher à mão.</p>}
            <div className="max-h-[50vh] overflow-auto rounded-xl border border-zinc-200 bg-white p-6 text-[13px] leading-relaxed text-zinc-900" dangerouslySetInnerHTML={{ __html: r.html }} />
            <div className="flex flex-wrap gap-2">
              <Button onClick={baixar}><Download className="h-4 w-4" /> Baixar (Word)</Button>
              <Button variant="outline" onClick={imprimir}><Printer className="h-4 w-4" /> Imprimir</Button>
              {can("gestao.manage") && <Button variant="outline" loading={ocupado} onClick={() => void gerar(true)}><Save className="h-4 w-4" /> Salvar na pasta</Button>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Botão "Gerar documento": escolhe um modelo e já abre com o cliente/processo desta ficha. */
export function GerarDeModelo({ pessoa, processo }: { pessoa?: { id: number; nome: string }; processo?: { id: number; rotulo: string } }) {
  const { show } = useToast();
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [aberto, setAberto] = useState<Modelo | null>(null);
  useEffect(() => { api.get<{ modelos: Modelo[] }>("/gestao/modelos").then((r) => setModelos(r.modelos.filter((m) => m.ativo))).catch(() => show("Não foi possível carregar os modelos.", "error")); }, [show]);
  if (!modelos || modelos.length === 0) return null;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><FileText className="h-4 w-4 text-zinc-400" /> Gerar documento a partir de um modelo</p>
      <div className="flex flex-wrap gap-2">{modelos.map((m) => <Button key={m.id} size="sm" variant="outline" onClick={() => setAberto(m)}>{m.nome}</Button>)}</div>
      {aberto && <GerarModal modelo={aberto} pessoaInicial={pessoa} processoInicial={processo} aoFechar={() => setAberto(null)} />}
    </div>
  );
}
