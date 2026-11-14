/**
 * Asaas: boleto e PIX para as parcelas a receber, baixa automática pelo aviso de pagamento (webhook) e o controle das taxas.
 *
 * O escritório cola a chave de API em Configurações → Asaas (começar pelo ambiente de testes). O cliente recebe o link pelo WhatsApp (atendimento);
 * as notificações do próprio Asaas ficam desligadas por padrão (cada uma delas é cobrada como taxa).
 */
import crypto from "node:crypto";
import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";
import { baixarLancamento, obterLancamento, registrar, type Quem } from "./financeiro";
import { hojeSaoPaulo } from "../djen/cache";
import { documentoValido } from "./validacao";

const BASES = { sandbox: "https://api-sandbox.asaas.com/v3", producao: "https://api.asaas.com/v3" } as const;
export type Ambiente = keyof typeof BASES;
export type TipoCobranca = "boleto_pix" | "pix" | "boleto";
const TIPO_ASAAS: Record<TipoCobranca, string> = { boleto_pix: "UNDEFINED", pix: "PIX", boleto: "BOLETO" };



export class ErroAsaas extends Error { constructor(m: string, public status = 502) { super(m); } }

export const chaveDoAsaas = () => (getSetting("asaas_api_key") || "").trim();
export const ambienteDoAsaas = (): Ambiente => (getSetting("asaas_ambiente") === "producao" ? "producao" : "sandbox");
export function tokenDoWebhook(): string {
  let t = (getSetting("asaas_webhook_token") || "").trim();
  if (!t) { t = crypto.randomBytes(24).toString("hex"); setSetting("asaas_webhook_token", t); }
  return t;
}
export function salvarConfigAsaas(d: { chave?: unknown; ambiente?: unknown }) {
  if (d.ambiente !== undefined) { if (d.ambiente !== "sandbox" && d.ambiente !== "producao") throw new ErroAsaas("Ambiente inválido.", 400); setSetting("asaas_ambiente", String(d.ambiente)); }
  if (d.chave !== undefined) {
    const v = String(d.chave ?? "").trim().replace(/^access_token\s*:\s*/i, "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    if (v && !/^[\w$.\-]{20,300}$/.test(v)) throw new ErroAsaas("A chave parece inválida. Cole só o texto da chave de API (começa com $aact_), sem aspas.", 400);
    setSetting("asaas_api_key", v);
  }
}
export const mascara = (c: string) => (c ? `…${c.slice(-4)}` : "");

type Http = typeof fetch;
/** A causa REAL de uma falha de rede, em frase curta (tempo esgotado, nome do erro do sistema, ou a mensagem): "rede ou demora" não diz o que consertar. */
export function descreverFalhaDeRede(e: unknown, limiteMs?: number): string {
  const nome = (e as { name?: string } | null)?.name;
  if (nome === "TimeoutError" || nome === "AbortError") return `sem resposta em ${Math.round((limiteMs ?? 0) / 1000)} s`;
  const causa = (e as { cause?: { code?: string; message?: string } } | null)?.cause;
  return String(causa?.code ?? causa?.message ?? (e instanceof Error ? e.message : "erro de rede")).slice(0, 120);
}

async function chamar<T>(metodo: "GET" | "POST" | "PUT" | "DELETE", caminho: string, corpo?: unknown, http: Http = fetch, limiteMs = 25_000): Promise<T> {
  const chave = chaveDoAsaas();
  if (!chave) throw new ErroAsaas("O Asaas ainda não foi configurado. Cole a chave de API em Configurações → Asaas.", 409);
  let r: Response;
  try {
    r = await http(`${BASES[ambienteDoAsaas()]}${caminho}`, {
      method: metodo, headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "DisparaZap" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(limiteMs),
    });
  } catch (e) { throw new ErroAsaas(`Não foi possível acessar o Asaas (${descreverFalhaDeRede(e, limiteMs)}).`); }
  const texto = await r.text();
  let json: unknown = {};
  try { json = texto ? JSON.parse(texto) : {}; } catch { /* corpo não-JSON */ }
  if (!r.ok) {
    const erros = (json as { errors?: { description?: string }[] }).errors;
    if (r.status === 401) throw new ErroAsaas("O Asaas recusou a chave. Confira se ela é do mesmo ambiente (testes ou produção) selecionado.", 401);
    throw new ErroAsaas(erros?.[0]?.description || `O Asaas respondeu HTTP ${r.status}.`, r.status >= 500 ? 502 : 422);
  }
  return json as T;
}

const reais = (c: number) => Math.round(c) / 100;
const centavos = (v: unknown) => Math.round(Number(v) * 100) || 0;
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Testa a chave: devolve o saldo da conta. */
export async function testarAsaas(http: Http = fetch) {
  const r = await chamar<{ balance?: number }>("GET", "/finance/balance", undefined, http);
  return { ok: true, saldo_centavos: centavos(r.balance), ambiente: ambienteDoAsaas() };
}

export async function garantirCliente(pessoaId: number, http: Http = fetch): Promise<string> {
  const ja = db.prepare("SELECT customer_id FROM gestao_asaas_clientes WHERE pessoa_id=?").get(pessoaId) as { customer_id: string } | undefined;
  if (ja) return ja.customer_id;
  const p = db.prepare("SELECT nome,documento,email,telefone FROM gestao_pessoas WHERE id=?").get(pessoaId) as { nome: string; documento: string; email: string; telefone: string } | undefined;
  if (!p) throw new ErroAsaas("Cliente não encontrado.", 404);
  const doc = digitos(p.documento);
  if (![11, 14].includes(doc.length) || !documentoValido(doc)) throw new ErroAsaas(`Cadastre o CPF ou CNPJ de ${p.nome} (o Asaas exige para emitir a cobrança).`, 422);
  const achado = await chamar<{ data?: { id: string }[] }>("GET", `/customers?cpfCnpj=${doc}&limit=1`, undefined, http);
  let id = achado.data?.[0]?.id;
  if (!id) {
    const tel = digitos(p.telefone).replace(/^55(?=\d{10,11}$)/, "");
    const novo = await chamar<{ id: string }>("POST", "/customers", { name: p.nome, cpfCnpj: doc, email: p.email || undefined, mobilePhone: tel.length >= 10 ? tel : undefined, externalReference: `pessoa_${pessoaId}`, notificationDisabled: true }, http);
    id = novo.id;
  }
  db.prepare("INSERT OR REPLACE INTO gestao_asaas_clientes(pessoa_id,customer_id) VALUES (?,?)").run(pessoaId, id);
  return id;
}

interface Pagamento { id: string; status?: string; value?: number; netValue?: number; dueDate?: string; billingType?: string; invoiceUrl?: string; bankSlipUrl?: string; paymentDate?: string; confirmedDate?: string; clientPaymentDate?: string; externalReference?: string; deleted?: boolean }
export interface Cobranca { lancamento_id: number; payment_id: string; billing_type: string; status: string; invoice_url: string; bank_slip_url: string; linha_digitavel: string; pix_payload: string; valor_centavos: number; vencimento: string; taxa_centavos: number | null; taxa_prevista_centavos?: number | null; liquido_centavos: number | null; pago_em: string | null; forma_paga: string; erro: string | null; criado_em: string }
export const cobrancaDoLancamento = (id: number) => (db.prepare("SELECT * FROM gestao_asaas_cobrancas WHERE lancamento_id=?").get(id) as Cobranca | undefined) ?? null;
const ENCERRADAS = ["DELETED", "CANCELADA", "REFUNDED", "RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];

/** O PIX e a linha digitável, consultados JUNTOS (em paralelo). `limiteMs` curto quando há alguém esperando a resposta (atendimento). `motivos` recebe, em frase, por que algum não veio. */
async function detalhes(paymentId: string, tipo: string, http: Http, limiteMs = 25_000, motivos?: { pix?: string; linha?: string }) {
  const frase = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);
  const [pix, linha] = await Promise.all([
    tipo !== "BOLETO" ? chamar<{ payload?: string }>("GET", `/payments/${paymentId}/pixQrCode`, undefined, http, limiteMs).then((r) => r.payload ?? "").catch((e) => { if (motivos) motivos.pix = frase(e); return ""; }) : Promise.resolve(""), // ainda sem QR
    tipo !== "PIX" ? chamar<{ identificationField?: string }>("GET", `/payments/${paymentId}/identificationField`, undefined, http, limiteMs).then((r) => r.identificationField ?? "").catch((e) => { if (motivos) motivos.linha = frase(e); return ""; }) : Promise.resolve(""), // boleto ainda não registrado
  ]);
  return { pix, linha };
}

/**
 * Completa o que ficou faltando na cobrança já criada: o PIX copia e cola e a linha digitável nem sempre estão prontos no instante da criação
 * (e o endereço do boleto, em cobrança «boleto ou PIX»). Consulta de novo ao Asaas e grava o que veio. Nunca apaga o que já existe.
 */
export async function completarDetalhesDaCobranca(lancamentoId: number, http: Http = fetch, limiteMs = 8_000, motivos?: { pix?: string; linha?: string }): Promise<Cobranca | null> {
  const c = cobrancaDoLancamento(lancamentoId);
  if (!c) return null;
  const tipo = c.billing_type === "BOLETO" || c.billing_type === "PIX" ? c.billing_type : "UNDEFINED";
  if (!c.pix_payload || !c.linha_digitavel) {
    const d = await detalhes(c.payment_id, tipo, http, limiteMs, motivos);
    if ((d.pix && !c.pix_payload) || (d.linha && !c.linha_digitavel))
      db.prepare("UPDATE gestao_asaas_cobrancas SET pix_payload=?, linha_digitavel=?, atualizado_em=CURRENT_TIMESTAMP WHERE lancamento_id=?").run(c.pix_payload || d.pix, c.linha_digitavel || d.linha, lancamentoId);
  }
  if (!c.bank_slip_url) {
    try {
      const p = await chamar<{ bankSlipUrl?: string; invoiceUrl?: string }>("GET", `/payments/${c.payment_id}`, undefined, http, limiteMs);
      if (p.bankSlipUrl || (!c.invoice_url && p.invoiceUrl)) db.prepare("UPDATE gestao_asaas_cobrancas SET bank_slip_url=COALESCE(NULLIF(?,''),bank_slip_url), invoice_url=COALESCE(NULLIF(?,''),invoice_url) WHERE lancamento_id=?").run(p.bankSlipUrl ?? "", p.invoiceUrl ?? "", lancamentoId);
    } catch { /* o link e o PDF derivado bastam */ }
  }
  return cobrancaDoLancamento(lancamentoId);
}

/** Gera boleto/PIX para uma parcela a receber em aberto (se já houver cobrança ativa, devolve a mesma). */
export async function gerarCobranca(lancamentoId: number, tipo: TipoCobranca = "boleto_pix", quem?: Quem, http: Http = fetch, limiteDosDetalhesMs = 25_000): Promise<Cobranca> {
  const l = obterLancamento(lancamentoId);
  if (l.tipo !== "receber") throw new ErroAsaas("Só parcelas a receber geram cobrança.", 422);
  if (l.cancelado || l.pago_em) throw new ErroAsaas("A parcela precisa estar em aberto.", 409);
  if (!l.pessoa_id) throw new ErroAsaas("Vincule um cliente à parcela para gerar a cobrança.", 422);
  const atual = cobrancaDoLancamento(lancamentoId);
  if (atual && !ENCERRADAS.includes(atual.status)) return atual;
  const hoje = hojeSaoPaulo();
  if (l.vencimento < hoje) throw new ErroAsaas("O vencimento já passou. Use «Nova data» para escolher uma data futura antes de gerar a cobrança.", 422);
  const cliente = await garantirCliente(l.pessoa_id, http);
  const tipoAsaas = TIPO_ASAAS[tipo] ?? "UNDEFINED";
  const p = await chamar<Pagamento>("POST", "/payments", { customer: cliente, billingType: tipoAsaas, value: reais(l.valor_centavos), dueDate: l.vencimento, description: String(l.descricao).slice(0, 500), externalReference: `lanc_${lancamentoId}` }, http);
  const d = await detalhes(p.id, tipoAsaas, http, limiteDosDetalhesMs);
  db.prepare(`INSERT OR REPLACE INTO gestao_asaas_cobrancas(lancamento_id,payment_id,billing_type,status,invoice_url,bank_slip_url,linha_digitavel,pix_payload,valor_centavos,vencimento,criado_em,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(lancamentoId, p.id, p.billingType || tipoAsaas, p.status || "PENDING", p.invoiceUrl ?? "", p.bankSlipUrl ?? "", d.linha, d.pix, l.valor_centavos, l.vencimento);
  if (p.value !== undefined && p.netValue !== undefined) db.prepare("UPDATE gestao_asaas_cobrancas SET taxa_prevista_centavos=? WHERE lancamento_id=?").run(Math.max(0, centavos(p.value) - centavos(p.netValue)), lancamentoId);
  agendarSincronizacaoAsaas();
  registrar(lancamentoId, "cobranca_gerada", `Cobrança gerada no Asaas (${tipo === "pix" ? "PIX" : tipo === "boleto" ? "boleto" : "boleto e PIX"}), vencimento ${l.vencimento.split("-").reverse().join("/")}.`, quem);
  return cobrancaDoLancamento(lancamentoId)!;
}

/** Aplica o estado do pagamento do Asaas à parcela: dá baixa quando foi pago e guarda a taxa cobrada. Idempotente. */
export function aplicarPagamento(lancamentoId: number, p: Pagamento, quem?: Quem): void {
  const c = cobrancaDoLancamento(lancamentoId);
  if (!c) return;
  const status = p.deleted ? "DELETED" : String(p.status || c.status);
  const pago = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(status);
  const forma = p.billingType === "PIX" ? "PIX" : p.billingType === "BOLETO" ? "Boleto" : p.billingType === "CREDIT_CARD" ? "Cartão" : c.forma_paga;
  const taxa = pago && p.value !== undefined && p.netValue !== undefined ? Math.max(0, centavos(p.value) - centavos(p.netValue)) : c.taxa_centavos;
  // A tarifa que o Asaas já informa na própria cobrança (valor − líquido): vale como previsão até o pagamento, quando passa a ser a tarifa efetiva.
  const prevista = p.value !== undefined && p.netValue !== undefined ? Math.max(0, centavos(p.value) - centavos(p.netValue)) : null;
  const liquido = pago && p.netValue !== undefined ? centavos(p.netValue) : c.liquido_centavos;
  const em = String(p.paymentDate || p.confirmedDate || p.clientPaymentDate || "").slice(0, 10) || (pago ? hojeSaoPaulo() : c.pago_em);
  db.prepare("UPDATE gestao_asaas_cobrancas SET status=?,billing_type=COALESCE(NULLIF(?,''),billing_type),invoice_url=COALESCE(NULLIF(?,''),invoice_url),bank_slip_url=COALESCE(NULLIF(?,''),bank_slip_url),taxa_centavos=?,taxa_prevista_centavos=COALESCE(?,taxa_prevista_centavos),liquido_centavos=?,pago_em=?,forma_paga=?,erro=NULL,atualizado_em=CURRENT_TIMESTAMP WHERE lancamento_id=?")
    .run(status, p.billingType ?? "", p.invoiceUrl ?? "", p.bankSlipUrl ?? "", taxa ?? null, prevista, liquido ?? null, em ?? null, forma, lancamentoId);
  if (!pago) return;
  const l = obterLancamento(lancamentoId);
  if (l.cancelado || l.pago_em) return;
  const hoje = hojeSaoPaulo();
  baixarLancamento(lancamentoId, { pago_em: em && em <= hoje ? em : hoje, valor_pago: p.value ?? reais(l.valor_centavos), forma_pagamento: forma || "Asaas" }, quem ?? { id: null, nome: "Asaas" });
  registrar(lancamentoId, "pago_asaas", `Pagamento confirmado pelo Asaas${taxa ? ` (taxa ${(taxa / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})` : ""}.`, quem ?? { id: null, nome: "Asaas" });
}

/** Pergunta ao Asaas como está a cobrança e atualiza a parcela. */
export async function consultarCobranca(lancamentoId: number, http: Http = fetch): Promise<Cobranca> {
  const c = cobrancaDoLancamento(lancamentoId);
  if (!c) throw new ErroAsaas("Esta parcela não tem cobrança no Asaas.", 404);
  const p = await chamar<Pagamento>("GET", `/payments/${c.payment_id}`, undefined, http);
  aplicarPagamento(lancamentoId, p);
  if (!ENCERRADAS.includes(String(p.status))) {
    const d = await detalhes(c.payment_id, c.billing_type, http);
    db.prepare("UPDATE gestao_asaas_cobrancas SET pix_payload=COALESCE(NULLIF(?,''),pix_payload),linha_digitavel=COALESCE(NULLIF(?,''),linha_digitavel) WHERE lancamento_id=?").run(d.pix, d.linha, lancamentoId);
  }
  return cobrancaDoLancamento(lancamentoId)!;
}

export async function cancelarCobranca(lancamentoId: number, quem?: Quem, http: Http = fetch): Promise<void> {
  const c = cobrancaDoLancamento(lancamentoId);
  if (!c || ENCERRADAS.includes(c.status)) return;
  await chamar("DELETE", `/payments/${c.payment_id}`, undefined, http);
  db.prepare("UPDATE gestao_asaas_cobrancas SET status='CANCELADA',atualizado_em=CURRENT_TIMESTAMP WHERE lancamento_id=?").run(lancamentoId);
  registrar(lancamentoId, "cobranca_cancelada", "Cobrança cancelada no Asaas.", quem);
}

/** Depois que alguém muda a data/valor de uma parcela com cobrança aberta (ou a cancela), o Asaas acompanha. Melhor esforço. */
export async function sincronizarCobrancasAlteradas(http: Http = fetch): Promise<number> {
  if (!chaveDoAsaas()) return 0;
  const abertas = db.prepare(`SELECT c.*, l.valor_centavos AS l_valor, l.vencimento AS l_venc, l.cancelado AS l_cancelado, l.pago_em AS l_pago FROM gestao_asaas_cobrancas c JOIN gestao_lancamentos l ON l.id=c.lancamento_id
    WHERE c.status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS')`).all() as (Cobranca & { l_valor: number; l_venc: string; l_cancelado: number; l_pago: string | null })[];
  let n = 0;
  for (const c of abertas) {
    try {
      if (c.l_cancelado) { await cancelarCobranca(c.lancamento_id, undefined, http); n++; continue; }
      if (c.l_pago) continue;
      if (c.l_valor !== c.valor_centavos || c.l_venc !== c.vencimento) {
        await chamar("PUT", `/payments/${c.payment_id}`, { value: reais(c.l_valor), dueDate: c.l_venc }, http);
        db.prepare("UPDATE gestao_asaas_cobrancas SET valor_centavos=?,vencimento=?,erro=NULL,atualizado_em=CURRENT_TIMESTAMP WHERE lancamento_id=?").run(c.l_valor, c.l_venc, c.lancamento_id);
        registrar(c.lancamento_id, "cobranca_atualizada", "Cobrança do Asaas atualizada com a nova data/valor.", undefined);
        n++;
      }
    } catch (e) { db.prepare("UPDATE gestao_asaas_cobrancas SET erro=? WHERE lancamento_id=?").run(e instanceof Error ? e.message.slice(0, 300) : "Falha ao atualizar no Asaas.", c.lancamento_id); }
  }
  return n;
}

/** O aviso de pagamento do Asaas. Confere o token e aplica o estado; sempre responde ok para eventos que não são nossos. */
export function processarWebhook(tokenRecebido: string | undefined, corpo: unknown): { ok: boolean; tratado: boolean } {
  const esperado = tokenDoWebhook();
  const a = Buffer.from(String(tokenRecebido ?? "")), b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new ErroAsaas("Token do aviso inválido.", 401);
  const ev = corpo as { event?: string; payment?: Pagamento };
  const p = ev?.payment;
  if (!p?.id) return { ok: true, tratado: false };
  const porId = db.prepare("SELECT lancamento_id FROM gestao_asaas_cobrancas WHERE payment_id=?").get(p.id) as { lancamento_id: number } | undefined;
  const ref = /^lanc_(\d+)$/.exec(String(p.externalReference ?? ""));
  const lancId = porId?.lancamento_id ?? (ref ? Number(ref[1]) : 0);
  if (!lancId || !cobrancaDoLancamento(lancId)) return { ok: true, tratado: false };
  if (String(ev.event).startsWith("PAYMENT_DELETED")) p.deleted = true;
  aplicarPagamento(lancId, p);
  agendarSincronizacaoAsaas(); // a tarifa entra no extrato em seguida: traz sozinho, sem ninguém clicar
  return { ok: true, tratado: true };
}

// ---------------- taxas ----------------
const ROTULOS: Record<string, string> = {
  PAYMENT_FEE: "Tarifa de cobrança (boleto, PIX e cartão)", PAYMENT_MESSAGING_NOTIFICATION_FEE: "Notificações por SMS/WhatsApp do Asaas", PIX_TRANSACTION_FEE: "Tarifa de PIX",
  TRANSFER_FEE: "Tarifa de transferência", CREDIT_CARD_FEE: "Tarifa de cartão", ANTICIPATION_FEE: "Antecipação de recebíveis", PAYMENT_DUNNING_REQUEST_FEE: "Negativação",
};
const rotuloDoTipo = (t: string) => ROTULOS[t] ?? t.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Traz o extrato do Asaas do período e guarda (taxas e demais lançamentos financeiros). */
export async function sincronizarExtrato(de: string, ate: string, http: Http = fetch): Promise<{ lidos: number }> {
  let offset = 0, lidos = 0;
  for (let pag = 0; pag < 40; pag++) {
    const r = await chamar<{ data?: { id: string; value: number; type: string; date: string; description?: string; paymentId?: string }[]; hasMore?: boolean }>("GET", `/financialTransactions?startDate=${de}&finishDate=${ate}&offset=${offset}&limit=100`, undefined, http);
    const linhas = r.data ?? [];
    db.transaction(() => { for (const t of linhas) db.prepare("INSERT OR REPLACE INTO gestao_asaas_extrato(id,data,tipo,descricao,valor_centavos,payment_id) VALUES (?,?,?,?,?,?)").run(String(t.id), String(t.date).slice(0, 10), String(t.type), String(t.description ?? "").slice(0, 300), centavos(t.value), String(t.paymentId ?? "")); })();
    lidos += linhas.length; offset += linhas.length;
    if (!r.hasMore || linhas.length === 0) break;
  }
  return { lidos };
}

/** Quanto o escritório gastou com o Asaas no período, e com quê. */
export function taxasDoAsaas(de: string, ate: string) {
  const cobr = db.prepare(`SELECT forma_paga AS forma, COUNT(*) AS pagas, COALESCE(SUM(valor_centavos),0) AS recebido, COALESCE(SUM(taxa_centavos),0) AS taxa FROM gestao_asaas_cobrancas WHERE pago_em>=? AND pago_em<=? AND taxa_centavos IS NOT NULL GROUP BY forma_paga ORDER BY taxa DESC`).all(de, ate) as { forma: string; pagas: number; recebido: number; taxa: number }[];
  const extrato = db.prepare(`SELECT tipo, COUNT(*) AS linhas, COALESCE(SUM(ABS(valor_centavos)),0) AS total FROM gestao_asaas_extrato WHERE data>=? AND data<=? AND tipo LIKE '%FEE%' GROUP BY tipo ORDER BY total DESC`).all(de, ate) as { tipo: string; linhas: number; total: number }[];
  const linhas = db.prepare(`SELECT data,tipo,descricao,ABS(valor_centavos) AS valor_centavos,payment_id FROM gestao_asaas_extrato WHERE data>=? AND data<=? AND tipo LIKE '%FEE%' ORDER BY data DESC,id DESC LIMIT 200`).all(de, ate) as { data: string; tipo: string; descricao: string; valor_centavos: number; payment_id: string }[];
  const meses = db.prepare(`SELECT substr(data,1,7) AS mes, COALESCE(SUM(ABS(valor_centavos)),0) AS taxa FROM gestao_asaas_extrato WHERE tipo LIKE '%FEE%' GROUP BY substr(data,1,7) ORDER BY mes DESC LIMIT 12`).all() as { mes: string; taxa: number }[];
  const recebido = cobr.reduce((s, c) => s + c.recebido, 0), taxaCobr = cobr.reduce((s, c) => s + c.taxa, 0), pagas = cobr.reduce((s, c) => s + c.pagas, 0);
  const totalExtrato = extrato.reduce((s, e) => s + e.total, 0);
  const ultima = db.prepare("SELECT MAX(data) AS d FROM gestao_asaas_extrato").get() as { d: string | null };
  const prev = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(taxa_prevista_centavos),0) AS taxa FROM gestao_asaas_cobrancas WHERE status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS') AND taxa_prevista_centavos IS NOT NULL").get() as { n: number; taxa: number };
  return {
    de, ate, extrato_sincronizado_ate: ultima.d, sincronizado_em: getSetting("asaas_extrato_sync_em") || null, sincronizacao_erro: getSetting("asaas_extrato_sync_erro") || null,
    previstas: { cobrancas: prev.n, taxa_centavos: prev.taxa },
    // "taxas" = o que o extrato do Asaas mostra; sem extrato sincronizado, vale a diferença entre o valor cobrado e o líquido de cada cobrança paga.
    total_centavos: totalExtrato || taxaCobr, origem: totalExtrato ? "extrato" : "cobrancas",
    recebido_centavos: recebido, cobrancas_pagas: pagas, taxa_por_cobranca_centavos: pagas ? Math.round((totalExtrato || taxaCobr) / pagas) : 0,
    percentual_do_recebido: recebido ? Math.round(((totalExtrato || taxaCobr) / recebido) * 1000) / 10 : 0,
    por_forma: cobr.map((c) => ({ forma: c.forma || "Outro", pagas: c.pagas, recebido_centavos: c.recebido, taxa_centavos: c.taxa })),
    por_tipo: extrato.map((e) => ({ tipo: e.tipo, rotulo: rotuloDoTipo(e.tipo), linhas: e.linhas, total_centavos: e.total })),
    meses: meses.reverse().map((m) => ({ mes: m.mes, taxa_centavos: m.taxa })),
    linhas: linhas.map((l) => ({ ...l, rotulo: rotuloDoTipo(l.tipo) })),
  };
}

// ---------------- atualização automática ----------------
let emSincronizacao = false;
let agendada: ReturnType<typeof setTimeout> | null = null;

/** Traz o extrato recente do Asaas (taxas e demais lançamentos). Na primeira vez traz o ano todo; depois só os últimos dias. */
export async function sincronizarExtratoAuto(http: Http = fetch): Promise<{ lidos: number } | null> {
  if (!chaveDoAsaas() || emSincronizacao) return null;
  emSincronizacao = true;
  try {
    const hoje = hojeSaoPaulo();
    const ult = (getSetting("asaas_extrato_sync_em") || "").slice(0, 10);
    const de = /^\d{4}-\d{2}-\d{2}$/.test(ult) ? new Date(Date.parse(`${ult}T12:00:00Z`) - 3 * 86_400_000).toISOString().slice(0, 10) : `${hoje.slice(0, 4)}-01-01`;
    const r = await sincronizarExtrato(de, hoje, http);
    setSetting("asaas_extrato_sync_em", new Date().toISOString()); setSetting("asaas_extrato_sync_erro", "");
    return r;
  } catch (e) { setSetting("asaas_extrato_sync_erro", e instanceof Error ? e.message.slice(0, 200) : "Falha ao buscar o extrato."); return null; }
  finally { emSincronizacao = false; }
}

/** Pede a atualização das taxas para daqui a pouco (junta vários pedidos seguidos numa só ida ao Asaas). */
export function agendarSincronizacaoAsaas(atrasoMs = 4000): void {
  if (!chaveDoAsaas() || agendada) return;
  agendada = setTimeout(() => { agendada = null; void sincronizarExtratoAuto().catch(() => undefined); }, atrasoMs);
  agendada.unref?.();
}

/** Confere no Asaas as cobranças ainda abertas (pega pagamento mesmo sem o aviso de pagamento configurado) e atualiza a tarifa prevista. */
export async function conferirCobrancasAbertas(http: Http = fetch, limite = 30): Promise<number> {
  if (!chaveDoAsaas()) return 0;
  const abertas = db.prepare("SELECT lancamento_id, payment_id FROM gestao_asaas_cobrancas WHERE status IN ('PENDING','OVERDUE','AWAITING_RISK_ANALYSIS') ORDER BY atualizado_em ASC LIMIT ?").all(limite) as { lancamento_id: number; payment_id: string }[];
  let mudou = 0;
  for (const c of abertas) {
    try {
      const antes = cobrancaDoLancamento(c.lancamento_id)?.status;
      const p = await chamar<Pagamento>("GET", `/payments/${c.payment_id}`, undefined, http);
      aplicarPagamento(c.lancamento_id, p);
      db.prepare("UPDATE gestao_asaas_cobrancas SET atualizado_em=CURRENT_TIMESTAMP WHERE lancamento_id=?").run(c.lancamento_id);
      if (cobrancaDoLancamento(c.lancamento_id)?.status !== antes) mudou++;
    } catch { /* tenta de novo na próxima rodada */ }
  }
  return mudou;
}

/** Rodada periódica (a cada 10 min): cobranças abertas, alterações pendentes e extrato. */
export async function rotinaDoAsaas(http: Http = fetch): Promise<void> {
  if (!chaveDoAsaas()) return;
  await conferirCobrancasAbertas(http).catch(() => 0);
  await sincronizarCobrancasAlteradas(http).catch(() => 0);
  await sincronizarExtratoAuto(http);
}
