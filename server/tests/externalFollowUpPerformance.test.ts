import assert from "node:assert/strict";
import { beforeEach, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  publicacoes: [] as Record<string, unknown>[],
  estados: [] as Record<string, unknown>[],
  leituras: 0,
}));
vi.mock("../src/db", () => ({
  db: {
    prepare(sql: string) {
      return {
        get: () => ({ aguardo_dias: 30 }),
        all: () => {
          if (sql.includes("FROM djen_acompanhamentos_obrigacoes")) return fixture.estados;
          if (sql.includes("FROM djen_historico")) return [];
          fixture.leituras++;
          return fixture.publicacoes;
        },
      };
    },
  },
}));
vi.mock("../src/services/djen/store", () => ({ DjenInputError: class extends Error {} }));
import { listarObrigacoesExternas, listarObrigacoesExternasAsync } from "../src/services/djen/externalFollowUp";

beforeEach(() => {
  fixture.estados = [];
  fixture.leituras = 0;
  fixture.publicacoes = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1, processo_chave: "p" + i, data_disponibilizacao: "2020-01-01",
    texto: "Intime-se o perito para apresentar o laudo em 10 dias.",
    situacao: "", ia_json: null, processo: "n" + i, cliente_nome: null,
  }));
});

it("mantém os mesmos acompanhamentos na versão síncrona e assíncrona", async () => {
  const expected = listarObrigacoesExternas();
  assert.equal(expected.length, 12);
  assert.deepEqual(await listarObrigacoesExternasAsync(), expected);
});

it("compartilha a varredura simultânea e libera o event loop entre lotes", async () => {
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const first = listarObrigacoesExternasAsync();
  const second = listarObrigacoesExternasAsync();
  assert.equal(first, second);
  await Promise.all([first, second]);
  assert.equal(fixture.leituras, 1);
  assert.equal(yielded, true);
});

it("reflete uma resolução manual na leitura seguinte sem resultado desatualizado", async () => {
  assert.equal((await listarObrigacoesExternasAsync()).length, 12);
  fixture.estados = [{ publicacao_id: 1, tipo: "perito_laudo", status: "resolvido", ultima_cobranca_em: null }];
  assert.equal((await listarObrigacoesExternasAsync()).length, 11);
});

it("atualiza o acompanhamento quando o texto da publicação é corrigido", async () => {
  assert.equal((await listarObrigacoesExternasAsync()).length, 12);
  fixture.publicacoes[0].texto = "Intime-se a parte autora para ciência.";
  assert.equal((await listarObrigacoesExternasAsync()).length, 11);
});

