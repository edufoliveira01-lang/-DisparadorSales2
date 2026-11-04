import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { useToast } from "@/components/ui/Toast";
import { Campo, TIPOS, UFS, STATUS, STATUS_TOM, useAtraso, type Lista } from "./comum";

interface Pessoa {
  id: number; tipo: string; pessoa_juridica: boolean; nome: string; documento: string; documento_formatado: string; rg: string; email: string; telefone: string; telefone2: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string;
  data_nascimento: string; profissao: string; estado_civil: string; origem: string; observacoes: string; ativo: boolean; processos?: number | { id: number; numero: string; pasta: string; titulo: string; status: string; papel: string }[];
}
const vazia = (): Pessoa => ({ id: 0, tipo: "cliente", pessoa_juridica: false, nome: "", documento: "", documento_formatado: "", rg: "", email: "", telefone: "", telefone2: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", data_nascimento: "", profissao: "", estado_civil: "", origem: "", observacoes: "", ativo: true });
const TAM = 30;

export function Pessoas() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [tipo, setTipo] = useState("");
  const [ativo, setAtivo] = useState("1");
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<Lista<Pessoa> | null>(null);
  const [form, setForm] = useState<Pessoa | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [apagar, setApagar] = useState<Pessoa | null>(null);

  const carregar = useCallback(async () => {
    try { setDados(await api.get<Lista<Pessoa>>(`/gestao/pessoas?limite=${TAM}&pagina=${pagina + 1}&busca=${encodeURIComponent(termo)}&tipo=${tipo}&ativo=${ativo}`)); }
    catch { show("Não foi possível carregar as pessoas.", "error"); }
  }, [pagina, termo, tipo, ativo, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setPagina(0); }, [termo, tipo, ativo]);

  const abrir = async (p: Pessoa) => { try { setForm(await api.get<Pessoa>(`/gestao/pessoas/${p.id}`)); } catch { show("Não foi possível abrir o cadastro.", "error"); } };
  const set = (campo: keyof Pessoa, valor: string | boolean) => setForm((f) => (f ? { ...f, [campo]: valor } : f));
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); if (!form) return;
    setSalvando(true);
    try {
      const corpo = { ...form, processos: undefined };
      if (form.id) await api.put(`/gestao/pessoas/${form.id}`, corpo); else await api.post("/gestao/pessoas", corpo);
      show("Cadastro salvo.", "success"); setForm(null); await carregar();
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const excluir = async () => {
    if (!apagar) return;
    try { await api.delete(`/gestao/pessoas/${apagar.id}`); show("Cadastro excluído.", "success"); setApagar(null); setForm(null); await carregar(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível excluir.", "error"); setApagar(null); }
  };
  const lista = dados?.itens ?? [];
  const leitura = !gerir;

  return (
    <div className="space-y-5">
      <PageHeader title="Pessoas" description="Clientes, partes contrárias, testemunhas e peritos." actions={gerir ? <Button onClick={() => setForm(vazia())}><Plus className="h-4 w-4" /> Nova pessoa</Button> : undefined} />
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_150px]">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" placeholder="Buscar por nome, CPF/CNPJ, e-mail ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar pessoas" /></div>
        <Select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo"><option value="">Todos os tipos</option>{Object.entries(TIPOS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select>
        <Select value={ativo} onChange={(e) => setAtivo(e.target.value)} aria-label="Situação"><option value="1">Ativos</option><option value="0">Inativos</option><option value="">Todos</option></Select>
      </div>

      {dados && lista.length === 0 ? (
        <EmptyState icon={Users} title="Nenhuma pessoa encontrada" description={termo || tipo ? "Tente outra busca ou limpe os filtros." : "Cadastre a primeira pessoa ou importe os contatos na Visão geral."} action={gerir ? <Button onClick={() => setForm(vazia())}><Plus className="h-4 w-4" /> Nova pessoa</Button> : undefined} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {lista.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => void abrir(p)} className="grid w-full gap-1 px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center sm:gap-4">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.nome}</span><span className="block truncate text-xs text-zinc-500">{p.documento_formatado || "Sem documento"}</span></span>
                  <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{p.telefone || "—"}</span>
                  <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{p.email || "—"}</span>
                  <span className="flex items-center gap-2"><Badge tone={p.tipo === "cliente" ? "accent" : "neutral"}>{TIPOS[p.tipo] || p.tipo}</Badge>{!p.ativo && <Badge tone="warning">Inativo</Badge>}{typeof p.processos === "number" && p.processos > 0 && <span className="text-xs text-zinc-500">{p.processos} proc.</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Pagination page={pagina} totalItems={dados?.total ?? 0} pageSize={TAM} onPageChange={setPagina} />

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? "Cadastro" : "Nova pessoa"} description={form?.id ? form.nome : "Preencha o que souber; só o nome é obrigatório."} maxWidth="max-w-2xl"
        footer={form && (<div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>{gerir && form.id ? <Button type="button" variant="ghost" onClick={() => setApagar(form)}>Excluir</Button> : null}</div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setForm(null)}>Fechar</Button>{gerir && <Button type="submit" form="form-pessoa" loading={salvando}>Salvar</Button>}</div></div>)}>
        {form && (
          <form id="form-pessoa" onSubmit={salvar} className="space-y-5">
            <fieldset disabled={leitura} className="space-y-5">
              <section className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Nome completo / Razão social *" className="sm:col-span-2"><Input required value={form.nome} onChange={(e) => set("nome", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Tipo"><Select value={form.tipo} onChange={(e) => set("tipo", e.target.value)} className="mt-1.5">{Object.entries(TIPOS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
                <Campo rotulo={form.pessoa_juridica ? "CNPJ" : "CPF"}><Input inputMode="numeric" value={form.documento_formatado || form.documento} onChange={(e) => { set("documento", e.target.value); set("documento_formatado", ""); set("pessoa_juridica", e.target.value.replace(/\D/g, "").length > 11); }} className="mt-1.5" placeholder="Somente números" /></Campo>
                <Campo rotulo="RG"><Input value={form.rg} onChange={(e) => set("rg", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Data de nascimento"><Input type="date" value={form.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Profissão"><Input value={form.profissao} onChange={(e) => set("profissao", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Estado civil"><Select value={form.estado_civil} onChange={(e) => set("estado_civil", e.target.value)} className="mt-1.5"><option value="">—</option>{["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"].map((x) => <option key={x}>{x}</option>)}</Select></Campo>
              </section>
              <section className="grid gap-3 sm:grid-cols-2">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:col-span-2">Contato</h3>
                <Campo rotulo="Telefone / WhatsApp"><Input value={form.telefone} onChange={(e) => set("telefone", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Telefone 2"><Input value={form.telefone2} onChange={(e) => set("telefone2", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="E-mail" className="sm:col-span-2"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="mt-1.5" /></Campo>
              </section>
              <section className="grid gap-3 sm:grid-cols-6">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:col-span-6">Endereço</h3>
                <Campo rotulo="CEP" className="sm:col-span-2"><Input inputMode="numeric" value={form.cep} onChange={(e) => set("cep", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Rua / Avenida" className="sm:col-span-4"><Input value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Número" className="sm:col-span-2"><Input value={form.numero} onChange={(e) => set("numero", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Complemento" className="sm:col-span-4"><Input value={form.complemento} onChange={(e) => set("complemento", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Bairro" className="sm:col-span-2"><Input value={form.bairro} onChange={(e) => set("bairro", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="Cidade" className="sm:col-span-3"><Input value={form.cidade} onChange={(e) => set("cidade", e.target.value)} className="mt-1.5" /></Campo>
                <Campo rotulo="UF" className="sm:col-span-1"><Select value={form.uf} onChange={(e) => set("uf", e.target.value)} className="mt-1.5"><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Campo>
              </section>
              <section className="grid gap-3">
                <Campo rotulo="Como chegou ao escritório (origem)"><Input value={form.origem} onChange={(e) => set("origem", e.target.value)} className="mt-1.5" placeholder="Indicação, site, convênio…" /></Campo>
                <Campo rotulo="Observações"><Textarea rows={3} value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
                {form.id > 0 && <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Cadastro ativo</label>}
              </section>
            </fieldset>
            {form.id > 0 && Array.isArray(form.processos) && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Processos ({form.processos.length})</h3>
                {form.processos.length === 0 ? <p className="text-sm text-zinc-500">Nenhum processo vinculado.</p> : (
                  <ul className="space-y-1.5">{form.processos.map((p) => (
                    <li key={`${p.id}-${p.papel}`}><Link onClick={() => setForm(null)} to={`/gestao/processos/${p.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
                      <span className="min-w-0 truncate"><b>{p.pasta}</b> · {p.numero}{p.titulo ? ` · ${p.titulo}` : ""}</span><Badge tone={STATUS_TOM[p.status] || "neutral"}>{STATUS[p.status] || p.status}</Badge></Link></li>))}</ul>)}
              </section>
            )}
          </form>
        )}
      </Modal>
      <ConfirmDialog open={Boolean(apagar)} title="Excluir cadastro" message={`Excluir ${apagar?.nome}? Esta ação não pode ser desfeita. Quem participa de processos não pode ser excluído; nesse caso, inative o cadastro.`} confirmLabel="Excluir" onConfirm={() => void excluir()} onCancel={() => setApagar(null)} />
    </div>
  );
}
