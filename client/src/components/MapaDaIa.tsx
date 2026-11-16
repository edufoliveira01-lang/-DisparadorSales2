import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";

interface StatusDjen { config?: { ia_ativa: boolean; ia_modo: string }; ia?: { pausa?: string | null; pendentes?: number } }
interface Conexao { provider: string; chatgpt_login_available?: boolean }
const MODOS: Record<string, string> = { economico: "econômico", equilibrado: "equilibrado", precisao: "máxima precisão" };

/** Onde a IA é usada no sistema, num só lugar: o provedor e a conta são esta tela; cada uso mostra o estado e leva ao ajuste dele. */
export function MapaDaIa() {
  const [djen, setDjen] = useState<StatusDjen | null>(null);
  const [ia, setIa] = useState<Conexao | null>(null);
  useEffect(() => {
    api.get<StatusDjen>("/djen/status").then(setDjen).catch(() => setDjen(null));
    api.get<Conexao>("/ai/config").then(setIa).catch(() => setIa(null));
  }, []);
  const provedor = ia ? (ia.provider === "codex" ? "conta ChatGPT" : ia.provider === "openai" ? "OpenAI (API)" : "Anthropic (API)") : "…";
  return (
    <section aria-label="Onde a IA é usada" className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Sparkles className="h-4 w-4 text-accent-600" />Onde a IA é usada</h2>
      <p className="mt-1 text-xs text-zinc-500">O provedor e a conta abaixo valem para tudo o que o Sales faz com IA. Cada uso tem só o seu liga/desliga.</p>
      <ul className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
        <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span><span className="font-medium text-zinc-900 dark:text-zinc-100">Publicações do DJEN</span><span className="block text-xs text-zinc-500">Classifica, resume e identifica perícias e audiências.</span></span>
          <span className="flex items-center gap-2">{djen?.config ? <Badge tone={djen.ia?.pausa ? "warning" : djen.config.ia_ativa ? "success" : "neutral"}>{djen.ia?.pausa ? "Pausada" : djen.config.ia_ativa ? `Ligada · modo ${MODOS[djen.config.ia_modo] ?? djen.config.ia_modo}` : "Desligada"}</Badge> : null}<Link className="text-xs font-medium text-accent-700 underline dark:text-accent-300" to="/processos/monitoramento">Ajustar</Link></span>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span><span className="font-medium text-zinc-900 dark:text-zinc-100">Documentos e foto do cliente</span><span className="block text-xs text-zinc-500">Lê RG, CNH, comprovante e CNIS e sugere a foto. Usa o modelo econômico.</span></span>
          <Badge tone="info">Usa {provedor}</Badge>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span><span className="font-medium text-zinc-900 dark:text-zinc-100">Atendimento no WhatsApp</span><span className="block text-xs text-zinc-500">Os agentes Lígia e Helena. Têm regras e IA próprias, no Deskcomm.</span></span>
          <Link className="text-xs font-medium text-accent-700 underline dark:text-accent-300" to="/configuracoes/atendimento-ia">Atendimento com IA</Link>
        </li>
      </ul>
    </section>
  );
}
