import { emitirTokenSso, chaveSso } from "./assinatura";
import { licenca } from "../licenca/cliente";

/** Dados para a entrada direta no atendimento, na instância de um escritório. */
export interface AtendimentoDaInstancia { slug: string; url: string; ponteUrl: string; chaveSso: string }

/**
 * Licenciada (escritório do SaaS): vem na licença assinada pelo painel, quando o plano inclui o módulo.
 * Instalação própria (sem licença): vem das variáveis ATENDIMENTO_PONTE_URL, ATENDIMENTO_URL, ATENDIMENTO_SLUG e ATENDIMENTO_SEGREDO.
 */
export function atendimentoDaInstancia(env: NodeJS.ProcessEnv = process.env): AtendimentoDaInstancia | null {
  const l = licenca();
  const e = l.estado();
  if (e.modo === "licenciado") {
    const a = l.atendimento();
    if (!a || e.entitlements.modulo_atendimento !== true || e.restrito) return null;
    return { slug: a.slug, url: a.url, ponteUrl: a.ponte_url, chaveSso: a.chave_sso };
  }
  const ponte = (env.ATENDIMENTO_PONTE_URL || "").trim().replace(/\/+$/, ""), segredo = (env.ATENDIMENTO_SEGREDO || "").trim(), slug = (env.ATENDIMENTO_SLUG || "").trim();
  if (!ponte || segredo.length < 32 || !/^[a-z0-9-]{2,40}$/.test(slug)) return null;
  return { slug, url: (env.ATENDIMENTO_URL || "").trim().replace(/\/+$/, ""), ponteUrl: ponte, chaveSso: chaveSso(segredo, slug) };
}

/** Endereço (na ponte) que leva o navegador logado ao atendimento. O token vale 60 segundos e uma vez. */
export function enderecoDeEntrada(a: AtendimentoDaInstancia, email: string, telefone = "", origem = ""): string {
  // `origem` (endereço público deste sistema) vai assinada dentro do token: o atendimento usa para o botão "Sistema" voltar para cá.
  const src = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origem) ? origem.toLowerCase() : undefined;
  const base = `${a.ponteUrl}/sso?t=${encodeURIComponent(emitirTokenSso(a.chaveSso, { slug: a.slug, email: email.trim().toLowerCase(), src }))}`;
  const d = telefone.replace(/\D/g, "");
  // Com telefone, o atendimento abre direto na conversa desse número (a ponte só aceita este destino).
  return d.length >= 8 && d.length <= 15 ? `${base}&next=${encodeURIComponent(`/app/abrir-conversa?telefone=${d}`)}` : base;
}
