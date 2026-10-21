import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
type Candidato = {
  dias: number;
  trecho: string;
  descricao: string;
  unidade: string;
  alerta: string;
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
  onUse,
}: {
  id: number;
  data: string;
  onUse: (s: {
    descricao: string;
    inicio: string;
    termino: string;
    observacoes: string;
  }) => void;
}) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([]),
    [descricao, setDescricao] = useState("Manifestação processual"),
    [dias, setDias] = useState(15),
    [base, setBase] = useState(data),
    [marco, setMarco] = useState("disponibilizacao"),
    [unidade, setUnidade] = useState("uteis"),
    [confirmado, setConfirmado] = useState(false),
    [resultado, setResultado] = useState<Sugestao | null>(null),
    [erro, setErro] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let ativo = true;
    void api
      .get<{ candidatos: Candidato[] }>(
        `/djen/publicacoes/${id}/prazos/sugestoes`,
      )
      .then((r) => {
        if (ativo) setCandidatos(r.candidatos);
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
  }, [id]);
  const invalidar = () => {
    setResultado(null);
    setConfirmado(false);
  };
  return (
    <details className="mt-3 rounded-lg border border-accent-200 bg-accent-50/30 p-3 dark:border-zinc-700">
      <summary className="cursor-pointer text-xs font-semibold">
        Identificar e calcular prazo pelo calendário do tribunal
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
                setDias(c.dias);
                setDescricao(c.descricao);
                setUnidade(c.unidade);
                invalidar();
              }}
            >
              Usar este prazo
            </Button>
          </div>
        ))}
        {!candidatos.length && (
          <p className="text-xs text-zinc-500">
            Nenhuma ordem com prazo explícito foi identificada. Informe os dias
            após conferir a publicação e o regime aplicável.
          </p>
        )}
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
                setDias(Number(e.target.value));
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
            <Label htmlFor="calc-marco">O que representa a data-base?</Label>
            <Select
              id="calc-marco"
              value={marco}
              onChange={(e) => {
                setMarco(e.target.value);
                invalidar();
              }}
            >
              <option value="disponibilizacao">Disponibilização no DJEN</option>
              <option value="publicacao">
                Publicação oficial já conferida
              </option>
              <option value="ciencia">Ciência válida já conferida</option>
            </Select>
          </div>
        </div>
        <label className="flex items-start gap-2 text-xs">
          <Checkbox
            checked={confirmado}
            onChange={(e) => {
              setConfirmado(e.target.checked);
              setResultado(null);
            }}
          />
          Conferi que este prazo segue o CPC, o destinatário, a data-base e o
          calendário da unidade/comarca.
        </label>
        <p className="text-xs">
          <Link to="/configuracoes?prazos=1" className="text-accent-600">
            Configurar calendários forenses e agenda de prazos
          </Link>
        </p>
        <Button
          size="sm"
          variant="outline"
          loading={busy}
          disabled={!confirmado}
          onClick={() => {
            setBusy(true);
            setErro("");
            setResultado(null);
            void api
              .post<Sugestao>(`/djen/publicacoes/${id}/prazos/calcular`, {
                dias,
                base,
                marco,
                unidade,
                regime: "cpc",
                confirmado,
              })
              .then(setResultado)
              .catch((e) =>
                setErro(
                  e instanceof ApiError
                    ? e.message
                    : "Não foi possível calcular.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          Calcular sugestão
        </Button>
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
              onClick={() =>
                onUse({
                  descricao,
                  inicio: resultado.inicio,
                  termino: resultado.termino,
                  observacoes: `${dias} dias ${unidade}. Data-base: ${base} (${marco}). ${resultado.observacoes}\nFontes: ${resultado.fontes.join(", ")}`,
                })
              }
            >
              Preencher novo prazo com esta sugestão
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
