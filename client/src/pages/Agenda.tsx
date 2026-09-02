import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 md:text-3xl">Agenda</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Contatos usados para identificar cada cliente pelo nome completo e número do processo.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.vcf,text/csv,text/vcard"
            className="hidden"
            onChange={handleArquivoSelecionado}
          />
          <Button className="col-span-2 lg:order-3 lg:col-auto" onClick={abrirNovo}>
            <Plus className="h-4 w-4" /> Novo contato
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} loading={importando}>
            <Upload className="h-4 w-4" /> Importar
          </Button>
          <Button variant="outline" onClick={() => window.open("/api/contacts/export", "_blank")}>
            <Download className="h-4 w-4" /> Exportar
          </Button>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-soft dark:border-zinc-800 dark:bg-zinc-900 md:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Buscar nome, telefone ou processo…"
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="h-4 w-4 text-accent-600 dark:text-accent-400" />
            <span>{filtrados.length} de {contacts?.length ?? 0} contato(s)</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          A importação aceita CSV do Google/Android e arquivos vCard (.vcf).
        </p>
      </section>

      <nav
        aria-label="Filtrar contatos pela inicial"
        className="scrollbar-thin flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <button
          type="button"
          onClick={() => setLetra(null)}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            letra === null
              ? "bg-accent-500 text-white"
              : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          )}
        >
          Todos
        </button>
        {LETRAS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setLetra(letra === item ? null : item)}
            className={cn(
              "h-7 w-7 shrink-0 rounded-md text-xs font-medium transition-colors",
              letra === item
                ? "bg-accent-500 text-white"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
          >
            {item}
          </button>
        ))}
      </nav>

      {selecionados.size > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 dark:border-accent-900 dark:bg-accent-900/20 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-accent-800 dark:text-accent-300">
            {selecionados.size} contato(s) selecionado(s)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>
              Limpar seleção
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmMassaAberto(true)} loading={apagandoSelecionados}>
              <Trash2 className="h-3.5 w-3.5" /> Apagar selecionados
            </Button>
          </div>
        </div>
      )}

      {contacts === null ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={Users}
          title={busca || letra ? "Nenhum contato encontrado" : "Nenhum contato cadastrado ainda"}
          description={busca || letra ? "Tente ajustar a busca ou escolher outra inicial." : "Adicione contatos para o sistema localizar cada cliente automaticamente."}
          action={!busca && !letra && <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Novo contato</Button>}
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            <div className="flex items-center gap-2 px-1 text-sm text-zinc-500 dark:text-zinc-400">
              <Checkbox
                checked={contatosPaginados.length > 0 && contatosPaginados.every((c) => selecionados.has(c.id))}
                onChange={alternarSelecionarTodos}
              />
              <span>Selecionar todos nesta página</span>
            </div>
            {contatosPaginados.map((c) => {
              const aberto = expandido === c.id;
              return (
                <SelectableCard key={c.id} checked={selecionados.has(c.id)} onToggle={() => alternarSelecionado(c.id)}>
                  <button
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => setExpandido(aberto ? null : c.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{c.nome}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                        <Phone className="h-3.5 w-3.5" /> {formatPhoneDisplay(c.telefone)}
                      </span>
                    </span>
                    {aberto ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
                    )}
                  </button>

                  {aberto && (
                    <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Número do processo</p>
                        <p className="mt-1 flex items-start gap-1.5 break-all text-sm text-zinc-700 dark:text-zinc-300">
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {c.processo || "Não informado"}
                        </p>
                      </div>
                      {c.observacoes && (
                        <div>
                          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                            <StickyNote className="h-3.5 w-3.5 text-amber-500" /> Observações
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{c.observacoes}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" onClick={() => abrirEdicao(c)}>
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setExcluirAlvo(c)} loading={excluindo === c.id}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" /> Apagar
                        </Button>
                      </div>
                    </div>
                  )}
                </SelectableCard>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 shadow-soft dark:border-zinc-800 md:block">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-center text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="w-10 px-5 py-3">
                    <Checkbox
                      checked={contatosPaginados.length > 0 && contatosPaginados.every((c) => selecionados.has(c.id))}
                      onChange={alternarSelecionarTodos}
                    />
                  </th>
                  <th className="px-5 py-3">Nome</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Processo</th>
                  <th className="w-16 px-5 py-3">Obs.</th>
                  <th className="px-5 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {contatosPaginados.map((c) => {
                  const aberto = expandido === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr
                        className={cn(
                          "bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50",
                          c.observacoes && "cursor-pointer"
                        )}
                        onClick={c.observacoes ? () => setExpandido(aberto ? null : c.id) : undefined}
                      >
                        <td className="px-5 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selecionados.has(c.id)} onChange={() => alternarSelecionado(c.id)} />
                        </td>
                        <td className="max-w-[280px] break-words px-5 py-3 text-left font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-center text-zinc-600 dark:text-zinc-400">{formatPhoneDisplay(c.telefone)}</td>
                        <td className="max-w-[230px] px-5 py-3 text-center text-zinc-600 dark:text-zinc-400">
                          <span className="break-all">{c.processo || "Não informado"}</span>
                        </td>
                        <td className="px-5 py-3 text-center">
                          {c.observacoes && (
                            <span title="Tem observação">
                              <StickyNote className="h-4 w-4 text-amber-500" />
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-center gap-1">
                            {c.observacoes && (
                              <Button variant="ghost" size="icon" title="Ver observação" onClick={() => setExpandido(aberto ? null : c.id)}>
                                {aberto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => abrirEdicao(c)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setExcluirAlvo(c)} loading={excluindo === c.id}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {aberto && c.observacoes && (
                        <tr className="bg-zinc-50 dark:bg-zinc-800/30">
                          <td colSpan={6} className="px-5 py-4">
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Observações</p>
                            <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{c.observacoes}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={pagina} totalItems={filtrados.length} pageSize={ITENS_POR_PAGINA} onPageChange={setPagina} />
        </>
      )}

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
