import { formatPhoneDisplay } from "@/lib/phone";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

interface Estado { configurado: boolean; final: string; atendimento_ligado: boolean; pronto: boolean; canal_padrao: string; canal_cobranca: string; canal_avisos: string; canal_djen: string; provedor: "proprio" | "deskcomm" }
interface Canal { id: string; nome: string; telefone: string; status: string; pronto: boolean; pausado: boolean }

/** Envio de cobranças e avisos pelo Deskcomm: o token de API do atendimento, para a mensagem sair pela conversa do cliente. */
export function DeskcommEnvioSettings() {
  const { show } = useToast();
  const [e, setE] = useState<Estado | null>(null);
  const [token, setToken] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [canais, setCanais] = useState<Canal[] | null>(null);
  const [erroCanais, setErroCanais] = useState("");
  const [padrao, setPadrao] = useState("");
  const [cobranca, setCobranca] = useState("");
  const [avisos, setAvisos] = useState("");
  const [djen, setDjen] = useState("");
  const [trocandoProvedor, setTrocandoProvedor] = useState(false);
  const [salvandoCanal, setSalvandoCanal] = useState(false);
  const carregarCanais = useCallback(async () => {
    setErroCanais("");
    try { const r = await api.get<{ canais: Canal[] }>("/gestao/deskcomm/canais", { fresh: true } as never); setCanais(r.canais); }
    catch (err) { setCanais(null); setErroCanais(err instanceof ApiError ? err.message : "Não foi possível listar os números."); }
  }, []);
  const carregar = useCallback(async () => { try { const r = await api.get<Estado>("/gestao/deskcomm/config", { fresh: true } as never); setE(r); setPadrao(r.canal_padrao); setCobranca(r.canal_cobranca); setAvisos(r.canal_avisos); setDjen(r.canal_djen); if (r.pronto) void carregarCanais(); } catch { show("Não foi possível carregar.", "error"); } }, [show, carregarCanais]);
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
  const salvarCanais = async () => {
    setSalvandoCanal(true);
    try { setE(await api.put<Estado>("/gestao/deskcomm/config", { canal_padrao: padrao, canal_cobranca: cobranca, canal_avisos: avisos, canal_djen: djen })); show("Número de envio salvo.", "success"); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvandoCanal(false); }
  };
  const trocarProvedor = async (p: "proprio" | "deskcomm") => {
    setTrocandoProvedor(true);
    try { setE(await api.put<Estado>("/gestao/deskcomm/config", { provedor: p })); show(p === "deskcomm" ? "Agora tudo sai pelo WhatsApp do Deskcomm." : "Voltou ao WhatsApp conectado neste sistema.", "success"); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível trocar.", "error"); }
    finally { setTrocandoProvedor(false); }
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
          <li>Marque as permissões de <b>leitura</b> (<code>mcp:read</code>) e de <b>escrita</b> (<code>mcp:write</code>) e copie o token (começa com <code>dsk_</code>). Ele só aparece uma vez.</li>
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
      <SettingsBlock step={3} title="Escolha o número de WhatsApp" description="O Deskcomm pode ter mais de um celular conectado. A conexão (QR Code) é feita lá; aqui você só escolhe por qual número o Sales envia.">
        {!e.pronto ? <Callout tone="info">Salve o token no passo 2 para ver os números conectados.</Callout>
          : erroCanais ? <Callout tone="aviso">{erroCanais} Se o Deskcomm foi atualizado agora, gere um token com permissão de leitura (<code>mcp:read</code>) e salve de novo.</Callout>
          : !canais ? <Skeleton className="h-24 w-full" />
          : canais.length === 0 ? <Callout tone="aviso">Nenhum número conectado no Deskcomm. Conecte um em <i>Atendimento → Conexões</i>.</Callout>
          : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Número padrão">
                {[{ id: "", nome: "Automático", telefone: "O Deskcomm usa o primeiro número conectado.", status: "", pronto: true, pausado: false } as Canal, ...canais].map((c) => (
                  <li key={c.id || "auto"}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${padrao === c.id ? "border-accent-400 bg-accent-50/60 dark:border-accent-600 dark:bg-accent-950/30" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"}`}>
                      <input type="radio" name="canal-padrao" className="mt-1 accent-[var(--accent-500,#2563eb)]" checked={padrao === c.id} onChange={() => setPadrao(c.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</span>
                          {c.id && <Badge tone={c.pausado ? "neutral" : c.pronto ? "success" : "warning"}>{c.pausado ? "Pausado" : c.pronto ? "Conectado" : "Desconectado"}</Badge>}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{formatPhoneDisplay(c.telefone)}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {([["Cobranças e boletos", "canal-cobranca", cobranca, setCobranca, "Opcional: use outro número só para cobrar."], ["Avisos de perícia, audiência e lembretes", "canal-avisos", avisos, setAvisos, "Opcional: número dos avisos aos clientes."], ["Andamentos do processo (DJEN)", "canal-djen", djen, setDjen, "Opcional: número das mensagens sobre processos."]] as const).map(([rot, idc, val, set, dica]) => (
                <SettingRow key={idc} label={rot} htmlFor={idc} hint={dica}>
                  <Select id={idc} value={val} onChange={(ev) => set(ev.target.value)}>
                    <option value="">Mesmo número padrão</option>
                    {canais.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.pronto ? "" : " (desconectado)"}</option>)}
                  </Select>
                </SettingRow>
              ))}
              {[padrao, cobranca, avisos, djen].some((id) => id && canais.find((c) => c.id === id && !c.pronto)) && <Callout tone="aviso">O número escolhido está desconectado no Deskcomm. Enquanto isso, os envios falham com aviso (o sistema não troca de número sozinho, para o cliente não receber de um celular desconhecido).</Callout>}
              <SettingsFooter left="Conversas que já existem continuam no número em que começaram.">
                <Button variant="outline" onClick={() => void carregarCanais()}>Atualizar lista</Button>
                <Button loading={salvandoCanal} onClick={() => void salvarCanais()}>Salvar número</Button>
              </SettingsFooter>
            </>
          )}
      </SettingsBlock>
      <SettingsBlock step={4} title="Usar este WhatsApp para tudo" description="Passa os avisos de perícia e audiência, os lembretes, as mensagens do DJEN e as cobranças para o WhatsApp do Deskcomm. As respostas e as confirmações de leitura voltam para cá sozinhas (a conferência roda a cada minuto).">
        {e.provedor === "deskcomm"
          ? <Callout tone="ok">Ligado: nenhum envio usa mais a conexão (QR Code) deste sistema. Se algo der errado, dá para voltar abaixo.</Callout>
          : <Callout tone="info">Hoje as cobranças saem pelo Deskcomm, mas os avisos de perícia, lembretes e DJEN ainda usam o WhatsApp conectado neste sistema.</Callout>}
        <SettingsFooter left={e.provedor === "deskcomm" ? "A sessão do WhatsApp deste sistema fica guardada: ao voltar, basta clicar em Conectar em Configurações → WhatsApp." : "Escolha o número no passo 3 antes de ligar."}>
          {e.provedor === "deskcomm"
            ? <Button variant="outline" loading={trocandoProvedor} onClick={() => void trocarProvedor("proprio")}>Voltar ao WhatsApp deste sistema</Button>
            : <Button loading={trocandoProvedor} disabled={!e.pronto} onClick={() => void trocarProvedor("deskcomm")}>Usar o WhatsApp do Deskcomm para tudo</Button>}
        </SettingsFooter>
      </SettingsBlock>
    </SettingsPanel>
  );
}
