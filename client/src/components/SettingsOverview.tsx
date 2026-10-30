import {
  ArrowRight,
  BrainCircuit,
  Bell,
  CalendarDays,
  Database,
  KeyRound,
  MessageCircle,
  Palette,
  Timer,
  Trello,
} from "lucide-react";
import { Badge } from "./ui/Badge";

const sections = [
  { key: "ia", title: "Inteligência artificial", description: "Provedor, modelos, credenciais e conexão da conta ChatGPT.", icon: BrainCircuit },
  {key:"prazos",title:"Prazos e calendários",description:"Agenda processual, feriados, suspensões e calendários de cada tribunal.",icon:CalendarDays},
  {
    key: "whatsapp",
    title: "WhatsApp",
    description: "Conexão, QR Code e sessão usada nos avisos aos clientes.",
    icon: MessageCircle,
  },
  {
    key: "trello",
    title: "Trello",
    description:
      "Quadro, listas de origem, confirmação e importação dos compromissos.",
    icon: Trello,
  },
  {
    key: "google",
    title: "Google Agenda",
    description: "Conta, destinos e sincronização do calendário de perícias.",
    icon: CalendarDays,
  },
  {
    key: "notificacoes",
    title: "Notificações",
    description:
      "Alertas por Telegram e WhatsApp, entrega e ausência de resposta.",
    icon: Bell,
  },
  {
    key: "intervalo",
    title: "Intervalo entre envios",
    description: "Tempo de espera usado nos disparos individuais e em lote.",
    icon: Timer,
  },
  {
    key: "acesso",
    title: "Dados de acesso",
    description: "Usuário, senha e e-mail para recuperação da conta.",
    icon: KeyRound,
  },
  {
    key: "aparencia",
    title: "Aparência",
    description: "Tema claro ou escuro para este navegador.",
    icon: Palette,
  },
  {
    key: "backup",
    title: "Backup",
    description: "Cópia dos dados e restauração de um arquivo de segurança.",
    icon: Database,
  },
] as const;
export type SettingsSectionKey = (typeof sections)[number]["key"];
export function SettingsOverview({
  onOpen,
  whatsappConnected,
  selected,
}: {
  onOpen: (section: SettingsSectionKey) => void;
  whatsappConnected: boolean;
  selected?: SettingsSectionKey | null;
}) {
  return (
    <div
      className="settings-navigation"
      aria-label="Ferramentas e configurações"
    >
      {sections.map(({ key, title, description, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-label={`Configurar ${title}`}
          onClick={() => onOpen(key)}
          aria-current={selected === key ? "page" : undefined}
          className="group settings-nav-item"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300">
              <Icon className="h-5 w-5" />
            </span>
            {key === "whatsapp" && (
              <Badge tone={whatsappConnected ? "success" : "warning"}>
                {whatsappConnected ? "Conectado" : "Desconectado"}
              </Badge>
            )}
          </div>
          <h2 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            {description}
          </p>
          <span className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-accent-600 dark:text-accent-300">
            Configurar{" "}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      ))}
    </div>
  );
}


