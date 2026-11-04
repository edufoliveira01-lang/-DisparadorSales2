import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, ImagePlus, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { GerenciarCampos } from "./Campos";
import { Campo } from "./comum";
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
  const entrada = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try { const x = await api.get<Resposta>("/gestao/ficha/config", { fresh: true } as never); setR(x); setC(x.config); }
    catch { show("Não foi possível carregar o modelo da ficha.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!c || !r) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setC((x) => (x ? { ...x, [k]: v } : x));
  const linhaCab = (i: number, v: string) => { const l = [...c.cabecalho_linhas]; while (l.length < 3) l.push(""); l[i] = v; set("cabecalho_linhas", l); };
  const salvar = async () => {
    setSalvando(true);
    try { await api.put("/gestao/ficha/config", c); show("Modelo salvo.", "success"); setVersao((v) => v + 1); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const enviarLogo = async (f: File | undefined) => {
    if (!f) return;
    try { await api.upload("/gestao/ficha/logo", f); show("Logotipo salvo.", "success"); setVersao((v) => v + 1); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível enviar o logotipo.", "error"); }
    finally { if (entrada.current) entrada.current.value = ""; }
  };
  const tirarLogo = async () => { try { await api.delete("/gestao/ficha/logo"); setVersao((v) => v + 1); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível remover.", "error"); } };
  const linhas = [0, 1, 2].map((i) => c.cabecalho_linhas[i] ?? "");

  return (
    <div className="space-y-5">
      <PageHeader title="Ficha de cadastro" description="Monte a ficha impressa do jeito do escritório. A foto de cada cliente é colocada no cadastro dele."
        actions={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.open("/api/gestao/ficha/previa", "_blank", "noopener")}><ExternalLink className="h-4 w-4" /> Abrir prévia</Button>{gerir && <Button loading={salvando} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar modelo</Button>}</div>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-5">
          <fieldset disabled={!gerir} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Cabeçalho</h2>
            <Campo rotulo="Título da ficha"><Input value={c.titulo} onChange={(e) => set("titulo", e.target.value)} className="mt-1.5" /></Campo>
            <Campo rotulo="Subtítulo"><Input value={c.subtitulo} onChange={(e) => set("subtitulo", e.target.value)} className="mt-1.5" /></Campo>
            <Campo rotulo="Nome do escritório"><Input value={c.nome_escritorio} onChange={(e) => set("nome_escritorio", e.target.value)} className="mt-1.5" placeholder="Sales & Associados" /></Campo>
            {linhas.map((l, i) => <Campo key={i} rotulo={`Linha do cabeçalho ${i + 1} (endereço, telefone, OAB…)`}><Input value={l} onChange={(e) => linhaCab(i, e.target.value)} className="mt-1.5" /></Campo>)}
            <div className="space-y-3">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Logotipo da ficha</p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Qual imagem usar na ficha">
                {([["mesma", "Usar o cabeçalho dos documentos", "A mesma imagem da procuração e do contrato."], ["propria", "Usar uma imagem só da ficha", "Envie uma imagem diferente para a ficha."]] as const).map(([v, t, d]) => (
                  <button key={v} type="button" role="radio" aria-checked={c.logo_modo === v} onClick={() => set("logo_modo", v)} className={`rounded-xl border p-3 text-left text-sm transition ${c.logo_modo === v ? "border-accent-500 bg-accent-500/10" : "border-zinc-200 dark:border-zinc-700"}`}><span className="block font-semibold">{t}</span><span className="mt-0.5 block text-xs text-zinc-500">{d}</span></button>
                ))}
              </div>
              {c.logo_modo === "mesma"
                ? <div className="rounded-xl border border-dashed border-zinc-300 p-3 text-center dark:border-zinc-700">{r.tem_cabecalho || r.tem_logo ? <img key={versao} src={r.tem_cabecalho ? `/api/gestao/imagens/cabecalho?v=${versao}` : `/api/gestao/ficha/logo?v=${versao}`} alt="Cabeçalho dos documentos" className="mx-auto h-14 max-w-full object-contain" /> : <span className="text-xs text-zinc-500">Nenhuma imagem enviada ainda.</span>}<p className="mt-2 text-xs text-zinc-500">A imagem se troca em <Link className="underline" to="/configuracoes/escritorio">Dados do escritório</Link>.</p></div>
                : <CartaoImagem titulo="Imagem própria da ficha" descricao="PNG, JPG ou WebP, até 1 MB." urlBase="/api/gestao/ficha/logo" tem={r.tem_logo} podeEditar={gerir} altura="h-14" aoMudar={() => { setVersao((v) => v + 1); void carregar(); }} />}
              <div className="space-y-1"><p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Posição do logotipo no cabeçalho da ficha</p><BotoesAlinhamento valor={c.logo_alinhamento} aoMudar={(v) => set("logo_alinhamento", v)} desabilitado={!gerir} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={c.mostrar_foto} onChange={(e) => set("mostrar_foto", e.target.checked)} /> Mostrar o quadro da foto 3x4 do cliente</label>
          </fieldset>

          <fieldset disabled={!gerir} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">O que sai na ficha</h2>
            {Object.entries(r.rotulo_secao).map(([k, rot]) => <label key={k} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={c.secoes[k] !== false} onChange={(e) => set("secoes", { ...c.secoes, [k]: e.target.checked })} /> {rot}</label>)}
            <Campo rotulo="Linhas em branco para anotar à mão (0 a 25)"><Input type="number" min={0} max={25} value={c.linhas_observacoes} onChange={(e) => set("linhas_observacoes", Number(e.target.value))} className="mt-1.5 w-28" /></Campo>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm dark:bg-zinc-800/50"><span>Os campos personalizados (senha do GOV, serviço, indicação…) são criados aqui.</span>{gerir && <Button type="button" size="sm" variant="outline" onClick={() => setCampos(true)}>Criar e organizar campos</Button>}</div>
          </fieldset>

          <fieldset disabled={!gerir} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Assinatura e rodapé</h2>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input type="checkbox" checked={c.assinatura} onChange={(e) => set("assinatura", e.target.checked)} /> Incluir campo de assinatura do cliente</label>
            {c.assinatura && <Campo rotulo="Texto acima da assinatura (declaração, aviso de privacidade…)"><Textarea rows={3} value={c.texto_assinatura} onChange={(e) => set("texto_assinatura", e.target.value)} className="mt-1.5" /></Campo>}
            <Campo rotulo="Texto do rodapé"><Input value={c.rodape} onChange={(e) => set("rodape", e.target.value)} className="mt-1.5" /></Campo>
          </fieldset>
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-xs text-zinc-500">Pré-visualização com um cliente de exemplo (atualiza ao salvar).</p>
          <iframe key={versao} title="Pré-visualização da ficha" src={`/api/gestao/ficha/previa?v=${versao}`} className="h-[1100px] w-full rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800" />
        </div>
      </div>
      {campos && <GerenciarCampos entidade="pessoa" aoFechar={() => { setCampos(false); setVersao((v) => v + 1); }} />}
    </div>
  );
}
