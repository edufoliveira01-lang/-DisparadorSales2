/** Qual WhatsApp envia as mensagens: a conexão própria do Sales ou a do Deskcomm. Arquivo à parte para as rotas não carregarem o motor do WhatsApp. */
import { getSetting, setSetting } from "./settingsService";
import { ErroDeskcomm, envioPeloDeskcommLigado } from "./gestao/deskcomm";

export type Provedor = "proprio" | "deskcomm";
export const provedorAtual = (): Provedor => (getSetting("whatsapp_provedor") === "deskcomm" ? "deskcomm" : "proprio");
export const usaDeskcomm = () => provedorAtual() === "deskcomm";
export function definirProvedor(p: unknown) {
  if (p !== "deskcomm" && p !== "proprio") throw new ErroDeskcomm("Escolha de envio inválida.", 400);
  if (p === "deskcomm" && !envioPeloDeskcommLigado()) throw new ErroDeskcomm("Salve o token do Deskcomm antes de usar o WhatsApp dele para tudo.", 409);
  setSetting("whatsapp_provedor", p);
}

