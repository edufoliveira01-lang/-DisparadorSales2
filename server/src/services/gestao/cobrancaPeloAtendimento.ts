import { db } from "../../db";
import { pessoaDoDocumento } from "../../armazenamento/chat";
import { pessoaPorTelefone } from "./anotacoes";
import { ErroGestao } from "./erro";
import { ErroAsaas, gerarCobranca, cobrancaDoLancamento, chaveDoAsaas, completarDetalhesDaCobranca } from "./asaas";
import { boletoEmPdf } from "./boleto";
import { hojeSaoPaulo } from "../djen/cache";
import { registrar } from "./financeiro";
import { documentoValido, soDigitos } from "./validacao";

/**
 * O atendimento (agente de IA) pede a cobrança de uma parcela do PRÓPRIO cliente da conversa. O cliente é achado pelo telefone (ou CPF) —
 * nunca por um identificador que o modelo escolha —, só parcelas a receber, em aberto, desse cliente. Sem cobrança ativa, gera no Asaas
 * (boleto + PIX); com cobrança ativa, devolve a mesma. Parcela vencida não gera sozinha: a equipe precisa definir uma nova data.
 */
export interface CobrancaParaOAtendimento {
  lancamento_id: number; descricao: string; valor_centavos: number; vencimento: string;
  link: string; linha_digitavel: string; pix: string; boleto_pdf_base64: string | null; boleto_pdf_nome: string | null; boleto_pdf_motivo: string | null; pix_motivo: string | null;
  /** Falta o PIX ou o PDF: quem chamou completa depois, sem pressa, com `complementoDaCobranca`. */
  pendente: boolean;
  outras_em_aberto: number;
}

interface Aberta { id: number; descricao: string; valor_centavos: number; vencimento: string }

export function parcelasEmAbertoDoCliente(pessoaId: number): Aberta[] {
  return db.prepare("SELECT id,descricao,valor_centavos,vencimento FROM gestao_lancamentos WHERE pessoa_id=? AND tipo='receber' AND cancelado=0 AND pago_em IS NULL ORDER BY vencimento, id").all(pessoaId) as Aberta[];
}

interface Complemento { cobranca: Awaited<ReturnType<typeof gerarCobranca>>; pdf: Awaited<ReturnType<typeof boletoEmPdf>>; pdfMotivo: string; pixMotivo: string | null; acabou: boolean }

/**
 * Busca no Asaas o que a cobrança ainda não tem: o PIX copia e cola (e a linha digitável) e o PDF do boleto. As duas buscas correm JUNTAS, cada uma com o
 * seu tempo limite, e o conjunto tem um teto (`totalMs`). O que não vier fica como MOTIVO escrito — nunca como erro: o link de pagamento já existe.
 */
async function buscarComplemento(lancamentoId: number, atual: Complemento["cobranca"], http: typeof fetch, o: { porConsultaMs: number; totalMs: number; esperaMs: number; repetirPix: boolean }): Promise<Complemento> {
  const motivo = { texto: "" };
  const motivosDoPix: { pix?: string; linha?: string } = {};
  const achado: { pdf: Complemento["pdf"]; cobranca: Complemento["cobranca"] } = { pdf: null, cobranca: atual };
  const buscarPix = (async () => {
    try {
      achado.cobranca = (await completarDetalhesDaCobranca(lancamentoId, http, o.porConsultaMs, motivosDoPix)) ?? achado.cobranca;
      if (o.repetirPix && !achado.cobranca.pix_payload) { await new Promise((r) => setTimeout(r, o.esperaMs)); achado.cobranca = (await completarDetalhesDaCobranca(lancamentoId, http, o.porConsultaMs, motivosDoPix)) ?? achado.cobranca; }
    } catch { /* o que já veio basta */ }
  })();
  const buscarPdf = (async () => {
    try { achado.pdf = await boletoEmPdf(lancamentoId, { http, motivo, limiteMs: o.porConsultaMs }); } catch (e) { motivo.texto = e instanceof Error ? e.message : "falha ao baixar o boleto"; }
  })();
  let acabou = false;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all([buscarPix, buscarPdf]).then(() => { acabou = true; }), new Promise((r) => { relogio = setTimeout(r, o.totalMs); })]);
  if (relogio) clearTimeout(relogio);
  const c = achado.cobranca;
  const dicaDoPix = (m: string) => (/erro desconhecido|chave pix/i.test(m) ? `${m} (costuma indicar que a conta do Asaas não tem chave PIX cadastrada)` : m);
  const pixMotivo = c.pix_payload ? null : (motivosDoPix.pix ? dicaDoPix(motivosDoPix.pix) : (acabou ? "o Asaas não devolveu o código do PIX (a conta pode não ter chave PIX cadastrada)" : "o Asaas demorou para devolver o código do PIX")));
  return { cobranca: c, pdf: achado.pdf, pdfMotivo: achado.pdf ? "" : (motivo.texto || (acabou ? "o boleto em PDF não está disponível" : "o Asaas demorou para liberar o boleto em PDF")), pixMotivo, acabou };
}

function montarResposta(alvo: Aberta, x: Complemento, outras: number): CobrancaParaOAtendimento {
  const c = x.cobranca;
  const pdfOk = Boolean(x.pdf && x.pdf.conteudo.length <= 3_000_000);
  return {
    lancamento_id: alvo.id, descricao: alvo.descricao, valor_centavos: alvo.valor_centavos, vencimento: alvo.vencimento,
    link: c.invoice_url || c.bank_slip_url || "", linha_digitavel: c.linha_digitavel || "", pix: c.pix_payload || "",
    boleto_pdf_base64: pdfOk ? x.pdf!.conteudo.toString("base64") : null, boleto_pdf_nome: pdfOk ? x.pdf!.nome : null,
    pix_motivo: pdfOk && c.pix_payload ? null : x.pixMotivo, boleto_pdf_motivo: pdfOk ? null : (x.pdfMotivo || "o boleto em PDF não está disponível"),
    pendente: !pdfOk || !c.pix_payload,
    outras_em_aberto: outras,
  };
}

type Deps = { esperaMs?: number; limiteTotalMs?: number; limiteDosDetalhesMs?: number; limitePorConsultaMs?: number };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/** Aceita 2026-11-15, 15/11/2026 e 15/11 (este ano ou o próximo, o que ainda faça sentido); devolve AAAA-MM-DD ou null. */
function dataIso(v: unknown): string | null {
  const t = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t);
  if (!m) return null;
  const ano = m[3] ?? hojeSaoPaulo().slice(0, 4);
  return `${ano}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
}

export interface SeletorDeParcela { lancamento_id?: unknown; valor_centavos?: unknown; vencimento?: unknown }

/**
 * A parcela que o CLIENTE pediu, entre as em aberto DELE. Nunca escolhe sozinha quando há mais de uma: boleto de outra parcela chega ao cliente como
 * cobrança certa e ele paga o valor errado. Sem seletor e com mais de uma em aberto, recusa listando as opções para o atendimento perguntar.
 */
function parcelaDoCliente(pessoaId: number, sel: SeletorDeParcela): { alvo: Aberta; outras: number } {
  const abertas = parcelasEmAbertoDoCliente(pessoaId);
  if (abertas.length === 0) throw new ErroGestao("O cliente não tem parcela em aberto.", 404);
  const hoje = hojeSaoPaulo();
  const lista = abertas.map((a) => `${brl(a.valor_centavos)} (venc. ${dataBr(a.vencimento)}${a.vencimento < hoje ? ", vencida" : ""})`).join("; ");
  const outras = (a: Aberta) => abertas.length - 1 + (a ? 0 : 0);
  const id = Number(sel.lancamento_id);
  if (Number.isSafeInteger(id) && id > 0) {
    const a = abertas.find((x) => x.id === id);
    if (!a) throw new ErroGestao("Essa parcela não é deste cliente ou já não está em aberto.", 404);
    return { alvo: a, outras: outras(a) };
  }
  const valor = Math.round(Number(sel.valor_centavos));
  const venc = sel.vencimento === undefined || sel.vencimento === null || String(sel.vencimento).trim() === "" ? null : dataIso(sel.vencimento);
  if (sel.vencimento !== undefined && sel.vencimento !== null && String(sel.vencimento).trim() !== "" && venc === null) throw new ErroGestao("Data de vencimento inválida: use dia/mês (ex.: 15/11).", 422);
  const temValor = Number.isFinite(valor) && valor > 0;
  if (!temValor && !venc) {
    if (abertas.length === 1) return { alvo: abertas[0]!, outras: 0 };
    throw new ErroGestao(`O cliente tem ${abertas.length} parcelas em aberto: ${lista}. Pergunte de qual delas ele precisa e informe o valor (e o vencimento, se houver duas do mesmo valor).`, 409);
  }
  const achadas = abertas.filter((a) => (!temValor || a.valor_centavos === valor) && (!venc || a.vencimento === venc));
  if (achadas.length === 0) throw new ErroGestao(`Não achei parcela em aberto com esse valor${venc ? " e vencimento" : ""}. Em aberto: ${lista}. Confirme com o cliente qual é a parcela.`, 404);
  if (achadas.length > 1) throw new ErroGestao(`Mais de uma parcela combina: ${achadas.map((a) => `${brl(a.valor_centavos)} (venc. ${dataBr(a.vencimento)})`).join("; ")}. Informe também o vencimento.`, 409);
  return { alvo: achadas[0]!, outras: outras(achadas[0]!) };
}

function clienteDoTelefone(telefone: unknown): number {
  // O mesmo critério tolerante da anotação (com ou sem 55 e o 9º dígito); o do documento recusa telefone repetido e formato diferente.
  // SÓ o telefone da conversa identifica o cliente: o CPF que veio do atendimento é dado digitado por quem escreve e NUNCA escolhe de quem é a cobrança.
  const pessoaId = pessoaDoDocumento("", String(telefone ?? "")) ?? pessoaPorTelefone(telefone)?.id ?? null;
  if (pessoaId === null) throw new ErroGestao("Este telefone não está no cadastro de clientes.", 404);
  if (!chaveDoAsaas()) throw new ErroGestao("A cobrança automática (Asaas) não está configurada neste escritório.", 409);
  return pessoaId;
}

/**
 * MODO RÁPIDO (a resposta do chat espera por ele): gera a cobrança (ou reaproveita) e tenta o PIX e o PDF por POUCO tempo. Devolve o link e a linha
 * digitável na hora; `pendente` diz que falta PIX ou PDF — quem chamou completa depois com `complementoDaCobranca`, sem ninguém esperando.
 */
export async function cobrancaParaOAtendimento(d: { telefone?: unknown; cpf?: unknown } & SeletorDeParcela, http: typeof fetch = fetch, deps: Deps = {}): Promise<CobrancaParaOAtendimento> {
  const pessoaId = clienteDoTelefone(d.telefone);
  completarDocumentoSeFalta(pessoaId, d.cpf);
  const { alvo, outras } = parcelaDoCliente(pessoaId, d);
  const jaTem = cobrancaDoLancamento(alvo.id);
  if (!jaTem && alvo.vencimento < hojeSaoPaulo()) throw new ErroGestao("A parcela está vencida: a equipe precisa definir uma nova data antes de gerar o boleto.", 422);
  let c;
  try { c = await gerarCobranca(alvo.id, "boleto_pix", { id: null, nome: "Assistente virtual (atendimento)" }, http, deps.limiteDosDetalhesMs ?? 8_000); }
  catch (e) { if (e instanceof ErroAsaas) throw new ErroGestao(e.message, e.status === 401 ? 502 : e.status); throw e; }
  const x = await buscarComplemento(alvo.id, c, http, { porConsultaMs: deps.limitePorConsultaMs ?? 8_000, totalMs: deps.limiteTotalMs ?? 12_000, esperaMs: deps.esperaMs ?? 1_000, repetirPix: false });
  registrar(alvo.id, "cobranca_pelo_atendimento", "Cobrança enviada ao cliente pelo atendimento (assistente virtual).", undefined);
  return montarResposta(alvo, x, outras);
}

/**
 * MODO PACIENTE (ninguém espera na tela): completa o PIX e o PDF de uma cobrança JÁ gerada, com até 40 s por consulta. O atendimento chama de novo, a
 * intervalos, até conseguir (o Asaas de testes costuma demorar). Não cria cobrança: só a do próprio cliente do telefone, em aberto.
 */
export async function complementoDaCobranca(d: { telefone?: unknown } & SeletorDeParcela, http: typeof fetch = fetch, deps: Deps = {}): Promise<CobrancaParaOAtendimento> {
  const pessoaId = clienteDoTelefone(d.telefone);
  const { alvo, outras } = parcelaDoCliente(pessoaId, d);
  const c = cobrancaDoLancamento(alvo.id);
  if (!c) throw new ErroGestao("Essa parcela ainda não tem cobrança gerada.", 404);
  const x = await buscarComplemento(alvo.id, c, http, { porConsultaMs: deps.limitePorConsultaMs ?? 40_000, totalMs: deps.limiteTotalMs ?? 45_000, esperaMs: deps.esperaMs ?? 2_000, repetirPix: true });
  return montarResposta(alvo, x, outras);
}

/**
 * O Asaas exige CPF/CNPJ para emitir a cobrança. Se o cadastro do cliente ainda não tem o documento e o cliente acabou de informá-lo no
 * atendimento (e o agente o gravou), usa esse documento: só quando é válido, não pertence a outro cadastro e o campo está VAZIO. Nunca troca
 * um documento que já existe.
 */
function completarDocumentoSeFalta(pessoaId: number, cpfInformado: unknown): void {
  const doc = soDigitos(cpfInformado);
  if (![11, 14].includes(doc.length) || !documentoValido(doc)) return;
  const p = db.prepare("SELECT documento FROM gestao_pessoas WHERE id=?").get(pessoaId) as { documento: string } | undefined;
  if (!p || soDigitos(p.documento) !== "") return;
  const dono = db.prepare("SELECT id FROM gestao_pessoas WHERE documento=? AND id<>? LIMIT 1").get(doc, pessoaId);
  if (dono) throw new ErroGestao("Esse CPF/CNPJ já está em outro cadastro: a equipe precisa conferir antes de gerar a cobrança.", 409);
  db.prepare("UPDATE gestao_pessoas SET documento=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(doc, pessoaId);
}
