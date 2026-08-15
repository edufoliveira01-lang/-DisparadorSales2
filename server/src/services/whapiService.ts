export class WhapiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WhapiError";
    this.status = status;
  }
}

function normalizarUrlBase(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/, "");
}

/** Mantém só dígitos — a Whapi aceita o número no formato internacional sem símbolos (ex: 5511999999999). */
function normalizarNumero(numero: string): string {
  return numero.replace(/\D/g, "");
}

export async function enviarMensagemWhapi(apiUrl: string, token: string, numero: string, texto: string): Promise<void> {
  if (!apiUrl) throw new WhapiError("URL da API da Whapi não configurada.");

  const url = `${normalizarUrlBase(apiUrl)}/messages/text`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: normalizarNumero(numero), body: texto }),
    });
  } catch (err) {
    throw new WhapiError(`Falha de rede ao conectar com a Whapi: ${(err as Error).message}`);
  }

  let payload: { message?: string; error?: string } | null = null;
  try {
    payload = await response.json();
  } catch {
    // resposta sem corpo JSON — segue só com o status HTTP
  }

  if (response.status === 401 || response.status === 403) {
    throw new WhapiError("Token da Whapi inválido ou sem permissão.", response.status);
  }
  if (!response.ok) {
    throw new WhapiError(
      payload?.message || payload?.error || `Erro ao enviar mensagem pela Whapi (HTTP ${response.status}).`,
      response.status
    );
  }
}
