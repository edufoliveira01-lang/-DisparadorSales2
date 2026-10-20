import { db } from "../../db";
import { getContact } from "../contactsService";
import { normalizeProcesso } from "../../utils/processo";
import {
  CATEGORIAS_DJEN,
  RESULTADOS_DJEN,
  type CategoriaDjen,
} from "./classifier";
import {
  normalizarOab,
  correspondenciaAdvogado,
  type AdvogadoDjen,
  type PublicacaoDjen,
} from "./api";

export class DjenInputError extends Error {}
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
  };
}
export function salvarConfiguracaoDjen(data: Record<string, unknown>) {
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
            "UPDATE djen_publicacoes SET ia_status='pendente',ia_json=NULL,ia_erro=NULL,ia_em=NULL WHERE id=?",
          ).run(id);
      } else {
        id = Number(
          db
            .prepare(
              `INSERT INTO djen_publicacoes(comunicacao_id,hash,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,link,destinatarios_json,advogados_json,categorias_json,evidencias_json,resultado,cancelada)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(p.comunicacao_id, ...valores).lastInsertRowid,
        );
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
const SELECT_PUB = `SELECT p.*,pr.numero AS processo,pr.cliente_id,pr.observacoes,c.nome AS cliente_nome,c.telefone AS cliente_telefone
  FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave LEFT JOIN contacts c ON c.id=pr.cliente_id`;
export interface PublicacaoRow {
  id: number;
  processo_chave: string;
  processo: string;
  texto: string;
  categorias_json: string;
  evidencias_json: string;
  resultado: string;
  revisada: number;
  lida: number;
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
  return {
    ...dados,
    analise,
    texto: integral ? texto : undefined,
    resumo: analise?.resumo || texto.slice(0, 320),
    categorias: JSON.parse(categorias_json),
    evidencias: JSON.parse(evidencias_json),
    advogados,
    destinatarios: integral
      ? JSON.parse(String(destinatarios_json))
      : undefined,
    advogados_publicacao: integral
      ? JSON.parse(String(advogados_json))
      : undefined,
    certidao_url: p.hash
      ? `https://comunicaapi.pje.jus.br/api/v1/comunicacao/${encodeURIComponent(p.hash)}/certidao`
      : null,
  };
}
export function listarPublicacoes(filtro: Record<string, string>) {
  const where: string[] = [],
    values: (string | number)[] = [];
  if (
    filtro.categoria &&
    CATEGORIAS_DJEN.includes(filtro.categoria as CategoriaDjen)
  ) {
    where.push(
      "EXISTS(SELECT 1 FROM json_each(p.categorias_json) WHERE value=?)",
    );
    values.push(filtro.categoria);
  }
  if (["outras", "outros"].includes(filtro.categoria))
    where.push("p.categorias_json='[]'");
  if (
    filtro.resultado &&
    RESULTADOS_DJEN.includes(
      filtro.resultado as (typeof RESULTADOS_DJEN)[number],
    )
  ) {
    where.push("p.resultado=?");
    values.push(filtro.resultado);
  }
  if (filtro.advogado_id && /^\d+$/.test(filtro.advogado_id)) {
    where.push(
      "EXISTS(SELECT 1 FROM djen_publicacao_advogados pa WHERE pa.publicacao_id=p.id AND pa.advogado_id=?)",
    );
    values.push(Number(filtro.advogado_id));
  }
  if (filtro.situacao === "nao_lidas") where.push("p.lida=0");
  if (filtro.situacao === "revisar") where.push("p.revisada=0");
  if (filtro.busca?.trim()) {
    where.push(
      "(p.texto LIKE ? ESCAPE '\\' OR pr.numero LIKE ? ESCAPE '\\' OR c.nome LIKE ? ESCAPE '\\')",
    );
    const text =
      "%" +
      filtro.busca
        .trim()
        .slice(0, 200)
        .replace(/[\\%_]/g, "\\$&") +
      "%";
    values.push(text, text, text);
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
  const total = (
    db
      .prepare("SELECT count(*) AS total FROM (" + SELECT_PUB + condition + ")")
      .get(...values) as { total: number }
  ).total;
  const pagina = Math.max(
    1,
    Math.min(10000, Number.parseInt(filtro.pagina || "1", 10) || 1),
  );
  const rows = db
    .prepare(
      SELECT_PUB +
        condition +
        " ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 25 OFFSET ?",
    )
    .all(...values, (pagina - 1) * 25) as PublicacaoRow[];
  return {
    items: rows.map((p) => apresentarPublicacao(p)),
    total,
    pagina,
    por_pagina: 25,
  };
}
export function detalhesPublicacao(id: number) {
  const p = publicacaoPorId(id);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  const relacionadas = db
    .prepare(
      "SELECT id,data_disponibilizacao,categorias_json,resultado,json_extract(ia_json,'$.resumo') AS resumo FROM djen_publicacoes WHERE processo_chave=? ORDER BY data_disponibilizacao DESC,id DESC LIMIT 50",
    )
    .all(p.processo_chave);
  const mensagens = db
    .prepare(
      "SELECT * FROM djen_mensagens WHERE publicacao_id=? ORDER BY id DESC LIMIT 30",
    )
    .all(id);
  return { ...apresentarPublicacao(p, true), relacionadas, mensagens };
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
  db.prepare(
    "UPDATE djen_publicacoes SET categorias_json=?,resultado=?,revisada=1,ia_status=CASE WHEN ia_status='pendente' THEN 'nao_solicitada' ELSE ia_status END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).run(
    JSON.stringify([...new Set(categorias)]),
    categorias.includes("sentenca") ? data.resultado : "nao_identificado",
    id,
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
  return detalhesPublicacao(id);
}
export function resumoDjen() {
  const categorias = Object.fromEntries(
    CATEGORIAS_DJEN.map((c) => [
      c,
      (
        db
          .prepare(
            "SELECT count(*) AS total FROM djen_publicacoes p WHERE p.cancelada=0 AND EXISTS(SELECT 1 FROM json_each(p.categorias_json) WHERE value=?)",
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
          "SELECT count(*) AS total FROM djen_publicacoes WHERE cancelada=0 AND categorias_json='[]'",
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
        .prepare("SELECT count(*) AS total FROM djen_publicacoes WHERE lida=0")
        .get() as { total: number }
    ).total,
  };
}
