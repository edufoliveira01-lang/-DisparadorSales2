import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, FolderOpen, UserX, Download, Contact, ArrowRight } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

interface Resumo { pessoas: number; clientes: number; processos_ativos: number; processos_total: number; sem_responsavel: number; pendentes_importacao: number; contatos_sem_cadastro: number }

export function GestaoInicio() {
  const { can } = useAuth();
  const { show } = useToast();
  const [r, setR] = useState<Resumo | null>(null);
  const [ocupado, setOcupado] = useState("");
  const carregar = useCallback(() => api.get<Resumo>("/gestao/resumo").then(setR).catch(() => show("Não foi possível carregar o resumo.", "error")), [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const executar = async (chave: string, caminho: string, ok: (x: any) => string) => {
    setOcupado(chave);
    try { const x = await api.post<any>(caminho, {}); show(ok(x), "success"); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); }
    finally { setOcupado(""); }
  };
  const gerir = can("gestao.manage");
  return (
    <div className="space-y-6">
      <PageHeader title="Gestão do escritório" description="Pessoas, processos e pastas em um só lugar. As telas de perícias e do DJEN continuam como sempre." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Users className="h-5 w-5" />} label="Clientes" value={r?.clientes ?? "…"} tone="accent" helper={r ? `${r.pessoas} pessoas cadastradas` : undefined} />
        <StatCard icon={<FolderOpen className="h-5 w-5" />} label="Processos ativos" value={r?.processos_ativos ?? "…"} tone="info" helper={r ? `${r.processos_total} no total` : undefined} />
        <StatCard icon={<UserX className="h-5 w-5" />} label="Sem responsável" value={r?.sem_responsavel ?? "…"} tone={r && r.sem_responsavel > 0 ? "warning" : "neutral"} helper="Processos ativos sem advogado" />
        <StatCard icon={<Contact className="h-5 w-5" />} label="Contatos antigos" value={r?.contatos_sem_cadastro ?? "…"} tone="neutral" helper="Ainda sem cadastro completo" />
      </div>

      {gerir && r && r.pendentes_importacao > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-200 bg-accent-50/60 p-4 dark:border-accent-900 dark:bg-accent-950/30">
          <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.pendentes_importacao} processo(s) acompanhados no DJEN ainda não têm ficha</p><p className="text-sm text-zinc-600 dark:text-zinc-300">Crie as fichas de uma vez: o número, o tribunal, a classe e o cliente já vêm preenchidos.</p></div>
          <Button loading={ocupado === "djen"} onClick={() => executar("djen", "/gestao/processos/importar-djen", (x) => `${x.criados} ficha(s) criada(s).`)}><Download className="h-4 w-4" /> Criar fichas</Button>
        </div>
      )}
      {gerir && r && r.contatos_sem_cadastro > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.contatos_sem_cadastro} contato(s) da agenda podem virar cadastro completo</p><p className="text-sm text-zinc-600 dark:text-zinc-300">Os contatos continuam na agenda e nos avisos; o cadastro novo só acrescenta CPF, endereço e processos.</p></div>
          <Button variant="outline" loading={ocupado === "contatos"} onClick={() => executar("contatos", "/gestao/pessoas/importar-contatos", (x) => `${x.criadas} cadastro(s) criado(s).`)}>Importar contatos</Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Atalho para="/gestao/pessoas" titulo="Pessoas" texto="Clientes, partes contrárias, testemunhas e peritos, com CPF/CNPJ, contatos e endereço." />
        <Atalho para="/gestao/processos" titulo="Processos e pastas" texto="Cada processo com pasta, partes, responsável, histórico do DJEN e anotações." />
      </div>
    </div>
  );
}

function Atalho({ para, titulo, texto }: { para: string; titulo: string; texto: string }) {
  return (
    <Link to={para} className="group flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-accent-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div><h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{titulo}</h3><p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{texto}</p></div>
      <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-accent-600" />
    </Link>
  );
}
