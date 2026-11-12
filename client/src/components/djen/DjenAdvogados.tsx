import { BriefcaseBusiness, MoreHorizontal, Pencil, PauseCircle, PlayCircle, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout, SettingsPanel } from "@/components/ui/Settings";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { MenuSuspenso } from "@/components/MenuSuspenso";
import type { Advogado } from "@/pages/Acompanhamento";

const dia = (s: string) => s.slice(0, 10).split("-").reverse().join("/");
const modoTexto = { ambos: "OAB e nome", oab: "Somente OAB", nome: "Somente nome · conferir OAB" } as const;

/** Lista de advogados acompanhados no DJEN: uma linha compacta por advogado, ações no menu «⋯». */
export function AdvogadosAcompanhados({ advogados, carregando, ocupado, onAdicionar, onEditar, onAlternarAtivo, onConsultar }: {
  advogados: Advogado[] | undefined;
  carregando: boolean;
  ocupado: boolean;
  onAdicionar: () => void;
  onEditar: (advogado: Advogado) => void;
  onAlternarAtivo: (advogado: Advogado) => void;
  onConsultar: (advogado: Advogado) => void;
}) {
  const lista = advogados || [];
  const ativos = lista.filter((a) => a.ativo).length;
  const comErro = lista.filter((a) => a.ativo && a.ultimo_erro).length;
  const situacao = carregando ? null : !lista.length ? <Badge tone="neutral">Nenhum cadastrado</Badge>
    : comErro ? <Badge tone="danger">{comErro} com erro na última consulta</Badge>
    : ativos ? <Badge tone="success">{ativos} ativo(s) nas consultas</Badge>
    : <Badge tone="warning">Todos pausados</Badge>;
  return (
    <SettingsPanel
      className="overflow-visible"
      icon={<BriefcaseBusiness />}
      title="Advogados no DJEN"
      description="Cada advogado ativo é consultado pelo número da OAB e/ou pelo nome."
      status={situacao}
      actions={lista.length > 0 ? <Button size="sm" onClick={onAdicionar}><Plus className="h-4 w-4" />Adicionar advogado</Button> : undefined}
    >
      {carregando ? (
        <div className="space-y-3 px-5 py-5"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      ) : !lista.length ? (
        <div className="px-5 py-6">
          <EmptyState icon={BriefcaseBusiness} title="Nenhum advogado cadastrado" description="Informe nome, número da OAB e UF para começar a captar as publicações do escritório."
            action={<Button onClick={onAdicionar}><Plus className="h-4 w-4" />Adicionar advogado</Button>} />
        </div>
      ) : (
        <>
          {!ativos && <div className="px-5 py-4"><Callout tone="aviso">Nenhum advogado está ativo, então nenhuma publicação nova será captada.</Callout></div>}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {lista.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-4">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${a.ativo ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`} aria-hidden="true">
                  {a.nome.trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{a.nome}</p>
                    <Badge tone={a.ativo ? "success" : "neutral"}>{a.ativo ? "Ativo" : "Pausado"}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                    OAB {a.uf_oab} {a.numero_oab} · {modoTexto[a.modo_busca]} · Última captura: {a.ultimo_sucesso_em ? dia(a.ultimo_sucesso_em) : "ainda não realizada"}
                  </p>
                  {a.ultimo_erro && <p className="mt-1.5 break-words text-xs text-red-700 dark:text-red-300">Erro: {a.ultimo_erro}</p>}
                </div>
                <MenuSuspenso gatilho={({ aberto, alternar }) => (
                  <button type="button" aria-label={`Mais ações para ${a.nome}`} aria-haspopup="menu" aria-expanded={aberto} onClick={alternar}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><MoreHorizontal className="h-4 w-4" /></button>
                )}>
                  {(fechar) => (
                    <>
                      <button type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); onEditar(a); }}><Pencil className="h-4 w-4 text-zinc-500" />Editar dados</button>
                      <button type="button" role="menuitem" className="menu-pop-item" disabled={!a.ativo} onClick={() => { fechar(); onConsultar(a); }}><Search className="h-4 w-4 text-zinc-500" />Consultar agora</button>
                      <button type="button" role="menuitem" className="menu-pop-item" disabled={ocupado} onClick={() => { fechar(); onAlternarAtivo(a); }}>
                        {a.ativo ? <PauseCircle className="h-4 w-4 text-zinc-500" /> : <PlayCircle className="h-4 w-4 text-zinc-500" />}{a.ativo ? "Pausar consultas" : "Reativar consultas"}
                      </button>
                    </>
                  )}
                </MenuSuspenso>
              </li>
            ))}
          </ul>
        </>
      )}
    </SettingsPanel>
  );
}
