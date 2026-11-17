import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
type Candidato = {
  dias: number;
  trecho: string;
  descricao: string;
  unidade: string;
  alerta: string;
};
type CalendarioAutomatico = {
  status: string;
  municipio: string | null;
  atualizado_em: string | null;
  erro: string | null;
};
type Indicio = { dias: number; unidade: "uteis" | "corridos"; unidade_citada: boolean; trecho: string; origem: "ia" | "texto" };
type Ordem = { responsavel: string; destinatario: string; tipo: string; descricao: string; trecho: string; dias: number | null; unidade: string | null; alerta: string | null };
type Sugestao = {
  inicio: string;
  termino: string;
  publicacao: string;
  observacoes: string;
  fontes: string[];
  exclusoes: { data: string; motivo: string }[];
};
export function DeadlineSuggestion({
  id,
  data,
  onSave,
}: {
  id: number;
  data: string;
  onSave: (s: {
    descricao: string;
    inicio: string;
    termino: string;
    observacoes: string;
  }) => Promise<void>;
}) {
  const sequenciaCalculo = useRef(0);
  const [calendario, setCalendario] = useState<CalendarioAutomatico | null>(
    null,
  );
  const [ordens, setOrdens] = useState<Ordem[]>([]);
  const ordensEscritorio = ordens.filter((o) => ["escritorio", "ambas_partes"].includes(o.responsavel) && o.tipo !== "ciencia");
  const [externos, setExternos] = useState<{ tipo: string; responsavel: string; trecho: string; prazo_citado_dias: number | null; prazo_texto?: string | null; alerta?: string | null }[]>([]);
  const [indicios, setIndicios] = useState<Indicio[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]),
    [descricao, setDescricao] = useState("Manifestação processual"),
    [dias, setDias] = useState<number | "">(""),
    [base, setBase] = useState(data),
    [marco, setMarco] = useState("disponibilizacao"),
    [unidade, setUnidade] = useState("uteis"),
    [prontoParaCalcular, setProntoParaCalcular] = useState(false),
    [resultado, setResultado] = useState<Sugestao | null>(null),
    [erro, setErro] = useState(""),
    [busy, setBusy] = useState(false),
    [salvando, setSalvando] = useState(false),
    [salvo, setSalvo] = useState(false),
    [confirmarDivergencia, setConfirmarDivergencia] = useState(false);
  const divergente = dias !== "" && candidatos.length > 0 &&
    !candidatos.some((c) => c.dias === dias && c.unidade === unidade);
  useEffect(() => {
    let ativo = true;
    sequenciaCalculo.current++;
    setProntoParaCalcular(false);
    setResultado(null);
    setErro("");
    setBusy(false);
    setSalvo(false);
    setBase(data);
    setDias("");
    setConfirmarDivergencia(false);
    void api
      .get<{
        candidatos: Candidato[];
        obrigacoes_externas?: typeof externos;
        ordens?: Ordem[];
        indicios?: Indicio[];
        calendario_automatico: CalendarioAutomatico | null;
      }>(`/djen/publicacoes/${id}/prazos/sugestoes`)
      .then((r) => {
        if (ativo) {
          setCandidatos(r.candidatos);
          setExternos(r.obrigacoes_externas || []);
          setOrdens(r.ordens || []);
          setIndicios(r.indicios || []);
          setCalendario(r.calendario_automatico);
          const principal = r.candidatos.length === 1 ? r.candidatos[0] : null;
          if (principal) {
            setDias(principal.dias);
            setDescricao(principal.descricao);
            setUnidade(principal.unidade);
          }
          setProntoParaCalcular(true);
        }
      })
      .catch((e) => {
        if (ativo)
          setErro(
            e instanceof ApiError
              ? e.message
              : "Não foi possível identificar os prazos.",
          );
      });
    return () => {
      ativo = false;
    };
  }, [data, id]);
  const invalidar = () => {
    sequenciaCalculo.current++;
    setResultado(null);
    setSalvo(false);
    setConfirmarDivergencia(false);
    setErro("");
  };
  useEffect(() => {
    if (!prontoParaCalcular || dias === "" || !Number.isInteger(dias) || dias < 1 || (divergente && !confirmarDivergencia)) {
      setResultado(null);
      return;
    }
    const sequencia = ++sequenciaCalculo.current;
    setResultado(null);
    setErro("");
    setBusy(true);
    const timer = window.setTimeout(() => {
      void api
        .post<Sugestao>(`/djen/publicacoes/${id}/prazos/calcular`, {
          dias,
          base,
          marco,
          unidade,
          regime: "cpc",
          confirmado: true,
          divergencia_confirmada: confirmarDivergencia,
        })
        .then((r) => {
          if (sequencia === sequenciaCalculo.current) setResultado(r);
        })
        .catch((e) => {
          if (sequencia === sequenciaCalculo.current)
            setErro(
              e instanceof ApiError
                ? e.message
                : "Não foi possível calcular o prazo.",
            );
        })
        .finally(() => {
          if (sequencia === sequenciaCalculo.current) setBusy(false);
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [base, dias, id, marco, prontoParaCalcular, unidade, divergente, confirmarDivergencia]);
  return (
    <section className="mt-5 space-y-4" aria-label="Identificação e cálculo de prazos">
      <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20"><p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">Escritório / parte representada</p><p className="mt-2 text-sm font-semibold">{!prontoParaCalcular ? (erro ? "Identificação indisponível" : "Consultando publicação…") : candidatos.length ? `${candidatos.length} prazo(s) expresso(s) identificado(s)` : ordensEscritorio.some((o) => o.tipo === "prazo_explicito") ? "Prazo expresso: período a conferir" : ordensEscritorio.length ? "Providência sem período expresso" : "Prazo não confirmado automaticamente"}</p><p className="mt-1 text-xs text-zinc-500">{candidatos.length ? "Confira a ordem abaixo e registre a providência." : "Confira as ordens e o inteiro teor. Ausência de identificação automática não confirma ausência de obrigação."}</p></div><div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/20"><p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:text-sky-200">Parte contrária / terceiros</p><p className="mt-2 text-sm font-semibold">{prontoParaCalcular ? `${externos.length} obrigação(ões) identificada(s)` : erro ? "Não foi possível verificar" : "Consultando publicação…"}</p><p className="mt-1 text-xs text-zinc-500">Acompanhar o cumprimento. Estas ordens não são tratadas como prazo do escritório.</p></div></div>
      {ordensEscritorio.filter((o) => o.dias === null).map((o, i) => <article key={i} className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900 dark:bg-amber-950/20"><p className="text-sm font-semibold">{o.descricao} · {o.destinatario}</p><p className="mt-2 text-xs leading-relaxed">{o.trecho}</p><p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">{o.alerta || "A ordem exige providência, mas não traz período calculável identificado. Confira antes de cadastrar."}</p></article>)}
      {externos.map((e, i) => <article key={i} className="rounded-xl border border-sky-200 p-4 dark:border-sky-900"><p className="text-sm font-semibold">{e.responsavel} · {e.prazo_citado_dias ? `${e.prazo_citado_dias} dias mencionados` : e.prazo_texto || "sem período expresso confirmado"}</p><p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{e.trecho}</p>{e.alerta && <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-200">{e.alerta}</p>}<p className="mt-2 text-[11px] text-sky-700 dark:text-sky-300">Acompanhamento operacional em Aguardando retorno após o período de conferência, se não houver cumprimento identificado.</p></article>)}
      <div className="mt-3 space-y-3">

        {calendario && (
          <details className="rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/40"><summary className="cursor-pointer font-medium">Calendário forense · {calendario.municipio || "localidade a confirmar"}</summary><p className="mt-2 text-zinc-500">
            Calendário: {calendario.municipio || "localidade em identificação"}{" "}
            ·{" "}
            {calendario.erro ||
              (calendario.atualizado_em
                ? `última importação em ${new Date(calendario.atualizado_em).toLocaleString("pt-BR")}`
                : "a importação será concluída antes do cálculo")}
            .{" "}
            <Link to="/configuracoes?prazos=1" className="text-accent-600">
              Ver detalhes
            </Link>
          </p></details>
        )}
            {candidatos.map((c, i) => (
              <div key={i} className="rounded-lg border p-3 text-xs">
                <p className="font-semibold">
                  Escritório · {c.descricao} · {c.dias} dias{" "}
                  {c.unidade === "uteis" ? "úteis" : "corridos"}
                </p>
                <details open={c.trecho.length < 300} className="mt-2"><summary className="cursor-pointer font-medium text-accent-700 dark:text-accent-300">Ver trecho da ordem na publicação</summary><p className="mt-2 whitespace-pre-wrap leading-relaxed text-zinc-600 dark:text-zinc-300">“{c.trecho}”</p></details>
                <p className="mt-2 text-amber-700">{c.alerta}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    const mudou =
                      dias !== c.dias ||
                      descricao !== c.descricao ||
                      unidade !== c.unidade;
                    setDias(c.dias);
                    setDescricao(c.descricao);
                    setUnidade(c.unidade);
                    if (mudou) invalidar();
                  }}
                >
                  Usar este prazo
                </Button>
              </div>
            ))}
            {prontoParaCalcular && !candidatos.length && indicios.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-700 dark:bg-amber-950">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  {indicios[0]!.origem === "ia" ? "A IA e/ou o texto citam" : "O texto cita"} um período, mas o sistema não confirmou o marco inicial.
                </p>
                {indicios.map((i) => (
                  <div key={`${i.dias}-${i.unidade}`} className="rounded-md bg-white p-2 dark:bg-zinc-900">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                      {i.dias} dias {i.unidade === "uteis" ? "úteis" : "corridos"} · início a conferir
                      {!i.unidade_citada && " · unidade não citada: confirme se são úteis ou corridos"}
                    </p>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-400">“…{i.trecho}…”</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => {
                        setDias(i.dias);
                        setUnidade(i.unidade);
                        setDescricao("Prazo a conferir (indicado pela IA/texto)");
                        invalidar();
                      }}
                    >
                      Calcular com {i.dias} dias {i.unidade === "uteis" ? "úteis" : "corridos"} (a conferir)
                    </Button>
                  </div>
                ))}
                <p className="text-amber-800 dark:text-amber-300">Confirme no inteiro teor quem deve cumprir e de quando o prazo conta antes de lançar na agenda.</p>
              </div>
            )}
            {prontoParaCalcular && !candidatos.length && indicios.length === 0 && (
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Nenhum período em dias foi confirmado para cálculo automático. Confira as ordens acima e o documento; datas ou unidades diferentes precisam ser conferidas, sem presumir 15 dias.
              </p>
            )}
            {candidatos.length > 1 && <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Há mais de um prazo expresso. Selecione a ordem correta acima para calcular.</p>}
        {resultado && (
          <div className="rounded-lg bg-white p-3 text-xs dark:bg-zinc-800">
            <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900"><p className="text-zinc-500">Início sugerido</p><strong className="mt-1 block text-xl">{resultado.inicio.split("-").reverse().join("/")}</strong></div><div className="rounded-xl bg-accent-50 p-4 dark:bg-accent-950/30"><p className="text-accent-700 dark:text-accent-300">Término sugerido</p><strong className="mt-1 block text-xl">{resultado.termino.split("-").reverse().join("/")}</strong></div></div>
            <p className="mt-2">{resultado.observacoes}</p>
            <details className="mt-2">
              <summary>Ver memória da contagem e fontes</summary>
              <p>Publicação/ciência: {resultado.publicacao}</p>
              {resultado.exclusoes.map((e, i) => (
                <p key={i}>
                  {e.data} · {e.motivo}
                </p>
              ))}
              {resultado.fontes.map((f) => (
                <a
                  key={f}
                  href={f}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block break-all text-accent-600"
                >
                  Calendário oficial
                </a>
              ))}
            </details>
            <Button
              size="sm"
              className="mt-3"
              loading={salvando}
              disabled={salvo}
              onClick={() => {
                setSalvando(true);
                setErro("");
                void onSave({
                  descricao,
                  inicio: resultado.inicio,
                  termino: resultado.termino,
                  observacoes: `${dias} dias ${unidade}. Data-base: ${base} (${marco}). ${resultado.observacoes}\nFontes: ${resultado.fontes.join(", ")}`,
                })
                  .then(() => setSalvo(true))
                  .catch((e) =>
                    setErro(
                      e instanceof ApiError
                        ? e.message
                        : "Não foi possível salvar o prazo.",
                    ),
                  )
                  .finally(() => setSalvando(false));
              }}
            >
              {salvo ? "Prazo salvo" : "Confirmar e salvar prazo"}
            </Button>
          </div>
        )}
        <details open={candidatos.length !== 1} className="rounded-xl border border-zinc-200 bg-white/70 p-4 dark:border-zinc-700 dark:bg-zinc-900/30">
          <summary className="cursor-pointer text-xs font-semibold">
            Ajustar dados do cálculo
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="calc-dias">Quantidade de dias</Label>
                <Input
                  id="calc-dias"
                  type="number"
                  min={1}
                  max={365}
                  value={dias}
                  onChange={(e) => {
                    setDias(e.target.value === "" ? "" : Number(e.target.value));
                    invalidar();
                  }}
                />
              </div>
              <div>
                <Label htmlFor="calc-unidade">Contagem</Label>
                <Select
                  id="calc-unidade"
                  value={unidade}
                  onChange={(e) => {
                    setUnidade(e.target.value);
                    invalidar();
                  }}
                >
                  <option value="uteis">Dias úteis</option>
                  <option value="corridos">
                    Dias corridos expressamente determinados
                  </option>
                </Select>
              </div>
              <div>
                <Label htmlFor="calc-base">Data-base</Label>
                <Input
                  id="calc-base"
                  type="date"
                  value={base}
                  onChange={(e) => {
                    setBase(e.target.value);
                    invalidar();
                  }}
                />
              </div>
              <div>
                <Label htmlFor="calc-marco">
                  O que representa a data-base?
                </Label>
                <Select
                  id="calc-marco"
                  value={marco}
                  onChange={(e) => {
                    setMarco(e.target.value);
                    invalidar();
                  }}
                >
                  <option value="disponibilizacao">
                    Disponibilização no DJEN
                  </option>
                  <option value="publicacao">
                    Publicação oficial já conferida
                  </option>
                  <option value="ciencia">
                    Ciência válida já conferida
                  </option>
                </Select>
              </div>
            </div>
          </div>
        </details>
        {divergente && <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <Checkbox checked={confirmarDivergencia} onChange={(e) => setConfirmarDivergencia(e.target.checked)} />
          <span>Os {dias} dias {unidade === "uteis" ? "úteis" : "corridos"} informados diferem do prazo extraído da publicação. Conferi o texto e confirmo esta alteração manual.</span>
        </label>}
        <p className="text-xs">
          <Link to="/configuracoes?prazos=1" className="text-accent-600">
            Ver calendário automático, ajustes manuais e agenda de prazos
          </Link>
        </p>
        {busy && (
          <p className="text-xs font-medium text-accent-600">
            Calculando automaticamente…
          </p>
        )}
        {erro && (
          <p role="alert" className="text-xs text-red-600">
            {erro}
          </p>
        )}

      </div>
    </section>
  );
}

