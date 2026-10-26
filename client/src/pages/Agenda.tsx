import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  FileText,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  StickyNote,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { Contact } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { SelectableCard } from "@/components/ui/SelectableCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorkspacePanel, WorkspaceRow } from "@/components/ui/Workspace";

const ITENS_POR_PAGINA = 20;
const LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function inicialSemAcento(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .charAt(0)
    .toUpperCase();
}

export function Agenda() {
  const { show } = useToast();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [busca, setBusca] = useState("");
  const [letra, setLetra] = useState<string | null>(null);
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
  const [expandido, setExpandido] = useState<number | null>(null);
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
    return contacts.filter((c) => {
      if (letra && inicialSemAcento(c.nome) !== letra) return false;
      if (!termo) return true;
      return (
        c.nome.toLowerCase().includes(termo) ||
        Boolean(termoDigits && c.telefone.replace(/\D/g, "").includes(termoDigits)) ||
        Boolean(termoDigits && (c.processo || "").replace(/\D/g, "").includes(termoDigits))
      );
    });
  }, [contacts, busca, letra]);

  useEffect(() => {
    setPagina(0);
  }, [busca, letra]);

  const contatosPaginados = useMemo(
    () => filtrados.slice(pagina * ITENS_POR_PAGINA, (pagina + 1) * ITENS_POR_PAGINA),
    [filtrados, pagina]
  );

  const resumo = useMemo(() => {
    const lista = contacts ?? [];
    const comProcesso = lista.filter((contato) => Boolean(contato.processo?.trim())).length;
    return { total: lista.length, comProcesso, semProcesso: lista.length - comProcesso };
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

  return (
    <div className="space-y-5 md:space-y-6">
      <PageHeader
        title="Contatos"
        description="Contatos usados para identificar cada cliente com segurança pelo nome completo e número do processo."
        actions={<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.vcf,text/csv,text/vcard"
            className="hidden"
            onChange={handleArquivoSelecionado}
          />
          <Button className="col-span-2 sm:order-3 sm:col-auto" onClick={abrirNovo}>
            <Plus className="h-4 w-4" /> Novo contato
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} loading={importando}>
            <Upload className="h-4 w-4" /> Importar
          </Button>
          <Button variant="outline" onClick={() => window.open("/api/contacts/export", "_blank")}>
            <Download className="h-4 w-4" /> Exportar
          </Button>
        </div>}
      />

      <WorkspacePanel title="Seus contatos" description="Dados usados na identificação e nos avisos aos clientes."
        aside={<span className="text-xs text-zinc-500 dark:text-zinc-400">{resumo.total} contatos · {resumo.comProcesso} com processo · {resumo.semProcesso} sem processo</span>}
        toolbar={<div className="space-y-4">
          <div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input aria-label="Buscar contatos" placeholder="Buscar nome, telefone ou processo…" className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} /></div>
          <nav aria-label="Filtrar contatos pela inicial" className="scrollbar-thin flex gap-1 overflow-x-auto pb-1">
            <button type="button" onClick={() => setLetra(null)} className={cn("shrink-0 rounded-md px-3 py-1.5 text-xs", letra === null ? "bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" : "text-zinc-500 dark:text-zinc-400")}>Todos</button>
            {LETRAS.map(item => <button key={item} type="button" onClick={() => setLetra(letra === item ? null : item)} className={cn("h-7 w-7 shrink-0 rounded-md text-xs", letra === item ? "bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" : "text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800")}>{item}</button>)}
          </nav>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400"><Checkbox checked={contatosPaginados.length > 0 && contatosPaginados.every(c => selecionados.has(c.id))} onChange={alternarSelecionarTodos} />Selecionar esta página · {filtrados.length} resultados</label>
            {selecionados.size > 0 && <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button><Button variant="outline" className="danger-action" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}><Trash2 className="h-3.5 w-3.5" /> Apagar selecionados ({selecionados.size})</Button></div>}
          </div>
        </div>}
        footer="Importação disponível em CSV do Google/Android ou vCard (.vcf)."
      >
        {contacts === null ? <div className="p-5"><Skeleton className="h-40" /></div> : filtrados.length === 0 ? <EmptyState icon={Users} title={busca || letra ? "Nenhum contato encontrado" : "Nenhum contato cadastrado ainda"} description="Adicione um contato ou ajuste os filtros da busca." action={!busca && !letra && <Button onClick={abrirNovo}>Novo contato</Button>} /> : <>
          {contatosPaginados.map(c => <WorkspaceRow key={c.id} selected={selecionados.has(c.id)}
            selection={<Checkbox aria-label={`Selecionar ${c.nome}`} checked={selecionados.has(c.id)} onChange={() => alternarSelecionado(c.id)} />}
            primary={<div><h3 className="break-words text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</h3><p className="mt-1 break-all text-xs text-zinc-500 dark:text-zinc-400">{c.processo || "Processo não informado"}</p></div>}
            secondary={<span className="inline-flex items-center gap-2 text-sm"><Phone className="h-3.5 w-3.5 text-zinc-400" />{formatPhoneDisplay(c.telefone)}</span>}
            actions={<>
              {c.observacoes && <Button size="sm" variant="ghost" aria-expanded={expandido === c.id} onClick={() => setExpandido(expandido === c.id ? null : c.id)}><StickyNote className="h-3.5 w-3.5" /> Observações</Button>}
              <Button size="sm" variant="outline" aria-label={`Editar ${c.nome}`} onClick={() => abrirEdicao(c)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
              <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" aria-label={`Apagar ${c.nome}`} onClick={() => setExcluirAlvo(c)} loading={excluindo === c.id}><Trash2 className="h-3.5 w-3.5" /> Apagar</Button>
            </>}
          >{expandido === c.id && c.observacoes && <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Observações</p><p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{c.observacoes}</p></div>}</WorkspaceRow>)}
          <div className="border-t border-zinc-200 px-5 py-4 dark:border-zinc-800"><Pagination page={pagina} totalItems={filtrados.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPagina} /></div>
        </>}
      </WorkspacePanel>

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

