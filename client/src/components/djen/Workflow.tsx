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
  responsavel?: string;
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
        e instanceof Error
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
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[
          { url: certidao, titulo: "Certidão oficial DJEN", descricao: "PDF com o teor da publicação", tipo: "PDF oficial" },
          { url: tribunal, titulo: "Documento no tribunal", descricao: "Consultar a origem · pode exigir login", tipo: "Tribunal" },
          { url: `/api/djen/publicacoes/${id}/documento`, titulo: "Texto da publicação", descricao: "Versão capturada para leitura", tipo: "Texto" },
          ...documentos.map((d) => ({ url: d.url, titulo: d.nome, descricao: "Documento vinculado ao andamento", tipo: "Anexo" })),
        ].map((d, i) => d.url ? <a key={i} href={d.url} target="_blank" rel="noopener noreferrer" className="group flex min-w-0 items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 transition-colors hover:border-accent-300 hover:bg-accent-50 dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:bg-accent-950/30">
          <span className="rounded-lg bg-white p-2 text-accent-600 dark:bg-zinc-900"><FileText className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{d.tipo}</span><strong className="mt-1 block break-words text-sm text-zinc-800 dark:text-zinc-100">{d.titulo}</strong><span className="mt-1 block text-xs text-zinc-500">{d.descricao}</span></span><ExternalLink className="mt-1 h-4 w-4 shrink-0 text-zinc-400 group-hover:text-accent-600" />
        </a> : <div key={i} className="rounded-xl border border-dashed border-zinc-200 p-4 text-xs text-zinc-500"><strong className="block">{d.titulo}</strong><p className="mt-2">Link não fornecido nesta publicação.</p></div>)}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        O PDF do DJEN é a certidão oficial com o teor da publicação. A íntegra
        de uma peça dos autos depende do documento disponibilizado pelo tribunal
        e pode exigir autenticação.
      </p>
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
  const { show } = useToast();
  const vazio = {
    descricao: "",
    inicio: "",
    termino: "",
    status: "aberto",
    observacoes: "",
    responsavel: "nao_identificado",
    agendar: false,
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
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setForm({ ...vazio })}><Plus className="h-3.5 w-3.5" />Registrar prazo</Button><Button size="sm" onClick={() => setForm({ ...vazio, agendar: true })}><CalendarDays className="h-3.5 w-3.5" />Adicionar à agenda de prazos</Button></div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Confira quem recebeu a ordem e as datas. Prazos do escritório exigem providência; prazos da parte contrária e de terceiros são acompanhamentos. A agenda de prazos é separada da agenda de perícias.
      </p>
      <DeadlineSuggestion
        id={id}
        data={data}
        onSave={async (s) => {
          await api.post(`/djen/publicacoes/${id}/prazos`, {
            ...s,
            status: "aberto",
            responsavel: "escritorio",
          });
          await refresh();
          show("Prazo calculado e salvo.", "success");
        }}
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
            className={`rounded-2xl border-l-4 border p-4 text-xs ${p.responsavel === "escritorio" ? "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20" : p.responsavel === "parte_contraria" || p.responsavel === "terceiro" ? "border-sky-300 bg-sky-50/50 dark:bg-sky-950/20" : "border-zinc-200 bg-zinc-50 dark:bg-zinc-800/40"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{({ escritorio: "Escritório · providência a cumprir", parte_contraria: "Parte contrária · acompanhar cumprimento", terceiro: "Terceiro · acompanhar cumprimento" } as Record<string, string>)[p.responsavel || ""] || "Responsável não informado · conferir"}</p><strong className="text-sm">{p.descricao}</strong></div>
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
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <p>
                Início do prazo <strong className="mt-1 block text-base">{dia(p.inicio)}</strong>
              </p>
              <p>
                Término do prazo <strong className="mt-1 block text-base">{dia(p.termino)}</strong>
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
                    agendar: false,
                    inicio: p.inicio || "",
                    termino: p.termino || "",
                    responsavel: p.responsavel || "nao_identificado",
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
        <div className="mt-4 grid gap-4 rounded-2xl border border-accent-200 bg-accent-50/30 p-4 dark:border-zinc-700">
          <h4 className="text-sm font-semibold">{form.agendar ? "Novo compromisso na agenda de prazos" : form.id ? "Editar prazo" : "Registrar prazo"}</h4>
          <div><Label htmlFor="prazo-responsavel">Quem deve cumprir?</Label><Select id="prazo-responsavel" value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })}><option value="nao_identificado">Selecione o responsável</option><option value="escritorio">Escritório / parte representada</option><option value="parte_contraria">Parte contrária (ex.: INSS)</option><option value="terceiro">Terceiro (ex.: perito, contadoria)</option></Select></div>
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
              disabled={!form.descricao.trim() || form.responsavel === "nao_identificado" || (form.agendar && (!form.termino || form.status !== "aberto"))}
              onClick={() =>
                void executar(async () => {
                  const url = `/djen/publicacoes/${id}/prazos${form.id ? `/${form.id}` : ""}`;
                  let prazoId = form.id;
                  if (prazoId) await api.put(url, form);
                  else { const saved = await api.post<{ prazo_id: number }>(url, form); prazoId = saved.prazo_id; setForm({ ...form, id: prazoId }); }
                  if (form.agendar) {
                    try { await api.post(`/djen/publicacoes/${id}/prazos/${prazoId}/agenda`); }
                    catch (e) { await refresh(); throw new Error(`Prazo salvo, mas não enviado à agenda. ${e instanceof Error ? e.message : "Tente novamente."}`); }
                  }
                  setForm(null);
                }, form.agendar ? "Prazo salvo e adicionado à agenda de prazos." : "Prazo salvo.")
              }
            >
              {form.agendar ? "Salvar e adicionar à agenda" : "Salvar prazo"}
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

