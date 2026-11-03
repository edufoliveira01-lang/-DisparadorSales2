import path from "node:path";

export interface ConfigPainel {
  porta: number;
  dadosDir: string;
  baseDomain: string;
  urlPublica: string;
  carenciaPadraoDias: number;
  testePadraoDias: number;
  toleranciaOfflineDias: number;
  validadeLicencaHoras: number;
  asaasApiKey: string;
  asaasBaseUrl: string;
  asaasWebhookToken: string;
  adminUsuario: string;
  adminSenhaInicial: string;
  sessaoHoras: number;
  appDir: string;
  instanciasDir: string;
}

const inteiro = (v: string | undefined, padrao: number, min = 0, max = 3650) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
};

export function lerConfigPainel(env: NodeJS.ProcessEnv = process.env): ConfigPainel {
  return {
    porta: inteiro(env.PAINEL_PORT, 3340, 1, 65535),
    dadosDir: path.resolve(env.PAINEL_DATA_DIR || path.join(process.cwd(), "data-painel")),
    baseDomain: (env.PAINEL_BASE_DOMAIN || "disparazap.saleseassociados.com.br").replace(/^\.+|\.+$/g, ""),
    urlPublica: (env.PAINEL_PUBLIC_URL || "").replace(/\/+$/, ""),
    carenciaPadraoDias: inteiro(env.PAINEL_CARENCIA_DIAS, 7),
    testePadraoDias: inteiro(env.PAINEL_TESTE_DIAS, 14),
    toleranciaOfflineDias: inteiro(env.PAINEL_TOLERANCIA_OFFLINE_DIAS, 14),
    validadeLicencaHoras: inteiro(env.PAINEL_VALIDADE_LICENCA_HORAS, 72, 1, 720),
    asaasApiKey: env.ASAAS_API_KEY || "",
    // Padrão: sandbox. Em produção use https://api.asaas.com/v3 (confirme na documentação do Asaas).
    asaasBaseUrl: (env.ASAAS_BASE_URL || "https://api-sandbox.asaas.com/v3").replace(/\/+$/, ""),
    asaasWebhookToken: env.ASAAS_WEBHOOK_TOKEN || "",
    adminUsuario: env.PAINEL_ADMIN_USER || "admin",
    adminSenhaInicial: env.PAINEL_ADMIN_PASSWORD || "",
    sessaoHoras: inteiro(env.PAINEL_SESSAO_HORAS, 12, 1, 168),
    appDir: env.PAINEL_APP_DIR || "/home/dropsales/disparador-sales2/server",
    instanciasDir: env.PAINEL_INSTANCIAS_DIR || "/srv/disparazap",
  };
}
