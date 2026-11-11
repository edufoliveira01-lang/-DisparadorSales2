/**
 * O NEGÓCIO de cada cliente: quem fechou, se foi presencial ou online, de onde veio (fonte), se o caso foi qualificado pelo escritório e quando entrou e fechou.
 * Alimenta a tela Captação e o dashboard do Início. Uma linha por cliente; quem não tem linha é «não informado».
 *
 * Qualificação: «aguardando» (contrato assinado, ainda sem análise), «qualificado» e «não qualificado» (com motivo) são decididas por uma PESSOA da equipe;
 * «não informada» é o que os clientes antigos recebem até alguém preencher. A IA do atendimento nunca marca «qualificado».
 */
import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";
import { ErroGestao } from "./erro";

db.exec(`CREATE TABLE IF NOT EXISTS gestao_negocios (
  pessoa_id INTEGER PRIMARY KEY REFERENCES gestao_pessoas(id) ON DELETE CASCADE,
  fonte TEXT NOT NULL DEFAULT '', fonte_detalhe TEXT NOT NULL DEFAULT '',
  tipo_atendimento TEXT NOT NULL DEFAULT '' CHECK(tipo_atendimento IN ('','presencial','online')),
  fechado_por_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  qualificacao TEXT NOT NULL DEFAULT 'nao_informada' CHECK(qualificacao IN ('nao_informada','aguardando','qualificado','nao_qualificado')),
  motivo TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
  qualificado_por_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, qualificado_em TEXT,
  data_entrada TEXT NOT NULL DEFAULT '', data_fechamento TEXT NOT NULL DEFAULT '',
  observacoes TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gestao_negocios_fechamento ON gestao_negocios(data_fechamento);
CREATE INDEX IF NOT EXISTS idx_gestao_negocios_entrada ON gestao_negocios(data_entrada);`);

export interface Opcao { chave: string; rotulo: string }
export const FONTES_PADRAO: readonly Opcao[] = [
  { chave: "meta", rotulo: "Anúncio Meta (Facebook/Instagram)" }, { chave: "google", rotulo: "Google" }, { chave: "instagram", rotulo: "Instagram (orgânico)" },
  { chave: "site", rotulo: "Site / formulário" }, { chave: "indicacao_cliente", rotulo: "Indicação de cliente" }, { chave: "indicacao_parceiro", rotulo: "Indicação de parceiro" },
  { chave: "whatsapp", rotulo: "WhatsApp direto" }, { chave: "evento", rotulo: "Evento / panfleto" }, { chave: "outro", rotulo: "Outro" },
];
export const MOTIVOS: readonly Opcao[] = [
  { chave: "nao_cumpre_requisito", rotulo: "Não cumpre requisito" }, { chave: "documentos_insuficientes", rotulo: "Documentos insuficientes" },
  { chave: "prazo_vencido", rotulo: "Prazo vencido" }, { chave: "valor_baixo", rotulo: "Valor baixo" }, { chave: "cliente_desistiu", rotulo: "Cliente desistiu" }, { chave: "outro", rotulo: "Outro" },
];
export const AREAS: readonly Opcao[] = [{ chave: "previdenciario", rotulo: "Previdenciário" }, { chave: "trabalhista", rotulo: "Trabalhista" }, { chave: "outra", rotulo: "Outra" }];
export const QUALIFICACOES: readonly Opcao[] = [
  { chave: "nao_informada", rotulo: "Não informada" }, { chave: "aguardando", rotulo: "Aguardando análise" }, { chave: "qualificado", rotulo: "Qualificado" }, { chave: "nao_qualificado", rotulo: "Não qualificado" },
];
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** As fontes de captação: as padrão (fixas) mais as que o escritório acrescentou (`custom_…`). */
export function lerFontes(): Opcao[] {
  try {
    const extra = JSON.parse(getSetting("gestao_fontes_extras") || "[]") as Opcao[];
    return [...FONTES_PADRAO.filter((f) => f.chave !== "outro"), ...extra.filter((e) => /^custom_[a-z0-9_]{1,40}$/.test(e.chave) && e.rotulo), FONTES_PADRAO.find((f) => f.chave === "outro")!];
  } catch { return [...FONTES_PADRAO]; }
}
export function salvarFontesExtras(rotulos: unknown): Opcao[] {
  if (!Array.isArray(rotulos)) throw new ErroGestao("Envie a lista de fontes.", 400);
  const vistos = new Set<string>();
  const extras: Opcao[] = [];
  for (const bruto of rotulos.slice(0, 30)) {
    const rotulo = String(bruto ?? "").trim().slice(0, 40);
    if (!rotulo) continue;
    const chave = `custom_${norm(rotulo).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36) || "fonte"}`;
    if (vistos.has(chave) || FONTES_PADRAO.some((f) => norm(f.rotulo) === norm(rotulo))) continue;
    vistos.add(chave);
    extras.push({ chave, rotulo });
  }
  setSetting("gestao_fontes_extras", JSON.stringify(extras));
  return lerFontes();
}

/** Traduz o texto de fonte que o atendimento manda («meta_ads», «Instagram», «indicação»…) para uma fonte do escritório. */
export function normalizarFonte(bruto: unknown): string {
  const t = norm(String(bruto ?? ""));
  if (!t) return "";
  const extra = lerFontes().find((f) => f.chave.startsWith("custom_") && norm(f.rotulo) === t);
  if (extra) return extra.chave;
  if (/parceir/.test(t)) return "indicacao_parceiro";
  if (/indica|cliente|amigo|boca/.test(t)) return "indicacao_cliente";
  if (/instagram|insta\b/.test(t) && !/ads|anunc|meta/.test(t)) return "instagram";
  if (/meta|facebook|\bfb\b|ads|anunc|instagram/.test(t)) return /google/.test(t) ? "google" : "meta";
  if (/google|adwords|gads|youtube/.test(t)) return "google";
  if (/site|landing|formul|website|web\b|webhook/.test(t)) return "site";
  if (/whats|direto|organic|zap/.test(t)) return "whatsapp";
  if (/evento|panfleto|feira|palestra/.test(t)) return "evento";
  return "outro";
}

export interface Negocio {
  pessoa_id: number; fonte: string; fonte_detalhe: string; tipo_atendimento: "" | "presencial" | "online"; fechado_por_user_id: number | null; fechado_por: string | null;
  qualificacao: string; motivo: string; area: string; qualificado_por: string | null; qualificado_em: string | null; data_entrada: string; data_fechamento: string; observacoes: string;
}
const COLUNAS = `n.pessoa_id, n.fonte, n.fonte_detalhe, n.tipo_atendimento, n.fechado_por_user_id, COALESCE(NULLIF(f.display_name,''), f.username) AS fechado_por,
  n.qualificacao, n.motivo, n.area, COALESCE(NULLIF(q.display_name,''), q.username) AS qualificado_por, n.qualificado_em, n.data_entrada, n.data_fechamento, n.observacoes`;
const JUNCOES = "FROM gestao_negocios n LEFT JOIN users f ON f.id=n.fechado_por_user_id LEFT JOIN users q ON q.id=n.qualificado_por_user_id";

export function obterNegocio(pessoaId: number): Negocio | null {
  return (db.prepare(`SELECT ${COLUNAS} ${JUNCOES} WHERE n.pessoa_id=?`).get(pessoaId) as Negocio | undefined) ?? null;
}

const dia = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; };
const dentro = (lista: readonly Opcao[], v: unknown) => lista.some((o) => o.chave === v);

export interface EntradaDoNegocio {
  fonte?: string; fonte_detalhe?: string; tipo_atendimento?: string; fechado_por_user_id?: number | null; qualificacao?: string; motivo?: string; area?: string;
  data_entrada?: string; data_fechamento?: string; observacoes?: string;
}

/** Grava o negócio do cliente (cria ou atualiza). Só mexe no que veio. Quem decidiu a qualificação e quando fica registrado. */
export function salvarNegocio(pessoaId: number, e: EntradaDoNegocio, usuarioId: number): Negocio {
  if (!db.prepare("SELECT 1 FROM gestao_pessoas WHERE id=?").get(pessoaId)) throw new ErroGestao("Cliente não encontrado.", 404);
  const atual = obterNegocio(pessoaId);
  const fontes = lerFontes();
  const novo = {
    fonte: e.fonte !== undefined ? (e.fonte === "" || dentro(fontes, e.fonte) ? e.fonte : (() => { throw new ErroGestao("Fonte inválida.", 400); })()) : atual?.fonte ?? "",
    fonte_detalhe: e.fonte_detalhe !== undefined ? String(e.fonte_detalhe).trim().slice(0, 120) : atual?.fonte_detalhe ?? "",
    tipo_atendimento: e.tipo_atendimento !== undefined ? (["", "presencial", "online"].includes(e.tipo_atendimento) ? e.tipo_atendimento : (() => { throw new ErroGestao("Tipo de atendimento inválido.", 400); })()) : atual?.tipo_atendimento ?? "",
    fechado_por_user_id: e.fechado_por_user_id !== undefined ? e.fechado_por_user_id : atual?.fechado_por_user_id ?? null,
    qualificacao: e.qualificacao !== undefined ? (dentro(QUALIFICACOES, e.qualificacao) ? e.qualificacao : (() => { throw new ErroGestao("Qualificação inválida.", 400); })()) : atual?.qualificacao ?? "nao_informada",
    motivo: e.motivo !== undefined ? (e.motivo === "" || dentro(MOTIVOS, e.motivo) ? e.motivo : (() => { throw new ErroGestao("Motivo inválido.", 400); })()) : atual?.motivo ?? "",
    area: e.area !== undefined ? (e.area === "" || dentro(AREAS, e.area) ? e.area : (() => { throw new ErroGestao("Área inválida.", 400); })()) : atual?.area ?? "",
    data_entrada: e.data_entrada !== undefined ? dia(e.data_entrada) : atual?.data_entrada ?? "",
    data_fechamento: e.data_fechamento !== undefined ? dia(e.data_fechamento) : atual?.data_fechamento ?? "",
    observacoes: e.observacoes !== undefined ? String(e.observacoes).slice(0, 1000) : atual?.observacoes ?? "",
  };
  if (novo.fechado_por_user_id !== null && !db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(novo.fechado_por_user_id)) throw new ErroGestao("Funcionário inválido.", 400);
  if (novo.qualificacao === "nao_qualificado" && !novo.motivo) throw new ErroGestao("Informe o motivo de não ter qualificado.", 400);
  if (novo.qualificacao !== "nao_qualificado") novo.motivo = "";
  const mudouQualificacao = (atual?.qualificacao ?? "nao_informada") !== novo.qualificacao;
  const decidiu = mudouQualificacao && (novo.qualificacao === "qualificado" || novo.qualificacao === "nao_qualificado");
  db.prepare(
    `INSERT INTO gestao_negocios(pessoa_id,fonte,fonte_detalhe,tipo_atendimento,fechado_por_user_id,qualificacao,motivo,area,qualificado_por_user_id,qualificado_em,data_entrada,data_fechamento,observacoes)
     VALUES (@pessoa_id,@fonte,@fonte_detalhe,@tipo_atendimento,@fechado_por_user_id,@qualificacao,@motivo,@area,@qp,@qe,@data_entrada,@data_fechamento,@observacoes)
     ON CONFLICT(pessoa_id) DO UPDATE SET fonte=@fonte, fonte_detalhe=@fonte_detalhe, tipo_atendimento=@tipo_atendimento, fechado_por_user_id=@fechado_por_user_id, qualificacao=@qualificacao, motivo=@motivo, area=@area,
       qualificado_por_user_id=CASE WHEN @decidiu=1 THEN @qp WHEN @limpa=1 THEN NULL ELSE qualificado_por_user_id END, qualificado_em=CASE WHEN @decidiu=1 THEN @qe WHEN @limpa=1 THEN NULL ELSE qualificado_em END,
       data_entrada=@data_entrada, data_fechamento=@data_fechamento, observacoes=@observacoes, atualizado_em=CURRENT_TIMESTAMP`,
  ).run({ pessoa_id: pessoaId, ...novo, qp: decidiu ? usuarioId : null, qe: decidiu ? new Date().toISOString() : null, decidiu: decidiu ? 1 : 0, limpa: mudouQualificacao && !decidiu ? 1 : 0 });
  return obterNegocio(pessoaId)!;
}

/** O contrato foi gerado pelo atendimento: o negócio nasce «online», com a fonte e a data de entrada que o atendimento sabe, aguardando a análise. Não sobrescreve o que a equipe já preencheu. */
export function registrarContratoGerado(pessoaId: number, origem: { fonte?: unknown; entrada?: unknown }): void {
  try {
    const fonte = normalizarFonte(origem.fonte);
    const entrada = dia(origem.entrada);
    const bruta = String(origem.fonte ?? "").trim().slice(0, 120);
    const atual = db.prepare("SELECT fonte, data_entrada, tipo_atendimento, qualificacao FROM gestao_negocios WHERE pessoa_id=?").get(pessoaId) as { fonte: string; data_entrada: string; tipo_atendimento: string; qualificacao: string } | undefined;
    if (!atual) {
      db.prepare("INSERT INTO gestao_negocios(pessoa_id,fonte,fonte_detalhe,tipo_atendimento,qualificacao,data_entrada) VALUES (?,?,?,?,?,?)").run(pessoaId, fonte, fonte === "outro" ? bruta : "", "online", "aguardando", entrada);
      return;
    }
    db.prepare("UPDATE gestao_negocios SET fonte=CASE WHEN fonte='' THEN ? ELSE fonte END, data_entrada=CASE WHEN data_entrada='' THEN ? ELSE data_entrada END, tipo_atendimento=CASE WHEN tipo_atendimento='' THEN 'online' ELSE tipo_atendimento END, qualificacao=CASE WHEN qualificacao='nao_informada' THEN 'aguardando' ELSE qualificacao END, atualizado_em=CURRENT_TIMESTAMP WHERE pessoa_id=?")
      .run(fonte, entrada, pessoaId);
  } catch { /* o contrato nunca falha por causa do negócio */ }
}

/** O contrato foi assinado: grava a data de fechamento (se ainda não tem) e deixa o negócio aguardando a análise. */
export function registrarAssinatura(pessoaId: number, assinadoEm: string | Date = new Date()): void {
  try {
    const d = dia(typeof assinadoEm === "string" ? assinadoEm : assinadoEm.toISOString());
    const existe = db.prepare("SELECT 1 FROM gestao_negocios WHERE pessoa_id=?").get(pessoaId);
    if (!existe) db.prepare("INSERT INTO gestao_negocios(pessoa_id,qualificacao,data_fechamento) VALUES (?,?,?)").run(pessoaId, "aguardando", d);
    else db.prepare("UPDATE gestao_negocios SET data_fechamento=CASE WHEN data_fechamento='' THEN ? ELSE data_fechamento END, qualificacao=CASE WHEN qualificacao='nao_informada' THEN 'aguardando' ELSE qualificacao END, atualizado_em=CURRENT_TIMESTAMP WHERE pessoa_id=?").run(d, pessoaId);
  } catch { /* idem */ }
}

/** Clientes que já assinaram antes desta tela existir: ganham uma linha «não informada» para a equipe preencher. Idempotente. */
export function garantirNegociosDosAssinados(): number {
  try {
    return db.prepare(
      `INSERT INTO gestao_negocios(pessoa_id, qualificacao, data_fechamento)
       SELECT c.pessoa_id, 'nao_informada', MIN(substr(c.assinado_em,1,10)) FROM zapsign_contratos c
       WHERE c.status='assinado' AND c.pessoa_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gestao_negocios n WHERE n.pessoa_id=c.pessoa_id) GROUP BY c.pessoa_id`,
    ).run().changes;
  } catch { return 0; }
}

/** Fechados com algo por preencher (qualificação, fonte ou tipo de atendimento): a lista da tela rápida. */
export function pendentesDePreenchimento(limite = 200) {
  garantirNegociosDosAssinados();
  return db.prepare(
    `SELECT n.pessoa_id, p.nome, n.data_fechamento, n.fonte, n.tipo_atendimento, n.qualificacao, n.fechado_por_user_id
     FROM gestao_negocios n JOIN gestao_pessoas p ON p.id=n.pessoa_id
     WHERE n.data_fechamento<>'' AND (n.qualificacao='nao_informada' OR n.fonte='' OR n.tipo_atendimento='' OR n.fechado_por_user_id IS NULL)
     ORDER BY n.data_fechamento DESC LIMIT ?`,
  ).all(limite);
}
