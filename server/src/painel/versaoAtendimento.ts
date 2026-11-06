/**
 * Versão do atendimento (DeskcommCRM do Sales) para o painel: a que está em uso na VPS e a mais nova do repositório original.
 *
 * - Em uso: a imagem do Deskcomm publica `/sales-versao.js` (gerado no build pelo LexSync, fora da autenticação do app) com a versão do
 *   original em que ela se baseia e o número da imagem.
 * - Original: a maior tag `vX.Y.Z` do repositório público do DeskcommCRM (API do GitHub, sem token; o resultado fica em cache).
 */
export interface VersaoEmUso { base: string; imagem: string }
export interface SituacaoDaVersao {
  em_uso: VersaoEmUso | null;
  original: string | null;
  atualizacao_disponivel: boolean;
  notas_url: string | null;
  verificado_em: string;
  avisos: string[];
}

const SEMVER = /^\d+\.\d+\.\d+$/;
export const REPOSITORIO_ORIGINAL = "melgarafael/DeskcommCRM";

export function compararVersoes(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d < 0 ? -1 : 1; }
  return 0;
}

export async function lerVersaoEmUso(urlDeskcomm: string, http: typeof fetch = fetch): Promise<VersaoEmUso | null> {
  const base = urlDeskcomm.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) return null;
  try {
    const r = await http(`${base}/sales-versao.js?t=${Date.now()}`, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/javascript,*/*" }, redirect: "error" });
    if (!r.ok) return null;
    const m = /window\.__SALES_VERSAO__\s*=\s*(\{[^;]{0,300}\})\s*;/.exec((await r.text()).slice(0, 2_000));
    if (!m) return null;
    const d = JSON.parse(m[1]) as { base?: unknown; imagem?: unknown };
    if (typeof d.base !== "string" || !SEMVER.test(d.base) || typeof d.imagem !== "string" || d.imagem.length > 64 || !/^[0-9A-Za-z._-]+$/.test(d.imagem)) return null;
    return { base: d.base, imagem: d.imagem };
  } catch { return null; }
}

export async function ultimaVersaoDoOriginal(http: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await http(`https://api.github.com/repos/${REPOSITORIO_ORIGINAL}/tags?per_page=100`, {
      signal: AbortSignal.timeout(10_000), headers: { Accept: "application/vnd.github+json", "User-Agent": "painel-sales-associados" },
    });
    if (!r.ok) return null;
    const tags = (await r.json()) as { name?: unknown }[];
    const versoes = (Array.isArray(tags) ? tags : []).map((t) => /^v(\d+\.\d+\.\d+)$/.exec(String(t?.name ?? ""))?.[1]).filter((v): v is string => Boolean(v));
    return versoes.sort(compararVersoes).at(-1) ?? null;
  } catch { return null; }
}

/** Consulta as duas pontas com cache (a versão em uso muda raramente; a do original, de dias em dias). */
export class VerificadorDeVersao {
  private emUso: { em: number; valor: VersaoEmUso | null } | null = null;
  private original: { em: number; valor: string | null } | null = null;
  constructor(private urlDeskcomm: string, private http: typeof fetch = fetch, private agora: () => number = () => Date.now(),
    private ttlEmUsoMs = 10 * 60_000, private ttlOriginalMs = 6 * 3_600_000) {}

  async obter(forcar = false): Promise<SituacaoDaVersao> {
    const t = this.agora();
    if (forcar || !this.emUso || t - this.emUso.em > this.ttlEmUsoMs) this.emUso = { em: t, valor: await lerVersaoEmUso(this.urlDeskcomm, this.http) };
    if (forcar || !this.original || (this.original.valor === null ? t - this.original.em > 5 * 60_000 : t - this.original.em > this.ttlOriginalMs)) {
      this.original = { em: t, valor: await ultimaVersaoDoOriginal(this.http) };
    }
    const em_uso = this.emUso.valor, original = this.original.valor, avisos: string[] = [];
    if (!em_uso) avisos.push("Não consegui ler a versão em uso: a imagem do Deskcomm ainda não publica /sales-versao.js (atualize para a imagem mais recente) ou o endereço do atendimento está fora do ar.");
    if (!original) avisos.push("Não consegui consultar a versão mais nova do original no GitHub agora.");
    return {
      em_uso, original,
      atualizacao_disponivel: Boolean(em_uso && original && compararVersoes(em_uso.base, original) < 0),
      notas_url: original ? `https://github.com/${REPOSITORIO_ORIGINAL}/releases/tag/v${original}` : null,
      verificado_em: new Date(t).toISOString(), avisos,
    };
  }
}
