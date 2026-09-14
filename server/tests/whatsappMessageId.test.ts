import { describe, expect, it } from "vitest";
import {
  whatsappMessageIdCandidates,
  whatsappMessageStableKey,
} from "../src/utils/whatsappMessageId";

describe("identificador de mensagem do WhatsApp", () => {
  it("aceita o identificador completo e o stanza ID", () => {
    expect(whatsappMessageIdCandidates({
      _serialized: "true_5513999999999@c.us_3EB012345678",
      id: "3EB012345678",
    })).toEqual([
      "true_5513999999999@c.us_3EB012345678",
      "3EB012345678",
    ]);
  });

  it("usa o ID reduzido quando o serializado não está disponível", () => {
    expect(whatsappMessageIdCandidates({ _serialized: undefined, id: "ABC123" })).toEqual(["ABC123"]);
  });

  it("extrai a mesma chave estável dos dois formatos", () => {
    expect(whatsappMessageStableKey("true_5513999999999@c.us_ABC123")).toBe("ABC123");
    expect(whatsappMessageStableKey("ABC123")).toBe("ABC123");
  });
});
