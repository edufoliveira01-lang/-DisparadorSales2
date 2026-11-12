import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { GRUPOS_CONFIG, itemPermitido } from "@/lib/configNav";

const normalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Visão geral das configurações: busca e cada assunto no seu grupo. */
export function ConfigHome() {
  const { user } = useAuth();
  const [busca, setBusca] = useState("");
  const grupos = useMemo(() => {
    const termo = normalizar(busca.trim());
    return GRUPOS_CONFIG
      .map((g) => ({
        ...g,
        itens: g.itens.filter((i) => itemPermitido(i, user.permissions) && (!termo || normalizar(`${i.titulo} ${i.descricao} ${g.titulo}`).includes(termo))),
      }))
      .filter((g) => g.itens.length > 0);
  }, [busca, user.permissions]);

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Escolha um assunto no menu ao lado ou busque abaixo. Cada ajuste fica em um só lugar." />
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input placeholder="Buscar configuração (ex.: boleto, WhatsApp, prazos)…" className={busca ? "pl-9 pr-9" : "pl-9"} value={busca} onChange={(e) => setBusca(e.target.value)} />
        {busca && (
          <button type="button" aria-label="Limpar busca" onClick={() => setBusca("")} className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
        )}
      </div>
      {grupos.length === 0 ? (
        <EmptyState icon={Search} title="Nada encontrado" description="Tente outra palavra, como «cobrança», «prazo» ou «documentos»." />
      ) : grupos.map((g) => (
        <section key={g.id} aria-labelledby={`cfg-${g.id}`}>
          <h2 id={`cfg-${g.id}`} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{g.titulo}</h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{g.descricao}</p>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {g.itens.map((i) => (
              <Link key={i.to} to={i.to} className="group flex gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition hover:border-accent-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300"><i.icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.titulo}</span><span className="mt-0.5 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{i.descricao}</span></span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
