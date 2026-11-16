/** Endereço para consultar um processo no site do tribunal, a partir do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO). */
export interface LinkDoTribunal { url: string; nome: string; direto: boolean }

const TRF: Record<string, [string, string]> = {
  "01": ["TRF1", "https://pje1g-consultapublica.trf1.jus.br/consultapublica/"],
  "02": ["TRF2", "https://eproc.trf2.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica"],
  "03": ["TRF3", "https://pje1g.trf3.jus.br/pje/ConsultaPublica/listView.seam"],
  "04": ["TRF4", "https://consulta.trf4.jus.br/trf4/controlador.php?acao=consulta_processual_pesquisa"],
  "05": ["TRF5", "https://pje.trf5.jus.br/pjeconsulta/"],
  "06": ["TRF6", "https://pje1g.trf6.jus.br/consultapublica/"],
};
const FALLBACK = "https://portaldeservicos.pdpj.jus.br/consulta";

export function linkDoTribunal(numero: string | null | undefined): LinkDoTribunal | null {
  const d = String(numero ?? "").replace(/\D/g, "");
  if (d.length !== 20) return null;
  const justica = d[13]!, tr = d.slice(14, 16), foro = d.slice(16);
  const formatado = `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${justica}.${tr}.${foro}`;
  if (justica === "8" && tr === "26") {
    const q = new URLSearchParams({ conversationId: "", cbPesquisa: "NUMPROC", numeroDigitoAnoUnificado: formatado.slice(0, 15), foroNumeroUnificado: foro, "dadosConsulta.valorConsultaNuUnificado": formatado, "dadosConsulta.tipoNuProcesso": "UNIFICADO" });
    return { url: `https://esaj.tjsp.jus.br/cpopg/search.do?${q.toString()}`, nome: "TJSP (e-SAJ)", direto: true };
  }
  if (justica === "4" && TRF[tr]) return { url: TRF[tr]![1], nome: TRF[tr]![0], direto: false };
  if (justica === "5") return { url: `https://pje.trt${Number(tr)}.jus.br/consultaprocessual/`, nome: `TRT-${Number(tr)}`, direto: false };
  if (justica === "3") return { url: "https://processo.stj.jus.br/processo/pesquisa/", nome: "STJ", direto: false };
  if (justica === "1") return { url: "https://portal.stf.jus.br/processos/", nome: "STF", direto: false };
  return { url: FALLBACK, nome: "Portal de consulta do Judiciário", direto: false };
}
