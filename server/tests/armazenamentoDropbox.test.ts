import { describe, expect, it, vi } from "vitest";
import { argEmCabecalho, criarClienteDropbox, ErroDropbox, trocarCodigo, urlDeAutorizacao } from "../src/armazenamento/dropbox";
import { ErroArmazenamento, ErroItemNaoEncontrado } from "../src/armazenamento/pastas";

interface Chamada { url: string; init: RequestInit }
/** Uma rede falsa: responde por trecho da URL, na ordem, e registra tudo o que foi pedido. */
function redeFalsa(respostas: Array<{ casa: RegExp; status?: number; corpo?: unknown }>) {
  const chamadas: Chamada[] = [];
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init: init ?? {} });
    const r = respostas.find((x) => x.casa.test(u));
    if (!r) throw new Error(`sem resposta para ${u}`);
    return new Response(JSON.stringify(r.corpo ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { http, chamadas };
}
const TOKEN = { casa: /oauth2\/token/, corpo: { access_token: "acesso-1", expires_in: 14400 } };
const cliente = (http: typeof fetch) => criarClienteDropbox({ appKey: "k", appSecret: "s", refreshToken: "r", http });
const cabecalho = (c: Chamada, nome: string) => (c.init.headers as Record<string, string>)[nome];

describe("autorização", () => {
  it("o endereço pede acesso offline (refresh token) e leva o state", () => {
    const u = new URL(urlDeAutorizacao({ appKey: "abc", redirectUri: "https://x.com/api/dropbox/retorno", state: "xyz" }));
    expect(u.origin + u.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(u.searchParams.get("token_access_type")).toBe("offline");
    expect(u.searchParams.get("client_id")).toBe("abc");
    expect(u.searchParams.get("state")).toBe("xyz");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
  it("troca o código pelo refresh token, mandando a secret no corpo", async () => {
    const { http, chamadas } = redeFalsa([{ casa: /oauth2\/token/, corpo: { access_token: "a", refresh_token: "R", expires_in: 100, account_id: "dbid:1" } }]);
    const t = await trocarCodigo({ appKey: "k", appSecret: "s", code: "c", redirectUri: "https://x/retorno", http });
    expect(t).toMatchObject({ refreshToken: "R", accessToken: "a", contaId: "dbid:1" });
    const corpo = new URLSearchParams(String(chamadas[0]!.init.body));
    expect(corpo.get("grant_type")).toBe("authorization_code");
    expect(corpo.get("client_secret")).toBe("s");
  });
  it("sem refresh token na resposta, explica", async () => {
    const { http } = redeFalsa([{ casa: /oauth2\/token/, corpo: { access_token: "a" } }]);
    await expect(trocarCodigo({ appKey: "k", appSecret: "s", code: "c", redirectUri: "u", http })).rejects.toThrow(/acesso duradouro/);
  });
});

describe("cabeçalho Dropbox-API-Arg", () => {
  it("acentos viram \\uXXXX (o cabeçalho só aceita ASCII)", () => {
    const h = argEmCabecalho({ path: "/CLIENTES/JOÃO/PARTE MÉDICA/a.pdf" });
    expect(h).toBe('{"path":"/CLIENTES/JO\\u00c3O/PARTE M\\u00c9DICA/a.pdf"}'.replace("\\u00c3", "\\u00c3"));
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e]*$/.test(h)).toBe(true);
    expect(JSON.parse(h).path).toBe("/CLIENTES/JOÃO/PARTE MÉDICA/a.pdf");
  });
});

describe("cliente Dropbox", () => {
  it("renova o acesso uma vez e reutiliza até perto de expirar", async () => {
    const { http, chamadas } = redeFalsa([TOKEN, { casa: /get_current_account/, corpo: { account_id: "a", name: { display_name: "Escritório" }, email: "e@x.com", account_type: { ".tag": "pro" }, root_info: { root_namespace_id: "1", home_namespace_id: "1" } } }]);
    const c = cliente(http);
    const conta = await c.conta();
    await c.conta();
    expect(conta).toMatchObject({ nome: "Escritório", tipo: "pro", ehEquipe: false });
    expect(chamadas.filter((x) => /oauth2\/token/.test(x.url))).toHaveLength(1);
    expect(cabecalho(chamadas[1]!, "Authorization")).toBe("Bearer acesso-1");
  });
  it("conta de EQUIPE passa a mandar o cabeçalho de raiz nas chamadas seguintes", async () => {
    const { http, chamadas } = redeFalsa([TOKEN,
      { casa: /get_current_account/, corpo: { account_id: "a", account_type: { ".tag": "business" }, root_info: { root_namespace_id: "99", home_namespace_id: "7" } } },
      { casa: /list_folder$/, corpo: { entries: [], has_more: false, cursor: "c" } }]);
    const c = cliente(http);
    expect((await c.conta()).ehEquipe).toBe(true);
    await c.listarPastas("/CLIENTES");
    expect(JSON.parse(cabecalho(chamadas.at(-1)!, "Dropbox-API-Path-Root")!)).toEqual({ ".tag": "root", root: "99" });
  });
  it("lista só as pastas, paginando até o fim", async () => {
    const { http, chamadas } = redeFalsa([TOKEN,
      { casa: /list_folder$/, corpo: { entries: [{ ".tag": "folder", id: "id:1", name: "ANA", path_display: "/CLIENTES/ANA" }, { ".tag": "file", id: "id:f", name: "x.txt" }], has_more: true, cursor: "cur" } },
      { casa: /list_folder\/continue/, corpo: { entries: [{ ".tag": "folder", id: "id:2", name: "BIA", path_display: "/CLIENTES/BIA" }], has_more: false, cursor: "cur2" } }]);
    const pastas = await cliente(http).listarPastas("/CLIENTES");
    expect(pastas).toEqual([{ id: "id:1", nome: "ANA", caminho: "/CLIENTES/ANA" }, { id: "id:2", nome: "BIA", caminho: "/CLIENTES/BIA" }]);
    expect(JSON.parse(String(chamadas[1]!.init.body))).toMatchObject({ path: "/CLIENTES", recursive: false });
  });
  it("pasta que já existe: criarPasta devolve a existente em vez de falhar", async () => {
    const { http } = redeFalsa([TOKEN,
      { casa: /create_folder_v2/, status: 409, corpo: { error_summary: "path/conflict/folder/..." } },
      { casa: /get_metadata/, corpo: { ".tag": "folder", id: "id:9", name: "ANA", path_display: "/CLIENTES/ANA" } }]);
    expect(await cliente(http).criarPasta("/CLIENTES/ANA")).toMatchObject({ id: "id:9", nome: "ANA" });
  });
  it("item que não existe vira ErroItemNaoEncontrado", async () => {
    const { http } = redeFalsa([TOKEN, { casa: /get_metadata/, status: 409, corpo: { error_summary: "path/not_found/.." } }]);
    await expect(cliente(http).metadados("id:zzz")).rejects.toBeInstanceOf(ErroItemNaoEncontrado);
  });
  it("envia com o caminho no cabeçalho (acentos escapados), autorename ligado, e devolve o caminho final", async () => {
    const { http, chamadas } = redeFalsa([TOKEN, { casa: /files\/upload/, corpo: { id: "id:up", path_display: "/CLIENTES/JOÃO/PARTE MÉDICA/2026-11-10 - Laudo.pdf" } }]);
    const r = await cliente(http).enviar("/CLIENTES/JOÃO/PARTE MÉDICA/2026-11-10 - Laudo.pdf", Buffer.from("pdf"));
    expect(r.caminho).toBe("/CLIENTES/JOÃO/PARTE MÉDICA/2026-11-10 - Laudo.pdf");
    const up = chamadas.at(-1)!;
    expect(up.url).toBe("https://content.dropboxapi.com/2/files/upload");
    const arg = cabecalho(up, "Dropbox-API-Arg")!;
    // eslint-disable-next-line no-control-regex
    expect(/^[\x20-\x7e]*$/.test(arg)).toBe(true);
    expect(JSON.parse(arg)).toMatchObject({ mode: "add", autorename: true, path: "/CLIENTES/JOÃO/PARTE MÉDICA/2026-11-10 - Laudo.pdf" });
    expect(cabecalho(up, "Content-Type")).toBe("application/octet-stream");
  });
  it("NUNCA envia fora de /CLIENTES (a rede nem é chamada)", async () => {
    const { http, chamadas } = redeFalsa([TOKEN]);
    const c = cliente(http);
    await expect(c.enviar("/OUTRA/x.pdf", Buffer.from("a"))).rejects.toBeInstanceOf(ErroArmazenamento);
    await expect(c.criarPasta("/CLIENTES/../OUTRA")).rejects.toBeInstanceOf(ErroArmazenamento);
    await expect(c.listarPastas("/")).rejects.toBeInstanceOf(ErroArmazenamento);
    await expect(c.metadados("/OUTRA")).rejects.toBeInstanceOf(ErroArmazenamento);
    expect(chamadas).toHaveLength(0);
  });
  it("401 renova o acesso e tenta de novo UMA vez", async () => {
    let n = 0;
    const chamadas: string[] = [];
    const http = vi.fn(async (url: string | URL | Request) => {
      const u = String(url); chamadas.push(u);
      if (/oauth2\/token/.test(u)) return new Response(JSON.stringify({ access_token: `a${++n}`, expires_in: 14400 }));
      if (n < 2) return new Response(JSON.stringify({ error_summary: "expired_access_token/" }), { status: 401 });
      return new Response(JSON.stringify({ entries: [], has_more: false, cursor: "c" }));
    }) as unknown as typeof fetch;
    expect(await cliente(http).listarPastas("/CLIENTES")).toEqual([]);
    expect(chamadas.filter((u) => /oauth2\/token/.test(u))).toHaveLength(2);
  });
  it("erro do Dropbox vira frase em português (sem espaço, sem acesso)", async () => {
    const { http } = redeFalsa([TOKEN, { casa: /files\/upload/, status: 429, corpo: { error_summary: "too_many_requests/" } }]);
    await expect(cliente(http).enviar("/CLIENTES/A/B/x.pdf", Buffer.from("a"))).rejects.toThrow(/esperar um pouco/);
    const { http: h2 } = redeFalsa([TOKEN, { casa: /files\/upload/, status: 409, corpo: { error_summary: "path/insufficient_space/.." } }]);
    await expect(cliente(h2).enviar("/CLIENTES/A/B/x.pdf", Buffer.from("a"))).rejects.toBeInstanceOf(ErroDropbox);
  });
});
