import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";

interface Estado { configurado: boolean; final: string; atendimento_ligado: boolean; pronto: boolean }

/** Envio de cobranças e avisos pelo Deskcomm: o token de API do atendimento, para a mensagem sair pela conversa do cliente. */
export function DeskcommEnvioSettings() {
  const { show } = useToast();
  const [e, setE] = useState<Estado | null>(null);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const carregar = useCallback(async () => { try { setE(await api.get<Estado>("/gestao/deskcomm/config", { fresh: true } as never)); } catch { show("Não foi possível carregar.", "error"); } }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const salvar = async () => {
    setSalvando(true); setResultado(null);
    try { setE(await api.put<Estado>("/gestao/deskcomm/config", { token })); setToken(""); show("Token salvo.", "success"); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const testar = async () => {
    setTestando(true); setResultado(null);
    try { await api.post("/gestao/deskcomm/testar", {}); setResultado({ ok: true, texto: "Funcionou: o Deskcomm aceitou o token e ele pode enviar mensagens." }); }
    catch (err) { setResultado({ ok: false, texto: err instanceof ApiError ? err.message : "Não foi possível testar." }); }
    finally { setTestando(false); }
  };
  if (!e) return <Skeleton className="h-64 w-full" />;
  const status = e.pronto ? <Badge tone="success">Ligado · token {e.final}</Badge> : !e.atendimento_ligado ? <Badge tone="warning">Atendimento não ligado</Badge> : <Badge tone="warning">Sem token</Badge>;
  return (
    <SettingsPanel
      icon={<MessageCircle />}
      title="Envio pelo Deskcomm"
      description="Cobranças, avisos de vencimento e envios em lote saem pela conversa do cliente, e a resposta cai no atendimento."
      status={status}
    >
      <SettingsBlock step={1} title="Gere o token no Deskcomm">
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
          <li>No Deskcomm, abra <i>Configurações → Tokens de API</i> e crie um token novo.</li>
          <li>Marque a permissão de <b>escrita</b> (<code>mcp:write</code>) e copie o token (começa com <code>dsk_</code>). Ele só aparece uma vez.</li>
        </ol>
      </SettingsBlock>
      <SettingsBlock step={2} title="Cole o token aqui">
        {!e.atendimento_ligado && <Callout tone="aviso">O atendimento não está ligado a este escritório; o token só terá efeito depois disso.</Callout>}
        <SettingRow label="Token de API" htmlFor="tok-desk" hint="Fica guardado criptografado neste sistema.">
          <Input id="tok-desk" value={token} onChange={(ev) => setToken(ev.target.value)} placeholder={e.configurado ? "Cole um novo token para trocar" : "dsk_..."} autoComplete="off" spellCheck={false} />
        </SettingRow>
        {resultado && <Callout tone={resultado.ok ? "ok" : "erro"}>{resultado.texto}</Callout>}
        <SettingsFooter left="O envio usa o WhatsApp conectado no Deskcomm. Sem token, nada é enviado e o sistema avisa o motivo.">
          <Button variant="outline" loading={testando} onClick={() => void testar()} disabled={!e.configurado}>Testar envio</Button>
          <Button loading={salvando} onClick={() => void salvar()} disabled={!token.trim()}>Salvar token</Button>
        </SettingsFooter>
      </SettingsBlock>
    </SettingsPanel>
  );
}
