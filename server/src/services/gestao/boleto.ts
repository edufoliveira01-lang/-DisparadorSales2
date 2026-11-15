/**
 * O boleto em PDF: baixa do Asaas, guarda no cadastro do cliente (Arquivos) e copia para a pasta «BOLETOS E COBRANÇAS» dele no Dropbox.
 * O mesmo PDF é anexado ao aviso enviado pelo Deskcomm.
 */
import fs from "node:fs";
import { db } from "../../db";
import { enfileirarCopia } from "../../armazenamento/fila";
import { cobrancaDoLancamento, descreverFalhaDeRede } from "./asaas";
import { obterArquivo, salvarArquivo } from "./arquivos";
import { obterLancamento, registrar, type Quem } from "./financeiro";

type Http = typeof fetch;
export interface BoletoPdf { arquivoId: number; nome: string; conteudo: Buffer }

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("-");
const MAX = 5 * 1024 * 1024;
/**
 * O nome do boleto, para o cadastro, o Dropbox e o cliente: `Boleto - Honorários 1-3 - R$ 10,00 - venc 15-11-2026.pdf`. Diz o que é, de qual parcela,
 * quanto e quando vence — e não depende de código interno nem de data de geração.
 */
export function nomeDoBoleto(descricao: unknown, valorCentavos: number, vencimento: string, comExtensao = true): string {
  const valor = (valorCentavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");
  const base = `Boleto - ${String(descricao ?? "").replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "Parcela"} - ${valor} - venc ${dataBr(vencimento)}`;
  return comExtensao ? `${base}.pdf` : base;
}

/** Descrição da parcela sem barras («Parcela 1/3»), que quebrariam o nome do arquivo. */
const limpa = (t: unknown, n: number) => String(t).replace(/[\\/]+/g, "-").slice(0, n);

/** Só aceita o endereço do boleto se for do Asaas (a URL vem da resposta deles, mas nunca se confia em endereço para baixar). */
function urlDoAsaas(u: string): URL | null {
  try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)asaas\.com$/i.test(x.hostname) ? x : null; } catch { return null; }
}

/**
 * Devolve o PDF do boleto da parcela: o que já foi guardado ou, se ainda não houver, baixa do Asaas e guarda.
 * `null` quando a cobrança não tem boleto (só PIX), já foi paga/cancelada ou o Asaas ainda não liberou o PDF.
 */
export async function boletoEmPdf(lancamentoId: number, opts: { quem?: Quem; http?: Http; copiarParaDrive?: boolean; motivo?: { texto: string }; limiteMs?: number } = {}): Promise<BoletoPdf | null> {
  const sem = (t: string) => { if (opts.motivo) opts.motivo.texto = t; return null; };
  const c = cobrancaDoLancamento(lancamentoId);
  if (!c) return sem("não há cobrança gerada");
  if (c.billing_type === "PIX") return sem("a cobrança é só PIX");
  if (["DELETED", "CANCELADA", "REFUNDED", "RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(c.status)) return sem("a cobrança já foi paga ou cancelada");
  const ja = (db.prepare("SELECT boleto_arquivo_id AS id FROM gestao_asaas_cobrancas WHERE lancamento_id=?").get(lancamentoId) as { id: number | null } | undefined)?.id;
  if (ja) {
    try {
      const a = obterArquivo(ja);
      const l0 = obterLancamento(lancamentoId);
      const nomeCerto = nomeDoBoleto(l0.descricao, c.valor_centavos, c.vencimento);
      // Boleto guardado antes do nome novo: renomeia no cadastro (o arquivo em disco não muda) para tudo sair com o mesmo nome.
      if (a.nome !== nomeCerto) db.prepare("UPDATE gestao_arquivos SET nome=? WHERE id=?").run(nomeCerto, ja);
      if (opts.copiarParaDrive && l0.pessoa_id) {
        try { enfileirarCopia({ pessoaId: l0.pessoa_id, arquivoId: ja, tipoPasta: "BOLETOS E COBRANÇAS", titulo: nomeDoBoleto(l0.descricao, c.valor_centavos, c.vencimento, false), extensao: "pdf" }); } catch { /* o drive não é requisito para cobrar */ }
      }
      return { arquivoId: ja, nome: nomeCerto, conteudo: fs.readFileSync(a.caminho) };
    } catch { /* apagado: baixa de novo */ }
  }
  // Cobrança «boleto ou PIX» nem sempre devolve `bankSlipUrl`: o PDF do mesmo código fica em /b/pdf/<código>, ao lado da página /i/<código>.
  const derivada = c.invoice_url ? c.invoice_url.replace(/\/i\/([^/?#]+)/, "/b/pdf/$1") : "";
  // O endereço derivado só entra quando o do boleto veio VAZIO; endereço presente e de fora do Asaas é recusado, nunca "consertado".
  const url = c.bank_slip_url ? urlDoAsaas(c.bank_slip_url) : urlDoAsaas(derivada);
  if (!url) return sem("o Asaas não devolveu o endereço do boleto");
  let r: Response;
  try { r = await (opts.http ?? fetch)(url.toString(), { signal: AbortSignal.timeout(opts.limiteMs ?? 25_000), redirect: "follow", headers: { Accept: "application/pdf,*/*", "User-Agent": "Mozilla/5.0 (compatible; DisparaZap/1.0)" } }); } catch (e) { return sem(`não consegui baixar o boleto do Asaas (${descreverFalhaDeRede(e, opts.limiteMs ?? 25_000)})`); }
  if (!r.ok) return sem(`o Asaas respondeu HTTP ${r.status} ao baixar o boleto (${url.hostname})`);
  const conteudo = Buffer.from(await r.arrayBuffer());
  if (conteudo.length > MAX) return sem("o PDF do boleto é grande demais");
  if (conteudo.length < 200 || conteudo.subarray(0, 5).toString("latin1") !== "%PDF-") return sem("o endereço do boleto não devolveu um PDF (o Asaas ainda não liberou)");
  const l = obterLancamento(lancamentoId);
  if (!l.pessoa_id) return sem("a parcela não tem cliente vinculado");
  const nome = nomeDoBoleto(l.descricao, c.valor_centavos, c.vencimento);
  const arq = salvarArquivo({ pessoaId: l.pessoa_id }, nome, conteudo, { categoria: "Financeiro", descricao: "Boleto gerado pelo Asaas" }, { id: opts.quem?.id ?? null, nome: opts.quem?.nome ?? "Sistema" });
  db.prepare("UPDATE gestao_asaas_cobrancas SET boleto_arquivo_id=? WHERE lancamento_id=?").run(arq.id, lancamentoId);
  registrar(lancamentoId, "boleto_pdf", "Boleto em PDF guardado no cadastro do cliente.", opts.quem);
  if (opts.copiarParaDrive) {
    try {
      if (enfileirarCopia({ pessoaId: l.pessoa_id, arquivoId: arq.id, tipoPasta: "BOLETOS E COBRANÇAS", titulo: nomeDoBoleto(l.descricao, c.valor_centavos, c.vencimento, false), extensao: "pdf" }))
        registrar(lancamentoId, "boleto_dropbox", "Boleto enviado para a fila de cópia ao Dropbox.", opts.quem);
    } catch { /* o drive não é requisito para cobrar */ }
  }
  return { arquivoId: arq.id, nome: arq.nome, conteudo };
}
