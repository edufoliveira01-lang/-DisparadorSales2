import { soDigitos } from "./validacao";
import { ErroGestao } from "./erro";

export interface EnderecoCep { cep: string; logradouro: string; complemento: string; bairro: string; cidade: string; uf: string }
const cache = new Map<string, { em: number; dado: EnderecoCep }>();
const VALIDADE_MS = 24 * 3600_000;
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function buscar(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    if (r.status === 404) return { erro: true };
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Consulta o endereço pelo CEP (ViaCEP, com BrasilAPI de reserva). */
export async function consultarCep(bruto: string): Promise<EnderecoCep> {
  const cep = soDigitos(bruto);
  if (cep.length !== 8) throw new ErroGestao("CEP inválido: informe os 8 números.");
  const guardado = cache.get(cep);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.dado;

  let dado: EnderecoCep | null = null; let naoExiste = false;
  const via = (await buscar(`https://viacep.com.br/ws/${cep}/json/`)) as Record<string, unknown> | null;
  if (via && !via.erro) dado = { cep, logradouro: texto(via.logradouro), complemento: texto(via.complemento), bairro: texto(via.bairro), cidade: texto(via.localidade), uf: texto(via.uf).toUpperCase() };
  else if (via?.erro) naoExiste = true;
  if (!dado) {
    const br = (await buscar(`https://brasilapi.com.br/api/cep/v1/${cep}`)) as Record<string, unknown> | null;
    if (br && !br.erro && (br.city || br.street)) dado = { cep, logradouro: texto(br.street), complemento: "", bairro: texto(br.neighborhood), cidade: texto(br.city), uf: texto(br.state).toUpperCase() };
    else if (br?.erro && via?.erro) naoExiste = true;
  }
  if (!dado) {
    if (naoExiste) throw new ErroGestao("CEP não encontrado. Confira os números ou preencha o endereço à mão.", 404);
    throw new ErroGestao("Não consegui consultar o CEP agora. Preencha o endereço à mão.", 502);
  }
  cache.set(cep, { em: Date.now(), dado });
  return dado;
}
export const limparCacheCep = () => cache.clear();
