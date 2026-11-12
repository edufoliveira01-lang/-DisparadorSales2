import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import type { Contact } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import { useAtendimentoLiberado } from "@/pages/gestao/AvatarPessoa";
import { useAuth } from "@/context/AuthContext";

const ITENS_POR_PAGINA = 20;
const FILTROS = [["todos", "Todos"], ["com_processo", "Com processo"], ["sem_processo", "Sem processo"], ["conferir", "Telefone a conferir"]] as const;
type Filtro = (typeof FILTROS)[number][0];
/** Telefone brasileiro com DDD (10 ou 11 dígitos, com ou sem o 55). Fora disso o aviso não chega: vale conferir. */
function telefoneOk(t: string): boolean {
  let d = t.replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  return d.length === 10 || d.length === 11;
}
const iniciais = (nome: string) => nome.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

export function Agenda() {
  const { can } = useAuth();
  const canManage = can("contacts.manage");
  const { show } = useToast();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ordem, setOrdem] = useState<"nome" | "recentes">("nome");
  const atendimento = useAtendimentoLiberado();
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Contact | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [processo, setProcesso] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState<number | null>(null);
  const [importando, setImportando] = useState(false);
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [apagandoSelecionados, setApagandoSelecionados] = useState(false);
  const [excluirAlvo, setExcluirAlvo] = useState<Contact | null>(null);
  const [confirmMassaAberto, setConfirmMassaAberto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function carregar() {
    const data = await api.get<Contact[]>("/contacts");
    setContacts(data);
  }

  useEffect(() => {
    carregar();
  }, []);

  const filtrados = useMemo(() => {
    if (!contacts) return [];
    const termo = busca.trim().toLowerCase();
    const termoDigits = termo.replace(/\D/g, "");
    const lista = contacts.filter((c) => {
      if (filtro === "com_processo" && !c.processo?.trim()) return false;
      if (filtro === "sem_processo" && c.processo?.trim()) return false;
      if (filtro === "conferir" && telefoneOk(c.telefone)) return false;
      if (!termo) return true;
      return (
        c.nome.toLowerCase().includes(termo) ||
        Boolean(termoDigits && c.telefone.replace(/\D/g, "").includes(termoDigits)) ||
        Boolean(termoDigits && (c.processo || "").replace(/\D/g, "").includes(termoDigits))
      );
    });
    return ordem === "nome" ? [...lista].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) : [...lista].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [contacts, busca, filtro, ordem]);

  useEffect(() => {
    setPagina(0);
  }, [busca, filtro, ordem]);

  const contatosPaginados = useMemo(
    () => filtrados.slice(pagina * ITENS_POR_PAGINA, (pagina + 1) * ITENS_POR_PAGINA),
    [filtrados, pagina]
  );

  const resumo = useMemo(() => {
    const lista = contacts ?? [];
    const comProcesso = lista.filter((contato) => Boolean(contato.processo?.trim())).length;
    return { total: lista.length, comProcesso, semProcesso: lista.length - comProcesso, conferir: lista.filter((c) => !telefoneOk(c.telefone)).length };
  }, [contacts]);

  useEffect(() => {
    const ultimaPagina = Math.max(0, Math.ceil(filtrados.length / ITENS_POR_PAGINA) - 1);
    if (pagina > ultimaPagina) setPagina(ultimaPagina);
  }, [filtrados, pagina]);

  function abrirNovo() {
    setEditando(null);
    setNome("");
    setTelefone("");
    setProcesso("");
    setObservacoes("");
    setModalAberto(true);
  }

  function abrirEdicao(contact: Contact) {
    setEditando(contact);
    setNome(contact.nome);
    setTelefone(formatPhoneDisplay(contact.telefone));
    setProcesso(contact.processo || "");
    setObservacoes(contact.observacoes || "");
    setModalAberto(true);
  }

  async function salvar() {
    setSalvando(true);
    try {
      if (editando) {
        await api.put(`/contacts/${editando.id}`, { nome, telefone, processo, observacoes });
        show("Contato atualizado.", "success");
      } else {
        await api.post("/contacts", { nome, telefone, processo, observacoes });
        show("Contato adicionado.", "success");
      }
      setModalAberto(false);
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar contato.", "error");
    } finally {
      setSalvando(false);
    }
  }

  async function handleArquivoSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportando(true);
    try {
      const content = await file.text();
      const resultado = await api.post<{ total: number; criados: number; ignorados: number }>("/contacts/import", {
        content,
      });
      show(
        `${resultado.criados} contato(s) importado(s)` +
          (resultado.ignorados > 0 ? ` · ${resultado.ignorados} ignorado(s) (duplicado ou sem telefone)` : "."),
        "success"
      );
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao importar arquivo.", "error");
    } finally {
      setImportando(false);
    }
  }

  async function excluir(id: number) {
    setExcluindo(id);
    try {
      await api.delete(`/contacts/${id}`);
      show("Contato removido.", "info");
      setSelecionados((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao remover contato.", "error");
    } finally {
      setExcluindo(null);
    }
  }

  async function confirmarExcluir() {
    if (!excluirAlvo) return;
    const alvo = excluirAlvo;
    setExcluirAlvo(null);
    await excluir(alvo.id);
  }

  async function excluirSelecionados() {
    if (selecionados.size === 0) return;
    setApagandoSelecionados(true);
    try {
      const ids = Array.from(selecionados);
      await api.post("/contacts/apagar-em-massa", { ids });
      show(`${ids.length} contato(s) removido(s).`, "success");
      setSelecionados(new Set());
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao remover contatos selecionados.", "error");
    } finally {
      setApagandoSelecionados(false);
    }
  }

  async function confirmarExcluirSelecionados() {
    setConfirmMassaAberto(false);
    await excluirSelecionados();
  }

  function alternarSelecionado(id: number) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function alternarSelecionarTodos() {
    setSelecionados((prev) => {
      const todosMarcados = contatosPaginados.length > 0 && contatosPaginados.every((c) => prev.has(c.id));
      const next = new Set(prev);
      for (const contato of contatosPaginados) {
        if (todosMarcados) next.delete(contato.id);
        else next.add(contato.id);
      }
      return next;
    });
  }

  const paginaMarcada = contatosPaginados.length > 0 && contatosPaginados.every((c) => selecionados.has(c.id));
  const contagens: Record<Filtro, number> = { todos: resumo.total, com_processo: resumo.comProcesso, sem_processo: resumo.semProcesso, conferir: resumo.conferir };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Contatos do WhatsApp"
        description="Quem recebe os avisos do escritório: nome, telefone e, se houver, o processo. O nome e o processo confirmam o cliente certo."
        actions={<div className="flex flex-wrap items-center gap-2">
          {canManage && <input ref={fileInputRef} type="file" accept=".csv,.vcf,text/csv,text/vcard" className="hidden" onChange={handleArquivoSelecionado} />}
          {canManage && <Button variant="outline" onClick={() => fileInputRef.current?.click()} loading={importando} title="Importar CSV do Google/Android ou vCard (.vcf)"><Upload className="h-4 w-4" /> Importar</Button>}
          <Button variant="outline" onClick={() => window.open("/api/contacts/export", "_blank")}><Download className="h-4 w-4" /> Exportar</Button>
          {canManage && <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Novo contato</Button>}
        </div>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {FILTROS.map(([k, rotulo]) => (
          <button key={k} type="button" onClick={() => setFiltro(filtro === k && k !== "todos" ? "todos" : k)} aria-pressed={filtro === k}
            className={`rounded-2xl border p-4 text-left transition ${filtro === k ? "border-accent-500 bg-accent-50 dark:bg-accent-500/10" : "border-zinc-200 bg-white hover:border-accent-400 dark:border-zinc-800 dark:bg-zinc-900"} ${k === "conferir" && contagens[k] > 0 && filtro !== k ? "border-amber-300 dark:border-amber-700" : ""}`}>
            <span className={`block text-2xl font-semibold leading-none ${k === "conferir" && contagens[k] > 0 ? "text-amber-700 dark:text-amber-300" : ""}`}>{contagens[k]}</span>
            <span className="mt-1.5 block text-xs text-zinc-500">{rotulo}</span>
          </button>))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input aria-label="Buscar contatos" placeholder="Buscar nome, telefone ou processo…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <Select aria-label="Ordenar contatos" className="sm:max-w-[200px]" value={ordem} onChange={(e) => setOrdem(e.target.value as "nome" | "recentes")}><option value="nome">Nome (A–Z)</option><option value="recentes">Mais recentes</option></Select>
        {canManage && contatosPaginados.length > 0 && <label className="flex shrink-0 cursor-pointer items-center gap-2 px-1 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={paginaMarcada} onChange={alternarSelecionarTodos} /> Marcar esta página</label>}
      </div>

      {canManage && selecionados.size > 0 && <div role="region" aria-label="Ações em lote" className="sticky top-20 z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-300 bg-accent-50 px-4 py-2.5 shadow-sm dark:border-accent-800 dark:bg-accent-950">
        <strong className="text-sm">{selecionados.size} contato(s) selecionado(s)</strong>
        <span className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button><Button variant="outline" className="danger-action" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}><Trash2 className="h-3.5 w-3.5" /> Apagar selecionados</Button></span>
      </div>}

      {contacts === null ? <Skeleton className="h-56" /> : filtrados.length === 0 ? (
        <EmptyState icon={Users} title={busca || filtro !== "todos" ? "Nenhum contato encontrado" : "Nenhum contato cadastrado ainda"} description={busca || filtro !== "todos" ? "Tente outra busca ou volte para «Todos»." : "Adicione um contato ou importe um arquivo do Google/Android ou vCard (.vcf)."} action={canManage && !busca && filtro === "todos" ? <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Novo contato</Button> : undefined} />
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
          {contatosPaginados.map((c) => { const ok = telefoneOk(c.telefone); return (
            <li key={c.id} className={`flex items-center gap-3 px-4 py-3 transition hover:bg-accent-50/40 dark:hover:bg-white/5 ${selecionados.has(c.id) ? "bg-accent-50/60 dark:bg-accent-500/10" : ""}`}>
              {canManage && <Checkbox aria-label={`Selecionar ${c.nome}`} checked={selecionados.has(c.id)} onChange={() => alternarSelecionado(c.id)} />}
              <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center sm:flex justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-700 dark:bg-accent-500/20 dark:text-accent-200">{iniciais(c.nome) || "?"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{c.nome}</h3>{!ok && <Badge tone="warning">Telefone a conferir</Badge>}</div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500"><span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{formatPhoneDisplay(c.telefone)}</span>{c.processo && <span className="font-mono">Proc. {c.processo}</span>}</p>
                {c.observacoes && <p className="mt-1 truncate text-xs text-zinc-500" title={c.observacoes}>{c.observacoes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {atendimento && ok && <a href={`/api/atendimento/entrar?telefone=${(() => { const d = c.telefone.replace(/\D/g, ""); return d.startsWith("55") ? d : `55${d}`; })()}`} target="_blank" rel="noopener noreferrer" aria-label={`Abrir a conversa de ${c.nome} no atendimento`} title="Abrir conversa no atendimento" className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"><MessageCircle className="h-4 w-4" /></a>}
                {canManage && <Button size="sm" variant="outline" aria-label={`Editar ${c.nome}`} onClick={() => abrirEdicao(c)}><Pencil className="h-3.5 w-3.5" /><span className="hidden sm:inline"> Editar</span></Button>}
                {canManage && <MenuSuspenso gatilho={({ aberto, alternar }) => <button type="button" aria-label={`Mais ações para ${c.nome}`} aria-expanded={aberto} onClick={alternar} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><MoreHorizontal className="h-4 w-4" /></button>}>
                  {(fechar) => <button type="button" role="menuitem" className="menu-pop-item text-red-600 dark:text-red-400" onClick={() => { fechar(); setExcluirAlvo(c); }}><Trash2 className="h-4 w-4" /> Apagar contato</button>}
                </MenuSuspenso>}
              </div>
            </li>); })}
        </ul>
      )}
      {filtrados.length > ITENS_POR_PAGINA && <Pagination page={pagina} totalItems={filtrados.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPagina} />}
      {filtrados.length > 0 && <p className="text-right text-xs text-zinc-500">{filtrados.length} contato(s){filtro !== "todos" || busca ? " neste filtro" : ""}</p>}

      <Modal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        title={editando ? "Editar contato" : "Adicionar contato"}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={salvar} loading={salvando} disabled={!nome.trim() || !telefone.trim()}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo do cliente" />
          </div>
          <div>
            <Label>Telefone</Label>
            <Input
              value={telefone}
              onChange={(e) => setTelefone(formatPhoneInput(e.target.value))}
              placeholder="Ex: (11) 99999-8888"
            />
            <p className="mt-1 text-xs text-zinc-400">DDD + número. Números antigos de 8 dígitos ficam (XX) XXXX-XXXX.</p>
          </div>
          <div>
            <Label>Número do processo</Label>
            <Input
              value={processo}
              onChange={(e) => setProcesso(e.target.value)}
              placeholder="Ex: 5364774-26.2026.8.09.0006"
            />
            <p className="mt-1 text-xs text-zinc-400">Usado junto com o nome para confirmar o cliente correto no Dashboard.</p>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Opcional" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={excluirAlvo !== null}
        title="Apagar contato?"
        message={`Isso vai apagar em definitivo o contato "${excluirAlvo?.nome}". Essa ação não pode ser desfeita.`}
        loading={excluindo === excluirAlvo?.id}
        onConfirm={confirmarExcluir}
        onCancel={() => setExcluirAlvo(null)}
      />
      <ConfirmDialog
        open={confirmMassaAberto}
        title="Apagar contatos selecionados?"
        message={`Isso vai apagar em definitivo ${selecionados.size} contato(s) selecionado(s), em todas as páginas. Essa ação não pode ser desfeita.`}
        confirmLabel="Apagar selecionados"
        loading={apagandoSelecionados}
        onConfirm={confirmarExcluirSelecionados}
        onCancel={() => setConfirmMassaAberto(false)}
      />
    </div>
  );
}

