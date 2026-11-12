import { useCallback, useEffect, useState } from "react";
import { Building2, ImageIcon, MapPin, Plus, Save, Scale, Trash2, Users } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { useToast } from "@/components/ui/Toast";
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

/** Dados do escritório usados em documentos, ficha e rodapés: nome, logotipo, endereço, advogados e testemunhas. */
export function EscritorioConfig() {
  const { can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [e, setE] = useState<Esc | null>(null);
  const [salvo, setSalvo] = useState("");
  const [img, setImg] = useState({ tem_logo: false, tem_cabecalho: false, tem_rodape: false, tem_favicon: false });
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    try { const r = await api.get<{ escritorio: Esc } & typeof img>("/gestao/escritorio", { fresh: true } as never); setE((atual) => atual ?? r.escritorio); setSalvo((s) => s || JSON.stringify(r.escritorio)); setImg({ tem_logo: r.tem_logo, tem_cabecalho: r.tem_cabecalho, tem_rodape: r.tem_rodape, tem_favicon: r.tem_favicon }); }
    catch { show("Não foi possível carregar os dados do escritório.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  if (!e) return <div className="space-y-4" role="status" aria-label="Carregando"><Skeleton className="h-16 w-full" /><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>;
  const sujo = JSON.stringify(e) !== salvo;
  const set = <K extends keyof Esc>(k: K, v: Esc[K]) => setE((x) => (x ? { ...x, [k]: v } : x));
  const salvar = async () => {
    setSalvando(true);
    try { const r = await api.put<{ escritorio: Esc }>("/gestao/escritorio", e); setE(r.escritorio); setSalvo(JSON.stringify(r.escritorio)); show("Dados do escritório salvos.", "success"); avisarIdentidadeMudou(); }
    catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const adv = (i: number, p: Partial<Advogado>) => set("advogados", e.advogados.map((a, j) => (j === i ? { ...a, ...p } : a)));
  const test = (i: number, p: Partial<Testemunha>) => { const l = [...e.testemunhas]; while (l.length < 2) l.push({ nome: "", cpf: "" }); l[i] = { ...l[i], ...p }; set("testemunhas", l); };
  const tel = e.telefones.join(", ");
  const faltaBasico = !e.nome.trim() || !e.endereco.trim() || e.advogados.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Dados do escritório" description="Usados nos documentos (procuração, contrato…), na ficha de cadastro e nos rodapés."
        actions={gerir ? <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar</Button> : undefined} />
      {!gerir && <Callout tone="info">Você pode ver estes dados, mas só quem gerencia o escritório consegue alterá-los.</Callout>}
      {faltaBasico && <Callout tone="aviso">Faltam dados importantes para os documentos: {[!e.nome.trim() && "nome do escritório", !e.endereco.trim() && "endereço", e.advogados.length === 0 && "pelo menos um advogado"].filter(Boolean).join(", ")}.</Callout>}
      <fieldset disabled={!gerir} className="min-w-0 space-y-5">
        <SettingsPanel icon={<Building2 />} title="Identificação" description="Como o escritório aparece nos documentos."
          status={e.nome.trim() ? <Badge tone="success">Preenchido</Badge> : <Badge tone="warning">Sem nome</Badge>}>
          <SettingsBlock>
            <SettingRow label="Nome do escritório" hint="Aparece no cabeçalho quando não há imagem de cabeçalho." htmlFor="esc-nome"><Input id="esc-nome" value={e.nome} onChange={(x) => set("nome", x.target.value)} placeholder="Silva & Associados Advocacia" /></SettingRow>
            <SettingRow label="Razão social" hint="Nome da sociedade de advogados." htmlFor="esc-razao"><Input id="esc-razao" value={e.razao_social} onChange={(x) => set("razao_social", x.target.value)} /></SettingRow>
            <SettingRow label="OAB e CNPJ" hint="Inscrição da sociedade na OAB e CNPJ.">
              <div className="grid gap-3 sm:grid-cols-3">
                <Input aria-label="Inscrição na OAB (nº)" value={e.oab_sociedade} onChange={(x) => set("oab_sociedade", x.target.value)} placeholder="OAB nº 37.112" />
                <Input aria-label="CNPJ" className="sm:col-span-2" value={e.cnpj} onChange={(x) => set("cnpj", x.target.value)} placeholder="CNPJ" />
              </div>
            </SettingRow>
          </SettingsBlock>
        </SettingsPanel>

        <SettingsPanel icon={<MapPin />} title="Endereço e contato" description="Local da assinatura, foro e dados de contato.">
          <SettingsBlock title="Endereço">
            <SettingRow label="Endereço completo" hint="Rua, nº, sala, bairro, cidade/UF, CEP." htmlFor="esc-end"><Input id="esc-end" value={e.endereco} onChange={(x) => set("endereco", x.target.value)} placeholder="Rua, nº, sala, bairro, cidade/UF, CEP" /></SettingRow>
            <SettingRow label="Cidade e UF" hint="Cidade usada como local da assinatura.">
              <div className="grid grid-cols-[1fr_5rem] gap-3">
                <Input aria-label="Cidade" value={e.cidade} onChange={(x) => set("cidade", x.target.value)} placeholder="Cidade" />
                <Input aria-label="UF" value={e.uf} maxLength={2} onChange={(x) => set("uf", x.target.value.toUpperCase())} placeholder="UF" />
              </div>
            </SettingRow>
            <SettingRow label="Foro do contrato" hint="Se vazio, usa a Comarca da cidade." htmlFor="esc-foro"><Input id="esc-foro" value={e.foro} onChange={(x) => set("foro", x.target.value)} placeholder="Comarca de Praia Grande/SP" /></SettingRow>
          </SettingsBlock>
          <SettingsBlock title="Contato">
            <SettingRow label="Telefones" hint="Separe por vírgula." htmlFor="esc-tel"><Input id="esc-tel" value={tel} onChange={(x) => set("telefones", x.target.value.split(",").map((t) => t.trim()).filter(Boolean))} /></SettingRow>
            <SettingRow label="E-mail" htmlFor="esc-email"><Input id="esc-email" type="email" value={e.email} onChange={(x) => set("email", x.target.value)} /></SettingRow>
            <SettingRow label="Linhas do rodapé" hint="Se vazio, saem o endereço e os telefones.">
              {[0, 1].map((i) => <Input key={i} aria-label={`Linha ${i + 1} do rodapé`} placeholder={`Linha ${i + 1}`} value={e.rodape_linhas[i] ?? ""} onChange={(x) => { const l = [e.rodape_linhas[0] ?? "", e.rodape_linhas[1] ?? ""]; l[i] = x.target.value; set("rodape_linhas", l.filter(Boolean)); }} />)}
            </SettingRow>
          </SettingsBlock>
        </SettingsPanel>

        <SettingsPanel icon={<ImageIcon />} title="Imagens" description="Cada uso tem a sua imagem. As imagens são salvas na hora; os alinhamentos valem depois de Salvar.">
          <SettingsBlock>
            <div className="grid gap-6 lg:grid-cols-3">
              <CartaoImagem titulo="Cabeçalho dos documentos" descricao="Topo de procuração, contrato e declarações. Imagem larga, como papel timbrado." urlBase="/api/gestao/imagens/cabecalho" altura="h-20" tem={img.tem_cabecalho} podeEditar={gerir} aoMudar={() => void carregar()}
                extra={<div className="space-y-1.5"><p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Alinhamento</p><BotoesAlinhamento valor={e.cabecalho_alinhamento} aoMudar={(v) => set("cabecalho_alinhamento", v)} desabilitado={!gerir} />{!img.tem_cabecalho && img.tem_logo && <p className="text-xs text-amber-700 dark:text-amber-300">Sem cabeçalho próprio, os documentos usam o logotipo enviado antes na ficha.</p>}{!img.tem_cabecalho && !img.tem_logo && <p className="text-xs text-zinc-500">Sem imagem, sai o nome do escritório.</p>}</div>} />
              <CartaoImagem titulo="Rodapé dos documentos" descricao="Opcional. Imagem pequena acima das linhas do rodapé, como um selo." urlBase="/api/gestao/imagens/rodape" altura="h-12" tem={img.tem_rodape} podeEditar={gerir} aoMudar={() => void carregar()}
                extra={<div className="space-y-1.5"><p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Alinhamento</p><BotoesAlinhamento valor={e.rodape_alinhamento} aoMudar={(v) => set("rodape_alinhamento", v)} desabilitado={!gerir} /></div>} />
              <CartaoImagem titulo="Ícone do sistema" descricao="Aba do navegador, menu lateral e login. Imagem quadrada (PNG, JPG, WebP ou ICO, até 512 KB)." urlBase="/api/gestao/imagens/favicon" altura="h-16 w-16" tem={img.tem_favicon} podeEditar={gerir} aoMudar={() => { void carregar(); setTimeout(avisarIdentidadeMudou, 150); }} />
            </div>
          </SettingsBlock>
        </SettingsPanel>

        <SettingsPanel icon={<Scale />} title="Advogados" description="O primeiro é o sócio e assina o contrato como contratado. Todos entram como outorgados na procuração."
          status={<Badge tone={e.advogados.length ? "accent" : "neutral"}>{e.advogados.length} cadastrado(s)</Badge>}
          actions={gerir ? <Button type="button" size="sm" variant="outline" onClick={() => set("advogados", [...e.advogados, advVazio()])}><Plus className="h-4 w-4" /> Adicionar</Button> : undefined}>
          {e.advogados.length === 0 && <div className="px-5 py-6"><EmptyState icon={Scale} title="Nenhum advogado cadastrado" description="Cadastre ao menos um para a procuração e o contrato saírem completos." action={gerir ? <Button size="sm" onClick={() => set("advogados", [advVazio()])}><Plus className="h-4 w-4" /> Adicionar advogado</Button> : undefined} /></div>}
          {e.advogados.map((a, i) => (
            <SettingsBlock key={i} title={`${i === 0 ? "Sócio" : `Advogado ${i + 1}`}${a.nome ? `: ${a.nome}` : ""}`}>
              <div className="grid gap-3 sm:grid-cols-6">
                <div className="sm:col-span-1"><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Tratamento</label><Select value={a.tratamento} onChange={(x) => adv(i, { tratamento: x.target.value })}><option>Dr.</option><option>Dra.</option></Select></div>
                <div className="sm:col-span-3"><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Nome completo</label><Input value={a.nome} onChange={(x) => adv(i, { nome: x.target.value })} /></div>
                <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Nacionalidade</label><Input value={a.nacionalidade} onChange={(x) => adv(i, { nacionalidade: x.target.value })} /></div>
                <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Estado civil (opcional)</label><Input value={a.estado_civil} onChange={(x) => adv(i, { estado_civil: x.target.value })} /></div>
                <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">OAB, como deve sair</label><Input value={a.oab} onChange={(x) => adv(i, { oab: x.target.value })} placeholder="OAB/SP nº 346.457" /></div>
                <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">CPF</label><Input value={a.cpf} onChange={(x) => adv(i, { cpf: x.target.value })} /></div>
              </div>
              {gerir && <div className="text-right"><Button type="button" size="sm" variant="ghost" onClick={() => set("advogados", e.advogados.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /> Remover</Button></div>}
            </SettingsBlock>
          ))}
        </SettingsPanel>

        <SettingsPanel icon={<Users />} title="Testemunhas padrão" description="Saem no contrato e nos documentos «a rogo». Dá para trocar na hora de gerar.">
          {[0, 1].map((i) => (
            <SettingsBlock key={i} title={`Testemunha ${i + 1}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Nome</label><Input value={e.testemunhas[i]?.nome ?? ""} onChange={(x) => test(i, { nome: x.target.value })} /></div>
                <div><label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-300">CPF</label><Input value={e.testemunhas[i]?.cpf ?? ""} onChange={(x) => test(i, { cpf: x.target.value })} /></div>
              </div>
            </SettingsBlock>
          ))}
        </SettingsPanel>
      </fieldset>
      {gerir && (
        <div className="sticky bottom-3 z-10 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <SettingsFooter left={sujo ? <span className="font-medium text-amber-700 dark:text-amber-300">Há alterações não salvas.</span> : "Tudo salvo."}>
            <Button loading={salvando} disabled={!sujo} onClick={() => void salvar()}><Save className="h-4 w-4" /> Salvar alterações</Button>
          </SettingsFooter>
        </div>
      )}
    </div>
  );
}
