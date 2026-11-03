import { identificarOrdensProcessuais, ordemDoEscritorio } from "./proceduralOrders";
import { identificarObrigacoesExternas } from "./obligations";
import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";
import { dataValida, somarDias } from "./api";
import { WorkflowInputError } from "./workflow";
import { ordemComPrazoDaParte } from "./classifier";
import { memoDjen, limparCachesDjen } from "./cache";

export class ErroCoberturaCalendario extends WorkflowInputError {
  constructor(
    public data: string,
    tribunal: string,
  ) {
    super(
      `Calendário do ${tribunal} sem cobertura para ${data}. Atualize a importação ou preencha o calendário manual nas configurações de prazos.`,
    );
  }
}
export interface CalendarioForense {
  tribunal: string;
  orgao: string;
  inicio: string;
  fim: string;
  fonte: string;
  conferido: boolean;
  origem?: "automatico" | "manual";
  atualizado_em?: string;
  fontes?: string[];
  expediente_parcial?: { data: string; motivo: string }[];
  pendencias?: { inicio: string; fim: string; motivo: string }[];
  feriados: string[];
  suspensoes: { inicio: string; fim: string; motivo: string }[];
}
export interface ConfigPrazos {
  calendarId: string;
  calendarName: string;
  calendarios: CalendarioForense[];
}
export function configPrazos(): ConfigPrazos {
  // Lida a cada cálculo de prazo; em cache curto, invalidado ao salvar a configuração.
  return memoDjen("config-prazos", 30_000, () => {
    const raw = getSetting("djen_prazos_config");
    return raw
      ? JSON.parse(raw)
      : { calendarId: "", calendarName: "", calendarios: [] };
  });
}
export function salvarConfigPrazos(data: ConfigPrazos) {
  if (
    !data ||
    typeof data.calendarId !== "string" ||
    data.calendarId.length > 500 ||
    typeof data.calendarName !== "string" ||
    data.calendarName.length > 500 ||
    !Array.isArray(data.calendarios) ||
    data.calendarios.length > 100
  )
    throw new WorkflowInputError("Configuração de prazos inválida.");
  const chaves = new Set<string>();
  for (const c of data.calendarios) {
    let fonte: URL;
    try {
      fonte = new URL(c.fonte);
    } catch {
      throw new WorkflowInputError("Informe a fonte oficial do calendário.");
    }
    if (
      !/^[A-Z0-9-]{2,20}$/.test(c.tribunal) ||
      typeof c.orgao !== "string" ||
      c.orgao.length > 300 ||
      !dataValida(c.inicio) ||
      !dataValida(c.fim) ||
      c.inicio > c.fim ||
      typeof c.conferido !== "boolean" ||
      fonte.protocol !== "https:" ||
      !fonte.hostname.endsWith(".jus.br") ||
      fonte.username ||
      fonte.password ||
      !Array.isArray(c.feriados) ||
      c.feriados.length > 1500 ||
      c.feriados.some((d) => typeof d !== "string" || !dataValida(d)) ||
      !Array.isArray(c.suspensoes) ||
      c.suspensoes.length > 500 ||
      c.suspensoes.some(
        (s) =>
          !s ||
          typeof s.inicio !== "string" ||
          typeof s.fim !== "string" ||
          !dataValida(s.inicio) ||
          !dataValida(s.fim) ||
          s.inicio > s.fim ||
          typeof s.motivo !== "string" ||
          s.motivo.length > 250,
      )
    )
      throw new WorkflowInputError(
        "Confira tribunal, órgão, cobertura, fonte oficial, feriados e suspensões do calendário.",
      );
    const chave = `${c.tribunal}:${c.orgao.toLocaleLowerCase()}:${c.inicio}:${c.fim}`;
    if (chaves.has(chave)) throw new WorkflowInputError("Calendário repetido.");
    chaves.add(chave);
  }
  // Metadados de importação são internos; o cadastro manual aceita somente os
  // campos conferidos acima, sem transformar entrada do navegador em fonte automática.
  const config: ConfigPrazos = {
    calendarId: data.calendarId,
    calendarName: data.calendarName,
    calendarios: data.calendarios.map(
      ({
        tribunal,
        orgao,
        inicio,
        fim,
        fonte,
        conferido,
        feriados,
        suspensoes,
      }) => ({
        tribunal,
        orgao,
        inicio,
        fim,
        fonte,
        conferido,
        feriados,
        suspensoes,
      }),
    ),
  };
  setSetting("djen_prazos_config", JSON.stringify(config));
  limparCachesDjen();
  return config;
}
const canon = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
/** Identifica somente ordens de manifestação com prazo explícito; nunca inventa prazo recursal. */
export function identificarPrazos(texto: string) {
  return identificarOrdensProcessuais(texto).filter((o) => ordemDoEscritorio(o) && o.tipo === "prazo_explicito" && o.dias !== null)
    .map((o) => ({ dias:o.dias!, trecho:o.trecho, descricao:o.descricao, unidade:o.unidade!, alerta:o.alerta || "Confira destinatário, regime processual e termo inicial. Não se presume prazo em dobro nem ciência pessoal." }));
}
export function sugestoesPrazos(publicacao: {
  tribunal: string;
  orgao: string;
  texto: string;
}) {
  return {
    candidatos: identificarPrazos(publicacao.texto),
    ordens: identificarOrdensProcessuais(publicacao.texto),
    obrigacoes_externas: identificarObrigacoesExternas(publicacao.texto),
    calendarios: configPrazos()
      .calendarios.filter(
        (c) =>
          c.tribunal === publicacao.tribunal &&
          (!c.orgao || canon(c.orgao) === canon(publicacao.orgao)),
      )
      .sort((a, b) => Number(Boolean(b.orgao)) - Number(Boolean(a.orgao))),
    agenda: {
      configurada: Boolean(configPrazos().calendarId),
      nome: configPrazos().calendarName,
    },
  };
}
export function calcularPrazo(
  tribunal: string,
  orgao: string,
  input: Record<string, unknown>,
  automaticos: CalendarioForense[] = [],
) {
  const dias = Number(input.dias),
    base = String(input.base || ""),
    marco = input.marco;
  if (
    !Number.isInteger(dias) ||
    dias < 1 ||
    dias > 365 ||
    !dataValida(base) ||
    !["disponibilizacao", "publicacao", "ciencia"].includes(String(marco)) ||
    input.confirmado !== true ||
    input.regime !== "cpc" ||
    !["uteis", "corridos"].includes(String(input.unidade))
  )
    throw new WorkflowInputError(
      "Confirme o regime CPC, o prazo, a unidade e a data-base antes de calcular.",
    );
  const manuais = configPrazos().calendarios.filter(
    (c) =>
      c.tribunal === tribunal &&
      c.conferido &&
      (!c.orgao || canon(c.orgao) === canon(orgao)),
  );
  const usados = new Set<CalendarioForense>();
  const eventos: { data: string; motivo: string }[] = [];
  const vigente = (d: string) => {
    // Um calendário manual conferido tem prioridade, inclusive como alternativa sem rede.
    const manual = manuais.filter((c) => c.inicio <= d && c.fim >= d);
    const cals = manual.length
      ? manual
      : automaticos.filter(
          (c) =>
            c.conferido &&
            c.tribunal === tribunal &&
            canon(c.orgao) === canon(orgao) &&
            c.inicio <= d &&
            c.fim >= d,
        );
    const locais = cals.filter((c) => c.orgao),
      gerais = cals.filter((c) => !c.orgao);
    if (locais.length > 1 || gerais.length > 1)
      throw new WorkflowInputError(
        "Há calendários sobrepostos. Corrija a configuração.",
      );
    if (!cals.length) throw new ErroCoberturaCalendario(d, tribunal);
    for (const c of cals) {
      const pendencia = c.pendencias?.find((p) => p.inicio <= d && p.fim >= d);
      if (pendencia)
        throw new WorkflowInputError(
          `Há um ato com abrangência pendente em ${d}: ${pendencia.motivo}. Confira e resolva em Configurações → Prazos → Calendários automáticos.`,
        );
      usados.add(c);
    }
    return cals;
  };
  const parcial = (d: string) =>
    vigente(d)
      .flatMap((c) => c.expediente_parcial || [])
      .find((p) => p.data === d)?.motivo || null;

  const expediente = (d: string) => {
    const c = vigente(d),
      dia = new Date(d + "T12:00:00Z").getUTCDay();
    const motivo =
      dia === 0 || dia === 6
        ? "Fim de semana"
        : c.some((cal) => cal.feriados.includes(d))
          ? "Feriado / sem expediente"
          : null;
    return motivo;
  };
  const suspenso = (d: string) => {
    const c = vigente(d),
      md = d.slice(5);
    return md >= "12-20" || md <= "01-20"
      ? "Suspensão CPC, art. 220"
      : c
          .flatMap((cal) => cal.suspensoes)
          .find((s) => s.inicio <= d && s.fim >= d)?.motivo || null;
  };
  const proximo = (d: string, contar: boolean) => {
    for (let i = 0; i < 1100; i++) {
      d = somarDias(d, 1);
      const motivo =
        expediente(d) || (contar ? suspenso(d) || parcial(d) : null);
      if (!motivo) return d;
      eventos.push({ data: d, motivo });
    }
    throw new WorkflowInputError(
      "Não foi possível encontrar dia válido no calendário.",
    );
  };
  vigente(base);
  const publicacao = marco === "disponibilizacao" ? proximo(base, false) : base;
  const inicio = proximo(publicacao, true);
  let termino = inicio,
    contados = 1;
  while (contados < dias) {
    termino = somarDias(termino, 1);
    const motivo =
      suspenso(termino) ||
      (input.unidade === "uteis" ? expediente(termino) : null);
    if (motivo) eventos.push({ data: termino, motivo });
    else contados++;
  }
  if (expediente(termino) || suspenso(termino) || parcial(termino))
    termino = proximo(termino, true);
  return {
    inicio,
    termino,
    publicacao,
    dias,
    unidade: input.unidade,
    exclusoes: eventos,
    fontes: [...new Set([...usados].flatMap((c) => c.fontes || [c.fonte]))],
    calendarios: [...usados].map((c) => ({
      tribunal: c.tribunal,
      orgao: c.orgao,
      origem: c.origem || "manual",
      atualizado_em: c.atualizado_em || null,
    })),
    observacoes:
      "Sugestão CPC conforme calendário oficial importado ou alternativa manual conferida. Conferir marco, destinatário, regras especiais e indisponibilidades supervenientes antes de salvar.",
  };
}

export function concluirPublicacao(id: number, concluida: boolean) {
  const p = db.prepare("SELECT id FROM djen_publicacoes WHERE id=?").get(id);
  if (!p) throw new WorkflowInputError("Publicação não encontrada.");
  db.prepare(
    "UPDATE djen_publicacoes SET concluida=?,concluida_em=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=?",
  ).run(concluida ? 1 : 0, concluida ? 1 : 0, id);
}


