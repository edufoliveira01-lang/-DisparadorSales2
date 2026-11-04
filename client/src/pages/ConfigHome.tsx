import { Link } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { GRUPOS_CONFIG, itemPermitido } from "@/lib/configNav";

/** Visão geral das configurações: cada ferramenta do sistema que se ajusta, no seu lugar. */
export function ConfigHome() {
  const { user } = useAuth();
  const grupos = GRUPOS_CONFIG.map((g) => ({ ...g, itens: g.itens.filter((i) => itemPermitido(i, user.permissions)) })).filter((g) => g.itens.length > 0);
  return (
    <div className="space-y-8">
      <PageHeader title="Configurações" description="Tudo o que se ajusta no sistema fica aqui: dados do escritório, documentos, conexões, prazos e acesso." />
      {grupos.map((g) => (
        <section key={g.id} aria-labelledby={`cfg-${g.id}`}>
          <h2 id={`cfg-${g.id}`} className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{g.titulo}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
