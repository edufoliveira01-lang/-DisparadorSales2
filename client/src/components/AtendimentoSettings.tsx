import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileSignature, Headset, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";

interface Relatorio { enviados: number; ok: number; revogados: number; semEmail: string[]; resultados: { email: string; ok: boolean; erro?: string }[]; removidos: { email: string; ok: boolean; erro?: string; removido?: boolean }[] }
interface ZapSignInfo { configurado: boolean; ambiente: "producao" | "sandbox"; token_final: string }

/** Atendimento (Deskcomm): acesso, assinatura de contratos (ZapSign) e envio da equipe. Antes ficava numa página própria. */
export function AtendimentoSettings() {
  const { user, can } = useAuth();
  const { show } = useToast();
  const [info, setInfo] = useState<{ disponivel: boolean; url: string | null } | null>(null);
  const [zap, setZap] = useState<ZapSignInfo | null>(null);
  const [token, setToken] = useState("");
  const [ambiente, setAmbiente] = useState<"producao" | "sandbox">("producao");
  const [salvandoZap, setSalvandoZap] = useState(false);
  const [equipe, setEquipe] = useState<{ carregando: boolean; erro?: string; relatorio?: Relatorio }>({ carregando: false });
  const semEmail = !user.email?.trim();
  const gerir = can("team.manage");

  useEffect(() => {
    api.get<{ disponivel: boolean; url: string | null }>("/atendimento/info", { fresh: true } as never).then(setInfo).catch(() => setInfo({ disponivel: false, url: null }));
    if (gerir) api.get<ZapSignInfo>("/atendimento/zapsign", { fresh: true } as never).then((i) => { setZap(i); setAmbiente(i.ambiente); }).catch(() => setZap(null));
  }, [gerir]);

  if (info === null) return <Skeleton className="h-64 w-full" />;
  if (!info.disponivel) {
    return (
      <SettingsPanel icon={<Headset />} title="Atendimento e equipe" description="Conversas de WhatsApp, agentes de IA e funil de vendas." status={<Badge tone="warning">Não liberado</Badge>}>
        <SettingsBlock><Callout tone="aviso">O atendimento não está liberado para este escritório. Fale com o suporte para incluí-lo no plano.</Callout></SettingsBlock>
      </SettingsPanel>
    );
  }

  const salvarZap = () => {
    setSalvandoZap(true);
    api.put<ZapSignInfo>("/atendimento/zapsign", { token, ambiente })
      .then((i) => { setZap(i); setToken(""); show("ZapSign configurado.", "success"); })
      .catch((e: unknown) => show(e instanceof Error ? e.message : "Não foi possível salvar.", "error"))
      .finally(() => setSalvandoZap(false));
  };

  return (
    <SettingsPanel icon={<Headset />} title="Atendimento e equipe" description="Entrada no atendimento, contratos com assinatura e a equipe que usa o chat." status={<Badge tone="success">Liberado</Badge>}>
      <SettingsBlock title="Acesso" description="Você entra com o mesmo e-mail e a mesma senha do sistema. Também dá para trocar de ambiente pelo alternador no topo do menu.">
        {semEmail ? (
          <Callout tone="aviso">Para entrar no atendimento, o seu usuário precisa ter um <b>e-mail cadastrado</b>, o mesmo que a equipe usa lá. <Link to="/minha-conta" className="font-semibold underline underline-offset-2">Cadastrar meu e-mail em Minha conta</Link></Callout>
        ) : (
          <Button variant="outline" onClick={() => window.location.assign("/api/atendimento/entrar")}><ExternalLink className="h-4 w-4" /> Ir para o atendimento</Button>
        )}
      </SettingsBlock>

      {gerir && (
        <SettingsBlock title="Contratos com assinatura (ZapSign)" description="Quando o atendente clica em «Gerar contrato» no atendimento, o sistema monta os documentos do kit com os dados do cliente e envia ao ZapSign para assinar.">
          <SettingRow label="Token da API do ZapSign" htmlFor="zap-token" hint={zap?.configurado ? `Token atual: …${zap.token_final}. Fica guardado criptografado.` : "Fica guardado criptografado e nunca volta inteiro."}>
            <Input id="zap-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={zap?.configurado ? "Deixe em branco para manter o token atual" : "Token da API do ZapSign"} />
          </SettingRow>
          <SettingRow label="Ambiente" htmlFor="zap-amb" hint="Use «Testes» para ensaiar sem valor legal.">
            <Select id="zap-amb" value={ambiente} onChange={(e) => setAmbiente(e.target.value as "producao" | "sandbox")}><option value="producao">Produção</option><option value="sandbox">Testes (sandbox)</option></Select>
          </SettingRow>
          <SettingsFooter left={zap?.configurado ? "ZapSign configurado." : "Ainda sem token."}>
            <Button loading={salvandoZap} disabled={!token.trim() && !zap?.configurado} onClick={salvarZap}><FileSignature className="h-4 w-4" /> Salvar ZapSign</Button>
          </SettingsFooter>
        </SettingsBlock>
      )}

      {gerir && (
        <SettingsBlock title="Equipe no atendimento" description="A equipe é enviada automaticamente quando alguém é cadastrado, alterado ou desativado (e conferida a cada poucas horas). Pessoas ativas com e-mail entram com o papel equivalente; quem é desativado perde o acesso.">
          {equipe.erro && <Callout tone="erro">{equipe.erro}</Callout>}
          {equipe.relatorio && (
            <Callout tone="ok">
              <b>{equipe.relatorio.ok}</b> de {equipe.relatorio.enviados} pessoas estão no atendimento.{equipe.relatorio.revogados > 0 && <> {equipe.relatorio.revogados} acesso(s) revogado(s).</>}
              {[...equipe.relatorio.resultados, ...equipe.relatorio.removidos].filter((r) => !r.ok).map((r) => <p key={r.email} className="text-red-700 dark:text-red-300">{r.email}: {r.erro}</p>)}
              {equipe.relatorio.semEmail.length > 0 && <p>Sem e-mail (não enviadas): {equipe.relatorio.semEmail.join(", ")}. Cadastre o e-mail em Equipe e acessos.</p>}
            </Callout>
          )}
          <SettingsFooter>
            <Button
              variant="outline"
              loading={equipe.carregando}
              onClick={() => {
                setEquipe({ carregando: true });
                api.post<Relatorio>("/atendimento/equipe/sincronizar", {})
                  .then((relatorio) => setEquipe({ carregando: false, relatorio }))
                  .catch((e: unknown) => setEquipe({ carregando: false, erro: e instanceof Error ? e.message : "Não foi possível sincronizar a equipe." }));
              }}
            ><Users className="h-4 w-4" /> Enviar equipe ao atendimento agora</Button>
          </SettingsFooter>
        </SettingsBlock>
      )}
    </SettingsPanel>
  );
}
