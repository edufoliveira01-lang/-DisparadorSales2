import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Users, FolderOpen, MessageCircle } from "lucide-react";
import { AvatarPessoa, linkWhatsApp, useAtendimentoLiberado } from "./AvatarPessoa";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { STATUS, TIPOS, useAtraso, type Lista } from "./comum";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { Plus } from "lucide-react";

interface Proc { id: number; pasta: string; numero: string; titulo: string; status: string; papel: string }
interface Pessoa { id: number; nome: string; tipo: string; documento_formatado: string; telefone: string; email: string; ativo: boolean; processos?: number; processos_lista: Proc[] }
const TAM = 20;

/** Lista de pessoas com os processos de cada uma logo abaixo: uma busca só acha o cliente, o CPF ou o número do processo. */
export function Clientes({ recarregar = 0 }: { recarregar?: number } = {}) {
  const { can } = useAuth();
  const { show } = useToast();
  const atendimento = useAtendimentoLiberado();
  const navegar = useNavigate();
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [tipo, setTipo] = useState("cliente");
  const [ativo, setAtivo] = useState("1");
  const [pagina, setPagina] = useState(0);
  const [filtro, setFiltro] = useState("");
  const [dados, setDados] = useState<Lista<Pessoa> | null>(null);
  const carregar = useCallback(async () => {
    try { setDados(await api.get<Lista<Pessoa>>(`/gestao/pessoas?limite=${TAM}&pagina=${pagina + 1}&busca=${encodeURIComponent(termo)}&tipo=${tipo}&ativo=${ativo}&filtro=${filtro}`)); }
    catch { show("Não foi possível carregar os cadastros.", "error"); }
  }, [pagina, termo, tipo, ativo, filtro, recarregar, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setPagina(0); }, [termo, tipo, ativo, filtro]);
  const lista = dados?.itens ?? [];
  const resumo = dados?.resumo;
  const paineis: [string, string, number | undefined][] = [["", "Todos", resumo?.total], ["com_processo", "Com processo", resumo?.com_processo], ["sem_processo", "Sem processo", resumo?.sem_processo], ["telefone_conferir", "Telefone a conferir", resumo?.telefone_conferir]];
  return (
    <div className="space-y-4">
      {resumo && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {paineis.map(([k, rotulo, n]) => (
          <button key={k || "todos"} type="button" onClick={() => setFiltro(filtro === k ? "" : k)} aria-pressed={filtro === k}
            className={`rounded-2xl border p-4 text-left transition ${filtro === k ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"} ${k === "telefone_conferir" && (n ?? 0) > 0 && filtro !== k ? "border-amber-300 dark:border-amber-700" : ""}`}>
            <span className={`block text-2xl font-semibold leading-none ${k === "telefone_conferir" && (n ?? 0) > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{n ?? 0}</span>
            <span className="mt-1.5 block text-xs text-zinc-500">{rotulo}</span>
          </button>))}
      </div>}
      <div className="grid gap-3 sm:grid-cols-[1fr_190px_140px]">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" placeholder="Buscar por nome, CPF/CNPJ, telefone ou número do processo…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar clientes e processos" /></div>
        <Select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="cliente">Só clientes</option><option value="">Todos os tipos</option>{Object.entries(TIPOS).filter(([v]) => v !== "cliente").map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select>
        <Select value={ativo} onChange={(e) => setAtivo(e.target.value)} aria-label="Situação"><option value="1">Ativos</option><option value="0">Inativos</option><option value="">Todos</option></Select>
      </div>
      {dados && lista.length === 0 ? (
        <EmptyState icon={Users} title="Nenhum cadastro encontrado" description={termo ? "Tente outro nome, CPF ou número de processo." : "Cadastre o primeiro cliente ou importe um arquivo de contatos pelo botão «⋯» no alto da página."} action={can("gestao.manage") ? <Button onClick={() => navegar("/gestao/clientes/novo")}><Plus className="h-4 w-4" /> Novo cadastro</Button> : undefined} />
      ) : (
        <ul className="space-y-2.5">
          {lista.map((p) => {
            const zap = atendimento ? linkWhatsApp(p.telefone) : null;
            return (
              <li key={p.id} className="surface-panel overflow-hidden transition hover:border-accent-300 hover:shadow-card dark:hover:border-accent-500/40">
                <div className="flex items-center gap-3 px-4 py-3">
                  <AvatarPessoa id={p.id} nome={p.nome} />
                  <Link to={`/gestao/clientes/${p.id}`} className="grid min-w-0 flex-1 gap-0.5 sm:grid-cols-[1.4fr_1fr_1fr] sm:items-center sm:gap-4">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.nome}</span><span className="block truncate text-xs text-zinc-500">{p.documento_formatado || "Sem documento"}</span></span>
                    <span className="flex min-w-0 items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300"><span className="truncate">{p.telefone || "—"}</span>{(() => { let d = (p.telefone || "").replace(/\D/g, ""); if (d.startsWith("55") && d.length > 11) d = d.slice(2); return d.length !== 10 && d.length !== 11 ? <Badge tone="warning">conferir</Badge> : null; })()}</span>
                    <span className="hidden truncate text-sm text-zinc-500 sm:block">{p.email || "—"}</span>
                  </Link>
                  <span className="hidden items-center gap-1.5 md:flex"><Badge tone={p.tipo === "cliente" ? "accent" : "neutral"}>{TIPOS[p.tipo] || p.tipo}</Badge>{!p.ativo && <Badge tone="warning">Inativo</Badge>}</span>
                  {zap && <a href={zap} target="_blank" rel="noopener noreferrer" aria-label={`Abrir a conversa de ${p.nome} no atendimento`} title="Abrir a conversa no atendimento" className="topbar-icon !h-9 !w-9 shrink-0 text-emerald-600"><MessageCircle className="h-4 w-4" /></a>}
                </div>
                {p.processos_lista.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
                    {p.processos_lista.map((x) => (
                      <Link key={`${x.id}-${x.papel}`} to={`/gestao/processos/${x.id}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:border-accent-400 hover:bg-accent-50 dark:border-white/10 dark:bg-transparent dark:text-zinc-200 dark:hover:bg-white/5">
                        <FolderOpen className="h-3 w-3 shrink-0 text-zinc-400" /><span className="truncate"><b>{x.pasta}</b> {x.titulo || x.numero}</span><span className="shrink-0 text-zinc-400">· {STATUS[x.status] || x.status}</span>
                      </Link>))}
                    {(p.processos ?? 0) > p.processos_lista.length && <Link to={`/gestao/clientes/${p.id}?aba=processos`} className="self-center text-xs text-accent-700 underline dark:text-accent-300">+{(p.processos ?? 0) - p.processos_lista.length} mais</Link>}
                  </div>)}
              </li>);
          })}
        </ul>)}
      <Pagination page={pagina} totalItems={dados?.total ?? 0} pageSize={TAM} onPageChange={setPagina} />
    </div>
  );
}
