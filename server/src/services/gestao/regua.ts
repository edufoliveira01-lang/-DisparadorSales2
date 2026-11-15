/**
 * Cobrança pelo WhatsApp: envio real (conexão do WhatsApp do próprio sistema), envio em lote e a régua automática de avisos de vencimento.
 * Cada parcela recebe cada aviso uma única vez (tabela gestao_avisos_cobranca, chave lancamento+regra) — nada é enviado em duplicidade.
 */
import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";
import { hojeSaoPaulo } from "../djen/cache";
import { boletoEmPdf } from "./boleto";
import { enviarPeloDeskcomm, envioPeloDeskcommLigado, ErroDeskcomm } from "./deskcomm";
import { telefoneValidoParaLembrete } from "../lembreteUtils";
import { ErroGestao } from "./pessoas";
import { pixSemEspacos } from "./pix";
export { pixSemEspacos };
import { cobrancaDoLancamento, chaveDoAsaas, gerarCobranca, type TipoCobranca } from "./asaas";
import { registrar, type Quem } from "./financeiro";

export interface ReguaConfig {
  ativa: boolean;
  antes_dias: number[]; // avisos antes do vencimento (ex.: 3 = três dias antes)
  no_dia: boolean;
  depois_dias: number[]; // avisos após o vencimento (ex.: 1, 7)
  horario: string; // HH:MM (Brasília) a partir do qual os avisos do dia saem
  pagamento: "" | TipoCobranca; // gera e envia boleto/PIX junto do aviso ("" = só o lembrete); vale para avisos automáticos, em lote e pelos botões
  anexar_boleto: boolean; // envia o boleto em PDF junto do aviso
  salvar_boleto_dropbox: boolean; // guarda o PDF no cadastro e copia para a pasta do cliente no Dropbox
  formato: "separado" | "junto"; // PIX e linha digitável em mensagens separadas (fácil de copiar) ou tudo na mesma mensagem
  modelos: Modelos; // textos dos avisos (editáveis)
}
export interface Modelos { antes: string; hoje: string; depois: string }
/** Variáveis: {nome} (primeiro nome), {descricao}, {valor}, {vencimento}, {quando} e {link} (link de pagamento; o PIX copia e cola vai em mensagem separada). */
export const MODELOS_PADRAO: Modelos = {
  antes: "Olá, {nome}! Tudo bem? Aqui é do escritório. Passando para lembrar que a parcela \"{descricao}\", no valor de {valor}, vence {quando}.\n\n{link}\n\nSe já pagou, é só nos avisar e desconsidere esta mensagem. 🙏",
  hoje: "Olá, {nome}! Tudo bem? Aqui é do escritório. Passando para lembrar que a parcela \"{descricao}\", no valor de {valor}, vence hoje.\n\n{link}\n\nSe já pagou, é só nos avisar e desconsidere esta mensagem. 🙏",
  depois: "Olá, {nome}! Tudo bem? Aqui é do escritório. Notamos que a parcela \"{descricao}\", no valor de {valor}, com vencimento em {vencimento}, ainda consta em aberto. Podemos ajudar a regularizar?\n\n{link}\n\nSe já pagou, é só nos avisar e desconsidere esta mensagem. 🙏",
};
export const REGUA_PADRAO: ReguaConfig = { ativa: false, antes_dias: [3], no_dia: true, depois_dias: [3], horario: "09:00", pagamento: "boleto_pix", formato: "separado", anexar_boleto: true, salvar_boleto_dropbox: true, modelos: { ...MODELOS_PADRAO } };

const dias = (v: unknown): number[] => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90))].sort((a, b) => a - b).slice(0, 5);
export function lerRegua(): ReguaConfig {
  try {
    const j = JSON.parse(getSetting("cobranca_regua") || "{}") as Partial<ReguaConfig>;
    const leg = j as { gerar_cobranca?: boolean; tipo?: string };
    if (j.pagamento === undefined && leg.gerar_cobranca !== undefined) j.pagamento = leg.gerar_cobranca ? (leg.tipo === "pix" || leg.tipo === "boleto" ? leg.tipo : "boleto_pix") : "";
    return normalizarRegua({ ...REGUA_PADRAO, ...j });
  } catch { return { ...REGUA_PADRAO }; }
}
function normalizarModelos(m: Partial<Modelos> | undefined): Modelos {
  const t = (v: unknown, padrao: string) => { const x = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, 1500) : ""; return x || padrao; };
  return { antes: t(m?.antes, MODELOS_PADRAO.antes), hoje: t(m?.hoje, MODELOS_PADRAO.hoje), depois: t(m?.depois, MODELOS_PADRAO.depois) };
}
function normalizarRegua(d: Partial<ReguaConfig>): ReguaConfig {
  const horario = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(d.horario)) ? String(d.horario) : REGUA_PADRAO.horario;
  const legado = d as { gerar_cobranca?: boolean; tipo?: string };
  const pagamento = d.pagamento !== undefined ? d.pagamento : legado.gerar_cobranca === false ? "" : legado.tipo === "pix" || legado.tipo === "boleto" ? legado.tipo : "boleto_pix";
  return { ativa: Boolean(d.ativa), antes_dias: dias(d.antes_dias), no_dia: Boolean(d.no_dia), depois_dias: dias(d.depois_dias), horario, pagamento: pagamento === "pix" || pagamento === "boleto" || pagamento === "boleto_pix" ? pagamento : "", formato: d.formato === "junto" ? "junto" : "separado", anexar_boleto: d.anexar_boleto !== false, salvar_boleto_dropbox: d.salvar_boleto_dropbox !== false, modelos: normalizarModelos(d.modelos) };
}
export function salvarRegua(d: Partial<ReguaConfig>): ReguaConfig {
  const c = normalizarRegua({ ...lerRegua(), ...d });
  setSetting("cobranca_regua", JSON.stringify(c));
  return c;
}

const moeda = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const diffDias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

interface Parcela { id: number; descricao: string; valor_centavos: number; vencimento: string; pessoa_id: number; nome: string; telefone: string }
const parcelasEmAberto = (ids?: number[]): Parcela[] => {
  const filtro = ids ? `AND l.id IN (${ids.map(() => "?").join(",") || "NULL"})` : "";
  return db.prepare(`SELECT l.id, l.descricao, l.valor_centavos, l.vencimento, l.pessoa_id, pe.nome, pe.telefone FROM gestao_lancamentos l JOIN gestao_pessoas pe ON pe.id=l.pessoa_id
    WHERE l.tipo='receber' AND l.cancelado=0 AND l.pago_em IS NULL ${filtro} ORDER BY l.vencimento, l.id`).all(...(ids ?? [])) as Parcela[];
};

export function regraDe(vencimento: string, hoje: string): string {
  const d = diffDias(hoje, vencimento);
  return d > 0 ? `antes:${d}` : d === 0 ? "hoje" : `depois:${-d}`;
}

type DadosAviso = { nome: string; descricao: string; valor_centavos: number; vencimento: string };
/** Texto do modelo certo para o momento, com as variáveis preenchidas; o marcador {link} fica para ser resolvido no envio. */
export function textoDoModelo(p: DadosAviso, hoje: string, modelos: Modelos = lerRegua().modelos): string {
  const d = diffDias(hoje, p.vencimento);
  const modelo = d > 0 ? modelos.antes : d === 0 ? modelos.hoje : modelos.depois;
  const quando = d === 1 ? "amanhã" : `em ${dataBr(p.vencimento)}`;
  const primeiro = p.nome.trim().split(/\s+/)[0] || "";
  return modelo.replace(/\{nome\}/g, primeiro).replace(/\{descricao\}/g, p.descricao).replace(/\{valor\}/g, moeda(p.valor_centavos)).replace(/\{vencimento\}/g, dataBr(p.vencimento)).replace(/\{quando\}/g, quando)
    .replace(/,\s*([!?.])/g, "$1").replace(/Olá,?\s+!/g, "Olá!");
}
/** Resolve {link}: com cobrança vira o link de pagamento; sem ela o marcador some. O PIX e a linha digitável vão em mensagens separadas (código sozinho, fácil de copiar). */
export function aplicarLink(texto: string, link?: { url?: string; pix?: string; linha?: string } | null, formato: "separado" | "junto" = "separado", comPdf = false): { texto: string; partes: string[] } {
  const partes: string[] = [];
  let bloco = "";
  if (link?.url) {
    bloco = `Para pagar por boleto ou PIX, use este link: ${link.url}`;
    const pix = link.pix ? pixSemEspacos(link.pix) : "";
    if (comPdf) bloco += "\n\nSegue também o boleto em PDF.";
    if (formato === "junto") {
      if (pix) bloco += `\n\nPIX copia e cola:\n${pix}`;
      if (link.linha) bloco += `\n\nLinha digitável do boleto:\n${link.linha}`;
    } else {
      const seguem = [pix ? "o código PIX copia e cola" : "", link.linha ? "a linha digitável do boleto" : ""].filter(Boolean).join(" e ");
      if (seguem) bloco += `\n\nEm seguida, envio ${seguem}.`;
      if (pix) partes.push(pix);
      if (link.linha) partes.push(link.linha);
    }
  }
  const t = texto.replace(/\{link\}/g, bloco).replace(/\n{3,}/g, "\n\n").trim();
  return { texto: t, partes };
}
/** O aviso pronto (texto principal + mensagens seguintes), sem juros ou ameaças. */
export function mensagemDoAviso(p: DadosAviso, hoje: string, link?: { url?: string; pix?: string; linha?: string } | null): string {
  return aplicarLink(textoDoModelo(p, hoje), link).texto;
}

const SEM_CANAL = "O envio pelo Deskcomm ainda não foi ligado. Cadastre o token em Configurações → Atendimento (envio de mensagens).";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
function intervalo(): number {
  const num = (k: string, d: number) => { const v = getSetting(k); const n = v === "" || v == null ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
  const min = num("send_interval_min", 5);
  const max = Math.max(min, num("send_interval_max", 15));
  return (min + Math.random() * (max - min)) * 1000;
}
export const pessoaPausada = (pessoaId: number) => Boolean(db.prepare("SELECT 1 FROM gestao_cobranca_pausa WHERE pessoa_id=?").get(pessoaId));
export function pausarAvisos(pessoaId: number, pausar: boolean) {
  if (pausar) db.prepare("INSERT OR IGNORE INTO gestao_cobranca_pausa(pessoa_id) VALUES (?)").run(pessoaId);
  else db.prepare("DELETE FROM gestao_cobranca_pausa WHERE pessoa_id=?").run(pessoaId);
}

export interface ResultadoEnvio { lancamento_id: number; status: "enviado" | "falhou" | "ignorado"; motivo?: string }

/** Envia o aviso de UMA parcela pelo Deskcomm e registra. `regra` define a chave de não-duplicidade ("manual" pode repetir). */
export async function enviarAviso(lancamentoId: number, opts: { regra?: string; origem: "manual" | "lote" | "automatico"; gerar?: TipoCobranca | false; quem?: Quem; http?: typeof fetch} ): Promise<ResultadoEnvio> {
  const hoje = hojeSaoPaulo();
  const [p] = parcelasEmAberto([lancamentoId]);
  if (!p) return { lancamento_id: lancamentoId, status: "ignorado", motivo: "Parcela não está em aberto." };
  const regra = opts.regra ?? `manual:${Date.now()}`;
  const registro = (status: string, mensagem: string, erro: string | null) => {
    db.prepare(`INSERT INTO gestao_avisos_cobranca(lancamento_id,regra,origem,status,tentativas,erro,mensagem,telefone) VALUES (?,?,?,?,1,?,?,?)
      ON CONFLICT(lancamento_id,regra) DO UPDATE SET status=excluded.status, tentativas=tentativas+1, erro=excluded.erro, mensagem=excluded.mensagem, telefone=excluded.telefone, atualizado_em=CURRENT_TIMESTAMP`)
      .run(lancamentoId, regra, opts.origem, status, erro, mensagem, p.telefone);
  };
  if (!telefoneValidoParaLembrete(p.telefone)) { registro("falhou", "", "Cliente sem telefone válido."); return { lancamento_id: lancamentoId, status: "falhou", motivo: "Cliente sem telefone válido." }; }
  const cfg = lerRegua();
  const gerar = opts.gerar === undefined ? cfg.pagamento || false : opts.gerar;
  let link = cobrancaDoLancamento(lancamentoId);
  if (link && ["DELETED", "CANCELADA", "REFUNDED"].includes(link.status)) link = null;
  if (!link && gerar && chaveDoAsaas() && p.vencimento >= hoje) {
    try { link = await gerarCobranca(lancamentoId, gerar, opts.quem, opts.http); } catch { link = null; /* segue só com o lembrete, sem link */ }
  }
  let pdf: Awaited<ReturnType<typeof boletoEmPdf>> = null;
  if (link && (cfg.anexar_boleto || cfg.salvar_boleto_dropbox)) { try { pdf = await boletoEmPdf(lancamentoId, { quem: opts.quem, http: opts.http, copiarParaDrive: cfg.salvar_boleto_dropbox }); } catch { pdf = null; } }
  const anexar = Boolean(pdf && cfg.anexar_boleto);
  const { texto, partes } = aplicarLink(textoDoModelo(p, hoje), link ? { url: link.invoice_url || link.bank_slip_url, pix: link.pix_payload, linha: link.linha_digitavel } : null, cfg.formato, anexar);
  try {
    if (!envioPeloDeskcommLigado()) throw new ErroDeskcomm(SEM_CANAL, 409);
    await enviarPeloDeskcomm(p.telefone, p.nome, texto, opts.http, partes, anexar && pdf ? [{ nome: pdf.nome, conteudo: pdf.conteudo, mime: "application/pdf" }] : [], "cobranca");
    registro("enviado", texto, null);
    registrar(lancamentoId, "aviso_cobranca", `Aviso de cobrança enviado pelo WhatsApp (${opts.origem === "automatico" ? "automático" : opts.origem === "lote" ? "em lote" : "manual"}).`, opts.quem);
    return { lancamento_id: lancamentoId, status: "enviado" };
  } catch (e) {
    const m = (e as Error).message || "Falha no envio.";
    registro("falhou", texto, m);
    return { lancamento_id: lancamentoId, status: "falhou", motivo: m };
  }
}

let emLote = false;
/** Envio em lote com intervalo entre as mensagens (o mesmo ritmo dos demais envios do sistema). */
export async function enviarEmLote(ids: number[], opts: { gerar?: TipoCobranca | false; quem?: Quem; http?: typeof fetch; semPausa?: boolean }): Promise<{ resultados: ResultadoEnvio[]; enviados: number; falhas: number; ignorados: number }> {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n)))].slice(0, 200);
  if (!unicos.length) throw new ErroGestao("Selecione ao menos uma parcela.", 400);
  if (emLote) throw new ErroGestao("Já existe um envio em andamento. Aguarde terminar.", 409);
  if (!envioPeloDeskcommLigado()) throw new ErroGestao(SEM_CANAL, 409);
  emLote = true;
  const resultados: ResultadoEnvio[] = [];
  try {
    for (let i = 0; i < unicos.length; i++) {
      const id = unicos[i]!;
      const [p] = parcelasEmAberto([id]);
      if (p && pessoaPausada(p.pessoa_id)) { resultados.push({ lancamento_id: id, status: "ignorado", motivo: "Avisos pausados para este cliente." }); continue; }
      const r = await enviarAviso(id, { origem: "lote", gerar: opts.gerar, quem: opts.quem, http: opts.http });
      resultados.push(r);
      if (r.status === "enviado" && i < unicos.length - 1 && !opts.semPausa) await dormir(intervalo());
    }
  } finally { emLote = false; }
  return { resultados, enviados: resultados.filter((r) => r.status === "enviado").length, falhas: resultados.filter((r) => r.status === "falhou").length, ignorados: resultados.filter((r) => r.status === "ignorado").length };
}

export interface ItemDaRegua { lancamento_id: number; pessoa_id: number; nome: string; descricao: string; valor_centavos: number; vencimento: string; regra: string; telefone_ok: boolean }
/** O que a régua enviaria hoje (já sem o que foi enviado antes e sem clientes pausados). */
export function pendentesDaRegua(c: ReguaConfig = lerRegua(), hoje = hojeSaoPaulo()): ItemDaRegua[] {
  const jaEnviou = db.prepare("SELECT status FROM gestao_avisos_cobranca WHERE lancamento_id=? AND regra=?");
  const out: ItemDaRegua[] = [];
  for (const p of parcelasEmAberto()) {
    const regra = regraDe(p.vencimento, hoje);
    const [tipo, n] = regra.split(":");
    const vale = tipo === "hoje" ? c.no_dia : tipo === "antes" ? c.antes_dias.includes(Number(n)) : c.depois_dias.includes(Number(n));
    if (!vale || pessoaPausada(p.pessoa_id)) continue;
    const anterior = jaEnviou.get(p.id, regra) as { status: string } | undefined;
    if (anterior?.status === "enviado") continue;
    out.push({ lancamento_id: p.id, pessoa_id: p.pessoa_id, nome: p.nome, descricao: p.descricao, valor_centavos: p.valor_centavos, vencimento: p.vencimento, regra, telefone_ok: telefoneValidoParaLembrete(p.telefone) });
  }
  return out;
}

let rodando = false;
/** Chamada periódica: no horário configurado envia os avisos do dia. Seguro para rodar várias vezes (não duplica). */
export async function executarRegua(agora = new Date(), http?: typeof fetch): Promise<{ enviados: number; falhas: number } | null> {
  const c = lerRegua();
  if (!c.ativa || rodando || emLote) return null;
  const hh = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(agora);
  if (hh < c.horario) return null;
  if (!envioPeloDeskcommLigado()) return null;
  rodando = true;
  try {
    let enviados = 0, falhas = 0;
    const hoje = hojeSaoPaulo();
    const itens = pendentesDaRegua(c, hoje).filter((i) => i.telefone_ok);
    // Falhas só são tentadas de novo até 3 vezes no dia, para não insistir em número inválido.
    const tentativas = db.prepare("SELECT tentativas FROM gestao_avisos_cobranca WHERE lancamento_id=? AND regra=?");
    for (const it of itens) {
      const t = (tentativas.get(it.lancamento_id, it.regra) as { tentativas: number } | undefined)?.tentativas ?? 0;
      if (t >= 3) continue;
      const r = await enviarAviso(it.lancamento_id, { regra: it.regra, origem: "automatico", http });
      if (r.status === "enviado") { enviados++; await dormir(intervalo()); } else falhas++;
    }
    return { enviados, falhas };
  } finally { rodando = false; }
}

export function historicoDeAvisos(limite = 100) {
  return db.prepare(`SELECT a.id, a.lancamento_id, a.regra, a.origem, a.status, a.erro, a.criado_em, a.atualizado_em, pe.nome AS pessoa_nome, l.descricao, l.valor_centavos
    FROM gestao_avisos_cobranca a JOIN gestao_lancamentos l ON l.id=a.lancamento_id LEFT JOIN gestao_pessoas pe ON pe.id=l.pessoa_id ORDER BY a.atualizado_em DESC, a.id DESC LIMIT ?`).all(Math.min(Math.max(limite, 1), 300));
}
export function avisosDaParcela(lancamentoId: number) {
  return db.prepare("SELECT id, regra, origem, status, erro, atualizado_em FROM gestao_avisos_cobranca WHERE lancamento_id=? ORDER BY atualizado_em DESC LIMIT 20").all(lancamentoId);
}
