import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
export interface CoberturaHistorico {
  status: 'pendente' | 'verificando' | 'atualizado' | 'falha';
  inicio: string | null; fim: string | null; consultado_em: string | null; mensagem: string;
}
export const instanteBR = (s: string) => {
  const d = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? s : s.replace(' ', 'T')+'Z');
  return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}) : 'não informada';
};
export function HistoryCoverage({ historico, publicacaoId }: { historico?: CoberturaHistorico; publicacaoId?: number }) {
  const { show } = useToast(); const [busy,setBusy] = useState(false);
  if (!historico) return null;
  const atualizado = historico.status === 'atualizado';
  return <div className={`my-2 rounded-xl border p-3 text-[11px] leading-relaxed ${atualizado ? 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'}`} onClick={e=>e.stopPropagation()}>
    <p className="font-semibold">{atualizado ? 'Histórico do DJEN consultado' : historico.status === 'verificando' ? 'Atualizando histórico…' : historico.status === 'falha' ? 'Histórico não confirmado' : 'Histórico pendente de atualização'}</p>
    <p>{historico.mensagem}</p>
    {atualizado && historico.fim && <p>Consultado até {historico.fim.split('-').reverse().join('/')} · {historico.consultado_em && instanteBR(historico.consultado_em)}</p>}
    {publicacaoId && historico.status !== 'verificando' && <Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={()=>{
      setBusy(true); void api.post(`/djen/publicacoes/${publicacaoId}/atualizar-historico`,{}).then(()=>show('Consulta por processo enfileirada. A situação será atualizada ao terminar.','success')).catch(e=>show(e instanceof ApiError ? e.message : 'Não foi possível atualizar o histórico.','error')).finally(()=>setBusy(false));
    }}>{busy ? 'Solicitando…' : 'Atualizar histórico do processo'}</Button>}
  </div>;
}
export function RegisterFulfillment({ endpoint,tipo,onSaved,className }: { endpoint: string; tipo?: string; onSaved:()=>void|Promise<void>; className?: string }) {
  const [open,setOpen]=useState(false), [busy,setBusy]=useState(false), [nota,setNota]=useState('');
  const hoje = new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  const [dia,setDia]=useState(hoje); const {show}=useToast();
  return <span className="contents" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <Button size="sm" variant="outline" className={className} onClick={()=>setOpen(true)}>Já foi cumprido</Button>
    <Modal open={open} onClose={()=>{if(!busy)setOpen(false)}} title="Confirmar cumprimento nos autos">
      <form className="space-y-4" onSubmit={e=>{e.preventDefault(); if(busy)return; setBusy(true);
        void api.put(endpoint,{tipo,status:'resolvido',cumprido_em:dia,observacoes:nota.trim()}).then(async()=>{
          setOpen(false);setNota('');await onSaved();show('Cumprimento registrado com data e observação. Alerta encerrado.','success');
        }).catch(e=>show(e instanceof ApiError?e.message:'Não foi possível registrar o cumprimento.','error')).finally(()=>setBusy(false));
      }}>
        <p className="text-xs text-zinc-500">Use após conferir os autos. O DJEN pode não publicar o ato de cumprimento. O registro encerra somente este acompanhamento e preserva seu histórico.</p>
        <label className="block text-sm">Data do cumprimento ou da conferência<input type="date" required max={hoje} value={dia} onChange={e=>setDia(e.target.value)} className="mt-2 block w-full rounded-xl border bg-transparent p-3" /></label>
        <label className="block text-sm">O que foi conferido?<textarea required minLength={3} maxLength={2000} value={nota} onChange={e=>setNota(e.target.value)} placeholder="Ex.: petição de cumprimento juntada no evento 45." className="mt-2 min-h-28 w-full rounded-xl border bg-transparent p-3" /></label>
        <Button type="submit" disabled={busy||nota.trim().length<3||!dia}>{busy?'Salvando…':'Confirmar e encerrar alerta'}</Button>
      </form>
    </Modal>
  </span>;
}
