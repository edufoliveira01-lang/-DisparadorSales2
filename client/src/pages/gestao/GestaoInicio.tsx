import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock, AlertTriangle, BellRing, CalendarClock, ChevronLeft, ChevronRight, Contact, Download, FileSignature, FolderSync, Gavel, Landmark,
  ListChecks, MessageSquareReply, Plus, Scale, Stethoscope, UserCheck, UserX, Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { dataBr } from "./comum";
import { TarefaModal, type Tarefa } from "./TarefaModal";
import type { Responsavel } from "./Processos";
import { BarrasMensais, Indicador, LinhaDeFunil, moeda, rotuloDoMes, Secao } from "../inicio/pecas";

interface Compromisso { id: number; tipo: string; nome: string; data: string; horario: string | null; local: string | null; processo: string | null; eh_audiencia: boolean }
interface MesAtendimento { mes: string; novos: number; qualificados: number; desqualificados: number; sem_interesse: number; em_andamento: number }
interface Dash {
  hoje: string; mes: string; meses: string[];
  contratos: { assinados_mes: number; assinados_zapsign_mes: number; presenciais_mes: number; enviados_mes: number; aguardando_assinatura: number; aguardando_mais_de_3_dias: number; serie: { mes: string; total: number }[]; serie_enviados: { mes: string; total: number }[] } | null;
  processos: { protocolados_mes: number; cadastrados_mes: number; ativos: number; sem_responsavel: number; serie: { mes: string; total: number }[] };
  negocios: { fecharam_mes: number; qualificados_mes: number; nao_qualificados_mes: number; aguardando_mes: number; nao_informada_mes: number; serie_qualificados: { mes: string; total: number }[]; aguardando_analise_total: number } | null;
  clientes: { novos_mes: number; total: number };
  periciasEAudiencias: {
    hoje: Compromisso[]; proximos: Compromisso[]; hoje_total: number; semana_total: number; pericias_mes: number; audiencias_mes: number;
    para_avisar: number; sem_telefone: number; aguardando_resposta: number; avisos_hoje: number; avisos_com_falha_7d: number;
  };
  tarefas: { atrasadas: number; hoje: number; proximos_7_dias: number; fatais_5_dias: number; sem_responsavel: number; concluidas_mes: number; lista_urgente: { id: number; titulo: string; prazo: string; prazo_fatal: number; processo_id: number | null }[] };
  publicacoes: { nao_lidas: number; prazos_vencidos: number; prazos_7_dias: number };
  financeiro: { recebido_mes_centavos: number; a_receber_mes_centavos: number; em_atraso_centavos: number; em_atraso_quantidade: number; a_pagar_mes_centavos: number; serie_recebido: { mes: string; total: number }[] } | null;
  documentos: { enviados_mes: number; com_erro: number; aguardando_pasta: number; esperando_assinatura: number; problema: string | null } | null;
  atendimento: { atualizado_em: string; mes: MesAtendimento; serie: MesAtendimento[]; por_etapa: { nome: string; total: number; posicao: number }[]; abertos: number } | null;
}
interface MeuPainel { atrasadas: Tarefa[]; hoje_lista: Tarefa[]; proximas: Tarefa[] }
interface Resumo { pendentes_importacao: number; contatos_sem_cadastro: number }

const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeDoMes = (m: string) => { const n = NOMES_MES[Number(m.slice(5, 7)) - 1] ?? m; return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${m.slice(0, 4)}`; };
const moverMes = (m: string, n: number) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const hhmm = (h: string | null) => (h ? h.slice(0, 5) : "—");
const haQuanto = (iso: string) => { const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return min < 2 ? "agora há pouco" : min < 90 ? `há ${min} min` : `há ${Math.round(min / 60)} h`; };

export function GestaoInicio() {
  const { user, can } = useAuth();
  const { show } = useToast();
  const gerir = can("gestao.manage");
  const [mes, setMes] = useState<string | null>(null);
  const [d, setD] = useState<Dash | null>(null);
  const [meu, setMeu] = useState<MeuPainel | null>(null);
  const [r, setR] = useState<Resumo | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [nova, setNova] = useState(false);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.all([
        api.get<Dash>(`/gestao/dashboard${mes ? `?mes=${mes}` : ""}`),
        api.get<MeuPainel>("/gestao/meu-painel").catch(() => null),
        api.get<Resumo>("/gestao/resumo").catch(() => null),
      ]);
      setD(a); setMeu(b); setR(c); setErro(false);
      if (!mes) setMes(a.mes);
    } catch { setErro(true); show("Não foi possível carregar o painel.", "error"); }
  }, [mes, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, []);

  const concluir = async (t: Tarefa) => { try { await api.post(`/gestao/tarefas/${t.id}/concluir`, {}); await carregar(); } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); } };
  const executar = async (chave: string, caminho: string, ok: (x: any) => string) => {
    setOcupado(chave);
    try { const x = await api.post<any>(caminho, {}); show(ok(x), "success"); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir.", "error"); }
    finally { setOcupado(""); }
  };

  const mesAtual = d?.mes ?? mes ?? "";
  const pa = d?.periciasEAudiencias;
  const at = d?.atendimento;
  const am = at?.mes;
  const ng = d?.negocios ?? null;
  const taxaQualificacao = ng && ng.fecharam_mes > 0 ? Math.round((ng.qualificados_mes / ng.fecharam_mes) * 100) : null;
  const desqualificadosMes = (am?.desqualificados ?? 0) + (ng?.nao_qualificados_mes ?? 0);

  // faixa de alertas: o que precisa de atenção agora, em uma olhada
  const alertas: { tom: "vermelho" | "amarelo"; texto: string; para?: string }[] = [];
  if (d) {
    if (d.tarefas.atrasadas > 0) alertas.push({ tom: "vermelho", texto: `${d.tarefas.atrasadas} tarefa(s) atrasada(s)`, para: "/gestao/tarefas" });
    if (d.tarefas.fatais_5_dias > 0) alertas.push({ tom: "vermelho", texto: `${d.tarefas.fatais_5_dias} prazo(s) fatal(is) em até 5 dias`, para: "/gestao/tarefas" });
    if (d.publicacoes.prazos_vencidos > 0) alertas.push({ tom: "vermelho", texto: `${d.publicacoes.prazos_vencidos} prazo(s) do DJEN vencido(s)`, para: "/processos" });
    if (pa && pa.sem_telefone > 0) alertas.push({ tom: "amarelo", texto: `${pa.sem_telefone} compromisso(s) da semana sem telefone para avisar`, para: "/pericias" });
    if (pa && pa.avisos_com_falha_7d > 0) alertas.push({ tom: "amarelo", texto: `${pa.avisos_com_falha_7d} aviso(s) falharam nos últimos 7 dias`, para: "/historico" });
    if (d.contratos && d.contratos.aguardando_mais_de_3_dias > 0) alertas.push({ tom: "amarelo", texto: `${d.contratos.aguardando_mais_de_3_dias} contrato(s) esperando assinatura há mais de 3 dias` });
    if (d.documentos?.problema) alertas.push({ tom: "vermelho", texto: d.documentos.problema, para: "/configuracoes" });
    if (d.financeiro && d.financeiro.em_atraso_quantidade > 0) alertas.push({ tom: "amarelo", texto: `${d.financeiro.em_atraso_quantidade} cobrança(s) em atraso (${moeda(d.financeiro.em_atraso_centavos)})`, para: "/gestao/financeiro" });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Olá, ${user.display_name || user.username}`}
        description="O que aconteceu no escritório e o que precisa de você hoje."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-zinc-200 bg-white p-1 dark:border-white/10 dark:bg-white/5" role="group" aria-label="Escolher o mês">
              <button type="button" className="topbar-icon !h-8 !w-8" aria-label="Mês anterior" onClick={() => setMes(moverMes(mesAtual, -1))}><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[9.5rem] px-2 text-center text-sm font-semibold text-zinc-800 dark:text-zinc-100">{mesAtual ? nomeDoMes(mesAtual) : "…"}</span>
              <button type="button" className="topbar-icon !h-8 !w-8" aria-label="Próximo mês" onClick={() => setMes(moverMes(mesAtual, 1))}><ChevronRight className="h-4 w-4" /></button>
            </div>
            {gerir && <Button onClick={() => setNova(true)}><Plus className="h-4 w-4" /> Nova tarefa</Button>}
          </div>
        }
      />

      {erro && !d && <div className="surface-panel p-6 text-sm text-zinc-500">Não foi possível carregar o painel. Tente de novo em instantes.</div>}

      {alertas.length > 0 && (
        <div className="surface-panel border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/5" role="status">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4" /> Precisa de atenção</p>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
            {alertas.map((a) => (
              <li key={a.texto} className="flex items-start gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tom === "vermelho" ? "bg-red-500" : "bg-amber-500"}`} />
                {a.para ? <Link to={a.para} className="hover:underline">{a.texto}</Link> : <span>{a.texto}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Os seis números do mês */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Indicador icone={<FileSignature />} rotulo="Contratos assinados" valor={d?.contratos ? d.contratos.assinados_mes : "—"} tom="verde" detalhe={d?.contratos ? `${d.contratos.assinados_zapsign_mes} ZapSign · ${d.contratos.presenciais_mes} presenciais · ${d.contratos.aguardando_assinatura} aguardando` : "Sem ZapSign neste escritório"} />
        <Indicador icone={<Gavel />} rotulo="Processos protocolados" valor={d?.processos.protocolados_mes ?? "…"} tom="azul" detalhe={d ? `${d.processos.ativos} ativos no total` : undefined} para="/gestao/processos" />
        <Indicador icone={<UserCheck />} rotulo="Clientes qualificados" valor={ng ? ng.qualificados_mes : "—"} tom="verde" detalhe={ng ? (taxaQualificacao !== null ? `${taxaQualificacao}% dos ${ng.fecharam_mes} que fecharam` : "Nenhum contrato fechado neste mês") : undefined} para="/gestao/captacao" />
        <Indicador icone={<UserX />} rotulo="Desqualificados" valor={am || ng ? desqualificadosMes : "—"} tom={desqualificadosMes > 0 ? "vermelho" : "neutro"} detalhe={`${am?.desqualificados ?? 0} na triagem · ${ng?.nao_qualificados_mes ?? 0} após análise${ng && ng.aguardando_analise_total > 0 ? ` · ${ng.aguardando_analise_total} a analisar` : ""}`} para="/gestao/captacao" />
        <Indicador icone={<CalendarClock />} rotulo="Perícias e audiências hoje" valor={pa?.hoje_total ?? "…"} tom={pa && pa.hoje_total > 0 ? "amarelo" : "neutro"} detalhe={pa ? `${pa.semana_total} nos próximos 7 dias` : undefined} para="/pericias" />
        <Indicador icone={<BellRing />} rotulo="Para avisar (7 dias)" valor={pa?.para_avisar ?? "…"} tom={pa && pa.para_avisar > 0 ? "amarelo" : "verde"} detalhe={pa ? `${pa.avisos_hoje} avisos enviados hoje` : undefined} para="/pericias" />
      </div>

      {/* Atendimento + gráficos mensais */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Secao titulo="Atendimento no mês" subtitulo={at ? `Leads que chegaram em ${rotuloDoMes(mesAtual)} e como estão agora · atualizado ${haQuanto(at.atualizado_em)}` : undefined}>
          {!at || !am ? (
            <p className="text-sm text-zinc-500">Os números do atendimento aparecem aqui assim que o atendimento enviar o primeiro resumo (leva alguns minutos depois de conectado).</p>
          ) : (
            <div className="space-y-3">
              <LinhaDeFunil rotulo="Chegaram" valor={am.novos} total={am.novos} cor="bg-zinc-400" />
              <LinhaDeFunil rotulo="Passaram da triagem" valor={am.qualificados} total={am.novos} cor="bg-emerald-500" />
              <LinhaDeFunil rotulo="Em atendimento" valor={am.em_andamento} total={am.novos} cor="bg-accent-500" />
              <LinhaDeFunil rotulo="Sem interesse" valor={am.sem_interesse} total={am.novos} cor="bg-amber-500" />
              <LinhaDeFunil rotulo="Desqualificados na triagem" valor={am.desqualificados} total={am.novos} cor="bg-red-500" />
              {d?.contratos && <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-500 dark:border-white/10">Contratos assinados no mês: <strong className="text-zinc-800 dark:text-zinc-100">{d.contratos.assinados_mes}</strong>{am.novos > 0 && <> · {Math.round((d.contratos.assinados_mes / am.novos) * 100)}% dos que chegaram</>}</p>}
            </div>
          )}
        </Secao>
        <Secao titulo="Contratos por mês" subtitulo="Assinados e enviados nos últimos 6 meses">
          {d?.contratos ? <BarrasMensais meses={d.meses} serieA={d.contratos.serie.map((x) => x.total)} serieB={d.contratos.serie_enviados.map((x) => x.total)} nomeA="Assinados" nomeB="Enviados" destaque={mesAtual} /> : <p className="text-sm text-zinc-500">Este escritório não usa assinatura de contratos.</p>}
        </Secao>
        <Secao titulo="Processos protocolados por mês" subtitulo="Pela data de distribuição">
          {d && <BarrasMensais meses={d.meses} serieA={d.processos.serie.map((x) => x.total)} nomeA="Protocolados" destaque={mesAtual} />}
        </Secao>
      </div>

      {/* Perícias e audiências */}
      <Secao
        titulo="Perícias e audiências"
        subtitulo={pa ? `${pa.pericias_mes} perícia(s) e ${pa.audiencias_mes} audiência(s) em ${rotuloDoMes(mesAtual)} · ${pa.aguardando_resposta} cliente(s) ainda não responderam ao aviso` : undefined}
        direita={<Link to="/pericias" className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">Abrir agenda</Link>}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <ListaDeCompromissos titulo="Hoje" vazio="Nenhuma perícia ou audiência hoje." itens={pa?.hoje ?? []} mostrarData={false} />
          <ListaDeCompromissos titulo="Próximos 7 dias" vazio="Nada marcado para os próximos dias." itens={pa?.proximos ?? []} mostrarData />
        </div>
        {pa && (pa.para_avisar > 0 || pa.sem_telefone > 0) && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            <BellRing className="mr-1.5 inline h-4 w-4" />{pa.para_avisar} compromisso(s) da semana ainda vão receber aviso{pa.sem_telefone > 0 ? ` · ${pa.sem_telefone} sem telefone cadastrado` : ""}.
          </p>
        )}
      </Secao>

      {/* Tarefas, publicações e financeiro */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Secao titulo="Tarefas" direita={<Link to="/gestao/tarefas" className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">Ver todas</Link>}>
          <div className="grid grid-cols-2 gap-2">
            <Mini rotulo="Atrasadas" valor={d?.tarefas.atrasadas} tom={d && d.tarefas.atrasadas > 0 ? "vermelho" : "verde"} />
            <Mini rotulo="Para hoje" valor={d?.tarefas.hoje} tom={d && d.tarefas.hoje > 0 ? "amarelo" : "verde"} />
            <Mini rotulo="Próximos 7 dias" valor={d?.tarefas.proximos_7_dias} tom="azul" />
            <Mini rotulo="Prazos fatais (5 dias)" valor={d?.tarefas.fatais_5_dias} tom={d && d.tarefas.fatais_5_dias > 0 ? "vermelho" : "verde"} />
          </div>
          {d && d.tarefas.lista_urgente.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-white/10">
              {d.tarefas.lista_urgente.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="truncate">{t.prazo_fatal ? <Badge tone="danger" className="mr-2">fatal</Badge> : null}{t.titulo}</span>
                  <span className={`shrink-0 text-xs ${t.prazo < d.hoje ? "font-semibold text-red-600" : "text-zinc-500"}`}>{dataBr(t.prazo)}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao titulo="Publicações e prazos (DJEN)" direita={<Link to="/processos" className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">Abrir</Link>}>
          <div className="grid grid-cols-2 gap-2">
            <Mini rotulo="Publicações não lidas" valor={d?.publicacoes.nao_lidas} tom={d && d.publicacoes.nao_lidas > 0 ? "azul" : "verde"} />
            <Mini rotulo="Prazos vencidos" valor={d?.publicacoes.prazos_vencidos} tom={d && d.publicacoes.prazos_vencidos > 0 ? "vermelho" : "verde"} />
            <Mini rotulo="Prazos em 7 dias" valor={d?.publicacoes.prazos_7_dias} tom={d && d.publicacoes.prazos_7_dias > 0 ? "amarelo" : "verde"} />
            <Mini rotulo="Processos sem responsável" valor={d?.processos.sem_responsavel} tom={d && d.processos.sem_responsavel > 0 ? "amarelo" : "verde"} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Mini rotulo="Clientes novos no mês" valor={d?.clientes.novos_mes} tom="azul" />
            <Mini rotulo="Clientes ativos" valor={d?.clientes.total} tom="neutro" />
          </div>
        </Secao>
        {d?.financeiro ? (
          <Secao titulo="Financeiro do mês" direita={<Link to="/gestao/financeiro" className="text-sm font-medium text-accent-700 hover:underline dark:text-accent-300">Abrir</Link>}>
            <div className="grid grid-cols-2 gap-2">
              <Mini rotulo="Recebido" valor={moeda(d.financeiro.recebido_mes_centavos)} tom="verde" />
              <Mini rotulo="A receber" valor={moeda(d.financeiro.a_receber_mes_centavos)} tom="azul" />
              <Mini rotulo="Em atraso" valor={moeda(d.financeiro.em_atraso_centavos)} tom={d.financeiro.em_atraso_centavos > 0 ? "vermelho" : "verde"} />
              <Mini rotulo="A pagar" valor={moeda(d.financeiro.a_pagar_mes_centavos)} tom="amarelo" />
            </div>
            <div className="mt-3"><BarrasMensais meses={d.meses} serieA={d.financeiro.serie_recebido.map((x) => x.total)} nomeA="Recebido" destaque={mesAtual} formato={(n) => (n >= 100000 ? `${Math.round(n / 100000)}k` : String(Math.round(n / 100)))} /></div>
          </Secao>
        ) : (
          <Secao titulo="Documentos dos clientes (Dropbox)">
            <DocumentosDoDropbox d={d} />
          </Secao>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {at && at.por_etapa.length > 0 && (
          <Secao titulo="Onde estão os atendimentos agora" subtitulo={`${at.abertos} em aberto no atendimento`}>
            <div className="space-y-3">
              {at.por_etapa.map((e) => <LinhaDeFunil key={e.nome} rotulo={e.nome} valor={e.total} total={at.abertos} cor="bg-accent-500" />)}
            </div>
          </Secao>
        )}
        {d?.financeiro && (
          <Secao titulo="Documentos dos clientes (Dropbox)"><DocumentosDoDropbox d={d} /></Secao>
        )}
      </div>

      {/* Minhas tarefas */}
      {meu && (
        <div>
          <h2 className="mb-3 text-[15px] font-semibold text-zinc-900 dark:text-white">Minhas tarefas</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <Lista titulo="Atrasadas" tom="text-red-600" itens={meu.atrasadas} vazio="Nada atrasado." aoConcluir={gerir ? concluir : undefined} />
            <Lista titulo="Para hoje" tom="text-amber-600" itens={meu.hoje_lista} vazio="Nada para hoje." aoConcluir={gerir ? concluir : undefined} />
            <Lista titulo="Próximos 7 dias" tom="text-accent-600" itens={meu.proximas} vazio="Nada nos próximos dias." aoConcluir={gerir ? concluir : undefined} />
          </div>
        </div>
      )}

      {gerir && r && r.pendentes_importacao > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent-200 bg-accent-50/60 p-4 dark:border-accent-900 dark:bg-accent-950/30">
          <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.pendentes_importacao} processo(s) acompanhados no DJEN ainda não têm ficha</p><p className="text-sm text-zinc-600 dark:text-zinc-400">Crie as fichas para acompanhá-los junto com os demais.</p></div>
          <Button loading={ocupado === "djen"} onClick={() => executar("djen", "/gestao/processos/importar-djen", (x) => `${x.criados} ficha(s) criada(s).`)}><Download className="h-4 w-4" /> Criar fichas</Button>
        </div>
      )}
      {gerir && r && r.contatos_sem_cadastro > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/5">
          <div><p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{r.contatos_sem_cadastro} contato(s) da agenda podem virar cadastro completo</p><p className="text-sm text-zinc-600 dark:text-zinc-400">Importe para ter ficha, processos e financeiro de cada um.</p></div>
          <Link to="/gestao/clientes"><Button variant="outline">Revisar em Clientes</Button></Link>
        </div>
      )}
      {nova && <TarefaModal responsaveis={resp} meuId={user.id} aoFechar={() => setNova(false)} aoSalvar={() => { setNova(false); void carregar(); }} />}
    </div>
  );
}

function Mini({ rotulo, valor, tom }: { rotulo: string; valor: number | string | undefined; tom: "verde" | "amarelo" | "vermelho" | "azul" | "neutro" }) {
  const cor = { verde: "text-emerald-700 dark:text-emerald-300", amarelo: "text-amber-700 dark:text-amber-300", vermelho: "text-red-700 dark:text-red-300", azul: "text-accent-700 dark:text-accent-300", neutro: "text-zinc-800 dark:text-zinc-100" }[tom];
  const fundo = { verde: "bg-emerald-50 dark:bg-emerald-500/10", amarelo: "bg-amber-50 dark:bg-amber-500/10", vermelho: "bg-red-50 dark:bg-red-500/10", azul: "bg-accent-50 dark:bg-accent-500/10", neutro: "bg-zinc-50 dark:bg-white/5" }[tom];
  return (
    <div className={`rounded-xl px-3 py-2.5 ${fundo}`}>
      <p className={`text-xl font-semibold tabular-nums ${cor}`}>{valor ?? "…"}</p>
      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{rotulo}</p>
    </div>
  );
}

function DocumentosDoDropbox({ d }: { d: Dash | null }) {
  if (!d?.documentos) return <p className="text-sm text-zinc-500">O envio de documentos ao Dropbox ainda não está ligado.</p>;
  const x = d.documentos;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Mini rotulo="Enviados no mês" valor={x.enviados_mes} tom="verde" />
        <Mini rotulo="Com erro" valor={x.com_erro} tom={x.com_erro > 0 ? "vermelho" : "verde"} />
        <Mini rotulo="Aguardando pasta" valor={x.aguardando_pasta} tom={x.aguardando_pasta > 0 ? "amarelo" : "verde"} />
        <Mini rotulo="Esperando assinatura" valor={x.esperando_assinatura} tom="azul" />
      </div>
      {x.problema && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200"><FolderSync className="mr-1.5 inline h-4 w-4" />{x.problema}</p>}
    </div>
  );
}

function ListaDeCompromissos({ titulo, itens, vazio, mostrarData }: { titulo: string; itens: Compromisso[]; vazio: string; mostrarData: boolean }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{titulo} <span className="font-normal text-zinc-400">({itens.length})</span></h3>
      {itens.length === 0 ? <p className="text-sm text-zinc-500">{vazio}</p> : (
        <ul className="space-y-2">
          {itens.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-xl border border-zinc-100 px-3 py-2.5 dark:border-white/10">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${c.eh_audiencia ? "bg-accent-50 text-accent-600 dark:bg-accent-500/15" : "bg-amber-50 text-amber-600 dark:bg-amber-500/15"}`}>{c.eh_audiencia ? <Scale className="h-4 w-4" /> : <Stethoscope className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</p>
                <p className="truncate text-xs text-zinc-500">{c.tipo}{c.local ? ` · ${c.local}` : ""}</p>
              </div>
              <div className="shrink-0 text-right text-xs"><p className="font-semibold text-zinc-800 dark:text-zinc-100">{hhmm(c.horario)}</p>{mostrarData && <p className="text-zinc-500">{dataBr(c.data)}</p>}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Lista({ titulo, tom, itens, vazio, aoConcluir }: { titulo: string; tom: string; itens: Tarefa[]; vazio: string; aoConcluir?: (t: Tarefa) => void }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className={`text-sm font-semibold ${tom}`}>{titulo} <span className="font-normal text-zinc-400">({itens.length})</span></h2>
      {itens.length === 0 ? <p className="mt-3 text-sm text-zinc-500">{vazio}</p> : (
        <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
          {itens.map((t) => (
            <li key={t.id} className="flex items-start gap-2 py-2">
              {aoConcluir && <input type="checkbox" className="mt-1 h-4 w-4 accent-accent-600" checked={false} onChange={() => aoConcluir(t)} aria-label={`Concluir ${t.titulo}`} />}
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.titulo}</p><p className="truncate text-xs text-zinc-500">{dataBr(t.prazo)}{t.processo_pasta ? ` · Pasta ${t.processo_pasta}` : ""}{t.prazo_fatal ? " · FATAL" : ""}</p></div>
              {t.processo_id && <Link to={`/gestao/processos/${t.processo_id}`} className="text-xs text-accent-700 hover:underline">Abrir</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
