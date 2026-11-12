import { Modal } from "@/components/ui/Modal";
import { DeadlineSettings } from "./DeadlineSettings";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Callout, SettingRow, SettingsBlock, SettingsPanel } from "@/components/ui/Settings";
import { CalendarDays, ChevronDown, RefreshCw } from "lucide-react";

type Tipo = "feriado" | "suspensao" | "expediente_parcial" | "pendencia";
type Evento = {
  id: string;
  tipo: Tipo;
  inicio: string;
  fim: string;
  descricao: string;
  fonte: string;
};
type Ajustes = { adicionar: Evento[]; ignorar: string[] };
type Localidade = {
  tribunal: string;
  orgao: string;
  municipio: string;
  uf: string;
  instancia: "primeiro" | "segundo";
};
type Calendario = {
  chave: string;
  tribunal: string;
  orgao: string;
  ano: number;
  status: string;
  municipio: string | null;
  uf: string | null;
  atualizado_em: string | null;
  eventos: Evento[];
  ajustes: Ajustes;
  fontes: string[];
  avisos: string[];
  erro: string | null;
};
type Estado = {
  config: { ativo: boolean; localidades: Localidade[] };
  calendarios: Calendario[];
  fontes: { tribunal: string; descricao: string; url: string }[];
  executando: number;
  na_fila: number;
};
const tipos: Record<Tipo, string> = {
  feriado: "Feriado / sem expediente",
  suspensao: "Suspensão de prazos",
  expediente_parcial: "Expediente parcial",
  pendencia: "Abrangência a conferir",
};
const estados: Record<string, string> = {
  ok: "Atualizado",
  parcial: "Importado · atos a conferir",
  pendente: "Aguardando importação",
  atualizando: "Atualizando…",
  erro: "Falha ao consultar fonte",
  sem_fonte: "Sem fonte automática validada",
  localidade_pendente: "Informe a localidade",
};
const dataBR = (d: string) => d.split("-").reverse().join("/");
const mensagem = (e: unknown) =>
  e instanceof ApiError || e instanceof Error
    ? e.message
    : "Não foi possível atualizar o calendário.";

export function AutomaticCalendars() {
  const [estado, setEstado] = useState<Estado | null>(null),
    [erro, setErro] = useState(""),
    [busy, setBusy] = useState(false),
    [busca, setBusca] = useState(""),
    [tribunal, setTribunal] = useState(""),
    [ano, setAno] = useState(""),
    [status, setStatus] = useState(""),
    [pagina, setPagina] = useState(1);
  const carregar = useCallback(async () => {
    setEstado(await api.get<Estado>("/djen/calendarios"));
  }, []);
  const consultando = Boolean(estado && (estado.executando || estado.na_fila));
  const suportados = useMemo(() => new Set(estado?.fontes.map((f) => f.tribunal) || []), [estado?.fontes]);
  const calendarios = estado?.calendarios || [];
  const tribunais = [...new Set(calendarios.map((c) => c.tribunal))].sort();
  const anos = [...new Set(calendarios.map((c) => c.ano))].sort((a, b) => b - a);
  const filtrados = calendarios.filter((c) => {
    const termo = busca.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const indice = `${c.tribunal} ${c.orgao} ${c.municipio || ""} ${c.uf || ""} ${c.ano}`
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return (!termo || indice.includes(termo)) && (!tribunal || c.tribunal === tribunal)
      && (!ano || c.ano === Number(ano)) && (!status || c.status === status);
  }).sort((a, b) => {
    const prioridade: Record<string, number> = { erro: 0, localidade_pendente: 1, sem_fonte: 2, parcial: 3, pendente: 4, atualizando: 5, ok: 6 };
    return (prioridade[a.status] ?? 7) - (prioridade[b.status] ?? 7)
      || b.ano - a.ano || a.tribunal.localeCompare(b.tribunal) || a.orgao.localeCompare(b.orgao);
  });
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / 12));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * 12, paginaAtual * 12);
  useEffect(() => {
    let ativo = true;
    void api
      .get<Estado>("/djen/calendarios")
      .then((r) => {
        if (ativo) setEstado(r);
      })
      .catch((e) => {
        if (ativo) setErro(mensagem(e));
      });
    return () => {
      ativo = false;
    };
  }, []);
  useEffect(() => {
    let ativo = true;
    const timer = setInterval(
      () => {
        void api
          .get<Estado>("/djen/calendarios")
          .then((r) => {
            if (ativo) setEstado(r);
          })
          .catch((e) => {
            if (ativo) setErro(mensagem(e));
          });
      },
      consultando ? 3000 : 30000,
    );
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [consultando]);

  async function executar(fn: () => Promise<unknown>) {
    setBusy(true);
    setErro("");
    try {
      await fn();
      await carregar();
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setBusy(false);
    }
  }
  const importados = calendarios.filter((c) => c.status === "ok" || c.status === "parcial").length;
  const atencao = calendarios.filter((c) => ["sem_fonte", "erro", "localidade_pendente", "parcial"].includes(c.status)).length;
  const situacao = !estado ? null : consultando ? <Badge tone="info">Consultando fontes…</Badge>
    : !estado.config.ativo ? <Badge tone="neutral">Importação automática desligada</Badge>
    : atencao ? <Badge tone="warning">{atencao} precisam de atenção</Badge>
    : <Badge tone="success">Atualizados</Badge>;
  return (
    <div id="calendarios-automaticos">
      <SettingsPanel
        icon={<CalendarDays />}
        title="Calendários dos tribunais"
        description="Feriados e suspensões oficiais por tribunal, órgão e ano. Atualização a cada 6 horas e antes de calcular quando vencidos."
        status={situacao}
        actions={<Button size="sm" variant="outline" loading={busy} onClick={() => void executar(() => api.post("/djen/calendarios/sincronizar"))}><RefreshCw className="h-4 w-4" />Atualizar fontes</Button>}
      >
        {!estado && !erro && <div className="space-y-3 px-5 py-5"><Skeleton className="h-16" /><Skeleton className="h-40" /></div>}
        {erro && <div className="px-5 py-4"><Callout tone="erro">{erro}</Callout></div>}
        {estado && (
          <>
            <SettingsBlock>
              <SettingRow label="Importar automaticamente" hint="Busca feriados e suspensões nas fontes oficiais dos tribunais.">
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                  <Checkbox
                    checked={estado.config.ativo}
                    disabled={busy}
                    onChange={(e) => {
                      const ativo = e.target.checked;
                      void executar(() => api.put("/djen/calendarios/config", { ...estado.config, ativo }));
                    }}
                  />
                  {estado.config.ativo ? "Ligado" : "Desligado"}
                </label>
              </SettingRow>
              {consultando && <Callout tone="info">Consultando as fontes oficiais… {estado.na_fila} na fila.</Callout>}
              {!estado.calendarios.length && <Callout tone="info">Os calendários serão identificados a partir dos órgãos das publicações capturadas. Não é preciso cadastrar feriados um a um.</Callout>}
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["Identificados", calendarios.length, ""],
                  ["Importados", importados, ""],
                  ["Precisam de atenção", atencao, atencao ? "text-amber-700 dark:text-amber-300" : ""],
                ].map(([label, valor, cor]) => (
                  <div key={label} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
                    <strong className={`mt-1 block text-xl ${cor}`}>{valor}</strong>
                  </div>
                ))}
              </div>
            </SettingsBlock>
            <SettingsBlock title="Calendários por órgão" description="Os que precisam de atenção aparecem primeiro. Abra um para atualizar, informar a localidade ou corrigir datas.">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Input aria-label="Buscar tribunal, órgão ou cidade" placeholder="Buscar tribunal, órgão ou cidade…" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
                <Select aria-label="Filtrar tribunal" value={tribunal} onChange={(e) => { setTribunal(e.target.value); setPagina(1); }}>
                  <option value="">Todos os tribunais</option>
                  {tribunais.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
                <Select aria-label="Filtrar ano" value={ano} onChange={(e) => { setAno(e.target.value); setPagina(1); }}>
                  <option value="">Todos os anos</option>
                  {anos.map((a) => <option key={a} value={a}>{a}</option>)}
                </Select>
                <Select aria-label="Filtrar situação da importação" value={status} onChange={(e) => { setStatus(e.target.value); setPagina(1); }}>
                  <option value="">Todas as situações</option>
                  {Object.entries(estados).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">
                {filtrados.length} de {calendarios.length} calendário(s) · página {paginaAtual} de {totalPaginas}
              </p>
              {!filtrados.length && calendarios.length > 0 && <Callout tone="info">Nenhum calendário corresponde à busca. Ajuste os filtros.</Callout>}
              <div className="space-y-2">
                {visiveis.map((c) => (
                  <CalendarioCard key={c.chave} c={c} estado={estado} busy={busy} executar={executar} suportado={suportados.has(c.tribunal)} />
                ))}
              </div>
              {totalPaginas > 1 && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <Button size="sm" variant="outline" disabled={paginaAtual <= 1} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
                  <span>Página {paginaAtual} de {totalPaginas}</span>
                  <Button size="sm" variant="outline" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina(paginaAtual + 1)}>Próximo</Button>
                </div>
              )}
            </SettingsBlock>
            <SettingsBlock>
              <details className="group text-xs text-zinc-600 dark:text-zinc-400">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">Fontes automáticas disponíveis ({estado.fontes.length})<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
                <div className="mt-3 space-y-2">
                  {estado.fontes.map((f) => (
                    <p key={f.tribunal}>
                      <a href={f.url} target="_blank" rel="noreferrer" className="font-medium text-accent-600 underline dark:text-accent-300">{f.tribunal}</a> · {f.descricao}
                    </p>
                  ))}
                  <p>Tribunais sem importador validado e atos extraordinários ausentes nas fontes podem ser conferidos no calendário manual. Uma falha de consulta não é tratada como ausência de feriados.</p>
                </div>
              </details>
            </SettingsBlock>
          </>
        )}
      </SettingsPanel>
    </div>
  );
}

function CalendarioCard({
  c,
  estado,
  busy,
  executar,
  suportado,
}: {
  c: Calendario;
  estado: Estado;
  busy: boolean;
  executar: (fn: () => Promise<unknown>) => Promise<void>;
  suportado: boolean;
}) {
  const salvo = estado.config.localidades.find(
    (l) => l.tribunal === c.tribunal && l.orgao === c.orgao,
  );
  const [municipio, setMunicipio] = useState(
      salvo?.municipio || c.municipio || "",
    ),
    [uf, setUf] = useState(salvo?.uf || c.uf || ""),
    [instancia, setInstancia] = useState<"primeiro" | "segundo">(
      salvo?.instancia ||
        (/turma|câmara|tribunal/i.test(c.orgao) &&
        !/vara|recursal/i.test(c.orgao)
          ? "segundo"
          : "primeiro"),
    );
  const [tipo, setTipo] = useState<Tipo>("feriado"),
    [inicio, setInicio] = useState(""),
    [fim, setFim] = useState(""),
    [descricao, setDescricao] = useState(""),
    [historico, setHistorico] = useState<
      { id: number; descricao: string; created_at: string }[] | null
    >(null);
  useEffect(() => {
    setMunicipio(salvo?.municipio || c.municipio || "");
    setUf(salvo?.uf || c.uf || "");
  }, [salvo?.municipio, salvo?.uf, c.municipio, c.uf]);
  const salvar = (ajustes: Ajustes) =>
    executar(() => api.put(`/djen/calendarios/${c.chave}/ajustes`, ajustes));
  const ignorar = (e: Evento) =>
    salvar({
      ...c.ajustes,
      ignorar: c.ajustes.ignorar.includes(e.id)
        ? c.ajustes.ignorar.filter((id) => id !== e.id)
        : [...c.ajustes.ignorar, e.id],
    });
  const pendentes = c.eventos.filter(
    (e) => e.tipo === "pendencia" && !c.ajustes.ignorar.includes(e.id),
  ).length;
  const [manualAberto, setManualAberto] = useState(false);

  return (
    <details className="group rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 text-xs">
        <span className="min-w-0">
          <strong className="block break-words text-sm text-zinc-900 dark:text-zinc-100">{c.tribunal} · {c.ano} · {c.orgao}</strong>
          <span className="mt-1 block text-zinc-500 dark:text-zinc-400">
            {c.municipio ? `${c.municipio}${c.uf ? `/${c.uf}` : ""} · ` : c.status === "localidade_pendente" ? "Localidade a informar · " : ""}
            Última importação: {c.atualizado_em ? new Date(c.atualizado_em).toLocaleString("pt-BR") : "ainda não realizada"}
            {pendentes ? ` · ${pendentes} ato(s) a conferir` : ""}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge tone={c.status === "ok" || (c.status === "parcial" && !pendentes) ? "success" : c.status === "erro" ? "danger" : c.status === "atualizando" || c.status === "pendente" ? "info" : "warning"}>
            {c.status === "parcial" && !pendentes ? "Atualizado" : estados[c.status] || c.status}
          </Badge>
          <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-zinc-100 p-3 text-xs dark:border-zinc-800">
        {!suportado && <Callout tone="aviso">Ainda não há importador automático validado para {c.tribunal}. A localidade, por si só, não habilita a importação. <button type="button" className="font-semibold underline" onClick={() => setManualAberto(true)}>Preencher calendário manual deste órgão</button>.</Callout>}
        {c.erro && <Callout tone="aviso">{c.erro}</Callout>}
        {c.avisos.map((a) => (
          <p key={a} className="text-zinc-500">
            {a}
          </p>
        ))}
        {suportado && <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void executar(() =>
              api.post("/djen/calendarios/sincronizar", {
                tribunal: c.tribunal,
                orgao: c.orgao,
                ano: c.ano,
              }),
            )
          }
        >
          Atualizar este calendário
        </Button>}
        {suportado && <details>
          <summary className="cursor-pointer font-semibold">
            Informar ou corrigir localidade
          </summary>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const local: Localidade = {
                tribunal: c.tribunal,
                orgao: c.orgao,
                municipio: municipio.trim(),
                uf,
                instancia,
              };
              void executar(() =>
                api.put("/djen/calendarios/config", {
                  ...estado.config,
                  localidades: [
                    ...estado.config.localidades.filter(
                      (l) => l.tribunal !== c.tribunal || l.orgao !== c.orgao,
                    ),
                    local,
                  ],
                }),
              );
            }}
          >
            <label>
              <span className="mb-1.5 block text-[11px] text-zinc-500">
                Município / subseção
              </span>
              <Input
                value={municipio}
                maxLength={150}
                onChange={(e) => setMunicipio(e.target.value)}
                placeholder="Ex.: São Paulo"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] text-zinc-500">UF</span>
              <Select
                aria-label="UF"
                value={uf}
                onChange={(e) => setUf(e.target.value)}
              >
                <option value="">Identificar automaticamente</option>
                {[
                  "AC",
                  "AL",
                  "AP",
                  "AM",
                  "BA",
                  "CE",
                  "DF",
                  "ES",
                  "GO",
                  "MA",
                  "MT",
                  "MS",
                  "MG",
                  "PA",
                  "PB",
                  "PR",
                  "PE",
                  "PI",
                  "RJ",
                  "RN",
                  "RS",
                  "RO",
                  "RR",
                  "SC",
                  "SP",
                  "SE",
                  "TO",
                ].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] text-zinc-500">
                Instância
              </span>
              <Select
                aria-label="Instância"
                value={instancia}
                onChange={(e) =>
                  setInstancia(e.target.value as "primeiro" | "segundo")
                }
              >
                <option value="primeiro">Primeiro grau / turma recursal</option>
                <option value="segundo">Segundo grau</option>
              </Select>
            </label>
            <div className="flex items-end">
              <Button size="sm" disabled={busy} type="submit">
                Salvar localidade e importar
              </Button>
            </div>
          </form>
        </details>}
        <details>
          <summary className="cursor-pointer font-semibold">
            Ver datas e corrigir manualmente ({c.eventos.length} importados ·{" "}
            {c.ajustes.adicionar.length} ajustes)
          </summary>
          <p className="my-3 text-zinc-500">
            Os ajustes ficam separados da importação e são preservados na
            atualização. Atos pendentes só bloqueiam cálculos que atravessem o
            período indicado. Expediente parcial afeta o início e o vencimento,
            sem excluir o dia intermediário da contagem.
          </p>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {[...c.eventos, ...c.ajustes.adicionar].map((e) => {
              const manual = e.fonte === "manual",
                ignorado = !manual && c.ajustes.ignorar.includes(e.id);
              return (
                <div
                  key={`${manual}:${e.id}`}
                  className={`rounded-lg border p-2 ${ignorado ? "opacity-60" : ""}`}
                >
                  <p className="font-medium">
                    {dataBR(e.inicio)}
                    {e.fim !== e.inicio ? ` a ${dataBR(e.fim)}` : ""} ·{" "}
                    {tipos[e.tipo]}
                    {manual ? " · Ajuste manual" : ""}
                    {ignorado ? " · Desconsiderado" : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {e.descricao}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {manual ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void salvar({
                            ...c.ajustes,
                            adicionar: c.ajustes.adicionar.filter(
                              (x) => x.id !== e.id,
                            ),
                          })
                        }
                      >
                        Remover ajuste
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void ignorar(e)}
                      >
                        {ignorado
                          ? "Restaurar"
                          : e.tipo === "pendencia"
                            ? "Não se aplica a este órgão"
                            : "Desconsiderar este ato"}
                      </Button>
                    )}
                    {e.tipo === "pendencia" && !ignorado && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void salvar({
                            ignorar: [...c.ajustes.ignorar, e.id],
                            adicionar: [
                              ...c.ajustes.adicionar,
                              { ...e, tipo: "suspensao", fonte: "manual" },
                            ],
                          })
                        }
                      >
                        Confirmar suspensão neste órgão
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <form
            className="mt-4 space-y-3 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar({
                ...c.ajustes,
                adicionar: [
                  ...c.ajustes.adicionar,
                  {
                    id: "",
                    tipo,
                    inicio,
                    fim: fim || inicio,
                    descricao: descricao.trim(),
                    fonte: "manual",
                  },
                ],
              });
            }}
          >
            <h4 className="font-semibold">
              Adicionar feriado ou suspensão manualmente
            </h4>
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-zinc-500">
                Tipo de ajuste
              </span>
              <Select
                aria-label="Tipo de ajuste"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as Tipo)}
              >
                {Object.entries(tipos)
                  .filter(([t]) => t !== "pendencia")
                  .map(([t, label]) => (
                    <option key={t} value={t}>
                      {label}
                    </option>
                  ))}
              </Select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-[11px] text-zinc-500">
                  Início
                </span>
                <Input
                  required
                  type="date"
                  min={`${c.ano}-01-01`}
                  max={`${c.ano}-12-31`}
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[11px] text-zinc-500">
                  Término (opcional)
                </span>
                <Input
                  type="date"
                  min={inicio || `${c.ano}-01-01`}
                  max={`${c.ano}-12-31`}
                  value={fim}
                  onChange={(e) => setFim(e.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-zinc-500">
                Motivo / ato oficial
              </span>
              <Input
                required
                maxLength={2000}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex.: suspensão por portaria local"
              />
            </label>
            <Button size="sm" type="submit" disabled={busy}>
              Salvar ajuste manual
            </Button>
          </form>
        </details>
        <div className="flex flex-wrap gap-3">
          {c.fontes.map((f, i) => (
            <a
              key={f}
              href={f}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent-600 underline dark:text-accent-300"
            >
              Fonte oficial {i + 1}
            </a>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void executar(async () => {
              setHistorico(
                await api.get(`/djen/calendarios/${c.chave}/historico`),
              );
            })
          }
        >
          Histórico das atualizações
        </Button>
        {historico && (
          <div className="space-y-1 text-zinc-500">
            {historico.length ? (
              historico.map((h) => (
                <p key={h.id}>
                  {h.created_at} · {h.descricao}
                </p>
              ))
            ) : (
              <p>Nenhuma alteração registrada.</p>
            )}
          </div>
        )}
      </div>
    <Modal open={manualAberto} onClose={() => setManualAberto(false)} title="Calendário manual do órgão" maxWidth="max-w-3xl"><DeadlineSettings manualOnly initialCalendar={{tribunal:c.tribunal,orgao:c.orgao,ano:c.ano}} /></Modal>
    </details>
  );
}

