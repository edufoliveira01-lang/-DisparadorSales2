import type { Pericia } from "@/lib/types";

export const VARIAVEIS_AUDIENCIA = ["NOME", "DATA", "HORARIO", "LOCAL", "PROCESSO"];

export type ModalidadeAudiencia = "presencial" | "online" | "hibrida";

export const EXEMPLO_AUDIENCIA_PRESENCIAL: Pericia = {
  tipo: "PRESENCIAL",
  data: "03/09/2026",
  horario: "15:00",
  local: "Avenida Antônio Emmerich, nº 1238, Vila São Jorge, São Vicente/SP",
  nome: "Creide Augusta",
  telefone: "(11) 99999-8888",
  processo: "5004217-88.2024.4.03.6321",
  origem: "audiencia",
};

export const EXEMPLO_AUDIENCIA_ONLINE: Pericia = {
  ...EXEMPLO_AUDIENCIA_PRESENCIAL,
  tipo: "ONLINE",
  local: "https://meet.google.com/abc-defg-hij",
};

export const EXEMPLO_AUDIENCIA_HIBRIDA: Pericia = {
  ...EXEMPLO_AUDIENCIA_PRESENCIAL,
  tipo: "HÍBRIDA",
  local: "Avenida Antônio Emmerich, nº 1238, Vila São Jorge, São Vicente/SP ou https://meet.google.com/abc-defg-hij",
};

const MODALIDADE_ONLINE_RE = /ONLINE|VIRTUAL|VIDEOCONFER[EÊ]NCIA|TELEPRESENCIAL/i;
const MODALIDADE_HIBRIDA_RE = /H[IÍ]BRID[OA]/i;

/** Espelha classificarModalidadeAudiencia do backend (server/src/services/parserService.ts). */
export function classificarModalidadeAudiencia(tipo: string): ModalidadeAudiencia {
  if (MODALIDADE_HIBRIDA_RE.test(tipo)) return "hibrida";
  if (MODALIDADE_ONLINE_RE.test(tipo)) return "online";
  return "presencial";
}
