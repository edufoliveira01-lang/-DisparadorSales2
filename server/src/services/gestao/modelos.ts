import { db } from "../../db";
import { ErroGestao, type Pessoa } from "./pessoas";
import { formatarDocumento } from "./validacao";

const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

const PROCURACAO = `# PROCURAÇÃO AD JUDICIA ET EXTRA

OUTORGANTE: {{cliente.nome}}, {{cliente.estado_civil}}, {{cliente.profissao}}, portador(a) do RG nº {{cliente.rg}} e inscrito(a) no CPF/CNPJ sob o nº {{cliente.cpf}}, residente e domiciliado(a) em {{cliente.endereco}}.

OUTORGADO: {{advogado.nome}}, advogado(a), inscrito(a) na OAB sob o nº ________.

PODERES: pelo presente instrumento, o(a) outorgante nomeia e constitui o(a) outorgado(a) seu procurador, conferindo-lhe os poderes da cláusula ad judicia et extra, para o foro em geral, em qualquer juízo, instância ou tribunal, podendo propor ações, contestar, recorrer, transigir, desistir, receber e dar quitação, firmar compromissos, substabelecer com ou sem reservas, e praticar todos os atos necessários ao fiel cumprimento deste mandato, especialmente em {{processo.numero}}.

{{data.extenso}}.

______________________________
{{cliente.nome}}`;
const HIPOSSUFICIENCIA = `# DECLARAÇÃO DE HIPOSSUFICIÊNCIA

Eu, {{cliente.nome}}, {{cliente.estado_civil}}, {{cliente.profissao}}, portador(a) do RG nº {{cliente.rg}} e do CPF nº {{cliente.cpf}}, residente em {{cliente.endereco}}, DECLARO, sob as penas da lei, que não possuo condições de arcar com as custas processuais e os honorários advocatícios sem prejuízo do meu sustento e de minha família, requerendo os benefícios da gratuidade da justiça, nos termos do art. 98 e seguintes do Código de Processo Civil.

{{data.extenso}}.

______________________________
{{cliente.nome}}`;
const CONTRATO = `# CONTRATO DE HONORÁRIOS ADVOCATÍCIOS

CONTRATANTE: {{cliente.nome}}, CPF/CNPJ {{cliente.cpf}}, residente em {{cliente.endereco}}.

CONTRATADO: {{advogado.nome}}, advogado(a).

OBJETO: prestação de serviços advocatícios na defesa dos interesses do(a) contratante em {{processo.titulo}} (processo {{processo.numero}}, {{processo.tribunal}}).

HONORÁRIOS: valor e forma de pagamento ajustados entre as partes: ________________________________.

O(a) contratante declara ter sido informado(a) sobre os riscos e a natureza do serviço, que é de meio e não de resultado. Este modelo deve ser revisado e adaptado pelo advogado responsável antes do uso.

{{data.extenso}}.

______________________________            ______________________________
{{cliente.nome}}                                  {{advogado.nome}}`;

function semearSeVazio() {
  if ((db.prepare("SELECT COUNT(*) n FROM gestao_modelos").get() as { n: number }).n > 0) return;
  const ins = db.prepare("INSERT INTO gestao_modelos(nome,categoria,conteudo,padrao) VALUES (?,?,?,?)");
  ins.run("Procuração ad judicia", "Procuração", PROCURACAO, "procuracao");
  ins.run("Declaração de hipossuficiência", "Declaração", HIPOSSUFICIENCIA, "hipossuficiencia");
  ins.run("Contrato de honorários", "Contrato", CONTRATO, "contrato_honorarios");
}

export const VARIAVEIS = [
  "cliente.nome", "cliente.cpf", "cliente.rg", "cliente.estado_civil", "cliente.profissao", "cliente.endereco", "cliente.telefone", "cliente.email",
  "processo.numero", "processo.pasta", "processo.titulo", "processo.tribunal", "processo.vara", "processo.comarca", "processo.classe", "processo.valor_causa",
  "parte_contraria.nome", "advogado.nome", "data.hoje", "data.extenso",
];

export function listarModelos() { semearSeVazio(); return db.prepare("SELECT id,nome,categoria,conteudo,ativo,atualizado_em FROM gestao_modelos ORDER BY categoria,nome").all(); }
export function salvarModelo(id: number | null, d: Record<string, unknown>) {
  const nome = txt(d.nome, 120), conteudo = String(d.conteudo ?? "").slice(0, 50000);
  if (nome.length < 3) throw new ErroGestao("Informe o nome do modelo.");
  if (conteudo.trim().length < 10) throw new ErroGestao("Escreva o texto do modelo.");
  if (id === null) {
    const r = db.prepare("INSERT INTO gestao_modelos(nome,categoria,conteudo) VALUES (?,?,?)").run(nome, txt(d.categoria, 60), conteudo);
    return db.prepare("SELECT * FROM gestao_modelos WHERE id=?").get(Number(r.lastInsertRowid));
  }
  if (!db.prepare("SELECT id FROM gestao_modelos WHERE id=?").get(id)) throw new ErroGestao("Modelo não encontrado.", 404);
  db.prepare("UPDATE gestao_modelos SET nome=?,categoria=?,conteudo=?,ativo=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(nome, txt(d.categoria, 60), conteudo, d.ativo === false ? 0 : 1, id);
  return db.prepare("SELECT * FROM gestao_modelos WHERE id=?").get(id);
}
export function excluirModelo(id: number) {
  if (!db.prepare("SELECT id FROM gestao_modelos WHERE id=?").get(id)) throw new ErroGestao("Modelo não encontrado.", 404);
  db.prepare("DELETE FROM gestao_modelos WHERE id=?").run(id); return { ok: true };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function enderecoDe(p: Pessoa) {
  return [[p.logradouro, p.numero].filter(Boolean).join(", "), p.complemento, p.bairro, [p.cidade, p.uf].filter(Boolean).join("/"), p.cep && p.cep.length === 8 ? `CEP ${p.cep.slice(0, 5)}-${p.cep.slice(5)}` : p.cep].filter(Boolean).join(", ");
}

export function contextoDoDocumento(opcoes: { pessoaId?: number; processoId?: number }, advogado: string) {
  const v: Record<string, string> = {};
  let pessoa: Pessoa | undefined; let contraria: string | undefined;
  if (opcoes.processoId) {
    const p = db.prepare("SELECT * FROM gestao_processos WHERE id=?").get(opcoes.processoId) as any;
    if (!p) throw new ErroGestao("Processo não encontrado.", 404);
    Object.assign(v, { "processo.numero": p.numero, "processo.pasta": p.pasta, "processo.titulo": p.titulo || p.classe || "", "processo.tribunal": p.tribunal, "processo.vara": p.orgao, "processo.comarca": p.comarca, "processo.classe": p.classe,
      "processo.valor_causa": p.valor_causa_centavos == null ? "" : (p.valor_causa_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) });
    if (!opcoes.pessoaId) pessoa = db.prepare("SELECT pe.* FROM gestao_partes g JOIN gestao_pessoas pe ON pe.id=g.pessoa_id WHERE g.processo_id=? AND g.papel='autor' ORDER BY g.principal DESC LIMIT 1").get(opcoes.processoId) as Pessoa | undefined;
    contraria = (db.prepare("SELECT pe.nome FROM gestao_partes g JOIN gestao_pessoas pe ON pe.id=g.pessoa_id WHERE g.processo_id=? AND g.papel='reu' ORDER BY g.principal DESC LIMIT 1").get(opcoes.processoId) as { nome: string } | undefined)?.nome;
  }
  if (opcoes.pessoaId) {
    pessoa = db.prepare("SELECT * FROM gestao_pessoas WHERE id=?").get(opcoes.pessoaId) as Pessoa | undefined;
    if (!pessoa) throw new ErroGestao("Pessoa não encontrada.", 404);
  }
  if (pessoa) Object.assign(v, { "cliente.nome": pessoa.nome, "cliente.cpf": formatarDocumento(pessoa.documento), "cliente.rg": pessoa.rg, "cliente.estado_civil": pessoa.estado_civil, "cliente.profissao": pessoa.profissao, "cliente.endereco": enderecoDe(pessoa), "cliente.telefone": pessoa.telefone, "cliente.email": pessoa.email });
  if (contraria) v["parte_contraria.nome"] = contraria;
  const agora = new Date(Date.now() - 3 * 3600_000); // referência de Brasília
  v["data.hoje"] = `${String(agora.getUTCDate()).padStart(2, "0")}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}/${agora.getUTCFullYear()}`;
  v["data.extenso"] = `${agora.getUTCDate()} de ${MESES[agora.getUTCMonth()]} de ${agora.getUTCFullYear()}`;
  v["advogado.nome"] = advogado;
  return v;
}

/** Converte o texto simples do modelo em HTML; variáveis sem valor ficam como linha para preencher à mão. */
export function renderizarModelo(conteudo: string, ctx: Record<string, string>) {
  const faltando = new Set<string>();
  const sub = conteudo.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, chave: string) => {
    const valor = ctx[chave];
    if (valor) return valor;
    faltando.add(chave); return "________";
  });
  const html = sub.split(/\n{2,}/).map((bloco) => {
    const b = bloco.trim(); if (!b) return "";
    if (b.startsWith("# ")) return `<h2 style="text-align:center">${esc(b.slice(2))}</h2>`;
    return `<p style="text-align:justify">${esc(b).replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
  return { html, faltando: [...faltando] };
}

export function envelopeWord(titulo: string, corpo: string) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5}</style></head><body>${corpo}</body></html>`;
}

export function gerarDocumento(modeloId: number, opcoes: { pessoaId?: number; processoId?: number }, advogado: string) {
  semearSeVazio();
  const m = db.prepare("SELECT * FROM gestao_modelos WHERE id=? AND ativo=1").get(modeloId) as { nome: string; conteudo: string } | undefined;
  if (!m) throw new ErroGestao("Modelo não encontrado.", 404);
  const { html, faltando } = renderizarModelo(m.conteudo, contextoDoDocumento(opcoes, advogado));
  return { nome: m.nome, html, faltando, documento: envelopeWord(m.nome, html) };
}
