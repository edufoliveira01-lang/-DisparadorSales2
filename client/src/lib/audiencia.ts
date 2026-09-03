import type { Pericia } from "@/lib/types";

export const VARIAVEIS_AUDIENCIA = [
  "NOME",
  "TIPO_PERICIA",
  "DATA",
  "HORARIO",
  "LOCAL",
  "TELEFONE",
  "WHATSAPP",
  "PROCESSO",
  "PROFISSIONAL_PERITO",
];

export type ModalidadeAudiencia = "presencial" | "online" | "hibrida";

export const EXEMPLO_AUDIENCIA_PRESENCIAL: Pericia = {
  tipo: "PRESENCIAL",
  data: "03/09/2026",
  horario: "15:00",
  local: "Rua Exemplo, 100, Centro, Cidade/UF",
  nome: "CLIENTE EXEMPLO",
  telefone: "(11) 90000-0000",
  whatsapp: "SIM",
  processo: "0000000-00.2026.0.00.0000",
  profissionalPerito: "PROFISSIONAL EXEMPLO",
  origem: "audiencia",
};

export const EXEMPLO_AUDIENCIA_ONLINE: Pericia = {
  ...EXEMPLO_AUDIENCIA_PRESENCIAL,
  tipo: "ONLINE",
  local: "https://meet.example.com/sala-exemplo",
};

export const EXEMPLO_AUDIENCIA_HIBRIDA: Pericia = {
  ...EXEMPLO_AUDIENCIA_PRESENCIAL,
  tipo: "HÍBRIDA",
  local: "Rua Exemplo, 100, Centro, Cidade/UF ou https://meet.example.com/sala-exemplo",
};

const MODALIDADE_ONLINE_RE = /ONLINE|VIRTUAL|REMOT[OA]|V[IÍ]DEO\s*CONFER[EÊ]NCIA|VIDEOCONFER[EÊ]NCIA|TELEPRESENCIAL|(?:GOOGLE\s+)?MEET|(?:MICROSOFT\s+)?TEAMS|ZOOM/i;
const MODALIDADE_HIBRIDA_RE = /H[IÍ]BRID[OA]|SEMIPRESENCIAL|MIST[OA]/i;

/** Espelha classificarModalidadeAudiencia do backend (server/src/services/parserService.ts). */
export function classificarModalidadeAudiencia(tipo: string): ModalidadeAudiencia {
  if (MODALIDADE_HIBRIDA_RE.test(tipo)) return "hibrida";
  if (MODALIDADE_ONLINE_RE.test(tipo)) return "online";
  return "presencial";
}
