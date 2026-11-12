import { useCallback, useEffect, useState } from "react";
import { Copy, Landmark } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

interface Estado { configurado: boolean; final: string; ambiente: "sandbox" | "producao"; url_do_aviso: string; token_do_aviso: string }

/** Asaas: a chave de API, o ambiente (testes ou produção) e os dados para cadastrar o aviso de pagamento no painel do Asaas. */
export function AsaasSettings() {
  const { show } = useToast();
  const [e, setE] = useState<Estado | null>(null);
  const [chave, setChave] = useState("");
  const [ambiente, setAmbiente] = useState<"sandbox" | "producao">("sandbox");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const carregar = useCallback(async () => { try { const r = await api.get<Estado>("/gestao/asaas/config", { fresh: true } as never); setE(r); setAmbiente(r.ambiente); } catch { show("Não foi possível carregar o Asaas.", "error"); } }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true); setResultado(null);
    try { const r = await api.put<Estado>("/gestao/asaas/config", { ambiente, ...(chave.trim() || e?.configurado ? { chave } : {}) }); setE(r); setChave(""); show("Configuração salva.", "success"); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const testar = async () => {
    setTestando(true); setResultado(null);
    try { const r = await api.post<{ saldo_centavos: number; ambiente: string }>("/gestao/asaas/testar", {}); setResultado({ ok: true, texto: `Funcionou. Ambiente: ${r.ambiente === "producao" ? "produção" : "testes"} · saldo da conta: ${(r.saldo_centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.` }); }
    catch (err) { setResultado({ ok: false, texto: err instanceof ApiError ? err.message : "Não foi possível testar." }); }
    finally { setTestando(false); }
  };
  const copiar = async (t: string, rot: string) => { try { await navigator.clipboard.writeText(t); show(`${rot} copiado.`, "success"); } catch { show("Não consegui copiar. Selecione e copie à mão.", "info"); } };

  if (!e) return <Skeleton className="h-72 w-full" />;
  return (
    <SettingsPanel
      icon={<Landmark />}
      title="Asaas (boleto e PIX)"
      description="Gera boleto e PIX para cada parcela e dá baixa sozinho quando o cliente paga."
      status={e.configurado ? <Badge tone="success">Conectado · {e.ambiente === "producao" ? "Produção" : "Testes"} · {e.final}</Badge> : <Badge tone="warning">Sem chave</Badge>}
    >
      <SettingsBlock step={1} title="Chave de API" description="No Asaas: Integrações → Chave de API.">
        <SettingRow label="Ambiente" htmlFor="amb-asaas" hint="Comece pelo teste (sandbox): tem conta e chave próprias e não movimenta dinheiro.">
          <Select id="amb-asaas" value={ambiente} onChange={(ev) => setAmbiente(ev.target.value as "sandbox" | "producao")}><option value="sandbox">Testes (sandbox)</option><option value="producao">Produção (dinheiro de verdade)</option></Select>
        </SettingRow>
        <SettingRow label="Chave de API" htmlFor="chave-asaas" hint={e.configurado ? `Chave atual termina em ${e.final}.` : "Cole a chave gerada no Asaas."}>
          <Input id="chave-asaas" value={chave} onChange={(ev) => setChave(ev.target.value)} placeholder={e.configurado ? "Cole uma nova chave para trocar" : "$aact_..."} autoComplete="off" />
        </SettingRow>
        {resultado && <Callout tone={resultado.ok ? "ok" : "erro"}>{resultado.texto}</Callout>}
        <SettingsFooter left="Cada parcela ganha o botão Boleto/PIX; as notificações do Asaas ficam desligadas (são cobradas).">
          <Button variant="outline" loading={testando} onClick={() => void testar()} disabled={!e.configurado}>Testar conexão</Button>
          <Button loading={salvando} onClick={() => void salvar()}>Salvar</Button>
        </SettingsFooter>
      </SettingsBlock>

      {e.configurado && (
        <SettingsBlock step={2} title="Aviso de pagamento (baixa automática)" description="No Asaas: Integrações → Webhooks → Novo webhook. Use envio sequencial e ligue os eventos de cobranças.">
          {e.url_do_aviso ? (
            <>
              {([["URL do webhook", e.url_do_aviso], ["Token de autenticação", e.token_do_aviso]] as const).map(([r, v], i) => (
                <SettingRow key={r} label={r} htmlFor={`asaas-wh-${i}`}>
                  <div className="flex items-center gap-2"><Input id={`asaas-wh-${i}`} readOnly value={v} className="min-w-0 flex-1 font-mono text-xs" onFocus={(ev) => ev.currentTarget.select()} /><Button variant="outline" onClick={() => void copiar(v, r)}><Copy className="h-4 w-4" /> Copiar</Button></div>
                </SettingRow>))}
            </>
          ) : <Callout tone="aviso">Este escritório ainda não tem o atendimento ligado, então não há endereço público para o aviso. Fale comigo e eu configuro.</Callout>}
          <Callout>Sem o webhook o sistema continua funcionando: use <b>Atualizar situação</b> na cobrança de cada parcela para conferir se foi paga. Os custos aparecem em Financeiro → Taxas do Asaas.</Callout>
        </SettingsBlock>)}
    </SettingsPanel>
  );
}
