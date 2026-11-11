import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MessageCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";

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
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" /> Envio pelo Deskcomm (cobranças e avisos)</CardTitle></CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="text-zinc-600 dark:text-zinc-300">As cobranças, os avisos de vencimento e os envios em lote saem <b>pelo Deskcomm</b>: a mensagem fica na conversa do cliente, no histórico do atendimento, e a resposta dele cai ali. Para isso o Sales precisa de um token de API do Deskcomm.</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Situação:</span>
          {e?.pronto ? <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />Ligado (token {e.final})</Badge> : !e?.atendimento_ligado && e ? <Badge tone="warning">Atendimento não ligado a este escritório</Badge> : <Badge tone="warning">Sem token</Badge>}
        </div>
        <section className="space-y-2">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Como gerar o token</h3>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-500">
            <li>No Deskcomm, abra <i>Configurações → Tokens de API</i> e crie um token novo.</li>
            <li>Marque a permissão de <b>escrita</b> (<code>mcp:write</code>) e copie o token (começa com <code>dsk_</code>). Ele só aparece uma vez.</li>
            <li>Cole abaixo e salve. O token fica guardado criptografado neste sistema.</li>
          </ol>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div><Label htmlFor="tok-desk">Token de API do Deskcomm</Label><Input id="tok-desk" className="mt-1.5" value={token} onChange={(ev) => setToken(ev.target.value)} placeholder={e?.configurado ? "Cole um novo token para trocar" : "dsk_..."} autoComplete="off" spellCheck={false} /></div>
            <div className="flex items-end gap-2"><Button loading={salvando} onClick={() => void salvar()} disabled={!token.trim()}>Salvar</Button><Button variant="outline" loading={testando} onClick={() => void testar()} disabled={!e?.configurado}>Testar</Button></div>
          </div>
          {resultado && <p role="status" className={resultado.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>{resultado.texto}</p>}
        </section>
        <p className="text-xs text-zinc-500">O envio usa o WhatsApp que estiver conectado no Deskcomm. Sem token, nada é enviado (o sistema avisa o motivo).</p>
      </CardContent>
    </Card>
  );
}
