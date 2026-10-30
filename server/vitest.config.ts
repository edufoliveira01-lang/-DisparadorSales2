import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    // Os testes compartilham a instância SQLite inicializada pelos serviços. Um único fork evita
    // que o binding nativo do better-sqlite3 seja desmontado por vários workers ao mesmo tempo.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});

