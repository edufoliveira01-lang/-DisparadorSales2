import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, MessageCircle, Camera, CalendarClock, Download, FileText, FolderOpen, Loader2, Plus, Printer, Save, ShieldAlert, Trash2, User } from "lucide-react";
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
import { GerarDocumentos } from "./GerarDocumentos";
import { AnotacoesPessoa } from "./AnotacoesPessoa";
import { AvisoDePendencias, FaixaDePendencias, SeloDePendencias, usePendencias } from "./PendenciasDoCliente";
import { NegocioDaPessoa } from "./NegocioDaPessoa";
import { Vinculos } from "./Vinculos";
import { DocumentosEssenciais } from "./DocumentosEssenciais";
import { FotoSugerida } from "./FotoSugerida";
import { FaseResumoBarra, useFases } from "./FaseResumo";
import { CopiarTexto, AbrirNoTribunal } from "@/components/CopiarTexto";
import { FaixaDeCompromissos, SeloDeCompromissos, useCompromissos } from "./AvisoDeCompromissos";
import { PericiaInssDaPessoa } from "./PericiaInss";
import { AvatarPessoa, linkWhatsApp, useAtendimentoLiberado } from "./AvatarPessoa";
import { NovoProcesso, type Responsavel } from "./Processos";
import { Campo, ESCOLARIDADES, ESTADOS_CIVIS, STATUS, STATUS_TOM, TIPOS, UFS, dataBr, mascaraCep, mascaraCpfCnpj, mascaraPis, type EnderecoCep } from "./comum";

interface ProcLigado { id: number; numero: string; pasta: string; titulo: string; status: string; papel: string }
interface Pessoa {
  id: number; tipo: string; pessoa_juridica: boolean; nome: string; documento: string; documento_formatado: string; rg: string; email: string; telefone: string; telefone2: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; data_nascimento: string; profissao: string; estado_civil: string; origem: string; observacoes: string;
  escolaridade: string; pis: string; nome_mae: string; filiacao: string; ativo: boolean; processos?: ProcLigado[]; campos?: CampoValor[]; tem_foto?: boolean;
}
const vazia = (): Pessoa => ({ id: 0, tipo: "cliente", pessoa_juridica: false, nome: "", documento: "", documento_formatado: "", rg: "", email: "", telefone: "", telefone2: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", data_nascimento: "", profissao: "", estado_civil: "", origem: "", observacoes: "", escolaridade: "", pis: "", nome_mae: "", filiacao: "", ativo: true });
interface Pericia { id: number; tipo: string; data: string; horario: string | null; local: string | null; profissional_perito: string | null; processo: string | null; passada: boolean }
interface TarefaAberta { id: number; titulo: string; prazo: string | null; prazo_fatal: number; processo_pasta: string | null }

const ABAS = [["dados", "Dados"], ["processos", "Processos"], ["anotacoes", "Anotações"], ["financeiro", "Financeiro"], ["documentos", "Documentos"], ["agenda", "Perícias e prazos"], ["pericia_inss", "Perícia INSS"], ["vinculos", "Vínculos"], ["negocio", "Negócio"]] as const;
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
  const atendimento = useAtendimentoLiberado();
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
  const [docs, setDocs] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [msgCep, setMsgCep] = useState("");
  const [apagar, setApagar] = useState(false);
  const pend = usePendencias(novo ? null : id);
  const compromissos = useCompromissos(novo ? null : id);
  const numeroRef = useRef<HTMLInputElement>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const [fotoVersao, setFotoVersao] = useState(0);
  const [docsVersao, setDocsVersao] = useState(0);
  const fases = useFases((pessoa?.processos ?? []).map((p) => p.id));

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
  const [pericias, setPericias] = useState<{ id: number; tipo: string; data: string; horario: string | null }[]>([]);
  const [cancelarPericias, setCancelarPericias] = useState(true);
  useEffect(() => {
    if (!apagar || novo) return;
    setCancelarPericias(true);
    api.get<{ pericias: typeof pericias }>(`/gestao/pessoas/${id}/exclusao`, { fresh: true } as never).then((r) => setPericias(r.pericias)).catch(() => setPericias([]));
  }, [apagar, id, novo]);
  const excluir = async () => {
    try { await api.delete(`/gestao/pessoas/${id}${pericias.length > 0 && cancelarPericias ? "?cancelar_pericias=1" : ""}`); show("Cadastro excluído.", "success"); navegar("/gestao/clientes"); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível excluir.", "error"); setApagar(false); }
  };
  const enviarFoto = async (f: File | undefined) => {
    if (!f) return;
    try { await api.upload(`/gestao/pessoas/${id}/foto`, f); setFotoVersao((v) => v + 1); setPessoa((p) => (p ? { ...p, tem_foto: true } : p)); show("Foto salva.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar a foto.", "error"); }
    finally { if (fotoRef.current) fotoRef.current.value = ""; }
  };
  const tirarFoto = async () => { try { await api.delete(`/gestao/pessoas/${id}/foto`); setPessoa((p) => (p ? { ...p, tem_foto: false } : p)); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível remover a foto.", "error"); } };
  const abrirFicha = (senhas: boolean, pessoaId = id) => { window.open(`/api/gestao/pessoas/${pessoaId}/ficha${senhas ? "?senhas=1" : ""}`, "_blank", "noopener"); setImprimir(false); };

  if (erro) return <div className="space-y-4"><Link to="/gestao/clientes" className="inline-flex items-center gap-1 text-sm text-accent-700"><ArrowLeft className="h-4 w-4" /> Voltar</Link><p className="text-sm text-red-600">{erro}</p></div>;
  if (!pessoa) return <p className="text-sm text-zinc-500" role="status">Abrindo o cadastro…</p>;
  const leitura = !gerir;

  return (
    <div className="space-y-5">
      <Link to="/gestao/clientes" className="inline-flex items-center gap-1 text-sm text-accent-700 hover:underline dark:text-accent-300"><ArrowLeft className="h-4 w-4" /> Clientes e processos</Link>
      <div className="surface-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          {novo ? <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700 dark:bg-white/10"><User className="h-6 w-6" /></span> : <AvatarPessoa key={fotoVersao} id={id} nome={pessoa.nome} temFoto={pessoa.tem_foto} tamanho={56} />}
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50"><span className="truncate">{novo ? "Novo cadastro" : pessoa.nome || "Cadastro"}</span>{!novo && pessoa.nome && <CopiarTexto texto={pessoa.nome} rotulo="Nome do cliente" />}</h1>
            {!novo && (pessoa.processos?.length ?? 0) > 0 && (
              <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                {pessoa.processos!.slice(0, 3).map((p) => <li key={`${p.id}-${p.papel}`} className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300"><Link to={`/gestao/processos/${p.id}`} className="font-medium hover:underline">{p.numero}</Link><CopiarTexto texto={p.numero} rotulo="Número do processo" /><AbrirNoTribunal numero={p.numero} compacto /></li>)}
                {pessoa.processos!.length > 3 && <li className="text-xs text-zinc-500"><button type="button" className="underline" onClick={() => setAba("processos")}>+{pessoa.processos!.length - 3} processo(s)</button></li>}
              </ul>)}
            {novo ? <p className="text-sm text-zinc-500">Preencha o que souber; só o nome é obrigatório. O endereço completa sozinho pelo CEP.</p> : (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
                <Badge tone={pessoa.tipo === "cliente" ? "accent" : "neutral"}>{TIPOS[pessoa.tipo]}</Badge>{!pessoa.ativo && <Badge tone="warning">Inativo</Badge>}<SeloDePendencias total={pend.itens.length} /><SeloDeCompromissos total={compromissos.length} />
                {pessoa.documento_formatado && <span>{pessoa.documento_formatado}</span>}
                {pessoa.telefone && (atendimento && linkWhatsApp(pessoa.telefone) ? <a href={linkWhatsApp(pessoa.telefone)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400"><MessageCircle className="h-3.5 w-3.5" /> {pessoa.telefone} · abrir conversa</a> : <span>{pessoa.telefone}</span>)}
                {pessoa.email && <span className="truncate">{pessoa.email}</span>}
              </p>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">          {!novo && <Button variant="outline" onClick={() => (sujo ? show("Salve as alterações antes de imprimir a ficha.", "info") : setImprimir(true))}><Printer className="h-4 w-4" /> Imprimir ficha</Button>}
          {!novo && gerir && <Button variant="outline" onClick={() => (sujo ? show("Salve as alterações antes de gerar os documentos.", "info") : setDocs(true))}><FileText className="h-4 w-4" /> Gerar documentos</Button>}
          {!novo && gerir && <Button variant="outline" onClick={() => setNovoProcesso(true)}><Plus className="h-4 w-4" /> Novo processo</Button>}
          {gerir && <Button loading={salvando} onClick={() => void salvar()} disabled={!sujo && !novo}><Save className="h-4 w-4" /> Salvar</Button>}
        </div>
      </div>
      {!novo && <FotoSugerida key={`fs-${docsVersao}`} temFoto={pessoa.tem_foto} pessoaId={id} nome={pessoa.nome} gerir={gerir} aoAceitar={() => { setFotoVersao((v) => v + 1); setPessoa((p) => (p ? { ...p, tem_foto: true } : p)); }} />}
      {!novo && <FaixaDeCompromissos itens={compromissos} aoAbrir={(a) => setAba(a)} />}
      {!novo && <FaixaDePendencias itens={pend.itens} aoCumprir={(p) => void pend.cumprir(p)} />}
      {!novo && <AvisoDePendencias pessoaId={id} nome={pessoa.nome} itens={pend.itens} aoCumprir={(p) => void pend.cumprir(p)} />}
      {!novo && (
        <div role="tablist" className="page-tabs">
          {ABAS.filter(([k]) => k !== "financeiro" || can("financeiro.view")).map(([k, r]) => <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${aba === k ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5"}`}>{r}{k === "processos" && pessoa.processos?.length ? ` (${pessoa.processos.length})` : ""}</button>)}
        </div>
      )}

      {aba === "dados" && (
        <form onSubmit={salvar} className="surface-panel space-y-6 p-5">
          <fieldset disabled={leitura} className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
                {!novo && pessoa.tem_foto ? <img key={fotoVersao} src={`/api/gestao/pessoas/${id}/foto?v=${fotoVersao}`} alt={`Foto de ${pessoa.nome}`} className="h-24 w-[4.5rem] rounded-xl border border-zinc-200 object-cover dark:border-zinc-700" />
                  : <span className="flex h-24 w-[4.5rem] items-center justify-center rounded-xl border border-dashed border-zinc-300 text-zinc-300 dark:border-zinc-700"><User className="h-8 w-8" /></span>}
                <div className="space-y-1.5"><h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Identificação</h3>
                  {novo ? <p className="text-xs text-zinc-500">Cadastre primeiro; depois você coloca a foto (aparece na ficha impressa).</p> : (
                    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => fotoRef.current?.click()} disabled={leitura}><Camera className="h-4 w-4" /> {pessoa.tem_foto ? "Trocar foto" : "Colocar foto"}</Button>{pessoa.tem_foto && !leitura && <Button type="button" size="sm" variant="ghost" onClick={() => void tirarFoto()}><Trash2 className="h-4 w-4" /> Remover</Button>}<input ref={fotoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void enviarFoto(e.target.files?.[0])} /></div>)}
                  <p className="text-xs text-zinc-500">PNG, JPG ou WebP, até 2 MB.</p></div>
              </div>
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
            <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
              {pessoa.processos!.map((p) => (
                <li key={`${p.id}-${p.papel}`}><Link to={`/gestao/processos/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"><FolderOpen className="mr-1.5 inline h-4 w-4 text-zinc-400" />{p.pasta} · {p.numero}</span><span className="block truncate text-xs text-zinc-500">{p.titulo || "Sem título"}</span><span className="mt-1 block"><FaseResumoBarra f={fases[p.id]} /></span></span>
                  <span className="flex items-center gap-2"><span className="text-xs text-zinc-500">{p.papel}</span><Badge tone={STATUS_TOM[p.status] || "neutral"}>{STATUS[p.status] || p.status}</Badge></span></Link></li>))}
            </ul>)}
        </section>
      )}
      {!novo && aba === "financeiro" && can("financeiro.view") && <FinanceiroPessoa pessoaId={id} nome={pessoa.nome} />}
      {!novo && aba === "documentos" && (
        <section className="space-y-4">
          {gerir && <div className="flex flex-wrap items-center justify-between gap-3 surface-panel p-4"><p className="text-sm text-zinc-600 dark:text-zinc-300">Procuração, contrato, declarações e os documentos próprios do escritório, com cabeçalho e rodapé.</p><Button onClick={() => (sujo ? show("Salve as alterações antes de gerar os documentos.", "info") : setDocs(true))}><FileText className="h-4 w-4" /> Gerar documentos</Button></div>}
          <DocumentosEssenciais key={docsVersao} pessoaId={id} gerir={gerir} />
          <h3 className="pt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Todos os arquivos</h3>
          <Arquivos escopo="pessoas" id={id} aoMudar={() => setDocsVersao((v) => v + 1)} />
        </section>
      )}
      {!novo && aba === "anotacoes" && <AnotacoesPessoa id={id} nome={pessoa.nome} gerir={gerir} />}
      {!novo && aba === "agenda" && <AgendaPessoa id={id} />}
      {!novo && aba === "pericia_inss" && <PericiaInssDaPessoa pessoaId={id} gerir={gerir} />}
      {!novo && aba === "vinculos" && <Vinculos pessoaId={id} nome={pessoa.nome} gerir={gerir} />}
      {!novo && aba === "negocio" && <NegocioDaPessoa pessoaId={id} />}

      {novoProcesso && <NovoProcesso responsaveis={resp} clientePadrao={{ id, nome: pessoa.nome }} aoFechar={() => setNovoProcesso(false)} aoCriar={(pid) => { setNovoProcesso(false); navegar(`/gestao/processos/${pid}`); }} />}
      {!novo && <GerarDocumentos aberto={docs} aoFechar={() => setDocs(false)} pessoa={{ id, nome: pessoa.nome }} />}
      <Modal open={imprimir} onClose={() => setImprimir(false)} title="Imprimir ficha de cadastro" description="Abre a ficha em uma nova aba, pronta para imprimir ou salvar em PDF." maxWidth="max-w-md"
        footer={<div className="flex w-full flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setImprimir(false)}>Cancelar</Button><Button variant="outline" onClick={() => { window.open(`/api/gestao/pessoas/${id}/ficha?formato=doc`, "_self"); setImprimir(false); }}><Download className="h-4 w-4" /> Baixar para editar (Word)</Button>{gerir && <Button variant="outline" onClick={() => abrirFicha(true)}><ShieldAlert className="h-4 w-4" /> Com senhas</Button>}<Button onClick={() => abrirFicha(false)}><Printer className="h-4 w-4" /> Imprimir</Button></div>}>
        <div className="space-y-3 text-sm text-zinc-600 dark:text-zinc-300"><p>A ficha traz os dados do cadastro, a foto, os campos personalizados e os processos vinculados. Por segurança, as <b>senhas saem ocultas</b>; use “Com senhas” só se for guardar o papel com cuidado (isso fica registrado).</p><p>Quer mudar o visual (logotipo, cabeçalho, o que aparece)? <Link className="text-accent-700 underline" to="/gestao/ficha">Personalizar o modelo da ficha</Link>. Para editar livremente, baixe em Word.</p></div>
      </Modal>
      <Modal open={criado !== null} onClose={() => { const c = criado; setCriado(null); navegar(`/gestao/clientes/${c}`); }} title="Cadastro criado" description="O que deseja fazer agora?" maxWidth="max-w-md"
        footer={<div className="flex w-full flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => { const c = criado!; setCriado(null); navegar(`/gestao/clientes/${c}`); }}>Abrir o cadastro</Button><Button variant="outline" onClick={() => { const c = criado!; abrirFicha(false, c); setCriado(null); navegar(`/gestao/clientes/${c}`); }}><Printer className="h-4 w-4" /> Imprimir ficha</Button><Button onClick={() => { const c = criado!; setCriado(null); navegar(`/gestao/clientes/${c}?aba=processos`); }}><Plus className="h-4 w-4" /> Cadastrar processo</Button></div>}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{pessoa.nome} foi cadastrado(a). Você pode imprimir a ficha de cadastro agora ou já registrar o processo.</p>
      </Modal>
      <ConfirmDialog open={apagar} title="Excluir cadastro" message={`Excluir ${pessoa.nome}? Quem participa de processos não pode ser excluído; nesse caso, desmarque "Cadastro ativo".`} confirmLabel="Excluir" onConfirm={() => void excluir()} onCancel={() => setApagar(false)}>
        {pericias.length > 0 && (
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <input type="checkbox" className="mt-0.5" checked={cancelarPericias} onChange={(e) => setCancelarPericias(e.target.checked)} />
            <span>Há <b>{pericias.length}</b> perícia(s)/audiência(s) agendada(s) para o telefone desta pessoa ({pericias.slice(0, 3).map((x) => `${x.tipo} ${dataBr(x.data)}`).join("; ")}{pericias.length > 3 ? "…" : ""}). Cancelar junto? Se desmarcar, elas continuam na agenda e podem aparecer para quem usar este número depois.</span>
          </label>)}
      </ConfirmDialog>
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
          <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">{proximas.map((p) => <Item key={p.id} p={p} />)}{passadas.map((p) => <Item key={p.id} p={p} />)}</ul>)}
        <p className="mt-2 text-xs text-zinc-500">Os lembretes por WhatsApp continuam em <Link className="text-accent-700 underline" to="/calendario">Perícias e avisos → Calendário</Link>.</p>
      </section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Tarefas em aberto ({d.tarefas.length})</h3>
        {d.tarefas.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700">Nenhuma tarefa em aberto para esta pessoa ou seus processos.</p> : (
          <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">{d.tarefas.map((t) => <li key={t.id} className="px-4 py-2.5 text-sm"><span className="font-medium text-zinc-900 dark:text-zinc-100">{t.titulo}</span> <span className="text-xs text-zinc-500">{t.prazo ? `· prazo ${dataBr(t.prazo)}` : ""}{t.processo_pasta ? ` · Pasta ${t.processo_pasta}` : ""}{t.prazo_fatal ? " · FATAL" : ""}</span></li>)}</ul>)}
      </section>
    </div>
  );
}
