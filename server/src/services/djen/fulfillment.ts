import { dataValida, hojeDjen } from './api';
import { DjenInputError } from './store';
export function dadosDoCumprimento(data?: Record<string, unknown>) {
  if (data?.cumprido_em === undefined) return null;
  const dia = String(data.cumprido_em);
  const observacoes = typeof data.observacoes === 'string' ? data.observacoes.trim() : '';
  if (!dataValida(dia) || dia > hojeDjen()) throw new DjenInputError('Informe a data em que o cumprimento foi conferido, sem data futura.');
  if (observacoes.length < 3 || observacoes.length > 2000) throw new DjenInputError('Descreva o cumprimento conferido nos autos, de 3 a 2.000 caracteres.');
  return { cumprido_em: dia, observacoes };
}
export const descricaoCumprimento = (d: NonNullable<ReturnType<typeof dadosDoCumprimento>>) => `Cumprimento confirmado nos autos pelo usuário em ${d.cumprido_em}: ${d.observacoes}`;
