import type { Pericia } from "@/lib/types";

export const VARIAVEIS = [
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

export const EXEMPLO_PERICIAS: Pericia[] = [
  {
    tipo: "Perícia Médica",
    data: "15/07/2026",
    horario: "14:30",
    local: "Rua Exemplo, 123 - Centro",
    nome: "Maria da Silva",
    telefone: "(11) 99999-8888",
    whatsapp: "SIM",
    processo: "5001234-56.2026.4.03.6100",
    profissionalPerito: "Dr. Marcos Vinícius Lassi Alves Leocádio",
  },
  {
    tipo: "Perícia Social",
    data: "16/07/2026",
    horario: "09:00",
    local: "Fórum Central, sala 4",
    nome: "Maria da Silva",
    telefone: "(11) 99999-8888",
    whatsapp: "SIM",
    processo: "5001234-56.2026.4.03.6100",
    profissionalPerito: "Ana Lúcia Valério",
  },
];
