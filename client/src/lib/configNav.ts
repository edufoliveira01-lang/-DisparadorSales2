import {
  BrainCircuit, Bell, Building2, CalendarDays, Database, FileText, KeyRound, MessageCircle, MessageSquareText, Palette, Printer, ScrollText, Search, Timer,
  Trello, UserRound, UserRoundCog, BriefcaseBusiness, Scale, Plug, type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/context/AuthContext";
import { navigationPermission } from "./navigation";

export interface ItemConfig { to: string; titulo: string; descricao: string; icon: LucideIcon; permissao?: Permission | null }
export interface GrupoConfig { id: string; titulo: string; itens: ItemConfig[] }

/** Tudo o que é configuração fica aqui, em um só lugar: os itens "?secao=" abrem seções da página de integrações. */
export const GRUPOS_CONFIG: GrupoConfig[] = [
  { id: "escritorio", titulo: "Escritório e pessoas", itens: [
    { to: "/configuracoes/escritorio", titulo: "Dados do escritório", descricao: "Nome, logotipo, endereço, advogados e testemunhas.", icon: Building2 },
    { to: "/equipe", titulo: "Equipe e acessos", descricao: "Pessoas, perfis e permissões.", icon: UserRoundCog },
    { to: "/minha-conta", titulo: "Minha conta", descricao: "Seus dados de acesso e senha.", icon: UserRound },
  ] },
  { id: "documentos", titulo: "Documentos e modelos", itens: [
    { to: "/configuracoes/documentos", titulo: "Kit de documentos", descricao: "Procuração, contrato e declarações: comum, a rogo e representado.", icon: FileText },
    { to: "/gestao/modelos", titulo: "Modelos livres", descricao: "Outros documentos do escritório (cartas, recibos, requerimentos) com dados preenchidos.", icon: FileText },
    { to: "/gestao/ficha", titulo: "Ficha de cadastro", descricao: "Visual da ficha impressa, logotipo e campos personalizados.", icon: Printer },
    { to: "/templates", titulo: "Modelos de mensagens", descricao: "Textos e prévias dos avisos enviados por WhatsApp.", icon: MessageSquareText },
  ] },
  { id: "conexoes", titulo: "Conexões e avisos", itens: [
    { to: "/configuracoes?secao=whatsapp", titulo: "WhatsApp", descricao: "Conexão, QR Code, motor e sessão usados nos avisos.", icon: MessageCircle, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=notificacoes", titulo: "Notificações", descricao: "Alertas por Telegram e WhatsApp, entrega e falta de resposta.", icon: Bell, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=intervalo", titulo: "Intervalo entre envios", descricao: "Espera usada nos disparos individuais e em lote.", icon: Timer, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=trello", titulo: "Trello", descricao: "Quadro, listas e importação dos compromissos.", icon: Trello, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=google", titulo: "Google Agenda", descricao: "Conta, destinos e sincronização do calendário.", icon: CalendarDays, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=ia", titulo: "Inteligência artificial", descricao: "Provedor, modelos e conexão da conta ChatGPT.", icon: BrainCircuit, permissao: "integrations.manage" },
  ] },
  { id: "djen", titulo: "DJEN e prazos", itens: [
    { to: "/processos/advogados", titulo: "Advogados acompanhados", descricao: "Profissionais monitorados no DJEN.", icon: BriefcaseBusiness },
    { to: "/processos/monitoramento", titulo: "Monitoramento DJEN", descricao: "Consulta e sincronização de publicações.", icon: Search },
    { to: "/processos/calendarios", titulo: "Calendários de prazos", descricao: "Feriados e suspensões dos tribunais.", icon: Scale },
    { to: "/configuracoes?secao=prazos", titulo: "Prazos e agenda processual", descricao: "Regras da agenda processual por tribunal.", icon: CalendarDays, permissao: "integrations.manage" },
  ] },
  { id: "sistema", titulo: "Sistema", itens: [
    { to: "/configuracoes?secao=aparencia", titulo: "Aparência", descricao: "Tema claro ou escuro deste navegador.", icon: Palette, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=acesso", titulo: "Dados de acesso", descricao: "Usuário, senha e e-mail de recuperação.", icon: KeyRound, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=backup", titulo: "Backup", descricao: "Cópia dos dados e restauração.", icon: Database, permissao: "integrations.manage" },
    { to: "/logs", titulo: "Atividade do sistema", descricao: "Ocorrências e resultados das integrações.", icon: ScrollText },
  ] },
];
export { Plug };

export const caminhoDoItem = (to: string) => to.split("?")[0];
export function itemPermitido(item: ItemConfig, permissoes: readonly Permission[]) {
  const exigida = item.permissao !== undefined ? item.permissao : navigationPermission(caminhoDoItem(item.to));
  return !exigida || permissoes.includes(exigida);
}
/** Rotas (sem ?secao) que pertencem à área de configurações: a barra lateral destaca "Configurações" nelas. */
export const ROTAS_CONFIG = new Set(GRUPOS_CONFIG.flatMap((g) => g.itens.map((i) => caminhoDoItem(i.to))).concat(["/configuracoes"]));
export const emAreaDeConfig = (pathname: string) => ROTAS_CONFIG.has(pathname) || pathname.startsWith("/configuracoes/") || pathname === "/templates" || pathname.startsWith("/templates/");
