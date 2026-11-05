/** Acesso mínimo ao Supabase do DeskcommCRM usando só `fetch` (PostgREST e GoTrue), sem biblioteca extra. */
export interface ErroBanco { code?: string; status?: number; message?: string }
export interface BancoAtendimento {
  rpc(nome: string, args: Record<string, unknown>): Promise<{ data: unknown; error: ErroBanco | null }>;
  /** Uma linha (ou nenhuma) de `tabela` onde cada coluna de `filtros` é igual ao valor. */
  uma(tabela: string, colunas: string, filtros: Record<string, string>): Promise<{ data: Record<string, unknown> | null; error: ErroBanco | null }>;
  /** Várias linhas; cada valor de `filtros` é um operador PostgREST completo (ex.: "eq.abc", "is.null"). */
  lista(tabela: string, colunas: string, filtros: Record<string, string>): Promise<{ data: Record<string, unknown>[]; error: ErroBanco | null }>;
  /** Atualiza as linhas que casam com `filtros` (operadores PostgREST) e devolve quantas mudaram. */
  atualizar(tabela: string, filtros: Record<string, string>, valores: Record<string, unknown>): Promise<{ count: number; error: ErroBanco | null }>;
  emailDoUsuario(id: string): Promise<{ email: string | null; error: ErroBanco | null }>;
  criarUsuario(email: string, nome?: string): Promise<{ id: string | null; error: ErroBanco | null }>;
  /** Link mágico: devolve o usuário e o código de uso único que o DeskcommCRM troca por sessão. */
  gerarLink(email: string): Promise<{ userId: string | null; tokenHash: string | null; error: ErroBanco | null }>;
}

export function bancoSupabase(urlBase: string, chaveServico: string, http: typeof fetch = fetch): BancoAtendimento {
  const base = urlBase.trim().replace(/\/+$/, "");
  const cab = { apikey: chaveServico, Authorization: `Bearer ${chaveServico}`, "Content-Type": "application/json" };
  async function chamar(metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<{ ok: boolean; status: number; json: any }> {
    try {
      const r = await http(`${base}${caminho}`, { method: metodo, headers: { ...cab, ...extra }, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(30_000) });
      return { ok: r.ok, status: r.status, json: await r.json().catch(() => null) };
    } catch (e) { return { ok: false, status: 0, json: { code: "sem_conexao", message: (e as Error).message } }; }
  }
  const erro = (r: { status: number; json: any }): ErroBanco => ({ status: r.status, code: String(r.json?.error_code ?? r.json?.code ?? ""), message: String(r.json?.msg ?? r.json?.message ?? r.json?.error ?? "") });
  return {
    async rpc(nome, args) {
      const r = await chamar("POST", `/rest/v1/rpc/${encodeURIComponent(nome)}`, args);
      return r.ok ? { data: r.json, error: null } : { data: null, error: erro(r) };
    },
    async uma(tabela, colunas, filtros) {
      const q = new URLSearchParams({ select: colunas, limit: "1" });
      for (const [c, v] of Object.entries(filtros)) q.set(c, `eq.${v}`);
      const r = await chamar("GET", `/rest/v1/${encodeURIComponent(tabela)}?${q}`);
      if (!r.ok) return { data: null, error: erro(r) };
      return { data: Array.isArray(r.json) && r.json.length ? (r.json[0] as Record<string, unknown>) : null, error: null };
    },
    async lista(tabela, colunas, filtros) {
      const q = new URLSearchParams({ select: colunas });
      for (const [c, v] of Object.entries(filtros)) q.set(c, v);
      const r = await chamar("GET", `/rest/v1/${encodeURIComponent(tabela)}?${q}`);
      return r.ok ? { data: Array.isArray(r.json) ? (r.json as Record<string, unknown>[]) : [], error: null } : { data: [], error: erro(r) };
    },
    async atualizar(tabela, filtros, valores) {
      const q = new URLSearchParams();
      for (const [c, v] of Object.entries(filtros)) q.set(c, v);
      const r = await chamar("PATCH", `/rest/v1/${encodeURIComponent(tabela)}?${q}`, valores, { Prefer: "return=representation" });
      return r.ok ? { count: Array.isArray(r.json) ? r.json.length : 0, error: null } : { count: 0, error: erro(r) };
    },
    async emailDoUsuario(id) {
      const r = await chamar("GET", `/auth/v1/admin/users/${encodeURIComponent(id)}`);
      return r.ok ? { email: typeof r.json?.email === "string" ? r.json.email : null, error: null } : { email: null, error: erro(r) };
    },
    async criarUsuario(email, nome) {
      const r = await chamar("POST", "/auth/v1/admin/users", { email, email_confirm: true, user_metadata: nome ? { full_name: nome } : {} });
      return r.ok ? { id: typeof r.json?.id === "string" ? r.json.id : null, error: null } : { id: null, error: erro(r) };
    },
    async gerarLink(email) {
      const r = await chamar("POST", "/auth/v1/admin/generate_link", { type: "magiclink", email });
      if (!r.ok) return { userId: null, tokenHash: null, error: erro(r) };
      const j = r.json ?? {};
      return { userId: typeof j.id === "string" ? j.id : typeof j.user?.id === "string" ? j.user.id : null, tokenHash: typeof j.hashed_token === "string" ? j.hashed_token : typeof j.properties?.hashed_token === "string" ? j.properties.hashed_token : null, error: null };
    },
  };
}
