import fs from "node:fs";
import path from "node:path";
import { db, dataDir } from "../../db";
import { ErroGestao } from "./erro";
import { nomeDoEscritorio } from "./escritorio";

export const SECOES = ["identificacao", "endereco", "contato", "campos", "processos", "observacoes"] as const;
export type Secao = typeof SECOES[number];
export const ROTULO_SECAO: Record<Secao, string> = { identificacao: "Dados de identificação", endereco: "Endereço", contato: "Contato", campos: "Campos personalizados", processos: "Processos vinculados", observacoes: "Observações" };

export interface ConfigFicha {
  titulo: string; subtitulo: string; nome_escritorio: string; cabecalho_linhas: string[]; rodape: string;
  mostrar_foto: boolean; linhas_observacoes: number; secoes: Record<Secao, boolean>;
  assinatura: boolean; texto_assinatura: string;
  /** "mesma" usa o cabeçalho dos documentos; "propria" usa a imagem enviada na própria ficha. */
  logo_modo: "mesma" | "propria"; logo_alinhamento: "left" | "center" | "right";
}
export const PADRAO: ConfigFicha = {
  titulo: "FICHA PROCESSUAL", subtitulo: "Ficha de cadastro do cliente", nome_escritorio: "", cabecalho_linhas: [], rodape: "",
  mostrar_foto: true, linhas_observacoes: 9, secoes: { identificacao: true, endereco: true, contato: true, campos: true, processos: true, observacoes: true },
  assinatura: false, texto_assinatura: "", logo_modo: "mesma", logo_alinhamento: "left",
};
const txt = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

export function lerConfig(): ConfigFicha {
  const l = db.prepare("SELECT config_json FROM gestao_ficha_config WHERE id=1").get() as { config_json: string } | undefined;
  let salvo: Partial<ConfigFicha> = {};
  try { salvo = l ? JSON.parse(l.config_json) : {}; } catch { /* config corrompida: volta ao padrão */ }
  const c = normalizar({ ...PADRAO, ...salvo, secoes: { ...PADRAO.secoes, ...(salvo.secoes || {}) } });
  if (salvo.logo_modo === undefined && logoAtual()) c.logo_modo = "propria"; // quem já tinha logotipo próprio na ficha continua com ele
  if (!c.nome_escritorio) c.nome_escritorio = nomeDoEscritorio(); // o nome vem dos dados do escritório quando a ficha não tem um próprio
  return c;
}
function normalizar(c: Partial<ConfigFicha>): ConfigFicha {
  const linhas = Array.isArray(c.cabecalho_linhas) ? c.cabecalho_linhas.map((x) => txt(x, 120)).filter(Boolean).slice(0, 3) : [];
  const n = Number(c.linhas_observacoes);
  const secoes = Object.fromEntries(SECOES.map((s) => [s, c.secoes?.[s] !== false])) as Record<Secao, boolean>;
  return {
    titulo: txt(c.titulo, 60) || PADRAO.titulo, subtitulo: txt(c.subtitulo, 100), nome_escritorio: txt(c.nome_escritorio, 100), cabecalho_linhas: linhas, rodape: txt(c.rodape, 200),
    mostrar_foto: c.mostrar_foto !== false, linhas_observacoes: Number.isInteger(n) && n >= 0 && n <= 25 ? n : PADRAO.linhas_observacoes, secoes,
    assinatura: Boolean(c.assinatura), texto_assinatura: txt(c.texto_assinatura, 600),
    logo_modo: c.logo_modo === "propria" ? "propria" : "mesma", logo_alinhamento: c.logo_alinhamento === "center" || c.logo_alinhamento === "right" ? c.logo_alinhamento : "left",
  };
}
export function salvarConfig(d: unknown): ConfigFicha {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new ErroGestao("Configuração inválida.");
  const c = normalizar({ ...lerConfig(), ...(d as Partial<ConfigFicha>), secoes: { ...lerConfig().secoes, ...((d as Partial<ConfigFicha>).secoes || {}) } });
  db.prepare("INSERT INTO gestao_ficha_config(id,config_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,atualizado_em=CURRENT_TIMESTAMP").run(JSON.stringify(c));
  return c;
}

// ---------- imagens: logotipo do escritório e foto de cada pessoa ----------
type Ext = "png" | "jpg" | "webp" | "ico";
const TIPO: Record<Ext, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", ico: "image/x-icon" };
const pasta = (sub = "") => path.join(dataDir, "ficha", sub);
export function tipoDaImagem(d: Buffer): Ext | null {
  if (d.length > 8 && d.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (d.length > 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "jpg";
  if (d.length > 12 && d.toString("ascii", 0, 4) === "RIFF" && d.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (d.length > 6 && d[0] === 0 && d[1] === 0 && d[2] === 1 && d[3] === 0) return "ico";
  return null;
}
function achar(dir: string, base: string): { arquivo: string; mime: string } | null {
  for (const e of Object.keys(TIPO) as Ext[]) { const f = path.join(dir, `${base}.${e}`); if (fs.existsSync(f)) return { arquivo: f, mime: TIPO[e] }; }
  return null;
}
function gravar(dir: string, base: string, dados: Buffer, maximo: number, rotulo: string, aceitaIco = false) {
  if (!Buffer.isBuffer(dados) || dados.length === 0) throw new ErroGestao("Envie a imagem.");
  if (dados.length > maximo) throw new ErroGestao(`${rotulo}: a imagem passa de ${Math.round(maximo / 1024 / 1024)} MB.`, 413);
  const ext = tipoDaImagem(dados);
  if (!ext || (ext === "ico" && !aceitaIco)) throw new ErroGestao(`${rotulo}: use uma imagem PNG, JPG ou WebP${aceitaIco ? " (ou ICO)" : ""}.`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const e of Object.keys(TIPO)) fs.rmSync(path.join(dir, `${base}.${e}`), { force: true });
  fs.writeFileSync(path.join(dir, `${base}.${ext}`), dados, { mode: 0o600 });
}
const apagar = (dir: string, base: string) => { for (const e of Object.keys(TIPO)) fs.rmSync(path.join(dir, `${base}.${e}`), { force: true }); };

/** Imagens do escritório além do logotipo da ficha: cabeçalho e rodapé dos documentos, e o ícone (favicon) do sistema. */
export const IMAGENS = { cabecalho: { max: 2 * 1024 * 1024, rotulo: "Cabeçalho" }, rodape: { max: 2 * 1024 * 1024, rotulo: "Rodapé" }, favicon: { max: 512 * 1024, rotulo: "Ícone" } } as const;
export type NomeImagem = keyof typeof IMAGENS;
export const nomeDeImagemValido = (n: string): n is NomeImagem => Object.prototype.hasOwnProperty.call(IMAGENS, n);
export const imagemAtual = (n: NomeImagem) => achar(pasta(), n);
export const salvarImagem = (n: NomeImagem, d: Buffer) => gravar(pasta(), n, d, IMAGENS[n].max, IMAGENS[n].rotulo, n === "favicon");
export const apagarImagem = (n: NomeImagem) => apagar(pasta(), n);
/** Logotipo que a ficha usa, conforme a escolha: o cabeçalho dos documentos ou uma imagem própria. */
export function logoDaFicha(cfg: ConfigFicha = lerConfig()) {
  return cfg.logo_modo === "propria" ? logoAtual() : imagemAtual("cabecalho") ?? logoAtual();
}
export const logoAtual = () => achar(pasta(), "logo");
export const salvarLogo = (d: Buffer) => gravar(pasta(), "logo", d, 1024 * 1024, "Logotipo");
export const apagarLogo = () => apagar(pasta(), "logo");
export function fotoDaPessoa(id: number) {
  if (!db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(id)) throw new ErroGestao("Pessoa não encontrada.", 404);
  return achar(pasta("fotos"), String(id));
}
export function salvarFoto(id: number, d: Buffer) { fotoDaPessoa(id); gravar(pasta("fotos"), String(id), d, 2 * 1024 * 1024, "Foto"); }
export function apagarFoto(id: number) { fotoDaPessoa(id); apagar(pasta("fotos"), String(id)); }
export const comoDataUri = (img: { arquivo: string; mime: string } | null) => (img ? `data:${img.mime};base64,${fs.readFileSync(img.arquivo).toString("base64")}` : null);
