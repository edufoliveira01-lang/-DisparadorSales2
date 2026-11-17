import path from "node:path";
import { lerConfigPonte } from "../atendimento/ponte";

export interface ConfigPainel {
  porta: number;
  dadosDir: string;
  baseDomain: string;
  urlPublica: string;
  carenciaPadraoDias: number;
  testePadraoDias: number;
  /** Página pública de contratação aberta (PAINEL_CONTRATACAO_PUBLICA=1). Desligada por padrão. */
  contratacaoPublica: boolean;
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
  /** Painel cria sozinho a instância e o Nginx dos escritórios (requer scripts/provisionamento-instalar.sh). */
  autoProvisionar: boolean;
  nginxMapaArquivo: string;
  nginxBin: string;
  systemctlBin: string;
  portaInicial: number;
  /** URL que as instâncias NESTE servidor usam para falar com o painel. */
  licencaUrlInterna: string;
  /** Nome do processo do próprio painel no PM2 (para o botão "Reiniciar"). */
  pm2NomePainel: string;
  /** Ponte do atendimento (LexSync/DeskcommCRM). Ausente = módulo de atendimento desligado no painel. */
  atendimento?: { url: string; segredo: string; urlPublica: string; urlNavegador: string } | null;
}

const inteiro = (v: string | undefined, padrao: number, min = 0, max = 3650) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : padrao;
};

export function lerConfigPainel(env: NodeJS.ProcessEnv = process.env): ConfigPainel {
  return {
    porta: inteiro(env.PAINEL_PORT, 3340, 1, 65535),
    dadosDir: path.resolve(env.PAINEL_DATA_DIR || path.join(process.cwd(), "data-painel")),
    baseDomain: (env.PAINEL_BASE_DOMAIN || "saleseassociados.com.br").replace(/^\.+|\.+$/g, ""),
    urlPublica: (env.PAINEL_PUBLIC_URL || "").replace(/\/+$/, ""),
    carenciaPadraoDias: inteiro(env.PAINEL_CARENCIA_DIAS, 7),
    testePadraoDias: inteiro(env.PAINEL_TESTE_DIAS, 7),
    contratacaoPublica: env.PAINEL_CONTRATACAO_PUBLICA === "1",
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
    autoProvisionar: env.PAINEL_AUTO_PROVISIONAR === "1",
    nginxMapaArquivo: env.PAINEL_NGINX_MAPA || path.join(path.resolve(env.PAINEL_DATA_DIR || path.join(process.cwd(), "data-painel")), "..", "nginx", "escritorios.map"),
    nginxBin: env.PAINEL_NGINX_BIN || "/usr/sbin/nginx",
    systemctlBin: env.PAINEL_SYSTEMCTL_BIN || "/usr/bin/systemctl",
    portaInicial: inteiro(env.PAINEL_PORTA_INICIAL, 3401, 1024, 65000),
    atendimento: (() => {
      // Ponte embutida no painel (ATENDIMENTO_SUPABASE_URL definido): os endereços da ponte são os do próprio painel.
      const embutida = Boolean((env.ATENDIMENTO_SUPABASE_URL || "").trim());
      const porta = inteiro(env.PAINEL_PORT, 3340, 1, 65535);
      const efetivo = embutida && !(env.ATENDIMENTO_PONTE_URL || "").trim() ? { ...env, ATENDIMENTO_PONTE_URL: `http://127.0.0.1:${porta}/ponte` } : env;
      const a = lerConfigPonte(efetivo);
      if (!a) return null;
      const publica = (env.ATENDIMENTO_PONTE_URL_PUBLICA || (embutida && env.PAINEL_PUBLIC_URL ? `${env.PAINEL_PUBLIC_URL}/ponte` : a.url)).trim().replace(/\/+$/, "");
      return { ...a, urlNavegador: publica };
    })(),
    pm2NomePainel: /^[A-Za-z0-9._-]{1,60}$/.test(env.PAINEL_PM2_NOME || "") ? (env.PAINEL_PM2_NOME as string) : "dz-painel",
    licencaUrlInterna: (env.PAINEL_LICENCA_URL_INTERNA || (env.PAINEL_AUTO_PROVISIONAR === "1" ? `http://127.0.0.1:${inteiro(env.PAINEL_PORT, 3340, 1, 65535)}` : "")).replace(/\/+$/, ""),
  };
}
