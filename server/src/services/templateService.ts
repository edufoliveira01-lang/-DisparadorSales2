import Handlebars from "handlebars";
import { db } from "../db";
import type { Pericia } from "./parserService";

export const COBRANCA_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Só confirmando: você recebeu nossa mensagem anterior? Ainda estamos aguardando seu retorno 🙂";

export const COBRANCA_AUDIENCIA_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Só confirmando: você recebeu nosso aviso sobre a audiência do dia {{DATA}} às {{HORARIO}}? Ainda estamos aguardando seu retorno 🙂";

export const AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Passando para confirmar sua audiência presencial:\n\n📅 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n\nPor favor, compareça com 15 minutos de antecedência e leve seus documentos pessoais. Qualquer dúvida, estou à disposição!";

export const AUDIENCIA_ONLINE_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Passando para confirmar sua audiência online (videoconferência):\n\n📅 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n🔗 Link de acesso: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n\nEntre no link com alguns minutos de antecedência e certifique-se de estar em um local silencioso e com boa conexão de internet. Qualquer dúvida, estou à disposição!";

export const AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Passando para confirmar sua audiência híbrida (presencial ou por videoconferência):\n\n📅 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local/Link: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n\nMe avise com antecedência qual forma de participação você prefere. Qualquer dúvida, estou à disposição!";

export interface Template {
  id: number;
  nome: string;
  conteudo_1_pericia: string;
  conteudo_2_pericias: string;
  conteudo_pericia_medica: string | null;
  conteudo_pericia_social: string | null;
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
    data.conteudo_pericia_medica,
    data.conteudo_pericia_social,
    data.modo_envio_2_pericias
  );
  return getTemplate(info.lastInsertRowid as number)!;
}

export function updateTemplate(id: number, data: Omit<Template, "id" | "created_at">): Template | undefined {
  updateStmt.run(
    data.nome,
    data.conteudo_1_pericia,
    data.conteudo_2_pericias,
    data.conteudo_pericia_medica,
    data.conteudo_pericia_social,
    data.modo_envio_2_pericias,
    id
  );
  return getTemplate(id);
}

export function deleteTemplate(id: number): void {
  deleteStmt.run(id);
}

function periciaToVars(p: Pericia) {
  return { TIPO_PERICIA: p.tipo, DATA: p.data, HORARIO: p.horario, LOCAL: p.local, PROCESSO: p.processo || "" };
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
      if (p.origem === "medica" && template.conteudo_pericia_medica) {
        content = template.conteudo_pericia_medica;
      } else if (p.origem === "social" && template.conteudo_pericia_social) {
        content = template.conteudo_pericia_social;
      }
      const compiled = Handlebars.compile(content, { noEscape: true });
      return compiled({ NOME: nome, ...periciaToVars(p) });
    });
  }

  const compiled = Handlebars.compile(template.conteudo_2_pericias, { noEscape: true });
  return [compiled({ NOME: nome, PERICIAS: pericias.map(periciaToVars) })];
}

/**
 * Renderiza a mensagem de cobrança (usada no botão "Cobrar resposta" de Pendentes de Resposta).
 * Diferente dos templates de perícia, é um texto único e opcional — quando não há dados de
 * perícia disponíveis para o card (ex: log antigo sem pericias_json), as variáveis de perícia
 * ficam em branco em vez de quebrar a renderização.
 */
export function renderCobranca(mensagem: string, nome: string, pericia: Pericia | null): string {
  const compiled = Handlebars.compile(mensagem, { noEscape: true });
  return compiled({
    NOME: nome,
    ...(pericia ? periciaToVars(pericia) : { TIPO_PERICIA: "", DATA: "", HORARIO: "", LOCAL: "", PROCESSO: "" }),
  });
}

/** Renderiza a mensagem de audiência (presencial, online ou híbrida), incluindo o número do processo. */
export function renderAudiencia(mensagem: string, nome: string, pericia: Pericia): string {
  const compiled = Handlebars.compile(mensagem, { noEscape: true });
  return compiled({ NOME: nome, ...periciaToVars(pericia) });
}
