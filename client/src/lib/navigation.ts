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
} from "lucide-react";
import type { Permission } from "@/context/AuthContext";
export const navigation = [
  {
    to: "/",
    label: "Visão geral",
    description: "Compromissos, avisos e pendências",
    icon: LayoutDashboard,
    group: "pericias",
    end: true,
  },
  {
    to: "/calendario",
    label: "Calendário",
    description: "Perícias, audiências e lembretes",
    icon: CalendarDays,
    group: "pericias",
  },
  {
    to: "/templates",
    label: "Modelos de mensagens",
    description: "Textos e prévias dos avisos",
    icon: MessageSquareText,
    group: "pericias",
  },
  {
    to: "/pendentes",
    label: "Aguardando resposta",
    description: "Clientes que ainda não retornaram",
    icon: MessageSquareReply,
    group: "pericias",
  },
  {
    to: "/historico",
    label: "Histórico de envios",
    description: "Mensagens, entregas e respostas",
    icon: History,
    group: "pericias",
  },
  {
    to: "/processos",
    label: "Publicações",
    description: "Andamentos e publicações do DJEN",
    icon: Scale,
    group: "processos",
    end: true,
  },
  {
    to: "/processos/quadro",
    label: "Quadro de processos",
    description: "Acompanhamento por etapa",
    icon: Columns3,
    group: "processos",
  },
  {
    to: "/processos/aguardando",
    label: "Acompanhamentos",
    description: "Determinações aguardando cumprimento",
    icon: Clock3,
    group: "processos",
  },
  {
    to: "/processos/advogados",
    label: "Advogados",
    description: "Profissionais acompanhados no DJEN",
    icon: BriefcaseBusiness,
    group: "processos",
  },
  {
    to: "/processos/monitoramento",
    label: "Monitoramento DJEN",
    description: "Consulta e sincronização de publicações",
    icon: Search,
    group: "processos",
  },
  {
    to: "/processos/calendarios",
    label: "Calendários de prazos",
    description: "Feriados e suspensões dos tribunais",
    icon: CalendarDays,
    group: "processos",
  },
  {
    to: "/gestao",
    label: "Meu painel",
    description: "Suas tarefas, prazos e o resumo do escritório",
    icon: LayoutGrid,
    group: "gestao",
    end: true,
  },
  {
    to: "/gestao/tarefas",
    label: "Tarefas",
    description: "Prazos e afazeres por pessoa e processo",
    icon: ListChecks,
    group: "gestao",
  },
  {
    to: "/gestao/clientes",
    label: "Clientes e processos",
    description: "Cadastro, processos, financeiro e documentos de cada cliente",
    icon: Contact,
    group: "gestao",
  },
  {
    to: "/gestao/modelos",
    label: "Modelos de documento",
    description: "Procuração, contrato e outros, com dados preenchidos",
    icon: FileText,
    group: "gestao",
  },
  {
    to: "/gestao/financeiro",
    label: "Financeiro",
    description: "Honorários, contas a pagar e receber, fluxo de caixa",
    icon: Wallet,
    group: "gestao",
  },
  {
    to: "/gestao/indicadores",
    label: "Indicadores",
    description: "Produtividade, estoque de processos e receita",
    icon: BarChart3,
    group: "gestao",
  },
  {
    to: "/agenda",
    label: "Contatos",
    description: "Clientes, telefones e processos",
    icon: Users,
    group: "compartilhado",
  },
  {
    to: "/logs",
    label: "Atividade do sistema",
    description: "Ocorrências e resultados das integrações",
    icon: ScrollText,
    group: "sistema",
  },
  {
    to: "/configuracoes",
    label: "Configurações",
    description: "Integrações, aparência e acesso",
    icon: Settings,
    group: "sistema",
  },
  {
    to: "/equipe",
    label: "Equipe e acessos",
    description: "Pessoas, perfis e permissões",
    icon: UserRoundCog,
    group: "sistema",
  },
  {
    to: "/minha-conta",
    label: "Minha conta",
    description: "Seus dados de acesso e senha",
    icon: UserRound,
    group: "sistema",
  },
] as const;

export function navigationPermission(to: string): Permission | null {
  if (to === "/") return "dashboard.view";
  if (to === "/calendario") return "calendar.view";
  if (to.startsWith("/templates")) return "templates.view";
  if (to === "/pendentes") return "pending.view";
  if (to === "/historico") return "history.view";
  if (to === "/agenda") return "contacts.view";
  if (to === "/gestao/financeiro") return "financeiro.view";
  if (to.startsWith("/gestao")) return "gestao.view";
  if (to === "/logs") return "activity.view";
  if (to === "/configuracoes") return "integrations.manage";
  if (to === "/equipe") return "team.manage";
  if (to === "/processos/calendarios") return "deadlines.view";
  if (to === "/processos/monitoramento") return "djen.manage";
  if (["/processos/advogados", "/processos/aguardando"].includes(to)) return "processes.manage";
  if (to.startsWith("/processos")) return "processes.view";
  return null;
}

export function permittedNavigation(permissions: readonly Permission[]) {
  return navigation.filter((item) => {
    const required = navigationPermission(item.to);
    return !required || permissions.includes(required);
  });
}

export function firstAllowedPage(permissions: readonly Permission[]): string {
  return permittedNavigation(permissions)[0]?.to ?? "/minha-conta";
}
export function getCurrentPage(pathname: string) {
  if (pathname.startsWith("/gestao/processos") || pathname.startsWith("/gestao/pessoas")) pathname = "/gestao/clientes";
  return (
    navigation.find((item) => item.to === pathname) ??
    navigation.find(
      (item) => item.to !== "/" && pathname.startsWith(item.to + "/"),
    ) ??
    navigation[0]
  );
}
