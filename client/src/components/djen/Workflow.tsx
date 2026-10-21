import { DeadlineSuggestion } from "./DeadlineSuggestion";
import { useState } from "react";
import {
  ExternalLink,
  FileText,
  CalendarDays,
  History,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
export interface Prazo {
  id: number;
  descricao: string;
  inicio: string | null;
  termino: string | null;
  status: string;
  observacoes: string;
}
export interface Documento {
  id: number;
  nome: string;
  url: string;
}
export interface Andamento {
  id: number;
  data_disponibilizacao: string;
  categorias_json: string;
  resultado: string;
  situacao?: string;
  resumo: string | null;
  orgao?: string;
  tipo_documento?: string;
}
export interface Evento {
  id: number;
  publicacao_id: number;
  tipo: string;
  descricao: string;
  created_at: string;
}
const dia = (s: string | null) =>
  s ? s.slice(0, 10).split("-").reverse().join("/") : "Não informado";
const momento = (s: string) =>
  new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleString(
    "pt-BR",
    { timeZone: "America/Sao_Paulo" },
  );
function useAcao(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const { show } = useToast();
  async function executar(fn: () => Promise<unknown>, ok: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
      show(ok, "success");
    } catch (e) {
      show(
        e instanceof ApiError
          ? e.message
          : "Não foi possível salvar a alteração.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, executar };
}
const panel = "rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
export function DjenDocumentos({
  id,
  certidao,
  tribunal,
  documentos = [],
  refresh,
}: {
  id: number;
  certidao: string | null;
  tribunal: string | null;
  documentos?: Documento[];
  refresh: () => Promise<void>;
}) {
  void refresh;
  return (
    <section className={panel}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="h-4 w-4" />
        Documentos do andamento
      </h3>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-accent-600">
        {certidao ? (
          <a
            href={certidao}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-accent-200 px-3 py-2 font-semibold"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir PDF oficial da publicação (DJEN)
          </a>
        ) : (
          <p className="text-amber-700">
            O DJEN não forneceu o identificador do PDF para esta publicação.
            Consulte novamente a origem.
          </p>
        )}
        {tribunal && (
          <a
            href={tribunal}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir documento original no tribunal
          </a>
        )}
        <a
          href={`/api/djen/publicacoes/${id}/documento`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ler texto capturado
        </a>
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        O PDF do DJEN é a certidão oficial com o teor da publicação. A íntegra
        de uma peça dos autos depende do documento disponibilizado pelo tribunal
        e pode exigir autenticação.
      </p>
      {documentos.map((d) => (
        <a
          key={d.id}
          href={d.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block text-xs text-accent-600"
        >
          {d.nome}
        </a>
      ))}
    </section>
  );
}

export function DjenPrazos({
  id,
  data,
  prazos = [],
  refresh,
}: {
  id: number;
  prazos?: Prazo[];
  data: string;
  refresh: () => Promise<void>;
}) {
  const { busy, executar } = useAcao(refresh);
  const vazio = {
    descricao: "",
    inicio: "",
    termino: "",
    status: "aberto",
    observacoes: "",
  };
  const [form, setForm] = useState<(typeof vazio & { id?: number }) | null>(
    null,
  );
  const hoje = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CalendarDays className="h-4 w-4" />
          Prazos deste andamento
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setForm({ ...vazio })}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar prazo
        </Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Identifique e calcule a sugestão usando o calendário forense
        configurado. Confira as datas antes de salvar. A agenda processual é
        independente das perícias.
      </p>
      <DeadlineSuggestion
        id={id}
        data={data}
        onUse={(s) => setForm({ ...vazio, ...s })}
      />
      {!prazos.length && (
        <p className="mt-3 text-xs text-zinc-500">
          Nenhum prazo cadastrado para este andamento.
        </p>
      )}
      <div className="mt-3 space-y-3">
        {prazos.map((p) => (
          <article
            key={p.id}
            className="rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-800/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{p.descricao}</strong>
              <Badge
                tone={
                  p.status === "concluido"
                    ? "success"
                    : p.status === "cancelado"
                      ? "neutral"
                      : p.termino && p.termino < hoje
                        ? "danger"
                        : "warning"
                }
              >
                {p.status === "concluido"
                  ? "Concluído"
                  : p.status === "cancelado"
                    ? "Cancelado"
                    : p.termino && p.termino < hoje
                      ? "Término ultrapassado"
                      : "Em aberto"}
              </Badge>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <p>
                Início do prazo: <strong>{dia(p.inicio)}</strong>
              </p>
              <p>
                Término do prazo: <strong>{dia(p.termino)}</strong>
              </p>
            </div>
            {p.observacoes && (
              <p className="mt-2 whitespace-pre-wrap">{p.observacoes}</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || p.status !== "aberto" || !p.termino}
                onClick={() =>
                  void executar(
                    () =>
                      api.post(`/djen/publicacoes/${id}/prazos/${p.id}/agenda`),
                    "Prazo adicionado/atualizado na agenda processual.",
                  )
                }
              >
                <CalendarDays className="h-3 w-3" />
                Adicionar à agenda de prazos
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm({
                    ...p,
                    inicio: p.inicio || "",
                    termino: p.termino || "",
                  })
                }
              >
                <Pencil className="h-3 w-3" />
                Editar prazo
              </Button>
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() =>
                  void executar(
                    () => api.delete(`/djen/publicacoes/${id}/prazos/${p.id}`),
                    "Prazo excluído.",
                  )
                }
              >
                <Trash2 className="h-3 w-3" />
                Excluir prazo
              </Button>
            </div>
          </article>
        ))}
      </div>
      {form && (
        <div className="mt-4 grid gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
          <div>
            <Label htmlFor="prazo-descricao">Descrição do prazo</Label>
            <Input
              id="prazo-descricao"
              value={form.descricao}
              maxLength={250}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="prazo-inicio">Início do prazo</Label>
              <Input
                id="prazo-inicio"
                type="date"
                value={form.inicio}
                onChange={(e) => setForm({ ...form, inicio: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="prazo-termino">Término do prazo</Label>
              <Input
                id="prazo-termino"
                type="date"
                value={form.termino}
                onChange={(e) => setForm({ ...form, termino: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="prazo-status">Situação do prazo</Label>
            <Select
              id="prazo-status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="aberto">Em aberto</option>
              <option value="concluido">Concluído</option>
              <option value="cancelado">Cancelado</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="prazo-obs">Observações do prazo</Label>
            <Textarea
              id="prazo-obs"
              rows={2}
              value={form.observacoes}
              maxLength={5000}
              onChange={(e) =>
                setForm({ ...form, observacoes: e.target.value })
              }
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={busy}
              onClick={() =>
                void executar(async () => {
                  const url = `/djen/publicacoes/${id}/prazos${form.id ? `/${form.id}` : ""}`;
                  if (form.id) await api.put(url, form);
                  else await api.post(url, form);
                  setForm(null);
                }, "Prazo salvo.")
              }
            >
              Salvar prazo
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setForm(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
export function DjenHistorico({
  id,
  andamentos = [],
  total = 0,
  eventos = [],
  tipos,
  abrir,
}: {
  id: number;
  andamentos?: Andamento[];
  total?: number;
  eventos?: Evento[];
  tipos: Record<string, string>;
  abrir: (id: number) => void;
}) {
  const [extras, setExtras] = useState<Andamento[]>([]),
    [busy, setBusy] = useState(false);
  const { show } = useToast();
  const todos = [
    ...new Map([...andamentos, ...extras].map((p) => [p.id, p])).values(),
  ];
  async function mais() {
    setBusy(true);
    try {
      const r = await api.get<{ items: Andamento[] }>(
        `/djen/publicacoes/${id}/andamentos?pagina=${Math.floor((andamentos.length + extras.length) / 25) + 1}`,
      );
      setExtras((e) => [...e, ...r.items]);
    } catch (e) {
      show(
        e instanceof ApiError ? e.message : "Falha ao carregar o histórico.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={panel}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4" />
        Histórico dos andamentos do processo
      </h3>
      <p className="mt-2 text-xs text-zinc-500">
        {total} publicação(ões) capturada(s). Abra um andamento para consultar
        documentos, prazos e análise.
      </p>
      <div className="mt-3 space-y-3">
        {todos.map((p) => (
          <button
            key={p.id}
            onClick={() => abrir(p.id)}
            className={`block w-full rounded-lg border p-3 text-left text-xs ${p.id === id ? "border-accent-300 bg-accent-50/50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-800"}`}
          >
            <p className="font-medium text-accent-600">
              {dia(p.data_disponibilizacao)} ·{" "}
              {p.situacao ||
                (JSON.parse(p.categorias_json) as string[])
                  .map((c) => tipos[c] || c)
                  .join(" · ") ||
                "Outros"}
              {p.id === id ? " · Andamento aberto" : ""}
            </p>
            <p className="mt-1 text-zinc-500">
              {p.orgao} · {p.tipo_documento}
            </p>
            {p.resumo && <p className="mt-2 leading-relaxed">{p.resumo}</p>}
          </button>
        ))}
      </div>
      {todos.length < total && (
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          loading={busy}
          onClick={() => void mais()}
        >
          Carregar mais andamentos
        </Button>
      )}
      <details className="mt-5">
        <summary className="cursor-pointer text-xs font-semibold">
          Histórico de alterações no acompanhamento
        </summary>
        <p className="mt-2 text-[11px] text-zinc-500">
          Últimas 100 alterações registradas neste processo.
        </p>
        {!eventos.length ? (
          <p className="mt-2 text-xs text-zinc-500">
            Nenhuma alteração registrada.
          </p>
        ) : (
          eventos.map((e) => (
            <div
              key={e.id}
              className="mt-2 border-l-2 border-zinc-200 pl-3 text-xs dark:border-zinc-700"
            >
              <p className="text-[11px] text-zinc-500">
                {momento(e.created_at)}
              </p>
              <p className="mt-1">{e.descricao}</p>
              {e.publicacao_id !== id && (
                <button
                  className="mt-1 text-accent-600"
                  onClick={() => abrir(e.publicacao_id)}
                >
                  Abrir andamento relacionado
                </button>
              )}
            </div>
          ))
        )}
      </details>
    </section>
  );
}
