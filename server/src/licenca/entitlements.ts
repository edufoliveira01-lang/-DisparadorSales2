/**
 * Limites e recursos liberados por plano ("entitlements").
 *
 * Para criar um novo limite ou recurso basta acrescentar uma linha em ENTITLEMENTS: o painel passa a
 * oferecê-lo nos planos e a licença assinada passa a carregá-lo. `null` significa ilimitado.
 * Valor efetivo = padrão do sistema ← plano ← ajuste específico do escritório.
 */
export const ENTITLEMENTS = {
  max_advogados: { tipo: "limite", padrao: null, rotulo: "Advogados (OABs) monitorados" },
  max_usuarios: { tipo: "limite", padrao: null, rotulo: "Usuários da equipe" },
  max_numeros_whatsapp: { tipo: "limite", padrao: null, rotulo: "Números de WhatsApp" },
  max_processos: { tipo: "limite", padrao: null, rotulo: "Processos acompanhados" },
  ia_habilitada: { tipo: "recurso", padrao: true, rotulo: "Análise por IA" },
  max_armazenamento_mb: { tipo: "limite", padrao: null, rotulo: "Armazenamento de arquivos (MB)" },
  modulo_gestao: { tipo: "recurso", padrao: true, rotulo: "Módulo de gestão (pessoas e processos)" },
  modulo_arquivos: { tipo: "recurso", padrao: true, rotulo: "Arquivos por pasta e modelos de documento" },
  modulo_tarefas: { tipo: "recurso", padrao: true, rotulo: "Tarefas e Meu painel" },
  modulo_indicadores: { tipo: "recurso", padrao: true, rotulo: "Indicadores do escritório (BI)" },
  modulo_captacao: { tipo: "recurso", padrao: true, rotulo: "Captação de clientes (funil e negócios)" },
  modulo_financeiro: { tipo: "recurso", padrao: true, rotulo: "Módulo financeiro (honorários, contas e fluxo de caixa)" },
  modulo_contratos: { tipo: "recurso", padrao: true, rotulo: "Contratos com assinatura e cobrança pelo Asaas" },
  modulo_atendimento: { tipo: "recurso", padrao: false, rotulo: "Atendimento e vendas por WhatsApp com IA (DeskcommCRM)" },
} as const;

/** Como cada item aparece na página de contratação (agrupado), na ordem em que é mostrado. */
export const GRUPOS_DE_ENTITLEMENTS: { titulo: string; chaves: ChaveEntitlement[] }[] = [
  { titulo: "Capacidade", chaves: ["max_usuarios", "max_advogados", "max_processos", "max_numeros_whatsapp", "max_armazenamento_mb"] },
  { titulo: "Publicações e processos", chaves: ["ia_habilitada", "modulo_gestao"] },
  { titulo: "Gestão do escritório", chaves: ["modulo_arquivos", "modulo_tarefas", "modulo_indicadores", "modulo_captacao"] },
  { titulo: "Financeiro e contratos", chaves: ["modulo_financeiro", "modulo_contratos"] },
  { titulo: "Atendimento", chaves: ["modulo_atendimento"] },
];

export type ChaveEntitlement = keyof typeof ENTITLEMENTS;
export type ValorEntitlement = number | boolean | null;
export type Entitlements = Partial<Record<ChaveEntitlement, ValorEntitlement>>;
export const CHAVES_ENTITLEMENTS = Object.keys(ENTITLEMENTS) as ChaveEntitlement[];

export class EntitlementInvalido extends Error {}

/** Valida e descarta chaves desconhecidas. Limite = inteiro >= 0 ou null; recurso = booleano. */
export function normalizarEntitlements(entrada: unknown): Entitlements {
  if (entrada === undefined || entrada === null || entrada === "") return {};
  if (typeof entrada !== "object" || Array.isArray(entrada)) throw new EntitlementInvalido("Os limites do plano precisam ser um objeto.");
  const saida: Entitlements = {};
  for (const [chave, valor] of Object.entries(entrada as Record<string, unknown>)) {
    if (!(chave in ENTITLEMENTS)) throw new EntitlementInvalido(`Limite desconhecido: ${chave}.`);
    const definicao = ENTITLEMENTS[chave as ChaveEntitlement];
    if (definicao.tipo === "recurso") {
      if (typeof valor !== "boolean") throw new EntitlementInvalido(`${definicao.rotulo}: use ligado ou desligado.`);
      (saida as Record<string, ValorEntitlement>)[chave] = valor;
    } else {
      if (valor !== null && !(typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= 1_000_000))
        throw new EntitlementInvalido(`${definicao.rotulo}: informe um número inteiro ou deixe ilimitado.`);
      (saida as Record<string, ValorEntitlement>)[chave] = valor;
    }
  }
  return saida;
}

/** Camadas em ordem de prioridade crescente; chave ausente herda a anterior. */
export function combinarEntitlements(...camadas: Entitlements[]): Record<ChaveEntitlement, ValorEntitlement> {
  const efetivo = Object.fromEntries(CHAVES_ENTITLEMENTS.map((k) => [k, ENTITLEMENTS[k].padrao])) as Record<ChaveEntitlement, ValorEntitlement>;
  for (const camada of camadas) for (const k of CHAVES_ENTITLEMENTS) if (camada && k in camada && camada[k] !== undefined) efetivo[k] = camada[k] as ValorEntitlement;
  return efetivo;
}

export function limiteDe(entitlements: Entitlements, chave: ChaveEntitlement): number | null {
  const v = combinarEntitlements(entitlements)[chave];
  return typeof v === "number" ? v : null;
}
export function recursoLiberado(entitlements: Entitlements, chave: ChaveEntitlement): boolean {
  return combinarEntitlements(entitlements)[chave] !== false;
}
/** `usoAtual` é a quantidade já existente; criar mais um excede quando usoAtual + 1 > limite. */
export function excedeLimite(entitlements: Entitlements, chave: ChaveEntitlement, usoAtual: number): { excede: boolean; limite: number | null } {
  const limite = limiteDe(entitlements, chave);
  return { excede: limite !== null && usoAtual + 1 > limite, limite };
}
