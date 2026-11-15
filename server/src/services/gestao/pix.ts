/**
 * O código PIX «copia e cola» (BR Code) do Asaas.
 *
 * O nome do recebedor e a cidade vêm com espaços («Eduardo Freitas Oliveira»), e os apps de mensagem quebram o código nesses espaços: tocar duas vezes
 * seleciona só uma palavra. Aqui o código vira uma palavra só SEM deixar de ser válido (o tamanho de cada campo e o CRC são refeitos).
 */

/** CRC16 (CCITT-FALSE) do BR Code do PIX. */
export function crc16(txt: string): string {
  let crc = 0xffff;
  for (let i = 0; i < txt.length; i++) { crc ^= txt.charCodeAt(i) << 8; for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
/**
 * O PIX copia e cola traz o nome do recebedor e a cidade com espaços («Eduardo Freitas Oliveira»), e os apps de mensagem quebram o código nesses espaços.
 * Remove os espaços desses dois campos, refaz os tamanhos e o CRC: o código continua válido e vira uma palavra só. Se algo não conferir, devolve o original.
 */
export function pixSemEspacos(payload: string): string {
  const p = payload.trim();
  const m = /6304([0-9A-F]{4})$/i.exec(p);
  if (!m || crc16(p.slice(0, -4)) !== m[1]!.toUpperCase()) return p;
  const campos: [string, string][] = [];
  let i = 0; const corpo = p.slice(0, -8);
  while (i < corpo.length) {
    const tag = corpo.slice(i, i + 2), n = Number(corpo.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(n) || i + 4 + n > corpo.length) return p;
    campos.push([tag, corpo.slice(i + 4, i + 4 + n)]); i += 4 + n;
  }
  const novo = campos.map(([t, v]) => { const x = t === "59" || t === "60" ? v.replace(/\s+/g, "") : v; return `${t}${String(x.length).padStart(2, "0")}${x}`; }).join("") + "6304";
  return novo + crc16(novo);
}
