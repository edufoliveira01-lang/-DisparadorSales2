import { getCardsFromList } from "./trelloService";
import { parseCardDescriptionComOrigem } from "./parserService";
import { registrarPericiaAgendada } from "./periciasAgendadasService";

export interface ResultadoSincronizacaoTrello {
  totalCards: number;
  periciasImportadas: number;
  periciasIgnoradas: number;
}

/**
 * Importa perícias de uma lista do Trello direto para o calendário, marcadas com
 * fonte = "trello_sync" — usado para casos antigos (de antes desse sistema existir, ou que
 * nunca passaram por um disparo de WhatsApp por aqui), que o fluxo normal (alimentado só por
 * envios bem-sucedidos) nunca teria como capturar. Sob demanda (o usuário clica em "Importar
 * agora" em Configurações), não é um sync automático recorrente.
 *
 * Reaproveita a mesma detecção de reagendamento do fluxo normal: se um card já importado for
 * disparado de verdade por WhatsApp depois, a entrada antiga (trello_sync) é substituída pela
 * nova (whatsapp) automaticamente, sem duplicar.
 */
export async function sincronizarPericiasDoTrello(key: string, token: string, listId: string): Promise<ResultadoSincronizacaoTrello> {
  const cards = await getCardsFromList(key, token, listId);

  let periciasImportadas = 0;
  let periciasIgnoradas = 0;

  for (const card of cards) {
    try {
      const pericias = parseCardDescriptionComOrigem(card.desc);
      for (const pericia of pericias) {
        // Card antigo/anotação manual pode não ter todos os campos — pula em vez de gerar uma
        // entrada incompleta no calendário.
        if (!pericia.tipo || !pericia.nome || !pericia.telefone) {
          periciasIgnoradas++;
          continue;
        }

        const registrada = registrarPericiaAgendada(card.id, pericia, "trello_sync");
        if (registrada) periciasImportadas++;
        else periciasIgnoradas++; // sem data reconhecível
      }
    } catch (err) {
      // Um card com problema não pode travar a importação dos demais.
      console.error(`[Sincronização Trello] Erro ao importar card ${card.id}:`, err);
      periciasIgnoradas++;
    }
  }

  return { totalCards: cards.length, periciasImportadas, periciasIgnoradas };
}
