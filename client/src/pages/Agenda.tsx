import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Contact } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

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
    return contacts.filter((c) => c.nome.toLowerCase().includes(termo) || c.telefone.includes(termo));
  }, [contacts, busca]);

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
    setTelefone(contact.telefone);
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
      carregar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao remover contato.", "error");
    } finally {
      setExcluindo(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Agenda</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Contatos usados para cruzar com o nome do cliente no card.</p>
        </div>
        <div className="flex gap-2">
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

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input placeholder="Buscar por nome ou telefone…" className="pl-9" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <p className="-mt-4 text-xs text-zinc-400">
        Aceita CSV exportado do Google/Android (Contatos → Exportar) ou arquivo vCard (.vcf).
      </p>

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
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
              <tr>
                <th className="px-5 py-3">Nome</th>
                <th className="px-5 py-3">Telefone</th>
                <th className="px-5 py-3">Observações</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtrados.map((c) => (
                <tr key={c.id} className="bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
                  <td className="px-5 py-3 font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</td>
                  <td className="px-5 py-3 text-zinc-600 dark:text-zinc-400">{c.telefone}</td>
                  <td className="px-5 py-3 text-zinc-500 dark:text-zinc-400">{c.observacoes || "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => abrirEdicao(c)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => excluir(c.id)} loading={excluindo === c.id}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Ex: 5511999999999" />
            <p className="mt-1 text-xs text-zinc-400">Formato internacional, sem espaços ou símbolos: 55DDDNÚMERO.</p>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Opcional" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
