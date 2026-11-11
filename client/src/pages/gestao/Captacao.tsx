import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Handshake, Plus, TrendingUp, UserCheck, UserPlus, UserX, Hourglass, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { BarrasMensais, Indicador, LinhaDeFunil, rotuloDoMes, Secao } from "../inicio/pecas";
import { dataBr } from "./comum";
import type { Responsavel } from "./Processos";
import { TOM_DA_QUALIFICACAO, type Opcao, type OpcoesDoNegocio } from "./NegocioDaPessoa";

interface Linha { mes: string; entraram_atendimento: number; entraram_presencial: number; entraram: number; fecharam: number; qualificados: number; nao_qualificados: number; aguardando: number; nao_informada: number }
interface Dados {
  ano: string; mes: string | null; atualizado_em_atendimento: string | null; meses: Linha[]; total: Linha;
  por_fonte: { chave: string; rotulo: string; entraram: number; fecharam: number; qualificados: number; nao_qualificados: number }[];
  por_atendimento: { chave: string; rotulo: string; fecharam: number; qualificados: number }[];
  por_responsavel: { nome: string; fecharam: number; qualificados: number; nao_qualificados: number }[];
  por_area: { chave: string; rotulo: string; fecharam: number; qualificados: number }[];
  motivos: { chave: string; rotulo: string; total: number }[];
  funil: { entraram: number; fecharam: number; qualificados: number; protocolados: number };
  pendentes: number;
}
interface Pendente { pessoa_id: number; nome: string; data_fechamento: string; fonte: string; tipo_atendimento: string; qualificacao: string; fechado_por_user_id: number | null }

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
const NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const ABAS = [["resumo", "Resumo"], ["pendentes", "Preencher cadastros"], ["fontes", "Fontes"]] as const;

export function Captacao() {
  const { show } = useToast();
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(String(anoAtual));
  const [mes, setMes] = useState("");
  const [d, setD] = useState<Dados | null>(null);
  const [aba, setAba] = useState<(typeof ABAS)[number][0]>("resumo");

  const carregar = useCallback(async () => {
    try { setD(await api.get<Dados>(`/gestao/captacao?ano=${ano}${mes ? `&mes=${ano}-${mes}` : ""}`)); }
    catch { show("Não foi possível carregar a captação.", "error"); }
  }, [ano, mes, show]);
  useEffect(() => { void carregar(); }, [carregar]);

  const periodo = mes ? `${NOMES[Number(mes) - 1]} de ${ano}` : `ano de ${ano}`;
  const t = useMemo(() => {
    if (!d) return null;
    if (!mes) return d.total;
    return d.meses.find((m) => m.mes === `${ano}-${mes}`) ?? d.total;
  }, [d, ano, mes]);

  function exportar() {
    if (!d) return;
    const linhas = [["Mês", "Entraram (WhatsApp)", "Entraram (presencial)", "Entraram", "Fecharam", "Qualificados", "Não qualificados", "Aguardando análise", "Não informada"], ...d.meses.map((m) => [m.mes, m.entraram_atendimento, m.entraram_presencial, m.entraram, m.fecharam, m.qualificados, m.nao_qualificados, m.aguardando, m.nao_informada]),
      [], ["Fonte", "Entraram", "Fecharam", "Qualificados", "Não qualificados"], ...d.por_fonte.map((f) => [f.rotulo, f.entraram, f.fecharam, f.qualificados, f.nao_qualificados])];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    a.download = `captacao-${ano}${mes ? `-${mes}` : ""}.csv`;
    a.click();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Captação"
        description="De onde vêm os clientes, quantos entram, quantos fecham e quantos são qualificados."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-28"><Select aria-label="Ano" value={ano} onChange={(e) => setAno(e.target.value)}>{Array.from({ length: 6 }, (_, i) => String(anoAtual - i)).map((a) => <option key={a} value={a}>{a}</option>)}</Select></div>
            <div className="w-40"><Select aria-label="Mês" value={mes} onChange={(e) => setMes(e.target.value)}><option value="">Ano todo</option>{NOMES.map((n, i) => <option key={n} value={String(i + 1).padStart(2, "0")}>{n}</option>)}</Select></div>
            <Button variant="outline" onClick={exportar} disabled={!d}><Download className="h-4 w-4" /> Exportar</Button>
          </div>
        }
      />

      <div className="page-tabs" role="tablist">
        {ABAS.map(([k, r]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${aba === k ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200" : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5"}`}>
            {r}{k === "pendentes" && d && d.pendentes > 0 ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{d.pendentes}</span> : null}
          </button>
        ))}
      </div>

      {aba === "resumo" && d && t && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Indicador icone={<UserPlus />} rotulo="Entraram" valor={t.entraram} tom="azul" detalhe={`${t.entraram_atendimento} WhatsApp · ${t.entraram_presencial} presencial`} />
            <Indicador icone={<Handshake />} rotulo="Fecharam" valor={t.fecharam} tom="verde" detalhe={`${pct(t.fecharam, t.entraram)} dos que entraram`} />
            <Indicador icone={<UserCheck />} rotulo="Qualificados" valor={t.qualificados} tom="verde" detalhe={`${pct(t.qualificados, t.fecharam)} dos que fecharam`} />
            <Indicador icone={<UserX />} rotulo="Não qualificados" valor={t.nao_qualificados} tom={t.nao_qualificados > 0 ? "vermelho" : "neutro"} detalhe={`${pct(t.nao_qualificados, t.fecharam)} dos que fecharam`} />
            <Indicador icone={<Hourglass />} rotulo="Aguardando análise" valor={t.aguardando + t.nao_informada} tom={t.aguardando + t.nao_informada > 0 ? "amarelo" : "verde"} detalhe={t.nao_informada > 0 ? `${t.nao_informada} sem qualificação informada` : "Casos a analisar"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Secao titulo={`Funil — ${periodo}`} subtitulo="Do primeiro contato ao processo protocolado">
              <div className="space-y-3">
                <LinhaDeFunil rotulo="Entraram" valor={d.funil.entraram} total={d.funil.entraram} cor="bg-accent-500" />
                <LinhaDeFunil rotulo="Fecharam contrato" valor={d.funil.fecharam} total={d.funil.entraram} cor="bg-emerald-500" />
                <LinhaDeFunil rotulo="Qualificados" valor={d.funil.qualificados} total={d.funil.entraram} cor="bg-emerald-700" />
                <LinhaDeFunil rotulo="Processos protocolados" valor={d.funil.protocolados} total={d.funil.entraram} cor="bg-violet-500" />
              </div>
              {!d.atualizado_em_atendimento && <p className="mt-3 text-xs text-zinc-500">Os leads do WhatsApp aparecem assim que o atendimento enviar o primeiro resumo.</p>}
            </Secao>
            <Secao titulo={`Entraram e fecharam — ${ano}`} subtitulo="Mês a mês">
              <BarrasMensais meses={d.meses.map((m) => m.mes)} serieA={d.meses.map((m) => m.fecharam)} serieB={d.meses.map((m) => m.entraram)} nomeA="Fecharam" nomeB="Entraram" destaque={mes ? `${ano}-${mes}` : ""} />
            </Secao>
          </div>

          <Secao titulo={`Mês a mês — ${ano}`} subtitulo="Qualificação pelo mês do fechamento">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="text-left text-xs text-zinc-500"><th className="py-2 pr-3 font-medium">Mês</th><Th>Entraram</Th><Th>Fecharam</Th><Th>% fechou</Th><Th>Qualificados</Th><Th>% qualif.</Th><Th>Não qualif.</Th><Th>Aguardando</Th></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/10">
                  {d.meses.map((m) => (
                    <tr key={m.mes} className={m.mes === `${ano}-${mes}` ? "bg-accent-50/60 dark:bg-accent-500/10" : ""}>
                      <td className="py-2 pr-3 font-medium">{NOMES[Number(m.mes.slice(5)) - 1]}</td><Td>{m.entraram}</Td><Td>{m.fecharam}</Td><Td>{pct(m.fecharam, m.entraram)}</Td><Td>{m.qualificados}</Td><Td>{pct(m.qualificados, m.fecharam)}</Td><Td>{m.nao_qualificados}</Td><Td>{m.aguardando + m.nao_informada}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-zinc-200 font-semibold dark:border-white/20"><td className="py-2 pr-3">Total {ano}</td><Td>{d.total.entraram}</Td><Td>{d.total.fecharam}</Td><Td>{pct(d.total.fecharam, d.total.entraram)}</Td><Td>{d.total.qualificados}</Td><Td>{pct(d.total.qualificados, d.total.fecharam)}</Td><Td>{d.total.nao_qualificados}</Td><Td>{d.total.aguardando + d.total.nao_informada}</Td></tr></tfoot>
              </table>
            </div>
          </Secao>

          <Secao titulo={`Por fonte — ${periodo}`} subtitulo="Qual origem traz volume e qual traz caso qualificado">
            {d.por_fonte.length === 0 ? <p className="text-sm text-zinc-500">Nenhum dado de fonte neste período.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="text-left text-xs text-zinc-500"><th className="py-2 pr-3 font-medium">Fonte</th><Th>Entraram</Th><Th>Fecharam</Th><Th>% fechou</Th><Th>Qualificados</Th><Th>% qualif.</Th></tr></thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-white/10">
                    {d.por_fonte.map((f) => <tr key={f.chave}><td className="py-2 pr-3 font-medium">{f.rotulo}</td><Td>{f.entraram}</Td><Td>{f.fecharam}</Td><Td>{pct(f.fecharam, f.entraram)}</Td><Td>{f.qualificados}</Td><Td>{pct(f.qualificados, f.fecharam)}</Td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </Secao>

          <div className="grid gap-4 lg:grid-cols-3">
            <Secao titulo="Presencial × online" subtitulo="Contratos fechados">
              {d.por_atendimento.length === 0 ? <p className="text-sm text-zinc-500">Sem dados.</p> : <div className="space-y-3">{d.por_atendimento.map((x) => <LinhaDeFunil key={x.chave} rotulo={x.rotulo} valor={x.fecharam} total={d.funil.fecharam} cor={x.chave === "presencial" ? "bg-amber-500" : "bg-accent-500"} />)}</div>}
            </Secao>
            <Secao titulo="Quem fechou" subtitulo="Contratos e casos qualificados">
              {d.por_responsavel.length === 0 ? <p className="text-sm text-zinc-500">Sem dados.</p> : <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/10">{d.por_responsavel.map((r) => <li key={r.nome} className="flex items-center justify-between gap-2 py-2"><span className="truncate">{r.nome}</span><span className="shrink-0 text-zinc-500"><strong className="text-zinc-800 dark:text-zinc-100">{r.fecharam}</strong> fecharam · {r.qualificados} qualif.</span></li>)}</ul>}
            </Secao>
            <Secao titulo="Por que não qualificou" subtitulo="Motivos informados pela equipe">
              {d.motivos.length === 0 ? <p className="text-sm text-zinc-500">Nenhum caso não qualificado neste período.</p> : <div className="space-y-3">{d.motivos.map((m) => <LinhaDeFunil key={m.chave} rotulo={m.rotulo} valor={m.total} total={d.motivos.reduce((s, x) => s + x.total, 0)} cor="bg-red-500" />)}</div>}
            </Secao>
          </div>
          {d.por_area.length > 0 && (
            <Secao titulo="Por área" subtitulo="Contratos fechados e casos qualificados">
              <div className="grid gap-3 sm:grid-cols-3">{d.por_area.map((a) => <div key={a.chave} className="rounded-xl bg-zinc-50 p-3 dark:bg-white/5"><p className="text-xs text-zinc-500">{a.rotulo}</p><p className="text-xl font-semibold">{a.fecharam} <span className="text-sm font-normal text-zinc-500">· {a.qualificados} qualificados</span></p></div>)}</div>
            </Secao>
          )}
        </>
      )}

      {aba === "pendentes" && <Pendentes aoMudar={carregar} />}
      {aba === "fontes" && <Fontes aoMudar={carregar} />}
    </div>
  );
}
const Th = ({ children }: { children: string }) => <th className="px-2 py-2 text-right font-medium">{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-2 py-2 text-right tabular-nums">{children}</td>;

/** A tela rápida para preencher o negócio dos clientes que já fecharam: um clique por campo, salva sozinho. */
function Pendentes({ aoMudar }: { aoMudar: () => void }) {
  const { show } = useToast();
  const [itens, setItens] = useState<Pendente[] | null>(null);
  const [op, setOp] = useState<OpcoesDoNegocio | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const carregar = useCallback(async () => {
    try { const r = await api.get<{ itens: Pendente[] } & OpcoesDoNegocio>("/gestao/captacao/pendentes"); setItens(r.itens); setOp(r); } catch { show("Não foi possível carregar a lista.", "error"); }
  }, [show]);
  useEffect(() => { void carregar(); api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, [carregar]);
  const gravar = async (p: Pendente, mudanca: Record<string, unknown>) => {
    try { await api.put(`/gestao/pessoas/${p.pessoa_id}/negocio`, mudanca); setItens((l) => (l ?? []).map((x) => (x.pessoa_id === p.pessoa_id ? { ...x, ...mudanca } as Pendente : x))); aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
  };
  if (!itens || !op) return <p className="text-sm text-zinc-500">Carregando…</p>;
  if (itens.length === 0) return <div className="surface-panel p-8 text-center text-sm text-zinc-500">Tudo preenchido. Nenhum cliente com dados de captação faltando.</div>;
  return (
    <Secao titulo={`${itens.length} cliente(s) com dados faltando`} subtitulo="Escolha nas listas: cada mudança é salva na hora. Para marcar «não qualificado» com motivo, abra a ficha do cliente.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead><tr className="text-left text-xs text-zinc-500"><th className="py-2 pr-3 font-medium">Cliente</th><th className="px-2 py-2 font-medium">Fechou em</th><th className="px-2 py-2 font-medium">Fonte</th><th className="px-2 py-2 font-medium">Atendimento</th><th className="px-2 py-2 font-medium">Quem fechou</th><th className="px-2 py-2 font-medium">Qualificação</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-white/10">
            {itens.map((p) => (
              <tr key={p.pessoa_id}>
                <td className="py-2 pr-3"><Link to={`/gestao/clientes/${p.pessoa_id}?aba=negocio`} className="font-medium text-accent-700 hover:underline dark:text-accent-300">{p.nome}</Link></td>
                <td className="px-2 py-2 text-zinc-500">{dataBr(p.data_fechamento)}</td>
                <td className="px-2 py-2"><Select aria-label={`Fonte de ${p.nome}`} value={p.fonte} onChange={(e) => void gravar(p, { fonte: e.target.value })}><option value="">—</option>{op.fontes.map((f: Opcao) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}</Select></td>
                <td className="px-2 py-2"><Select aria-label={`Atendimento de ${p.nome}`} value={p.tipo_atendimento} onChange={(e) => void gravar(p, { tipo_atendimento: e.target.value })}><option value="">—</option><option value="presencial">Presencial</option><option value="online">Online</option></Select></td>
                <td className="px-2 py-2"><Select aria-label={`Quem fechou ${p.nome}`} value={p.fechado_por_user_id ?? ""} onChange={(e) => void gravar(p, { fechado_por_user_id: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{resp.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></td>
                <td className="px-2 py-2"><Select aria-label={`Qualificação de ${p.nome}`} value={p.qualificacao} onChange={(e) => void gravar(p, { qualificacao: e.target.value })}>{op.qualificacoes.filter((q) => q.chave !== "nao_qualificado").map((q) => <option key={q.chave} value={q.chave}>{q.rotulo}</option>)}</Select><Badge tone={TOM_DA_QUALIFICACAO[p.qualificacao] ?? "neutral"} className="mt-1">{op.qualificacoes.find((q) => q.chave === p.qualificacao)?.rotulo}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

/** As fontes padrão são fixas; aqui o escritório acrescenta as suas (rádio, parceria, evento…). */
function Fontes({ aoMudar }: { aoMudar: () => void }) {
  const { show } = useToast();
  const [op, setOp] = useState<OpcoesDoNegocio | null>(null);
  const [novo, setNovo] = useState("");
  const carregar = useCallback(async () => { try { setOp(await api.get<OpcoesDoNegocio>("/gestao/fontes")); } catch { show("Não foi possível carregar as fontes.", "error"); } }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const extras = (op?.fontes ?? []).filter((f) => f.chave.startsWith("custom_"));
  const salvar = async (rotulos: string[]) => {
    try { setOp(await api.put<OpcoesDoNegocio>("/gestao/fontes", { extras: rotulos })); aoMudar(); show("Fontes salvas.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
  };
  if (!op) return <p className="text-sm text-zinc-500">Carregando…</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Secao titulo="Fontes padrão" subtitulo="Já vêm no sistema. O atendimento reconhece sozinho a origem do lead.">
        <div className="flex flex-wrap gap-2">{op.fontes.filter((f) => !f.chave.startsWith("custom_")).map((f) => <Badge key={f.chave} tone="neutral">{f.rotulo}</Badge>)}</div>
      </Secao>
      <Secao titulo="Fontes do escritório" subtitulo="Acrescente as que você usa: rádio, parceria, evento…">
        <div className="flex gap-2"><Input value={novo} maxLength={40} onChange={(e) => setNovo(e.target.value)} placeholder="Nome da fonte" onKeyDown={(e) => { if (e.key === "Enter" && novo.trim()) { void salvar([...extras.map((x) => x.rotulo), novo.trim()]); setNovo(""); } }} /><Button variant="outline" disabled={!novo.trim()} onClick={() => { void salvar([...extras.map((x) => x.rotulo), novo.trim()]); setNovo(""); }}><Plus className="h-4 w-4" /> Adicionar</Button></div>
        <ul className="mt-3 divide-y divide-zinc-100 dark:divide-white/10">
          {extras.length === 0 && <li className="py-2 text-sm text-zinc-500">Nenhuma fonte própria ainda.</li>}
          {extras.map((f) => <li key={f.chave} className="flex items-center justify-between py-2 text-sm">{f.rotulo}<button type="button" aria-label={`Remover ${f.rotulo}`} className="topbar-icon !h-8 !w-8" onClick={() => void salvar(extras.filter((x) => x.chave !== f.chave).map((x) => x.rotulo))}><X className="h-4 w-4" /></button></li>)}
        </ul>
      </Secao>
    </div>
  );
}

export { TrendingUp };
