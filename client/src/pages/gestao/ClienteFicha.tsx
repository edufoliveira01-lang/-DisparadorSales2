import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, FolderOpen, Loader2, Plus, Printer, Save, ShieldAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Arquivos } from "./Arquivos";
import { CamposPersonalizados, type CampoValor } from "./Campos";
import { FinanceiroPessoa } from "./FinanceiroPessoa";
import { GerarDeModelo } from "./Modelos";
import { NovoProcesso, type Responsavel } from "./Processos";
import { Campo, ESCOLARIDADES, ESTADOS_CIVIS, STATUS, STATUS_TOM, TIPOS, UFS, dataBr, mascaraCep, mascaraCpfCnpj, mascaraPis, type EnderecoCep } from "./comum";

interface ProcLigado { id: number; numero: string; pasta: string; titulo: string; status: string; papel: string }
interface Pessoa {
  id: number; tipo: string; pessoa_juridica: boolean; nome: string; documento: string; documento_formatado: string; rg: string; email: string; telefone: string; telefone2: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; data_nascimento: string; profissao: string; estado_civil: string; origem: string; observacoes: string;
  escolaridade: string; pis: string; nome_mae: string; filiacao: string; ativo: boolean; processos?: ProcLigado[]; campos?: CampoValor[];
}
const vazia = (): Pessoa => ({ id: 0, tipo: "cliente", pessoa_juridica: false, nome: "", documento: "", documento_formatado: "", rg: "", email: "", telefone: "", telefone2: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", data_nascimento: "", profissao: "", estado_civil: "", origem: "", observacoes: "", escolaridade: "", pis: "", nome_mae: "", filiacao: "", ativo: true });
interface Pericia { id: number; tipo: string; data: string; horario: string | null; local: string | null; profissional_perito: string | null; processo: string | null; passada: boolean }
interface TarefaAberta { id: number; titulo: string; prazo: string | null; prazo_fatal: number; processo_pasta: string | null }

const ABAS = [["dados", "Dados"], ["processos", "Processos"], ["financeiro", "Financeiro"], ["documentos", "Documentos"], ["agenda", "Perícias e prazos"]] as const;
type Aba = typeof ABAS[number][0];

/** O cadastro completo de uma pessoa: dados, processos, financeiro, documentos e agenda, tudo em um só lugar. */
export function ClienteFicha() {
  const { id: idParam } = useParams();
  const novo = idParam === "novo";
  const id = novo ? 0 : Number(idParam);
  const { can } = useAuth();
  const { show } = useToast();
  const navegar = useNavigate();
  const [busca] = useSearchParams();
  const gerir = can("gestao.manage");
  const [pessoa, setPessoa] = useState<Pessoa | null>(novo ? vazia() : null);
  const [erro, setErro] = useState("");
  const [aba, setAba] = useState<Aba>((ABAS.find(([k]) => k === busca.get("aba"))?.[0]) ?? "dados");
  const [valores, setValores] = useState<Record<number, string>>({});
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [novoProcesso, setNovoProcesso] = useState(false);
  const [criado, setCriado] = useState<number | null>(null);
  const [imprimir, setImprimir] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [msgCep, setMsgCep] = useState("");
  const [apagar, setApagar] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    if (novo) { try { const c = await api.get<{ campos: CampoValor[] }>("/gestao/campos?entidade=pessoa"); setPessoa((p) => ({ ...(p ?? vazia()), campos: c.campos.map((x) => ({ ...x, valor: "", preenchido: false, imprimir: true })) })); } catch { /* campos indisponíveis */ } return; }
    try { setPessoa(await api.get<Pessoa>(`/gestao/pessoas/${id}`)); setErro(""); setSujo(false); setValores({}); }
    catch (e) { setErro(e instanceof ApiError ? e.message : "Não foi possível abrir o cadastro."); }
  }, [id, novo]);
  useEffect(() => { void carregar(); api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, [carregar]);

  const set = (campo: keyof Pessoa, valor: string | boolean) => { setPessoa((p) => (p ? { ...p, [campo]: valor } : p)); setSujo(true); };
  const mudarCampo = (cid: number, v: string) => { setValores((x) => ({ ...x, [cid]: v })); setSujo(true); };

  const mudarCep = async (v: string) => {
    const m = mascaraCep(v); set("cep", m); setMsgCep("");
    if (m.replace(/\D/g, "").length !== 8) return;
    setBuscandoCep(true);
    try {
      const e = await api.get<EnderecoCep>(`/gestao/cep/${m.replace(/\D/g, "")}`);
      setPessoa((p) => p ? { ...p, logradouro: e.logradouro || p.logradouro, bairro: e.bairro || p.bairro, cidade: e.cidade || p.cidade, uf: e.uf || p.uf, complemento: p.complemento || e.complemento } : p);
      setMsgCep(`${e.logradouro ? e.logradouro + " — " : ""}${e.bairro ? e.bairro + ", " : ""}${e.cidade}/${e.uf}`); setSujo(true);
      setTimeout(() => numeroRef.current?.focus(), 50);
    } catch (e) { setMsgCep(e instanceof ApiError ? e.message : "Não consegui consultar o CEP; preencha à mão."); }
    finally { setBuscandoCep(false); }
  };

  const salvar = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!pessoa) return;
    setSalvando(true);
    try {
      const { processos: _p, campos: _c, ...corpo } = pessoa;
      const payload = { ...corpo, campos: valores };
      if (novo) { const r = await api.post<Pessoa>("/gestao/pessoas", payload); setSujo(false); setCriado(r.id); }
      else { await api.put(`/gestao/pessoas/${id}`, payload); show("Cadastro salvo.", "success"); await carregar(); }
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const excluir = async () => {
    try { await api.delete(`/gestao/pessoas/${id}`); show("Cadastro excluído.", "success"); navegar("/gestao/clientes"); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível excluir.", "error"); setApagar(false); }
  };
  const abrirFicha = (senhas: boolean, pessoaId = id) => { window.open(`/api/gestao/pessoas/${pessoaId}/ficha${senhas ? "?senhas=1" : ""}`, "_blank", "noopener"); setImprimir(false); };

  if (erro) return <div className="space-y-4"><Link to="/gestao/clientes" className="inline-flex items-center gap-1 text-sm text-accent-700"><ArrowLeft className="h-4 w-4" /> Voltar</Link><p className="text-sm text-red-600">{erro}</p></div>;
  if (!pessoa) return <p className="text-sm text-zinc-500" role="status">Abrindo o cadastro…</p>;
  const leitura = !gerir;

  return (
    <div className="space-y-5">
      <Link to="/gestao/clientes" className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline dark:text-accent-300"><ArrowLeft className="h-4 w-4" /> Clientes e processos</Link>
      <PageHeader title={novo ? "Novo cadastro" : pessoa.nome || "Cadastro"}
        description={novo ? "Preencha o que souber; só o nome é obrigatório. O endereço completa sozinho pelo CEP." : <span className="flex flex-wrap items-center gap-2"><Badge tone={pessoa.tipo === "cliente" ? "accent" : "neutral"}>{TIPOS[pessoa.tipo]}</Badge>{!pessoa.ativo && <Badge tone="warning">Inativo</Badge>}{pessoa.documento_formatado && <span>{pessoa.documento_formatado}</span>}{pessoa.telefone && <span>{pessoa.telefone}</span>}</span>}
        actions={<div className="flex flex-wrap gap-2">
          {!novo && <Button variant="outline" onClick={() => (sujo ? show("Salve as alterações antes de imprimir a ficha.", "info") : setImprimir(true))}><Printer className="h-4 w-4" /> Imprimir ficha</Button>}
          {!novo && gerir && <Button variant="outline" onClick={() => setNovoProcesso(true)}><Plus className="h-4 w-4" /> Novo processo</Button>}
          {gerir && <Button loading={salvando} onClick={() => void salvar()} disabled={!sujo && !novo}><Save className="h-4 w-4" /> Salvar</Button>}
        </div>} />
      {!novo && (
        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
          {ABAS.filter(([k]) => k !== "financeiro" || can("financeiro.view")).map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${aba === k ? "border-accent-600 text-accent-700 dark:text-accent-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{r}{k === "processos" && pessoa.processos?.length ? ` (${pessoa.processos.length})` : ""}</button>)}
        </div>
      )}

      {aba === "dados" && (
        <form onSubmit={salvar} className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <fieldset disabled={leitura} className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:col-span-2 lg:col-span-4">Identificação</h3>
              <Campo rotulo="Nome completo / Razão social *" className="sm:col-span-2 lg:col-span-3"><Input required autoFocus={novo} value={pessoa.nome} onChange={(e) => set("nome", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Tipo de cadastro"><Select value={pessoa.tipo} onChange={(e) => set("tipo", e.target.value)} className="mt-1.5">{Object.entries(TIPOS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
              <Campo rotulo={pessoa.pessoa_juridica ? "CNPJ" : "CPF"}><Input inputMode="numeric" value={mascaraCpfCnpj(pessoa.documento)} onChange={(e) => { const m = mascaraCpfCnpj(e.target.value); set("documento", m); set("pessoa_juridica", m.replace(/\D/g, "").length > 11); }} className="mt-1.5" placeholder="Somente números" /></Campo>
              <Campo rotulo="RG"><Input value={pessoa.rg} onChange={(e) => set("rg", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Data de nascimento"><Input type="date" value={pessoa.data_nascimento} onChange={(e) => set("data_nascimento", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="PIS / NIT"><Input inputMode="numeric" value={mascaraPis(pessoa.pis)} onChange={(e) => set("pis", mascaraPis(e.target.value))} className="mt-1.5" /></Campo>
              <Campo rotulo="Escolaridade"><Select value={pessoa.escolaridade} onChange={(e) => set("escolaridade", e.target.value)} className="mt-1.5"><option value="">—</option>{ESCOLARIDADES.map((x) => <option key={x}>{x}</option>)}</Select></Campo>
              <Campo rotulo="Estado civil"><Select value={pessoa.estado_civil} onChange={(e) => set("estado_civil", e.target.value)} className="mt-1.5"><option value="">—</option>{ESTADOS_CIVIS.map((x) => <option key={x}>{x}</option>)}</Select></Campo>
              <Campo rotulo="Profissão"><Input value={pessoa.profissao} onChange={(e) => set("profissao", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Nome da mãe" className="sm:col-span-2"><Input value={pessoa.nome_mae} onChange={(e) => set("nome_mae", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Filiação (pai e mãe)" className="sm:col-span-2"><Input value={pessoa.filiacao} onChange={(e) => set("filiacao", e.target.value)} className="mt-1.5" /></Campo>
            </section>
            <section className="grid gap-3 sm:grid-cols-3">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:col-span-3">Contato</h3>
              <Campo rotulo="Telefone / WhatsApp"><Input type="tel" value={pessoa.telefone} onChange={(e) => set("telefone", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Telefone 2"><Input type="tel" value={pessoa.telefone2} onChange={(e) => set("telefone2", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="E-mail"><Input type="email" value={pessoa.email} onChange={(e) => set("email", e.target.value)} className="mt-1.5" /></Campo>
            </section>
            <section className="grid gap-3 sm:grid-cols-6">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 sm:col-span-6">Endereço</h3>
              <Campo rotulo="CEP (preenche o endereço sozinho)" className="sm:col-span-2">
                <div className="relative"><Input inputMode="numeric" value={mascaraCep(pessoa.cep)} onChange={(e) => void mudarCep(e.target.value)} className="mt-1.5 pr-9" placeholder="00000-000" />{buscandoCep && <Loader2 className="absolute right-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />}</div>
                {msgCep && <span className="mt-1 block text-xs font-normal text-zinc-500">{msgCep}</span>}
              </Campo>
              <Campo rotulo="Rua / Avenida" className="sm:col-span-4"><Input value={pessoa.logradouro} onChange={(e) => set("logradouro", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Número" className="sm:col-span-2"><Input ref={numeroRef} value={pessoa.numero} onChange={(e) => set("numero", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Complemento" className="sm:col-span-4"><Input value={pessoa.complemento} onChange={(e) => set("complemento", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Bairro" className="sm:col-span-2"><Input value={pessoa.bairro} onChange={(e) => set("bairro", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="Cidade" className="sm:col-span-3"><Input value={pessoa.cidade} onChange={(e) => set("cidade", e.target.value)} className="mt-1.5" /></Campo>
              <Campo rotulo="UF" className="sm:col-span-1"><Select value={pessoa.uf} onChange={(e) => set("uf", e.target.value)} className="mt-1.5"><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Campo>
            </section>
            {pessoa.campos && <CamposPersonalizados campos={pessoa.campos} valores={valores} aoMudar={mudarCampo} entidade="pessoa" entidadeId={id} aoAtualizarDefinicoes={() => void carregar()} somenteLeitura={leitura} />}
            <section className="grid gap-3">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Outras informações</h3>
              <Campo rotulo="Como chegou ao escritório (origem)"><Input value={pessoa.origem} onChange={(e) => set("origem", e.target.value)} className="mt-1.5" placeholder="Indicação, site, convênio…" /></Campo>
              <Campo rotulo="Observações"><Textarea rows={3} value={pessoa.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
              {!novo && <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={pessoa.ativo} onChange={(e) => set("ativo", e.target.checked)} /> Cadastro ativo</label>}
            </section>
          </fieldset>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
            <div>{gerir && !novo && <Button type="button" variant="ghost" onClick={() => setApagar(true)}>Excluir cadastro</Button>}</div>
            {gerir && <Button type="submit" loading={salvando}><Save className="h-4 w-4" /> {novo ? "Cadastrar" : "Salvar alterações"}</Button>}
          </div>
        </form>
      )}

      {!novo && aba === "processos" && (
        <section className="space-y-3">
          {gerir && <div className="flex justify-end"><Button onClick={() => setNovoProcesso(true)}><Plus className="h-4 w-4" /> Novo processo para {pessoa.nome.split(" ")[0]}</Button></div>}
          {(pessoa.processos?.length ?? 0) === 0 ? <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhum processo vinculado ainda.</p> : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {pessoa.processos!.map((p) => (
                <li key={`${p.id}-${p.papel}`}><Link to={`/gestao/processos/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"><FolderOpen className="mr-1.5 inline h-4 w-4 text-zinc-400" />{p.pasta} · {p.numero}</span><span className="block truncate text-xs text-zinc-500">{p.titulo || "Sem título"}</span></span>
                  <span className="flex items-center gap-2"><span className="text-xs text-zinc-500">{p.papel}</span><Badge tone={STATUS_TOM[p.status] || "neutral"}>{STATUS[p.status] || p.status}</Badge></span></Link></li>))}
            </ul>)}
        </section>
      )}
      {!novo && aba === "financeiro" && can("financeiro.view") && <FinanceiroPessoa pessoaId={id} nome={pessoa.nome} />}
      {!novo && aba === "documentos" && (
        <section className="space-y-4">
          <GerarDeModelo pessoa={{ id, nome: pessoa.nome }} />
          <Arquivos escopo="pessoas" id={id} />
        </section>
      )}
      {!novo && aba === "agenda" && <AgendaPessoa id={id} />}

      {novoProcesso && <NovoProcesso responsaveis={resp} clientePadrao={{ id, nome: pessoa.nome }} aoFechar={() => setNovoProcesso(false)} aoCriar={(pid) => { setNovoProcesso(false); navegar(`/gestao/processos/${pid}`); }} />}
      <Modal open={imprimir} onClose={() => setImprimir(false)} title="Imprimir ficha de cadastro" description="Abre a ficha em uma nova aba, pronta para imprimir ou salvar em PDF." maxWidth="max-w-md"
        footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setImprimir(false)}>Cancelar</Button>{gerir && <Button variant="outline" onClick={() => abrirFicha(true)}><ShieldAlert className="h-4 w-4" /> Com senhas</Button>}<Button onClick={() => abrirFicha(false)}><Printer className="h-4 w-4" /> Imprimir</Button></div>}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">A ficha traz os dados do cadastro, os campos personalizados e os processos vinculados. Por segurança, as <b>senhas saem ocultas</b>; use “Com senhas” só se for guardar o papel com cuidado (isso fica registrado).</p>
      </Modal>
      <Modal open={criado !== null} onClose={() => { const c = criado; setCriado(null); navegar(`/gestao/clientes/${c}`); }} title="Cadastro criado" description="O que deseja fazer agora?" maxWidth="max-w-md"
        footer={<div className="flex w-full flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => { const c = criado!; setCriado(null); navegar(`/gestao/clientes/${c}`); }}>Abrir o cadastro</Button><Button variant="outline" onClick={() => { const c = criado!; abrirFicha(false, c); setCriado(null); navegar(`/gestao/clientes/${c}`); }}><Printer className="h-4 w-4" /> Imprimir ficha</Button><Button onClick={() => { const c = criado!; setCriado(null); navegar(`/gestao/clientes/${c}?aba=processos`); }}><Plus className="h-4 w-4" /> Cadastrar processo</Button></div>}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{pessoa.nome} foi cadastrado(a). Você pode imprimir a ficha de cadastro agora ou já registrar o processo.</p>
      </Modal>
      <ConfirmDialog open={apagar} title="Excluir cadastro" message={`Excluir ${pessoa.nome}? Quem participa de processos não pode ser excluído; nesse caso, desmarque "Cadastro ativo".`} confirmLabel="Excluir" onConfirm={() => void excluir()} onCancel={() => setApagar(false)} />
    </div>
  );
}

function AgendaPessoa({ id }: { id: number }) {
  const { show } = useToast();
  const [d, setD] = useState<{ pericias: Pericia[]; tarefas: TarefaAberta[] } | null>(null);
  useEffect(() => { api.get<{ pericias: Pericia[]; tarefas: TarefaAberta[] }>(`/gestao/pessoas/${id}/agenda`).then(setD).catch(() => show("Não foi possível carregar a agenda.", "error")); }, [id, show]);
  if (!d) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const proximas = d.pericias.filter((p) => !p.passada).reverse(), passadas = d.pericias.filter((p) => p.passada);
  const Item = ({ p }: { p: Pericia }) => <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"><div className="min-w-0"><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.tipo}</p><p className="text-xs text-zinc-500">{dataBr(p.data)}{p.horario ? ` às ${p.horario}` : ""}{p.local ? ` · ${p.local}` : ""}{p.profissional_perito ? ` · ${p.profissional_perito}` : ""}</p></div>{!p.passada && <Badge tone="info">Próxima</Badge>}</li>;
  return (
    <div className="space-y-5">
      <section><h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><CalendarClock className="h-4 w-4 text-zinc-400" /> Perícias e audiências</h3>
        {d.pericias.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700">Nenhuma perícia ou audiência agendada para esta pessoa.</p> : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">{proximas.map((p) => <Item key={p.id} p={p} />)}{passadas.map((p) => <Item key={p.id} p={p} />)}</ul>)}
        <p className="mt-2 text-xs text-zinc-500">Os lembretes por WhatsApp continuam em <Link className="text-accent-700 underline" to="/calendario">Perícias e avisos → Calendário</Link>.</p>
      </section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tarefas em aberto ({d.tarefas.length})</h3>
        {d.tarefas.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700">Nenhuma tarefa em aberto para esta pessoa ou seus processos.</p> : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">{d.tarefas.map((t) => <li key={t.id} className="px-4 py-2.5 text-sm"><span className="font-medium text-zinc-900 dark:text-zinc-100">{t.titulo}</span> <span className="text-xs text-zinc-500">{t.prazo ? `· prazo ${dataBr(t.prazo)}` : ""}{t.processo_pasta ? ` · Pasta ${t.processo_pasta}` : ""}{t.prazo_fatal ? " · FATAL" : ""}</span></li>)}</ul>)}
      </section>
    </div>
  );
}
