import { db } from "../../db";
import { aiConfiguration, apiKeyName, chatgptLocalLoginAllowed } from "./config";
import { verificarConexaoCodex } from "../djen/codexRunner";

export async function selectedAiConnection() {
  const config = aiConfiguration();
  if (config.provider === "codex") return chatgptLocalLoginAllowed() ? verificarConexaoCodex(true) : { instalado: true, conectado: false, mensagem: "Conta ChatGPT indisponível neste modo hospedado. Configure um provedor por API." };
  const configured = Boolean(db.prepare("SELECT 1 FROM settings WHERE chave=?").get(apiKeyName(config.provider)));
  return { instalado: true, conectado: configured, mensagem: configured ? "Credencial de API cadastrada. Use Testar conexão para verificar o modelo." : "Cadastre a conexão em Configurações → Inteligência artificial." };
}
