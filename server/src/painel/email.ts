import nodemailer from "nodemailer";
import type { ConfigPainel } from "./config";

export interface MensagemEmail { para: string; assunto: string; texto: string; html: string }
export type EnviarEmail = (m: MensagemEmail) => Promise<void>;

/** Envia e-mail pelo SMTP configurado. Sem configuração devolve `null` (e-mails desligados). */
export function criarEnviadorSmtp(cfg: ConfigPainel): EnviarEmail | null {
  const e = cfg.email; if (!e) return null;
  const transporte = nodemailer.createTransport({ host: e.host, port: e.porta, secure: e.seguro, auth: e.usuario ? { user: e.usuario, pass: e.senha } : undefined });
  return async (m) => { await transporte.sendMail({ from: `"${cfg.nomeProduto.replace(/"/g, "")}" <${e.de}>`, to: m.para, subject: m.assunto, text: m.texto, html: m.html }); };
}

export const escapar = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function moldura(cfg: ConfigPainel, titulo: string, corpoHtml: string) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#14181f">
  <div style="padding:18px 0;font-weight:800;font-size:18px;color:#1678dc">${escapar(cfg.nomeProduto)}</div>
  <h2 style="margin:0 0 12px;font-size:20px">${escapar(titulo)}</h2>${corpoHtml}
  <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0 12px"><p style="color:#6b7280;font-size:12px;margin:0">${escapar(cfg.nomeProduto)}${cfg.empresa.nome ? " · " + escapar(cfg.empresa.nome) : ""}. A inteligência artificial auxilia a triagem e não substitui a conferência do advogado.</p></div>`;
}

/** Confirmação ao cliente que acabou de contratar. Nunca leva a senha. */
export function emailBoasVindas(cfg: ConfigPainel, d: { nome: string; para: string; endereco: string; usuario: string; testeAte: string | null; pronto: boolean; plano: string }): MensagemEmail {
  const ate = d.testeAte ? d.testeAte.split("-").reverse().join("/") : "";
  const status = d.pronto ? "Seu ambiente já está pronto." : "Estamos preparando o seu ambiente; ele fica disponível no endereço abaixo em instantes.";
  const base = (cfg.urlPublica || "").replace(/\/+$/, "");
  const termos = base ? `<p style="font-size:13px;color:#6b7280"><a href="${escapar(base)}/termos">Termos de uso</a> · <a href="${escapar(base)}/privacidade">Política de privacidade</a></p>` : "";
  const html = moldura(cfg, `Bem-vindo(a), ${d.nome}`, `<p>${escapar(status)}</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0">
   <tr><td style="padding:8px 0;color:#6b7280">Endereço</td><td style="padding:8px 0"><a href="${escapar(d.endereco)}">${escapar(d.endereco.replace(/^https?:\/\//, ""))}</a></td></tr>
   <tr><td style="padding:8px 0;color:#6b7280">Usuário</td><td style="padding:8px 0"><b>${escapar(d.usuario)}</b> (a senha é a que você escolheu no cadastro)</td></tr>
   <tr><td style="padding:8px 0;color:#6b7280">Plano</td><td style="padding:8px 0">${escapar(d.plano)}</td></tr>
   ${ate ? `<tr><td style="padding:8px 0;color:#6b7280">Teste grátis até</td><td style="padding:8px 0"><b>${escapar(ate)}</b></td></tr>` : ""}
  </table>
  <p>Durante o teste não é preciso informar cartão. A primeira cobrança só é gerada perto do fim do teste, e você pode cancelar antes disso.</p>${termos}`);
  const texto = `Bem-vindo(a), ${d.nome}\n\n${status}\n\nEndereço: ${d.endereco}\nUsuário: ${d.usuario} (a senha é a que você escolheu no cadastro)\nPlano: ${d.plano}\n${ate ? `Teste grátis até: ${ate}\n` : ""}\nDurante o teste não é preciso informar cartão. A primeira cobrança só é gerada perto do fim do teste, e você pode cancelar antes disso.`;
  return { para: d.para, assunto: `Seu teste grátis no ${cfg.nomeProduto} começou`, texto, html };
}

/** Aviso interno de novo cadastro pela página pública. */
export function emailAvisoCadastro(cfg: ConfigPainel, d: { nome: string; slug: string; email: string; telefone?: string; plano: string; pronto: boolean }): MensagemEmail {
  const linhas: [string, string][] = [["Escritório", d.nome], ["Endereço", `${d.slug}.${cfg.baseDomain}`], ["E-mail", d.email], ["Telefone", d.telefone || "—"], ["Plano", d.plano], ["Sistema criado", d.pronto ? "sim" : "não (criar pelo painel)"]];
  return { para: cfg.email!.avisarAdmin, assunto: `Novo cadastro: ${d.nome}`, texto: linhas.map(([k, v]) => `${k}: ${v}`).join("\n"),
    html: moldura(cfg, "Novo cadastro pela página de contratação", `<table style="width:100%;border-collapse:collapse">${linhas.map(([k, v]) => `<tr><td style="padding:6px 0;color:#6b7280">${escapar(k)}</td><td style="padding:6px 0">${escapar(v)}</td></tr>`).join("")}</table>`) };
}
export function emailTeste(cfg: ConfigPainel, para: string): MensagemEmail {
  return { para, assunto: `Teste de e-mail do painel ${cfg.nomeProduto}`, texto: "Se você recebeu esta mensagem, o envio de e-mail do painel está funcionando.", html: moldura(cfg, "E-mail de teste", "<p>Se você recebeu esta mensagem, o envio de e-mail do painel está funcionando.</p>") };
}
