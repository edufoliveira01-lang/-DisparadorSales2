import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Headset, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Callout } from "@/components/ui/Settings";

/**
 * Ponte para o atendimento (Deskcomm): não é uma tela de uso. Quem tem acesso é levado direto ao chat (mesmo e-mail, sem pedir senha);
 * só aparece o aviso quando falta e-mail ou o atendimento não foi liberado. As configurações ficam em Configurações → Atendimento e equipe.
 */
export function Atendimento() {
  const { user } = useAuth();
  const semEmail = !user.email?.trim();
  const [info, setInfo] = useState<{ disponivel: boolean } | null>(null);
  useEffect(() => { api.get<{ disponivel: boolean }>("/atendimento/info", { fresh: true } as never).then(setInfo).catch(() => setInfo({ disponivel: false })); }, []);
  useEffect(() => { if (info?.disponivel && !semEmail) window.location.replace("/api/atendimento/entrar"); }, [info, semEmail]);

  return (
    <div className="space-y-6">
      <PageHeader title="Atendimento" description="Conversas de WhatsApp com clientes, agentes de IA e funil de vendas." />
      <div className="max-w-xl space-y-4">
        {info === null || (info.disponivel && !semEmail) ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Abrindo o atendimento…</p>
        ) : !info.disponivel ? (
          <Callout tone="aviso"><span className="flex items-start gap-2"><Headset className="mt-0.5 h-4 w-4 shrink-0" />O atendimento não está liberado para este escritório. Fale com o suporte para incluí-lo no plano.</span></Callout>
        ) : (
          <Callout tone="aviso">Para entrar no atendimento, o seu usuário precisa ter um <b>e-mail cadastrado</b>, o mesmo que a equipe usa lá. <Link to="/minha-conta" className="font-semibold underline underline-offset-2">Cadastrar meu e-mail em Minha conta</Link></Callout>
        )}
      </div>
    </div>
  );
}
