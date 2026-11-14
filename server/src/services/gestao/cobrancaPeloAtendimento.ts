import { db } from "../../db";
import { pessoaDoDocumento } from "../../armazenamento/chat";
import { pessoaPorTelefone } from "./anotacoes";
import { ErroGestao } from "./erro";
import { ErroAsaas, gerarCobranca, cobrancaDoLancamento, chaveDoAsaas } from "./asaas";
import { boletoEmPdf } from "./boleto";
import { hojeSaoPaulo } from "../djen/cache";
import { registrar } from "./financeiro";

/**
 * O atendimento (agente de IA) pede a cobrança de uma parcela do PRÓPRIO cliente da conversa. O cliente é achado pelo telefone (ou CPF) —
 * nunca por um identificador que o modelo escolha —, só parcelas a receber, em aberto, desse cliente. Sem cobrança ativa, gera no Asaas
 * (boleto + PIX); com cobrança ativa, devolve a mesma. Parcela vencida não gera sozinha: a equipe precisa definir uma nova data.
 */
export interface CobrancaParaOAtendimento {
  lancamento_id: number; descricao: string; valor_centavos: number; vencimento: string;
  link: string; linha_digitavel: string; pix: string; boleto_pdf_base64: string | null; boleto_pdf_nome: string | null;
  outras_em_aberto: number;
}

interface Aberta { id: number; descricao: string; valor_centavos: number; vencimento: string }

export function parcelasEmAbertoDoCliente(pessoaId: number): Aberta[] {
  return db.prepare("SELECT id,descricao,valor_centavos,vencimento FROM gestao_lancamentos WHERE pessoa_id=? AND tipo='receber' AND cancelado=0 AND pago_em IS NULL ORDER BY vencimento, id").all(pessoaId) as Aberta[];
}

export async function cobrancaParaOAtendimento(d: { telefone?: unknown; cpf?: unknown; lancamento_id?: unknown }, http: typeof fetch = fetch): Promise<CobrancaParaOAtendimento> {
  // O mesmo critério tolerante da anotação (com ou sem 55 e o 9º dígito); o do documento recusa telefone repetido e formato diferente.
  const pessoaId = pessoaDoDocumento(String(d.cpf ?? ""), String(d.telefone ?? "")) ?? pessoaPorTelefone(d.telefone)?.id ?? null;
  if (pessoaId === null) throw new ErroGestao("Este telefone não está no cadastro de clientes.", 404);
  if (!chaveDoAsaas()) throw new ErroGestao("A cobrança automática (Asaas) não está configurada neste escritório.", 409);
  const abertas = parcelasEmAbertoDoCliente(pessoaId);
  if (abertas.length === 0) throw new ErroGestao("O cliente não tem parcela em aberto.", 404);
  const pedido = Number(d.lancamento_id);
  const alvo = Number.isSafeInteger(pedido) && pedido > 0 ? abertas.find((a) => a.id === pedido) : abertas[0];
  if (!alvo) throw new ErroGestao("Essa parcela não é deste cliente ou já não está em aberto.", 404);
  const jaTem = cobrancaDoLancamento(alvo.id);
  if (!jaTem && alvo.vencimento < hojeSaoPaulo()) throw new ErroGestao("A parcela está vencida: a equipe precisa definir uma nova data antes de gerar o boleto.", 422);
  let c;
  try { c = await gerarCobranca(alvo.id, "boleto_pix", { id: null, nome: "Assistente virtual (atendimento)" }, http); }
  catch (e) { if (e instanceof ErroAsaas) throw new ErroGestao(e.message, e.status === 401 ? 502 : e.status); throw e; }
  let pdf: Awaited<ReturnType<typeof boletoEmPdf>> = null;
  try { pdf = await boletoEmPdf(alvo.id, { http }); } catch { /* o link e o PIX bastam */ }
  registrar(alvo.id, "cobranca_pelo_atendimento", "Cobrança enviada ao cliente pelo atendimento (assistente virtual).", undefined);
  return {
    lancamento_id: alvo.id, descricao: alvo.descricao, valor_centavos: alvo.valor_centavos, vencimento: alvo.vencimento,
    link: c.invoice_url || c.bank_slip_url || "", linha_digitavel: c.linha_digitavel || "", pix: c.pix_payload || "",
    boleto_pdf_base64: pdf && pdf.conteudo.length <= 3_000_000 ? pdf.conteudo.toString("base64") : null, boleto_pdf_nome: pdf?.nome ?? null,
    outras_em_aberto: abertas.length - 1,
  };
}
