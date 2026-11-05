import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Headset } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

/** Porta de entrada para o atendimento e vendas por WhatsApp com IA (DeskcommCRM, em outro servidor). */
export function Atendimento() {
  const { user } = useAuth();
  const semEmail = !user.email?.trim();
  const [info, setInfo] = useState<{ disponivel: boolean; url: string | null } | null>(null);
  useEffect(() => { api.get<{ disponivel: boolean; url: string | null }>("/atendimento/info", { fresh: true } as never).then(setInfo).catch(() => setInfo({ disponivel: false, url: null })); }, []);
  return (
    <div className="space-y-6">
      <PageHeader title="Atendimento e vendas" description="Conversas de WhatsApp com clientes, agentes de IA que respondem e qualificam, e funil de vendas." />
      <div className="max-w-2xl space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300"><Headset className="h-6 w-6" /></span>
        {info === null ? <p className="text-sm text-zinc-500" role="status">Verificando…</p> : info.disponivel ? (
          <>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">O atendimento abre em uma nova aba, já com o seu acesso. Você entra com o <b>mesmo e-mail</b> cadastrado em <i>Minha conta</i>; se a sua pessoa ainda não foi cadastrada lá, peça ao administrador para adicioná-la na equipe do atendimento.</p>
            {semEmail ? (
              <div role="alert" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                <p>Para entrar no atendimento, o seu usuário precisa ter um <b>e-mail cadastrado</b>, o mesmo que a equipe usa lá.</p>
                <Link to="/minha-conta" className="inline-flex font-semibold underline underline-offset-2">Cadastrar meu e-mail em Minha conta</Link>
              </div>
            ) : (
              <Button onClick={() => window.open("/api/atendimento/entrar", "_blank", "noopener")}><ExternalLink className="h-4 w-4" /> Abrir o atendimento</Button>
            )}
          </>
        ) : <p className="text-sm text-zinc-600 dark:text-zinc-300">O atendimento não está liberado para este escritório. Fale com o suporte para incluí-lo no plano.</p>}
      </div>
    </div>
  );
}
