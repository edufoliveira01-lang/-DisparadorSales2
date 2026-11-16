import { db } from "../../db";
import type { ImagemParaIa } from "../ai/apiProvider";
import { caminhoAceita, caminhoDeVisao, caminhoDeVisaoPronto, perguntarComVisao } from "../ai/visao";
import { ErroGestao } from "./erro";
import { apagarFoto, apagarImagemDaSugestao, fotoDaPessoa, gravarImagemDaSugestao, imagemDaSugestao, salvarFoto, tipoDaImagem } from "./fichaConfig";

/**
 * Foto do cliente sugerida a partir do RG/CNH que ele mandou pelo atendimento. A IA com visão acha o retrato no documento e devolve
 * a caixa dele; a tela recorta e mostra para alguém CONFIRMAR. Nada vira foto do cadastro sozinho.
 */
export interface CaixaDoRetrato { x: number; y: number; largura: number; altura: number }
export interface Deteccao { eh_documento_com_foto: boolean; tipo_documento: string; caixa: CaixaDoRetrato | null }
export type Detector = (imagem: ImagemParaIa) => Promise<Deteccao>;

const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const LIMITE_DA_IMAGEM = 6 * 1024 * 1024;
const VALIDADE_DIAS = 30;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["eh_documento_com_foto", "tipo_documento", "caixa"],
  properties: {
    eh_documento_com_foto: { type: "boolean", description: "true só se a imagem for um documento de identificação (RG, CNH, passaporte, carteira funcional) com o retrato da pessoa." },
    tipo_documento: { type: "string", description: "RG, CNH, passaporte, outro ou nenhum." },
    caixa: {
      anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["x", "y", "largura", "altura"], properties: {
        x: { type: "number" }, y: { type: "number" }, largura: { type: "number" }, altura: { type: "number" } } }],
      description: "Retângulo do retrato (rosto e ombros), em frações de 0 a 1 da imagem inteira: x e y do canto superior esquerdo, largura e altura. null se não houver retrato.",
    },
  },
} as const;
const PROMPT = "Você recebe a imagem de um documento enviado por um cliente de escritório de advocacia. Diga se é um documento de identificação com o retrato da pessoa (RG, CNH, passaporte). Se for, devolva o retângulo que contém SÓ a foto do titular (rosto e ombros), em frações de 0 a 1 da largura e altura da imagem inteira. Se a imagem for outra coisa (comprovante de residência, laudo, contrato, print), ou não houver retrato nítido, responda eh_documento_com_foto=false e caixa=null. Não identifique a pessoa e não leia dados do documento.";

/** Há como olhar a imagem? (chave de API ou conta ChatGPT conectada). Mantido com este nome: os fluxos de foto e de leitura perguntam por ele. */
export const iaComVisaoDisponivel = () => caminhoDeVisaoPronto();

export const detectorPadrao: Detector = async (imagem) => {
  const cam = await caminhoDeVisaoPronto();
  if (!cam || !caminhoAceita(cam, imagem)) throw new ErroGestao("IA com visão não configurada.", 409);
  return await perguntarComVisao(PROMPT, SCHEMA, imagem, cam, AbortSignal.timeout(120_000)) as Deteccao;
};

/** A caixa só vale se for plausível: dentro da imagem e com tamanho de retrato. Ganha uma folga para não cortar a cabeça. */
export function caixaValida(c: CaixaDoRetrato | null): CaixaDoRetrato | null {
  if (!c) return null;
  const { x, y, largura, altura } = c;
  if (![x, y, largura, altura].every((n) => Number.isFinite(n))) return null;
  if (x < 0 || y < 0 || largura < 0.04 || altura < 0.04 || x + largura > 1.02 || y + altura > 1.02) return null;
  if (largura > 0.9 && altura > 0.9) return null; // a imagem inteira não é um retrato
  const folgaX = largura * 0.2, folgaY = altura * 0.2;
  const nx = Math.max(0, x - folgaX), ny = Math.max(0, y - folgaY);
  return { x: nx, y: ny, largura: Math.min(1 - nx, largura + 2 * folgaX), altura: Math.min(1 - ny, altura + 2 * folgaY) };
}

export type ResultadoDaSugestao = "sugerida" | "sem_retrato" | "ja_tem_foto" | "ja_sugerida" | "sem_ia" | "nao_e_imagem" | "grande_demais" | "sem_cadastro";

/** Pré-condições da sugestão de foto: cadastro existente, imagem, sem foto e sem sugestão pendente. Devolve o motivo de não seguir, ou null para seguir. */
export function podeSugerirFoto(pessoaId: number | null, conteudo: Buffer): ResultadoDaSugestao | null {
  if (pessoaId === null || !db.prepare("SELECT 1 FROM gestao_pessoas WHERE id=?").get(pessoaId)) return "sem_cadastro";
  const ext = tipoDaImagem(conteudo);
  if (!ext || ext === "ico") return "nao_e_imagem";
  if (conteudo.length > LIMITE_DA_IMAGEM) return "grande_demais";
  if (fotoDaPessoa(pessoaId)) return "ja_tem_foto";
  if (db.prepare("SELECT 1 FROM gestao_foto_sugerida WHERE pessoa_id=?").get(pessoaId)) return "ja_sugerida";
  return null;
}

/** Guarda a sugestão (a cópia do documento + a caixa do retrato) quando a caixa é plausível. */
export function registrarSugestao(pessoaId: number, conteudo: Buffer, caixaBruta: CaixaDoRetrato | null, documento: string, titulo: string): ResultadoDaSugestao {
  const caixa = caixaValida(caixaBruta);
  if (!caixa) return "sem_retrato";
  gravarImagemDaSugestao(pessoaId, conteudo);
  db.prepare("INSERT OR REPLACE INTO gestao_foto_sugerida(pessoa_id,x,y,largura,altura,documento,titulo) VALUES (?,?,?,?,?,?,?)").run(pessoaId, caixa.x, caixa.y, caixa.largura, caixa.altura, String(documento ?? "").slice(0, 40), titulo.slice(0, 120));
  return "sugerida";
}

export async function sugerirFotoDoDocumento(pessoaId: number | null, conteudo: Buffer, titulo: string, detector: Detector = detectorPadrao): Promise<ResultadoDaSugestao> {
  const barrou = podeSugerirFoto(pessoaId, conteudo);
  if (barrou) return barrou;
  if (detector === detectorPadrao && !(await iaComVisaoDisponivel())) return "sem_ia";
  const ext = tipoDaImagem(conteudo)!;
  const r = await detector({ mime: MIME[ext]!, base64: conteudo.toString("base64") });
  return registrarSugestao(pessoaId!, conteudo, r.eh_documento_com_foto ? r.caixa : null, r.tipo_documento, titulo);
}

export interface FotoSugerida { pessoa_id: number; x: number; largura: number; y: number; altura: number; documento: string; titulo: string; criado_em: string }
export function fotoSugeridaDaPessoa(pessoaId: number): FotoSugerida | null {
  const r = db.prepare("SELECT * FROM gestao_foto_sugerida WHERE pessoa_id=?").get(pessoaId) as FotoSugerida | undefined;
  if (!r) return null;
  const idadeDias = (Date.now() - Date.parse(`${r.criado_em.replace(" ", "T")}Z`)) / 86_400_000;
  if (idadeDias > VALIDADE_DIAS || !imagemDaSugestao(pessoaId)) { descartarSugestao(pessoaId); return null; }
  return r;
}
export function descartarSugestao(pessoaId: number) { db.prepare("DELETE FROM gestao_foto_sugerida WHERE pessoa_id=?").run(pessoaId); apagarImagemDaSugestao(pessoaId); }

/** A pessoa confirmou: a imagem JÁ RECORTADA pela tela vira a foto do cadastro, e a cópia do documento é apagada. */
export function aceitarSugestao(pessoaId: number, recorte: Buffer) {
  if (!fotoSugeridaDaPessoa(pessoaId)) throw new ErroGestao("Não há foto sugerida para este cadastro.", 404);
  salvarFoto(pessoaId, recorte);
  descartarSugestao(pessoaId);
}
export { apagarFoto };
