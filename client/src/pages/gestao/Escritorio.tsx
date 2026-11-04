import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { Campo } from "./comum";
import { BotoesAlinhamento, CartaoImagem, type Alinha } from "./ImagemUpload";
import { avisarIdentidadeMudou } from "@/context/IdentidadeContext";

interface Advogado { tratamento: string; nome: string; nacionalidade: string; estado_civil: string; oab: string; cpf: string }
interface Testemunha { nome: string; cpf: string }
interface Esc {
  nome: string; razao_social: string; oab_sociedade: string; cnpj: string; endereco: string; cidade: string; uf: string; foro: string;
  telefones: string[]; email: string; rodape_linhas: string[]; advogados: Advogado[]; testemunhas: Testemunha[];
  cabecalho_alinhamento: Alinha; rodape_alinhamento: Alinha;
}
const advVazio = (): Advogado => ({ tratamento: "Dr.", nome: "", nacionalidade: "brasileiro(a)", estado_civil: "", oab: "", cpf: "" });
const cartao = "space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900";

/** Dados do escritório usados em documentos, ficha e rodapés: nome, logotipo, endereço, advogados e testemunhas. */
export function EscritorioConfig() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [e, setE] = useState<Esc | null>(null);
  const [img, setImg] = useState({ tem_logo: false, tem_cabecalho: false, tem_rodape: false, tem_favicon: false });
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    try { const r = await api.get<{ escritorio: Esc } & typeof img>("/gestao/escritorio", { fresh: true } as never); setE(r.escritorio); setImg({ tem_logo: r.tem_logo, tem_cabecalho: r.tem_cabecalho, tem_rodape: r.tem_rodape, tem_favicon: r.tem_favicon }); }
    catch { show("Não foi possível carregar os dados do escritório.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!e) return <p className="text-sm text-zinc-500" role="status">Carregando…</p>;
  const set = <K extends keyof Esc>(k: K, v: Esc[K]) => setE((x) => (x ? { ...x, [k]: v } : x));
  const salvar = async () => {
    setSalvando(true);
    try { const r = await api.put<{ escritorio: Esc }>("/gestao/escritorio", e); setE(r.escritorio); show("Dados do escritório salvos.", "success"); avisarIdentidadeMudou(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const adv = (i: number, p: Partial<Advogado>) => set("advogados", e.advogados.map((a, j) => (j === i ? { ...a, ...p } : a)));
  const test = (i: number, p: Partial<Testemunha>) => { const l = [...e.testemunhas]; while (l.length < 2) l.push({ nome: "", cpf: "" }); l[i] = { ...l[i], ...p }; set("testemunhas", l); };
  const tel = e.telefones.join(", ");

  return (
    <div className="space-y-5">
      <PageHeader title="Dados do escritório" description="Usados nos documentos (procuração, contrato…), na ficha de cadastro e nos rodapés. Cada escritório preenche os seus."
        actions={gerir ? <Button loading={salvando} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar</Button> : undefined} />
      <fieldset disabled={!gerir} className="grid gap-5 xl:grid-cols-2">
        <div className={cartao}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Identificação</h2>
          <Campo rotulo="Nome do escritório (aparece no cabeçalho se não houver logotipo)"><Input value={e.nome} onChange={(x) => set("nome", x.target.value)} className="mt-1.5" placeholder="Silva & Associados Advocacia" /></Campo>
          <Campo rotulo="Razão social da sociedade de advogados"><Input value={e.razao_social} onChange={(x) => set("razao_social", x.target.value)} className="mt-1.5" /></Campo>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Inscrição na OAB (nº)"><Input value={e.oab_sociedade} onChange={(x) => set("oab_sociedade", x.target.value)} className="mt-1.5" placeholder="37.112" /></Campo>
            <Campo rotulo="CNPJ" className="sm:col-span-2"><Input value={e.cnpj} onChange={(x) => set("cnpj", x.target.value)} className="mt-1.5" /></Campo>
          </div>
        </div>
        <div className={cartao}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Endereço, contato e foro</h2>
          <Campo rotulo="Endereço completo do escritório"><Input value={e.endereco} onChange={(x) => set("endereco", x.target.value)} className="mt-1.5" placeholder="Rua, nº, sala, bairro, cidade/UF, CEP" /></Campo>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Cidade (local da assinatura)" className="sm:col-span-2"><Input value={e.cidade} onChange={(x) => set("cidade", x.target.value)} className="mt-1.5" /></Campo>
            <Campo rotulo="UF"><Input value={e.uf} maxLength={2} onChange={(x) => set("uf", x.target.value.toUpperCase())} className="mt-1.5" /></Campo>
          </div>
          <Campo rotulo="Foro eleito no contrato (se vazio: Comarca da cidade)"><Input value={e.foro} onChange={(x) => set("foro", x.target.value)} className="mt-1.5" placeholder="Comarca de Praia Grande/SP" /></Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Telefones (separe por vírgula)"><Input value={tel} onChange={(x) => set("telefones", x.target.value.split(",").map((t) => t.trim()).filter(Boolean))} className="mt-1.5" /></Campo>
            <Campo rotulo="E-mail"><Input value={e.email} onChange={(x) => set("email", x.target.value)} className="mt-1.5" /></Campo>
          </div>
          <Campo rotulo="Linhas do rodapé dos documentos (vazio: endereço e telefones)">
            <div className="mt-1.5 space-y-2">{[0, 1].map((i) => <Input key={i} value={e.rodape_linhas[i] ?? ""} onChange={(x) => { const l = [e.rodape_linhas[0] ?? "", e.rodape_linhas[1] ?? ""]; l[i] = x.target.value; set("rodape_linhas", l.filter(Boolean)); }} />)}</div>
          </Campo>
        </div>
        <div className={`${cartao} xl:col-span-2`}>
          <div><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Imagens do escritório</h2><p className="mt-1 text-[13px] text-zinc-500">Cada uso tem a sua imagem: o cabeçalho e o rodapé dos documentos, o logotipo da ficha de cadastro (em Ficha de cadastro) e o ícone do sistema.</p></div>
          <div className="grid gap-6 lg:grid-cols-3">
            <CartaoImagem titulo="Cabeçalho dos documentos" descricao="Fica no topo de procuração, contrato e declarações. Uma imagem larga (como o papel timbrado) funciona melhor." urlBase="/api/gestao/imagens/cabecalho" altura="h-20" tem={img.tem_cabecalho} podeEditar={gerir} aoMudar={() => void carregar()}
              extra={<div className="space-y-1"><p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Alinhamento do cabeçalho</p><BotoesAlinhamento valor={e.cabecalho_alinhamento} aoMudar={(v) => set("cabecalho_alinhamento", v)} desabilitado={!gerir} />{!img.tem_cabecalho && img.tem_logo && <p className="text-xs text-amber-700 dark:text-amber-300">Sem cabeçalho próprio, os documentos usam o logotipo enviado antes na ficha.</p>}{!img.tem_cabecalho && !img.tem_logo && <p className="text-[13px] text-zinc-500">Sem imagem, sai o nome do escritório.</p>}</div>} />
            <CartaoImagem titulo="Rodapé dos documentos (opcional)" descricao="Imagem pequena acima das linhas do rodapé (por exemplo, um selo ou o logotipo reduzido). As linhas de texto ficam em Endereço, contato e foro." urlBase="/api/gestao/imagens/rodape" altura="h-12" tem={img.tem_rodape} podeEditar={gerir} aoMudar={() => void carregar()}
              extra={<div className="space-y-1"><p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Alinhamento do rodapé</p><BotoesAlinhamento valor={e.rodape_alinhamento} aoMudar={(v) => set("rodape_alinhamento", v)} desabilitado={!gerir} /></div>} />
            <CartaoImagem titulo="Ícone do sistema (favicon)" descricao="Aparece na aba do navegador, no menu lateral e na tela de login. Use uma imagem quadrada (PNG, JPG, WebP ou ICO, até 512 KB)." urlBase="/api/gestao/imagens/favicon" altura="h-16 w-16" tem={img.tem_favicon} podeEditar={gerir} aoMudar={() => { void carregar(); setTimeout(avisarIdentidadeMudou, 150); }} />
          </div>
          {gerir && <p className="text-[13px] text-zinc-500">Os alinhamentos valem depois de clicar em <b>Salvar</b>. As imagens são salvas na hora.</p>}
        </div>
        <div className={`${cartao} xl:col-span-2`}>
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Advogados (outorgados e contratados)</h2>{gerir && <Button type="button" size="sm" variant="outline" onClick={() => set("advogados", [...e.advogados, advVazio()])}><Plus className="h-4 w-4" /> Adicionar</Button>}</div>
          <p className="text-[13px] text-zinc-500">O primeiro é o sócio (assina o contrato como contratado). Todos entram como outorgados na procuração.</p>
          {e.advogados.length === 0 && <p className="text-sm text-zinc-500">Nenhum advogado cadastrado.</p>}
          {e.advogados.map((a, i) => (
            <div key={i} className="grid gap-3 rounded-xl border border-zinc-200 p-3 sm:grid-cols-6 dark:border-zinc-700">
              <Campo rotulo="Tratamento"><select className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={a.tratamento} onChange={(x) => adv(i, { tratamento: x.target.value })}><option>Dr.</option><option>Dra.</option></select></Campo>
              <Campo rotulo="Nome completo" className="sm:col-span-3"><Input value={a.nome} onChange={(x) => adv(i, { nome: x.target.value })} className="mt-1.5" /></Campo>
              <Campo rotulo="Nacionalidade" className="sm:col-span-2"><Input value={a.nacionalidade} onChange={(x) => adv(i, { nacionalidade: x.target.value })} className="mt-1.5" /></Campo>
              <Campo rotulo="Estado civil (opcional)" className="sm:col-span-2"><Input value={a.estado_civil} onChange={(x) => adv(i, { estado_civil: x.target.value })} className="mt-1.5" /></Campo>
              <Campo rotulo="OAB (como deve sair)" className="sm:col-span-2"><Input value={a.oab} onChange={(x) => adv(i, { oab: x.target.value })} className="mt-1.5" placeholder="OAB/SP nº 346.457" /></Campo>
              <Campo rotulo="CPF" className="sm:col-span-2"><Input value={a.cpf} onChange={(x) => adv(i, { cpf: x.target.value })} className="mt-1.5" /></Campo>
              {gerir && <div className="sm:col-span-6 text-right"><Button type="button" size="sm" variant="ghost" onClick={() => set("advogados", e.advogados.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /> Remover</Button></div>}
            </div>
          ))}
        </div>
        <div className={`${cartao} xl:col-span-2`}>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Testemunhas padrão</h2>
          <p className="text-[13px] text-zinc-500">Saem no contrato e nos documentos “a rogo”. Dá para trocar na hora de gerar.</p>
          <div className="grid gap-3 sm:grid-cols-2">{[0, 1].map((i) => (
            <div key={i} className="grid gap-3 sm:grid-cols-2"><Campo rotulo={`Testemunha ${i + 1} — nome`}><Input value={e.testemunhas[i]?.nome ?? ""} onChange={(x) => test(i, { nome: x.target.value })} className="mt-1.5" /></Campo><Campo rotulo="CPF"><Input value={e.testemunhas[i]?.cpf ?? ""} onChange={(x) => test(i, { cpf: x.target.value })} className="mt-1.5" /></Campo></div>
          ))}</div>
        </div>
      </fieldset>
    </div>
  );
}
