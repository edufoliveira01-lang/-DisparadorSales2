import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, FolderOpen, Download, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { AREAS, Campo, SeletorPessoa, STATUS, STATUS_TOM, dataBr, useAtraso, type Lista, type PessoaResumo } from "./comum";

export interface ProcessoLinha { id: number; numero: string; numero_formatado: string; pasta: string; titulo: string; classe: string; tribunal: string; area: string; status: string; responsavel: string | null; autores: string | null; atualizado_em: string }
export interface Responsavel { id: number; nome: string }
const TAM = 30;

export function Processos() {
  const { can } = useAuth();
  const { show } = useToast();
  const navegar = useNavigate();
  const gerir = can("gestao.manage");
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [status, setStatus] = useState("ativo");
  const [responsavel, setResponsavel] = useState("");
  const [area, setArea] = useState("");
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<Lista<ProcessoLinha> | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [novo, setNovo] = useState(false);
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<Lista<ProcessoLinha>>(`/gestao/processos?limite=${TAM}&pagina=${pagina + 1}&busca=${encodeURIComponent(termo)}&status=${status}&responsavel=${responsavel}&area=${area}`)); }
    catch { show("Não foi possível carregar os processos.", "error"); }
  }, [pagina, termo, status, responsavel, area, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setPagina(0); }, [termo, status, responsavel, area]);
  useEffect(() => {
    api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined);
    api.get<{ pendentes: number }>("/gestao/processos/pendentes-importacao").then((r) => setPendentes(r.pendentes)).catch(() => undefined);
  }, []);

  const importar = async () => {
    setImportando(true);
    try { const r = await api.post<{ criados: number }>("/gestao/processos/importar-djen", {}); show(`${r.criados} ficha(s) criada(s).`, "success"); setPendentes(0); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível importar.", "error"); }
    finally { setImportando(false); }
  };
  const lista = dados?.itens ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="Processos e pastas" description="Cada processo com pasta, partes, responsável, histórico e anotações." actions={gerir ? <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo processo</Button> : undefined} />
      {gerir && pendentes > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-200 bg-accent-50/60 p-4 dark:border-accent-900 dark:bg-accent-950/30">
          <p className="text-sm text-zinc-700 dark:text-zinc-200"><b>{pendentes}</b> processo(s) do DJEN ainda não têm ficha de gestão.</p>
          <Button size="sm" loading={importando} onClick={() => void importar()}><Download className="h-4 w-4" /> Criar fichas</Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_150px_190px_170px]">
        <div className="relative sm:col-span-2 lg:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" placeholder="Número, pasta, cliente, CPF ou título…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar processos" /></div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação"><option value="">Todas</option>{Object.entries(STATUS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select>
        <Select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} aria-label="Responsável"><option value="">Todos os responsáveis</option><option value="sem">Sem responsável</option>{resp.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select>
        <Select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Área"><option value="">Todas as áreas</option>{Object.entries(AREAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select>
      </div>

      {dados && lista.length === 0 ? (
        <EmptyState icon={FolderOpen} title="Nenhum processo encontrado" description={termo || responsavel || area || status !== "ativo" ? "Tente outra busca ou ajuste os filtros." : "Cadastre o primeiro processo ou crie as fichas dos processos do DJEN."} action={gerir ? <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Novo processo</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {lista.map((p) => (
              <li key={p.id}>
                <Link to={`/gestao/processos/${p.id}`} className="grid gap-1 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60 lg:grid-cols-[110px_1.3fr_1.2fr_1fr_auto] lg:items-center lg:gap-4">
                  <span className="text-xs font-semibold text-accent-700 dark:text-accent-300">{p.pasta}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.numero_formatado || p.numero}</span><span className="block truncate text-xs text-zinc-500">{p.titulo || p.classe || "Sem título"}{p.tribunal ? ` · ${p.tribunal}` : ""}</span></span>
                  <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{p.autores || "Sem cliente vinculado"}</span>
                  <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{p.responsavel || <span className="text-amber-600">Sem responsável</span>}</span>
                  <span className="flex items-center gap-2"><Badge tone={STATUS_TOM[p.status] || "neutral"}>{STATUS[p.status] || p.status}</Badge><span className="hidden text-xs text-zinc-400 xl:inline">{dataBr(p.atualizado_em)}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Pagination page={pagina} totalItems={dados?.total ?? 0} pageSize={TAM} onPageChange={setPagina} />
      {novo && <NovoProcesso responsaveis={resp} aoFechar={() => setNovo(false)} aoCriar={(id) => { setNovo(false); navegar(`/gestao/processos/${id}`); }} />}
    </div>
  );
}

function NovoProcesso({ responsaveis, aoFechar, aoCriar }: { responsaveis: Responsavel[]; aoFechar: () => void; aoCriar: (id: number) => void }) {
  const { show } = useToast();
  const [f, setF] = useState({ numero: "", titulo: "", classe: "", area: "", responsavel_user_id: "", valor_causa: "", observacoes: "" });
  const [clientes, setClientes] = useState<PessoaResumo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const p = await api.post<{ id: number }>("/gestao/processos", { ...f, responsavel_user_id: f.responsavel_user_id || null, partes: clientes.map((c, i) => ({ pessoa_id: c.id, papel: "autor", principal: i === 0 })) });
      show("Processo cadastrado.", "success"); aoCriar(p.id);
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível cadastrar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title="Novo processo" description="O tribunal é identificado pelo número e a pasta é criada automaticamente." maxWidth="max-w-xl"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-processo" loading={salvando}>Cadastrar</Button></div>}>
      <form id="form-processo" onSubmit={salvar} className="space-y-4">
        <Campo rotulo="Número do processo *"><Input required autoFocus value={f.numero} onChange={(e) => set("numero", e.target.value)} className="mt-1.5" placeholder="0000000-00.0000.0.00.0000" /></Campo>
        <Campo rotulo="Título / assunto interno"><Input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} className="mt-1.5" placeholder="Ex.: Aposentadoria por invalidez — Maria" /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Classe"><Input value={f.classe} onChange={(e) => set("classe", e.target.value)} className="mt-1.5" /></Campo>
          <Campo rotulo="Área"><Select value={f.area} onChange={(e) => set("area", e.target.value)} className="mt-1.5"><option value="">—</option>{Object.entries(AREAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
          <Campo rotulo="Responsável"><Select value={f.responsavel_user_id} onChange={(e) => set("responsavel_user_id", e.target.value)} className="mt-1.5"><option value="">Sem responsável</option>{responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></Campo>
          <Campo rotulo="Valor da causa (R$)"><Input inputMode="decimal" value={f.valor_causa} onChange={(e) => set("valor_causa", e.target.value)} className="mt-1.5" placeholder="0,00" /></Campo>
        </div>
        <div>
          <SeletorPessoa rotulo="Cliente(s) — autor" aoEscolher={(p) => setClientes((c) => (c.some((x) => x.id === p.id) ? c : [...c, p]))} />
          {clientes.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{clientes.map((c) => <li key={c.id} className="flex items-center gap-1 rounded-full bg-accent-50 px-3 py-1 text-xs text-accent-800 dark:bg-accent-900/40 dark:text-accent-200">{c.nome}<button type="button" aria-label={`Remover ${c.nome}`} onClick={() => setClientes((x) => x.filter((y) => y.id !== c.id))}><X className="h-3 w-3" /></button></li>)}</ul>}
          <p className="mt-1 text-xs text-zinc-500">Ainda não cadastrou o cliente? Cadastre em Pessoas e volte; ou adicione as partes depois, na ficha.</p>
        </div>
        <Campo rotulo="Observações"><Textarea rows={3} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
      </form>
    </Modal>
  );
}
