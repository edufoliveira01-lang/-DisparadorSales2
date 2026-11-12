import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";

interface Modelos { antes: string; hoje: string; depois: string }
interface Config { ativa: boolean; antes_dias: number[]; no_dia: boolean; depois_dias: number[]; horario: string; pagamento: "" | "boleto_pix" | "pix" | "boleto"; formato: "separado" | "junto"; modelos: Modelos }
const lista = (t: string) => t.split(/[,\s;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90);
const sel = "mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-zinc-900";

/** Todas as opções de cobrança num só lugar: o que vai na mensagem, como é enviado, os textos e os avisos automáticos. Os botões do Financeiro só executam. */
export function CobrancaSettings() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("financeiro.manage");
  const [c, setC] = useState<Config | null>(null);
  const [asaas, setAsaas] = useState(false);
  const [antes, setAntes] = useState("");
  const [depois, setDepois] = useState("");
  const [salvando, setSalvando] = useState(false);
  const ler = useCallback(async () => {
    try { const r = await api.get<{ config: Config; asaas: boolean }>("/gestao/financeiro/regua", { fresh: true } as never); setC(r.config); setAsaas(r.asaas); setAntes(r.config.antes_dias.join(", ")); setDepois(r.config.depois_dias.join(", ")); }
    catch { show("Não foi possível carregar.", "error"); }
  }, [show]);
  useEffect(() => { void ler(); }, [ler]);
  if (!c) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const salvar = async () => {
    setSalvando(true);
    try { const r = await api.put<{ config: Config }>("/gestao/financeiro/regua", { ...c, antes_dias: lista(antes), depois_dias: lista(depois) }); setC(r.config); setAntes(r.config.antes_dias.join(", ")); setDepois(r.config.depois_dias.join(", ")); show("Configurações de cobrança salvas.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const bloqueado = !gerir;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Cobranças e avisos</CardTitle></CardHeader>
      <CardContent className="space-y-7 text-sm">
        <p className="text-zinc-600 dark:text-zinc-300">Aqui ficam todas as opções. Os botões <b>Cobrar</b>, <b>Avisar</b> e <b>Enviar aviso</b> do Financeiro e da ficha do cliente apenas executam o que estiver configurado. O envio sai pelo Deskcomm (<a className="underline" href="/configuracoes?secao=deskcomm-envio">ligar o envio</a>).</p>

        <section className="space-y-3">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">1. O que vai em cada aviso</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="cb-pag">Boleto e PIX</Label>
              <select id="cb-pag" className={sel} value={c.pagamento} disabled={bloqueado || !asaas} onChange={(e) => setC({ ...c, pagamento: e.target.value as Config["pagamento"] })}>
                <option value="">Só o lembrete (sem cobrança)</option><option value="boleto_pix">Gerar e enviar boleto e PIX</option><option value="pix">Gerar e enviar só PIX</option><option value="boleto">Gerar e enviar só boleto</option>
              </select>
              <p className="mt-1 text-xs text-zinc-500">{asaas ? "Vale só para parcelas ainda não vencidas; se já houver cobrança, o mesmo link é reaproveitado. Para atrasadas, escolha antes uma nova data." : "Ligue o Asaas (Configurações → Asaas) para enviar boleto/PIX."}</p></div>
            <div><Label htmlFor="cb-fmt">Como enviar o pagamento</Label>
              <select id="cb-fmt" className={sel} value={c.formato} disabled={bloqueado} onChange={(e) => setC({ ...c, formato: e.target.value as Config["formato"] })}>
                <option value="separado">Separado: texto com o link; PIX e linha digitável em mensagens próprias</option><option value="junto">Tudo junto: uma única mensagem</option>
              </select>
              <p className="mt-1 text-xs text-zinc-500">Separado é mais fácil para o cliente copiar o código. O nome e a cidade do PIX são enviados sem espaços para o código não quebrar.</p></div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">2. Textos dos avisos</h3>
          <p className="text-xs text-zinc-500">Variáveis: <code>{"{nome}"}</code> (primeiro nome), <code>{"{descricao}"}</code>, <code>{"{valor}"}</code>, <code>{"{vencimento}"}</code>, <code>{"{quando}"}</code> e <code>{"{link}"}</code> (onde entra o pagamento). Campo vazio volta ao texto padrão.</p>
          {([["antes", "Antes do vencimento"], ["hoje", "No dia do vencimento"], ["depois", "Depois do vencimento (atraso)"]] as const).map(([k, rot]) => (
            <div key={k}><Label htmlFor={`cb-${k}`}>{rot}</Label><Textarea id={`cb-${k}`} className="mt-1.5" rows={5} disabled={bloqueado} value={c.modelos[k]} onChange={(e) => setC({ ...c, modelos: { ...c.modelos, [k]: e.target.value } })} /></div>))}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">3. Avisos automáticos de vencimento</h3>
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={c.ativa} disabled={bloqueado} onChange={(e) => setC({ ...c, ativa: e.target.checked })} /> {c.ativa ? "Ligados" : "Desligados"}</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor="cb-antes">Avisar ANTES do vencimento (dias)</Label><Input id="cb-antes" className="mt-1.5" value={antes} disabled={bloqueado} onChange={(e) => setAntes(e.target.value)} placeholder="ex.: 3, 1" /></div>
            <div><Label htmlFor="cb-depois">Avisar DEPOIS do vencimento (dias)</Label><Input id="cb-depois" className="mt-1.5" value={depois} disabled={bloqueado} onChange={(e) => setDepois(e.target.value)} placeholder="ex.: 1, 7" /></div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={c.no_dia} disabled={bloqueado} onChange={(e) => setC({ ...c, no_dia: e.target.checked })} /> Avisar no dia do vencimento</label>
            <div><Label htmlFor="cb-hora">Horário dos envios (Brasília)</Label><Input id="cb-hora" type="time" className="mt-1.5 w-36" value={c.horario} disabled={bloqueado} onChange={(e) => setC({ ...c, horario: e.target.value })} /></div>
          </div>
          <p className="text-xs text-zinc-500">Cada parcela recebe cada aviso uma vez. Clientes com avisos pausados (botão na ficha do cliente) e parcelas sem telefone válido são ignorados. Acompanhe o que sai hoje e o histórico em <a className="underline" href="/gestao/financeiro">Financeiro → Cobrança automática</a>.</p>
        </section>
        {gerir && <div className="flex justify-end"><Button loading={salvando} onClick={() => void salvar()}>Salvar</Button></div>}
      </CardContent>
    </Card>
  );
}
