import {
  FonteCalendarioError,
  type EscopoCalendario,
  type EventoForense,
  type ImportacaoOficial,
  type LerFonteOficial,
} from "./types";
import {
  norm,
  escolherLocalidade as escolherCidade,
  evento,
  unicos,
  dataBr,
  dataDia,
  diasDoMes,
  diasIntervalo,
  datasPorExtenso,
  linhasTabela,
  links,
  texto,
  limparHtml,
  meses,
} from "./utils";

export const FONTES_SUPORTADAS = [
  {
    tribunal: "TJSP",
    descricao: "Feriados e suspensões por município e ano",
    url: "https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense",
  },
  {
    tribunal: "TRF3",
    descricao:
      "TRF3 e JFSP: atos anuais consolidados, feriados locais e alterações publicadas na página de calendários",
    url: "https://www.trf3.jus.br/seju/calendario-dos-feriados/",
  },
  {
    tribunal: "TRF4",
    descricao: "TRF4, JFRS, JFSC e JFPR por subseção",
    url: "https://www.trf4.jus.br/trf4/controlador.php?acao=calendario_feriados_listar",
  },
  {
    tribunal: "TJDFT",
    descricao: "Calendário de feriados e expedientes suspensos",
    url: "https://www.tjdft.jus.br/feriados-e-expedientes-suspensos",
  },
];
function segundoGrau(e: EscopoCalendario) {
  return e.instancia
    ? e.instancia === "segundo"
    : !/(?:vara|juizado|recursal|subsecao)/.test(norm(e.orgao)) &&
        /(?:turma|camara|secao|presidencia|tribunal|orgao especial)/.test(
          norm(e.orgao),
        );
}
function validarAno(html: string, ano: number) {
  if (
    !new RegExp(
      `(?:ano\\s*(?:de)?\\s*|feriados\\s*(?:de)?\\s*|calendario\\D{0,70})${ano}\\b`,
      "i",
    ).test(norm(texto(html)))
  )
    throw new FonteCalendarioError(
      `A fonte oficial não confirmou o calendário do ano ${ano}.`,
      "sem_fonte",
    );
}
const recesso = (ano: number, fonte: string) => [
  evento(
    "feriado",
    `${ano}-01-01`,
    `${ano}-01-06`,
    "Recesso forense — sem expediente",
    fonte,
  ),
  evento(
    "feriado",
    `${ano}-12-20`,
    `${ano}-12-31`,
    "Recesso forense — sem expediente",
    fonte,
  ),
];

/** Restrições de unidade não são aplicadas indiscriminadamente à comarca inteira. */
export function abrangenciaSuspensao(
  descricao: string,
  orgao: string,
): "aplica" | "ignorar" | "pendencia" {
  const s = norm(descricao),
    o = norm(orgao);
  if (
    !/vara|juizado|foro regional|upj|nucleo|deecrim|processos fisicos|presencial/.test(
      s,
    )
  )
    return "aplica";
  const materias = [
    "violencia domestica",
    "criancas e adolescentes",
    "acidentes do trabalho",
    "execucoes criminais",
    "fazenda publica",
    "familia",
    "civeis",
    "criminal",
  ];
  const materiaOrg = norm(o.replace(/civel/g, "civeis"));
  const citadas = materias.filter((m) => s.includes(m));
  if (
    citadas.length &&
    materias.some((m) => materiaOrg.includes(m)) &&
    !citadas.some((m) => materiaOrg.includes(m))
  )
    return "ignorar";
  const regionais = [...s.matchAll(/foro regional\s+([ivxlcdm]+|\d+)\b/g)].map(
      (m) => m[1],
    ),
    regionalOrg = /foro regional\s+([ivxlcdm]+|\d+)\b/.exec(o)?.[1];
  if (regionais.length && regionalOrg && !regionais.includes(regionalOrg))
    return "ignorar";
  const numero = /(\d+)\s*(?:a|o)?\s*vara\b/.exec(o)?.[1];
  const numeros = [
    ...s.matchAll(/(\d+)\s*(?:a|o)?(?:\s+a\s+(\d+)\s*(?:a|o)?)?\s*varas?\b/g),
  ];
  if (
    numero &&
    numeros.length === 1 &&
    (s.split(/\bvaras?\b/)[0].match(/\d+/g) || []).length === 1 &&
    !numeros.some(
      (m) =>
        Number(numero) >= Number(m[1]) &&
        Number(numero) <= Number(m[2] || m[1]),
    )
  )
    return "ignorar";
  if (
    /processos fisicos|presencial/.test(s) &&
    !/prazos processuais|prazos dos processos eletronicos/.test(s)
  )
    return "pendencia";
  // Referência literal à unidade completa e sem outras restrições é suficiente.
  if (
    o.length > 12 &&
    s.includes(o) &&
    !/exclusiv|relacionad[ao]s na tabela|primeiro dia/.test(s)
  )
    return "aplica";
  return "pendencia";
}

export function parseTjsp(
  feriados: unknown,
  suspensoes: unknown,
  e: EscopoCalendario,
  fonte: string,
): EventoForense[] {
  const f = feriados as { data?: unknown[] },
    s = suspensoes as { data?: unknown[] };
  if (!Array.isArray(f?.data) || !Array.isArray(s?.data) || f.data.length < 5)
    throw new FonteCalendarioError(
      "O TJSP não retornou um calendário anual válido para o município/ano. Nenhuma lista vazia foi aceita como calendário completo.",
    );
  const out: EventoForense[] = [];
  for (const raw of f.data) {
    const row = raw as { Data: string; Descricao: string };
    if (typeof row.Data !== "string" || typeof row.Descricao !== "string")
      throw new FonteCalendarioError("Formato de feriado inesperado no TJSP.");
    const d = dataBr(row.Data);
    if (!d.startsWith(String(e.ano)))
      throw new FonteCalendarioError("O TJSP retornou outro ano.");
    out.push(evento("feriado", d, d, row.Descricao, fonte));
  }
  for (const raw of s.data) {
    const row = raw as { Data: string; Descricao: string; DJE?: string };
    if (typeof row.Data !== "string" || typeof row.Descricao !== "string")
      throw new FonteCalendarioError(
        "Formato de suspensão inesperado no TJSP.",
      );
    const datas = row.Data.split(/\s+a\s+/i).map(dataBr);
    if (datas.length > 2)
      throw new FonteCalendarioError(
        "Intervalo de suspensão inesperado no TJSP.",
      );
    const inicio = datas[0],
      fim = datas.at(-1)!;
    if (!inicio.startsWith(String(e.ano)) || !fim.startsWith(String(e.ano)))
      throw new FonteCalendarioError("Suspensão fora do ano consultado.");
    const abrangencia = abrangenciaSuspensao(row.Descricao, e.orgao);
    if (abrangencia === "ignorar") continue;
    const n = norm(row.Descricao),
      tipo =
        abrangencia === "pendencia"
          ? "pendencia"
          : /recesso/.test(n)
            ? "feriado"
            : /inicio do expediente|expediente.*(?:a partir|apos)|encerramento antecipado/.test(
                  n,
                )
              ? "expediente_parcial"
              : "suspensao";
    out.push(evento(tipo, inicio, fim, row.Descricao, fonte));
  }
  // O recesso consta da resposta de suspensões; não se inventam feriados não retornados.
  if (!out.some((x) => x.tipo === "feriado" && x.inicio.endsWith("-01-01")))
    throw new FonteCalendarioError(
      "A resposta do TJSP está incompleta: recesso inicial ausente.",
    );
  return unicos(out);
}
async function tjsp(
  e: EscopoCalendario,
  ler: LerFonteOficial,
): Promise<ImportacaoOficial> {
  const fonte = FONTES_SUPORTADAS[0].url,
    org = norm(e.orgao);
  let candidata =
    e.municipio ||
    (/foro regional\s+(?:[ivxlcdm]+|\d+)\b|comarca da capital|foro central/.test(
      org,
    )
      ? "São Paulo"
      : "");
  if (!candidata) {
    const m = /(?:foro|comarca)\s+(?:de|da|do)\s+(.+?)(?:\s+-\s+|$)/i.exec(
      e.orgao,
    );
    candidata =
      m?.[1] ||
      (e.orgao.includes(" - ")
        ? e.orgao
            .split(/\s+-\s+/)
            .filter((s) => !/(?:vara|juizado)/i.test(s))
            .at(-1)
        : "") ||
      e.orgao.split(/\s+(?:de|em)\s+/i).at(-1) ||
      "";
  }
  if (candidata.length > 100 || norm(candidata).length < 3)
    throw new FonteCalendarioError(
      "Informe o município do órgão para importar o calendário TJSP.",
      "localidade_pendente",
    );
  let municipios: unknown;
  try {
    municipios = JSON.parse(
      await ler("https://www.tjsp.jus.br/AutoComplete/ListarMunicipios", {
        method: "POST",
        body: new URLSearchParams({ texto: candidata }).toString(),
      }),
    );
  } catch (err) {
    if (err instanceof FonteCalendarioError) throw err;
    throw new FonteCalendarioError(
      "Resposta inválida na identificação do município TJSP.",
    );
  }
  if (!Array.isArray(municipios))
    throw new FonteCalendarioError(
      "O TJSP não identificou o município. Informe a localidade nas configurações.",
      "localidade_pendente",
    );
  const exato = municipios.filter(
    (m: { Descricao?: string }) =>
      typeof m.Descricao === "string" && norm(m.Descricao) === norm(candidata),
  );
  if (exato.length !== 1)
    throw new FonteCalendarioError(
      "Município ambíguo ou não localizado no TJSP. Selecione a localidade nas configurações.",
      "localidade_pendente",
    );
  const municipio = exato[0] as { Codigo: number; Descricao: string };
  if (!Number.isInteger(municipio.Codigo) || municipio.Codigo <= 0)
    throw new FonteCalendarioError("Código de município inválido na fonte.");
  const anos = await ler(
    "https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ObterAnos",
  );
  if (!new RegExp(`<option[^>]*value=["']${e.ano}["']`, "i").test(anos))
    throw new FonteCalendarioError(
      `Calendário TJSP ${e.ano} ainda não disponível na fonte oficial.`,
      "sem_fonte",
    );
  const q = new URLSearchParams({
      nomeMunicipio: municipio.Descricao,
      codigoMunicipio: String(municipio.Codigo),
      ano: String(e.ano),
    }),
    u1 = `https://www.tjsp.jus.br/CanaisComunicacao/Feriados/PesquisarFeriados?${q}`,
    u2 = `https://www.tjsp.jus.br/CanaisComunicacao/Feriados/PesquisarSuspensoes?${q}`;
  let dados: unknown[];
  try {
    dados = await Promise.all([
      ler(u1).then(JSON.parse),
      ler(u2).then(JSON.parse),
    ]);
  } catch (err) {
    if (err instanceof FonteCalendarioError) throw err;
    throw new FonteCalendarioError(
      "O TJSP não devolveu dados de calendário em formato válido.",
    );
  }
  const eventos = parseTjsp(dados[0], dados[1], e, fonte);
  return {
    municipio: municipio.Descricao,
    uf: "SP",
    eventos,
    fontes: [fonte, u1, u2],
    avisos: eventos.some((x) => x.tipo === "pendencia")
      ? [
          "Há atos restritos a unidades/processos. Só os intervalos pendentes que afetarem a contagem exigem complemento manual.",
        ]
      : [],
  };
}

export function parseTrf4(
  html: string,
  ano: number,
  orgao: string,
  municipio?: string,
) {
  validarAno(html, ano);
  const rows = linhasTabela(html)
    .filter((r) => r.length === 5 || r.length === 6)
    .filter((r) => meses[norm(r[0])]);
  if (rows.length < 10)
    throw new FonteCalendarioError(
      "Tabela anual do TRF4 ausente ou incompleta.",
    );
  const locais = rows
    .filter((r) => r.length === 6 && norm(r[2]) !== "todas")
    .map((r) => r[2]);
  const cidade = locais.length
    ? escolherCidade(orgao, locais, municipio)
    : "Porto Alegre";
  const out: EventoForense[] = [];
  for (const r of rows) {
    if (r.length === 6 && norm(r[2]) !== "todas" && norm(r[2]) !== norm(cidade))
      continue;
    const descricao = r[r.length === 6 ? 3 : 2],
      fonte =
        "https://www.trf4.jus.br/trf4/controlador.php?acao=calendario_feriados_listar";
    for (const dia of diasDoMes(r[1], ano, meses[norm(r[0])]))
      out.push(evento("feriado", dia, dia, descricao, fonte));
  }
  return { cidade, eventos: unicos(out), cidades: [...new Set(locais)] };
}

async function trf4(
  e: EscopoCalendario,
  ler: LerFonteOficial,
): Promise<ImportacaoOficial> {
  const base =
    "https://www.trf4.jus.br/trf4/controlador.php?acao=calendario_feriados_listar";
  if (segundoGrau(e)) {
    const url = `${base}&selOrgao=1&ano=${e.ano}`,
      r = parseTrf4(await ler(url), e.ano, e.orgao);
    return {
      municipio: r.cidade,
      uf: "RS",
      eventos: r.eventos,
      fontes: [url],
      avisos: [],
    };
  }
  const regioes = e.uf
    ? ([{ RS: 2, SC: 3, PR: 4 }[e.uf]].filter(Boolean) as number[])
    : [2, 3, 4];
  if (!regioes.length)
    throw new FonteCalendarioError(
      "UF não atendida pelo TRF4.",
      "localidade_pendente",
    );
  const resultados: ImportacaoOficial[] = [];
  let erro: unknown;
  for (const id of regioes) {
    const url = `${base}&selOrgao=${id}&ano=${e.ano}`;
    try {
      const r = parseTrf4(await ler(url), e.ano, e.orgao, e.municipio);
      resultados.push({
        municipio: r.cidade,
        uf: ({ 2: "RS", 3: "SC", 4: "PR" } as Record<number, string>)[id],
        eventos: r.eventos,
        fontes: [url],
        avisos: [],
      });
    } catch (e) {
      erro = e;
      if (
        !(e instanceof FonteCalendarioError) ||
        e.motivo !== "localidade_pendente"
      )
        throw e;
    }
  }
  if (resultados.length !== 1)
    throw resultados.length > 1
      ? new FonteCalendarioError(
          "A cidade aparece em mais de uma seção. Informe a UF nas configurações.",
          "localidade_pendente",
        )
      : erro;
  return resultados[0];
}

export function parseTjdft(html: string, ano: number, fonte: string) {
  const rows = linhasTabela(html).filter(
    (r) => r.length === 2 && /^\d{2}\/\d{2}\/\d{4}$/.test(r[0]),
  );
  const alvo = rows.filter((r) => r[0].endsWith(`/${ano}`));
  if (alvo.length < 10)
    throw new FonteCalendarioError(
      `Calendário TJDFT ${ano} não disponível na fonte.`,
      "sem_fonte",
    );
  return unicos(
    alvo.map((r) => {
      const d = dataBr(r[0]),
        n = norm(r[1]);
      return evento(
        /suspensao de prazo/.test(n)
          ? "suspensao"
          : /inicio do expediente|encerramento antecipado|expediente.*a partir/.test(
                n,
              )
            ? "expediente_parcial"
            : "feriado",
        d,
        d,
        r[1],
        fonte,
      );
    }),
  );
}
async function tjdft(
  e: EscopoCalendario,
  ler: LerFonteOficial,
): Promise<ImportacaoOficial> {
  let url = FONTES_SUPORTADAS[3].url,
    html = await ler(url);
  if (!linhasTabela(html).some((r) => r[0]?.endsWith(`/${e.ano}`))) {
    const proximo = links(html, url).find((a) =>
      /proximo ano|anterior/.test(norm(a.texto)),
    );
    if (proximo) {
      url = proximo.url;
      html = await ler(url);
    }
  }
  return {
    municipio: "Distrito Federal",
    uf: "DF",
    eventos: parseTjdft(html, e.ano, url),
    fontes: [url],
    avisos: [],
  };
}

export function parseAtoAnualTrf3(
  html: string,
  ano: number,
  uf: string,
  fonte: string,
): EventoForense[] {
  validarAno(html, ano);
  const rows = linhasTabela(html).filter(
    (r) =>
      r.length === 2 && Object.keys(meses).some((m) => norm(r[0]).includes(m)),
  );
  if (rows.length < 10)
    throw new FonteCalendarioError(
      "Tabela anual dos feriados do TRF3 não reconhecida.",
    );
  const out: EventoForense[] = [];
  for (const r of rows) {
    if (
      /somente (?:no estado|na sede).*sao paulo/.test(norm(r[1])) &&
      uf !== "SP"
    )
      continue;
    if (
      /somente para a turma regional de mato grosso do sul/.test(norm(r[1])) &&
      uf !== "MS"
    )
      continue;
    const datas = datasPorExtenso(r[0], ano);
    if (!datas.length)
      throw new FonteCalendarioError("Data da tabela anual não reconhecida.");
    for (const d of datas) out.push(evento("feriado", d, d, r[1], fonte));
  }
  if (!/20 de dezembro a 06 de janeiro/.test(norm(texto(html))))
    throw new FonteCalendarioError(
      "A fonte não confirmou o recesso forense anual.",
    );
  out.push(...recesso(ano, fonte));
  for (const p of paragrafosAtos(html)) {
    const n = norm(p);
    if (!/^art\s+\d/.test(n)) continue;
    if (/nao havera expediente/.test(n)) {
      for (const d of datasPorExtenso(p, ano))
        out.push(evento("feriado", d, d, p, fonte));
    } else if (/expediente.*inicio|inicio.*expediente/.test(n)) {
      for (const d of datasPorExtenso(p, ano))
        out.push(evento("expediente_parcial", d, d, p, fonte));
    }
  }
  return unicos(out);
}
function paragrafosAtos(html: string) {
  return [...limparHtml(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
    (m) => texto(m[1]),
  );
}
export function parseMunicipaisJfsp(html: string, ano: number) {
  validarAno(html, ano);
  const rows = linhasTabela(html).filter(
    (r) =>
      r.length === 2 &&
      datasPorExtenso(r[1], ano).length > 0 &&
      r[0].length < 80,
  );
  if (rows.length < 15)
    throw new FonteCalendarioError(
      "Tabela de feriados municipais da JFSP não reconhecida.",
    );
  return rows.map((r) => ({ cidade: r[0], datas: datasPorExtenso(r[1], ano) }));
}
function htmAto(familia: string, ano: number, numero: number) {
  return `https://web.trf3.jus.br/atos-normativos/atos-normativos-dir/${encodeURIComponent(familia)}/Portarias/${ano}/Portaria${String(numero).padStart(4, "0")}.htm`;
}
async function trf3(
  e: EscopoCalendario,
  ler: LerFonteOficial,
): Promise<ImportacaoOficial> {
  if (segundoGrau(e)) {
    const indice = "https://www.trf3.jus.br/seju/calendario-dos-feriados/",
      html = await ler(indice);
    const row = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].find(
      (m) =>
        linhasTabela(`<table><tr>${m[1]}</tr></table>`)[0]?.[0] ===
        String(e.ano),
    );
    if (!row)
      throw new FonteCalendarioError(
        `Calendário TRF3 ${e.ano} ainda não publicado.`,
        "sem_fonte",
      );
    const lis = [...row[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    const docs = lis
      .map((m) => {
        const s = texto(m[1]),
          numero = /CATRF3R\s*n[.º°o\s]*(\d+)/i.exec(s)?.[1],
          data = /\b\d{2}\/\d{2}\/(\d{4})\b/.exec(s)?.[1];
        return { numero: Number(numero), ano: Number(data), texto: s };
      })
      .filter((x) => x.numero && x.ano);
    if (!docs.length)
      throw new FonteCalendarioError("Atos anuais do TRF3 não identificados.");
    const fontes = [indice],
      eventos: EventoForense[] = [];
    let anualConsolidado = "";
    const uf =
      e.uf || (/mato grosso do sul|campo grande/i.test(e.orgao) ? "MS" : "SP");
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i],
        url = htmAto("Conselho de Administração", doc.ano, doc.numero),
        body = await ler(url);
      fontes.push(url);
      if (i === 0) {
        anualConsolidado = norm(texto(body));
        eventos.push(...parseAtoAnualTrf3(body, e.ano, uf, url));
      } else if (/alterar o artigo/.test(norm(texto(body)))) {
        if (
          !anualConsolidado.includes(`portaria n ${doc.numero}`) &&
          !anualConsolidado.includes(`portaria catrf3 n ${doc.numero}`)
        )
          throw new FonteCalendarioError(
            "Alteração ainda não consolidada no calendário anual. Confira o ato e complemente manualmente.",
          );
      } else
        for (const p of paragrafosAtos(body)) {
          const n = norm(p);
          if (
            !/^art\s+\d/.test(n) ||
            !/suspender.*(?:prazos|atendimento)|suspensao.*prazos|nao havera expediente/.test(
              n,
            )
          )
            continue;
          const ds = datasPorExtenso(p, e.ano);
          if (!ds.length)
            throw new FonteCalendarioError(
              "Alteração do calendário TRF3 sem data reconhecida; complemente manualmente.",
            );
          const tipo =
            /exclusivamente|processos fisicos/.test(n) &&
            (!/eletronicos/.test(n) || /exclusivamente/.test(n))
              ? "pendencia"
              : /atendimento presencial/.test(n)
                ? "pendencia"
                : /suspender.*prazos|suspensao.*prazos/.test(n)
                  ? "suspensao"
                  : /inicio|antecipad|prorrog|encerrad/.test(n)
                    ? "expediente_parcial"
                    : /nao havera expediente/.test(n)
                      ? "feriado"
                      : "pendencia";
          for (const d of ds) eventos.push(evento(tipo, d, d, p, url));
        }
    }
    return {
      municipio: uf === "MS" ? "Campo Grande" : "São Paulo",
      uf,
      eventos: unicos(eventos),
      fontes,
      avisos: [],
    };
  }
  if (e.uf && e.uf !== "SP")
    throw new FonteCalendarioError(
      "A fonte automática de municípios desta seção ainda não confirmou o calendário solicitado. Use o cadastro manual como alternativa.",
      "sem_fonte",
    );
  const indice =
      "https://www.jfsp.jus.br/servicos-judiciais/calendarios-dos-feriados/",
    html = await ler(indice),
    anchors = links(html, indice);
  const anual = anchors.find(
      (a) =>
        /CJF3R/.test(a.texto) &&
        new RegExp(`\\b${e.ano}\\b`).test(a.texto) &&
        /expediente/i.test(a.texto),
    ),
    local = anchors.find(
      (a) =>
        new RegExp(`\\b${e.ano}\\b`).test(a.texto) &&
        /DFORSP/i.test(a.texto) &&
        /comunica os feriados municipais/i.test(a.texto) &&
        !/altera/i.test(a.texto),
    );
  if (!anual || !local)
    throw new FonteCalendarioError(
      `Fontes anual e municipal da JFSP ${e.ano} ainda não disponíveis.`,
      "sem_fonte",
    );
  const numero = /DFORSP\s*n[.º°o\s]*(\d+)/i.exec(local.texto)?.[1];
  if (!numero)
    throw new FonteCalendarioError("Ato municipal da JFSP não identificado.");
  const localUrl = htmAto(
      "Diretoria do Foro de São Paulo",
      e.ano,
      Number(numero),
    ),
    municipais = parseMunicipaisJfsp(await ler(localUrl), e.ano),
    cidade = escolherCidade(
      e.orgao,
      municipais.map((m) => m.cidade),
      e.municipio,
    );
  const anualUrl = anual.url.replace(/^http:/, "https:"),
    eventos = parseAtoAnualTrf3(await ler(anualUrl), e.ano, "SP", anualUrl);
  for (const d of municipais.find((m) => norm(m.cidade) === norm(cidade))!
    .datas)
    eventos.push(
      evento("feriado", d, d, `Feriado municipal de ${cidade}`, localUrl),
    );
  return {
    municipio: cidade,
    uf: "SP",
    eventos: unicos(eventos),
    fontes: [indice, anualUrl, localUrl],
    avisos: [
      "Calendário anual e municipal consolidado da JFSP. Atos extraordinários não publicados nessas fontes podem ser complementados manualmente.",
    ],
  };
}

export async function importarFonte(
  e: EscopoCalendario,
  ler: LerFonteOficial,
): Promise<ImportacaoOficial> {
  if (e.tribunal === "TJSP") return tjsp(e, ler);
  if (e.tribunal === "TRF4") return trf4(e, ler);
  if (e.tribunal === "TRF3") return trf3(e, ler);
  if (e.tribunal === "TJDFT") return tjdft(e, ler);
  throw new FonteCalendarioError(
    `Ainda não há uma fonte automática validada para ${e.tribunal}. O calendário manual continua disponível.`,
    "sem_fonte",
  );
}
