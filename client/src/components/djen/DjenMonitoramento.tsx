import { useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Activity, ChevronDown, Search, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { instanteBR } from "@/components/djen/HistoryCoverage";
import { IATeaching } from "@/components/djen/IATeaching";
import type { Status } from "@/pages/Acompanhamento";

type Config = {
  automatico: boolean; intervalo_minutos: number; janela_inicial_dias: number; ia_ativa: boolean;
  ia_paralelismo: number; ia_modo: "economico" | "equilibrado" | "precisao"; aguardo_dias: number;
};

const dia = (s: string) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "Não informado");
const ROTULO_BUSCA: Record<string, string> = { concluida: "Concluída", executando: "Em andamento", falha: "Falha", parcial: "Parcial · precisa completar", interrompida: "Interrompida" };
const errosDaBusca = (json: string) => {
  try { return JSON.parse(json || "[]") as { advogado: string; erro: string }[]; } catch { return []; }
};

function Indicador({ titulo, valor, detalhe, tom }: { titulo: string; valor: string; detalhe?: string; tom?: "erro" | "ok" }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{titulo}</p>
      <p className={`mt-1 truncate text-base font-semibold ${tom === "erro" ? "text-red-700 dark:text-red-300" : "text-zinc-900 dark:text-zinc-100"}`}>{valor}</p>
      {detalhe && <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">{detalhe}</p>}
    </div>
  );
}

/** Tela «Monitoramento DJEN»: situação, busca automática, IA e histórico das consultas. */
export function MonitoramentoDjen({ status, config, setConfig, salvando, acao, atualizarStatus, mostrar, administrador, onConsultar }: {
  status: Status | null;
  config: Config;
  setConfig: Dispatch<SetStateAction<Config>>;
  salvando: boolean;
  acao: (fn: () => Promise<void>) => Promise<void>;
  atualizarStatus: () => Promise<unknown>;
  mostrar: (mensagem: string, tipo?: "success" | "error") => void;
  administrador: boolean;
  onConsultar: () => void;
}) {
  const [conexaoIA, setConexaoIA] = useState<{ conectado: boolean; mensagem: string } | null>(null);
  const [confirmarReanalise, setConfirmarReanalise] = useState(false);

  if (!status) {
    return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-72" /></div>;
  }
  const ultima = status.ultimas[0];
  const errosUltima = ultima ? errosDaBusca(ultima.erros_json) : [];
  const advogadosComErro = status.advogados.filter((a) => a.ativo && a.ultimo_erro).length;
  const totalErros = errosUltima.length || advogadosComErro;
  const emExecucao = Boolean(status.executando);
  const situacao = emExecucao ? <Badge tone="info">Consultando agora…</Badge>
    : totalErros ? <Badge tone="danger">{totalErros} erro(s) na última consulta</Badge>
    : status.config.automatico ? <Badge tone="success">Automático ligado</Badge>
    : <Badge tone="neutral">Automático desligado</Badge>;
  const salvarConfig = (mensagem: string) => void acao(async () => {
    await api.put("/djen/config", config);
    await atualizarStatus();
    mostrar(mensagem, "success");
  });
  const filaIA = status.ia.pendentes ?? 0;
  const iaSituacao = status.ia.pausa ? <Badge tone="warning">Pausada</Badge>
    : status.ia.executando ? <Badge tone="info">Analisando…</Badge>
    : status.config.ia_ativa ? <Badge tone="success">Ativa</Badge>
    : <Badge tone="neutral">Desativada</Badge>;

  return (
    <div className="space-y-5">
      <SettingsPanel
        icon={<Activity />}
        title="Situação da sincronização"
        description="Resultado da última consulta ao Diário de Justiça Eletrônico."
        status={situacao}
        actions={<Button size="sm" onClick={onConsultar} loading={emExecucao}><Search className="h-4 w-4" />Consultar agora</Button>}
      >
        <SettingsBlock>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Indicador titulo="Última sincronização" valor={ultima ? instanteBR(ultima.finished_at || ultima.started_at) : "Nenhuma ainda"} detalhe={ultima ? ROTULO_BUSCA[ultima.status] || ultima.status : undefined} />
            <Indicador titulo="Publicações novas" valor={ultima ? String(ultima.novas) : "—"} detalhe={ultima ? `${dia(ultima.inicio)} a ${dia(ultima.fim)}` : undefined} />
            <Indicador titulo="Próxima consulta" valor={status.config.automatico ? (status.proxima_execucao ? instanteBR(status.proxima_execucao) : "Em breve") : "Manual"} detalhe={status.config.automatico ? `A cada ${status.config.intervalo_minutos} min` : "Automático desligado"} />
            <Indicador titulo="Erros" valor={String(totalErros)} detalhe={totalErros ? "Veja abaixo" : "Nenhum registrado"} tom={totalErros ? "erro" : "ok"} />
          </div>
          {errosUltima.map((e, i) => <Callout key={i} tone="erro"><strong>{e.advogado}:</strong> <span className="break-words">{e.erro}</span></Callout>)}
          {!errosUltima.length && status.advogados.filter((a) => a.ativo && a.ultimo_erro).map((a) => <Callout key={a.id} tone="erro"><strong>{a.nome}:</strong> <span className="break-words">{a.ultimo_erro}</span></Callout>)}
          {!status.advogados.some((a) => a.ativo) && <Callout tone="aviso">Nenhum advogado ativo. Cadastre em <Link className="font-medium underline" to="/processos/advogados">Advogados acompanhados</Link> para captar publicações.</Callout>}
        </SettingsBlock>
      </SettingsPanel>

      <SettingsPanel icon={<Activity />} title="Busca automática" description="Consulta periódica dos advogados ativos, sem precisar clicar.">
        <SettingsBlock>
          <SettingRow label="Consultar periodicamente" hint="Os advogados ativos são consultados sozinhos.">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <Checkbox checked={config.automatico} onChange={(e) => setConfig({ ...config, automatico: e.target.checked })} />
              {config.automatico ? "Ligado" : "Desligado"}
            </label>
          </SettingRow>
          <SettingRow label="Intervalo" htmlFor="djen-intervalo" hint="Entre 15 e 1440 minutos.">
            <div className="flex items-center gap-2"><Input id="djen-intervalo" className="max-w-[8rem]" type="number" min={15} max={1440} value={config.intervalo_minutos} onChange={(e) => setConfig({ ...config, intervalo_minutos: Number(e.target.value) })} /><span className="text-xs text-zinc-500">minutos</span></div>
          </SettingRow>
          <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">Opções avançadas<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
            <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
              <SettingRow label="Dias na primeira captura" htmlFor="djen-janela" hint="Quantos dias para trás a primeira busca automática revisita (1 a 31).">
                <Input id="djen-janela" className="max-w-[8rem]" type="number" min={1} max={31} value={config.janela_inicial_dias} onChange={(e) => setConfig({ ...config, janela_inicial_dias: Number(e.target.value) })} />
              </SettingRow>
              <SettingRow label="Lembrete sem publicação" htmlFor="djen-aguardo" hint="Prazo padrão para lembrar de acompanhamentos sem nova publicação.">
                <Select id="djen-aguardo" className="max-w-xs" value={config.aguardo_dias} onChange={(e) => setConfig({ ...config, aguardo_dias: Number(e.target.value) })}>
                  {[15, 30, 60, 90].map((dias) => <option key={dias} value={dias}>{dias} dias (quando não indicado)</option>)}
                </Select>
              </SettingRow>
            </div>
          </details>
          <Callout tone="info">As buscas revisitam os últimos dias para captar publicações disponibilizadas com atraso. Não há envio automático de mensagens nem criação de eventos no calendário de perícias.</Callout>
        </SettingsBlock>
        <SettingsFooter><Button size="sm" loading={salvando} onClick={() => salvarConfig("Monitoramento salvo.")}>Salvar monitoramento</Button></SettingsFooter>
      </SettingsPanel>

      <SettingsPanel
        icon={<Sparkles />}
        title="Classificação e resumos com IA"
        description="A IA lê o inteiro teor capturado; o que for inconclusivo fica em Outros para conferência."
        status={iaSituacao}
        actions={<Link className="text-xs font-medium text-accent-600 underline dark:text-accent-300" to="/configuracoes?ia=1">Provedor e conexão da IA</Link>}
      >
        <SettingsBlock>
          <SettingRow label="Analisar automaticamente" hint="As publicações capturadas são classificadas e resumidas. A primeira ativação analisa as pendentes; revisões salvas são preservadas.">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <Checkbox checked={config.ia_ativa} onChange={(e) => setConfig({ ...config, ia_ativa: e.target.checked })} />
              {config.ia_ativa ? "Ligada" : "Desligada"}
            </label>
          </SettingRow>
          <SettingRow label="Modo de análise" htmlFor="ia-modo" hint="No econômico, casos inconclusivos podem usar o modelo equilibrado do mesmo provedor.">
            <Select id="ia-modo" className="max-w-md" value={config.ia_modo} onChange={(e) => setConfig({ ...config, ia_modo: e.target.value as Config["ia_modo"] })}>
              <option value="economico">Econômico — lotes de até 8</option>
              <option value="equilibrado">Equilibrado — lotes de até 4</option>
              <option value="precisao">Máxima precisão — análise individual</option>
            </Select>
          </SettingRow>
          <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">Opções avançadas e uso<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
            <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
              <SettingRow label="Análises simultâneas" htmlFor="ia-paralelismo" hint="Muda a velocidade, não a quantidade total de texto analisado.">
                <Select id="ia-paralelismo" className="max-w-xs" value={config.ia_paralelismo} onChange={(e) => setConfig({ ...config, ia_paralelismo: Number(e.target.value) })}>
                  <option value={1}>1 por vez (menor pico de uso)</option>
                  <option value={2}>2 simultâneas</option>
                  <option value={3}>3 simultâneas</option>
                </Select>
              </SettingRow>
              <div className="grid gap-2 sm:grid-cols-3">
                <Indicador titulo="Execuções em 30 dias" valor={String(status.ia.uso_30_dias.chamadas)} />
                <Indicador titulo="Execuções evitadas" valor={String(status.ia.uso_30_dias.execucoes_evitadas)} tom="ok" />
                <Indicador titulo="Reaproveitadas do cache" valor={String(status.ia.uso_30_dias.cache_hits)} />
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">O uso está sujeito aos limites e créditos do provedor configurado.</p>
            </div>
          </details>
          {status.ia.pausa && <Callout tone="aviso">{status.ia.pausa}</Callout>}
          {conexaoIA && <Callout tone={conexaoIA.conectado ? "ok" : "erro"}>{conexaoIA.mensagem}</Callout>}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{filaIA} na fila · {status.ia.falhas ?? 0} com falha{status.ia.executando ? " · análise em andamento" : ""}</p>
        </SettingsBlock>
        <SettingsFooter left="Reanalisar usa o cache quando possível; o restante consome o limite da IA.">
          <Button size="sm" variant="outline" loading={salvando} onClick={() => void acao(async () => { setConexaoIA(await api.get("/djen/ia/conexao")); })}>Verificar conexão</Button>
          <Button size="sm" variant="outline" disabled={!status.config.ia_ativa || Boolean(status.ia.executando) || salvando} onClick={() => setConfirmarReanalise(true)}>Reanalisar sem revisão</Button>
          {status.ia.pausa && <Button size="sm" variant="outline" loading={salvando} disabled={!status.config.ia_ativa} onClick={() => void acao(async () => { await api.post("/djen/ia/retomar", {}); await atualizarStatus(); })}>Retomar análises</Button>}
          <Button size="sm" loading={salvando} onClick={() => salvarConfig("Configuração da IA salva.")}>Salvar configuração da IA</Button>
        </SettingsFooter>
      </SettingsPanel>
      <ConfirmDialog
        open={confirmarReanalise}
        title="Reanalisar publicações?"
        message={`Reanalisar ${status.ia.reanalisaveis ?? 0} publicação(ões) sem revisão? Textos já analisados poderão usar o cache; os demais consumirão o limite da IA.`}
        confirmLabel="Reanalisar"
        confirmVariant="primary"
        loading={salvando}
        onCancel={() => setConfirmarReanalise(false)}
        onConfirm={() => {
          setConfirmarReanalise(false);
          void acao(async () => {
            const resposta = await api.post<{ enfileiradas: number }>("/djen/ia/reanalisar", {});
            await atualizarStatus();
            mostrar(`${resposta.enfileiradas} publicação(ões) adicionada(s) à fila.`, "success");
          });
        }}
      />

      {administrador && <IATeaching />}

      <details className="surface-panel group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
          <span><span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Histórico de consultas</span><span className="block text-xs text-zinc-500 dark:text-zinc-400">As 5 mais recentes{status.ultimas.length ? ` · ${status.ultimas.length} registro(s)` : ""}</span></span>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          {!status.ultimas.length ? (
            <p className="px-5 py-5 text-xs text-zinc-500 dark:text-zinc-400">Nenhuma consulta executada.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {status.ultimas.map((b) => (
                <li key={b.id} className="space-y-1.5 px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-zinc-700 dark:text-zinc-300">{dia(b.inicio)} a {dia(b.fim)} · {b.novas} novas publicações · {b.consultas} consultas à API</p>
                    <div className="flex items-center gap-2">
                      <Badge tone={b.status === "concluida" ? "success" : b.status === "executando" ? "info" : "warning"}>{ROTULO_BUSCA[b.status] || b.status}</Badge>
                      <Button size="sm" variant="ghost" disabled={salvando || b.status === "executando"} aria-label={`Excluir registro da consulta ${b.id}`}
                        onClick={() => void acao(async () => {
                          await api.delete(`/djen/buscas/${b.id}`);
                          await atualizarStatus();
                          mostrar("Registro da consulta excluído. As publicações foram preservadas.", "success");
                        })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  {errosDaBusca(b.erros_json).map((e, i) => <p key={i} className="break-words text-xs text-red-700 dark:text-red-300">{e.advogado}: {e.erro}</p>)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
