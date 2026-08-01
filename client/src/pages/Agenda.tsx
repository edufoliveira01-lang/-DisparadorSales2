import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, Upload, Users } from "lucide-react";
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
import { CardField, SelectableCard } from "@/components/ui/SelectableCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const ITENS_POR_PAGINA = 20;

export function Agenda() {
  const { show } = useToast();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Contact | null>(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
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
    if (!termo) return contacts;
    const termoDigits = termo.replace(/\D/g, "");
    return contacts.filter(
      (c) => c.nome.toLowerCase().includes(termo) || (termoDigits && c.telefone.replace(/\D/g, "").includes(termoDigits))
    );
  }, [contacts, busca]);

  useEffect(() => {
    setPagina(0);
  }, [busca]);

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
    setObservacoes("");
    setModalAberto(true);
  }

  function abrirEdicao(contact: Contact) {
    setEditando(contact);
    setNome(contact.nome);
    setTelefone(formatPhoneDisplay(contact.telefone));
    setObservacoes(contact.observacoes || "");
    setModalAberto(true);
  }

  async function salvar() {
    setSalvando(true);
    try {
      if (editando) {
        await api.put(`/contacts/${editando.id}`, { nome, telefone, observacoes });
        show("Contato atualizado.", "success");
      } else {
        await api.post("/contacts", { nome, telefone, observacoes });
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Agenda</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Contatos usados para cruzar com o nome do cliente no card.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.vcf,text/csv,text/vcard"
            className="hidden"
            onChange={handleArquivoSelecionado}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} loading={importando}>
            <Upload className="h-4 w-4" /> Importar CSV/vCard
          </Button>
          <Button onClick={abrirNovo}>
            <Plus className="h-4 w-4" /> Adicionar contato
          </Button>
        </div>
      </div>

      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input placeholder="Buscar por nome ou telefone…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <p className="-mt-4 text-xs text-zinc-400">
        Aceita CSV exportado do Google/Android (Contatos → Exportar) ou arquivo vCard (.vcf).
      </p>

      {selecionados.size > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 dark:border-accent-900 dark:bg-accent-900/20">
          <p className="text-sm font-medium text-accent-800 dark:text-accent-300">
            {selecionados.size} contato(s) selecionado(s)
          </p>
          <div className="flex gap-2">
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
          title={busca ? "Nenhum contato encontrado" : "Nenhum contato cadastrado ainda"}
          description={busca ? "Tente buscar por outro nome ou telefone." : "Adicione contatos para que o sistema encontre o telefone de cada cliente automaticamente."}
          action={!busca && <Button onClick={abrirNovo}><Plus className="h-4 w-4" /> Adicionar contato</Button>}
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <Checkbox
                checked={contatosPaginados.length > 0 && contatosPaginados.every((c) => selecionados.has(c.id))}
                onChange={alternarSelecionarTodos}
              />
              <span>Selecionar todos nesta página</span>
            </div>
            {contatosPaginados.map((c) => (
              <SelectableCard key={c.id} checked={selecionados.has(c.id)} onToggle={() => alternarSelecionado(c.id)}>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</p>
                <CardField label="Telefone" value={formatPhoneDisplay(c.telefone)} />
                {c.observacoes && <CardField label="Observações" value={c.observacoes} />}
                <div className="flex justify-end gap-1 pt-1">
                  <Button variant="ghost" size="icon" onClick={() => abrirEdicao(c)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setExcluirAlvo(c)} loading={excluindo === c.id}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </SelectableCard>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 md:block">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                <tr>
                  <th className="w-10 px-5 py-3">
                    <Checkbox
                      checked={contatosPaginados.length > 0 && contatosPaginados.every((c) => selecionados.has(c.id))}
                      onChange={alternarSelecionarTodos}
                    />
                  </th>
                  <th className="whitespace-nowrap px-5 py-3">Nome</th>
                  <th className="whitespace-nowrap px-5 py-3">Telefone</th>
                  <th className="whitespace-nowrap px-5 py-3">Observações</th>
                  <th className="whitespace-nowrap px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {contatosPaginados.map((c) => (
                  <tr key={c.id} className="bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
                    <td className="px-5 py-3">
                      <Checkbox checked={selecionados.has(c.id)} onChange={() => alternarSelecionado(c.id)} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-zinc-600 dark:text-zinc-400">{formatPhoneDisplay(c.telefone)}</td>
                    <td className="max-w-xs truncate px-5 py-3 text-zinc-500 dark:text-zinc-400">{c.observacoes || "—"}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => abrirEdicao(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setExcluirAlvo(c)} loading={excluindo === c.id}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
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
