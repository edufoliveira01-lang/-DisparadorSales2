import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, MoreHorizontal, Plus, Upload } from "lucide-react";
import { ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import { api } from "@/lib/api";
import { useRef } from "react";
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
  const [recarregar, setRecarregar] = useState(0);
  const [importando, setImportando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const { show } = useToast();
  const importar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setImportando(true);
    try {
      const r = await api.post<{ total: number; criados: number; ignorados: number }>("/gestao/pessoas/importar-arquivo", { content: await f.text() });
      show(`${r.criados} cliente(s) criado(s)${r.ignorados ? ` · ${r.ignorados} já existia(m) ou sem telefone` : ""}.`, "success"); setRecarregar((n) => n + 1);
    } catch (err) { show(err instanceof ApiError ? err.message : "Não foi possível importar o arquivo.", "error"); }
    finally { setImportando(false); }
  };
  useEffect(() => { api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, []);
  const Aba = ({ to, ativa, children }: { to: string; ativa: boolean; children: ReactNode }) => <Link to={to} role="tab" aria-selected={ativa} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${ativa ? "bg-white text-accent-700 shadow-sm dark:bg-zinc-800 dark:text-accent-300" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{children}</Link>;
  return (
    <div className="space-y-5">
      <PageHeader title="Clientes e processos" description="A lista única de pessoas: cada cliente com telefone, processos, financeiro, documentos e prazos. Os avisos do WhatsApp usam estes cadastros."
        actions={gerir ? <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => (aba === "processos" ? setSinal((s) => s + 1) : setNovoProcesso(true))}><Plus className="h-4 w-4" /> Novo processo</Button><Button onClick={() => navegar("/gestao/clientes/novo")}><Plus className="h-4 w-4" /> Novo cadastro</Button>
          <input ref={arquivo} type="file" accept=".csv,.vcf,text/csv,text/vcard" className="hidden" onChange={(e) => void importar(e)} />
          <MenuSuspenso gatilho={({ aberto, alternar }) => <Button variant="outline" aria-label="Mais ações" aria-expanded={aberto} loading={importando} onClick={alternar}><MoreHorizontal className="h-4 w-4" /></Button>}>
            {(fechar) => <>
              <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); arquivo.current?.click(); }}><Upload className="h-4 w-4" /> Importar contatos (CSV ou vCard)</button>
              <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); window.open("/api/contacts/export", "_blank"); }}><Download className="h-4 w-4" /> Exportar contatos (CSV)</button>
            </>}
          </MenuSuspenso></div> : undefined} />
      <div role="tablist" className="inline-flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-900"><Aba to="/gestao/clientes" ativa={aba === "clientes"}>Por cliente</Aba><Aba to="/gestao/processos" ativa={aba === "processos"}>Por processo</Aba></div>
      {aba === "clientes" ? <Clientes recarregar={recarregar} /> : <Processos semCabecalho sinalNovo={sinal} />}
      {novoProcesso && <NovoProcesso responsaveis={resp} aoFechar={() => setNovoProcesso(false)} aoCriar={(id) => { setNovoProcesso(false); navegar(`/gestao/processos/${id}`); }} />}
    </div>
  );
}
