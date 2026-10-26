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
} from "lucide-react";
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
] as const;
export function getCurrentPage(pathname: string) {
  return (
    navigation.find((item) => item.to === pathname) ??
    navigation.find(
      (item) => item.to !== "/" && pathname.startsWith(item.to + "/"),
    ) ??
    navigation[0]
  );
}
