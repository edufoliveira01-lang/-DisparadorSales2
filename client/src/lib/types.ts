export interface Pericia {
  tipo: string;
  data: string;
  horario: string;
  local: string;
  nome: string;
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
  conteudo_pericia_medica?: string;
  conteudo_pericia_social?: string;
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
  trello_move_to_list_id?: string;
  send_interval_min: string;
  send_interval_max: string;
  template_ativo_id?: string;
}
