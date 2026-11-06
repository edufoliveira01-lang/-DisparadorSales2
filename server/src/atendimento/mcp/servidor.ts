import { FERRAMENTAS } from "./ferramentas";

/**
 * Servidor MCP (Streamable HTTP, sem estado) do escritório: só o que o cliente do Deskcomm usa — initialize, ping, tools/list e tools/call.
 * Sem dependência nova: é JSON-RPC 2.0 simples. O telefone do contato vem do Deskcomm (montado por ele a partir do banco dele), nunca do modelo.
 */
const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const INFO_DO_SERVIDOR = { name: "sales-gestao", version: "1.0.0" };

type Id = string | number | null;
interface Req { jsonrpc?: string; id?: Id; method?: string; params?: Record<string, unknown> }
export type Resposta = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const ok = (id: Id, result: unknown): Resposta => ({ jsonrpc: "2.0", id, result });
const erro = (id: Id, code: number, message: string): Resposta => ({ jsonrpc: "2.0", id, error: { code, message } });

/** `null` = era uma notificação (sem resposta: o HTTP devolve 202). */
export function tratarJsonRpc(msg: unknown, contato: { telefone?: string }): Resposta | null {
  const m = (msg && typeof msg === "object" ? msg : {}) as Req;
  const id = m.id ?? null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return m.id === undefined ? null : erro(id, -32600, "Pedido inválido.");
  if (m.id === undefined) return null; // notificação (notifications/initialized etc.)
  switch (m.method) {
    case "initialize": {
      const pedida = String((m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion ?? "");
      return ok(id, { protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0], capabilities: { tools: { listChanged: false } }, serverInfo: INFO_DO_SERVIDOR });
    }
    case "ping": return ok(id, {});
    case "tools/list":
      return ok(id, { tools: FERRAMENTAS.map((f) => ({ name: f.name, title: f.title, description: f.description, inputSchema: f.inputSchema, annotations: { title: f.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) });
    case "tools/call": {
      const p = (m.params ?? {}) as { name?: unknown; arguments?: unknown };
      const f = FERRAMENTAS.find((x) => x.name === p.name);
      if (!f) return erro(id, -32602, `Ferramenta desconhecida: ${String(p.name)}`);
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? (p.arguments as Record<string, unknown>) : {};
      try {
        const r = f.executar(String(contato.telefone ?? ""), args);
        return ok(id, { content: [{ type: "text", text: r.texto }], structuredContent: r.dados, isError: Boolean(r.erro) });
      } catch (e) {
        console.error("[mcp] erro na ferramenta", f.name, e instanceof Error ? e.message : e);
        return ok(id, { content: [{ type: "text", text: "Não consegui consultar o cadastro agora. Diga que vai pedir à equipe e passe a conversa." }], isError: true });
      }
    }
    default: return erro(id, -32601, `Método não suportado: ${m.method}`);
  }
}
