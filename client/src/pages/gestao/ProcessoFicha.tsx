import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, Scale, CalendarClock, StickyNote, FolderOpen, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Arquivos } from "./Arquivos";
import { CamposPersonalizados, type CampoValor } from "./Campos";
import { GerarDeModelo } from "./Modelos";
import { GerarDocumentos } from "./GerarDocumentos";
import { TarefaModal, type Tarefa } from "./TarefaModal";
import { AREAS, Campo, PAPEIS, SeletorPessoa, STATUS, STATUS_TOM, TIPOS, dataBr, dinheiro } from "./comum";
import type { Responsavel } from "./Processos";

interface Parte { papel: string; principal: number; pessoa_id: number; nome: string; documento: string; telefone: string; email: string; tipo: string }
interface Ficha {
  id: number; numero: string; numero_formatado: string; pasta: string; titulo: string; tribunal: string; orgao: string; comarca: string; classe: string; assunto: string; area: string;
  valor_causa_centavos: number | null; fase: string; status: string; responsavel_user_id: number | null; responsavel: string | null; data_distribuicao: string; observacoes: string;
  djen_chave: string | null; criado_em: string; partes: Parte[]; campos?: CampoValor[];
}
interface Evento { tipo: "publicacao" | "pericia" | "anotacao" | "cadastro"; data: string; titulo: string; detalhe: string; ref?: number; autor?: string }
const ABAS = [["resumo", "Resumo"], ["partes", "Partes"], ["andamento", "Andamento e perícias"], ["historico", "Histórico e anotações"], ["tarefas", "Tarefas"], ["arquivos", "Arquivos"]] as const;
type Aba = typeof ABAS[number][0];

export function ProcessoFicha() {
  const { id } = useParams();
  const { can } = useAuth();
  const { show } = useToast();
  const navegar = useNavigate();
  const gerir = can("gestao.manage");
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>("resumo");
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [apagar, setApagar] = useState(false);
  const [docs, setDocs] = useState(false);

  const carregar = useCallback(async () => {
    try { setFicha(await api.get<Ficha>(`/gestao/processos/${id}`)); setErro(""); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível abrir o processo."); }
  }, [id]);
  useEffect(() => { void carregar(); api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, [carregar]);

  if (erro) return <div className="space-y-4"><Link to="/gestao/processos" className="inline-flex items-center gap-1 text-sm text-accent-700"><ArrowLeft className="h-4 w-4" /> Voltar</Link><p className="text-sm text-red-600">{erro}</p></div>;
  if (!ficha) return <p className="text-sm text-zinc-500" role="status">Abrindo o processo…</p>;

  const excluir = async () => {
    try { await api.delete(`/gestao/processos/${ficha.id}`); show("Processo excluído.", "success"); navegar("/gestao/processos"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível excluir.", "error"); setApagar(false); }
  };

  return (
    <div className="space-y-5">
      <Link to="/gestao/processos" className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline dark:text-accent-300"><ArrowLeft className="h-4 w-4" /> Clientes e processos</Link>
      <PageHeader title={ficha.numero_formatado || ficha.numero} description={<span className="flex flex-wrap items-center gap-2"><Badge tone="accent"><FolderOpen className="mr-1 h-3 w-3" />Pasta {ficha.pasta}</Badge><Badge tone={STATUS_TOM[ficha.status] || "neutral"}>{STATUS[ficha.status] || ficha.status}</Badge>{ficha.tribunal && <Badge>{ficha.tribunal}</Badge>}<span>{ficha.titulo || ficha.classe}</span></span>}
        actions={gerir ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setDocs(true)}>Gerar documentos</Button><Button variant="ghost" onClick={() => setApagar(true)}><Trash2 className="h-4 w-4" /> Excluir</Button></div> : undefined} />
      <GerarDocumentos aberto={docs} aoFechar={() => setDocs(false)} processo={{ id: ficha.id, rotulo: `${ficha.pasta} · ${ficha.numero_formatado || ficha.numero}` }} />
      {(() => { const c = ficha.partes.find((p) => p.papel === "autor") ?? ficha.partes[0]; return c ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Cliente</span>
          <Link to={`/gestao/clientes/${c.pessoa_id}`} className="font-semibold text-accent-700 hover:underline dark:text-accent-300">{c.nome}</Link>
          {c.telefone && <span className="text-zinc-600 dark:text-zinc-300">{c.telefone}</span>}{c.email && <span className="text-zinc-600 dark:text-zinc-300">{c.email}</span>}
          <Link to={`/gestao/clientes/${c.pessoa_id}?aba=financeiro`} className="ml-auto text-xs text-accent-700 underline">Financeiro do cliente</Link>
        </div>) : null; })()}
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        {ABAS.map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${aba === k ? "border-accent-600 text-accent-700 dark:text-accent-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{r}</button>)}
      </div>
      {aba === "resumo" && <Resumo ficha={ficha} resp={resp} gerir={gerir} aoSalvar={carregar} />}
      {aba === "partes" && <Partes ficha={ficha} gerir={gerir} aoMudar={carregar} />}
      {aba === "andamento" && <Andamento id={ficha.id} />}
      {aba === "historico" && <Historico ficha={ficha} gerir={gerir} />}
      {aba === "tarefas" && <TarefasDoProcesso ficha={ficha} gerir={gerir} resp={resp} />}
      {aba === "arquivos" && <div className="space-y-4"><GerarDeModelo processo={{ id: ficha.id, rotulo: `${ficha.pasta} · ${ficha.numero_formatado || ficha.numero}` }} /><Arquivos escopo="processos" id={ficha.id} /></div>}
      <ConfirmDialog open={apagar} title="Excluir processo" message="Excluir a ficha, as partes e as anotações deste processo? As publicações do DJEN e as perícias não são apagadas. Esta ação não pode ser desfeita." confirmLabel="Excluir" onConfirm={() => void excluir()} onCancel={() => setApagar(false)} />
    </div>
  );
}

function Resumo({ ficha, resp, gerir, aoSalvar }: { ficha: Ficha; resp: Responsavel[]; gerir: boolean; aoSalvar: () => Promise<void> }) {
  const { show } = useToast();
  const [f, setF] = useState({
    titulo: ficha.titulo, tribunal: ficha.tribunal, orgao: ficha.orgao, comarca: ficha.comarca, classe: ficha.classe, assunto: ficha.assunto, area: ficha.area, fase: ficha.fase, status: ficha.status,
    responsavel_user_id: ficha.responsavel_user_id ? String(ficha.responsavel_user_id) : "", data_distribuicao: ficha.data_distribuicao,
    valor_causa: ficha.valor_causa_centavos == null ? "" : (ficha.valor_causa_centavos / 100).toFixed(2).replace(".", ","), observacoes: ficha.observacoes,
  });
  const [salvando, setSalvando] = useState(false);
  const [valores, setValores] = useState<Record<number, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try { await api.put(`/gestao/processos/${ficha.id}`, { ...f, responsavel_user_id: f.responsavel_user_id || null, campos: valores }); setValores({}); show("Ficha salva.", "success"); await aoSalvar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <form onSubmit={salvar} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <fieldset disabled={!gerir} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Campo rotulo="Título / assunto interno" className="sm:col-span-2 lg:col-span-3"><Input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Situação"><Select value={f.status} onChange={(e) => set("status", e.target.value)} className="mt-1.5">{Object.entries(STATUS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
        <Campo rotulo="Responsável"><Select value={f.responsavel_user_id} onChange={(e) => set("responsavel_user_id", e.target.value)} className="mt-1.5"><option value="">Sem responsável</option>{resp.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></Campo>
        <Campo rotulo="Área"><Select value={f.area} onChange={(e) => set("area", e.target.value)} className="mt-1.5"><option value="">—</option>{Object.entries(AREAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
        <Campo rotulo="Tribunal"><Input value={f.tribunal} onChange={(e) => set("tribunal", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Vara / órgão"><Input value={f.orgao} onChange={(e) => set("orgao", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Comarca"><Input value={f.comarca} onChange={(e) => set("comarca", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Classe"><Input value={f.classe} onChange={(e) => set("classe", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Assunto"><Input value={f.assunto} onChange={(e) => set("assunto", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Fase atual"><Input value={f.fase} onChange={(e) => set("fase", e.target.value)} className="mt-1.5" placeholder="Conhecimento, recurso, execução…" /></Campo>
        <Campo rotulo="Distribuição"><Input type="date" value={f.data_distribuicao} onChange={(e) => set("data_distribuicao", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Valor da causa (R$)"><Input inputMode="decimal" value={f.valor_causa} onChange={(e) => set("valor_causa", e.target.value)} className="mt-1.5" /></Campo>
        <Campo rotulo="Observações" className="sm:col-span-2 lg:col-span-3"><Textarea rows={4} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
      </fieldset>
      {ficha.campos && <CamposPersonalizados campos={ficha.campos} valores={valores} aoMudar={(cid, v) => setValores((x) => ({ ...x, [cid]: v }))} entidade="processo" entidadeId={ficha.id} aoAtualizarDefinicoes={() => void aoSalvar()} somenteLeitura={!gerir} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">Valor da causa: {dinheiro(ficha.valor_causa_centavos)} · Cadastrado em {dataBr(ficha.criado_em)}{ficha.djen_chave ? " · Acompanhado pelo DJEN" : ""}</p>
        {gerir && <Button type="submit" loading={salvando}>Salvar alterações</Button>}
      </div>
    </form>
  );
}

function Partes({ ficha, gerir, aoMudar }: { ficha: Ficha; gerir: boolean; aoMudar: () => Promise<void> }) {
  const { show } = useToast();
  const [papel, setPapel] = useState("autor");
  const adicionar = async (pessoaId: number) => {
    try { await api.post(`/gestao/processos/${ficha.id}/partes`, { pessoa_id: pessoaId, papel, principal: !ficha.partes.some((p) => p.papel === papel) }); await aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível adicionar.", "error"); }
  };
  const remover = async (p: Parte) => {
    try { await api.delete(`/gestao/processos/${ficha.id}/partes/${p.pessoa_id}/${p.papel}`); await aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível remover.", "error"); }
  };
  return (
    <div className="space-y-4">
      {gerir && (
        <div className="grid gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-[200px_1fr]">
          <Campo rotulo="Papel no processo"><Select value={papel} onChange={(e) => setPapel(e.target.value)} className="mt-1.5">{Object.entries(PAPEIS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
          <SeletorPessoa rotulo="Adicionar pessoa cadastrada" aoEscolher={(p) => void adicionar(p.id)} />
          <p className="text-xs text-zinc-500 sm:col-span-2">Não encontrou? <Link className="text-accent-700 underline" to="/gestao/clientes/novo">Cadastre a pessoa</Link> e volte aqui.</p>
        </div>
      )}
      {ficha.partes.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhuma parte vinculada a este processo.</p> : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {ficha.partes.map((p) => (
            <li key={`${p.pessoa_id}-${p.papel}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Link className="hover:underline" to={`/gestao/clientes/${p.pessoa_id}`}>{p.nome}</Link>{p.principal ? <span className="ml-2 text-xs font-normal text-accent-600">principal</span> : null}</p><p className="truncate text-xs text-zinc-500">{PAPEIS[p.papel] || p.papel} · {TIPOS[p.tipo] || p.tipo}{p.telefone ? ` · ${p.telefone}` : ""}{p.email ? ` · ${p.email}` : ""}</p></div>
              {gerir && <button type="button" aria-label={`Remover ${p.nome}`} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" onClick={() => void remover(p)}><X className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ICONE = { publicacao: Scale, pericia: CalendarClock, anotacao: StickyNote, cadastro: FolderOpen } as const;
function Historico({ ficha, gerir }: { ficha: Ficha; gerir: boolean }) {
  const { show } = useToast();
  const { user } = useAuth();
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [filtro, setFiltro] = useState("");
  const carregar = useCallback(async () => { try { setEventos(await api.get<Evento[]>(`/gestao/processos/${ficha.id}/linha-do-tempo`)); } catch { show("Não foi possível carregar o histórico.", "error"); } }, [ficha.id, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const anotar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try { await api.post(`/gestao/processos/${ficha.id}/anotacoes`, { texto }); setTexto(""); await carregar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível anotar.", "error"); }
    finally { setSalvando(false); }
  };
  const apagar = async (ev: Evento) => {
    try { await api.delete(`/gestao/processos/${ficha.id}/anotacoes/${ev.ref}`); await carregar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível apagar.", "error"); }
  };
  const lista = (eventos ?? []).filter((e) => !filtro || e.tipo === filtro);
  return (
    <div className="space-y-4">
      {gerir && (
        <form onSubmit={anotar} className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <Campo rotulo="Nova anotação"><Textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} className="mt-1.5" placeholder="Ligação com o cliente, combinado com o perito, lembrete interno…" /></Campo>
          <div className="flex justify-end"><Button type="submit" loading={salvando} disabled={texto.trim().length < 2}>Anotar</Button></div>
        </form>
      )}
      <div className="flex gap-2 text-xs">
        {[["", "Tudo"], ["publicacao", "Publicações"], ["pericia", "Perícias"], ["anotacao", "Anotações"]].map(([v, r]) => <button key={v} onClick={() => setFiltro(v)} aria-pressed={filtro === v} className={`rounded-full border px-3 py-1.5 transition ${filtro === v ? "border-accent-500 bg-accent-50 text-accent-800 dark:bg-accent-900/40 dark:text-accent-200" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>{r}</button>)}
      </div>
      {eventos === null ? <p className="text-sm text-zinc-500">Carregando…</p> : lista.length === 0 ? <p className="text-sm text-zinc-500">Nada por aqui ainda.</p> : (
        <ol className="space-y-3">
          {lista.map((ev, i) => { const I = ICONE[ev.tipo]; return (
            <li key={`${ev.tipo}-${ev.ref ?? i}`} className="flex gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-50 text-accent-600 dark:bg-accent-900/30"><I className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{ev.titulo}</p><span className="text-xs text-zinc-400">{dataBr(ev.data)}{ev.autor ? ` · ${ev.autor}` : ""}</span></div>
                {ev.detalhe && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-600 dark:text-zinc-300">{ev.detalhe}</p>}
                {ev.tipo === "anotacao" && gerir && (user.role === "administrador" || ev.autor === (user.display_name || user.username)) && <button type="button" onClick={() => void apagar(ev)} className="mt-1 text-xs text-zinc-400 hover:text-red-600">Apagar anotação</button>}
              </div>
            </li>); })}
        </ol>
      )}
    </div>
  );
}

function TarefasDoProcesso({ ficha, gerir, resp }: { ficha: Ficha; gerir: boolean; resp: Responsavel[] }) {
  const { show } = useToast();
  const { user } = useAuth();
  const [itens, setItens] = useState<Tarefa[] | null>(null);
  const [edicao, setEdicao] = useState<Tarefa | "nova" | null>(null);
  const carregar = useCallback(async () => { try { setItens((await api.get<{ itens: Tarefa[] }>(`/gestao/tarefas?processo=${ficha.id}&status=&limite=100`)).itens); } catch { show("Não foi possível carregar as tarefas.", "error"); } }, [ficha.id, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const concluir = async (t: Tarefa) => { try { await api.post(`/gestao/tarefas/${t.id}/concluir`, { concluida: t.aberta }); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível atualizar.", "error"); } };
  return (
    <div className="space-y-4">
      {gerir && <div className="flex justify-end"><Button onClick={() => setEdicao("nova")}>Nova tarefa neste processo</Button></div>}
      {itens === null ? <p className="text-sm text-zinc-500">Carregando…</p> : itens.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhuma tarefa neste processo.</p> : (
        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {itens.map((t) => (
            <li key={t.id} className="flex items-start gap-3 px-4 py-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-violet-600" checked={!t.aberta} disabled={!gerir || t.status === "cancelada"} onChange={() => void concluir(t)} aria-label={t.aberta ? `Concluir ${t.titulo}` : `Reabrir ${t.titulo}`} />
              <button type="button" onClick={() => setEdicao(t)} className="min-w-0 flex-1 text-left"><span className={`block text-sm font-semibold ${t.aberta ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through"}`}>{t.titulo}</span>
                <span className="text-xs text-zinc-500"><span className={t.atrasada ? "font-semibold text-red-600" : ""}>{t.prazo ? `${t.atrasada ? "Atrasada · " : "Prazo "}${dataBr(t.prazo)}` : "Sem prazo"}</span> · {t.responsavel || "Sem responsável"}{t.prazo_fatal && t.aberta ? " · FATAL" : ""}{t.origem === "djen" ? " · DJEN" : ""}</span></button>
            </li>
          ))}
        </ul>
      )}
      {edicao && <TarefaModal tarefa={edicao === "nova" ? null : edicao} processoFixo={{ id: ficha.id, rotulo: `${ficha.pasta} · ${ficha.numero_formatado || ficha.numero}` }} responsaveis={resp} meuId={user.id} aoFechar={() => setEdicao(null)} aoSalvar={() => { setEdicao(null); void carregar(); }} />}
    </div>
  );
}

interface Andam {
  monitorado: boolean; quadro: { lista: string; modo: string; etapa_evidencia: string | null; entrou_em: string } | null; publicacoes_nao_lidas: number;
  ultimas_publicacoes: { id: number; data_disponibilizacao: string; tipo_documento: string | null; orgao: string; lida: number; resumo: string }[];
  prazos_abertos: { id: number; descricao: string; termino: string | null }[];
  pericias: { id: number; tipo: string; data: string; horario: string | null; local: string | null; profissional_perito: string | null; passada: boolean }[];
}
/** O que o DJEN e a agenda de perícias sabem deste processo: etapa no quadro, publicações, prazos e perícias. */
function Andamento({ id }: { id: number }) {
  const { show } = useToast();
  const [d, setD] = useState<Andam | null>(null);
  useEffect(() => { api.get<Andam>(`/gestao/processos/${id}/andamento`).then(setD).catch(() => show("Não foi possível carregar o andamento.", "error")); }, [id, show]);
  if (!d) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const Cartao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{titulo}</h3>{children}</section>;
  return (
    <div className="space-y-4">
      {!d.monitorado && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Este processo ainda não é acompanhado pelo DJEN. Cadastre o advogado em <Link className="underline" to="/processos/advogados">Processos e DJEN</Link> para as publicações aparecerem aqui.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Cartao titulo="Etapa no quadro de processos">
          {d.quadro ? <><p className="text-base font-semibold text-accent-700 dark:text-accent-300">{d.quadro.lista}</p><p className="mt-1 text-xs text-zinc-500">{d.quadro.modo === "manual" ? "Colocado manualmente" : "Classificado automaticamente"} · desde {dataBr(d.quadro.entrou_em)}</p>{d.quadro.etapa_evidencia && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{d.quadro.etapa_evidencia}</p>}<Link to="/processos/quadro" className="mt-2 inline-block text-xs text-accent-700 underline">Abrir o quadro</Link></> : <p className="text-sm text-zinc-500">Sem etapa no quadro.</p>}
        </Cartao>
        <Cartao titulo={`Perícias e audiências (${d.pericias.length})`}>
          {d.pericias.length === 0 ? <p className="text-sm text-zinc-500">Nenhuma perícia ou audiência agendada.</p> : <ul className="space-y-2">{d.pericias.map((p) => <li key={p.id} className="text-sm"><span className="font-medium text-zinc-900 dark:text-zinc-100">{p.tipo}</span> {!p.passada && <Badge tone="info">próxima</Badge>}<span className="block text-xs text-zinc-500">{dataBr(p.data)}{p.horario ? ` às ${p.horario}` : ""}{p.local ? ` · ${p.local}` : ""}{p.profissional_perito ? ` · ${p.profissional_perito}` : ""}</span></li>)}</ul>}
          <Link to="/calendario" className="mt-2 inline-block text-xs text-accent-700 underline">Abrir calendário e lembretes</Link>
        </Cartao>
        <Cartao titulo={`Prazos abertos no DJEN (${d.prazos_abertos.length})`}>
          {d.prazos_abertos.length === 0 ? <p className="text-sm text-zinc-500">Nenhum prazo em aberto.</p> : <ul className="space-y-1.5">{d.prazos_abertos.map((p) => <li key={p.id} className="flex justify-between gap-2 text-sm"><span className="truncate text-zinc-800 dark:text-zinc-100">{p.descricao}</span><span className="shrink-0 text-xs text-zinc-500">{dataBr(p.termino)}</span></li>)}</ul>}
        </Cartao>
        <Cartao titulo={`Últimas publicações${d.publicacoes_nao_lidas ? ` — ${d.publicacoes_nao_lidas} não lida(s)` : ""}`}>
          {d.ultimas_publicacoes.length === 0 ? <p className="text-sm text-zinc-500">Nenhuma publicação capturada.</p> : <ul className="space-y-2.5">{d.ultimas_publicacoes.map((p) => <li key={p.id} className="text-sm"><p className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">{p.tipo_documento || "Publicação"}{!p.lida && <Badge tone="warning">nova</Badge>}<span className="ml-auto text-xs font-normal text-zinc-500">{dataBr(p.data_disponibilizacao)}</span></p><p className="line-clamp-2 text-xs text-zinc-500">{p.orgao ? `${p.orgao} — ` : ""}{p.resumo}</p></li>)}</ul>}
          <Link to="/processos" className="mt-2 inline-block text-xs text-accent-700 underline">Tratar publicações no DJEN</Link>
        </Cartao>
      </div>
    </div>
  );
}
