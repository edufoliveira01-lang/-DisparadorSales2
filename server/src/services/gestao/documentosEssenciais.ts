import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { ErroGestao } from "./erro";
import { extensao, nomeSeguro, obterArquivo, podeExibir, salvarArquivo } from "./arquivos";

/**
 * Os documentos que TODO cliente deve ter no cadastro: RG, CPF, CNH, comprovante de residência e CNIS. Cada um é um «espaço» (slot) fixo:
 * o arquivo mais recente é o atual; os anteriores ficam no histórico. Comprovante e CNIS vencem (precisam ser recentes).
 */
export const ESSENCIAIS = {
  rg: { rotulo: "RG", validade_dias: null as number | null },
  cpf: { rotulo: "CPF", validade_dias: null },
  cnh: { rotulo: "CNH", validade_dias: null },
  comprovante: { rotulo: "Comprovante de residência", validade_dias: 90 },
  cnis: { rotulo: "CNIS", validade_dias: 60 },
} as const;
export type SlotEssencial = keyof typeof ESSENCIAIS;
export const slotValido = (v: unknown): v is SlotEssencial => typeof v === "string" && Object.prototype.hasOwnProperty.call(ESSENCIAIS, v);

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Descobre o documento pelo nome do arquivo ou pelo título que o atendimento deu. null = não reconheceu (fica como arquivo comum). */
export function identificarSlot(...textos: (string | null | undefined)[]): SlotEssencial | null {
  const t = semAcento(textos.filter(Boolean).join(" "));
  if (/\bcnis\b|extrato previdenci|cadastro nacional de informacoes sociais/.test(t)) return "cnis";
  if (/\bcnh\b|habilitacao/.test(t)) return "cnh";
  if (/comprovante.*(residencia|endereco)|conta de (luz|agua|energia|telefone|gas|internet)|fatura (de )?(energia|luz|agua)|\bendereco\b/.test(t)) return "comprovante";
  if (/\brg\b|identidade|registro geral/.test(t)) return "rg";
  if (/\bcpf\b|cadastro de pessoa/.test(t)) return "cpf";
  return null;
}

const dataDoRegistro = (a: { data_documento: string; criado_em: string }) => a.data_documento || a.criado_em.slice(0, 10);
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const dataValida = (d: unknown): string | null => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);

interface Linha { id: number; nome: string; tamanho: number; slot: string; data_documento: string; criado_em: string; autor: string; versao: number }
const nomePadrao = (data: string, slot: SlotEssencial, original: string) => {
  const ext = extensao(original);
  return `${data} - ${ESSENCIAIS[slot].rotulo}${ext ? `.${ext}` : ""}`;
};

export function listarEssenciais(pessoaId: number) {
  if (!db.prepare("SELECT 1 FROM gestao_pessoas WHERE id=?").get(pessoaId)) throw new ErroGestao("Pessoa não encontrada.", 404);
  const hoje = hojeSaoPaulo();
  return (Object.keys(ESSENCIAIS) as SlotEssencial[]).map((slot) => {
    const linhas = (db.prepare("SELECT id,nome,tamanho,slot,data_documento,criado_em,autor,versao FROM gestao_arquivos WHERE pessoa_id=? AND processo_id IS NULL AND slot=?").all(pessoaId, slot) as Linha[])
      .map((l) => ({ ...l, data: dataDoRegistro(l) })).sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id);
    const atual = linhas[0] ?? null;
    const idade = atual ? diasEntre(atual.data, hoje) : null;
    const validade = ESSENCIAIS[slot].validade_dias;
    const situacao = !atual ? "faltando" : validade !== null && idade! > validade ? "desatualizado" : "ok";
    return {
      slot, rotulo: ESSENCIAIS[slot].rotulo, validade_dias: validade, situacao,
      atual: atual ? { id: atual.id, nome: atual.nome, tamanho: atual.tamanho, data: atual.data, idade_dias: idade, autor: atual.autor, exibivel: podeExibir(obterArquivo(atual.id)) } : null,
      historico: linhas.slice(1).map((l) => ({ id: l.id, nome: l.nome, data: l.data, autor: l.autor })),
    };
  });
}

/** Guarda um documento no espaço do cliente, já com o nome padrão (`AAAA-MM-DD - CNIS.pdf`). `origemRef` evita guardar duas vezes o mesmo documento do atendimento. */
export function guardarEssencial(pessoaId: number, slot: SlotEssencial, nomeOriginal: string, conteudo: Buffer, opcoes: { data?: string | null; user: { id: number | null; nome: string }; origemRef?: string }) {
  if (opcoes.origemRef && db.prepare("SELECT 1 FROM gestao_arquivos WHERE pessoa_id=? AND descricao=?").get(pessoaId, `chat:${opcoes.origemRef}`)) return null;
  const data = dataValida(opcoes.data) ?? hojeSaoPaulo();
  const a = salvarArquivo({ pessoaId }, nomePadrao(data, slot, nomeSeguro(nomeOriginal)), conteudo, { categoria: ESSENCIAIS[slot].rotulo, descricao: opcoes.origemRef ? `chat:${opcoes.origemRef}` : `Original: ${nomeSeguro(nomeOriginal)}` }, opcoes.user);
  db.prepare("UPDATE gestao_arquivos SET slot=?,data_documento=? WHERE id=?").run(slot, data, a.id);
  return { id: a.id, nome: a.nome };
}

/** Marca um arquivo que já está no cadastro como um dos documentos essenciais (ou tira a marca, com slot ''). Opcionalmente renomeia para o padrão. */
export function classificarArquivo(arquivoId: number, slot: unknown, opcoes: { data?: unknown; padronizar?: boolean } = {}) {
  const a = obterArquivo(arquivoId);
  if (!a.pessoa_id || a.processo_id) throw new ErroGestao("Só os arquivos do cadastro do cliente entram nos documentos essenciais.", 400);
  if (slot === "" || slot === null) { db.prepare("UPDATE gestao_arquivos SET slot='',data_documento='' WHERE id=?").run(arquivoId); return { id: arquivoId, slot: "" }; }
  if (!slotValido(slot)) throw new ErroGestao("Documento inválido.", 400);
  const data = dataValida(opcoes.data) ?? a.criado_em.slice(0, 10);
  const nome = opcoes.padronizar === false ? a.nome : nomePadrao(data, slot, a.nome);
  db.prepare("UPDATE gestao_arquivos SET slot=?,data_documento=?,categoria=?,nome=? WHERE id=?").run(slot, data, ESSENCIAIS[slot].rotulo, nome, arquivoId);
  return { id: arquivoId, slot, nome };
}

export function renomearArquivo(arquivoId: number, nomeBruto: unknown) {
  const a = obterArquivo(arquivoId);
  const ext = extensao(a.nome);
  let bruto = String(nomeBruto ?? "").trim();
  if (ext && !extensao(bruto)) bruto = `${bruto}.${ext}`; // quem não digita a extensão não perde o tipo do arquivo
  const nome = nomeSeguro(bruto);
  if (extensao(nome) !== ext) throw new ErroGestao(`Mantenha a extensão .${ext}: ela é o tipo do arquivo.`, 400);
  db.prepare("UPDATE gestao_arquivos SET nome=? WHERE id=?").run(nome, arquivoId);
  return { id: arquivoId, nome };
}
