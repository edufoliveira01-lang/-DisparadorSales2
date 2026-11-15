import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { LinhaPericiaInss, useOpcoesInss, type PericiaInss } from "./PericiaInss";

/** Lista geral das perícias administrativas do INSS: o que vem por aí, de todos os clientes, num lugar só. */
export function PericiasInss() {
  const { show } = useToast();
  const opcoes = useOpcoesInss();
  const [todas, setTodas] = useState(false);
  const [itens, setItens] = useState<PericiaInss[] | null>(null);
  useEffect(() => {
    setItens(null);
    api.get<{ itens: PericiaInss[] }>(`/gestao/pericias-inss${todas ? "?situacao=todas" : ""}`).then((r) => setItens(r.itens)).catch(() => show("Não foi possível carregar as perícias do INSS.", "error"));
  }, [todas, show]);
  return (
    <div className="space-y-5">
      <PageHeader title="Perícias do INSS" description="Perícias e avaliações administrativas agendadas no INSS, de todos os clientes. Para cadastrar, abra o cliente e use a aba “Perícia INSS”." />
      <div className="flex gap-2" role="tablist">
        {[[false, "Próximas"], [true, "Todas (com histórico)"]].map(([v, r]) => (
          <button key={String(v)} role="tab" aria-selected={todas === v} onClick={() => setTodas(v as boolean)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${todas === v ? "bg-accent-50 text-accent-700" : "text-zinc-600 hover:border-zinc-300"} border border-transparent`}>{r as string}</button>
        ))}
      </div>
      {itens === null ? <p className="text-sm text-zinc-500">Carregando…</p> : itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">{todas ? "Nenhuma perícia do INSS registrada." : "Nenhuma perícia do INSS agendada para os próximos dias."}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">{itens.map((p) => <LinhaPericiaInss key={p.id} p={p} opcoes={opcoes} />)}</ul>)}
    </div>
  );
}
