import { ErroGestao } from "./erro";
import { lerArquivoDoZip } from "./zip";
import { VARIAVEIS_DOCUMENTO, lerConfigDocumentos, type ImagemDoDocumento } from "./documentos";

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

export interface ModeloImportado { nome: string; texto: string; avisos: string[]; imagens: ImagemDoDocumento[] }

const EMU_MM = 36000;
type Parte = { t: string; b: boolean; i: boolean; u: boolean };

/** Agrupa os trechos com a mesma formatação e escreve as marcas do sistema: **negrito**, *itálico*, ++sublinhado++. */
function comMarcas(partes: Parte[]): string {
  const grupos: Parte[] = [];
  for (const p of partes) {
    const ult = grupos[grupos.length - 1];
    if (ult && ult.b === p.b && ult.i === p.i && ult.u === p.u) ult.t += p.t; else grupos.push({ ...p });
  }
  return grupos.map((g) => {
    if (!g.t.trim() || !(g.b || g.i || g.u)) return g.t.replace(/[*]|\+\+/g, "");
    const limpo = g.t.trim().replace(/[*]|\+\+/g, ""), esq = /^\s/.test(g.t) ? " " : "", dir = /\s$/.test(g.t) ? " " : "";
    let t = limpo;
    if (g.u) t = `++${t}++`;
    if (g.i) t = `*${t}*`;
    if (g.b) t = `**${t}**`;
    return `${esq}${t}${dir}`;
  }).join("");
}

function mimeDaExtensao(alvo: string): string | null {
  const e = /\.([a-z0-9]+)$/i.exec(alvo)?.[1]?.toLowerCase();
  return e === "png" ? "image/png" : e === "jpg" || e === "jpeg" ? "image/jpeg" : e === "webp" ? "image/webp" : null;
}

export function docxParaModelo(arquivo: Buffer, nomeDoArquivo = ""): ModeloImportado {
  const xml = (() => { const d = lerArquivoDoZip(arquivo, "word/document.xml"); return d ? d.toString("utf8") : null; })();
  if (xml === null) throw new ErroGestao("Não consegui ler este arquivo. Envie um documento do Word no formato .docx (não .doc nem PDF).", 422);
  const validas = new Set<string>([...VARIAVEIS_DOCUMENTO, ...lerConfigDocumentos().campos.map((c) => `campo.${c.id}`)]);
  const avisos = new Set<string>();
  const imagens: ImagemDoDocumento[] = [];
  const alvos = new Map<string, string>();
  const rels = lerArquivoDoZip(arquivo, "word/_rels/document.xml.rels")?.toString("utf8") ?? "";
  for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(r[0])?.[1], alvo = /\bTarget="([^"]+)"/.exec(r[0])?.[1];
    if (id && alvo) alvos.set(id, alvo);
  }
  const paragrafos: string[] = [];
  let titulou = false;

  const partesDe = (p: string): { partes: Parte[]; puro: string } => {
    const partes: Parte[] = [];
    for (const r of p.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const rpr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(r[0])?.[0] ?? "";
      const b = /<w:b\/>|<w:b w:val="(?:1|true|on)"\/>/.test(rpr), i = /<w:i\/>|<w:i w:val="(?:1|true|on)"\/>/.test(rpr), u = /<w:u w:val="(?!none)\w+"/.test(rpr);
      let t = "";
      for (const e of r[0].matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) t += e[0] === "<w:tab/>" ? " " : e[0] === "<w:br/>" ? "\n" : entidades(e[1] ?? "");
      if (t) partes.push({ t, b, i, u });
    }
    return { partes, puro: partes.map((x) => x.t).join("").replace(/\s+/g, " ").trim() };
  };

  /** Figuras do parágrafo → [[imagem:N|largura|alinhamento]] (a largura vem do tamanho que a figura tinha no Word). */
  const figurasDe = (p: string, alinha: string): string[] => {
    const saida: string[] = [];
    for (const d of p.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
      const rid = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(d[0])?.[1];
      const alvo = rid ? alvos.get(rid) : undefined;
      if (!alvo) continue;
      const mime = mimeDaExtensao(alvo);
      if (!mime) { avisos.add("Uma figura em formato não suportado (como GIF, SVG ou EMF) foi ignorada. Use PNG, JPG ou WebP."); continue; }
      const dados = lerArquivoDoZip(arquivo, `word/${alvo.replace(/^\//, "").replace(/^word\//, "")}`, 4 * 1024 * 1024);
      if (!dados || dados.length > 1_500_000) { avisos.add("Uma figura grande demais (acima de 1,5 MB) foi ignorada."); continue; }
      if (imagens.length >= 8) { avisos.add("O documento aceita até 8 figuras; as demais foram ignoradas."); continue; }
      imagens.push({ mime, b64: dados.toString("base64") });
      const cx = Number(/<wp:extent\b[^>]*cx="(\d+)"/.exec(d[0])?.[1] ?? 0);
      const mm = cx > 0 ? Math.max(5, Math.min(170, Math.round(cx / EMU_MM))) : 0;
      saida.push(`[[imagem:${imagens.length}${mm ? `|${mm}` : ""}${alinha ? `|${alinha}` : ""}]]`);
    }
    return saida;
  };

  for (const m of xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const bloco = m[0];
    if (bloco.startsWith("<w:tbl>")) {
      const linhas: string[] = [];
      for (const tr of bloco.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cels = [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => [...tc[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => comMarcas(partesDe(p[0]).partes).replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").replace(/\|/g, "/"));
        if (cels.some((c) => c)) linhas.push(`| ${cels.join(" | ")} |`);
      }
      if (linhas.length) paragrafos.push(linhas.join("\n"));
      continue;
    }
    const p = bloco;
    const ppr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? "";
    const jc = /<w:jc w:val="(\w+)"/.exec(ppr)?.[1];
    const centro = jc === "center", quadro = /<w:pBdr>/.test(ppr), estiloTitulo = /<w:pStyle w:val="(?:Heading|Ttulo|Title|T[ií]tulo)/i.test(ppr), lista = /<w:numPr>/.test(ppr);
    const { partes, puro } = partesDe(p);
    const figuras = figurasDe(p, jc === "right" ? "r" : jc === "left" || !jc ? "l" : "c");
    if (puro && /^[_\s.\-–—]{4,}$/.test(puro)) { avisos.add("As linhas de assinatura e a data são colocadas pelo sistema, no padrão do escritório; as do arquivo foram ignoradas."); }
    else if (puro) {
      let texto = comMarcas(partes).replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
      const todoNegrito = partes.every((x) => x.b || !x.t.trim());
      if ((centro && todoNegrito && puro.length <= 90 && !titulou) || (estiloTitulo && puro.length <= 90)) { paragrafos.push(`# ${puro}`); titulou = true; }
      else {
        if (centro && todoNegrito && puro.length <= 90) texto = `**${puro}**`;
        if (lista && !/^[•\-–\d]/.test(puro)) texto = `• ${texto}`;
        paragrafos.push(quadro ? `> ${texto}` : texto);
      }
    }
    paragrafos.push(...figuras);
  }
  if (paragrafos.length === 0) throw new ErroGestao("O arquivo não tem texto para importar.", 422);

  // campos do modelo → variáveis do sistema
  const trocar = (rotulo: string, original: string) => {
    const chave = semAcento(rotulo);
    if (validas.has(rotulo.trim())) return `{{${rotulo.trim()}}}`;
    const alvo = SINONIMOS[chave];
    if (alvo) return `{{${alvo}}}`;
    avisos.add(`Campo “${rotulo.trim()}” não é um dado que o sistema conhece. Foi mantido como está — troque por uma variável ou escreva o valor.`);
    return original;
  };
  const campos = (t: string) => t
    .replace(/\{\{\s*([^{}]{1,60}?)\s*\}\}/g, (o, r: string) => trocar(r, o))
    .replace(/\[\s*([^\]\[]{2,60}?)\s*\]/g, (o, r: string) => (/[a-zA-ZÀ-ÿ]/.test(r) ? trocar(r, o) : o))
    .replace(/(?:<<|«)\s*([^<>»]{2,60}?)\s*(?:>>|»)/g, (o, r: string) => trocar(r, o))
    .replace(/#([A-ZÀ-Ý][A-ZÀ-Ý _]{1,40})#/g, (o, r: string) => trocar(r, o));
  let texto = paragrafos.map((p) => (/^\[\[imagem:/.test(p) ? p : campos(p))).join("\n\n");
  texto = texto.replace(/\*\*\s*\*\*/g, "").slice(0, 20000);
  if (imagens.length) avisos.add(`${imagens.length} figura(s) importada(s): aparecem no texto como [[imagem:1]] etc. Mova ou apague essa linha para mudar o lugar da figura.`);
  if (!/\{\{/.test(texto)) avisos.add("Nenhum campo do cliente foi reconhecido. Para o documento sair com os dados de cada cliente, use no texto variáveis como {{cliente.nome}} ou {{outorgante.qualificacao}} (a lista aparece em “Como escrever”).");
  const titulo = /^# (.+)$/m.exec(texto)?.[1]?.trim() ?? "";
  const nome = (titulo || nomeDoArquivo.replace(/\.docx$/i, "").replace(/[_-]+/g, " ")).trim().slice(0, 80);
  return { nome, texto, avisos: [...avisos], imagens };
}
