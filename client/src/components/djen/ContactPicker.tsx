import { useAuth } from "@/context/AuthContext";
import { useMemo, useState } from "react";
import type { Contact } from "@/lib/types";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function ContactPicker({
  contatos,
  value,
  onChange,
  processo,
  onCreated,
}: {
  contatos: Contact[];
  value: string;
  onChange: (id: string) => void;
  processo: string;
  onCreated: (c: Contact) => void;
}) {
  const { can } = useAuth();
  const [busca, setBusca] = useState(""),
    [criando, setCriando] = useState(false),
    [busy, setBusy] = useState(false),
    [nome, setNome] = useState(""),
    [telefone, setTelefone] = useState("");
  const { show } = useToast(),
    selecionado = contatos.find((c) => String(c.id) === value);
  const encontrados = useMemo(() => {
    const termos = norm(busca).split(/\s+/).filter(Boolean);
    return contatos
      .filter((c) =>
        termos.length
          ? termos.every(
              (t) =>
                norm(`${c.nome} ${c.telefone} ${c.processo || ""}`).includes(
                  t,
                ) ||
                (/^[\d()+.-]+$/.test(t) &&
                  [c.telefone, c.processo || ""].some((v) =>
                    v.replace(/\D/g, "").includes(t.replace(/\D/g, "")),
                  )),
            )
          : Boolean(
              processo.replace(/\D/g, "") &&
                c.processo
                  ?.replace(/\D/g, "")
                  .includes(processo.replace(/\D/g, "")),
            ),
      )
      .slice(0, 12);
  }, [busca, contatos, processo]);
  return (
    <div className="space-y-3">
      <Label htmlFor="buscar-cliente-processo">
        Buscar cliente por nome, telefone ou processo
      </Label>
      <Input
        id="buscar-cliente-processo"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Digite para pesquisar na Agenda…"
      />
      {selecionado && (
        <div className="rounded-lg bg-accent-50 p-3 text-xs dark:bg-zinc-800">
          <strong>Selecionado: {selecionado.nome}</strong>
          <p>
            {selecionado.telefone} · {selecionado.processo}
          </p>
          <Button variant="ghost" size="sm" onClick={() => onChange("")}>
            Remover seleção
          </Button>
        </div>
      )}
      <div
        role="group"
        aria-label="Resultados da busca de cliente"
        className="max-h-56 space-y-1 overflow-y-auto"
      >
        {encontrados.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={String(c.id) === value}
            className="block w-full rounded-lg border border-zinc-200 p-3 text-left text-xs hover:bg-accent-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            onClick={() => {
              onChange(String(c.id));
              setBusca("");
            }}
          >
            <strong>{c.nome}</strong>
            <p className="mt-1 text-zinc-500">
              {c.telefone} {c.processo ? `· ${c.processo}` : ""}
            </p>
          </button>
        ))}
        {!encontrados.length && (
          <p className="text-xs text-zinc-500">
            {busca
              ? "Nenhum contato encontrado."
              : "Digite um nome ou telefone. Contatos com o mesmo processo aparecem aqui como sugestão."}
          </p>
        )}
      </div>
      {can("contacts.manage") && <Button size="sm" variant="outline" onClick={() => setCriando(!criando)}>Cadastrar novo cliente</Button>}
      {criando && (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="novo-cliente-nome">Nome do cliente</Label>
            <Input
              id="novo-cliente-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="novo-cliente-telefone">WhatsApp do cliente</Label>
            <Input
              id="novo-cliente-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="DDD + número"
            />
          </div>
          <Button
            size="sm"
            loading={busy}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              void api
                .post<Contact>("/contacts", {
                  nome,
                  telefone,
                  processo,
                  observacoes: "",
                })
                .then((c) => {
                  onCreated(c);
                  onChange(String(c.id));
                  setCriando(false);
                  setNome("");
                  setTelefone("");
                  show(
                    "Contato cadastrado. Salve o vínculo com este processo.",
                    "success",
                  );
                })
                .catch((e) =>
                  show(
                    e instanceof ApiError
                      ? e.message
                      : "Não foi possível cadastrar.",
                    "error",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            Cadastrar e selecionar
          </Button>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">
        A seleção é explícita. Clique em Salvar dados do processo para confirmar
        o vínculo.
      </p>
    </div>
  );
}
