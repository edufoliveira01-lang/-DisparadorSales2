import zlib from "node:zlib";

/** Escritor mínimo de arquivos ZIP (o suficiente para um .docx), sem dependências externas. */
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ArquivoZip { nome: string; dados: Buffer }

export function criarZip(arquivos: ArquivoZip[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  // 1980-01-01 00:00 (data fixa deixa o arquivo reproduzível)
  const hora = 0, data = (0 << 9) | (1 << 5) | 1;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const comprimido = zlib.deflateRawSync(a.dados);
    const crc = crc32(a.dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(hora, 10); local.writeUInt16LE(data, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18); local.writeUInt32LE(a.dados.length, 22); local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    partes.push(local, nome, comprimido);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(hora, 12); c.writeUInt16LE(data, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comprimido.length, 20); c.writeUInt32LE(a.dados.length, 24);
    c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(deslocamento, 42);
    central.push(c, nome);
    deslocamento += local.length + nome.length + comprimido.length;
  }
  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, dir, fim]);
}

/** Lê UM arquivo de dentro de um ZIP/.docx (pelo diretório central). Limita o tamanho descompactado para não aceitar "bomba" de compressão. */
export function lerArquivoDoZip(zip: Buffer, nome: string, maximo = 8 * 1024 * 1024): Buffer | null {
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) if (zip.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  if (fim < 0) return null;
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  for (let n = 0; n < total && p + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const metodo = zip.readUInt16LE(p + 10), tamComp = zip.readUInt32LE(p + 20), tamOrig = zip.readUInt32LE(p + 24);
    const lnome = zip.readUInt16LE(p + 28), lextra = zip.readUInt16LE(p + 30), lcom = zip.readUInt16LE(p + 32), local = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + lnome) === nome) {
      if (tamOrig > maximo || local + 30 > zip.length) return null;
      const dados = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const bruto = zip.subarray(dados, dados + tamComp);
      if (metodo === 0) return bruto;
      if (metodo === 8) { try { return zlib.inflateRawSync(bruto, { maxOutputLength: maximo }); } catch { return null; } }
      return null;
    }
    p += 46 + lnome + lextra + lcom;
  }
  return null;
}
