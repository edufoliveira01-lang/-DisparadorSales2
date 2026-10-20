import { textoDaPublicacao, normalizarTexto } from "./classifier";

export const DJEN_API = "https://comunicaapi.pje.jus.br/api/v1";
export interface AdvogadoDjen {
  id: number;
  nome: string;
  numero_oab: string;
  uf_oab: string;
  modo_busca: "ambos" | "oab" | "nome";
  ativo: number;
  cursor_data: string | null;
  ultimo_sucesso_em: string | null;
  ultimo_erro: string | null;
}
export interface PublicacaoDjen {
  comunicacao_id: string;
  hash: string;
  processo: string;
  data: string;
  tribunal: string;
  orgao: string;
  classe: string;
  tipo_documento: string;
  tipo_comunicacao: string;
  texto: string;
  link: string | null;
  cancelada: boolean;
  destinatarios: { nome: string; polo: string }[];
  advogados: { nome: string; numero_oab: string; uf_oab: string }[];
}
export class DjenApiError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
const str = (value: unknown): string =>
  typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
export const normalizarOab = (numero: string) =>
  numero
    .toUpperCase()
    .replace(/[^\dA-Z]/g, "")
    .replace(/^0+(?=\d)/, "");
export function dataValida(data: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(data) &&
    Number.isFinite(Date.parse(data)) &&
    new Date(data).toISOString().slice(0, 10) === data
  );
}
export function somarDias(data: string, dias: number): string {
  return new Date(Date.parse(data + "T12:00:00Z") + dias * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function hojeDjen(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}
export function linkSeguro(value: unknown): string | null {
  try {
    const u = new URL(str(value));
    return u.protocol === "https:" && u.hostname.endsWith(".jus.br")
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
export function normalizarPublicacao(raw: unknown): PublicacaoDjen {
  const p = obj(raw),
    id = str(p.id),
    texto = textoDaPublicacao(str(p.texto));
  let data = str(
    p.data_disponibilizacao || p.dataDisponibilizacao || p.datadisponibilizacao,
  ).slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(data))
    data = data.split("/").reverse().join("-");
  if (!id || !texto || !dataValida(data))
    throw new DjenApiError(
      "O DJEN devolveu uma publicação sem identificação, data ou texto válido. A consulta não foi marcada como concluída.",
    );
  const advogados = (
    Array.isArray(p.destinatarioadvogados) ? p.destinatarioadvogados : []
  ).map((value) => {
    const item = obj(value),
      a = obj(item.advogado || item);
    return {
      nome: str(a.nome),
      numero_oab: str(a.numero_oab || a.numeroOab),
      uf_oab: str(a.uf_oab || a.ufOab).toUpperCase(),
    };
  });
  return {
    comunicacao_id: id,
    hash: str(p.hash),
    processo: str(
      p.numeroprocessocommascara || p.numero_processo || p.numeroProcesso,
    ).replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6"),
    data,
    tribunal: str(p.siglaTribunal || p.sigla_tribunal),
    orgao: str(p.nomeOrgao || p.nome_orgao),
    classe: str(p.nomeClasse || p.classe),
    tipo_documento: str(p.tipoDocumento || p.tipo_documento),
    tipo_comunicacao: str(p.tipoComunicacao || p.tipo_comunicacao),
    texto,
    link: linkSeguro(p.link),
    cancelada: p.ativo === false || p.ativo === 0 || p.status === "CANCELADA",
    destinatarios: (Array.isArray(p.destinatarios) ? p.destinatarios : [])
      .map((value) => {
        const d = obj(value);
        return { nome: str(d.nome), polo: str(d.polo) };
      })
      .filter((d) => d.nome),
    advogados,
  };
}
export function correspondenciaAdvogado(
  p: PublicacaoDjen,
  a: AdvogadoDjen,
  modo: "nome" | "oab",
): "oab" | "consulta_oab" | "nome_revisar" | null {
  if (
    p.advogados.some(
      (d) =>
        normalizarOab(d.numero_oab) === normalizarOab(a.numero_oab) &&
        d.uf_oab === a.uf_oab,
    )
  )
    return "oab";
  if (modo === "nome") {
    const nome = normalizarTexto(a.nome).replace(/\s+/g, " ").trim();
    const nomes = normalizarTexto(
      [...p.advogados.map((d) => d.nome), p.texto].join(" "),
    ).replace(/\s+/g, " ");
    return !p.advogados.length || nomes.includes(nome) ? "nome_revisar" : null;
  }
  // Se o DJEN trouxe OABs e nenhuma corresponde ao filtro, não associa a publicação ao advogado.
  return p.advogados.some((d) => d.numero_oab && d.uf_oab)
    ? null
    : "consulta_oab";
}
export function parametrosConsulta(
  a: AdvogadoDjen,
  modo: "oab" | "nome",
  inicio: string,
  fim: string,
  pagina: number,
): URLSearchParams {
  const p = new URLSearchParams({
    pagina: String(pagina),
    itensPorPagina: "100",
    dataDisponibilizacaoInicio: inicio,
    dataDisponibilizacaoFim: fim,
  });
  if (modo === "oab") {
    p.set("numeroOab", a.numero_oab);
    p.set("ufOab", a.uf_oab);
  } else p.set("nomeAdvogado", a.nome);
  return p;
}
export interface ContextoConsulta {
  requests: number;
  signal?: AbortSignal;
  pause?: (ms: number) => Promise<void>;
}
export async function consultarDjen(
  a: AdvogadoDjen,
  modo: "oab" | "nome",
  inicio: string,
  fim: string,
  onPage: (items: PublicacaoDjen[]) => void,
  ctx: ContextoConsulta,
): Promise<void> {
  const pause =
    ctx.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let totalLidos = 0;
  const paginas = new Set<string>(),
    idsRecebidos = new Set<string>();
  for (let pagina = 1; pagina <= 100; pagina++) {
    let body: Record<string, unknown> = {};
    for (let tentativa = 0; ; tentativa++) {
      if (ctx.signal?.aborted)
        throw new DjenApiError(
          "Consulta interrompida pelo encerramento do servidor.",
        );
      if (++ctx.requests > 500)
        throw new DjenApiError(
          "Limite de consultas desta execução atingido. Reduza o período; os dados já capturados foram preservados.",
        );
      await pause(500);
      const controller = new AbortController();
      const abort = () => controller.abort();
      ctx.signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, 25000);
      try {
        const response = await fetch(
          `${DJEN_API}/comunicacao?${parametrosConsulta(a, modo, inicio, fim, pagina)}`,
          {
            headers: { Accept: "application/json" },
            signal: controller.signal,
            redirect: "error",
          },
        );
        if (response.status === 429 && tentativa < 2) {
          const espera = Math.min(
            30,
            Math.max(2, Number(response.headers.get("retry-after")) || 5),
          );
          await response.body?.cancel();
          await pause(espera * 1000);
          continue;
        }
        if (!response.ok)
          throw new DjenApiError(
            response.status === 403
              ? "O DJEN recusou o acesso deste servidor (HTTP 403). Verifique o acesso ao DJEN a partir da hospedagem. Nenhum sucesso foi registrado."
              : `O DJEN retornou HTTP ${response.status}. Tente novamente mais tarde.`,
            response.status,
          );
        const text = await response.text();
        if (text.length > 20000000)
          throw new DjenApiError("Resposta do DJEN maior que o limite seguro.");
        try {
          body = obj(JSON.parse(text));
        } catch {
          throw new DjenApiError(
            "O DJEN não devolveu JSON válido. A busca não foi concluída.",
          );
        }
      } catch (error) {
        if (error instanceof DjenApiError) throw error;
        throw new DjenApiError(
          controller.signal.aborted
            ? "O DJEN demorou para responder ou a consulta foi interrompida. Tente novamente."
            : "Não foi possível acessar o DJEN. Verifique a conexão do servidor.",
        );
      } finally {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", abort);
      }
      break;
    }
    if (
      !Array.isArray(body.items) ||
      body.count === null ||
      body.count === "" ||
      !Number.isInteger(Number(body.count)) ||
      Number(body.count) < 0 ||
      (body.status && body.status !== "success")
    )
      throw new DjenApiError(
        "Formato de resposta inesperado do DJEN. A consulta não foi concluída.",
      );
    const count = Number(body.count);
    if (pagina === 1 && count >= 10000) {
      if (inicio === fim)
        throw new DjenApiError(
          "Mais de 10 mil publicações em um dia. Refine a busca por OAB; a captura desse advogado não foi concluída.",
        );
      const meio = new Date(
        (Date.parse(inicio + "T12:00:00Z") + Date.parse(fim + "T12:00:00Z")) /
          2,
      )
        .toISOString()
        .slice(0, 10);
      await consultarDjen(a, modo, inicio, meio, onPage, ctx);
      await consultarDjen(a, modo, somarDias(meio, 1), fim, onPage, ctx);
      return;
    }
    const items = body.items.map(normalizarPublicacao);
    if (
      items.some((p) => p.data < inicio || p.data > fim) ||
      (items.length && count === 0)
    )
      throw new DjenApiError(
        "O DJEN devolveu dados fora dos filtros. A consulta não foi concluída.",
      );
    for (const item of items) {
      if (idsRecebidos.has(item.comunicacao_id))
        throw new DjenApiError(
          "A paginação do DJEN repetiu publicações. Repita a consulta para completar a captura.",
        );
      idsRecebidos.add(item.comunicacao_id);
    }
    const assinatura = items.map((p) => p.comunicacao_id).join("|");
    if (items.length && paginas.has(assinatura))
      throw new DjenApiError(
        "O DJEN repetiu uma página de resultados. A consulta ficou incompleta.",
      );
    paginas.add(assinatura);
    onPage(items);
    totalLidos += items.length;
    if (totalLidos >= count) return;
    if (!items.length)
      throw new DjenApiError(
        "O DJEN encerrou os resultados antes do total informado. A consulta ficou incompleta.",
      );
  }
  throw new DjenApiError(
    "Limite de páginas atingido. Reduza o período da busca.",
  );
}
