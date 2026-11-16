import fs from "node:fs";
import { db } from "../../db";
import type { ImagemParaIa } from "../ai/apiProvider";
import { caminhoAceita, caminhoDeVisao, perguntarComVisao } from "../ai/visao";
import { hojeSaoPaulo } from "../djen/cache";
import { ErroGestao } from "./erro";
import { obterArquivo } from "./arquivos";
import { classificarArquivo, slotValido, type SlotEssencial } from "./documentosEssenciais";
import { podeSugerirFoto, registrarSugestao, type CaixaDoRetrato } from "./fotoSugerida";

/**
 * O sistema LÊ o arquivo (imagem ou PDF) e descobre sozinho que documento é, a data dele e, no RG/CNH, onde está o retrato.
 * Serve para o que chega com nome qualquer («imagem (2).jpg», «scan123.pdf»). Só usa a IA quando o nome não resolveu.
 */
export interface Leitura { tipo: SlotEssencial | "outro"; data_documento: string | null; confianca: number; retrato: CaixaDoRetrato | null }

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["tipo", "data_documento", "confianca", "retrato"],
  properties: {
    tipo: { type: "string", enum: ["rg", "cpf", "cnh", "comprovante", "cnis", "outro"] },
    data_documento: { anyOf: [{ type: "null" }, { type: "string", description: "AAAA-MM-DD" }] },
    confianca: { type: "number", description: "De 0 a 1." },
    retrato: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["x", "y", "largura", "altura"], properties: { x: { type: "number" }, y: { type: "number" }, largura: { type: "number" }, altura: { type: "number" } } }] },
  },
} as const;
const PROMPT = `Você recebe um arquivo enviado por um cliente de escritório de advocacia. Diga que documento é:
- rg: carteira de identidade (RG, frente ou verso);
- cpf: cartão ou comprovante de inscrição no CPF;
- cnh: carteira nacional de habilitação;
- comprovante: comprovante de residência (conta de luz, água, gás, telefone, internet, fatura ou boleto com o endereço da pessoa);
- cnis: extrato do CNIS (Cadastro Nacional de Informações Sociais) ou extrato previdenciário do Meu INSS;
- outro: qualquer outra coisa (laudo, contrato, petição, foto, print).
Em data_documento devolva a data do próprio documento no formato AAAA-MM-DD: emissão ou data do extrato; para comprovante, a data de emissão ou o mês de referência da fatura; para RG/CNH/CPF, deixe null. Se não achar a data, null.
Em confianca, de 0 a 1, o quanto você tem certeza do tipo.
Se for RG ou CNH com o retrato do titular, devolva em retrato o retângulo da foto (rosto e ombros), em frações de 0 a 1 da imagem inteira (x e y do canto superior esquerdo, largura e altura); senão null.
Não transcreva nem devolva números de documentos, nomes ou endereços: só os campos pedidos.`;

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const LIMITE_IMAGEM = 6 * 1024 * 1024, LIMITE_PDF = 12 * 1024 * 1024, CONFIANCA_MINIMA = 0.7;

export type Leitor = (arquivo: ImagemParaIa) => Promise<Leitura>;
export const leitorPadrao: Leitor = async (arquivo) => {
  const cam = caminhoDeVisao();
  if (!cam || !caminhoAceita(cam, arquivo)) throw new ErroGestao("IA com visão não configurada.", 409);
  return await perguntarComVisao(PROMPT, SCHEMA, arquivo, cam, AbortSignal.timeout(120_000)) as Leitura;
};

/** A data só vale se for uma data real que não esteja no futuro. */
const dataPlausivel = (d: unknown): string | null => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) && d <= hojeSaoPaulo() && d >= "2000-01-01" ? d : null);

export type ResultadoDaLeitura = { situacao: "classificado"; slot: SlotEssencial; data: string | null; nome: string } | { situacao: "nao_identificado" | "sem_ia" | "tipo_nao_suportado" | "grande_demais" | "nao_e_do_cadastro" };

/** Lê o conteúdo e devolve o que a IA entendeu (sem gravar nada). */
export async function lerConteudo(conteudo: Buffer, nome: string, leitor: Leitor = leitorPadrao): Promise<{ situacao: "ok"; leitura: Leitura } | { situacao: "sem_ia" | "tipo_nao_suportado" | "grande_demais" }> {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  if (!mime) return { situacao: "tipo_nao_suportado" };
  if (conteudo.length > (mime === "application/pdf" ? LIMITE_PDF : LIMITE_IMAGEM)) return { situacao: "grande_demais" };
  if (leitor === leitorPadrao) { const cam = caminhoDeVisao(); if (!cam || (mime === "application/pdf" && cam.via === "codex")) return { situacao: "sem_ia" }; }
  const l = await leitor({ mime, base64: conteudo.toString("base64"), nome });
  return { situacao: "ok", leitura: l };
}

/** A leitura vale para classificar? Tipo conhecido e certeza suficiente. */
export const leituraConfiavel = (l: Leitura): l is Leitura & { tipo: SlotEssencial } => slotValido(l.tipo) && Number.isFinite(l.confianca) && l.confianca >= CONFIANCA_MINIMA;

/** Arquivo já guardado no cadastro: lê, classifica, renomeia para o padrão e, sendo RG/CNH com retrato, sugere a foto. */
export async function identificarArquivo(arquivoId: number, leitor: Leitor = leitorPadrao): Promise<ResultadoDaLeitura> {
  const a = obterArquivo(arquivoId);
  if (!a.pessoa_id || a.processo_id) return { situacao: "nao_e_do_cadastro" };
  if (!fs.existsSync(a.caminho)) throw new ErroGestao("O arquivo não está mais no servidor.", 404);
  const conteudo = fs.readFileSync(a.caminho);
  const r = await lerConteudo(conteudo, a.nome, leitor);
  if (r.situacao !== "ok") return { situacao: r.situacao };
  if (!leituraConfiavel(r.leitura)) return { situacao: "nao_identificado" };
  const data = dataPlausivel(r.leitura.data_documento);
  const c = classificarArquivo(arquivoId, r.leitura.tipo, { data: data ?? undefined, padronizar: true }) as { nome: string };
  if ((r.leitura.tipo === "rg" || r.leitura.tipo === "cnh") && r.leitura.retrato && !podeSugerirFoto(a.pessoa_id, conteudo)) registrarSugestao(a.pessoa_id, conteudo, r.leitura.retrato, r.leitura.tipo.toUpperCase(), a.nome);
  db.prepare("UPDATE gestao_arquivos SET descricao=CASE WHEN descricao='' THEN ? ELSE descricao END WHERE id=?").run(`Original: ${a.nome} · identificado automaticamente`, arquivoId);
  return { situacao: "classificado", slot: r.leitura.tipo, data, nome: c.nome };
}
export { dataPlausivel };
