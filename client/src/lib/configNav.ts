import {
  Receipt, BrainCircuit, Bell, Building2, CalendarDays, Database, FileText, KeyRound, MessageCircle, MessageSquareText, Palette, Printer, ScrollText, Search, Timer,
  Trello, UserRound, UserRoundCog, BriefcaseBusiness, Scale, Plug, Cloud, type LucideIcon,
  Landmark, Headset,
} from "lucide-react";
import type { Permission } from "@/context/AuthContext";
import { navigationPermission } from "./navigation";

export interface ItemConfig { to: string; titulo: string; descricao: string; icon: LucideIcon; permissao?: Permission | null; /** Ajuste raro: fica recolhido em «Avançado» na visão geral. */ avancado?: boolean }
export interface GrupoConfig { id: string; titulo: string; descricao: string; itens: ItemConfig[] }

/** Tudo o que é configuração fica aqui, em um só lugar: os itens "?secao=" abrem seções da página de integrações. */
export const GRUPOS_CONFIG: GrupoConfig[] = [
  { id: "escritorio", titulo: "Escritório e acesso", descricao: "Quem somos, quem usa o sistema e como cada pessoa entra.", itens: [
    { to: "/configuracoes/escritorio", titulo: "Dados do escritório", descricao: "Nome, logotipo, endereço, advogados e testemunhas.", icon: Building2 },
    { to: "/equipe", titulo: "Equipe e acessos", descricao: "Pessoas, perfis e permissões.", icon: UserRoundCog },
    { to: "/minha-conta", titulo: "Minha conta", descricao: "Seus dados de acesso e senha.", icon: UserRound },
    { to: "/configuracoes?secao=acesso", titulo: "Dados de acesso", descricao: "Usuário, senha e e-mail de recuperação.", icon: KeyRound, permissao: "integrations.manage", avancado: true },
    { to: "/configuracoes?secao=aparencia", titulo: "Aparência", descricao: "Tema claro, escuro ou automático deste navegador.", icon: Palette, permissao: "integrations.manage", avancado: true },
  ] },
  { id: "documentos", titulo: "Documentos e fichas", descricao: "Modelos que o escritório gera e imprime.", itens: [
    { to: "/configuracoes/documentos", titulo: "Documentos do escritório", descricao: "Procuração, contrato, declarações e os documentos que você criar: comum, a rogo e representado.", icon: FileText },
    { to: "/gestao/ficha", titulo: "Ficha de cadastro", descricao: "Visual da ficha impressa, logotipo e campos personalizados.", icon: Printer },
  ] },
  { id: "comunicacao", titulo: "Comunicação com clientes", descricao: "WhatsApp, mensagens, avisos e o atendimento automático.", itens: [
    { to: "/configuracoes?secao=whatsapp", titulo: "WhatsApp", descricao: "Conexão, QR Code, motor e sessão usados nos avisos.", icon: MessageCircle, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=atendimento", titulo: "Atendimento e equipe", descricao: "Entrada no atendimento, contratos com assinatura (ZapSign) e a equipe que usa o chat.", icon: Headset, permissao: "atendimento.use" },
    { to: "/configuracoes?secao=deskcomm-envio", titulo: "Envio pelo Deskcomm", descricao: "Token de API e escolha do número de WhatsApp (o mesmo do atendimento) para cobranças e avisos.", icon: MessageCircle, permissao: "integrations.manage", avancado: true },
    { to: "/templates", titulo: "Modelos de mensagens", descricao: "Textos e prévias dos avisos enviados por WhatsApp.", icon: MessageSquareText },
    { to: "/configuracoes?secao=notificacoes", titulo: "Notificações", descricao: "Alertas por Telegram e WhatsApp, entrega e falta de resposta.", icon: Bell, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=intervalo", titulo: "Intervalo entre envios", descricao: "Espera usada nos disparos individuais e em lote.", icon: Timer, permissao: "integrations.manage", avancado: true },
    { to: "/configuracoes/atendimento-ia", titulo: "Atendimento com IA", descricao: "Nome do agente, áreas atendidas, triagem e horário: o agente do WhatsApp é montado daqui.", icon: BrainCircuit },
  ] },
  { id: "financeiro", titulo: "Cobrança", descricao: "Como o escritório cobra e dá baixa nos pagamentos.", itens: [
    { to: "/configuracoes?secao=cobranca", titulo: "Cobranças e avisos", descricao: "Textos, boleto/PIX, formato de envio e avisos automáticos de vencimento.", icon: Receipt, permissao: "financeiro.manage" },
    { to: "/configuracoes?secao=asaas", titulo: "Asaas (boleto e PIX)", descricao: "Chave de API, ambiente e aviso de pagamento para cobrar e dar baixa sozinho.", icon: Landmark, permissao: "integrations.manage" },
  ] },
  { id: "processos", titulo: "Processos e prazos", descricao: "Acompanhamento no DJEN, dados dos tribunais e regras de prazo.", itens: [
    { to: "/processos/advogados", titulo: "Advogados acompanhados", descricao: "Profissionais monitorados no DJEN.", icon: BriefcaseBusiness },
    { to: "/processos/monitoramento", titulo: "Monitoramento DJEN", descricao: "Consulta e sincronização de publicações.", icon: Search },
    { to: "/configuracoes?secao=datajud", titulo: "DataJud (CNJ)", descricao: "Chave pública para completar assunto, ajuizamento e órgão dos processos.", icon: KeyRound, permissao: "integrations.manage" },
    { to: "/processos/calendarios", titulo: "Calendários de prazos", descricao: "Feriados e suspensões dos tribunais.", icon: Scale, avancado: true },
    { to: "/configuracoes?secao=prazos", titulo: "Prazos e agenda processual", descricao: "Regras da agenda processual por tribunal.", icon: CalendarDays, permissao: "integrations.manage", avancado: true },
  ] },
  { id: "integracoes", titulo: "Integrações", descricao: "Ferramentas externas conectadas ao sistema.", itens: [
    { to: "/configuracoes?secao=trello", titulo: "Trello", descricao: "Quadro, listas e importação dos compromissos.", icon: Trello, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=google", titulo: "Google Agenda", descricao: "Conta, destinos e sincronização do calendário.", icon: CalendarDays, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=dropbox", titulo: "Dropbox", descricao: "Cópia dos documentos dos clientes para as pastas do escritório.", icon: Cloud, permissao: "integrations.manage" },
    { to: "/configuracoes?secao=ia", titulo: "Inteligência artificial", descricao: "Provedor, modelos e conexão da conta ChatGPT.", icon: BrainCircuit, permissao: "integrations.manage" },
  ] },
  { id: "sistema", titulo: "Sistema", descricao: "Cópia de segurança e registro de ocorrências.", itens: [
    { to: "/configuracoes?secao=backup", titulo: "Backup", descricao: "Cópia dos dados e restauração.", icon: Database, permissao: "integrations.manage", avancado: true },
    { to: "/logs", titulo: "Atividade do sistema", descricao: "Ocorrências e resultados das integrações.", icon: ScrollText, avancado: true },
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

/** Item e grupo de uma seção "?secao=" (usado no título da página de integrações). */
export function itemDaSecao(secao: string | null | undefined): { item: ItemConfig; grupo: GrupoConfig } | null {
  if (!secao) return null;
  for (const grupo of GRUPOS_CONFIG) {
    const item = grupo.itens.find((i) => i.to === `/configuracoes?secao=${secao}`);
    if (item) return { item, grupo };
  }
  return null;
}
