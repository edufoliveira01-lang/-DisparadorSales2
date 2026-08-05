export interface Pericia {
  tipo: string;
  data: string;
  horario: string;
  local: string;
  nome: string;
  telefone: string;
  origem?: "medica" | "social" | "geral";
}

export interface Contact {
  id: number;
  nome: string;
  telefone: string;
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
  created_at: string;
  /** Dados do pending_reply correlato (mesmo whatsapp_message_id), quando esse envio estava sob
   * monitoramento de resposta. Ausente/null quando nunca houve monitoramento para esse envio. */
  resposta_status?: "aguardando" | "respondido" | "cancelado" | null;
  resposta_resolved_at?: string | null;
  resposta_tipo?: "mensagem" | "reacao" | null;
  resposta_preview?: string | null;
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
  ultimoEnvio: { status: "sucesso" | "falha"; data: string; erro: string | null } | null;
}

export interface WhatsappState {
  status: "desconectado" | "inicializando" | "aguardando_qr" | "autenticado" | "conectado" | "falha";
  qrDataUrl: string | null;
  lastError: string | null;
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
  send_interval_min: string;
  send_interval_max: string;
  template_ativo_id?: string;
  telegram_bot_token_configurado?: string;
  telegram_chat_id?: string;
  telegram_alerta_horas: string;
  telegram_alerta_horas_resposta: string;
}

export interface PendingReply {
  id: number;
  card_id: string;
  card_nome: string | null;
  telefone: string;
  telefone_digits: string;
  status: "aguardando" | "respondido" | "cancelado";
  tipo_resposta: "mensagem" | "reacao" | null;
  resposta_preview: string | null;
  whatsapp_message_id: string | null;
  /** -1 erro, 0 pendente, 1 enviado ao servidor, 2 entregue (✓✓ cinza), 3 lido (✓✓ azul), 4 áudio reproduzido. */
  ack: number | null;
  ack_updated_at: string | null;
  created_at: string;
  resolved_at: string | null;
}
