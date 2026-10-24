import { registrarHistoricoDjen } from "./history";
import { dadosAcompanhamento } from "./workflow";
import { db } from "../../db";
import { getContact } from "../contactsService";
import { normalizeProcesso } from "../../utils/processo";
import {
  CATEGORIAS_DJEN,
  RESULTADOS_DJEN,
  ordemComPrazoDaParte,
  type CategoriaDjen,
} from "./classifier";
import {
  normalizarOab,
  correspondenciaAdvogado,
  type AdvogadoDjen,
  type PublicacaoDjen,
} from "./api";

export class DjenInputError extends Error {}

const nomeChaveCliente = (value: string | null | undefined) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+\([ap]\)\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function vincularProcessoAutomaticamente(
  processoChave: string,
  destinatarios: { nome: string; polo?: string }[],
) {
  if (!processoChave || !destinatarios.length) return null;
  const processo = db
    .prepare("SELECT cliente_id FROM djen_processos WHERE chave=?")
    .get(processoChave) as { cliente_id: number | null } | undefined;
  if (!processo || processo.cliente_id) return processo?.cliente_id || null;

  const nomes = new Set(destinatarios.map((d) => nomeChaveCliente(d.nome)).filter(Boolean));
  const candidatos = (
    db
      .prepare(
        "SELECT id,nome,processo,processo_chave FROM contacts WHERE processo_chave=? OR (processo_chave='' AND processo IS NOT NULL)",
      )
      .all(processoChave) as {
      id: number;
      nome: string;
      processo: string | null;
      processo_chave: string;
    }[]
  ).filter(
    (contato) =>
      (contato.processo_chave === processoChave ||
        normalizeProcesso(contato.processo) === processoChave) &&
      nomes.has(nomeChaveCliente(contato.nome)),
  );
  const ids = [...new Set(candidatos.map((c) => c.id))];
  if (ids.length !== 1) return null;
  db.prepare(
    "UPDATE djen_processos SET cliente_id=? WHERE chave=? AND cliente_id IS NULL",
  ).run(ids[0], processoChave);
  return ids[0];
}

function vincularProcessosPendentes() {
  const pendentes = db
    .prepare(
      `SELECT pr.chave,p.destinatarios_json
         FROM djen_processos pr
         JOIN djen_publicacoes p ON p.id=(
           SELECT p2.id FROM djen_publicacoes p2
            WHERE p2.processo_chave=pr.chave
            ORDER BY p2.id DESC LIMIT 1
         )
        WHERE pr.cliente_id IS NULL`,
    )
    .all() as { chave: string; destinatarios_json: string }[];
  for (const item of pendentes) {
    try {
      vincularProcessoAutomaticamente(item.chave, JSON.parse(item.destinatarios_json || "[]"));
    } catch {
      // Dados incompletos permanecem para vínculo manual; nunca vinculamos por suposição.
    }
  }
}

const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  ),
);
export function listarAdvogados(): AdvogadoDjen[] {
  return db
    .prepare("SELECT * FROM djen_advogados ORDER BY nome, id")
    .all() as AdvogadoDjen[];
}
export function salvarAdvogado(
  data: Record<string, unknown>,
  id?: number,
): AdvogadoDjen {
  const nome = typeof data.nome === "string" ? data.nome.trim() : "";
  const numero =
    typeof data.numero_oab === "string" ? normalizarOab(data.numero_oab) : "";
  const uf =
    typeof data.uf_oab === "string" ? data.uf_oab.trim().toUpperCase() : "";
  const modo = data.modo_busca || "ambos";
  if (nome.length < 4 || nome.length > 200)
    throw new DjenInputError("Informe o nome completo do advogado.");
  if (!/^\d{1,8}[A-Z]?$/.test(numero) || !UFS.has(uf))
    throw new DjenInputError("Informe o número da OAB e uma UF válida.");
  if (!["ambos", "nome", "oab"].includes(String(modo)))
    throw new DjenInputError("Modo de busca inválido.");
  const atual = id
    ? (db.prepare("SELECT * FROM djen_advogados WHERE id = ?").get(id) as
        | AdvogadoDjen
        | undefined)
    : null;
  if (id && !atual) throw new DjenInputError("Advogado não encontrado.");
  if (atual && (atual.numero_oab !== numero || atual.uf_oab !== uf))
    throw new DjenInputError(
      "Para outra inscrição, adicione um novo advogado. A OAB dos registros anteriores é preservada.",
    );
  const ativo = data.ativo === false || data.ativo === 0 ? 0 : 1;
  if (
    ativo &&
    (!atual || !atual.ativo) &&
    listarAdvogados().filter((a) => a.ativo).length >= 50
  )
    throw new DjenInputError(
      "Mantenha no máximo 50 advogados ativos por monitoramento.",
    );
  const repetido = db
    .prepare(
      "SELECT id FROM djen_advogados WHERE numero_oab = ? AND uf_oab = ? AND id <> ?",
    )
    .get(numero, uf, id || 0);
  if (repetido)
    throw new DjenInputError("Essa inscrição da OAB já está cadastrada.");
  if (atual)
    db.prepare(
      `UPDATE djen_advogados SET nome=?, modo_busca=?, ativo=?, cursor_data=CASE WHEN nome<>? OR modo_busca<>? THEN NULL ELSE cursor_data END WHERE id=?`,
    ).run(nome, modo, ativo, nome, modo, id);
  else
    id = Number(
      db
        .prepare(
          "INSERT INTO djen_advogados(nome,numero_oab,uf_oab,modo_busca,ativo) VALUES (?,?,?,?,?)",
        )
        .run(nome, numero, uf, modo, ativo).lastInsertRowid,
    );
  return db
    .prepare("SELECT * FROM djen_advogados WHERE id = ?")
    .get(id) as AdvogadoDjen;
}
export function configuracaoDjen() {
  return db.prepare("SELECT * FROM djen_config WHERE id=1").get() as {
    automatico: number;
    intervalo_minutos: number;
    janela_inicial_dias: number;
    ia_ativa: number;
    ia_pausa: string | null;
    ia_paralelismo: number;
    ia_modo: "economico" | "equilibrado" | "precisao";
    aguardo_dias: number;
  };
}
export function salvarConfiguracaoDjen(data: Record<string, unknown>) {
  if (data.aguardo_dias !== undefined && ![15, 30, 60, 90].includes(Number(data.aguardo_dias)))
    throw new DjenInputError("Use 15, 30, 60 ou 90 dias para o alerta de espera.");
  if (
    data.ia_paralelismo !== undefined &&
    (!Number.isInteger(data.ia_paralelismo) ||
      Number(data.ia_paralelismo) < 1 ||
      Number(data.ia_paralelismo) > 3)
  )
    throw new DjenInputError("Use de 1 a 3 análises simultâneas.");
  if (
    data.ia_modo !== undefined &&
    !["economico", "equilibrado", "precisao"].includes(String(data.ia_modo))
  )
    throw new DjenInputError("Modo de análise do Codex inválido.");
  const intervalo = Number(data.intervalo_minutos),
    janela = Number(data.janela_inicial_dias);
  if (
    !Number.isInteger(intervalo) ||
    intervalo < 30 ||
    intervalo > 1440 ||
    !Number.isInteger(janela) ||
    janela < 1 ||
    janela > 31
  )
    throw new DjenInputError(
      "Use um intervalo de 30 a 1440 minutos e uma janela de 1 a 31 dias.",
    );
  db.prepare(
    "UPDATE djen_config SET automatico=?, intervalo_minutos=?, janela_inicial_dias=? WHERE id=1",
  ).run(data.automatico === true ? 1 : 0, intervalo, janela);
  if (typeof data.ia_ativa === "boolean")
    db.prepare("UPDATE djen_config SET ia_ativa=? WHERE id=1").run(
      data.ia_ativa ? 1 : 0,
    );
  if (data.ia_paralelismo !== undefined)
    db.prepare("UPDATE djen_config SET ia_paralelismo=? WHERE id=1").run(
      data.ia_paralelismo,
    );
  if (data.ia_modo !== undefined)
    db.prepare("UPDATE djen_config SET ia_modo=? WHERE id=1").run(data.ia_modo);
  if (data.aguardo_dias !== undefined)
    db.prepare("UPDATE djen_config SET aguardo_dias=? WHERE id=1").run(Number(data.aguardo_dias));
  return configuracaoDjen();
}
export function importarPublicacoes(
  items: PublicacaoDjen[],
  advogado: AdvogadoDjen,
  modo: "nome" | "oab",
) {
  return db.transaction(() => {
    let novas = 0;
    for (const p of items) {
      const correspondencia = correspondenciaAdvogado(p, advogado, modo);
      if (!correspondencia) continue;
      const chave =
        normalizeProcesso(p.processo) || `comunicacao:${p.comunicacao_id}`;
      db.prepare(
        "INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)",
      ).run(chave, p.processo);
      vincularProcessoAutomaticamente(chave, p.destinatarios);
      // Até a análise do Codex, permanece em Outros; não há inferência por palavras-chave.
      const classificacao = {
        categorias: [],
        evidencias: [],
        resultado: "nao_identificado",
      };
      const atual = db
        .prepare(
          "SELECT id,texto,tipo_documento,revisada FROM djen_publicacoes WHERE comunicacao_id=?",
        )
        .get(p.comunicacao_id) as
        | {
            id: number;
            texto: string;
            tipo_documento: string;
            revisada: number;
          }
        | undefined;
      const valores = [
        p.hash || null,
        chave,
        p.tribunal,
        p.orgao,
        p.classe,
        p.tipo_documento,
        p.tipo_comunicacao,
        p.data,
        p.texto,
        p.link,
        JSON.stringify(p.destinatarios),
        JSON.stringify(p.advogados),
        JSON.stringify(classificacao.categorias),
        JSON.stringify(classificacao.evidencias),
        classificacao.resultado,
        p.cancelada ? 1 : 0,
      ];
      let id = atual?.id;
      if (atual) {
        const preservar =
          atual.texto === p.texto && atual.tipo_documento === p.tipo_documento;
        db.prepare(
          `UPDATE djen_publicacoes SET hash=?,processo_chave=?,tribunal=?,orgao=?,classe=?,tipo_documento=?,tipo_comunicacao=?,data_disponibilizacao=?,texto=?,link=?,destinatarios_json=?,advogados_json=?,
          categorias_json=CASE WHEN ? THEN categorias_json ELSE ? END, evidencias_json=CASE WHEN ? THEN evidencias_json ELSE ? END, resultado=CASE WHEN ? THEN resultado ELSE ? END,
          cancelada=?, revisada=CASE WHEN ? THEN revisada ELSE 0 END, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        ).run(
          ...valores.slice(0, 12),
          preservar ? 1 : 0,
          valores[12],
          preservar ? 1 : 0,
          valores[13],
          preservar ? 1 : 0,
          valores[14],
          valores[15],
          preservar ? 1 : 0,
          id,
        );
        if (!preservar)
          db.prepare(
            "UPDATE djen_publicacoes SET ia_status='pendente',ia_json=NULL,ia_erro=NULL,ia_em=NULL,ia_versao='',ia_duracao_ms=NULL,situacao='' WHERE id=?",
          ).run(id);
        if (!preservar)
          registrarHistoricoDjen(
            id!,
            "captura",
            "Inteiro teor ou tipo documental atualizado pela fonte; análise e revisão pendentes.",
          );
      } else {
        id = Number(
          db
            .prepare(
              `INSERT INTO djen_publicacoes(comunicacao_id,hash,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,link,destinatarios_json,advogados_json,categorias_json,evidencias_json,resultado,cancelada)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(p.comunicacao_id, ...valores).lastInsertRowid,
        );
        registrarHistoricoDjen(id!, "captura", "Publicação capturada do DJEN.");
        novas++;
      }
      db.prepare(
        `INSERT INTO djen_publicacao_advogados(publicacao_id,advogado_id,correspondencia) VALUES (?,?,?)
        ON CONFLICT(publicacao_id,advogado_id) DO UPDATE SET correspondencia=CASE
        WHEN djen_publicacao_advogados.correspondencia='oab' OR excluded.correspondencia='oab' THEN 'oab'
        WHEN djen_publicacao_advogados.correspondencia='consulta_oab' OR excluded.correspondencia='consulta_oab' THEN 'consulta_oab' ELSE 'nome_revisar' END`,
      ).run(id, advogado.id, correspondencia);
    }
    return novas;
  })();
}
const SELECT_PUB = `SELECT p.*,(SELECT MIN(termino) FROM djen_prazos dp WHERE dp.publicacao_id=p.id AND dp.status='aberto') AS proximo_prazo,(SELECT count(*) FROM djen_prazos dp WHERE dp.publicacao_id=p.id AND dp.status='aberto') AS prazos_abertos,pr.numero AS processo,pr.cliente_id,pr.observacoes,c.nome AS cliente_nome,c.telefone AS cliente_telefone
  FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave LEFT JOIN contacts c ON c.id=pr.cliente_id`;
export interface PublicacaoRow {
  tribunal: string;
  orgao: string;
  classe: string;
  tipo_documento: string;
  situacao: string;
  id: number;
  processo_chave: string;
  processo: string;
  texto: string;
  categorias_json: string;
  evidencias_json: string;
  resultado: string;
  revisada: number;
  lida: number;
  concluida: number;
  ia_status: string;
  ia_json: string | null;
  cancelada: number;
  hash: string | null;
  cliente_id: number | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  data_disponibilizacao: string;
  [key: string]: unknown;
}
export function publicacaoPorId(id: number): PublicacaoRow | undefined {
  return db.prepare(SELECT_PUB + " WHERE p.id=?").get(id) as
    | PublicacaoRow
    | undefined;
}
export function apresentarPublicacao(p: PublicacaoRow, integral = false) {
  const advogados = db
    .prepare(
      `SELECT a.id,a.nome,a.numero_oab,a.uf_oab,pa.correspondencia FROM djen_publicacao_advogados pa JOIN djen_advogados a ON a.id=pa.advogado_id WHERE pa.publicacao_id=? ORDER BY a.nome`,
    )
    .all(p.id);
  const {
    texto,
    categorias_json,
    evidencias_json,
    destinatarios_json,
    advogados_json,
    ia_json,
    ...dados
  } = p;
  const analise = ia_json ? JSON.parse(String(ia_json)) : null;
  const providencia = analise?.providencia;
  const prazoExpresso = providencia?.tipo === "prazo_explicito" &&
    typeof providencia.prazo_texto === "string" &&
    ordemComPrazoDaParte(providencia.prazo_texto) &&
    ["escritorio", "cliente"].includes(providencia.responsavel);
  const cumprimento = providencia?.tipo === "cumprimento" &&
    ["escritorio", "cliente"].includes(providencia.responsavel);
  const destinatarios = JSON.parse(String(destinatarios_json || "[]")) as {
    nome?: string;
    polo?: string;
  }[];
  const parteNome = destinatarios.find((d) => d.nome)?.nome?.trim() || null;
  return {
    ...dados,
    analise,
    acao: {
      tipo: prazoExpresso ? "prazo_explicito" : cumprimento ? "cumprimento" : "ciencia",
      descricao: prazoExpresso || cumprimento ? providencia.descricao : null,
      prazo_texto: prazoExpresso ? providencia.prazo_texto : null,
    },
    parte_nome: parteNome,
    cliente_exibicao: dados.cliente_nome || parteNome,
    cliente_vinculado: Boolean(dados.cliente_id),
    texto: integral ? texto : undefined,
    resumo: analise?.resumo || texto.slice(0, 320),
    categorias: JSON.parse(categorias_json),
    evidencias: JSON.parse(evidencias_json),
    advogados,
    destinatarios: integral ? destinatarios : undefined,
    advogados_publicacao: integral
      ? JSON.parse(String(advogados_json))
      : undefined,
    certidao_url: p.hash
      ? `https://comunicaapi.pje.jus.br/api/v1/comunicacao/${encodeURIComponent(p.hash)}/certidao`
      : null,
  };
}

function apresentarProcessoAgrupado(p: PublicacaoRow, arquivo: string) {
  const escopo =
    arquivo === "ativos"
      ? " AND concluida=0"
      : arquivo === "concluidos"
        ? " AND concluida=1"
        : "";
  const publicacoes = db
    .prepare(
      `SELECT id,categorias_json,lida,revisada,concluida,ia_status,ia_json,resultado
         FROM djen_publicacoes
        WHERE processo_chave=? AND cancelada=0${escopo}
        ORDER BY data_disponibilizacao DESC,id DESC`,
    )
    .all(p.processo_chave) as {
    id: number;
    categorias_json: string;
    lida: number;
    revisada: number;
    concluida: number;
    ia_status: string;
    ia_json: string | null;
    resultado: string;
  }[];
  const categorias = new Set<CategoriaDjen>();
  let periciaPublicacaoId: number | null = null;
  let acao: { tipo: string; descricao: string | null; prazo_texto: string | null } = { tipo: "ciencia", descricao: null, prazo_texto: null };
  let resultadoSentenca = "nao_identificado";
  for (const item of publicacoes) {
    const categoriasItem = JSON.parse(item.categorias_json || "[]") as CategoriaDjen[];
    for (const categoria of categoriasItem)
      categorias.add(categoria);
    if (!periciaPublicacaoId && categoriasItem.includes("pericia"))
      periciaPublicacaoId = item.id;
    if (categoriasItem.includes("sentenca") && resultadoSentenca === "nao_identificado")
      resultadoSentenca = item.resultado;
    try {
      const providencia = item.ia_json ? JSON.parse(item.ia_json).providencia : null;
      if (providencia && ["escritorio", "cliente"].includes(providencia.responsavel)) {
        const prazoValido = providencia.tipo === "prazo_explicito" &&
          typeof providencia.prazo_texto === "string" &&
          ordemComPrazoDaParte(providencia.prazo_texto);
        if (prazoValido && acao.tipo !== "prazo_explicito")
          acao = { tipo: "prazo_explicito", descricao: providencia.descricao, prazo_texto: providencia.prazo_texto };
        else if (providencia.tipo === "cumprimento" && acao.tipo === "ciencia")
          acao = { tipo: "cumprimento", descricao: providencia.descricao, prazo_texto: null };
      }
    } catch { /* análise antiga incompleta */ }
  }
  const ids = publicacoes.map((item) => item.id);
  const prazos = ids.length
    ? (db
        .prepare(
          `SELECT MIN(termino) AS proximo_prazo,COUNT(*) AS prazos_abertos
             FROM djen_prazos
            WHERE status='aberto' AND publicacao_id IN (${ids.map(() => "?").join(",")})`,
        )
        .get(...ids) as { proximo_prazo: string | null; prazos_abertos: number })
    : { proximo_prazo: null, prazos_abertos: 0 };
  const apresentada = apresentarPublicacao(p);
  return {
    ...apresentada,
    categorias: CATEGORIAS_DJEN.filter((categoria) => categorias.has(categoria)),
    resultado: resultadoSentenca,
    acao,
    lida: publicacoes.every((item) => Boolean(item.lida)) ? 1 : 0,
    revisada: publicacoes.every((item) => Boolean(item.revisada)) ? 1 : 0,
    concluida: publicacoes.every((item) => Boolean(item.concluida)) ? 1 : 0,
    ia_status: publicacoes.some((item) => item.ia_status === "analisando")
      ? "analisando"
      : publicacoes.some((item) => item.ia_status === "erro")
        ? "erro"
        : publicacoes.some((item) => item.ia_status === "pendente")
          ? "pendente"
          : apresentada.ia_status,
    andamentos_total: publicacoes.length,
    andamentos_nao_lidos: publicacoes.filter((item) => !item.lida).length,
    pericia_publicacao_id: periciaPublicacaoId,
    ...prazos,
  };
}
function montarConsultaPublicacoes(filtro: Record<string, string>) {
  const where: string[] = [],
    values: (string | number)[] = [];
  const arquivo = filtro.arquivo || "ativos";
  if (!["ativos", "concluidos", "todos"].includes(arquivo))
    throw new DjenInputError("Filtro de conclusão inválido.");
  const csv = (v: string | undefined) => [
    ...new Set(
      (v || "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  const categorias = csv(filtro.categoria).map((c) =>
    c === "outras" ? "outros" : c,
  );
  if (categorias.length) {
    if (
      categorias.some(
        (c) => c !== "outros" && !CATEGORIAS_DJEN.includes(c as CategoriaDjen),
      )
    )
      throw new DjenInputError("Categoria de filtro inválida.");
    const especificas = categorias.filter((c) => c !== "outros");
    const opcoes: string[] = [];
    if (especificas.length) {
      opcoes.push(
        `EXISTS(SELECT 1 FROM json_each(p.categorias_json) WHERE value IN (${especificas.map(() => "?").join(",")}))`,
      );
      values.push(...especificas);
    }
    if (categorias.includes("outros"))
      opcoes.push(
        `NOT EXISTS(
          SELECT 1 FROM djen_publicacoes outras
           WHERE outras.processo_chave=p.processo_chave
             AND outras.cancelada=0
             AND outras.categorias_json<>'[]'
             ${arquivo === "ativos" ? "AND outras.concluida=0" : arquivo === "concluidos" ? "AND outras.concluida=1" : ""}
        )`,
      );
    where.push("(" + opcoes.join(" OR ") + ")");
  }
  const resultados = csv(filtro.resultado);
  if (resultados.length) {
    if (
      resultados.some(
        (r) => !RESULTADOS_DJEN.includes(r as (typeof RESULTADOS_DJEN)[number]),
      )
    )
      throw new DjenInputError("Resultado de filtro inválido.");
    where.push(`p.resultado IN (${resultados.map(() => "?").join(",")})`);
    values.push(...resultados);
  }
  const advogados = csv(filtro.advogado_id);
  if (advogados.length) {
    if (
      advogados.length > 50 ||
      advogados.some((a) => !/^\d+$/.test(a) || Number(a) <= 0)
    )
      throw new DjenInputError("Advogado de filtro inválido.");
    where.push(
      `EXISTS(SELECT 1 FROM djen_publicacao_advogados pa WHERE pa.publicacao_id=p.id AND pa.advogado_id IN (${advogados.map(() => "?").join(",")}))`,
    );
    values.push(...advogados.map(Number));
  }
  if (arquivo !== "todos") where.push(arquivo === "concluidos" ? "p.concluida=1" : "p.concluida=0");
  const situacoes = csv(filtro.situacao);
  const condicoes: Record<string, string> = {
    nao_lidas: "p.lida=0",
    lidas: "p.lida=1",
    revisar: "p.revisada=0",
    com_prazo:
      "EXISTS(SELECT 1 FROM djen_prazos dp WHERE dp.publicacao_id=p.id AND dp.status='aberto')",
  };
  if (situacoes.some((s) => !Object.hasOwn(condicoes, s)))
    throw new DjenInputError("Situação de filtro inválida.");
  if (situacoes.length)
    where.push("(" + situacoes.map((s) => condicoes[s]).join(" OR ") + ")");
  if (filtro.busca?.trim()) {
    where.push(
      "(p.situacao LIKE ? ESCAPE '\\' OR p.texto LIKE ? ESCAPE '\\' OR pr.numero LIKE ? ESCAPE '\\' OR c.nome LIKE ? ESCAPE '\\')",
    );
    const text =
      "%" +
      filtro.busca
        .trim()
        .slice(0, 200)
        .replace(/[\\%_]/g, "\\$&") +
      "%";
    values.push(text, text, text, text);
  }
  if (filtro.inicio) {
    where.push("p.data_disponibilizacao>=?");
    values.push(filtro.inicio);
  }
  if (filtro.fim) {
    where.push("p.data_disponibilizacao<=?");
    values.push(filtro.fim);
  }
  const condition = where.length ? " WHERE " + where.join(" AND ") : "";
  return { condition, values, arquivo };
}
export function listarIdsPublicacoes(filtro: Record<string, string>) {
  vincularProcessosPendentes();
  const { condition, values, arquivo } = montarConsultaPublicacoes(filtro);
  if (arquivo !== "ativos") throw new DjenInputError("Selecione processos pendentes para a conclusão em lote.");
  const from = ` FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave
                LEFT JOIN contacts c ON c.id=pr.cliente_id` + condition;
  const total = (db.prepare("SELECT count(DISTINCT p.processo_chave) AS total" + from).get(...values) as { total: number }).total;
  if (total > 5000) throw new DjenInputError("Mais de 5.000 processos encontrados. Refine os filtros antes de selecionar todos.");
  const ids = (db.prepare("SELECT MIN(p.id) AS id" + from + " GROUP BY p.processo_chave").all(...values) as { id: number }[]).map((r) => r.id);
  return { ids, total };
}
export function listarPublicacoes(filtro: Record<string, string>) {
  vincularProcessosPendentes();
  const { condition, values, arquivo } = montarConsultaPublicacoes(filtro);
  const total = (
    db
      .prepare(
        "SELECT count(DISTINCT processo_chave) AS total FROM (" +
          SELECT_PUB +
          condition +
          ")",
      )
      .get(...values) as { total: number }
  ).total;
  const pagina = Math.max(
    1,
    Math.min(10000, Number.parseInt(filtro.pagina || "1", 10) || 1),
  );
  const grupos = db
    .prepare(
      `SELECT p.processo_chave,MAX(p.data_disponibilizacao) AS ultima_data,MAX(p.id) AS ultimo_id
         FROM djen_publicacoes p
         JOIN djen_processos pr ON pr.chave=p.processo_chave
         LEFT JOIN contacts c ON c.id=pr.cliente_id` +
        condition +
        " GROUP BY p.processo_chave ORDER BY ultima_data DESC,ultimo_id DESC LIMIT 25 OFFSET ?",
    )
    .all(...values, (pagina - 1) * 25) as { processo_chave: string }[];
  const rows = grupos.map((grupo) => {
    const extra = condition ? " AND p.processo_chave=?" : " WHERE p.processo_chave=?";
    return db
      .prepare(
        SELECT_PUB +
          condition +
          extra +
          " ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 1",
      )
      .get(...values, grupo.processo_chave) as PublicacaoRow;
  });
  return {
    items: rows.map((p) => apresentarProcessoAgrupado(p, arquivo)),
    total,
    pagina,
    por_pagina: 25,
  };
}
export function detalhesPublicacao(id: number) {
  const p = publicacaoPorId(id);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  const andamentos = listarAndamentosDoProcesso(id);
  const mensagens = db
    .prepare(
      "SELECT * FROM djen_mensagens WHERE publicacao_id=? ORDER BY id DESC LIMIT 30",
    )
    .all(id);
  return {
    ...apresentarPublicacao(p, true),
    relacionadas: andamentos.items,
    relacionadas_total: andamentos.total,
    ...dadosAcompanhamento(id, p.processo_chave),
    mensagens,
  };
}
export function revisarPublicacao(id: number, data: Record<string, unknown>) {
  const p = publicacaoPorId(id);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  const categorias = data.categorias;
  if (
    !Array.isArray(categorias) ||
    categorias.some((c) => !CATEGORIAS_DJEN.includes(c)) ||
    !RESULTADOS_DJEN.includes(
      data.resultado as (typeof RESULTADOS_DJEN)[number],
    )
  )
    throw new DjenInputError("Classificação inválida.");
  if (
    data.situacao !== undefined &&
    (typeof data.situacao !== "string" || data.situacao.length > 250)
  )
    throw new DjenInputError("Use até 250 caracteres para a situação.");
  db.prepare(
    "UPDATE djen_publicacoes SET categorias_json=?,resultado=?,revisada=1,ia_status=CASE WHEN ia_status='pendente' THEN 'nao_solicitada' ELSE ia_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).run(
    JSON.stringify([...new Set(categorias)]),
    categorias.includes("sentenca") ? data.resultado : "nao_identificado",
    id,
  );
  if (typeof data.situacao === "string")
    db.prepare("UPDATE djen_publicacoes SET situacao=? WHERE id=?").run(
      data.situacao.trim(),
      id,
    );
  registrarHistoricoDjen(
    id,
    "revisao",
    "Classificação revisada pelo usuário.",
    {
      antes: {
        categorias: JSON.parse(p.categorias_json),
        resultado: p.resultado,
        situacao: p.situacao,
      },
      depois: {
        categorias,
        resultado: data.resultado,
        situacao: data.situacao,
      },
    },
  );
  return detalhesPublicacao(id);
}
export function salvarProcessoDaPublicacao(
  id: number,
  data: Record<string, unknown>,
) {
  const p = publicacaoPorId(id);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  const cliente =
    data.cliente_id === null || data.cliente_id === ""
      ? null
      : Number(data.cliente_id);
  if (cliente !== null && (!Number.isInteger(cliente) || !getContact(cliente)))
    throw new DjenInputError("Escolha um contato válido da Agenda.");
  if (typeof data.observacoes !== "string" || data.observacoes.length > 10000)
    throw new DjenInputError("Use até 10 mil caracteres nas observações.");
  db.prepare(
    "UPDATE djen_processos SET cliente_id=?,observacoes=? WHERE chave=?",
  ).run(cliente, data.observacoes.trim(), p.processo_chave);
  registrarHistoricoDjen(
    id,
    "processo",
    "Contato ou anotações do processo atualizados pelo usuário.",
  );
  return detalhesPublicacao(id);
}
export function resumoDjen() {
  const categorias = Object.fromEntries(
    CATEGORIAS_DJEN.map((c) => [
      c,
      (
        db
          .prepare(
            "SELECT count(DISTINCT p.processo_chave) AS total FROM djen_publicacoes p WHERE p.cancelada=0 AND p.concluida=0 AND EXISTS(SELECT 1 FROM json_each(p.categorias_json) WHERE value=?)",
          )
          .get(c) as { total: number }
      ).total,
    ]),
  );
  return {
    ...categorias,
    outros: (
      db
        .prepare(
          `SELECT count(DISTINCT p.processo_chave) AS total FROM djen_publicacoes p
            WHERE p.cancelada=0 AND p.concluida=0
              AND NOT EXISTS (
                SELECT 1 FROM djen_publicacoes outra
                 WHERE outra.processo_chave=p.processo_chave AND outra.cancelada=0
                   AND outra.concluida=0 AND outra.categorias_json<>'[]'
              )`,
        )
        .get() as { total: number }
    ).total,
    total: (
      db.prepare("SELECT count(*) AS total FROM djen_publicacoes").get() as {
        total: number;
      }
    ).total,
    nao_lidas: (
      db
        .prepare("SELECT count(DISTINCT processo_chave) AS total FROM djen_publicacoes WHERE lida=0 AND concluida=0 AND cancelada=0")
        .get() as { total: number }
    ).total,
  };
}

export function listarAndamentosDoProcesso(id: number, pagina = 1) {
  const p = publicacaoPorId(id);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  if (!Number.isInteger(pagina) || pagina < 1)
    throw new DjenInputError("Página inválida.");
  const total = (
    db
      .prepare(
        "SELECT count(*) AS n FROM djen_publicacoes WHERE processo_chave=?",
      )
      .get(p.processo_chave) as { n: number }
  ).n;
  const items = db
    .prepare(
      "SELECT id,data_disponibilizacao,categorias_json,resultado,situacao,orgao,tipo_documento,ia_status,json_extract(ia_json,'$.resumo') AS resumo FROM djen_publicacoes WHERE processo_chave=? ORDER BY data_disponibilizacao DESC,id DESC LIMIT 25 OFFSET ?",
    )
    .all(p.processo_chave, (pagina - 1) * 25);
  return { items, total, pagina, por_pagina: 25 };
}

