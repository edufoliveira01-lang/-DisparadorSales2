import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Campo } from "./comum";

type Variante = "comum" | "rogo" | "representado";
interface Resp {
  textos: Record<string, Record<Variante, string>>; personalizados: Record<string, Variante[]>; tamanhos: Record<string, number>; honorarios: { beneficios: number; percentual: number; parcela: number };
  padroes: Record<string, Record<Variante, string>>; variaveis: string[]; variantes: { id: Variante; nome: string }[]; documentos: { id: string; nome: string; proprio?: boolean }[];
  proprios: { id: string; nome: string; texto: string; pt: number; assinatura: boolean }[];
}

/** Textos do kit de documentos do escritório (procuração, hipossuficiência, contrato, declaração, termo) em cada tipo. */
export function DocumentosConfig() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [r, setR] = useState<Resp | null>(null);
  const [textos, setTextos] = useState<Resp["textos"]>({});
  const [tamanhos, setTamanhos] = useState<Record<string, number>>({});
  const [hon, setHon] = useState({ beneficios: 3, percentual: 30, parcela: 30 });
  const [doc, setDoc] = useState("procuracao");
  const [variante, setVariante] = useState<Variante>("comum");
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [novo, setNovo] = useState(false);
  const carregar = useCallback(async () => {
    try { const x = await api.get<Resp>("/gestao/documentos/config", { fresh: true } as never); setR(x); setTextos(x.textos); setTamanhos(x.tamanhos); setHon(x.honorarios); }
    catch { show("Não foi possível carregar os modelos de documento.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!r) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const sujo = JSON.stringify(textos) !== JSON.stringify(r.textos) || JSON.stringify(tamanhos) !== JSON.stringify(r.tamanhos) || JSON.stringify(hon) !== JSON.stringify(r.honorarios);
  const salvar = async () => {
    setSalvando(true);
    try { const x = await api.put<Resp>("/gestao/documentos/config", { textos, tamanhos, honorarios: hon }); setR((a) => (a ? { ...a, ...x } : a)); setTextos(x.textos); setTamanhos(x.tamanhos); setHon(x.honorarios); setVersao((v) => v + 1); show("Modelos salvos.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const restaurar = async () => {
    if (!window.confirm("Voltar este texto ao padrão do sistema? O texto que você escreveu será perdido.")) return;
    try { const x = await api.post<Resp>("/gestao/documentos/config/restaurar", { documento: doc, variante }); setR((a) => (a ? { ...a, ...x } : a)); setTextos(x.textos); setVersao((v) => v + 1); show("Texto restaurado.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível restaurar.", "error"); }
  };
  const atual = textos[doc]?.[variante] ?? "";
  const personalizado = r.personalizados[doc]?.includes(variante);
  const docAtual = r.documentos.find((d) => d.id === doc);

  return (
    <div className="space-y-5">
      <PageHeader title="Documentos do escritório" description="Procuração, declarações, contrato e termo, nos tipos comum, a rogo e representado. Os textos são do escritório: edite como quiser."
        actions={<div className="flex flex-wrap gap-2"><Link to="/configuracoes/escritorio" className="inline-flex items-center rounded-xl border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200">Dados e logotipo do escritório</Link>{gerir && <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar</Button>}</div>} />
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800">
        <div role="tablist" aria-label="Documento" className="flex min-w-0 gap-1 overflow-x-auto">
          {r.documentos.map((d) => <button key={d.id} role="tab" aria-selected={!novo && doc === d.id} onClick={() => { setNovo(false); setDoc(d.id); }} className={`whitespace-nowrap border-b-2 px-4 py-3 text-[15px] font-medium transition ${!novo && doc === d.id ? "border-accent-500 text-accent-700 dark:text-accent-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{d.nome}</button>)}
        </div>
        {gerir && <Button type="button" size="sm" variant={novo ? "primary" : "outline"} className="mb-1.5" onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo documento</Button>}
      </div>
      {novo && <NovoDocumento aoCriar={async (id) => { setNovo(false); await carregar(); setDoc(id); setVersao((v) => v + 1); }} aoCancelar={() => setNovo(false)} />}
      {!novo && docAtual?.proprio && <EditorProprio key={doc + versao} doc={r.proprios.find((x) => x.id === doc)!} gerir={gerir} aoMudar={async (apagou) => { if (apagou) setDoc("procuracao"); await carregar(); setVersao((v) => v + 1); }} versao={versao} />}
      {!novo && !docAtual?.proprio && <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo">
            {r.variantes.map((v) => <button key={v.id} type="button" onClick={() => setVariante(v.id)} aria-pressed={variante === v.id} className={`rounded-xl border px-3 py-1.5 text-sm ${variante === v.id ? "border-accent-500 bg-accent-500/10 font-semibold" : "border-zinc-200 dark:border-zinc-700"}`}>{v.nome}{r.personalizados[doc]?.includes(v.id) ? " ✎" : ""}</button>)}
          </div>
          <fieldset disabled={!gerir} className="space-y-3">
            <Campo rotulo={`Texto de “${docAtual?.nome}” — ${r.variantes.find((v) => v.id === variante)?.nome}`}>
              <Textarea rows={24} value={atual} onChange={(e) => setTextos((t) => ({ ...t, [doc]: { ...t[doc], [variante]: e.target.value } }))} className="mt-1.5 font-mono text-[14px] leading-relaxed" />
            </Campo>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Campo rotulo="Tamanho da letra (pt)"><Input type="number" min={7} max={18} step={0.5} value={tamanhos[doc] ?? 11} onChange={(e) => setTamanhos((t) => ({ ...t, [doc]: Number(e.target.value) }))} className="mt-1.5 w-28" /></Campo>
              {gerir && <Button type="button" variant="outline" size="sm" disabled={!personalizado} onClick={() => void restaurar()}><RotateCcw className="h-4 w-4" /> Voltar ao padrão</Button>}
            </div>
          </fieldset>
          <details className="rounded-xl border border-zinc-200 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
            <summary className="cursor-pointer font-medium">Como escrever (variáveis e formatação)</summary>
            <div className="mt-2 space-y-2">
              <p>Separe os parágrafos com uma linha em branco. <code># Título</code> cria o título centralizado; <code>&gt; texto</code> cria um quadro com borda; <code>**negrito**</code> destaca.</p>
              <p>Onde houver <code>{"{{variável}}"}</code> entram os dados do cliente e do escritório. Dado que falta sai como <code>________</code> para preencher à mão.</p>
              <p className="break-words font-mono">{r.variaveis.map((v) => `{{${v}}}`).join("  ")}</p>
              <p>A data, a assinatura (do cliente, a rogo com testemunhas e digital, ou do representante) e as testemunhas do contrato entram sozinhas, conforme o tipo escolhido ao gerar.</p>
            </div>
          </details>
          <fieldset disabled={!gerir} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold">Honorários padrão do contrato</h2>
            <div className="grid grid-cols-3 gap-3">
              <Campo rotulo="Nº de benefícios"><Input type="number" min={0} value={hon.beneficios} onChange={(e) => setHon({ ...hon, beneficios: Number(e.target.value) })} className="mt-1.5" /></Campo>
              <Campo rotulo="% das parcelas vencidas"><Input type="number" min={0} max={100} value={hon.percentual} onChange={(e) => setHon({ ...hon, percentual: Number(e.target.value) })} className="mt-1.5" /></Campo>
              <Campo rotulo="% do benefício por mês"><Input type="number" min={0} max={100} value={hon.parcela} onChange={(e) => setHon({ ...hon, parcela: Number(e.target.value) })} className="mt-1.5" /></Campo>
            </div>
            <p className="text-[13px] text-zinc-500">Valores sugeridos ao gerar; dá para mudar caso a caso.</p>
          </fieldset>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-xs text-zinc-500">Prévia com dados de exemplo{sujo ? " (salve para atualizar)" : ""}.</p>
          <iframe key={`${doc}-${variante}-${versao}`} title="Prévia do documento" src={`/api/gestao/documentos/previa?doc=${doc}&variante=${variante}&v=${versao}`} className="h-[760px] w-full rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800" />
        </div>
      </div>}
    </div>
  );
}

const MODELO_INICIAL = `# TÍTULO DO DOCUMENTO

{{outorgante.qualificacao}}, declara que ...

Escreva o texto como quiser. Onde estiver {{cliente.nome}}, {{escritorio.nome}}, {{processo.numero}}… entram os dados sozinhos.`;

/** Cria um documento próprio do escritório, que passa a fazer parte do kit. */
function NovoDocumento({ aoCriar, aoCancelar }: { aoCriar: (id: string) => Promise<void>; aoCancelar: () => void }) {
  const { show } = useToast();
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState(MODELO_INICIAL);
  const [assinatura, setAssinatura] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    setSalvando(true);
    try { const x = await api.post<{ documento: { id: string } }>("/gestao/documentos/proprios", { nome, texto, assinatura }); show("Documento criado. Ele já aparece em Gerar documentos.", "success"); await aoCriar(x.documento.id); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível criar o documento.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <div className="space-y-4 rounded-2xl border border-accent-300 bg-white p-5 dark:border-accent-700 dark:bg-zinc-900">
      <div><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Novo documento do escritório</h2><p className="mt-1 text-sm text-zinc-500">Ele sai com o cabeçalho, o rodapé e as assinaturas do escritório, igual aos demais, e aparece no botão Gerar documentos do cliente.</p></div>
      <Campo rotulo="Nome do documento"><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1.5" placeholder="Ex.: Termo de renúncia" autoFocus /></Campo>
      <Campo rotulo="Texto"><Textarea rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} className="mt-1.5 font-mono text-[14px] leading-relaxed" /></Campo>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={assinatura} onChange={(e) => setAssinatura(e.target.checked)} /> Incluir data e assinatura (do cliente, a rogo ou do representante, conforme o tipo escolhido ao gerar)</label>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={aoCancelar}>Cancelar</Button><Button loading={salvando} onClick={() => void criar()}><Plus className="h-4 w-4" /> Criar documento</Button></div>
    </div>
  );
}

/** Edita ou exclui um documento próprio. */
function EditorProprio({ doc, gerir, aoMudar, versao }: { doc: { id: string; nome: string; texto: string; pt: number; assinatura: boolean }; gerir: boolean; aoMudar: (apagou?: boolean) => Promise<void>; versao: number }) {
  const { show } = useToast();
  const [nome, setNome] = useState(doc.nome);
  const [texto, setTexto] = useState(doc.texto);
  const [pt, setPt] = useState(doc.pt);
  const [assinatura, setAssinatura] = useState(doc.assinatura);
  const [salvando, setSalvando] = useState(false);
  const sujo = nome !== doc.nome || texto !== doc.texto || pt !== doc.pt || assinatura !== doc.assinatura;
  const salvar = async () => {
    setSalvando(true);
    try { await api.put(`/gestao/documentos/proprios/${doc.id}`, { nome, texto, pt, assinatura }); show("Documento salvo.", "success"); await aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const excluir = async () => {
    if (!window.confirm(`Excluir o documento "${doc.nome}"? Esta ação não pode ser desfeita.`)) return;
    try { await api.delete(`/gestao/documentos/proprios/${doc.id}`); show("Documento excluído.", "success"); await aoMudar(true); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível excluir.", "error"); }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <fieldset disabled={!gerir} className="space-y-4">
        <Campo rotulo="Nome do documento"><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Texto"><Textarea rows={24} value={texto} onChange={(e) => setTexto(e.target.value)} className="mt-1.5 font-mono text-[14px] leading-relaxed" /></Campo>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Campo rotulo="Tamanho da letra (pt)"><Input type="number" min={7} max={18} step={0.5} value={pt} onChange={(e) => setPt(Number(e.target.value))} className="mt-1.5 w-28" /></Campo>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={assinatura} onChange={(e) => setAssinatura(e.target.checked)} /> Incluir data e assinatura</label>
        </div>
        {gerir && <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="ghost" onClick={() => void excluir()}><Trash2 className="h-4 w-4" /> Excluir documento</Button><Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar documento</Button></div>}
      </fieldset>
      <div className="min-w-0">
        <p className="mb-2 text-sm text-zinc-500">Prévia com dados de exemplo{sujo ? " (salve para atualizar)" : ""}.</p>
        <iframe key={`${doc.id}-${versao}`} title="Prévia do documento" src={`/api/gestao/documentos/previa?doc=${doc.id}&variante=comum&v=${versao}`} className="h-[820px] w-full rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800" />
      </div>
    </div>
  );
}
