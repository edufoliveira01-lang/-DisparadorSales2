import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, FileUp, PenLine, Plus, RotateCcw, Save, Trash2, Wallet } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";

type Variante = "comum" | "rogo" | "representado";
interface CampoValor { id: string; rotulo: string; tipo: "texto" | "numero" | "percentual" | "moeda"; padrao: string }
interface ModeloHon { id: string; nome: string; texto: string }
interface Assinatura { espaco: number; largura: number; alinhamento: "left" | "center" | "right"; posicao: "texto" | "fim" }
const ASSINATURA_INICIAL: Assinatura = { espaco: 12, largura: 90, alinhamento: "left", posicao: "texto" };
interface Resp {
  textos: Record<string, Record<Variante, string>>; personalizados: Record<string, Variante[]>; tamanhos: Record<string, number>; honorarios: { beneficios: number; percentual: number; parcela: number }; assinatura: Assinatura; campos: CampoValor[]; modelos_honorarios: ModeloHon[];
  padroes: Record<string, Record<Variante, string>>; variaveis: string[]; variantes: { id: Variante; nome: string }[]; documentos: { id: string; nome: string; proprio?: boolean }[];
  proprios: { id: string; nome: string; texto: string; pt: number; assinatura: boolean; imagens?: { mime: string; bytes: number }[] }[];
}

const rotuloCls = "mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300";
const abaCls = (ativa: boolean) => `rounded-xl border px-3 py-1.5 text-sm font-medium transition ${ativa ? "border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`;

/** Textos do kit de documentos do escritório (procuração, hipossuficiência, contrato, declaração, termo) em cada tipo. */
export function DocumentosConfig() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [r, setR] = useState<Resp | null>(null);
  const [textos, setTextos] = useState<Resp["textos"]>({});
  const [tamanhos, setTamanhos] = useState<Record<string, number>>({});
  const [hon, setHon] = useState({ beneficios: 3, percentual: 30, parcela: 30 });
  const [campos, setCampos] = useState<CampoValor[]>([]);
  const [modelos, setModelos] = useState<ModeloHon[]>([]);
  const [ass, setAss] = useState<Assinatura>(ASSINATURA_INICIAL);
  const [doc, setDoc] = useState("procuracao");
  const [variante, setVariante] = useState<Variante>("comum");
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [novo, setNovo] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [confirmaRestaurar, setConfirmaRestaurar] = useState(false);
  const carregar = useCallback(async () => {
    try { const x = await api.get<Resp>("/gestao/documentos/config", { fresh: true } as never); setR(x); setTextos(x.textos); setTamanhos(x.tamanhos); setHon(x.honorarios); setAss(x.assinatura ?? ASSINATURA_INICIAL); setCampos(x.campos ?? []); setModelos(x.modelos_honorarios ?? []); }
    catch { show("Não foi possível carregar os modelos de documento.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!r) return <div className="space-y-4" role="status" aria-label="Carregando"><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>;
  const sujo = JSON.stringify(textos) !== JSON.stringify(r.textos) || JSON.stringify(tamanhos) !== JSON.stringify(r.tamanhos) || JSON.stringify(hon) !== JSON.stringify(r.honorarios) || JSON.stringify(ass) !== JSON.stringify(r.assinatura ?? ASSINATURA_INICIAL) || JSON.stringify(campos) !== JSON.stringify(r.campos ?? []) || JSON.stringify(modelos) !== JSON.stringify(r.modelos_honorarios ?? []);
  const salvar = async () => {
    setSalvando(true);
    try { const x = await api.put<Resp>("/gestao/documentos/config", { textos, tamanhos, honorarios: hon, assinatura: ass, campos, modelos_honorarios: modelos }); setR((a) => (a ? { ...a, ...x } : a)); setTextos(x.textos); setTamanhos(x.tamanhos); setHon(x.honorarios); setAss(x.assinatura); setCampos(x.campos); setModelos(x.modelos_honorarios); setVersao((v) => v + 1); show("Modelos salvos.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const restaurar = async () => {
    setConfirmaRestaurar(false);
    try { const x = await api.post<Resp>("/gestao/documentos/config/restaurar", { documento: doc, variante }); setR((a) => (a ? { ...a, ...x } : a)); setTextos(x.textos); setVersao((v) => v + 1); show("Texto restaurado.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível restaurar.", "error"); }
  };
  const atual = textos[doc]?.[variante] ?? "";
  const personalizado = r.personalizados[doc]?.includes(variante);
  const docAtual = r.documentos.find((d) => d.id === doc);
  const nomeVariante = r.variantes.find((v) => v.id === variante)?.nome;
  const escolher = (id: string) => { setNovo(false); setAjustes(false); setDoc(id); };

  return (
    <div className="space-y-5">
      <PageHeader title="Documentos do escritório" description="Procuração, declarações, contrato e termo, nos tipos comum, a rogo e representado. Os textos são do escritório: edite como quiser."
        actions={<div className="flex flex-wrap gap-2"><Link to="/configuracoes/escritorio" className="inline-flex items-center rounded-xl border border-zinc-200 px-3.5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Dados e logotipo do escritório</Link>{gerir && <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar</Button>}</div>} />
      {sujo && gerir && <Callout tone="aviso">Há alterações não salvas nos modelos. Clique em <b>Salvar</b> para a prévia e os documentos usarem o texto novo.</Callout>}
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Documentos do kit" className="surface-panel h-fit space-y-1 p-2 lg:sticky lg:top-4">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Modelos</p>
          <div role="tablist" aria-label="Documento" className="space-y-1">
            {r.documentos.map((d) => {
              const ativo = !novo && !ajustes && doc === d.id;
              const editado = !d.proprio && (r.personalizados[d.id]?.length ?? 0) > 0;
              return <button key={d.id} role="tab" aria-selected={ativo} onClick={() => escolher(d.id)} className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${ativo ? "bg-accent-500/10 text-accent-700 dark:text-accent-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}><span className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0" /><span className="truncate">{d.nome}</span></span>{d.proprio ? <Badge tone="info">Próprio</Badge> : editado ? <Badge tone="accent">Editado</Badge> : null}</button>;
            })}
          </div>
          {gerir && <Button type="button" size="sm" variant={novo ? "primary" : "outline"} className="mt-2 w-full" onClick={() => { setAjustes(false); setNovo(true); }}><Plus className="h-4 w-4" /> Novo documento</Button>}
          <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Do kit inteiro</p>
          <button type="button" aria-pressed={ajustes} onClick={() => { setNovo(false); setAjustes(true); }} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition ${ajustes ? "bg-accent-500/10 text-accent-700 dark:text-accent-300" : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}><PenLine className="h-4 w-4 shrink-0" /> Assinatura e honorários</button>
        </nav>

        <div className="min-w-0 space-y-5">
          {novo && <NovoDocumento aoCriar={async (id) => { setNovo(false); await carregar(); setDoc(id); setVersao((v) => v + 1); }} aoCancelar={() => setNovo(false)} />}
          {!novo && !ajustes && docAtual?.proprio && <EditorProprio key={doc + versao} doc={r.proprios.find((x) => x.id === doc)!} gerir={gerir} aoMudar={async (apagou) => { if (apagou) setDoc("procuracao"); await carregar(); setVersao((v) => v + 1); }} versao={versao} />}
          {!novo && !ajustes && !docAtual?.proprio && (
            <div className="grid gap-5 2xl:grid-cols-2">
              <SettingsPanel className="min-w-0" icon={<FileText />} title={docAtual?.nome ?? "Documento"} description="Escolha o tipo e edite o texto. Cada tipo tem o seu próprio texto."
                status={<Badge tone={personalizado ? "accent" : "neutral"}>{personalizado ? "Editado" : "Padrão do sistema"}</Badge>}
                actions={gerir ? <Button type="button" variant="outline" size="sm" disabled={!personalizado} onClick={() => setConfirmaRestaurar(true)}><RotateCcw className="h-4 w-4" /> Voltar ao padrão</Button> : undefined}>
                <SettingsBlock>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo">
                    {r.variantes.map((v) => <button key={v.id} type="button" onClick={() => setVariante(v.id)} aria-pressed={variante === v.id} className={abaCls(variante === v.id)}>{v.nome}{r.personalizados[doc]?.includes(v.id) ? " ✎" : ""}</button>)}
                  </div>
                  <fieldset disabled={!gerir} className="min-w-0 space-y-3">
                    <label htmlFor="doc-texto" className={rotuloCls}>Texto de «{docAtual?.nome}», tipo {nomeVariante}</label>
                    <Textarea id="doc-texto" rows={22} value={atual} onChange={(e) => setTextos((t) => ({ ...t, [doc]: { ...t[doc], [variante]: e.target.value } }))} className="font-mono text-[13px] leading-relaxed" />
                    <SettingRow label="Tamanho da letra" hint="Em pontos (7 a 18)." htmlFor="doc-pt"><Input id="doc-pt" type="number" min={7} max={18} step={0.5} value={tamanhos[doc] ?? 11} onChange={(e) => setTamanhos((t) => ({ ...t, [doc]: Number(e.target.value) }))} className="w-28" /></SettingRow>
                  </fieldset>
                  <AjudaEscrita variaveis={r.variaveis} />
                </SettingsBlock>
              </SettingsPanel>
              <SettingsPanel className="min-w-0 self-start 2xl:sticky 2xl:top-4" title="Prévia" description={`Com dados de exemplo${sujo ? " (salve para atualizar)" : ""}.`} status={sujo ? <Badge tone="warning">Desatualizada</Badge> : undefined}>
                <div className="p-4"><iframe key={`${doc}-${variante}-${versao}`} title="Prévia do documento" src={`/api/gestao/documentos/previa?doc=${doc}&variante=${variante}&v=${versao}`} className="h-[760px] w-full rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800" /></div>
              </SettingsPanel>
            </div>
          )}
          {!novo && ajustes && (
            <fieldset disabled={!gerir} className="min-w-0 space-y-5">
              <SettingsPanel icon={<PenLine />} title="Linha de assinatura" description="Vale para todos os documentos do kit. A data e a assinatura entram depois do texto.">
                <SettingsBlock>
                  <SettingRow label="Espaço e largura" hint="Em milímetros.">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={rotuloCls}>Espaço acima da linha</label><Input type="number" min={0} max={150} value={ass.espaco} onChange={(e) => setAss({ ...ass, espaco: Number(e.target.value) })} /></div>
                      <div><label className={rotuloCls}>Largura da linha</label><Input type="number" min={40} max={170} value={ass.largura} onChange={(e) => setAss({ ...ass, largura: Number(e.target.value) })} /></div>
                    </div>
                  </SettingRow>
                  <SettingRow label="Alinhamento">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Alinhamento da assinatura">{([["left", "Esquerda"], ["center", "Centro"], ["right", "Direita"]] as const).map(([v, n]) => <button key={v} type="button" aria-pressed={ass.alinhamento === v} onClick={() => setAss({ ...ass, alinhamento: v })} className={abaCls(ass.alinhamento === v)}>{n}</button>)}</div>
                  </SettingRow>
                  <SettingRow label="Posição na folha">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Posição da assinatura">{([["texto", "Logo após o texto"], ["fim", "No fim da folha"]] as const).map(([v, n]) => <button key={v} type="button" aria-pressed={ass.posicao === v} onClick={() => setAss({ ...ass, posicao: v })} className={abaCls(ass.posicao === v)}>{n}</button>)}</div>
                  </SettingRow>
                </SettingsBlock>
              </SettingsPanel>

              <SettingsPanel icon={<Wallet />} title="Honorários do contrato" description="Valores sugeridos ao gerar o contrato; dá para mudar caso a caso.">
                <SettingsBlock title="Padrão">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div><label className={rotuloCls}>Nº de benefícios</label><Input type="number" min={0} value={hon.beneficios} onChange={(e) => setHon({ ...hon, beneficios: Number(e.target.value) })} /></div>
                    <div><label className={rotuloCls}>% das parcelas vencidas</label><Input type="number" min={0} max={100} value={hon.percentual} onChange={(e) => setHon({ ...hon, percentual: Number(e.target.value) })} /></div>
                    <div><label className={rotuloCls}>% do benefício por mês</label><Input type="number" min={0} max={100} value={hon.parcela} onChange={(e) => setHon({ ...hon, parcela: Number(e.target.value) })} /></div>
                  </div>
                </SettingsBlock>
                <SettingsBlock title="Outros valores do contrato" description={<>Entrada, mensalidade, taxa de êxito… No texto, use <code>{"{{campo.nome_do_valor}}"}</code>. Ao gerar, dá para mudar caso a caso.</>}>
                  {campos.length === 0 && <p className="text-sm text-zinc-500">Nenhum valor criado.</p>}
                  {campos.map((c, i) => (
                    <div key={`${c.id}-${i}`} className="grid gap-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1fr_9rem_8rem_auto] sm:items-end dark:border-zinc-700">
                      <div><label className={rotuloCls}>Nome</label><Input value={c.rotulo} onChange={(e) => setCampos(campos.map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)))} placeholder="Ex.: Entrada" /></div>
                      <div><label className={rotuloCls}>Tipo</label><Select value={c.tipo} onChange={(e) => setCampos(campos.map((x, j) => (j === i ? { ...x, tipo: e.target.value as CampoValor["tipo"] } : x)))}><option value="moeda">Valor em R$</option><option value="percentual">Percentual</option><option value="numero">Número</option><option value="texto">Texto</option></Select></div>
                      <div><label className={rotuloCls}>Padrão</label><Input value={c.padrao} onChange={(e) => setCampos(campos.map((x, j) => (j === i ? { ...x, padrao: e.target.value } : x)))} /></div>
                      <Button type="button" variant="ghost" size="sm" aria-label="Remover valor" onClick={() => setCampos(campos.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                      <p className="text-xs text-zinc-500 sm:col-span-4">{c.id ? <>Código no texto: <code>{`{{campo.${c.id}}}`}</code></> : "O código para usar no texto aparece depois de salvar."}</p>
                    </div>
                  ))}
                  {gerir && <Button type="button" variant="outline" size="sm" onClick={() => setCampos([...campos, { id: "", rotulo: "", tipo: "moeda", padrao: "" }])}><Plus className="h-4 w-4" /> Adicionar valor</Button>}
                </SettingsBlock>
                <SettingsBlock title="Modelos de cláusula de honorários" description={<>Uma cláusula para cada área ou forma de cobrança. Ao gerar o contrato, escolha qual usar: ela entra onde o texto tiver <code>{"{{honorarios.clausula}}"}</code>. Aceita <code>{"{{campo.…}}"}</code> e as demais variáveis.</>}>
                  {modelos.length === 0 && <p className="text-sm text-zinc-500">Nenhum modelo criado.</p>}
                  {modelos.map((m, i) => (
                    <div key={m.id + i} className="space-y-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                      <div className="flex items-end gap-2"><div className="flex-1"><label className={rotuloCls}>Nome do modelo</label><Input value={m.nome} onChange={(e) => setModelos(modelos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} placeholder="Ex.: Trabalhista — êxito" /></div><Button type="button" variant="ghost" size="sm" aria-label="Remover modelo" onClick={() => setModelos(modelos.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></div>
                      <Textarea rows={6} aria-label="Texto da cláusula" value={m.texto} onChange={(e) => setModelos(modelos.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} className="font-mono text-[13px] leading-relaxed" />
                    </div>
                  ))}
                  {gerir && <Button type="button" variant="outline" size="sm" onClick={() => setModelos([...modelos, { id: `m_${Math.random().toString(36).slice(2, 8)}`, nome: "", texto: "" }])}><Plus className="h-4 w-4" /> Adicionar modelo</Button>}
                </SettingsBlock>
              </SettingsPanel>
              <p className="text-xs text-zinc-500">As variáveis disponíveis aparecem em «Como escrever» na tela de cada documento.</p>
            </fieldset>
          )}
          {gerir && !novo && !(docAtual?.proprio && !ajustes) && (
            <div className="sticky bottom-3 z-10 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              <SettingsFooter left={sujo ? <span className="font-medium text-amber-700 dark:text-amber-300">Há alterações não salvas.</span> : "Tudo salvo."}>
                <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar alterações</Button>
              </SettingsFooter>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirmaRestaurar} title="Voltar ao padrão?" message="O texto que você escreveu para este documento e tipo será perdido e volta ao padrão do sistema." confirmLabel="Voltar ao padrão" onConfirm={() => void restaurar()} onCancel={() => setConfirmaRestaurar(false)} />
    </div>
  );
}

/** Guia curto de formatação e variáveis, recolhido por padrão. */
function AjudaEscrita({ variaveis }: { variaveis: string[] }) {
  return (
    <details className="rounded-xl border border-zinc-200 p-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
      <summary className="cursor-pointer font-medium">Como escrever (variáveis e formatação)</summary>
      <div className="mt-2 space-y-2">
        <p>Separe os parágrafos com uma linha em branco. <code># Título</code> cria o título centralizado; <code>&gt; texto</code> cria um quadro com borda; <code>**negrito**</code> destaca, <code>*itálico*</code> e <code>++sublinhado++</code> também. Linhas começando com <code>|</code> viram tabela (<code>| Item | Valor |</code>). <code>[[imagem:1]]</code> coloca a figura 1 do documento (a largura em mm pode vir depois: <code>[[imagem:1|60]]</code>).</p>
        <p>Onde houver <code>{"{{variável}}"}</code> entram os dados do cliente e do escritório. Dado que falta sai como <code>________</code> para preencher à mão.</p>
        <p className="break-words font-mono">{variaveis.map((v) => `{{${v}}}`).join("  ")}</p>
        <p>A data, a assinatura (do cliente, a rogo com testemunhas e digital, ou do representante) e as testemunhas do contrato entram sozinhas, conforme o tipo escolhido ao gerar.</p>
      </div>
    </details>
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
  const [importando, setImportando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [imagens, setImagens] = useState<{ mime: string; b64: string }[]>([]);
  const importar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    if (!/\.docx$/i.test(arquivo.name)) return void show("Envie um documento do Word (.docx).", "error");
    setImportando(true);
    try {
      const x = await api.upload<{ nome: string; texto: string; avisos: string[]; imagens: { mime: string; b64: string }[] }>("/gestao/documentos/proprios/importar", arquivo);
      setTexto(x.texto); setAvisos(x.avisos); setImagens(x.imagens ?? []);
      if (!nome.trim()) setNome(x.nome);
      show("Modelo importado. Confira o texto e as variáveis antes de criar.", "success");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível importar o arquivo.", "error"); }
    finally { setImportando(false); }
  };
  const criar = async () => {
    setSalvando(true);
    try { const x = await api.post<{ documento: { id: string } }>("/gestao/documentos/proprios", { nome, texto, assinatura, imagens }); show("Documento criado. Ele já aparece em Gerar documentos.", "success"); await aoCriar(x.documento.id); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível criar o documento.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <div className="space-y-4 rounded-2xl border border-accent-300 bg-white p-5 dark:border-accent-700 dark:bg-zinc-900">
      <div><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Novo documento do escritório</h2><p className="mt-1 text-sm text-zinc-500">Ele sai com o cabeçalho, o rodapé e as assinaturas do escritório, igual aos demais, e aparece no botão Gerar documentos do cliente.</p></div>
      <Campo rotulo="Nome do documento"><Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1.5" placeholder="Ex.: Termo de renúncia" autoFocus /></Campo>
      <div className="rounded-xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-accent-700 dark:text-accent-300">
          <FileUp className="h-4 w-4" /> {importando ? "Lendo o arquivo…" : "Importar de um arquivo do Word (.docx)"}
          <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" disabled={importando} onChange={(e) => { void importar(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        <p className="mt-1 text-[13px] text-zinc-500">Envie o seu modelo pronto: o texto, os títulos, o negrito, o itálico, as tabelas e as figuras vêm para cá, e campos como [NOME], [CPF] ou {"{{ENDEREÇO}}"} viram os dados do cliente. O cabeçalho, o rodapé e a assinatura continuam os do escritório.</p>
        {imagens.length > 0 && <p className="mt-2 text-[13px] text-zinc-600 dark:text-zinc-300">{imagens.length} figura(s) vão junto com o documento: <code>{imagens.map((_, i) => `[[imagem:${i + 1}]]`).join(" ")}</code> no texto marca onde cada uma aparece.</p>}
        {avisos.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-amber-700 dark:text-amber-300">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
      </div>
      <Campo rotulo="Texto"><Textarea rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} className="mt-1.5 font-mono text-[14px] leading-relaxed" /></Campo>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={assinatura} onChange={(e) => setAssinatura(e.target.checked)} /> Incluir data e assinatura (do cliente, a rogo ou do representante, conforme o tipo escolhido ao gerar)</label>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={aoCancelar}>Cancelar</Button><Button loading={salvando} onClick={() => void criar()}><Plus className="h-4 w-4" /> Criar documento</Button></div>
    </div>
  );
}

/** Edita ou exclui um documento próprio. */
function EditorProprio({ doc, gerir, aoMudar, versao }: { doc: { id: string; nome: string; texto: string; pt: number; assinatura: boolean; imagens?: { mime: string; bytes: number }[] }; gerir: boolean; aoMudar: (apagou?: boolean) => Promise<void>; versao: number }) {
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
        {(doc.imagens?.length ?? 0) > 0 && <p className="text-[13px] text-zinc-600 dark:text-zinc-300">Figuras deste documento: <code>{doc.imagens!.map((_, i) => `[[imagem:${i + 1}]]`).join(" ")}</code>. A linha com o código marca onde a figura aparece; apague a linha para tirá-la do texto.</p>}
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
