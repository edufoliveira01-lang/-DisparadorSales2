// Este guard roda antes de qualquer import dos serviços que abrem o SQLite.
if (!process.env.DISPARAZAP_TEST_DATA_DIR || process.env.DATA_DIR !== process.env.DISPARAZAP_TEST_DATA_DIR)
  throw new Error("Os testes só podem executar com o diretório temporário criado pelo Vitest.");
