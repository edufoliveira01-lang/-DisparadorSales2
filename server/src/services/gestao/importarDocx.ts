import { ErroGestao } from "./erro";
import { lerArquivoDoZip } from "./zip";
import { VARIAVEIS_DOCUMENTO, lerConfigDocumentos } from "./documentos";

/**
 * Importa um documento .docx do escritório como MODELO: lê os parágrafos (título, negrito, alinhamento, quadros) e devolve o texto no formato
 * do sistema, trocando os campos do modelo ([NOME], {{CPF}}, <<ENDEREÇO>>…) pelas variáveis que o sistema preenche. O visual (cabeçalho, rodapé,
 * assinatura, margens) continua sendo o do escritório. Não grava nada: o usuário confere e salva.
 */
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const SINONIMOS: Record<string, string> = {
  nome: "cliente.nome", nome_do_cliente: "cliente.nome", nome_completo: "cliente.nome", cliente: "cliente.nome", outorgante: "cliente.nome", contratante: "cliente.nome", autor: "cliente.nome",
  cpf: "cliente.cpf", cpf_do_cliente: "cliente.cpf", rg: "cliente.rg", estado_civil: "cliente.estado_civil", profissao: "cliente.profissao",
  endereco: "cliente.endereco", endereco_completo: "cliente.endereco", qualificacao: "outorgante.qualificacao", qualificacao_do_cliente: "outorgante.qualificacao", dados_do_cliente: "outorgante.qualificacao", qualificacao_completa: "outorgante.qualificacao",
  data: "data.extenso", data_por_extenso: "data.extenso", data_atual: "data.extenso", local_e_data: "data.local", cidade: "escritorio.cidade", foro: "escritorio.foro",
  processo: "processo.numero", numero_do_processo: "processo.numero", n_do_processo: "processo.numero",
  advogado: "advogado_principal.nome", nome_do_advogado: "advogado_principal.nome", oab: "advogado_principal.oab", cpf_do_advogado: "advogado_principal.cpf",
  escritorio: "escritorio.nome", nome_do_escritorio: "escritorio.nome", razao_social: "escritorio.razao_social", cnpj: "escritorio.cnpj", endereco_do_escritorio: "escritorio.endereco",
};

const entidades = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

export interface ModeloImportado { nome: string; texto: string; avisos: string[] }

export function docxParaModelo(arquivo: Buffer, nomeDoArquivo = ""): ModeloImportado {
  const xml = (() => { const d = lerArquivoDoZip(arquivo, "word/document.xml"); return d ? d.toString("utf8") : null; })();
  if (xml === null) throw new ErroGestao("Não consegui ler este arquivo. Envie um documento do Word no formato .docx (não .doc nem PDF).", 422);
  const validas = new Set<string>([...VARIAVEIS_DOCUMENTO, ...lerConfigDocumentos().campos.map((c) => `campo.${c.id}`)]);
  const avisos = new Set<string>();
  const paragrafos: string[] = [];
  let achouTabela = false;
  let titulou = false;
  if (/<w:tbl[ >]/.test(xml)) achouTabela = true;

  for (const m of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const ppr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? "";
    const jc = /<w:jc w:val="(\w+)"/.exec(ppr)?.[1];
    const centro = jc === "center", quadro = /<w:pBdr>/.test(ppr), estiloTitulo = /<w:pStyle w:val="(?:Heading|Ttulo|Title|T[ií]tulo)/i.test(ppr), lista = /<w:numPr>/.test(ppr);
    const partes: { t: string; b: boolean }[] = [];
    for (const r of p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const rpr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r[0])?.[0] ?? "";
      const b = /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/.test(rpr);
      let t = "";
      for (const e of r[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += e[0] === "<w:tab/>" ? " " : e[0] === "<w:br/>" ? "\n" : entidades(e[1] ?? "");
      if (t) partes.push({ t, b });
    }
    const puro = partes.map((x) => x.t).join("").replace(/\s+/g, " ").trim();
    if (!puro) continue;
    if (/^[_\s.\-–—]{4,}$/.test(puro)) { avisos.add("As linhas de assinatura e a data são colocadas pelo sistema, no padrão do escritório; as do arquivo foram ignoradas."); continue; }
    let texto = partes.map((x) => (x.b && x.t.trim() ? `**${x.t.trim()}** ` : x.t)).join("").replace(/\*\* \*\*/g, " ").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
    const todoNegrito = partes.every((x) => x.b || !x.t.trim());
    if ((centro && todoNegrito && puro.length <= 90 && !titulou) || (estiloTitulo && puro.length <= 90)) { paragrafos.push(`# ${puro}`); titulou = true; continue; }
    if (centro && todoNegrito && puro.length <= 90) texto = `**${puro}**`;
    if (lista && !/^[•\-–\d]/.test(puro)) texto = `• ${texto}`;
    paragrafos.push(quadro ? `> ${texto}` : texto);
  }
  if (paragrafos.length === 0) throw new ErroGestao("O arquivo não tem texto para importar.", 422);
  if (achouTabela) avisos.add("O arquivo tem tabelas: o texto delas foi importado como parágrafos. Confira a ordem.");

  // campos do modelo → variáveis do sistema
  const trocar = (rotulo: string, original: string) => {
    const chave = semAcento(rotulo);
    if (validas.has(rotulo.trim())) return `{{${rotulo.trim()}}}`;
    const alvo = SINONIMOS[chave];
    if (alvo) return `{{${alvo}}}`;
    avisos.add(`Campo “${rotulo.trim()}” não é um dado que o sistema conhece. Foi mantido como está — troque por uma variável ou escreva o valor.`);
    return original;
  };
  let texto = paragrafos.join("\n\n")
    .replace(/\{\{\s*([^{}]{1,60}?)\s*\}\}/g, (o, r: string) => trocar(r, o))
    .replace(/\[\s*([^\]\[]{2,60}?)\s*\]/g, (o, r: string) => (/[a-zA-ZÀ-ÿ]/.test(r) ? trocar(r, o) : o))
    .replace(/(?:<<|«)\s*([^<>»]{2,60}?)\s*(?:>>|»)/g, (o, r: string) => trocar(r, o))
    .replace(/#([A-ZÀ-Ý][A-ZÀ-Ý _]{1,40})#/g, (o, r: string) => trocar(r, o));
  texto = texto.replace(/\*\*\s*\*\*/g, "").slice(0, 20000);
  if (!/\{\{/.test(texto)) avisos.add("Nenhum campo do cliente foi reconhecido. Para o documento sair com os dados de cada cliente, use no texto variáveis como {{cliente.nome}} ou {{outorgante.qualificacao}} (a lista aparece em “Como escrever”).");
  const titulo = /^# (.+)$/m.exec(texto)?.[1]?.trim() ?? "";
  const nome = (titulo || nomeDoArquivo.replace(/\.docx$/i, "").replace(/[_-]+/g, " ")).trim().slice(0, 80);
  return { nome, texto, avisos: [...avisos] };
}
