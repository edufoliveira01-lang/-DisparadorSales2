/**
 * Armazenamento externo — o que fica GRAVADO no banco do escritório: a conexão com o drive (segredos criptografados), o vínculo cliente → pasta
 * (pelo identificador da pasta no provedor) e a fila de envio.
 *
 * Mesmo padrão do ZapSign (`zapsign/config.ts`): as tabelas nascem aqui (`CREATE TABLE IF NOT EXISTS`), os segredos passam por `cifrar/decifrar`
 * (AES-256-GCM, `ENCRYPTION_KEY` do escritório) e NADA secreto volta para a tela: só o final da chave e o nome da conta.
 */
import crypto from "node:crypto";
import { db } from "../db";
import { cifrar, decifrar } from "../services/gestao/segredos";
import { aplicarConfigDePastas, ErroArmazenamento, nomeDaPastaDoTipo, normalizarNomeDeTipo, normalizarRaiz, raizDosClientes, TIPOS_DE_PASTA } from "./pastas";
import type { RepositorioDeVinculos, Vinculo } from "./servico";

export type Provedor = "dropbox";

db.exec(`
CREATE TABLE IF NOT EXISTS armazenamento_config (
  id INTEGER PRIMARY KEY CHECK(id=1),
  provedor TEXT NOT NULL DEFAULT 'dropbox',
  app_key TEXT NOT NULL DEFAULT '',
  app_secret_cifrado TEXT NOT NULL DEFAULT '',
  refresh_token_cifrado TEXT NOT NULL DEFAULT '',
  conta_nome TEXT NOT NULL DEFAULT '', conta_email TEXT NOT NULL DEFAULT '', conta_tipo TEXT NOT NULL DEFAULT '',
  raiz_de_nomes TEXT NOT NULL DEFAULT '',
  conectado_em TEXT
);
CREATE TABLE IF NOT EXISTS armazenamento_estados (
  state TEXT PRIMARY KEY,
  usuario_id INTEGER,
  expira_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS armazenamento_pastas (
  pessoa_id INTEGER PRIMARY KEY REFERENCES gestao_pessoas(id) ON DELETE CASCADE,
  provedor TEXT NOT NULL DEFAULT 'dropbox',
  pasta_id TEXT NOT NULL,
  caminho TEXT NOT NULL,
  nome_pasta TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'auto' CHECK(origem IN ('auto','manual')),
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS armazenamento_fila (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pessoa_id INTEGER NOT NULL REFERENCES gestao_pessoas(id) ON DELETE CASCADE,
  arquivo_id INTEGER NOT NULL,
  tipo_pasta TEXT NOT NULL,
  titulo TEXT NOT NULL,
  extensao TEXT NOT NULL DEFAULT 'pdf',
  data_documento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aguardando_pasta','enviado','erro')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em INTEGER NOT NULL DEFAULT 0,
  ultimo_erro TEXT NOT NULL DEFAULT '',
  candidatas TEXT NOT NULL DEFAULT '[]',
  caminho_final TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_em TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_armazenamento_fila_arquivo ON armazenamento_fila(arquivo_id);
CREATE INDEX IF NOT EXISTS idx_armazenamento_fila_status ON armazenamento_fila(status, proxima_tentativa_em);
`);

// Colunas novas (pasta-raiz e nomes das pastas de tipo, por escritório) em bancos que já tinham a tabela.
for (const col of ["pasta_raiz TEXT NOT NULL DEFAULT ''", "nomes_dos_tipos TEXT NOT NULL DEFAULT '{}'"]) {
  try { db.exec(`ALTER TABLE armazenamento_config ADD COLUMN ${col}`); } catch { /* já existe */ }
}

interface LinhaConfig {
  pasta_raiz?: string; nomes_dos_tipos?: string;
  provedor: string; app_key: string; app_secret_cifrado: string; refresh_token_cifrado: string;
  conta_nome: string; conta_email: string; conta_tipo: string; raiz_de_nomes: string; conectado_em: string | null;
}
const linhaConfig = () => db.prepare("SELECT * FROM armazenamento_config WHERE id=1").get() as LinhaConfig | undefined;

function carregarConfigDePastas() {
  const l = linhaConfig();
  let tipos: Record<string, unknown> = {};
  try { tipos = JSON.parse(l?.nomes_dos_tipos || "{}"); } catch { /* padrão */ }
  aplicarConfigDePastas(l?.pasta_raiz, tipos);
}
carregarConfigDePastas();

/** As pastas em uso: a raiz e o nome de cada tipo (a chave é o nome padrão). */
export function pastasConfiguradas() {
  return { raiz: raizDosClientes(), tipos: TIPOS_DE_PASTA.map((chave) => ({ chave, nome: nomeDaPastaDoTipo(chave) })) };
}

/**
 * Salva onde os documentos ficam. Trocar a RAIZ invalida os vínculos cliente → pasta (apontam para a raiz antiga): são apagados e o sistema volta a
 * procurar por nome na raiz nova. Arquivos já enviados NÃO são movidos nem apagados no drive.
 */
export function salvarPastas(d: { raiz?: unknown; tipos?: unknown }) {
  const raiz = normalizarRaiz(d.raiz ?? raizDosClientes());
  const recebidos = (d.tipos && typeof d.tipos === "object" ? d.tipos : {}) as Record<string, unknown>;
  const nomes: Record<string, string> = {};
  const usados = new Set<string>();
  for (const t of TIPOS_DE_PASTA) {
    const n = normalizarNomeDeTipo(recebidos[t] ?? nomeDaPastaDoTipo(t));
    if (usados.has(n.toLowerCase())) throw new ErroArmazenamento(`Duas pastas de tipo não podem ter o mesmo nome ("${n}").`);
    usados.add(n.toLowerCase());
    if (n !== t) nomes[t] = n;
  }
  const mudouRaiz = raiz.toLowerCase() !== raizDosClientes().toLowerCase();
  db.prepare("INSERT INTO armazenamento_config(id) VALUES (1) ON CONFLICT(id) DO NOTHING").run();
  db.prepare("UPDATE armazenamento_config SET pasta_raiz=?, nomes_dos_tipos=? WHERE id=1").run(raiz === "/CLIENTES" ? "" : raiz, JSON.stringify(nomes));
  let vinculosRemovidos = 0;
  if (mudouRaiz) vinculosRemovidos = db.prepare("DELETE FROM armazenamento_pastas").run().changes;
  carregarConfigDePastas();
  return { ...pastasConfiguradas(), vinculos_removidos: vinculosRemovidos };
}

/** Credenciais completas (em claro) — SÓ para uso interno do servidor. `null` enquanto não houver app key, secret e conexão. */
export function lerConexao(): { appKey: string; appSecret: string; refreshToken: string; raizDeNomes: string } | null {
  const l = linhaConfig();
  if (!l || !l.app_key || !l.app_secret_cifrado || !l.refresh_token_cifrado) return null;
  return { appKey: l.app_key, appSecret: decifrar(l.app_secret_cifrado), refreshToken: decifrar(l.refresh_token_cifrado), raizDeNomes: l.raiz_de_nomes };
}

/** Só as credenciais do app (sem a conexão) — para montar o endereço de autorização e trocar o código. */
export function lerCredenciais(): { appKey: string; appSecret: string } | null {
  const l = linhaConfig();
  if (!l || !l.app_key || !l.app_secret_cifrado) return null;
  return { appKey: l.app_key, appSecret: decifrar(l.app_secret_cifrado) };
}

/** O que a tela pode ver: nunca a secret nem o token. */
export function configPublica() {
  const l = linhaConfig();
  return {
    provedor: "dropbox" as Provedor,
    credenciais_salvas: Boolean(l?.app_key && l.app_secret_cifrado),
    app_key_final: l?.app_key ? `…${l.app_key.slice(-4)}` : "",
    conectado: Boolean(l?.refresh_token_cifrado),
    conta: l?.refresh_token_cifrado ? { nome: l.conta_nome, email: l.conta_email, tipo: l.conta_tipo, equipe: Boolean(l.raiz_de_nomes) } : null,
    conectado_em: l?.conectado_em ?? null,
  };
}

export function salvarCredenciais(d: { appKey?: unknown; appSecret?: unknown }) {
  const atual = linhaConfig();
  const key = typeof d.appKey === "string" ? d.appKey.trim() : "";
  const secret = typeof d.appSecret === "string" ? d.appSecret.trim() : "";
  if (!key && !atual?.app_key) throw new ErroArmazenamento("Informe a App key do Dropbox.");
  if (key && (key.length < 8 || /\s/.test(key))) throw new ErroArmazenamento("A App key do Dropbox parece inválida.");
  if (!secret && !atual?.app_secret_cifrado) throw new ErroArmazenamento("Informe a App secret do Dropbox.");
  if (secret && (secret.length < 8 || /\s/.test(secret))) throw new ErroArmazenamento("A App secret do Dropbox parece inválida.");
  const mudouApp = (key && key !== atual?.app_key) || Boolean(secret);
  db.prepare(`INSERT INTO armazenamento_config(id,provedor,app_key,app_secret_cifrado) VALUES (1,'dropbox',?,?)
    ON CONFLICT(id) DO UPDATE SET app_key=excluded.app_key, app_secret_cifrado=excluded.app_secret_cifrado`)
    .run(key || atual!.app_key, secret ? cifrar(secret) : atual!.app_secret_cifrado);
  // Trocou de app: a conexão antiga era DO app anterior e deixa de valer.
  if (mudouApp && atual?.refresh_token_cifrado) desconectar();
  return configPublica();
}

export function salvarConexao(c: { refreshToken: string; conta: { nome: string; email: string; tipo: string; raizDeNomes: string } }) {
  if (!linhaConfig()?.app_key) throw new ErroArmazenamento("Salve a App key e a App secret antes de conectar.", 409);
  db.prepare("UPDATE armazenamento_config SET refresh_token_cifrado=?, conta_nome=?, conta_email=?, conta_tipo=?, raiz_de_nomes=?, conectado_em=CURRENT_TIMESTAMP WHERE id=1")
    .run(cifrar(c.refreshToken), c.conta.nome, c.conta.email, c.conta.tipo, c.conta.raizDeNomes);
}

/** Desconecta: apaga o acesso (as credenciais do app ficam). Os vínculos e a fila ficam para quando reconectar. */
export function desconectar() {
  db.prepare("UPDATE armazenamento_config SET refresh_token_cifrado='', conta_nome='', conta_email='', conta_tipo='', raiz_de_nomes='', conectado_em=NULL WHERE id=1").run();
}

/** O `state` do OAuth: impede que alguém complete a conexão com um código de outra sessão. Vale 10 minutos e só uma vez. */
export function novoEstado(usuarioId: number | null, agora = Date.now()): string {
  db.prepare("DELETE FROM armazenamento_estados WHERE expira_em < ?").run(agora);
  const state = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO armazenamento_estados(state,usuario_id,expira_em) VALUES (?,?,?)").run(state, usuarioId, agora + 10 * 60_000);
  return state;
}
export function consumirEstado(state: unknown, usuarioId: number | null, agora = Date.now()): boolean {
  if (typeof state !== "string" || !/^[0-9a-f]{48}$/.test(state)) return false;
  const l = db.prepare("SELECT usuario_id, expira_em FROM armazenamento_estados WHERE state=?").get(state) as { usuario_id: number | null; expira_em: number } | undefined;
  db.prepare("DELETE FROM armazenamento_estados WHERE state=?").run(state);
  return Boolean(l && l.expira_em >= agora && l.usuario_id === usuarioId);
}

/** O vínculo cliente → pasta, guardado pelo IDENTIFICADOR da pasta no provedor. */
export const repositorioDeVinculos: RepositorioDeVinculos = {
  vinculoDaPessoa(pessoaId) {
    const l = db.prepare("SELECT pasta_id, caminho, nome_pasta, origem FROM armazenamento_pastas WHERE pessoa_id=?").get(pessoaId) as
      { pasta_id: string; caminho: string; nome_pasta: string; origem: "auto" | "manual" } | undefined;
    return l ? { pessoaId, pastaId: l.pasta_id, caminho: l.caminho, nomePasta: l.nome_pasta, origem: l.origem } : null;
  },
  salvarVinculo(v: Vinculo) {
    db.prepare(`INSERT INTO armazenamento_pastas(pessoa_id,provedor,pasta_id,caminho,nome_pasta,origem) VALUES (?,?,?,?,?,?)
      ON CONFLICT(pessoa_id) DO UPDATE SET pasta_id=excluded.pasta_id, caminho=excluded.caminho, nome_pasta=excluded.nome_pasta, origem=excluded.origem, atualizado_em=CURRENT_TIMESTAMP`)
      .run(v.pessoaId, "dropbox", v.pastaId, v.caminho, v.nomePasta, v.origem);
  },
  apagarVinculo(pessoaId) { db.prepare("DELETE FROM armazenamento_pastas WHERE pessoa_id=?").run(pessoaId); },
};
