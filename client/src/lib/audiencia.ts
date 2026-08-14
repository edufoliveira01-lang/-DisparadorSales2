import type { Pericia } from "@/lib/types";

export const VARIAVEIS_AUDIENCIA = ["NOME", "DATA", "HORARIO", "LOCAL", "PROCESSO"];

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

/** Espelha classificarModalidadeAudiencia do backend (server/src/services/parserService.ts). */
export function classificarModalidadeAudiencia(tipo: string): "presencial" | "online" {
  return /ONLINE/i.test(tipo) ? "online" : "presencial";
}
