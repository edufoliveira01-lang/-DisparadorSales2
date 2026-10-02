import { afterEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { createLog, getLog } from "../src/services/logsService";
import { remarcacoesDoLog, comparacaoRemarcacao } from "../../client/src/lib/remarcacaoHistorico";

const snapshot = {
  tipo: "Perícia médica", origem: "medica", processo: "5001234-11.2026.8.26.0001", agendamento_anterior_id: 42,
  anterior: { data: "09/10/2026", horario: "08:00", local: "Local anterior" },
  novo: { data: "14/10/2026", horario: "10:00", local: "Novo local" },
};
const card = "teste:historico-remarcacao";
afterEach(() => db.prepare("DELETE FROM send_logs WHERE card_id = ?").run(card));

describe("Histórico de remarcações", () => {
  it("guarda a comparação independente da existência do agendamento antigo", () => {
    const log = createLog({ card_id: card, card_nome: "Cliente teste", telefone: "11999999999", contact_id: null,
      pericias_json: "[]", mensagem_enviada: "Texto personalizado sem datas", remarcacoes_json: JSON.stringify([snapshot]),
      status: "sucesso", erro: null });
    const stored = getLog(log.id)!;
    const changes = remarcacoesDoLog(stored);
    expect(changes).toEqual([snapshot]);
    expect(comparacaoRemarcacao(changes[0])).toBe("09/10/2026 às 08:00 → 14/10/2026 às 10:00");
  });
  it("mantém registros antigos e mensagens normais sem classificar por palavras do texto", () => {
    const log = createLog({ card_id: card, card_nome: "Cliente teste", telefone: null, contact_id: null,
      pericias_json: "[]", mensagem_enviada: "Entre em contato para solicitar remarcação", status: "sucesso", erro: null });
    expect(log.remarcacoes_json).toBeNull();
    expect(remarcacoesDoLog(log)).toEqual([]);
  });
  it("tolera metadados antigos, inválidos e incompletos", () => {
    for (const json of [undefined, null, "{", "{}", '[{"tipo":"Perícia"}]']) {
      expect(remarcacoesDoLog({ remarcacoes_json: json })).toEqual([]);
    }
  });
  it("mostra todas as comparações e não inventa um horário ausente", () => {
    const withoutTime = { ...snapshot, anterior: { ...snapshot.anterior, horario: "" } };
    expect(remarcacoesDoLog({ remarcacoes_json: JSON.stringify([snapshot, withoutTime]) })).toHaveLength(2);
    expect(comparacaoRemarcacao(withoutTime)).toBe("09/10/2026 → 14/10/2026 às 10:00");
  });
});
