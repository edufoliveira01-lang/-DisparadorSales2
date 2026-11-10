/**
 * Armazenamento externo (Dropbox agora; Google Drive e OneDrive depois) — as REGRAS DE PASTAS, puras e iguais para qualquer provedor.
 *
 * O que fica aqui: onde cada documento vai (`CLIENTES/NOME DO CLIENTE/TIPO`), o nome do arquivo (`AAAA-MM-DD - Tipo.ext`), a trava que impede
 * qualquer envio fora de `/CLIENTES/` e a comparação de nomes de pasta que já existem (sem NUNCA adivinhar entre nomes parecidos).
 * Nada aqui fala com rede nem com banco: é o que os testes prendem.
 */

export class ErroArmazenamento extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** O item (pasta/arquivo) não existe mais no drive — neutro, para o fluxo não depender de detalhes de um provedor. */
export class ErroItemNaoEncontrado extends ErroArmazenamento {
  constructor(message = "A pasta não existe mais no drive.") { super(message, 404); }
}

/** A pasta-raiz PADRÃO dos clientes, na raiz do drive do escritório. Cada escritório pode trocar (ver `aplicarConfigDePastas`). */
export const RAIZ_DOS_CLIENTES = "/CLIENTES";
let raizAtual = RAIZ_DOS_CLIENTES;
/** A pasta-raiz em uso neste escritório (a padrão, ou a que a tela de configuração definiu). */
export const raizDosClientes = () => raizAtual;

/** As pastas de tipo dentro da pasta de cada cliente. "A CLASSIFICAR" recebe o que o sistema não soube identificar. */
export const TIPOS_DE_PASTA = [
  "PARTE MÉDICA",
  "DOCUMENTOS PESSOAIS",
  "DOCUMENTOS ADMINISTRATIVO",
  "CONTRATOS E PROCURAÇÕES",
  "A CLASSIFICAR",
] as const;
export type TipoDePasta = (typeof TIPOS_DE_PASTA)[number];

/** Nomes que o escritório escolheu para as pastas de tipo (a chave é sempre o nome padrão acima). */
let nomesDosTipos: Partial<Record<TipoDePasta, string>> = {};
export const nomeDaPastaDoTipo = (tipo: TipoDePasta): string => nomesDosTipos[tipo] || tipo;

export const ehTipoDePasta = (v: unknown): v is TipoDePasta => typeof v === "string" && (TIPOS_DE_PASTA as readonly string[]).includes(v);

/** Caracteres que o Dropbox, o Drive e o OneDrive recusam em nome de pasta/arquivo (e as barras, que quebrariam o caminho). */
const PROIBIDOS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * O nome da pasta do cliente, no padrão do escritório: MAIÚSCULAS, com acento, espaços simples, sem caractere proibido.
 * O nome vem do cadastro do cliente no sistema (confirmado com ele), nunca do que o modelo de IA entendeu.
 */
export function nomeDaPastaDoCliente(nome: unknown): string {
  const limpo = String(nome ?? "")
    .replace(PROIBIDOS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .toLocaleUpperCase("pt-BR");
  if (!limpo) throw new ErroArmazenamento("O cliente ainda não tem nome completo confirmado: não dá para escolher a pasta.", 409);
  return limpo.slice(0, 150);
}

/** Chave para COMPARAR nomes: sem acento, sem caixa, sem pontuação, espaços simples. "JOÃO  da Silva." → "joao da silva". */
export function chaveDeComparacao(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Valida e normaliza a pasta-raiz escolhida: "/CLIENTES", "/Escritório/Clientes"… (até 3 níveis; nunca o drive inteiro). */
export function normalizarRaiz(v: unknown): string {
  const bruto = String(v ?? "").trim().replace(/\\/g, "/");
  const partes = bruto.split("/").map((x) => x.trim()).filter(Boolean);
  if (partes.length === 0) throw new ErroArmazenamento("Informe a pasta onde os documentos dos clientes ficam (ex.: /CLIENTES).");
  if (partes.length > 3) throw new ErroArmazenamento("Use no máximo 3 níveis de pasta (ex.: /ESCRITÓRIO/CLIENTES).");
  for (const x of partes) {
    if (x === "." || x === "..") throw new ErroArmazenamento("Caminho inválido.");
    if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(x)) throw new ErroArmazenamento(`O nome de pasta "${x}" tem caracteres que o Dropbox não aceita.`);
    if (x.length > 100) throw new ErroArmazenamento("Nome de pasta muito longo.");
  }
  return `/${partes.join("/")}`;
}

/** Valida o nome de uma pasta de tipo. */
export function normalizarNomeDeTipo(v: unknown): string {
  const n = String(v ?? "").replace(PROIBIDOS, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (!n) throw new ErroArmazenamento("O nome da pasta não pode ficar vazio.");
  if (n.length > 80) throw new ErroArmazenamento("Nome de pasta muito longo.");
  return n;
}

/** Aplica a configuração do escritório (vinda do banco). Valores inválidos são ignorados e voltam ao padrão. */
export function aplicarConfigDePastas(raiz: string | null | undefined, tipos: Record<string, unknown> | null | undefined) {
  try { raizAtual = raiz ? normalizarRaiz(raiz) : RAIZ_DOS_CLIENTES; } catch { raizAtual = RAIZ_DOS_CLIENTES; }
  const novos: Partial<Record<TipoDePasta, string>> = {};
  for (const t of TIPOS_DE_PASTA) {
    const v = tipos?.[t];
    if (typeof v === "string" && v.trim() && v !== t) { try { novos[t] = normalizarNomeDeTipo(v); } catch { /* ignora */ } }
  }
  nomesDosTipos = novos;
}

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

/** Chave SEM as partículas (de/da/do/das/dos/e): "joao da silva" e "joao de silva" ficam iguais — é o erro de digitação mais comum. */
const chaveSemParticulas = (nome: string) =>
  chaveDeComparacao(nome).split(" ").filter((p) => p && !PARTICULAS.has(p)).join(" ");

function bigramas(texto: string): Map<string, number> {
  const mapa = new Map<string, number>();
  const t = texto.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    mapa.set(g, (mapa.get(g) ?? 0) + 1);
  }
  return mapa;
}

/** Semelhança de 0 a 1 entre dois nomes (coeficiente de Dice sobre pares de letras), depois de normalizar. */
export function similaridade(a: string, b: string): number {
  const x = chaveDeComparacao(a);
  const y = chaveDeComparacao(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ga = bigramas(x);
  const gb = bigramas(y);
  let comuns = 0;
  let totalA = 0;
  let totalB = 0;
  for (const n of ga.values()) totalA += n;
  for (const n of gb.values()) totalB += n;
  for (const [g, n] of ga) comuns += Math.min(n, gb.get(g) ?? 0);
  return totalA + totalB === 0 ? 0 : (2 * comuns) / (totalA + totalB);
}

export interface PastaExistente { id: string; nome: string; caminho: string }
export interface Candidata { pasta: PastaExistente; nota: number }

export type Casamento =
  | { tipo: "exato"; pasta: PastaExistente }
  | { tipo: "parecido"; candidatas: Candidata[] }
  | { tipo: "nenhum" };

/** Abaixo disto o nome é considerado outra pessoa. Alto de propósito: errar para "nenhum" cria pasta nova (visível); errar para "exato" mistura clientes. */
export const LIMIAR_DE_PARECIDO = 0.82;
const MAXIMO_DE_CANDIDATAS = 5;

/**
 * Qual pasta existente é a deste cliente? NUNCA adivinha entre nomes diferentes:
 *   - **exato**: o MESMO nome, ignorando maiúsculas, acentos, pontuação e espaços extras — e só se houver UMA pasta assim (duas iguais é ambíguo);
 *   - **parecido**: nome diferente mas próximo (uma partícula "DA"/"DE" trocada, uma letra errada…), ou mais de uma pasta com o mesmo nome. NÃO envia: a equipe escolhe;
 *   - **nenhum**: nada que se pareça — o chamador cria a pasta nova com o nome do sistema.
 */
export function casarPasta(nomeDoCliente: string, existentes: readonly PastaExistente[], limiar = LIMIAR_DE_PARECIDO): Casamento {
  const alvo = chaveDeComparacao(nomeDoCliente);
  if (!alvo) return { tipo: "nenhum" };
  const iguais = existentes.filter((p) => chaveDeComparacao(p.nome) === alvo);
  if (iguais.length === 1) return { tipo: "exato", pasta: iguais[0]! };
  if (iguais.length > 1) return { tipo: "parecido", candidatas: iguais.slice(0, MAXIMO_DE_CANDIDATAS).map((pasta) => ({ pasta, nota: 1 })) };

  const semParticulas = chaveSemParticulas(nomeDoCliente);
  const candidatas: Candidata[] = [];
  for (const pasta of existentes) {
    const igualSemParticulas = semParticulas !== "" && chaveSemParticulas(pasta.nome) === semParticulas;
    const nota = igualSemParticulas ? Math.max(0.95, similaridade(nomeDoCliente, pasta.nome)) : similaridade(nomeDoCliente, pasta.nome);
    if (nota >= limiar) candidatas.push({ pasta, nota });
  }
  candidatas.sort((a, b) => b.nota - a.nota || a.pasta.nome.localeCompare(b.pasta.nome, "pt-BR"));
  return candidatas.length > 0 ? { tipo: "parecido", candidatas: candidatas.slice(0, MAXIMO_DE_CANDIDATAS) } : { tipo: "nenhum" };
}

/** A data no fuso de Brasília, como AAAA-MM-DD (é como o escritório e o cliente contam o dia). */
export function dataDoArquivo(quando: Date | string = new Date()): string {
  const d = typeof quando === "string" ? new Date(quando) : quando;
  if (Number.isNaN(d.getTime())) throw new ErroArmazenamento("Data do documento inválida.");
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** `2026-11-10 - CNIS.pdf`: ordena por data no drive, não tem ambiguidade de dia/mês e nunca depende do nome original do arquivo. */
export function nomeDoArquivo(quando: Date | string, titulo: string, extensao: string): string {
  const base = String(titulo ?? "").replace(PROIBIDOS, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "").slice(0, 120);
  const ext = String(extensao ?? "").replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  if (!base) throw new ErroArmazenamento("O documento precisa de um título.");
  return `${dataDoArquivo(quando)} - ${base}${ext ? `.${ext}` : ""}`;
}

export const caminhoDoCliente = (nomeDaPasta: string) => `${raizAtual}/${nomeDaPasta}`;
export const caminhoDoTipo = (nomeDaPasta: string, tipo: TipoDePasta) => `${caminhoDoCliente(nomeDaPasta)}/${nomeDaPastaDoTipo(tipo)}`;

/**
 * A TRAVA: todo caminho que sai do sistema para o drive passa por aqui. O app tem acesso à conta inteira (o Dropbox não deixa restringir uma
 * pasta só), então a restrição a `/CLIENTES/` é DESTE código: fora dela, ou com `..`, o envio é recusado antes de qualquer chamada de rede.
 */
export function dentroDaRaiz(caminho: string): string {
  const c = String(caminho ?? "");
  if (c.includes("\\") || c.includes("\u0000")) throw new ErroArmazenamento("Caminho inválido.", 400);
  const partes = c.split("/");
  if (partes.includes("..") || partes.includes(".")) throw new ErroArmazenamento("Caminho inválido.", 400);
  const normal = c.replace(/\/+$/g, "");
  if (normal.toLowerCase() !== raizAtual.toLowerCase() && !normal.toLowerCase().startsWith(`${raizAtual.toLowerCase()}/`)) {
    throw new ErroArmazenamento(`Por segurança, só é permitido gravar dentro de ${raizAtual}.`, 403);
  }
  return normal;
}
