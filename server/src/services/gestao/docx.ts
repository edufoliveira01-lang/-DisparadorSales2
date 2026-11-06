import { criarZip, type ArquivoZip } from "./zip";
import type { Alinhamento, Bloco, Kit, Trecho } from "./documentos";

/** Gera um .docx de verdade (cabeçalho com logotipo e rodapé do escritório em todas as páginas), sem bibliotecas externas. */
const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const JC: Record<Alinhamento, string> = { j: "both", c: "center", r: "right", l: "left" };

export function dimensoesDaImagem(d: Buffer): { w: number; h: number } | null {
  if (d.length > 24 && d.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) };
  if (d.length > 4 && d[0] === 0xff && d[1] === 0xd8) {
    let i = 2;
    while (i + 9 < d.length) {
      if (d[i] !== 0xff) { i++; continue; }
      const m = d[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: d.readUInt16BE(i + 5), w: d.readUInt16BE(i + 7) };
      i += 2 + d.readUInt16BE(i + 2);
    }
    return null;
  }
  if (d.length > 30 && d.toString("ascii", 0, 4) === "RIFF" && d.toString("ascii", 8, 12) === "WEBP") {
    const t = d.toString("ascii", 12, 16);
    if (t === "VP8X") return { w: 1 + d.readUIntLE(24, 3), h: 1 + d.readUIntLE(27, 3) };
    if (t === "VP8 ") return { w: d.readUInt16LE(26) & 0x3fff, h: d.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") { const b = d.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
  }
  return null;
}

const run = (t: Trecho, pt: number, extra = "") =>
  t.t.split("\n").map((linha, i) => `${i ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${t.b ? "<w:b/>" : ""}${t.i ? "<w:i/>" : ""}${t.u ? '<w:u w:val="single"/>' : ""}${extra}<w:sz w:val="${Math.round(pt * 2)}"/></w:rPr><w:t xml:space="preserve">${x(linha)}</w:t></w:r>`).join("");
const par = (conteudo: string, o: { jc?: string; depois?: number; antes?: number; quebra?: boolean; borda?: string; manter?: boolean } = {}) =>
  `<w:p><w:pPr>${o.manter ? "<w:keepNext/>" : ""}${o.quebra ? "<w:pageBreakBefore/>" : ""}${o.borda ?? ""}<w:spacing w:before="${o.antes ?? 0}" w:after="${o.depois ?? 120}" w:line="252" w:lineRule="auto"/><w:jc w:val="${o.jc ?? "left"}"/></w:pPr>${conteudo}</w:p>`;
const vazio = (pt = 10, quebra = false) => par(`<w:r><w:rPr><w:sz w:val="${Math.round(pt * 2)}"/></w:rPr><w:t></w:t></w:r>`, { quebra, depois: 0 });
const bordas = (lados: string[], sz = 6) => `<w:tcBorders>${["top", "left", "bottom", "right"].map((l) => `<w:${l} w:val="${lados.includes(l) ? "single" : "nil"}" w:sz="${sz}" w:space="0" w:color="000000"/>`).join("")}</w:tcBorders>`;
const tabela = (largs: number[], linhas: string[], fixo = true) => `<w:tbl><w:tblPr><w:tblW w:w="${largs.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${fixo ? '<w:tblLayout w:type="fixed"/>' : ""}<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${largs.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${linhas.join("")}</w:tbl>`;
const celula = (w: number, conteudo: string, o: { lados?: string[]; span?: number; vmerge?: "restart" | "cont"; valign?: string } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}${o.vmerge ? `<w:vMerge${o.vmerge === "restart" ? ' w:val="restart"' : ""}/>` : ""}${bordas(o.lados ?? [])}${o.valign ? `<w:vAlign w:val="${o.valign}"/>` : ""}</w:tcPr>${conteudo || vazio(8)}</w:tc>`;
const linhaAssinar = (pt: number) => par(`<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${Math.round(pt * 2)}"/></w:rPr><w:t>____________________________________________________</w:t></w:r>`, { depois: 0 });
const negrito = (t: string, pt: number, jc = "left") => par(run({ t, b: true }, pt), { jc, depois: 0 });
const simples = (t: string, pt: number, jc = "left") => par(run({ t }, pt), { jc, depois: 0 });
const TOTAL = 9638; // largura útil (A4 com margens de 2 cm) em twips

/** Imagens do corpo dos documentos (documentos próprios com figura), reunidas durante a montagem para entrarem no .docx. */
let imagensDoCorpo: { rid: string; dados: Buffer; mime: string }[] = [];
const EMU_MM = 36000;

function bloco(b: Bloco, primeiro: boolean): string {
  const quebra = primeiro;
  switch (b.k) {
    case "titulo": return par(run({ t: b.texto, b: true }, b.pt, b.sublinhado ? '<w:u w:val="single"/>' : ""), { jc: "center", depois: 200, antes: 60, quebra });
    case "p": return par(b.trechos.map((t) => run(t, b.pt)).join(""), { jc: JC[b.align], quebra });
    case "caixa": return tabela([TOTAL], [`<w:tr>${celula(TOTAL, par(b.trechos.map((t) => run(t, b.pt)).join(""), { jc: JC[b.align], depois: 60, quebra }), { lados: ["top", "left", "bottom", "right"] })}</w:tr>`]) + vazio(4);
    case "fim": return "";
    case "tabela": {
      const n = Math.max(1, ...b.linhas.map((l) => l.length)), w = Array.from({ length: n }, () => Math.floor(TOTAL / n));
      return tabela(w, b.linhas.map((l) => `<w:tr>${Array.from({ length: n }, (_v, i) => celula(w[i]!, par((l[i] ?? []).map((t) => run(t, b.pt)).join(""), { depois: 0 }), { lados: ["top", "left", "bottom", "right"] })).join("")}</w:tr>`)) + vazio(4);
    }
    case "imagem": {
      const id = imagensDoCorpo.length + 10, rid = `rIdImg${imagensDoCorpo.length + 1}`;
      imagensDoCorpo.push({ rid, dados: b.dados, mime: b.mime });
      const w = Math.round(b.w * EMU_MM), h = Math.round(b.h * EMU_MM);
      return par(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="Imagem ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { jc: b.align === "c" ? "center" : b.align === "r" ? "right" : "left", quebra });
    }
    case "vazio": return Array.from({ length: b.n }, () => vazio(10)).join("");
    case "assinatura": return linhaAssinar(b.pt) + negrito(b.nome, b.pt) + b.extra.map((e) => simples(e, b.pt)).join("");
    case "rogo": {
      const w = [3500, 3500, 2638];
      const juntar = (xml: string) => xml.replace(/<w:pPr>/g, "<w:pPr><w:keepNext/>"); // a assinatura não se separa das testemunhas
      const esquerda = juntar(linhaAssinar(b.pt) + negrito(b.assina, b.pt) + b.extra.map((e) => simples(e, b.pt)).join("") + simples("TESTEMUNHAS A ROGO:", b.pt));
      const t = (i: number) => (b.testemunhas[i] ? linhaAssinar(b.pt) + negrito(b.testemunhas[i].nome || " ", b.pt) + simples(`CPF: ${b.testemunhas[i].cpf}`, b.pt) : vazio(8));
      return tabela(w, [
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${celula(w[0] + w[1], esquerda, { span: 2 })}${celula(w[2], vazio(8), { vmerge: "restart", lados: ["top", "left", "bottom", "right"], valign: "bottom" }).replace(vazio(8), par(run({ t: b.polegar, b: true }, 9), { jc: "center", depois: 0, manter: true }))}</w:tr>`,
        `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="1500" w:hRule="atLeast"/></w:trPr>${celula(w[0], vazio(10) + t(0), { valign: "bottom" })}${celula(w[1], vazio(10) + t(1), { valign: "bottom" })}${celula(w[2], vazio(8), { vmerge: "cont", lados: ["left", "bottom", "right"] })}</w:tr>`,
      ]);
    }
    case "testemunhas": {
      const w = [TOTAL / 2, TOTAL / 2].map(Math.floor);
      return tabela(w, [`<w:tr>${b.itens.map((t, i) => celula(w[i] ?? w[0], par(run({ t: `Testemunha ${i + 1}: ` }, b.pt) + run({ t: t.nome, b: true }, b.pt), { depois: 0 }) + simples(`CPF: ${t.cpf}`, b.pt))).join("")}</w:tr>`]);
    }
  }
}

export function kitDocx(kit: Kit): Buffer {
  imagensDoCorpo = [];
  const corpo = kit.documentos.map((d, i) => d.blocos.map((b, j) => bloco(b, i > 0 && j === 0)).join("")).join("");
  const ext = (m: string) => (m === "image/png" ? "png" : m === "image/webp" ? "webp" : "jpeg");
  const JCA = { left: "left", center: "center", right: "right" } as const;
  /** Parágrafo com a imagem em linha; altura-alvo em EMU e largura limitada à área útil (17 cm). */
  const figura = (img: { dados: Buffer; mime: string }, rid: string, id: number, alturaEmu: number, align: string) => {
    const dim = dimensoesDaImagem(img.dados);
    const max = 6120000;
    let h = dim ? Math.min(alturaEmu, dim.h * 9525) : alturaEmu; // nunca amplia além do tamanho natural (96 dpi)
    let w = dim ? Math.round((dim.w / dim.h) * h) : 2160000;
    if (w > max) { h = Math.round(h * (max / w)); w = max; }
    return par(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/><wp:docPr id="${id}" name="Imagem ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`, { jc: align, depois: 120 });
  };
  const cabecalho = kit.logo ? figura(kit.logo, "rIdLogo", 1, 648000, JCA[kit.alinhaCabecalho]) : par(run({ t: kit.nomeExibicao, b: true }, 16), { jc: JCA[kit.alinhaCabecalho], depois: 120 });
  const linhasRodape = kit.rodape.map((l, i) => par(run({ t: l, b: true }, 8), { jc: JCA[kit.alinhaRodape], depois: 0, borda: i === 0 && !kit.rodapeImagem ? '<w:pBdr><w:top w:val="single" w:sz="12" w:space="4" w:color="333333"/></w:pBdr>' : "" })).join("");
  const rodape = kit.rodapeImagem || kit.rodape.length
    ? (kit.rodapeImagem ? par(`<w:r><w:t></w:t></w:r>`, { depois: 0, borda: '<w:pBdr><w:top w:val="single" w:sz="12" w:space="4" w:color="333333"/></w:pBdr>' }) + figura(kit.rodapeImagem, "rIdRodape", 2, 432000, JCA[kit.alinhaRodape]) : "") + linhasRodape
    : vazio(8);
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const documento = `${xml}<w:document ${ns}><w:body>${corpo}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1900" w:right="1134" w:bottom="1400" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const arquivos: ArquivoZip[] = [
    { nome: "[Content_Types].xml", dados: Buffer.from(`${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="webp" ContentType="image/webp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`) },
    { nome: "_rels/.rels", dados: Buffer.from(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { nome: "word/_rels/document.xml.rels", dados: Buffer.from(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`) },
    { nome: "word/styles.xml", dados: Buffer.from(`${xml}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`) },
    { nome: "word/document.xml", dados: Buffer.from(documento) },
    { nome: "word/header1.xml", dados: Buffer.from(`${xml}<w:hdr ${ns}>${cabecalho}</w:hdr>`) },
    { nome: "word/footer1.xml", dados: Buffer.from(`${xml}<w:ftr ${ns}>${rodape}</w:ftr>`) },
  ];
  const rel = (id: string, alvo: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${alvo}"/>`;
  if (kit.logo) {
    arquivos.push({ nome: `word/media/logo.${ext(kit.logo.mime)}`, dados: kit.logo.dados });
    arquivos.push({ nome: "word/_rels/header1.xml.rels", dados: Buffer.from(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rIdLogo", `logo.${ext(kit.logo.mime)}`)}</Relationships>`) });
  }
  if (kit.rodapeImagem) {
    arquivos.push({ nome: `word/media/rodape.${ext(kit.rodapeImagem.mime)}`, dados: kit.rodapeImagem.dados });
    arquivos.push({ nome: "word/_rels/footer1.xml.rels", dados: Buffer.from(`${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rIdRodape", `rodape.${ext(kit.rodapeImagem.mime)}`)}</Relationships>`) });
  }
  if (imagensDoCorpo.length) {
    imagensDoCorpo.forEach((im, i) => arquivos.push({ nome: `word/media/corpo${i + 1}.${ext(im.mime)}`, dados: im.dados }));
    const r = arquivos.find((f) => f.nome === "word/_rels/document.xml.rels")!;
    r.dados = Buffer.from(r.dados.toString("utf8").replace("</Relationships>", `${imagensDoCorpo.map((im, i) => rel(im.rid, `corpo${i + 1}.${ext(im.mime)}`)).join("")}</Relationships>`));
  }
  return criarZip(arquivos);
}
