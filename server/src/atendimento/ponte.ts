import { assinarRequisicao } from "./assinatura";

export class ErroPonteAtendimento extends Error {
  constructor(mensagem: string, public status = 502, public codigo = "ponte") { super(mensagem); }
}
export interface ConfigPonteAtendimento { url: string; segredo: string }
export interface DadosEmpresaAtendimento { slug: string; display_name: string; owner_email: string; owner_name?: string; plan?: string; cnpj?: string }

/** Cliente da ponte do atendimento (serviço sales-bridge do repositório LexSync). Usado pelo painel. */
export class ClientePonte {
  constructor(private cfg: ConfigPonteAtendimento, private http: typeof fetch = fetch, private relogio: () => number = () => Math.floor(Date.now() / 1000)) {}

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const txt = corpo === undefined ? "" : JSON.stringify(corpo);
    const ts = this.relogio();
    let r: Response;
    try {
      r = await this.http(`${this.cfg.url}${caminho}`, {
        method: metodo, headers: { "Content-Type": "application/json", "X-Sales-Timestamp": String(ts), "X-Sales-Signature": assinarRequisicao(this.cfg.segredo, { metodo, caminho, corpo: txt }, ts) },
        body: txt || undefined, signal: AbortSignal.timeout(30_000),
      });
    } catch (e) { throw new ErroPonteAtendimento(`Sem conexão com o atendimento: ${(e as Error).message}`, 502, "sem_conexao"); }
    const dados = (await r.json().catch(() => ({}))) as { error?: string; codigo?: string };
    if (!r.ok) throw new ErroPonteAtendimento(dados.error || `O atendimento respondeu HTTP ${r.status}.`, r.status, dados.codigo || "erro");
    return dados as T;
  }
  provisionar(d: DadosEmpresaAtendimento) { return this.chamar<{ org_id: string; slug: string; created: boolean }>("POST", "/v1/offices", d); }
  status(slug: string) { return this.chamar<{ org_id: string; status: string }>("GET", `/v1/offices/${encodeURIComponent(slug)}`); }
  suspender(slug: string, motivo: string) { return this.chamar<{ changed?: boolean }>("POST", `/v1/offices/${encodeURIComponent(slug)}/suspend`, { reason: motivo }); }
  membros(slug: string, members: { email: string; name?: string; role?: string }[]) { return this.chamar<{ slug: string; resultados: { email: string; ok: boolean; role?: string; erro?: string }[] }>("POST", `/v1/offices/${encodeURIComponent(slug)}/members`, { members }); }
  reativar(slug: string) { return this.chamar<{ changed?: boolean }>("POST", `/v1/offices/${encodeURIComponent(slug)}/reactivate`, {}); }
}

export function lerConfigPonte(env: NodeJS.ProcessEnv = process.env): (ConfigPonteAtendimento & { urlPublica: string }) | null {
  const url = (env.ATENDIMENTO_PONTE_URL || "").trim().replace(/\/+$/, "");
  const segredo = (env.ATENDIMENTO_SEGREDO || "").trim();
  if (!url || !segredo) return null;
  if (segredo.length < 32) throw new Error("ATENDIMENTO_SEGREDO precisa ter pelo menos 32 caracteres.");
  return { url, segredo, urlPublica: (env.ATENDIMENTO_URL || "").trim().replace(/\/+$/, "") };
}
