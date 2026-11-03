/**
 * Cobrança recorrente pelo Asaas. O painel conversa com a interface `ProvedorCobranca`, então outro
 * provedor (ex.: Mercado Pago) pode ser acrescentado sem mexer nas regras de negócio.
 */
export interface DadosCliente { nome: string; documento?: string | null; email: string; telefone?: string | null; referencia: string }
export interface DadosAssinatura { clienteId: string; valorCentavos: number; proximoVencimento: string; descricao: string; referencia: string }

export interface ProvedorCobranca {
  nome: string;
  configurado(): boolean;
  criarCliente(d: DadosCliente): Promise<{ id: string }>;
  criarAssinatura(d: DadosAssinatura): Promise<{ id: string; linkFatura: string | null }>;
  atualizarValor(assinaturaId: string, valorCentavos: number): Promise<void>;
  cancelarAssinatura(assinaturaId: string): Promise<void>;
}

export class ErroProvedor extends Error {
  constructor(mensagem: string, public status = 0) { super(mensagem); }
}

type Fetcher = typeof fetch;

export class AsaasProvider implements ProvedorCobranca {
  nome = "asaas";
  constructor(private cfg: { apiKey: string; baseUrl: string }, private http: Fetcher = fetch) {}
  configurado() { return Boolean(this.cfg.apiKey); }

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    if (!this.configurado()) throw new ErroProvedor("Asaas não configurado (ASAAS_API_KEY).");
    const r = await this.http(`${this.cfg.baseUrl}${caminho}`, {
      method: metodo,
      headers: { "Content-Type": "application/json", access_token: this.cfg.apiKey, "User-Agent": "DisparaZap-Painel/1.0" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await r.text();
    let json: unknown = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta não JSON */ }
    if (!r.ok) {
      const erros = (json as { errors?: { description?: string }[] } | null)?.errors;
      throw new ErroProvedor(erros?.map((e) => e.description).filter(Boolean).join("; ") || `Asaas respondeu HTTP ${r.status}.`, r.status);
    }
    return json as T;
  }

  async criarCliente(d: DadosCliente) {
    const r = await this.chamar<{ id: string }>("POST", "/customers", {
      name: d.nome, email: d.email, cpfCnpj: d.documento?.replace(/\D/g, "") || undefined,
      mobilePhone: d.telefone?.replace(/\D/g, "") || undefined, externalReference: d.referencia, notificationDisabled: false,
    });
    return { id: r.id };
  }

  async criarAssinatura(d: DadosAssinatura) {
    const r = await this.chamar<{ id: string }>("POST", "/subscriptions", {
      customer: d.clienteId, billingType: "UNDEFINED", // o cliente escolhe boleto, Pix ou cartão na fatura
      value: Number((d.valorCentavos / 100).toFixed(2)), nextDueDate: d.proximoVencimento,
      cycle: "MONTHLY", description: d.descricao, externalReference: d.referencia,
    });
    let linkFatura: string | null = null;
    try {
      const cobrancas = await this.chamar<{ data?: { invoiceUrl?: string }[] }>("GET", `/subscriptions/${encodeURIComponent(r.id)}/payments?limit=1`);
      linkFatura = cobrancas.data?.[0]?.invoiceUrl ?? null;
    } catch { /* o link também chega pelo webhook */ }
    return { id: r.id, linkFatura };
  }

  async atualizarValor(assinaturaId: string, valorCentavos: number) {
    await this.chamar("PUT", `/subscriptions/${encodeURIComponent(assinaturaId)}`, { value: Number((valorCentavos / 100).toFixed(2)), updatePendingPayments: true });
  }
  async cancelarAssinatura(assinaturaId: string) {
    await this.chamar("DELETE", `/subscriptions/${encodeURIComponent(assinaturaId)}`);
  }
}
