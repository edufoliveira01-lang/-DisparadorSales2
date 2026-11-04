import { useState } from "react";
import { X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Campo, PRIORIDADES, SeletorProcesso, type ProcessoResumo } from "./comum";
import type { Responsavel } from "./Processos";

export interface Tarefa {
  id: number; titulo: string; descricao: string; processo_id: number | null; processo_numero: string | null; processo_pasta: string | null; pessoa_nome: string | null;
  responsavel_user_id: number | null; responsavel: string | null; prazo: string | null; prazo_fatal: boolean; prioridade: string; status: string; origem: string;
  aberta: boolean; atrasada: boolean; concluida_em: string | null;
}

export function TarefaModal({ tarefa, processoFixo, responsaveis, meuId, aoFechar, aoSalvar }: { tarefa?: Tarefa | null; processoFixo?: { id: number; rotulo: string }; responsaveis: Responsavel[]; meuId?: number; aoFechar: () => void; aoSalvar: () => void }) {
  const { show } = useToast();
  const [f, setF] = useState({
    titulo: tarefa?.titulo ?? "", descricao: tarefa?.descricao ?? "", prazo: tarefa?.prazo ?? "", prazo_fatal: tarefa?.prazo_fatal ?? false, prioridade: tarefa?.prioridade ?? "normal",
    responsavel_user_id: tarefa ? (tarefa.responsavel_user_id ? String(tarefa.responsavel_user_id) : "") : meuId ? String(meuId) : "", status: tarefa?.status ?? "pendente",
  });
  const [proc, setProc] = useState<{ id: number; rotulo: string } | null>(processoFixo ?? (tarefa?.processo_id ? { id: tarefa.processo_id, rotulo: `${tarefa.processo_pasta} · ${tarefa.processo_numero}` } : null));
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const escolher = (p: ProcessoResumo) => setProc({ id: p.id, rotulo: `${p.pasta} · ${p.numero_formatado || p.numero}` });
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault(); setSalvando(true);
    try {
      const corpo = { ...f, responsavel_user_id: f.responsavel_user_id || null, processo_id: proc?.id ?? null, prazo: f.prazo || null };
      if (tarefa) await api.put(`/gestao/tarefas/${tarefa.id}`, corpo); else await api.post("/gestao/tarefas", corpo);
      show("Tarefa salva.", "success"); aoSalvar();
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  return (
    <Modal open onClose={aoFechar} title={tarefa ? "Tarefa" : "Nova tarefa"} description={tarefa?.origem === "djen" ? "Veio de um prazo do DJEN; concluir aqui conclui o prazo lá." : undefined} maxWidth="max-w-xl"
      footer={<div className="flex w-full justify-end gap-2"><Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button><Button type="submit" form="form-tarefa" loading={salvando}>Salvar</Button></div>}>
      <form id="form-tarefa" onSubmit={salvar} className="space-y-4">
        <Campo rotulo="O que precisa ser feito *"><Input required autoFocus value={f.titulo} onChange={(e) => set("titulo", e.target.value)} className="mt-1.5" placeholder="Ex.: Protocolar contestação" /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Prazo"><Input type="date" value={f.prazo} onChange={(e) => set("prazo", e.target.value)} className="mt-1.5" /></Campo>
          <Campo rotulo="Prioridade"><Select value={f.prioridade} onChange={(e) => set("prioridade", e.target.value)} className="mt-1.5">{Object.entries(PRIORIDADES).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
          <Campo rotulo="Responsável"><Select value={f.responsavel_user_id} onChange={(e) => set("responsavel_user_id", e.target.value)} className="mt-1.5"><option value="">Sem responsável</option>{responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></Campo>
          {tarefa && <Campo rotulo="Situação"><Select value={f.status} onChange={(e) => set("status", e.target.value)} className="mt-1.5"><option value="pendente">Pendente</option><option value="em_andamento">Em andamento</option><option value="concluida">Concluída</option><option value="cancelada">Cancelada</option></Select></Campo>}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={f.prazo_fatal} onChange={(e) => set("prazo_fatal", e.target.checked)} /> Prazo fatal (não pode ser perdido)</label>
        {processoFixo ? <p className="text-sm text-zinc-600 dark:text-zinc-300">Processo: <b>{processoFixo.rotulo}</b></p> : proc ? (
          <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">Processo: <b>{proc.rotulo}</b><button type="button" aria-label="Tirar vínculo" onClick={() => setProc(null)}><X className="h-4 w-4 text-zinc-400" /></button></p>
        ) : <SeletorProcesso aoEscolher={escolher} rotulo="Vincular a um processo (opcional)" />}
        <Campo rotulo="Detalhes"><Textarea rows={3} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} className="mt-1.5" /></Campo>
      </form>
    </Modal>
  );
}
