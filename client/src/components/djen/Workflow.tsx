import { useAuth } from "@/context/AuthContext";
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
  // O link do tribunal pode ser a PEÇA (PJe com parâmetro do documento) ou só o PORTAL do tribunal (nesse caso não abre a peça, e alguns
  // portais, como os do TJSP, dão erro de certificado em certos navegadores). A tela diz qual é, em vez de prometer o que o link não faz.
  const hostDoTribunal = (() => { try { return tribunal ? new URL(tribunal).hostname : ""; } catch { return ""; } })();
  const pecaEspecifica = Boolean(tribunal && /[?&](x|id|numeroDocumento|documento|idDocumento)=/i.test(tribunal));
  const descricaoTribunal = !tribunal ? "" : pecaEspecifica
    ? `Peça no ${hostDoTribunal || "tribunal"} · pode exigir login`
    : `Portal geral (${hostDoTribunal || "tribunal"}) · não abre a peça. Se aparecer erro de certificado, é do site do tribunal: use o PDF do DJEN ou o texto`;
  return <section aria-label="Documentos do andamento">
    <div className="pub-section-heading"><h3>Documentos do andamento</h3></div>
    <div className="pub-document-links">
      {certidao && <a href={certidao} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" />Certidão oficial DJEN</a>}
      {tribunal && <a href={tribunal} target="_blank" rel="noopener noreferrer" title={descricaoTribunal}><ExternalLink className="h-3 w-3" />{pecaEspecifica ? "Peça no tribunal" : "Portal do tribunal"}</a>}
      <a href={`/api/djen/publicacoes/${id}/documento`} target="_blank" rel="noopener noreferrer"><FileText className="h-3 w-3" />Texto capturado</a>
      {documentos.map(d => <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer">{d.nome}<ExternalLink className="h-3 w-3" /></a>)}
    </div>
    {tribunal && !pecaEspecifica && <p className="mt-2 text-xs text-zinc-500">O portal abre a consulta geral do tribunal. A certidão e o texto capturado estão disponíveis nos outros links.</p>}
  </section>;
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
  const { can } = useAuth();
  const podeEditar = can("deadlines.manage");
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
        {podeEditar && <Button size="sm" variant="outline" onClick={() => setForm({ ...vazio })}><Plus className="h-3.5 w-3.5" />Registrar prazo</Button>}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Confira quem recebeu a ordem e as datas. Prazos do escritório exigem providência; prazos da parte contrária e de terceiros são acompanhamentos. A agenda de prazos é separada da agenda de perícias.
      </p>
      {podeEditar && <DeadlineSuggestion
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
      />}
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
            {podeEditar && <div className="mt-3 flex flex-wrap gap-2">
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
            </div>}
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
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.agendar} disabled={!form.termino || form.status !== "aberto"} onChange={e => setForm({ ...form, agendar: e.target.checked })} />Adicionar também à agenda de prazos</label>
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
const GRUPOS_DO_HISTORICO: { chave: string; rotulo: string; tipos: string[] }[] = [
  { chave: "todos", rotulo: "Tudo", tipos: [] },
  { chave: "providencia", rotulo: "Providências e prazos", tipos: ["providencia", "prazo", "agenda"] },
  { chave: "conclusao", rotulo: "Conclusões", tipos: ["conclusao"] },
  { chave: "consulta", rotulo: "Consultas ao DJEN", tipos: ["consulta", "captura"] },
  { chave: "ia", rotulo: "Análise e revisão", tipos: ["analise", "revisao", "regra", "processo"] },
  { chave: "cliente", rotulo: "Cliente e compromissos", tipos: ["mensagem", "pericia"] },
  { chave: "leitura", rotulo: "Leitura", tipos: ["leitura", "documento"] },
];
const ROTULO_DO_EVENTO: Record<string, string> = {
  providencia: "Providência", prazo: "Prazo", agenda: "Agenda", conclusao: "Conclusão", consulta: "Consulta ao DJEN", captura: "Captura",
  analise: "Análise da IA", revisao: "Revisão", regra: "Regra", processo: "Vínculo do processo", mensagem: "Mensagem ao cliente",
  pericia: "Compromisso", leitura: "Leitura", documento: "Documento",
};

/** O histórico do acompanhamento separado por tipo: leitura, revisão, providência, conclusão, consulta ao DJEN e mensagem ficam distinguíveis e filtráveis. */
function HistoricoOperacional({ eventos, id, abrir }: { eventos: Evento[]; id: number; abrir: (id: number) => void }) {
  const [grupo, setGrupo] = useState("todos");
  const tipos = GRUPOS_DO_HISTORICO.find((g) => g.chave === grupo)?.tipos ?? [];
  const lista = grupo === "todos" ? eventos : eventos.filter((e) => tipos.includes(e.tipo));
  return (
    <div className="mt-5">
      <h4 className="text-xs font-semibold">Histórico de alterações no acompanhamento</h4>
      <p className="mt-1 text-[11px] text-zinc-500">Últimas 100 alterações registradas neste processo.</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar histórico">
        {GRUPOS_DO_HISTORICO.map((g) => {
          const n = g.chave === "todos" ? eventos.length : eventos.filter((e) => g.tipos.includes(e.tipo)).length;
          return (
            <button key={g.chave} type="button" onClick={() => setGrupo(g.chave)} aria-pressed={grupo === g.chave}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${grupo === g.chave ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"}`}>
              {g.rotulo} · {n}
            </button>
          );
        })}
      </div>
      {!lista.length ? (
        <p className="mt-3 text-xs text-zinc-500">Nenhum registro neste filtro.</p>
      ) : (
        lista.map((e) => (
          <div key={e.id} className="mt-2 border-l-2 border-zinc-200 pl-3 text-xs dark:border-zinc-700">
            <p className="text-[11px] text-zinc-500">
              {momento(e.created_at)} · <span className="font-semibold text-zinc-700 dark:text-zinc-300">{ROTULO_DO_EVENTO[e.tipo] ?? e.tipo}</span>
            </p>
            <p className="mt-1">{e.descricao}</p>
            {e.publicacao_id !== id && (
              <button className="mt-1 text-accent-600" onClick={() => abrir(e.publicacao_id)}>Abrir andamento relacionado</button>
            )}
          </div>
        ))
      )}
    </div>
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
      <HistoricoOperacional eventos={eventos} id={id} abrir={abrir} />
    </section>
  );
}

