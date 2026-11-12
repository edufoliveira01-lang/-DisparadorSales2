import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input, Textarea } from "@/components/ui/Input";

interface Modelos { antes: string; hoje: string; depois: string }
interface Config { ativa: boolean; antes_dias: number[]; no_dia: boolean; depois_dias: number[]; horario: string; pagamento: "" | "boleto_pix" | "pix" | "boleto"; formato: "separado" | "junto"; anexar_boleto: boolean; salvar_boleto_dropbox: boolean; modelos: Modelos }
const lista = (t: string) => t.split(/[,\s;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 90);

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
  if (!c) return <div className="space-y-3" role="status" aria-label="Carregando"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full" /></div>;
  const salvar = async () => {
    setSalvando(true);
    try { const r = await api.put<{ config: Config }>("/gestao/financeiro/regua", { ...c, antes_dias: lista(antes), depois_dias: lista(depois) }); setC(r.config); setAntes(r.config.antes_dias.join(", ")); setDepois(r.config.depois_dias.join(", ")); show("Configurações de cobrança salvas.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const bloqueado = !gerir;
  const caixa = (checked: boolean, onChange: (v: boolean) => void, titulo: ReactNode, texto?: ReactNode) => (
    <label className="flex items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
      <Checkbox className="mt-0.5" checked={checked} disabled={bloqueado} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0"><span className="font-medium">{titulo}</span>{texto && <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{texto}</span>}</span>
    </label>
  );
  return (
    <SettingsPanel
      icon={<Receipt />}
      title="Cobranças e avisos"
      description="Os botões Cobrar, Avisar e Enviar aviso do Financeiro e da ficha do cliente apenas executam o que estiver configurado aqui."
      status={c.ativa ? <Badge tone="success">Avisos automáticos ligados</Badge> : <Badge tone="neutral">Avisos automáticos desligados</Badge>}
    >
      {bloqueado && <SettingsBlock><Callout tone="aviso">Você pode ver estas opções, mas só quem gerencia o Financeiro pode alterá-las.</Callout></SettingsBlock>}

      <SettingsBlock title="Mensagens" description="O que cada aviso diz. Campo vazio volta ao texto padrão.">
        <Callout>Variáveis: <code>{"{nome}"}</code> (primeiro nome), <code>{"{descricao}"}</code>, <code>{"{valor}"}</code>, <code>{"{vencimento}"}</code>, <code>{"{quando}"}</code> e <code>{"{link}"}</code> (onde entra o pagamento).</Callout>
        {([["antes", "Antes do vencimento"], ["hoje", "No dia do vencimento"], ["depois", "Depois do vencimento (atraso)"]] as const).map(([k, rot]) => (
          <SettingRow key={k} label={rot} htmlFor={`cb-${k}`}><Textarea id={`cb-${k}`} rows={5} disabled={bloqueado} value={c.modelos[k]} onChange={(e) => setC({ ...c, modelos: { ...c.modelos, [k]: e.target.value } })} /></SettingRow>))}
      </SettingsBlock>

      <SettingsBlock title="Como enviar" description="Boleto, PIX e o formato da mensagem. O envio sai pelo Deskcomm.">
        {!asaas && <Callout tone="aviso">Para enviar boleto/PIX, ligue o Asaas em <a className="underline" href="/configuracoes?secao=asaas">Configurações → Asaas</a>. O envio em si exige o <a className="underline" href="/configuracoes?secao=deskcomm-envio">Deskcomm ligado</a>.</Callout>}
        <SettingRow label="Boleto e PIX" htmlFor="cb-pag" hint="Vale para parcelas ainda não vencidas; se já houver cobrança, o mesmo link é reaproveitado. Para atrasadas, escolha antes uma nova data.">
          <Select id="cb-pag" value={c.pagamento} disabled={bloqueado || !asaas} onChange={(e) => setC({ ...c, pagamento: e.target.value as Config["pagamento"] })}>
            <option value="">Só o lembrete (sem cobrança)</option><option value="boleto_pix">Gerar e enviar boleto e PIX</option><option value="pix">Gerar e enviar só PIX</option><option value="boleto">Gerar e enviar só boleto</option>
          </Select>
        </SettingRow>
        <SettingRow label="Formato da mensagem" htmlFor="cb-fmt" hint="Separado facilita copiar o código. Nome e cidade do PIX vão sem espaços para o código não quebrar.">
          <Select id="cb-fmt" value={c.formato} disabled={bloqueado} onChange={(e) => setC({ ...c, formato: e.target.value as Config["formato"] })}>
            <option value="separado">Separado: texto com o link; PIX e linha digitável em mensagens próprias</option><option value="junto">Tudo junto: uma única mensagem</option>
          </Select>
        </SettingRow>
        <SettingRow label="Boleto em PDF" hint="O PDF só existe para boleto (não para PIX puro) e é baixado do Asaas na hora.">
          {caixa(c.anexar_boleto, (v) => setC({ ...c, anexar_boleto: v }), "Enviar o PDF junto do aviso", "Chega como arquivo na conversa, logo depois do texto.")}
          {caixa(c.salvar_boleto_dropbox, (v) => setC({ ...c, salvar_boleto_dropbox: v }), "Guardar o PDF no cadastro do cliente",
            <>Em Arquivos e na pasta <i>BOLETOS E COBRANÇAS</i> do Dropbox. Precisa do <a className="underline" href="/configuracoes?secao=dropbox">Dropbox conectado</a>; sem ele, fica só no cadastro.</>)}
        </SettingRow>
      </SettingsBlock>

      <SettingsBlock title="Avisos automáticos" description="Lembretes de vencimento enviados sozinhos.">
        <SettingRow label="Avisos automáticos" hint="Cada parcela recebe cada aviso uma vez.">
          {caixa(c.ativa, (v) => setC({ ...c, ativa: v }), c.ativa ? "Ligados" : "Desligados")}
        </SettingRow>
        <SettingRow label="Antes do vencimento" htmlFor="cb-antes" hint="Dias separados por vírgula.">
          <Input id="cb-antes" value={antes} disabled={bloqueado} onChange={(e) => setAntes(e.target.value)} placeholder="ex.: 3, 1" />
        </SettingRow>
        <SettingRow label="No dia do vencimento">
          {caixa(c.no_dia, (v) => setC({ ...c, no_dia: v }), "Avisar no dia")}
        </SettingRow>
        <SettingRow label="Depois do vencimento" htmlFor="cb-depois" hint="Dias de atraso, separados por vírgula.">
          <Input id="cb-depois" value={depois} disabled={bloqueado} onChange={(e) => setDepois(e.target.value)} placeholder="ex.: 1, 7" />
        </SettingRow>
        <SettingRow label="Horário dos envios" htmlFor="cb-hora" hint="Horário de Brasília.">
          <Input id="cb-hora" type="time" className="w-36" value={c.horario} disabled={bloqueado} onChange={(e) => setC({ ...c, horario: e.target.value })} />
        </SettingRow>
        <Callout>Clientes com avisos pausados (botão na ficha do cliente) e parcelas sem telefone válido são ignorados. O que sai hoje e o histórico estão em <a className="underline" href="/gestao/financeiro">Financeiro → Cobrança automática</a>.</Callout>
      </SettingsBlock>
      {gerir && <SettingsFooter left="Vale para mensagens, envio e avisos automáticos.">
        <Button loading={salvando} onClick={() => void salvar()}>Salvar</Button>
      </SettingsFooter>}
    </SettingsPanel>
  );
}
