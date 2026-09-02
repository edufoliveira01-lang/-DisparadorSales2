import { db } from "../db";
export { renderAudiencia, renderCobranca, renderMessages } from "./templateRenderer";

export const COBRANCA_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Só confirmando: você recebeu nossa mensagem anterior? Ainda estamos aguardando seu retorno 🙂";

export const COBRANCA_AUDIENCIA_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Só confirmando: você recebeu nosso aviso sobre a audiência do dia {{DATA}} às {{HORARIO}}? Ainda estamos aguardando seu retorno 🙂";

export const AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Passando para confirmar sua audiência presencial:\n\n📅 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\nPor favor, compareça com 15 minutos de antecedência e leve seus documentos pessoais. Qualquer dúvida, estou à disposição!";

export const AUDIENCIA_ONLINE_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Passando para confirmar sua audiência online (videoconferência):\n\n📅 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n🔗 Link de acesso: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\nEntre no link com alguns minutos de antecedência e certifique-se de estar em um local silencioso e com boa conexão de internet. Qualquer dúvida, estou à disposição!";

export const AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO =
  "Olá {{NOME}}! Passando para confirmar sua audiência híbrida (presencial ou por videoconferência):\n\n📅 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local/Link: {{LOCAL}}\n⚖️ Processo: {{PROCESSO}}\n👤 Profissional/Perito: {{PROFISSIONAL_PERITO}}\n\nMe avise com antecedência qual forma de participação você prefere. Qualquer dúvida, estou à disposição!";

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
