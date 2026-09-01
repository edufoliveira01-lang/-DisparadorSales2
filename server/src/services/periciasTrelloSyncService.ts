import { getCardsFromList, type TrelloCard } from "./trelloService";
import {
  extractNomeFromCardTitle,
  parseBrazilianDate,
  parseCardDescriptionComOrigem,
  type OrigemPericia,
  type PericiaComOrigem,
} from "./parserService";
import { registrarPericiaAgendadaComResultado } from "./periciasAgendadasService";

export interface CartaoIgnoradoTrello {
  cardId: string;
  titulo: string;
  url: string;
  motivos: string[];
}

export interface ResultadoSincronizacaoTrello {
  totalCards: number;
  cardsImportados: number;
  periciasImportadas: number;
  periciasDuplicadas: number;
  periciasIgnoradas: number;
  cardsIgnorados: number;
  ignorados: CartaoIgnoradoTrello[];
}

function dataHoraDoVencimento(due: string | null): { data: string; horario: string } | null {
  if (!due) return null;
  const valor = new Date(due);
  if (!Number.isFinite(valor.getTime())) return null;

  return {
    data: valor.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    horario: valor.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

function dataHoraDoTitulo(titulo: string): { data: string; horario: string } | null {
  const data = titulo.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1];
  if (!data) return null;
  return { data, horario: titulo.match(/\b(\d{2}:\d{2})\b/)?.[1] || "" };
}

function tipoDoTitulo(titulo: string): { tipo: string; origem: OrigemPericia } {
  if (/AUDI[EÊ]NCIA/i.test(titulo)) return { tipo: "Audiência", origem: "audiencia" };
  if (/SOCIAL|P\.?\s*SOC/i.test(titulo)) return { tipo: "Perícia Social", origem: "social" };
  if (/M[EÉ]DIC|P\.?\s*M[EÉ]D/i.test(titulo)) return { tipo: "Perícia Médica", origem: "medica" };
  return { tipo: "Perícia", origem: "geral" };
}

/**
 * Completa descrições vazias ou incompletas com os dados confiáveis do próprio card.
 * O vencimento do Trello tem prioridade; data e horário no título são o segundo fallback.
 */
export function montarPericiasDoCard(card: TrelloCard): PericiaComOrigem[] {
  const extraidas = parseCardDescriptionComOrigem(card.desc);
  const dataHoraFallback = dataHoraDoVencimento(card.due) ?? dataHoraDoTitulo(card.name);
  const nomeFallback = extractNomeFromCardTitle(card.name).trim();
  const tipoFallback = tipoDoTitulo(card.name);
  const candidatas: PericiaComOrigem[] = extraidas.length > 0
    ? extraidas
    : [{ tipo: "", data: "", horario: "", local: "", nome: "", telefone: "", processo: "", origem: tipoFallback.origem }];

  return candidatas.map((pericia) => ({
    ...pericia,
    tipo: pericia.tipo || tipoFallback.tipo,
    origem: pericia.origem || tipoFallback.origem,
    nome: pericia.nome || nomeFallback,
    data: pericia.data || dataHoraFallback?.data || "",
    horario: pericia.horario || dataHoraFallback?.horario || "",
    local: pericia.local || "",
    telefone: pericia.telefone || "",
    processo: pericia.processo || "",
  }));
}

function motivosDeDadosInsuficientes(pericia: PericiaComOrigem): string[] {
  const motivos: string[] = [];
  if (!pericia.nome) motivos.push("nome do cliente ausente na descrição e no título");
  if (!pericia.tipo) motivos.push("tipo de perícia não identificado");
  if (!pericia.data) motivos.push("data ausente na descrição, no vencimento e no título");
  else if (!Number.isFinite(parseBrazilianDate(pericia.data, pericia.horario))) {
    motivos.push(`data inválida ou não reconhecida: ${pericia.data}${pericia.horario ? ` ${pericia.horario}` : ""}`);
  }
  return motivos;
}

/**
 * Importa perícias de uma lista do Trello direto para o calendário. A operação é manual,
 * idempotente e devolve um diagnóstico por card para a tela de Configurações.
 */
export async function sincronizarPericiasDoTrello(
  key: string,
  token: string,
  listId: string
): Promise<ResultadoSincronizacaoTrello> {
  const cards = await getCardsFromList(key, token, listId);

  let cardsImportados = 0;
  let periciasImportadas = 0;
  let periciasDuplicadas = 0;
  let periciasIgnoradas = 0;
  const ignorados: CartaoIgnoradoTrello[] = [];

  for (const card of cards) {
    const motivosCard = new Set<string>();
    let importadasDoCard = 0;
    let duplicadasDoCard = 0;

    try {
      const pericias = montarPericiasDoCard(card);
      for (const pericia of pericias) {
        const motivos = motivosDeDadosInsuficientes(pericia);
        if (motivos.length > 0) {
          periciasIgnoradas++;
          motivos.forEach((motivo) => motivosCard.add(motivo));
          continue;
        }

        const resultado = registrarPericiaAgendadaComResultado(card.id, pericia, "trello_sync");
        if (resultado.status === "criada") {
          periciasImportadas++;
          importadasDoCard++;
        } else if (resultado.status === "duplicada") {
          periciasDuplicadas++;
          duplicadasDoCard++;
        } else {
          periciasIgnoradas++;
          motivosCard.add("data ou horário não reconhecido pelo calendário");
        }
      }
    } catch (err) {
      console.error(`[Sincronização Trello] Erro ao importar card ${card.id}:`, err);
      periciasIgnoradas++;
      motivosCard.add(`erro inesperado durante a leitura: ${(err as Error).message}`);
    }

    if (importadasDoCard > 0) cardsImportados++;
    if (motivosCard.size > 0 || (importadasDoCard === 0 && duplicadasDoCard === 0)) {
      if (motivosCard.size === 0) motivosCard.add("nenhuma perícia identificada no cartão");
      ignorados.push({ cardId: card.id, titulo: card.name, url: card.shortUrl, motivos: [...motivosCard] });
    }
  }

  return {
    totalCards: cards.length,
    cardsImportados,
    periciasImportadas,
    periciasDuplicadas,
    periciasIgnoradas,
    cardsIgnorados: ignorados.length,
    ignorados,
  };
}
