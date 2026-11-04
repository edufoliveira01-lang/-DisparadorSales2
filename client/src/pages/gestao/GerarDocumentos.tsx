import { useEffect, useState } from "react";
import { Download, FileText, Printer, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Campo } from "./comum";

type Variante = "comum" | "rogo" | "representado";
interface Cfg { documentos: { id: string; nome: string }[]; honorarios: { beneficios: number; percentual: number; parcela: number }; escritorio_completo: boolean }
interface Qual { nome: string; nacionalidade: string; estado_civil: string; rg: string; cpf: string; endereco: string; qualidade: string }
const qualVazia = (): Qual => ({ nome: "", nacionalidade: "brasileiro(a)", estado_civil: "", rg: "", cpf: "", endereco: "", qualidade: "" });
const TIPOS: { id: Variante; nome: string; texto: string }[] = [
  { id: "comum", nome: "Comum", texto: "O próprio cliente assina." },
  { id: "rogo", nome: "A rogo", texto: "Quem não consegue assinar: outra pessoa assina a rogo, com duas testemunhas e a digital do polegar." },
  { id: "representado", nome: "Neste ato representado por…", texto: "Menor, incapaz ou quem tem representante: o representante legal assina." },
];

/** Escolhe o tipo (comum, a rogo, representado), os documentos e gera para imprimir ou editar no Word. */
export function GerarDocumentos({ aberto, aoFechar, pessoa, processo }: { aberto: boolean; aoFechar: () => void; pessoa?: { id: number; nome: string }; processo?: { id: number; rotulo: string } }) {
  const { show } = useToast();
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [variante, setVariante] = useState<Variante>("comum");
  const [docs, setDocs] = useState<string[]>([]);
  const [data, setData] = useState<"hoje" | "branco">("hoje");
  const [hon, setHon] = useState({ beneficios: "", percentual: "", parcela: "" });
  const [rep, setRep] = useState<Qual>({ ...qualVazia(), qualidade: "genitora" });
  const [rogo, setRogo] = useState<Qual>(qualVazia());
  const [test, setTest] = useState([{ nome: "", cpf: "" }, { nome: "", cpf: "" }]);
  const [gerando, setGerando] = useState(false);
  useEffect(() => {
    if (!aberto) return;
    api.get<Cfg>("/gestao/documentos/config", { fresh: true } as never).then((c) => { setCfg(c); setDocs((d) => (d.length ? d : c.documentos.map((x) => x.id))); }).catch(() => show("Não foi possível carregar os modelos de documento.", "error"));
  }, [aberto, show]);

  const gerar = async (acao: "ver" | "imprimir" | "docx") => {
    if (docs.length === 0) return show("Marque ao menos um documento.", "info");
    setGerando(true);
    try {
      const r = await api.post<{ token: string; faltando: string[] }>("/gestao/documentos/preparar", {
        pessoa_id: pessoa?.id, processo_id: processo?.id, variante, documentos: docs, data,
        honorarios: { beneficios: hon.beneficios, percentual: hon.percentual, parcela: hon.parcela }, representante: rep, a_rogo: rogo, testemunhas_rogo: test,
      });
      const url = `/api/gestao/documentos/kit/${r.token}`;
      if (acao === "docx") window.open(`${url}?formato=docx`, "_self");
      else window.open(`${url}${acao === "imprimir" ? "?imprimir=1" : ""}`, "_blank", "noopener");
      if (r.faltando.length) show(`Alguns dados não estavam cadastrados e saíram em branco: ${r.faltando.map((f) => f.split(".").pop()).join(", ")}.`, "info");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível gerar os documentos.", "error"); }
    finally { setGerando(false); }
  };
  const alvo = pessoa?.nome ?? processo?.rotulo ?? "";
  const q = (v: Qual, set: (q: Qual) => void, titulo: string, mostrarQualidade: boolean) => (
    <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{titulo}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome completo" className="sm:col-span-2"><Input value={v.nome} onChange={(e) => set({ ...v, nome: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Nacionalidade"><Input value={v.nacionalidade} onChange={(e) => set({ ...v, nacionalidade: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Estado civil"><Input value={v.estado_civil} onChange={(e) => set({ ...v, estado_civil: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="RG"><Input value={v.rg} onChange={(e) => set({ ...v, rg: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="CPF"><Input value={v.cpf} onChange={(e) => set({ ...v, cpf: e.target.value })} className="mt-1.5" /></Campo>
        <Campo rotulo="Endereço completo" className="sm:col-span-2"><Input value={v.endereco} onChange={(e) => set({ ...v, endereco: e.target.value })} className="mt-1.5" placeholder="Rua, número, bairro, cidade/UF, CEP" /></Campo>
        {mostrarQualidade && <Campo rotulo="Qualidade (genitora, genitor, curador, tutor…)"><Input value={v.qualidade} onChange={(e) => set({ ...v, qualidade: e.target.value })} className="mt-1.5" /></Campo>}
      </div>
    </div>
  );
  return (
    <Modal open={aberto} onClose={aoFechar} title="Gerar documentos do escritório" description={`Para ${alvo}. Sai com o nome, o logotipo e o rodapé do escritório.`} maxWidth="max-w-2xl"
      footer={<div className="flex w-full flex-wrap justify-end gap-2"><Button variant="outline" onClick={aoFechar}>Fechar</Button><Button variant="outline" loading={gerando} onClick={() => void gerar("docx")}><Download className="h-4 w-4" /> Baixar em Word</Button><Button variant="outline" loading={gerando} onClick={() => void gerar("ver")}><Eye className="h-4 w-4" /> Visualizar</Button><Button loading={gerando} onClick={() => void gerar("imprimir")}><Printer className="h-4 w-4" /> Imprimir</Button></div>}>
      <div className="space-y-5 text-sm">
        {cfg && !cfg.escritorio_completo && <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Os dados do escritório (nome, advogados, endereço) ainda não foram preenchidos. <Link className="underline" to="/configuracoes/escritorio" onClick={aoFechar}>Preencher agora</Link></p>}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Tipo</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIPOS.map((t) => (
              <button key={t.id} type="button" onClick={() => setVariante(t.id)} aria-pressed={variante === t.id} className={`rounded-xl border p-3 text-left transition ${variante === t.id ? "border-accent-500 bg-accent-500/10" : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700"}`}>
                <span className="block font-semibold text-zinc-900 dark:text-zinc-100">{t.nome}</span><span className="mt-1 block text-xs text-zinc-500">{t.texto}</span>
              </button>
            ))}
          </div>
        </fieldset>
        {variante === "representado" && q(rep, setRep, "Quem representa o cliente", true)}
        {variante === "rogo" && <>
          {q(rogo, setRogo, "Quem assina a rogo (pessoa de confiança)", false)}
          <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Testemunhas a rogo <span className="font-normal text-zinc-500">(se vazio, usa as testemunhas padrão do escritório)</span></p>
            <div className="grid gap-3 sm:grid-cols-2">{test.map((t, i) => (<div key={i} className="space-y-2"><Campo rotulo={`Testemunha ${i + 1} — nome`}><Input value={t.nome} onChange={(e) => setTest((l) => l.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} className="mt-1.5" /></Campo><Campo rotulo="CPF"><Input value={t.cpf} onChange={(e) => setTest((l) => l.map((x, j) => (j === i ? { ...x, cpf: e.target.value } : x)))} className="mt-1.5" /></Campo></div>))}</div>
          </div>
        </>}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Documentos</legend>
          <div className="grid gap-2 sm:grid-cols-2">{cfg?.documentos.map((d) => <label key={d.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"><input type="checkbox" checked={docs.includes(d.id)} onChange={(e) => setDocs((l) => (e.target.checked ? [...l, d.id] : l.filter((x) => x !== d.id)))} /><FileText className="h-4 w-4 text-zinc-400" /> {d.nome}</label>)}</div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data nos documentos">
            <select className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={data} onChange={(e) => setData(e.target.value as "hoje" | "branco")}><option value="hoje">Data de hoje</option><option value="branco">Em branco, para preencher à mão</option></select>
          </Campo>
          {docs.includes("contrato") || docs.includes("declaracao_honorarios") ? (
            <div className="grid grid-cols-3 gap-2">
              <Campo rotulo="Nº de benefícios"><Input inputMode="decimal" value={hon.beneficios} onChange={(e) => setHon({ ...hon, beneficios: e.target.value })} placeholder={String(cfg?.honorarios.beneficios ?? 3)} className="mt-1.5" /></Campo>
              <Campo rotulo="% parcelas"><Input inputMode="decimal" value={hon.percentual} onChange={(e) => setHon({ ...hon, percentual: e.target.value })} placeholder={String(cfg?.honorarios.percentual ?? 30)} className="mt-1.5" /></Campo>
              <Campo rotulo="% mensal"><Input inputMode="decimal" value={hon.parcela} onChange={(e) => setHon({ ...hon, parcela: e.target.value })} placeholder={String(cfg?.honorarios.parcela ?? 30)} className="mt-1.5" /></Campo>
            </div>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">Os textos e o visual ficam em <Link className="underline" to="/configuracoes/documentos" onClick={aoFechar}>Configurações → Documentos do escritório</Link>.</p>
      </div>
    </Modal>
  );
}
