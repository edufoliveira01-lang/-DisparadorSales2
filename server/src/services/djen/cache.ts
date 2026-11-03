/**
 * Cache curto das listas calculadas a partir de TODAS as publicações (alertas, contagens do
 * banner, diagnósticos). Sem ele, cada página aberta, cada foco da janela e cada evento do DJEN
 * refaz segundos de cálculo no único processo do servidor e trava as demais requisições.
 *
 * Invalidado em qualquer mudança do DJEN (evento "djen:changed") e, por segurança, expira sozinho.
 */
interface Entrada { em: number; dia: string; valor: unknown; }
const entradas = new Map<string, Entrada>();
const emVoo = new Map<string, Promise<unknown>>();
let geracao = 0;
// Nos testes os dados são gravados direto no banco, sem o evento que invalida o cache.
let ativo = !process.env.VITEST;
export function definirCacheDjenAtivo(valor: boolean) { ativo = valor; limparCachesDjen(); }
const formatadorDia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
let diaGuardado = { em: 0, valor: "" };
/** Data (AAAA-MM-DD) de hoje em São Paulo. Criar o formatador a cada chamada é caro; reaproveita por 5 s. */
export function hojeSaoPaulo(): string {
  const agora = Date.now();
  if (agora - diaGuardado.em > 5000) diaGuardado = { em: agora, valor: formatadorDia.format(new Date(agora)) };
  return diaGuardado.valor;
}
const hoje = hojeSaoPaulo;

/** Chamado a cada mudança de dados. Resultados em cálculo no momento não são gravados. */
export function limparCachesDjen() {
  geracao++;
  entradas.clear();
  emVoo.clear();
}

export function memoDjen<T>(chave: string, ttlMs: number, calcular: () => T): T {
  if (!ativo) return calcular();
  const atual = entradas.get(chave);
  const dia = hoje();
  // O dia faz parte da validade: prazos e "dias decorridos" mudam à meia-noite.
  if (atual && atual.dia === dia && Date.now() - atual.em < ttlMs) return atual.valor as T;
  const g = geracao;
  const valor = calcular();
  if (g === geracao) entradas.set(chave, { em: Date.now(), dia, valor });
  return valor;
}

/** Versão assíncrona: chamadas simultâneas compartilham o mesmo cálculo. */
export function memoDjenAsync<T>(chave: string, ttlMs: number, calcular: () => Promise<T>): Promise<T> {
  if (!ativo) return calcular();
  const atual = entradas.get(chave);
  const dia = hoje();
  if (atual && atual.dia === dia && Date.now() - atual.em < ttlMs) return Promise.resolve(atual.valor as T);
  const voo = emVoo.get(chave);
  if (voo) return voo as Promise<T>;
  const g = geracao;
  const p = calcular().then((valor) => {
    if (g === geracao) entradas.set(chave, { em: Date.now(), dia, valor });
    return valor;
  }).finally(() => { if (emVoo.get(chave) === p) emVoo.delete(chave); });
  emVoo.set(chave, p);
  return p;
}

/** Resultado de uma análise que depende somente do texto. Limitado em quantidade de entradas. */
const porTexto = new Map<string, Map<string, unknown>>();
const MAX_TEXTOS = 4000;
export function memoTexto<T>(nome: string, texto: string, calcular: (t: string) => T): T {
  let mapa = porTexto.get(nome);
  if (!mapa) { mapa = new Map(); porTexto.set(nome, mapa); }
  if (mapa.has(texto)) {
    const valor = mapa.get(texto) as T;
    mapa.delete(texto); mapa.set(texto, valor); // mantém os mais usados
    return valor;
  }
  const valor = calcular(texto);
  mapa.set(texto, valor);
  if (mapa.size > MAX_TEXTOS) mapa.delete(mapa.keys().next().value as string);
  return valor;
}
