import Handlebars from "handlebars";
import { db } from "../db";
import type { Pericia } from "./parserService";

export interface Template {
  id: number;
  nome: string;
  conteudo_1_pericia: string;
  conteudo_2_pericias: string;
  conteudo_pericia_medica?: string;
  conteudo_pericia_social?: string;
  modo_envio_2_pericias: "combinada" | "separadas";
  created_at: string;
}

const listStmt = db.prepare("SELECT * FROM templates ORDER BY id ASC");
const getStmt = db.prepare("SELECT * FROM templates WHERE id = ?");
const insertStmt = db.prepare(
  `INSERT INTO templates (nome, conteudo_1_pericia, conteudo_2_pericias, conteudo_pericia_medica, conteudo_pericia_social, modo_envio_2_pericias) VALUES (?, ?, ?, ?, ?, ?)`
);
const updateStmt = db.prepare(
  `UPDATE templates SET nome = ?, conteudo_1_pericia = ?, conteudo_2_pericias = ?, conteudo_pericia_medica = ?, conteudo_pericia_social = ?, modo_envio_2_pericias = ? WHERE id = ?`
);
const deleteStmt = db.prepare("DELETE FROM templates WHERE id = ?");

export function listTemplates(): Template[] {
  return listStmt.all() as Template[];
}

export function getTemplate(id: number): Template | undefined {
  return getStmt.get(id) as Template | undefined;
}

export function createTemplate(data: Omit<Template, "id" | "created_at">): Template {
  const info = insertStmt.run(
    data.nome,
    data.conteudo_1_pericia,
    data.conteudo_2_pericias,
    data.conteudo_pericia_medica || null,
    data.conteudo_pericia_social || null,
    data.modo_envio_2_pericias
  );
  return getTemplate(info.lastInsertRowid as number)!;
}

export function updateTemplate(id: number, data: Omit<Template, "id" | "created_at">): Template | undefined {
  updateStmt.run(
    data.nome,
    data.conteudo_1_pericia,
    data.conteudo_2_pericias,
    data.conteudo_pericia_medica || null,
    data.conteudo_pericia_social || null,
    data.modo_envio_2_pericias,
    id
  );
  return getTemplate(id);
}

export function deleteTemplate(id: number): void {
  deleteStmt.run(id);
}

function periciaToVars(p: Pericia) {
  return { TIPO_PERICIA: p.tipo, DATA: p.data, HORARIO: p.horario, LOCAL: p.local };
}

/**
 * Renderiza a(s) mensagem(ns) final(is) para um cliente.
 * - 1 perícia: sempre 1 mensagem, usando o template "conteudo_1_pericia".
 * - 2 perícias + modo "combinada": 1 mensagem só, usando "conteudo_2_pericias" com {{#each PERICIAS}}.
 * - 2 perícias + modo "separadas": 2 mensagens, cada uma usando "conteudo_1_pericia".
 */
export function renderMessages(
  template: Pick<
    Template,
    "conteudo_1_pericia" | "conteudo_2_pericias" | "conteudo_pericia_medica" | "conteudo_pericia_social" | "modo_envio_2_pericias"
  >,
  nome: string,
  pericias: Pericia[]
): string[] {
  if (pericias.length === 0) return [];

  if (pericias.length === 1) {
    const compiled = Handlebars.compile(template.conteudo_1_pericia, { noEscape: true });
    return [compiled({ NOME: nome, ...periciaToVars(pericias[0]) })];
  }

  if (template.modo_envio_2_pericias === "separadas") {
    return pericias.map((p) => {
      let content = template.conteudo_1_pericia;
      if (p.tipo.toLowerCase().includes("médica") && template.conteudo_pericia_medica) {
        content = template.conteudo_pericia_medica;
      } else if (p.tipo.toLowerCase().includes("social") && template.conteudo_pericia_social) {
        content = template.conteudo_pericia_social;
      }
      const compiled = Handlebars.compile(content, { noEscape: true });
      return compiled({ NOME: nome, ...periciaToVars(p) });
    });
  }

  const compiled = Handlebars.compile(template.conteudo_2_pericias, { noEscape: true });
  return [compiled({ NOME: nome, PERICIAS: pericias.map(periciaToVars) })];
}
