import type { Pericia } from "@/lib/types";

export const VARIAVEIS = ["NOME", "TIPO_PERICIA", "DATA", "HORARIO", "LOCAL"];

export const EXEMPLO_PERICIAS: Pericia[] = [
  {
    tipo: "Perícia Médica",
    data: "15/07/2026",
    horario: "14:30",
    local: "Rua Exemplo, 123 - Centro",
    nome: "Maria da Silva",
    telefone: "(11) 99999-8888",
  },
  {
    tipo: "Perícia Social",
    data: "16/07/2026",
    horario: "09:00",
    local: "Fórum Central, sala 4",
    nome: "Maria da Silva",
    telefone: "(11) 99999-8888",
  },
];
