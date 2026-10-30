import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "disparazap-tests-"));
  process.env.DATA_DIR = directory;
  process.env.DISPARAZAP_TEST_DATA_DIR = directory;
  process.env.INITIAL_ADMIN_PASSWORD = "senha-somente-para-testes";
  return () => fs.rmSync(directory, { recursive: true, force: true });
}
