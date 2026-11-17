import {
  CalendarDays,
  Scale,
  Columns3,
  Search,
  BriefcaseBusiness,
  LayoutDashboard,
  Users,
  MessageSquareText,
  History,
  MessageSquareReply,
  Settings,
  ScrollText,
  Clock3,
  UserRoundCog,
  UserRound,
  FolderOpen,
  Contact,
  LayoutGrid,
  ListChecks,
  FileText,
  Wallet,
  BarChart3,
  Printer,
  Building2,
  Headset,
  TrendingUp,
  Landmark,
} from "lucide-react";
import type { Permission } from "@/context/AuthContext";
export const navigation = [
  {
    to: "/pericias",
    label: "Perícias e compromissos",
    description: "Compromissos, avisos e pendências",
    icon: LayoutDashboard,
    group: "agenda",
    ativoEm: ["/calendario", "/gestao/pericias-inss"],
    end: true,
  },
  {
    to: "/gestao/pericias-inss",
    label: "Perícias do INSS",
    description: "Perícias e avaliações administrativas no INSS",
    icon: Landmark,
    group: "agenda",
    oculto: true,
  },
  {
    to: "/calendario",
    label: "Calendário",
    description: "Perícias, audiências e lembretes",
    icon: CalendarDays,
    group: "agenda",
    oculto: true,
  },
  {
    to: "/templates",
    label: "Modelos de mensagens",
    description: "Textos e prévias dos avisos",
    icon: MessageSquareText,
    group: "configuracoes",
  },
  {
    to: "/pendentes",
    label: "Aguardando resposta",
    description: "Clientes que ainda não retornaram",
    icon: MessageSquareReply,
    group: "comunicacao",
    ativoEm: ["/historico"],
  },
  {
    to: "/historico",
    label: "Histórico de envios",
    description: "Mensagens, entregas e respostas",
    icon: History,
    group: "comunicacao",
    oculto: true,
  },
  {
    to: "/processos",
    label: "Publicações",
    description: "Andamentos e publicações do DJEN",
    icon: Scale,
    group: "processos",
    ativoEm: ["/processos/quadro", "/processos/aguardando"],
    end: true,
  },
  {
    to: "/processos/quadro",
    label: "Quadro de processos",
    description: "Acompanhamento por etapa",
    icon: Columns3,
    group: "processos",
    oculto: true,
  },
  {
    to: "/processos/aguardando",
    label: "Acompanhamentos",
    description: "Determinações aguardando cumprimento",
    icon: Clock3,
    group: "processos",
    oculto: true,
  },
  {
    to: "/processos/advogados",
    label: "Advogados acompanhados no DJEN",
    description: "Profissionais acompanhados no DJEN",
    icon: BriefcaseBusiness,
    group: "configuracoes",
  },
  {
    to: "/processos/monitoramento",
    label: "Monitoramento DJEN",
    description: "Consulta e sincronização de publicações",
    icon: Search,
    group: "configuracoes",
  },
  {
    to: "/processos/calendarios",
    label: "Calendários de prazos",
    description: "Feriados e suspensões dos tribunais",
    icon: CalendarDays,
    group: "configuracoes",
  },
  {
    to: "/gestao",
    label: "Meu painel",
    description: "Suas tarefas, prazos e o resumo do escritório",
    icon: LayoutGrid,
    group: "inicio",
    end: true,
  },
  {
    to: "/gestao/tarefas",
    label: "Tarefas",
    description: "Prazos e afazeres por pessoa e processo",
    icon: ListChecks,
    group: "processos",
  },
  {
    to: "/gestao/clientes",
    label: "Clientes e processos",
    description: "Cadastro, processos, financeiro e documentos de cada cliente",
    icon: Contact,
    group: "clientes",
  },
  {
    to: "/gestao/captacao",
    label: "Captação",
    description: "De onde vêm os clientes, quantos fecham e quantos são qualificados",
    icon: TrendingUp,
    group: "clientes",
  },
  {
    to: "/gestao/ficha",
    label: "Ficha de cadastro",
    description: "Modelo da ficha impressa: logotipo, cabeçalho e campos",
    icon: Printer,
    group: "configuracoes",
  },
  {
    to: "/gestao/financeiro",
    label: "Financeiro",
    description: "Honorários, contas a pagar e receber, fluxo de caixa",
    icon: Wallet,
    group: "financeiro",
    ativoEm: ["/gestao/indicadores"],
  },
  {
    to: "/gestao/indicadores",
    label: "Indicadores",
    description: "Produtividade, estoque de processos e receita",
    icon: BarChart3,
    group: "financeiro",
    oculto: true,
  },
  {
    to: "/logs",
    label: "Atividade do sistema",
    description: "Ocorrências e resultados das integrações",
    icon: ScrollText,
    group: "configuracoes",
  },
  {
    to: "/configuracoes",
    label: "Configurações",
    description: "Central: escritório, documentos, conexões e sistema",
    icon: Settings,
    group: "configuracoes",
  },
  {
    to: "/configuracoes/escritorio",
    label: "Dados do escritório",
    description: "Nome, logotipo, endereço, advogados e testemunhas",
    icon: Building2,
    group: "configuracoes",
  },
  {
    to: "/configuracoes/documentos",
    label: "Documentos do escritório",
    description: "Procuração, contrato, declarações e documentos próprios",
    icon: FileText,
    group: "configuracoes",
  },
  {
    to: "/equipe",
    label: "Equipe e acessos",
    description: "Pessoas, perfis e permissões",
    icon: UserRoundCog,
    group: "configuracoes",
  },
  {
    to: "/minha-conta",
    label: "Minha conta",
    description: "Seus dados de acesso e senha",
    icon: UserRound,
    group: "configuracoes",
  },
] as const;

export function navigationPermission(to: string): Permission | null {
  if (to === "/atendimento") return "atendimento.use";
  if (to === "/pericias") return "dashboard.view";
  if (to === "/calendario") return "calendar.view";
  if (to.startsWith("/templates")) return "templates.view";
  if (to === "/pendentes") return "pending.view";
  if (to === "/historico") return "history.view";
  if (to === "/gestao/financeiro") return "financeiro.view";
  if (to.startsWith("/gestao")) return "gestao.view";
  if (to === "/logs") return "activity.view";
  if (to === "/configuracoes") return null;
  if (to.startsWith("/configuracoes/")) return "gestao.view";
  if (to === "/equipe") return "team.manage";
  if (to === "/processos/calendarios") return "deadlines.view";
  if (to === "/processos/monitoramento") return "djen.manage";
  if (["/processos/advogados", "/processos/aguardando"].includes(to)) return "processes.manage";
  if (to.startsWith("/processos")) return "processes.view";
  return null;
}

/** Página → módulo do plano que a libera (o servidor lista em `modulos_bloqueados` o que o plano não inclui). */
const MODULO_DA_PAGINA: Record<string, string> = {
  "/gestao/tarefas": "modulo_tarefas",
  "/gestao/captacao": "modulo_captacao",
  "/gestao/financeiro": "modulo_financeiro",
  "/gestao/indicadores": "modulo_indicadores",
};

export function permittedNavigation(permissions: readonly Permission[], modulosBloqueados: readonly string[] = []) {
  return navigation.filter((item) => {
    const modulo = MODULO_DA_PAGINA[item.to];
    if (modulo && modulosBloqueados.includes(modulo)) return false;
    const required = navigationPermission(item.to);
    return !required || permissions.includes(required);
  });
}

export function firstAllowedPage(permissions: readonly Permission[]): string {
  return permittedNavigation(permissions)[0]?.to ?? "/minha-conta";
}
export function getCurrentPage(pathname: string) {
  if (pathname.startsWith("/gestao/processos") || pathname.startsWith("/gestao/pessoas")) pathname = "/gestao/clientes";
  const exata = navigation.find((item) => item.to === pathname);
  if (exata) return exata;
  // o endereço mais específico vence (/gestao/clientes/1 é "Clientes", não "Meu painel")
  const prefixo = navigation.filter((item) => pathname.startsWith(item.to + "/")).sort((x, y) => y.to.length - x.to.length)[0];
  return prefixo ?? navigation[0];
}

export const ROTULO_GRUPO: Record<string, string> = { inicio: "Início", clientes: "Clientes", processos: "Processos e prazos", agenda: "Agenda e perícias", comunicacao: "Comunicação", financeiro: "Financeiro", configuracoes: "Configurações" };
/** Nome da área a que a página pertence (usado no topo das páginas e no rodapé). */
export const areaDaPagina = (pathname: string) => ROTULO_GRUPO[getCurrentPage(pathname).group] ?? "Sistema";

/** As páginas que ficam lado a lado numa mesma área: o menu mostra uma entrada só e cada página mostra as abas das irmãs. */
export const ABAS_DAS_AREAS: { id: string; abas: { to: string; rotulo: string }[] }[] = [
  { id: "agenda", abas: [{ to: "/pericias", rotulo: "Perícias e compromissos" }, { to: "/calendario", rotulo: "Calendário" }, { to: "/gestao/pericias-inss", rotulo: "Perícias do INSS" }] },
  { id: "djen", abas: [{ to: "/processos", rotulo: "Publicações" }, { to: "/processos/quadro", rotulo: "Quadro de processos" }, { to: "/processos/aguardando", rotulo: "Acompanhamentos" }] },
  { id: "mensagens", abas: [{ to: "/pendentes", rotulo: "Aguardando resposta" }, { to: "/historico", rotulo: "Histórico de envios" }] },
  { id: "financeiro", abas: [{ to: "/gestao/financeiro", rotulo: "Financeiro" }, { to: "/gestao/indicadores", rotulo: "Indicadores" }] },
];
