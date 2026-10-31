import { useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
export interface AtividadeProcesso { desde: string; dias: number; nivel: 'verde' | 'amarelo' | 'vermelho'; ultima_providencia_em: string | null }
export function ActivityBadge({ atividade }: { atividade?: AtividadeProcesso | null }) {
  if (!atividade) return null;
  const cores = { verde: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200', amarelo: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200', vermelho: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200' };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold ${cores[atividade.nivel]}`}
    title={`Sem providência registrada desde ${new Date(atividade.desde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Conta desde a criação do card ou a última providência. Ler e análises automáticas não reiniciam a contagem. Não é prazo processual.`}>
    <Clock3 className="h-3 w-3" /> {atividade.dias} dia{atividade.dias === 1 ? '' : 's'} sem providência
  </span>;
}
export function RegisterAction({ publicacaoId, onSaved }: { publicacaoId: number; onSaved?: () => void | Promise<void> }) {
  const [aberto, setAberto] = useState(false), [nota, setNota] = useState(''), [salvando, setSalvando] = useState(false);
  const { show } = useToast();
  return <>
    <Button size="sm" variant="ghost" onClick={() => setAberto(true)}>Registrar providência</Button>
    <Modal open={aberto} onClose={() => { if (!salvando) setAberto(false); }} title="Registrar providência realizada">
      <form className="space-y-4" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (salvando) return; setSalvando(true);
        void api.post(`/djen/publicacoes/${publicacaoId}/providencia`, { descricao: nota.trim() }).then(async () => {
          setAberto(false); setNota(''); await onSaved?.(); show('Providência registrada no histórico. Contagem reiniciada.', 'success');
        }).catch(e => show(e instanceof ApiError ? e.message : 'Não foi possível registrar a providência.', 'error')).finally(() => setSalvando(false)); }}>
        <p className="text-xs text-zinc-500">Descreva o que já foi feito. O registro fica no histórico e reinicia a etiqueta de dias sem providência. Não envia mensagens nem altera prazos.</p>
        <label className="block text-sm">Providência realizada<textarea autoFocus required minLength={3} maxLength={2000} value={nota} onChange={e => setNota(e.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-zinc-300 bg-transparent p-3" /></label>
        <Button type="submit" disabled={salvando || nota.trim().length < 3}>{salvando ? 'Salvando…' : 'Salvar registro'}</Button>
      </form>
    </Modal>
  </>;
}
