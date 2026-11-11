import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, Landmark } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
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

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5" /> Asaas (boleto e PIX)</CardTitle></CardHeader>
      <CardContent className="space-y-6 text-sm">
        <p className="text-zinc-600 dark:text-zinc-300">
          Com o Asaas ligado, cada parcela a receber ganha o botão <b>Boleto/PIX</b>: o sistema gera a cobrança, você envia o link pelo WhatsApp e, quando o cliente paga, a parcela recebe a <b>baixa sozinha</b>.
          Em <b>Financeiro → Taxas do Asaas</b> você acompanha quanto está gastando com tarifas. As notificações do próprio Asaas ficam desligadas (cada uma é cobrada).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Situação:</span>
          {e?.configurado ? <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />Chave salva ({e.final}) · {e.ambiente === "producao" ? "Produção" : "Testes"}</Badge> : <Badge tone="warning">Sem chave</Badge>}
        </div>

        <section className="space-y-3">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">1. Chave de API</h3>
          <p className="text-xs text-zinc-500">No Asaas: <i>Integrações → Chave de API</i>. Comece pelo ambiente de <b>testes (sandbox)</b>, que tem conta e chave próprias e não movimenta dinheiro.</p>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto]">
            <div><Label htmlFor="amb-asaas">Ambiente</Label><Select id="amb-asaas" value={ambiente} onChange={(ev) => setAmbiente(ev.target.value as "sandbox" | "producao")} className="mt-1.5"><option value="sandbox">Testes (sandbox)</option><option value="producao">Produção (dinheiro de verdade)</option></Select></div>
            <div><Label htmlFor="chave-asaas">Chave de API</Label><Input id="chave-asaas" className="mt-1.5" value={chave} onChange={(ev) => setChave(ev.target.value)} placeholder={e?.configurado ? "Cole uma nova chave para trocar" : "$aact_..."} autoComplete="off" /></div>
            <div className="flex items-end gap-2"><Button loading={salvando} onClick={() => void salvar()}>Salvar</Button><Button variant="outline" loading={testando} onClick={() => void testar()} disabled={!e?.configurado}>Testar</Button></div>
          </div>
          {resultado && <p role="status" className={resultado.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>{resultado.texto}</p>}
        </section>

        {e?.configurado && (
          <section className="space-y-3">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">2. Aviso de pagamento (baixa automática)</h3>
            <p className="text-xs text-zinc-500">No Asaas: <i>Integrações → Webhooks → Novo webhook</i>. Cadastre os dados abaixo, com o tipo de envio <b>sequencial</b> e os eventos de <b>cobranças</b> ligados.</p>
            {e.url_do_aviso ? (
              <div className="space-y-2">
                {([["URL do webhook", e.url_do_aviso], ["Token de autenticação", e.token_do_aviso]] as const).map(([r, v]) => (
                  <div key={r} className="flex items-center gap-2"><div className="min-w-0 flex-1"><Label>{r}</Label><Input readOnly value={v} className="mt-1.5 font-mono text-xs" onFocus={(ev) => ev.currentTarget.select()} /></div><Button variant="outline" className="mt-6" onClick={() => void copiar(v, r)}><Copy className="h-4 w-4" /> Copiar</Button></div>))}
              </div>
            ) : <p className="text-amber-700 dark:text-amber-300">Este escritório ainda não tem o atendimento ligado, então não há endereço público para o aviso. Fale comigo e eu configuro.</p>}
            <p className="text-xs text-zinc-500">Sem o webhook, o sistema ainda funciona: use <b>Atualizar situação</b> na cobrança de cada parcela para conferir se foi paga.</p>
          </section>)}
      </CardContent>
    </Card>
  );
}
