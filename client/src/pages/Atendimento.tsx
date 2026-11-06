import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileSignature, Headset, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

interface Relatorio { enviados: number; ok: number; revogados: number; semEmail: string[]; resultados: { email: string; ok: boolean; erro?: string }[]; removidos: { email: string; ok: boolean; erro?: string; removido?: boolean }[] }

/** Porta de entrada para o atendimento e vendas por WhatsApp com IA (DeskcommCRM, em outro servidor). */
export function Atendimento() {
  const { user, can } = useAuth();
  const [equipe, setEquipe] = useState<{ carregando: boolean; erro?: string; relatorio?: Relatorio }>({ carregando: false });
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
            {can("team.manage") && <CartaoZapSign />}
            {can("team.manage") && (
              <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <p className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100"><Users className="h-4 w-4" /> Equipe no atendimento</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">A equipe é enviada <b>automaticamente</b> quando alguém é cadastrado, alterado ou desativado (e conferida a cada poucas horas): pessoas ativas com e-mail entram com o papel equivalente, e quem é desativado perde o acesso ao atendimento. O botão abaixo força a conferência agora.</p>
                <Button
                  disabled={equipe.carregando}
                  onClick={() => {
                    setEquipe({ carregando: true });
                    api.post<Relatorio>("/atendimento/equipe/sincronizar", {})
                      .then((relatorio) => setEquipe({ carregando: false, relatorio }))
                      .catch((e: unknown) => setEquipe({ carregando: false, erro: e instanceof Error ? e.message : "Não foi possível sincronizar a equipe." }));
                  }}
                >
                  {equipe.carregando ? "Enviando…" : "Enviar equipe ao atendimento"}
                </Button>
                {equipe.erro && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{equipe.erro}</p>}
                {equipe.relatorio && (
                  <div role="status" className="space-y-1 text-sm text-zinc-700 dark:text-zinc-200">
                    <p><b>{equipe.relatorio.ok}</b> de {equipe.relatorio.enviados} pessoas estão no atendimento.{equipe.relatorio.revogados > 0 && <> {equipe.relatorio.revogados} acesso(s) revogado(s).</>}</p>
                    {[...equipe.relatorio.resultados, ...equipe.relatorio.removidos].filter((r) => !r.ok).map((r) => <p key={r.email} className="text-red-600 dark:text-red-400">{r.email}: {r.erro}</p>)}
                    {equipe.relatorio.semEmail.length > 0 && <p className="text-amber-700 dark:text-amber-300">Sem e-mail (não enviadas): {equipe.relatorio.semEmail.join(", ")}. Cadastre o e-mail em Equipe e acessos.</p>}
                  </div>
                )}
              </div>
            )}
          </>
        ) : <p className="text-sm text-zinc-600 dark:text-zinc-300">O atendimento não está liberado para este escritório. Fale com o suporte para incluí-lo no plano.</p>}
      </div>
    </div>
  );
}

interface ZapSignInfo { configurado: boolean; ambiente: "producao" | "sandbox"; token_final: string }

/** Chave do ZapSign deste escritório (assinatura dos contratos gerados no atendimento). O token fica criptografado e nunca volta inteiro. */
function CartaoZapSign() {
  const [info, setInfo] = useState<ZapSignInfo | null>(null);
  const [token, setToken] = useState("");
  const [ambiente, setAmbiente] = useState<"producao" | "sandbox">("producao");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { api.get<ZapSignInfo>("/atendimento/zapsign", { fresh: true } as never).then((i) => { setInfo(i); setAmbiente(i.ambiente); }).catch(() => setInfo(null)); }, []);
  return (
    <div className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <p className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100"><FileSignature className="h-4 w-4" /> Contratos com assinatura (ZapSign)</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">Quando o atendente clica em <b>Gerar contrato</b> no atendimento, o sistema monta todos os documentos do kit com os dados do cliente e envia ao ZapSign para ele assinar. Cole aqui o <b>token da API</b> da conta ZapSign do escritório.{info?.configurado && <> Token atual: <b>{info.token_final}</b> ({info.ambiente === "sandbox" ? "ambiente de testes" : "produção"}).</>}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={info?.configurado ? "Deixe em branco para manter o token atual" : "Token da API do ZapSign"} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
        <select value={ambiente} onChange={(e) => setAmbiente(e.target.value as "producao" | "sandbox")} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">
          <option value="producao">Produção</option><option value="sandbox">Testes (sandbox)</option>
        </select>
      </div>
      <Button disabled={salvando || (!token.trim() && !info?.configurado)} onClick={() => {
        setSalvando(true); setMsg(null);
        api.put<ZapSignInfo>("/atendimento/zapsign", { token, ambiente })
          .then((i) => { setInfo(i); setToken(""); setMsg({ ok: true, texto: "ZapSign configurado." }); })
          .catch((e: unknown) => setMsg({ ok: false, texto: e instanceof Error ? e.message : "Não foi possível salvar." }))
          .finally(() => setSalvando(false));
      }}>{salvando ? "Salvando…" : "Salvar ZapSign"}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-red-600 dark:text-red-400"}>{msg.texto}</p>}
    </div>
  );
}
