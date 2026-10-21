export interface EscopoCalendario {
  tribunal: string;
  orgao: string;
  ano: number;
  municipio?: string;
  uf?: string;
  instancia?: "primeiro" | "segundo";
}
export type TipoEventoForense =
  | "feriado"
  | "suspensao"
  | "expediente_parcial"
  | "pendencia";
export interface EventoForense {
  id: string;
  tipo: TipoEventoForense;
  inicio: string;
  fim: string;
  descricao: string;
  fonte: string;
}
export interface ImportacaoOficial {
  municipio: string;
  uf?: string;
  eventos: EventoForense[];
  fontes: string[];
  avisos: string[];
}
export interface AjustesCalendario {
  adicionar: EventoForense[];
  ignorar: string[];
}
export class FonteCalendarioError extends Error {
  constructor(
    message: string,
    public motivo: "sem_fonte" | "localidade_pendente" | "erro" = "erro",
  ) {
    super(message);
  }
}
export type LerFonteOficial = (
  url: string,
  init?: { method?: "POST"; body?: string },
) => Promise<string>;
