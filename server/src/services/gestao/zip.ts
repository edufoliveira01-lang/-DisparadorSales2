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
