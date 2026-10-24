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
        calendario_automatico: CalendarioAutomatico | null;
      }>(`/djen/publicacoes/${id}/prazos/sugestoes`)
      .then((r) => {
        if (ativo) {
          setCandidatos(r.candidatos);
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
    <details
      open
      className="mt-3 rounded-lg border border-accent-200 bg-accent-50/30 p-3 dark:border-zinc-700"
    >
      <summary className="cursor-pointer text-xs font-semibold">
        Prazo sugerido automaticamente
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-zinc-500">
          Os feriados e suspensões são consultados automaticamente conforme o
          tribunal e a localidade. Se necessário, o sistema indicará o dado que
          falta; ajustes manuais ficam nas configurações.
        </p>
        {calendario && (
          <p className="text-xs text-zinc-500">
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
          </p>
        )}
        <details className="rounded-lg border border-zinc-200 bg-white/70 p-3 dark:border-zinc-700 dark:bg-zinc-900/30">
          <summary className="cursor-pointer text-xs font-semibold">
            Ajustar dados do cálculo
          </summary>
          <div className="mt-3 space-y-3">
            {candidatos.map((c, i) => (
              <div key={i} className="rounded-lg border p-3 text-xs">
                <p className="font-semibold">
                  {c.descricao} · {c.dias} dias{" "}
                  {c.unidade === "uteis" ? "úteis" : "corridos"}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">
                  “{c.trecho}”
                </p>
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
            {!candidatos.length && (
              <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                Nenhum prazo da parte foi reconhecido nesta publicação. Confira o texto e informe os dias manualmente; o sistema não preencherá 15 dias por padrão.
              </p>
            )}
            {candidatos.length > 1 && <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Há mais de um prazo expresso. Selecione a ordem correta acima para calcular.</p>}
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
        {resultado && (
          <div className="rounded-lg bg-white p-3 text-xs dark:bg-zinc-800">
            <p className="font-semibold">
              Início sugerido: {resultado.inicio.split("-").reverse().join("/")}{" "}
              · Término sugerido:{" "}
              {resultado.termino.split("-").reverse().join("/")}
            </p>
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
      </div>
    </details>
  );
}
