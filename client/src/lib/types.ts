export interface Pericia {
  tipo: string;
  data: string;
  horario: string;
  local: string;
  nome: string;
  telefone: string;
  whatsapp?: string;
  processo?: string;
  profissionalPerito?: string;
  origem?: "medica" | "social" | "geral" | "audiencia";
}

export type ModoEnvio = "template" | "audiencia_presencial" | "audiencia_online" | "audiencia_hibrida";

export interface Contact {
  id: number;
  nome: string;
  telefone: string;
  processo: string | null;
  observacoes: string | null;
  created_at: string;
}

export interface Template {
  id: number;
  nome: string;
  conteudo_1_pericia: string;
  conteudo_2_pericias: string;
  conteudo_pericia_medica: string | null;
  conteudo_pericia_social: string | null;
  modo_envio_2_pericias: "combinada" | "separadas";
  created_at: string;
}

export interface SendLog {
  id: number;
  card_id: string;
  card_nome: string | null;
  contact_id: number | null;
  telefone: string | null;
  pericias_json: string | null;
  mensagem_enviada: string | null;
  status: "sucesso" | "falha";
  erro: string | null;
  whatsapp_message_id: string | null;
  /** -1 erro, 0 pendente, 1 enviado ao servidor, 2 entregue (✓✓ cinza), 3 lido (✓✓ azul), 4 áudio reproduzido. */
  ack: number | null;
  ack_updated_at: string | null;
  tipo_envio: "disparo" | "lembrete";
  created_at: string;
  /** Dados do pending_reply correlato (mesmo whatsapp_message_id), quando esse envio estava sob
   * monitoramento de resposta. Ausente/null quando nunca houve monitoramento para esse envio. */
  resposta_status?: "aguardando" | "respondido" | "cancelado" | null;
  resposta_resolved_at?: string | null;
  resposta_tipo?: "mensagem" | "reacao" | null;
  resposta_preview?: string | null;
}

export interface SystemLog {
  id: number;
  nivel: "info" | "aviso" | "erro";
  categoria: string;
  evento: string;
  titulo: string;
  mensagem: string | null;
  origem: "automatico" | "usuario" | "sistema";
  detalhes_json: string | null;
  created_at: string;
}

export interface CardViewModel {
  cardId: string;
  cardNome: string;
  shortUrl: string;
  due: string | null;
  pericias: Pericia[];
  incompleta: boolean;
  nomeCliente: string;
  contato: Contact | null;
  sugestaoContato: Contact | null;
  criterioContato: "nome_processo" | "somente_nome" | "nome_aproximado" | "processo_divergente" | "telefone_card" | null;
  ultimoEnvio: { status: "sucesso" | "falha"; data: string; erro: string | null } | null;
}

export interface WhatsappState {
  status: "desconectado" | "inicializando" | "aguardando_qr" | "autenticado" | "conectado" | "falha";
  qrDataUrl: string | null;
  lastError: string | null;
  syncProgress?: number | null;
  sessionSaved?: boolean;
}

export interface Settings {
  trello_key?: string;
  trello_token_configurado?: string;
  trello_board_id?: string;
  trello_board_nome?: string;
  trello_list_id?: string;
  trello_list_nome?: string;
  trello_move_list_id?: string;
  trello_move_list_nome?: string;
  trello_confirm_list_id?: string;
  trello_confirm_list_nome?: string;
  trello_arquivo_list_id?: string;
  trello_arquivo_list_nome?: string;
  send_interval_min: string;
  send_interval_max: string;
  template_ativo_id?: string;
  telegram_bot_token_configurado?: string;
  telegram_chat_id?: string;
  telegram_alerta_horas: string;
  telegram_alerta_horas_resposta: string;
  whapi_token_configurado?: string;
  whapi_api_url?: string;
  whapi_numero_notificacao?: string;
  cobranca_mensagem: string;
  cobranca_audiencia_mensagem: string;
  audiencia_presencial_mensagem: string;
  audiencia_online_mensagem: string;
  audiencia_hibrida_mensagem: string;
  lembrete_hoje_mensagem: string;
  lembrete_amanha_mensagem: string;
  lembrete_futuro_mensagem: string;
}

export type GoogleCalendarTimingMode = "all_day" | "fixed_time" | "appointment_time";

export interface GoogleCalendarDestinationConfig {
  destination: number;
  name: string;
  enabled: boolean;
  calendarId: string;
  calendarName: string;
  titleTemplate: string;
  uppercaseTitle: boolean;
  timingMode: GoogleCalendarTimingMode;
  startDaysBefore: number;
  endDaysAfter: number;
  fixedTime: string;
  durationMinutes: number;
  createMissing: boolean;
  includePhone: boolean;
  includeProcess: boolean;
  includeProfessional: boolean;
  includeLocation: boolean;
  visibility: "default" | "private";
  transparency: "opaque" | "transparent";
  colorId: string;
}

export interface GoogleCalendarConfig {
  syncEnabled: boolean;
  destinations: GoogleCalendarDestinationConfig[];
}

export interface GoogleCalendarStatus {
  serverConfigured: boolean;
  connected: boolean;
  accountEmail: string | null;
  config: GoogleCalendarConfig;
  linkedEvents: number;
  syncErrors: number;
  lastSync: string | null;
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string;
}

export interface GoogleCalendarAnalysisDestination {
  destination: number;
  name: string;
  calendarName: string;
  total: number;
  linked: number;
  matched: number;
  missing: number;
  conflicts: number;
  conflictItems: Array<{ periciaId: number; nome: string; data: string; horario: string | null }>;
}

export interface GoogleCalendarAnalysis {
  totalEvents: number;
  destinations: GoogleCalendarAnalysisDestination[];
}

export interface GoogleCalendarSyncResult {
  total: number;
  linked: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  conflicts: number;
  errors: number;
}

export interface PericiaAgendada {
  id: number;
  card_id: string;
  tipo: string;
  origem: "medica" | "social" | "geral" | "audiencia" | null;
  nome: string;
  telefone: string;
  telefone_digits: string;
  processo: string | null;
  data: string;
  horario: string | null;
  local: string | null;
  whatsapp: string | null;
  profissional_perito: string | null;
  data_hora_ms: number;
  status: "ativa" | "substituida";
  substituida_por_id: number | null;
  fonte: "whatsapp" | "trello_sync";
  ultimo_lembrete_em: string | null;
  ultimo_lembrete_log_id: number | null;
  lembrete_ack: number | null;
  created_at: string;
}

export interface PendingReply {
  id: number;
  card_id: string;
  card_nome: string | null;
  telefone: string;
  telefone_digits: string;
  whatsapp_chat_id: string | null;
  status: "aguardando" | "respondido" | "cancelado";
  tipo_resposta: "mensagem" | "reacao" | null;
  resposta_preview: string | null;
  whatsapp_message_id: string | null;
  send_log_id: number | null;
  /** -1 erro, 0 pendente, 1 enviado ao servidor, 2 entregue (✓✓ cinza), 3 lido (✓✓ azul), 4 áudio reproduzido. */
  ack: number | null;
  ack_updated_at: string | null;
  created_at: string;
  resolved_at: string | null;
}
