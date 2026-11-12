import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileSignature, Image as ImageIcon, ListChecks, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { GerenciarCampos } from "./Campos";
import { Checkbox } from "@/components/ui/Checkbox";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { BotoesAlinhamento, CartaoImagem, type Alinha } from "./ImagemUpload";
import { Link } from "react-router-dom";

interface Config {
  titulo: string; subtitulo: string; nome_escritorio: string; cabecalho_linhas: string[]; rodape: string; mostrar_foto: boolean; linhas_observacoes: number;
  secoes: Record<string, boolean>; assinatura: boolean; texto_assinatura: string; logo_modo: "mesma" | "propria"; logo_alinhamento: Alinha;
}
interface Resposta { config: Config; padrao: Config; tem_logo: boolean; tem_cabecalho: boolean; rotulo_secao: Record<string, string> }

/** Onde o escritório monta o visual da ficha impressa: título, cabeçalho, logotipo, seções, campos e assinatura. */
export function FichaModelo() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [r, setR] = useState<Resposta | null>(null);
  const [c, setC] = useState<Config | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [campos, setCampos] = useState(false);
  
  const carregar = useCallback(async () => {
    try { const x = await api.get<Resposta>("/gestao/ficha/config", { fresh: true } as never); setR(x); setC(x.config); }
    catch { show("Não foi possível carregar o modelo da ficha.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!c || !r) return <div className="space-y-4" role="status" aria-label="Carregando"><Skeleton className="h-16 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>;

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setC((x) => (x ? { ...x, [k]: v } : x));
  const linhaCab = (i: number, v: string) => { const l = [...c.cabecalho_linhas]; while (l.length < 3) l.push(""); l[i] = v; set("cabecalho_linhas", l); };
  const salvar = async () => {
    setSalvando(true);
    try { await api.put("/gestao/ficha/config", c); show("Modelo salvo.", "success"); setVersao((v) => v + 1); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const sujo = JSON.stringify(c) !== JSON.stringify(r.config);
  const linhas = [0, 1, 2].map((i) => c.cabecalho_linhas[i] ?? "");

  return (
    <div className="space-y-5">
      <PageHeader title="Ficha de cadastro" description="Monte a ficha impressa do jeito do escritório. A foto de cada cliente é colocada no cadastro dele."
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.open("/api/gestao/ficha/previa", "_blank", "noopener")}><ExternalLink className="h-4 w-4" /> Abrir prévia</Button>{gerir && <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar modelo</Button>}</div>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,460px)_1fr]">
        <fieldset disabled={!gerir} className="min-w-0 space-y-5">
          <SettingsPanel icon={<ImageIcon />} title="Cabeçalho" description="Título, dados do escritório e logotipo no topo da ficha.">
            <SettingsBlock>
              <SettingRow label="Título" htmlFor="fm-titulo"><Input id="fm-titulo" value={c.titulo} onChange={(e) => set("titulo", e.target.value)} /></SettingRow>
              <SettingRow label="Subtítulo" htmlFor="fm-sub"><Input id="fm-sub" value={c.subtitulo} onChange={(e) => set("subtitulo", e.target.value)} /></SettingRow>
              <SettingRow label="Nome do escritório" htmlFor="fm-nome"><Input id="fm-nome" value={c.nome_escritorio} onChange={(e) => set("nome_escritorio", e.target.value)} placeholder="Sales & Associados" /></SettingRow>
              <SettingRow label="Linhas do cabeçalho" hint="Endereço, telefone, OAB…">
                {linhas.map((l, i) => <Input key={i} aria-label={`Linha do cabeçalho ${i + 1}`} placeholder={`Linha ${i + 1}`} value={l} onChange={(e) => linhaCab(i, e.target.value)} />)}
              </SettingRow>
            </SettingsBlock>
            <SettingsBlock title="Logotipo" description="Escolha qual imagem aparece no topo da ficha.">
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Qual imagem usar na ficha">
                {([["mesma", "Usar o cabeçalho dos documentos", "A mesma imagem da procuração e do contrato."], ["propria", "Usar uma imagem só da ficha", "Envie uma imagem diferente para a ficha."]] as const).map(([v, t, d]) => (
                  <button key={v} type="button" role="radio" aria-checked={c.logo_modo === v} onClick={() => set("logo_modo", v)} className={`rounded-xl border p-3 text-left text-sm transition ${c.logo_modo === v ? "border-accent-500 bg-accent-500/10" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"}`}><span className="block font-semibold text-zinc-900 dark:text-zinc-100">{t}</span><span className="mt-0.5 block text-xs text-zinc-500">{d}</span></button>
                ))}
              </div>
              {c.logo_modo === "mesma"
                ? <div className="rounded-xl border border-dashed border-zinc-300 p-3 text-center dark:border-zinc-700">{r.tem_cabecalho || r.tem_logo ? <img key={versao} src={r.tem_cabecalho ? `/api/gestao/imagens/cabecalho?v=${versao}` : `/api/gestao/ficha/logo?v=${versao}`} alt="Cabeçalho dos documentos" className="mx-auto h-14 max-w-full object-contain" /> : <span className="text-xs text-zinc-500">Nenhuma imagem enviada ainda.</span>}<p className="mt-2 text-xs text-zinc-500">A imagem se troca em <Link className="underline" to="/configuracoes/escritorio">Dados do escritório</Link>.</p></div>
                : <CartaoImagem titulo="Imagem própria da ficha" descricao="PNG, JPG ou WebP, até 1 MB." urlBase="/api/gestao/ficha/logo" tem={r.tem_logo} podeEditar={gerir} altura="h-14" aoMudar={() => { setVersao((v) => v + 1); void carregar(); }} />}
              <SettingRow label="Posição do logotipo"><BotoesAlinhamento valor={c.logo_alinhamento} aoMudar={(v) => set("logo_alinhamento", v)} desabilitado={!gerir} /></SettingRow>
              <SettingRow label="Foto do cliente" hint="Quadro 3x4 na ficha.">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><Checkbox checked={c.mostrar_foto} onChange={(e) => set("mostrar_foto", e.target.checked)} /> Mostrar o quadro da foto</label>
              </SettingRow>
            </SettingsBlock>
          </SettingsPanel>

          <SettingsPanel icon={<ListChecks />} title="O que sai na ficha" description="Marque as seções que devem aparecer." status={<Badge tone="accent">{Object.keys(r.rotulo_secao).filter((k) => c.secoes[k] !== false).length} de {Object.keys(r.rotulo_secao).length}</Badge>}>
            <SettingsBlock>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(r.rotulo_secao).map(([k, rot]) => <label key={k} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><Checkbox checked={c.secoes[k] !== false} onChange={(e) => set("secoes", { ...c.secoes, [k]: e.target.checked })} /> {rot}</label>)}
              </div>
              <SettingRow label="Linhas em branco" hint="Para anotar à mão (0 a 25)." htmlFor="fm-linhas"><Input id="fm-linhas" type="number" min={0} max={25} value={c.linhas_observacoes} onChange={(e) => set("linhas_observacoes", Number(e.target.value))} className="w-28" /></SettingRow>
            </SettingsBlock>
            <SettingsBlock title="Campos personalizados" description="Senha do GOV, serviço, indicação… são criados e organizados aqui.">
              {gerir && <div><Button type="button" size="sm" variant="outline" onClick={() => setCampos(true)}>Criar e organizar campos</Button></div>}
            </SettingsBlock>
          </SettingsPanel>

          <SettingsPanel icon={<FileSignature />} title="Assinatura e rodapé">
            <SettingsBlock>
              <SettingRow label="Assinatura do cliente">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><Checkbox checked={c.assinatura} onChange={(e) => set("assinatura", e.target.checked)} /> Incluir campo de assinatura</label>
              </SettingRow>
              {c.assinatura && <SettingRow label="Texto acima da assinatura" hint="Declaração, aviso de privacidade…" htmlFor="fm-ass"><Textarea id="fm-ass" rows={3} value={c.texto_assinatura} onChange={(e) => set("texto_assinatura", e.target.value)} /></SettingRow>}
              <SettingRow label="Texto do rodapé" htmlFor="fm-rod"><Input id="fm-rod" value={c.rodape} onChange={(e) => set("rodape", e.target.value)} /></SettingRow>
            </SettingsBlock>
          </SettingsPanel>
          {gerir && (
            <div className="sticky bottom-3 z-10 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
              <SettingsFooter left={sujo ? <span className="font-medium text-amber-700 dark:text-amber-300">Há alterações não salvas.</span> : "Tudo salvo."}>
                <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar modelo</Button>
              </SettingsFooter>
            </div>
          )}
        </fieldset>
        <SettingsPanel className="min-w-0 self-start xl:sticky xl:top-4" title="Pré-visualização" description="Com um cliente de exemplo. Atualiza ao salvar."
          status={sujo ? <Badge tone="warning">Salve para atualizar</Badge> : undefined}
          actions={<Button size="sm" variant="outline" onClick={() => window.open("/api/gestao/ficha/previa", "_blank", "noopener")}><ExternalLink className="h-4 w-4" /> Abrir</Button>}>
          <div className="p-4"><iframe key={versao} title="Pré-visualização da ficha" src={`/api/gestao/ficha/previa?v=${versao}`} className="h-[1100px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800" /></div>
        </SettingsPanel>
      </div>
      {campos && <GerenciarCampos entidade="pessoa" aoFechar={() => { setCampos(false); setVersao((v) => v + 1); }} />}
    </div>
  );
}
