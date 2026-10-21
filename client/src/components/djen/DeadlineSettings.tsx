import { AutomaticCalendars } from "./AutomaticCalendars";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";
type Calendario = {
  tribunal: string;
  orgao: string;
  inicio: string;
  fim: string;
  fonte: string;
  conferido: boolean;
  feriados: string[];
  suspensoes: { inicio: string; fim: string; motivo: string }[];
};
type Config = {
  calendarId: string;
  calendarName: string;
  calendarios: Calendario[];
};
export function DeadlineSettings() {
  const ano = new Date().getFullYear(),
    vazio = {
      tribunal: "",
      orgao: "",
      inicio: `${ano}-01-01`,
      fim: `${ano}-12-31`,
      fonte: "",
      conferido: false,
      feriados: "",
      suspensoes: "",
    };
  const [config, setConfig] = useState<Config | null>(null),
    [agendas, setAgendas] = useState<{ id: string; summary: string }[]>([]),
    [form, setForm] = useState(vazio),
    [indice, setIndice] = useState<number | null>(null),
    [busy, setBusy] = useState(false);
  const { show } = useToast(),
    falha = (e: unknown) =>
      show(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Não foi possível salvar.",
        "error",
      );
  useEffect(() => {
    void api.get<Config>("/djen/prazos/config").then(setConfig).catch(falha);
  }, []);
  async function salvar(c: Config) {
    if (busy) return;
    setBusy(true);
    try {
      setConfig(await api.put<Config>("/djen/prazos/config", c));
      show("Configurações de prazos salvas.", "success");
    } catch (e) {
      falha(e);
    } finally {
      setBusy(false);
    }
  }
  if (!config)
    return <p className="text-sm">Carregando configuração de prazos…</p>;
  return (
    <section className="surface-panel space-y-5 p-5">
      <div>
        <h2 className="text-base font-semibold">
          Prazos e calendários forenses
        </h2>
        <p className="mt-2 text-xs text-zinc-500">
          Configuração exclusiva do acompanhamento processual. A conta Google é
          a mesma das conexões compartilhadas; escolha uma agenda diferente das
          perícias.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="agenda-prazos">Agenda Google para os prazos</Label>
          <Select
            id="agenda-prazos"
            value={config.calendarId}
            onChange={(e) => {
              const a = agendas.find((a) => a.id === e.target.value);
              setConfig({
                ...config,
                calendarId: e.target.value,
                calendarName: a?.summary || "",
              });
            }}
          >
            <option value="">Nenhuma agenda selecionada</option>
            {config.calendarId &&
              !agendas.some((a) => a.id === config.calendarId) && (
                <option value={config.calendarId}>
                  {config.calendarName || config.calendarId}
                </option>
              )}
            {agendas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.summary}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <Button
            variant="outline"
            onClick={() =>
              void api
                .get<typeof agendas>("/google-calendar/calendars")
                .then(setAgendas)
                .catch(falha)
            }
          >
            Carregar agendas da conta Google
          </Button>
          <Button loading={busy} onClick={() => void salvar(config)}>
            Salvar agenda
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-500">
        Conecte a conta em Configurações → Google Agenda se necessário. O evento
        será criado no dia do término; o início e as observações ficam na
        descrição.
      </p>
      <AutomaticCalendars />
      <details className="border-t pt-4" id="calendario-manual">
        <summary className="cursor-pointer text-sm font-semibold">
          Preencher calendário manual completo (alternativa)
        </summary>
        <div className="mt-4">
          <h3 className="text-sm font-semibold">Calendários cadastrados</h3>
          <p className="mt-2 text-xs text-zinc-500">
            Use esta alternativa quando não houver fonte automática disponível.
            Cadastre a cobertura completa do tribunal e, quando houver
            diferenças, da unidade/comarca exatamente como aparece no andamento.
            Recesso do CPC (20/12 a 20/01) é aplicado à contagem, separado dos
            feriados de expediente. O cálculo bloqueia datas fora da cobertura
            conferida. Inclua atos extraordinários e atualize a configuração
            quando houver mudanças. Um calendário manual conferido tem
            prioridade sobre a importação no seu período de cobertura.
          </p>
          <div className="mt-3 space-y-2">
            {config.calendarios.map((c, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-xs"
              >
                <div>
                  <strong>
                    {c.tribunal} · {c.orgao || "Geral do tribunal"}
                  </strong>
                  <p>
                    {c.inicio} a {c.fim} · {c.feriados.length} feriados ·{" "}
                    {c.suspensoes.length} suspensões ·{" "}
                    {c.conferido ? "Conferido" : "A conferir"}
                  </p>
                  <a
                    href={c.fonte}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-600"
                  >
                    Fonte oficial
                  </a>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIndice(i);
                      setForm({
                        ...c,
                        feriados: c.feriados.join("\n"),
                        suspensoes: c.suspensoes
                          .map((s) => `${s.inicio}|${s.fim}|${s.motivo}`)
                          .join("\n"),
                      });
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={busy}
                    onClick={() =>
                      void salvar({
                        ...config,
                        calendarios: config.calendarios.filter(
                          (_, j) => i !== j,
                        ),
                      })
                    }
                  >
                    Remover calendário
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <h3 className="text-sm font-semibold sm:col-span-2">
            {indice === null
              ? "Adicionar calendário forense"
              : "Editar calendário forense"}
          </h3>
          <div>
            <Label htmlFor="cal-tribunal">Sigla do tribunal</Label>
            <Input
              id="cal-tribunal"
              placeholder="TJSP, TRF3, TRF4…"
              value={form.tribunal}
              onChange={(e) =>
                setForm({ ...form, tribunal: e.target.value.toUpperCase() })
              }
            />
          </div>
          <div>
            <Label htmlFor="cal-orgao">
              Órgão/unidade (vazio = calendário geral)
            </Label>
            <Input
              id="cal-orgao"
              placeholder="Mesmo nome exibido na publicação"
              value={form.orgao}
              onChange={(e) => setForm({ ...form, orgao: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cal-inicio">Cobertura inicial</Label>
            <Input
              id="cal-inicio"
              type="date"
              value={form.inicio}
              onChange={(e) => setForm({ ...form, inicio: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cal-fim">Cobertura final</Label>
            <Input
              id="cal-fim"
              type="date"
              value={form.fim}
              onChange={(e) => setForm({ ...form, fim: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="cal-fonte">
              Link oficial do calendário ou ato do tribunal (.jus.br)
            </Label>
            <Input
              id="cal-fonte"
              placeholder="https://…jus.br/…"
              value={form.fonte}
              onChange={(e) => setForm({ ...form, fonte: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cal-feriados">
              Feriados / sem expediente (AAAA-MM-DD, um por linha)
            </Label>
            <Textarea
              id="cal-feriados"
              rows={6}
              value={form.feriados}
              onChange={(e) => setForm({ ...form, feriados: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cal-suspensoes">
              Suspensões de prazo (início|fim|motivo, uma por linha)
            </Label>
            <Textarea
              id="cal-suspensoes"
              rows={6}
              placeholder="2026-10-26|2026-10-27|Ato de suspensão…"
              value={form.suspensoes}
              onChange={(e) => setForm({ ...form, suspensoes: e.target.value })}
            />
          </div>
          <label className="flex items-start gap-2 text-xs sm:col-span-2">
            <Checkbox
              checked={form.conferido}
              onChange={(e) =>
                setForm({ ...form, conferido: e.target.checked })
              }
            />
            Conferi a cobertura completa na fonte oficial, incluindo feriados
            locais e suspensões aplicáveis à unidade/processo.
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button
              loading={busy}
              onClick={() => {
                const c: Calendario = {
                  ...form,
                  tribunal: form.tribunal.trim(),
                  orgao: form.orgao.trim(),
                  feriados: [
                    ...new Set(
                      form.feriados
                        .split(/[\n,;]+/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                  suspensoes: form.suspensoes
                    .split("\n")
                    .filter((s) => s.trim())
                    .map((s) => {
                      const [inicio, fim, ...m] = s
                        .split("|")
                        .map((s) => s.trim());
                      return { inicio, fim, motivo: m.join("|") };
                    }),
                };
                const calendarios = [...config.calendarios];
                if (indice === null) calendarios.push(c);
                else calendarios[indice] = c;
                void salvar({ ...config, calendarios });
              }}
            >
              Salvar calendário
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setForm(vazio);
                setIndice(null);
              }}
            >
              Limpar formulário
            </Button>
          </div>
        </div>
        <Link
          to="/processos/publicacoes"
          className="inline-block text-xs text-accent-600"
        >
          Voltar às publicações
        </Link>
      </details>
    </section>
  );
}
