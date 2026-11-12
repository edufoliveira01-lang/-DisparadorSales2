/**
 * Canal de envio do WhatsApp: ou a conexão própria do Sales ("proprio") ou o WhatsApp do Deskcomm ("deskcomm"),
 * escolhido em Configurações → Envio pelo Deskcomm. Quem envia mensagens (avisos, lembretes, DJEN, cobrança)
 * fala só com este módulo e não precisa saber qual dos dois está ligado.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { normalizePhone } from "../utils/phone";
import { whatsappManager } from "./whatsappService";
import { canalEscolhido, enviarPeloDeskcomm, envioPeloDeskcommLigado, ErroDeskcomm, listarCanaisDoDeskcomm, type FinalidadeDeCanal } from "./gestao/deskcomm";

export { provedorAtual, usaDeskcomm, definirProvedor, type Provedor } from "./canalProvedor";
import { usaDeskcomm } from "./canalProvedor";

const SUFIXO = "@deskcomm";
const comDdi = (tel: string) => { const d = normalizePhone(tel); return d.startsWith("55") ? d : `55${d}`; };

/** Há como enviar agora? (Deskcomm: token e atendimento ligados; o número escolhido é conferido no próprio envio.) */
export const canalPronto = () => (usaDeskcomm() ? envioPeloDeskcommLigado() : whatsappManager.isReady());
export const mensagemCanalIndisponivel = () => (usaDeskcomm() ? "O envio pelo Deskcomm não está pronto: confira o token e o número em Configurações → Envio pelo Deskcomm." : "WhatsApp não está conectado.");

/** Destino do envio: no WhatsApp próprio é o chatId (confere se o número existe); no Deskcomm é o telefone com DDI. */
export async function resolverDestino(telefone: string): Promise<string | null> {
  if (usaDeskcomm()) { const d = comDdi(telefone); return d.length >= 12 ? `${d}${SUFIXO}` : null; }
  return whatsappManager.resolveChatId(telefone);
}

interface Contexto { nome?: string | null; finalidade?: FinalidadeDeCanal }
const registrar = db.prepare("INSERT OR IGNORE INTO deskcomm_mensagens(message_id,conversation_id,telefone_digits) VALUES (?,?,?)");

async function pelaDeskcomm(destino: string, texto: string, ctx: Contexto): Promise<string> {
  const digitos = destino.split("@")[0];
  const r = await enviarPeloDeskcomm(digitos, ctx.nome || "", texto, fetch, [], [], ctx.finalidade);
  const id = r.message_id ?? `dsk-${randomUUID()}`;
  registrar.run(id, r.conversation_id, normalizePhone(digitos));
  return id;
}

/** Envia o texto e devolve o id da mensagem (para acompanhar entrega e leitura). */
export async function enviarTexto(destino: string, texto: string, ctx: Contexto = {}): Promise<string | null> {
  if (usaDeskcomm()) return pelaDeskcomm(destino, texto, ctx);
  return whatsappManager.sendMessage(destino, texto);
}

/** Igual a `enviarTexto`, mas devolve também o nível de confirmação (ack) do envio. */
export async function enviarTextoConfirmado(destino: string, texto: string, ctx: Contexto = {}): Promise<{ messageId: string; ack: number }> {
  if (usaDeskcomm()) return { messageId: await pelaDeskcomm(destino, texto, ctx), ack: 1 };
  const r = await whatsappManager.sendMessageConfirmed(destino, texto);
  return { messageId: r.messageId, ack: r.ack };
}

export interface EstadoDoCanal { status: "conectado" | "desconectado" | "falha"; qrDataUrl: null; lastError: string | null; provedor: "deskcomm"; numeros: { nome: string; telefone: string; pronto: boolean }[] }
let cache: { em: number; estado: EstadoDoCanal } | null = null;
/** Situação do WhatsApp do Deskcomm (números conectados), com cache curto para a barra do topo não sobrecarregar o atendimento. */
export async function estadoDoCanalDeskcomm(): Promise<EstadoDoCanal> {
  if (cache && Date.now() - cache.em < 20_000) return cache.estado;
  let estado: EstadoDoCanal;
  try {
    const canais = await listarCanaisDoDeskcomm();
    const escolhido = canalEscolhido();
    const alvo = escolhido ? canais.filter((c) => c.id === escolhido) : canais;
    const ok = alvo.some((c) => c.pronto);
    estado = { status: ok ? "conectado" : "desconectado", qrDataUrl: null, provedor: "deskcomm", numeros: canais.map((c) => ({ nome: c.nome, telefone: c.telefone, pronto: c.pronto })),
      lastError: ok ? null : canais.length ? "Nenhum número escolhido está conectado no Deskcomm." : "Nenhum número conectado no Deskcomm." };
  } catch (e) {
    estado = { status: "falha", qrDataUrl: null, provedor: "deskcomm", numeros: [], lastError: e instanceof Error ? e.message : "Não consegui falar com o Deskcomm." };
  }
  cache = { em: Date.now(), estado };
  return estado;
}
