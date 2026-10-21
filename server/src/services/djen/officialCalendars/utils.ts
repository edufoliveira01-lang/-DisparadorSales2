import crypto from "node:crypto";
import { dataValida, somarDias } from "../api";
import { textoDaPublicacao } from "../classifier";
import {
  FonteCalendarioError,
  type EventoForense,
  type TipoEventoForense,
  type LerFonteOficial,
} from "./types";
export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export const meses: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};
export const chaveEscopo = (tribunal: string, orgao: string, ano: number) =>
  crypto
    .createHash("sha256")
    .update(`${tribunal}:${norm(orgao)}:${ano}`)
    .digest("hex");
export function evento(
  tipo: TipoEventoForense,
  inicio: string,
  fim: string,
  descricao: string,
  fonte: string,
): EventoForense {
  if (
    !dataValida(inicio) ||
    !dataValida(fim) ||
    inicio > fim ||
    Date.parse(fim) - Date.parse(inicio) > 370 * 86400000
  )
    throw new FonteCalendarioError(
      "A fonte devolveu uma data ou intervalo inválido. A importação anterior foi preservada.",
    );
  const id = crypto
    .createHash("sha256")
    .update(`${tipo}:${inicio}:${fim}:${norm(descricao)}`)
    .digest("hex")
    .slice(0, 32);
  return {
    id,
    tipo,
    inicio,
    fim,
    descricao: descricao.replace(/\s+/g, " ").trim().slice(0, 2000),
    fonte,
  };
}
export const unicos = (items: EventoForense[]) =>
  [...new Map(items.map((e) => [e.id, e])).values()].sort(
    (a, b) => a.inicio.localeCompare(b.inicio) || a.id.localeCompare(b.id),
  );
export function diasIntervalo(inicio: string, fim: string) {
  const arr: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) {
    if (arr.length > 370)
      throw new FonteCalendarioError("Intervalo excessivo no calendário.");
    arr.push(d);
  }
  return arr;
}
export function dataBr(s: string) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m)
    throw new FonteCalendarioError(
      "Formato de data inesperado na fonte oficial.",
    );
  const d = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (!dataValida(d))
    throw new FonteCalendarioError("Data inválida na fonte oficial.");
  return d;
}
export function dataDia(ano: number, mes: number, dia: number) {
  const d = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (!dataValida(d))
    throw new FonteCalendarioError("Data inválida na fonte oficial.");
  return d;
}
/** Remove datas revogadas, inclusive classes de CSS usadas no texto consolidado dos atos do TRF3. */
export function limparHtml(html: string) {
  const classes = [
    ...html.matchAll(
      /\.([\w-]+)\s*\{([^}]*text-decoration\s*:\s*line-through[^}]*)\}/gi,
    ),
  ].map((m) => m[1]);
  let s = html.replace(
    /<(?:del|s|strike)\b[^>]*>[\s\S]*?<\/(?:del|s|strike)>/gi,
    "",
  );
  // Procura apenas a abertura do próprio elemento riscado: um ancestral com
  // class/style não pode consumir o conteúdo antes de encontrarmos seus filhos.
  const aberturas = [...s.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].filter(
    (m) => {
      const attrs = m[2],
        c = /class\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1].split(/\s+/) || [];
      return (
        /style\s*=\s*["'][^"']*text-decoration\s*:\s*line-through/i.test(
          attrs,
        ) || c.some((x) => classes.includes(x))
      );
    },
  );
  for (const m of aberturas.reverse()) {
    const inicio = m.index!,
      resto = s.slice(inicio + m[0].length),
      fim = new RegExp(`</${m[1]}\\s*>`, "i").exec(resto);
    if (fim) s = s.slice(0, inicio) + resto.slice(fim.index + fim[0].length);
  }

  return s;
}
export const texto = (s: string) =>
  textoDaPublicacao(s)
    .replace(/&(?:ordm|ordf);/g, "º")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
export function linhasTabela(html: string): string[][] {
  const s = limparHtml(html);
  return [...s.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      texto(c[1]),
    ),
  );
}
export function links(html: string, base: string) {
  return [
    ...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  ].map((m) => ({
    url: new URL(m[1].replace(/&amp;/g, "&"), base).href,
    texto: texto(m[2]),
  }));
}
/** Listas/ranges de dias, tais como "1º a 6" e "16 e 17". */
export function diasDoMes(s: string, ano: number, mes: number): string[] {
  const clean = s.toLowerCase().replace(/[ºª.]/g, "").trim();
  if (!/^\d{1,2}(?:\s*(?:a|e|,|-)\s*\d{1,2})*$/.test(clean))
    throw new FonteCalendarioError(`Expressão de dias não reconhecida: ${s}`);
  const numeros = clean.match(/\d+/g)!.map(Number);
  if (/\ba\b|-/.test(clean)) {
    if (numeros.length !== 2 || numeros[0] > numeros[1])
      throw new FonteCalendarioError("Intervalo de dias não reconhecido.");
    return diasIntervalo(
      dataDia(ano, mes, numeros[0]),
      dataDia(ano, mes, numeros[1]),
    );
  }
  return numeros.map((d) => dataDia(ano, mes, d));
}
export function datasPorExtenso(s: string, ano: number): string[] {
  const clean = norm(s),
    out: string[] = [];
  const re = new RegExp(
    `(\\d{1,2}(?:\\s*(?:e|a)\\s*\\d{1,2})*)\\s*(?:o\\s+)?de\\s+(${Object.keys(meses).join("|")})`,
    "g",
  );
  for (const m of clean.matchAll(re))
    out.push(...diasDoMes(m[1], ano, meses[m[2]]));
  for (const m of s.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g))
    if (Number(m[3]) === ano)
      out.push(dataDia(ano, Number(m[2]), Number(m[1])));
  return [...new Set(out)];
}
export function escolherLocalidade(
  orgao: string,
  cidades: string[],
  preferida?: string,
) {
  const target = norm(preferida || orgao),
    candidatas = [...new Set(cidades)]
      .filter((c) => ` ${target} `.includes(` ${norm(c)} `))
      .sort((a, b) => b.length - a.length);
  if (preferida) {
    const exato = candidatas.find((c) => norm(c) === norm(preferida));
    if (exato) return exato;
    throw new FonteCalendarioError(
      "O município informado não consta da tabela oficial desta seção. Confira cidade e UF.",
      "localidade_pendente",
    );
  }

  const maiores = candidatas.filter(
    (c) => !candidatas.some((o) => o !== c && norm(o).includes(norm(c))),
  );
  if (maiores.length === 1) return maiores[0];
  throw new FonteCalendarioError(
    maiores.length
      ? "Há mais de uma localidade possível para este órgão. Informe a cidade nas configurações."
      : "Não foi possível identificar a cidade do órgão. Informe a localidade uma vez nas configurações; a importação continuará automática.",
    "localidade_pendente",
  );
}

const HOSTS = new Set([
  "www.tjsp.jus.br",
  "www.trf4.jus.br",
  "www.trf3.jus.br",
  "web.trf3.jus.br",
  "www.jfsp.jus.br",
  "www.jfms.jus.br",
  "www.tjdft.jus.br",
]);
const cache = new Map<string, { ate: number; conteudo: string }>(),
  pendentes = new Map<string, Promise<string>>();
export function limparCacheFontes() {
  cache.clear();
}
/** Fontes fixas oficiais. Não aceita destino arbitrário nem segue redirecionamentos fora da lista. */
export const lerFonteOficial: LerFonteOficial = async (url, init) => {
  const chave = `${init?.method || "GET"}:${url}:${init?.body || ""}`,
    salvo = cache.get(chave);
  if (salvo && salvo.ate > Date.now()) return salvo.conteudo;
  if (pendentes.has(chave)) return pendentes.get(chave)!;
  const job = (async () => {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      let destino = url;
      for (let salto = 0; salto < 4; salto++) {
        const u = new URL(destino);
        if (
          u.protocol !== "https:" ||
          !HOSTS.has(u.hostname) ||
          u.username ||
          u.password
        )
          throw new FonteCalendarioError(
            "Destino não autorizado na fonte oficial.",
          );
        const res = await fetch(u, {
          method: init?.method || "GET",
          body: init?.body,
          headers: {
            Accept: "application/json,text/html",
            "User-Agent": "DisparadorSales2/2.39 calendario-oficial",
            ...(init?.body
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
          },
          signal: controller.signal,
          redirect: "manual",
        });
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const destinoNovo = res.headers.get("location");
          await res.body?.cancel();
          if (!destinoNovo)
            throw new FonteCalendarioError(
              "Redirecionamento inválido na fonte.",
            );
          destino = new URL(destinoNovo, u).href;
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          throw new FonteCalendarioError(
            `Fonte oficial indisponível (HTTP ${res.status}). O calendário anterior e os ajustes manuais foram preservados.`,
          );
        }
        const partes: Uint8Array[] = [];
        let tamanho = 0;
        if (!res.body) throw new FonteCalendarioError("Fonte sem conteúdo.");
        for await (const parte of res.body) {
          tamanho += parte.length;
          if (tamanho > 2_000_000) {
            controller.abort();
            throw new FonteCalendarioError(
              "Fonte oficial maior que o limite de leitura.",
            );
          }
          partes.push(parte);
        }
        const buffer = Buffer.concat(partes),
          meta = buffer.subarray(0, 3000).toString("ascii"),
          latin =
            /charset\s*=\s*["']?(?:iso-8859-1|windows-1252)/i.test(
              res.headers.get("content-type") || "",
            ) || /charset\s*=\s*["']?(?:iso-8859-1|windows-1252)/i.test(meta);
        const conteudo = new TextDecoder(
          latin ? "windows-1252" : "utf-8",
        ).decode(buffer);
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
        cache.set(chave, { ate: Date.now() + 10 * 60000, conteudo });
        return conteudo;
      }
      throw new FonteCalendarioError(
        "Redirecionamentos excessivos na fonte oficial.",
      );
    } catch (e) {
      if (e instanceof FonteCalendarioError) throw e;
      throw new FonteCalendarioError(
        controller.signal.aborted
          ? "A fonte oficial excedeu o tempo de resposta. Tente atualizar novamente ou use o ajuste manual."
          : "Não foi possível ler a fonte oficial. Tente atualizar novamente ou use o ajuste manual.",
      );
    } finally {
      clearTimeout(timer);
    }
  })();
  pendentes.set(chave, job);
  try {
    return await job;
  } finally {
    pendentes.delete(chave);
  }
};
