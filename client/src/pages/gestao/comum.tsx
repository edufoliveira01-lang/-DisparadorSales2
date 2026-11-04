import { useEffect, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { Input, Label } from "@/components/ui/Input";

export const TIPOS: Record<string, string> = { cliente: "Cliente", parte_contraria: "Parte contrária", testemunha: "Testemunha", perito: "Perito", outro: "Outro" };
export const PAPEIS: Record<string, string> = { autor: "Autor", reu: "Réu", terceiro: "Terceiro interessado", testemunha: "Testemunha", perito: "Perito", advogado_contrario: "Advogado da parte contrária" };
export const STATUS: Record<string, string> = { ativo: "Ativo", suspenso: "Suspenso", arquivado: "Arquivado", encerrado: "Encerrado" };
export const STATUS_TOM: Record<string, "success" | "warning" | "neutral" | "info"> = { ativo: "success", suspenso: "warning", arquivado: "neutral", encerrado: "info" };
export const AREAS: Record<string, string> = { previdenciario: "Previdenciário", civel: "Cível", trabalhista: "Trabalhista", bancario: "Bancário", familia: "Família", consumidor: "Consumidor", tributario: "Tributário", criminal: "Criminal", outra: "Outra" };
export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO"];

export interface PessoaResumo { id: number; nome: string; tipo: string; documento_formatado: string; telefone: string; email: string }
export interface Lista<T> { total: number; pagina: number; limite: number; itens: T[] }

export const campoClasse = "mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return <label className={`block text-xs font-medium text-zinc-600 dark:text-zinc-300 ${className}`}>{rotulo}{children}</label>;
}

export function useAtraso<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

export const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
export const dinheiro = (centavos: number | null | undefined) => (centavos == null ? "—" : (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

/** Busca e escolhe uma pessoa já cadastrada (autocompletar). */
export function SeletorPessoa({ aoEscolher, tipo, rotulo = "Pessoa" }: { aoEscolher: (p: PessoaResumo) => void; tipo?: string; rotulo?: string }) {
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [itens, setItens] = useState<PessoaResumo[]>([]);
  useEffect(() => {
    if (termo.trim().length < 2) { setItens([]); return; }
    let ativo = true;
    api.get<Lista<PessoaResumo>>(`/gestao/pessoas?limite=8&ativo=1&busca=${encodeURIComponent(termo)}${tipo ? `&tipo=${tipo}` : ""}`).then((r) => { if (ativo) setItens(r.itens); }).catch(() => undefined);
    return () => { ativo = false; };
  }, [termo, tipo]);
  return (
    <div className="relative">
      <Label>{rotulo}</Label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input className="pl-9" placeholder="Digite nome, CPF/CNPJ ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {itens.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {itens.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full flex-col px-3.5 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => { aoEscolher(p); setBusca(""); setItens([]); }}>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.nome}</span>
                <span className="text-xs text-zinc-500">{TIPOS[p.tipo] || p.tipo}{p.documento_formatado ? ` · ${p.documento_formatado}` : ""}{p.telefone ? ` · ${p.telefone}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ProcessoResumo { id: number; pasta: string; numero: string; numero_formatado: string; titulo: string }
/** Busca e escolhe um processo já cadastrado (por número, pasta, cliente ou título). */
export function SeletorProcesso({ aoEscolher, rotulo = "Processo" }: { aoEscolher: (p: ProcessoResumo) => void; rotulo?: string }) {
  const [busca, setBusca] = useState("");
  const termo = useAtraso(busca);
  const [itens, setItens] = useState<ProcessoResumo[]>([]);
  useEffect(() => {
    if (termo.trim().length < 2) { setItens([]); return; }
    let ativo = true;
    api.get<Lista<ProcessoResumo>>(`/gestao/processos?limite=8&status=&busca=${encodeURIComponent(termo)}`).then((r) => { if (ativo) setItens(r.itens); }).catch(() => undefined);
    return () => { ativo = false; };
  }, [termo]);
  return (
    <div className="relative">
      <Label>{rotulo}</Label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input className="pl-9" placeholder="Número, pasta ou nome do cliente…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      {itens.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {itens.map((p) => (
            <li key={p.id}><button type="button" className="flex w-full flex-col px-3.5 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800" onClick={() => { aoEscolher(p); setBusca(""); setItens([]); }}>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.pasta} · {p.numero_formatado || p.numero}</span>{p.titulo && <span className="text-xs text-zinc-500">{p.titulo}</span>}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const PRIORIDADES: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
export const PRIORIDADE_TOM: Record<string, "neutral" | "info" | "warning" | "danger"> = { baixa: "neutral", normal: "info", alta: "warning", urgente: "danger" };
export const mesAtual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
export const mesRotulo = (m: string) => { const [a, mm] = m.split("-"); return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mm) - 1]}/${a.slice(2)}`; };
export const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export interface EnderecoCep { cep: string; logradouro: string; complemento: string; bairro: string; cidade: string; uf: string }
export const mascaraCep = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const mascaraCpfCnpj = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d.length <= 11 ? d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
    : d.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};
export const mascaraPis = (v: string) => v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{5})(\d)/, "$1.$2").replace(/(\d{2})(\d)$/, "$1-$2");
export const ESCOLARIDADES = ["Analfabeto", "Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação"];
export const ESTADOS_CIVIS = ["Solteiro(a)", "Casado(a)", "União estável", "Separado(a)", "Divorciado(a)", "Viúvo(a)"];
