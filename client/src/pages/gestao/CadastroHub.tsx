import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Clientes } from "./Clientes";
import { NovoProcesso, Processos, type Responsavel } from "./Processos";

/** Um só lugar para clientes e processos: duas visões do mesmo cadastro, com a mesma busca e as mesmas ações. */
export function CadastroHub({ aba }: { aba: "clientes" | "processos" }) {
  const { can } = useAuth();
  const navegar = useNavigate();
  const gerir = can("gestao.manage");
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [novoProcesso, setNovoProcesso] = useState(false);
  const [sinal, setSinal] = useState(0);
  useEffect(() => { api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, []);
  const Aba = ({ to, ativa, children }: { to: string; ativa: boolean; children: ReactNode }) => <Link to={to} role="tab" aria-selected={ativa} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${ativa ? "bg-white text-accent-700 shadow-sm dark:bg-zinc-800 dark:text-accent-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{children}</Link>;
  return (
    <div className="space-y-5">
      <PageHeader title="Clientes e processos" description="Cada cliente com seus processos, financeiro, documentos e prazos. Encontre por nome, CPF ou número do processo."
        actions={gerir ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => (aba === "processos" ? setSinal((s) => s + 1) : setNovoProcesso(true))}><Plus className="h-4 w-4" /> Novo processo</Button><Button onClick={() => navegar("/gestao/clientes/novo")}><Plus className="h-4 w-4" /> Novo cadastro</Button></div> : undefined} />
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"><Aba to="/gestao/clientes" ativa={aba === "clientes"}>Por cliente</Aba><Aba to="/gestao/processos" ativa={aba === "processos"}>Por processo</Aba></div>
      {aba === "clientes" ? <Clientes /> : <Processos semCabecalho sinalNovo={sinal} />}
      {novoProcesso && <NovoProcesso responsaveis={resp} aoFechar={() => setNovoProcesso(false)} aoCriar={(id) => { setNovoProcesso(false); navegar(`/gestao/processos/${id}`); }} />}
    </div>
  );
}
