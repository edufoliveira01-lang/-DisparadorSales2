import type { Entitlements } from "../licenca/entitlements";

/**
 * Os quatro planos que o painel oferece de fábrica (e que a página de contratação mostra).
 * Preço e limites são ponto de partida: tudo se ajusta em Planos, no painel, sem mexer no código.
 * Limite `null` = ilimitado; recurso `false` = o plano não inclui.
 */
export interface PlanoPadrao { id: string; nome: string; preco_centavos: number; destaque?: boolean; resumo: string; entitlements: Entitlements }

export const PLANOS_PADRAO: PlanoPadrao[] = [
  {
    id: "essencial", nome: "Essencial", preco_centavos: 19700,
    resumo: "Para o advogado que quer parar de perder prazos e organizar a carteira.",
    entitlements: {
      max_usuarios: 3, max_advogados: 1, max_processos: 300, max_numeros_whatsapp: 1, max_armazenamento_mb: 2048,
      ia_habilitada: true, modulo_gestao: true, modulo_arquivos: true, modulo_tarefas: true,
      modulo_indicadores: false, modulo_captacao: false, modulo_financeiro: false, modulo_contratos: false, modulo_atendimento: false,
    },
  },
  {
    id: "profissional", nome: "Profissional", preco_centavos: 39700, destaque: true,
    resumo: "Para o escritório que quer controlar honorários e fechar contratos sem papel.",
    entitlements: {
      max_usuarios: 8, max_advogados: 3, max_processos: 1500, max_numeros_whatsapp: 2, max_armazenamento_mb: 10240,
      ia_habilitada: true, modulo_gestao: true, modulo_arquivos: true, modulo_tarefas: true,
      modulo_indicadores: true, modulo_captacao: false, modulo_financeiro: true, modulo_contratos: true, modulo_atendimento: false,
    },
  },
  {
    id: "avancado", nome: "Avançado", preco_centavos: 79700,
    resumo: "Para quem cresce com captação de clientes e atendimento por WhatsApp com IA.",
    entitlements: {
      max_usuarios: 20, max_advogados: 8, max_processos: 6000, max_numeros_whatsapp: 4, max_armazenamento_mb: 51200,
      ia_habilitada: true, modulo_gestao: true, modulo_arquivos: true, modulo_tarefas: true,
      modulo_indicadores: true, modulo_captacao: true, modulo_financeiro: true, modulo_contratos: true, modulo_atendimento: true,
    },
  },
  {
    id: "ilimitado", nome: "Ilimitado", preco_centavos: 149700,
    resumo: "Para bancas grandes: sem limites de equipe, processos, números e armazenamento.",
    entitlements: {
      max_usuarios: null, max_advogados: null, max_processos: null, max_numeros_whatsapp: null, max_armazenamento_mb: null,
      ia_habilitada: true, modulo_gestao: true, modulo_arquivos: true, modulo_tarefas: true,
      modulo_indicadores: true, modulo_captacao: true, modulo_financeiro: true, modulo_contratos: true, modulo_atendimento: true,
    },
  },
];
