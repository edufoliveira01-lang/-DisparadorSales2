import { somarDias } from './api';
/** O atraso na recuperação histórica não pode impedir a captura das publicações recentes. */
export function periodosAutomaticos(inicioHistorico: string, fimHistorico: string, hoje: string, janela: number) {
  const inicioRecente = somarDias(hoje,-Math.max(3,Math.min(7,Math.trunc(janela)||7))+1);
  const periodos = [{ inicio: inicioRecente, fim: hoje }];
  if (inicioHistorico < inicioRecente) {
    const fim = fimHistorico < inicioRecente ? fimHistorico : somarDias(inicioRecente,-1);
    if (inicioHistorico <= fim) periodos.push({ inicio:inicioHistorico,fim });
  }
  return periodos;
}
