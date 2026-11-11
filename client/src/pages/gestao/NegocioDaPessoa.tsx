import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { Campo } from "./comum";
import type { Responsavel } from "./Processos";

export interface Opcao { chave: string; rotulo: string }
export interface Negocio {
  pessoa_id: number; fonte: string; fonte_detalhe: string; tipo_atendimento: "" | "presencial" | "online"; fechado_por_user_id: number | null; fechado_por: string | null;
  qualificacao: string; motivo: string; area: string; qualificado_por: string | null; qualificado_em: string | null; data_entrada: string; data_fechamento: string; observacoes: string;
}
export interface OpcoesDoNegocio { fontes: Opcao[]; motivos: Opcao[]; areas: Opcao[]; qualificacoes: Opcao[]; fontes_padrao: string[] }
const VAZIO: Negocio = { pessoa_id: 0, fonte: "", fonte_detalhe: "", tipo_atendimento: "", fechado_por_user_id: null, fechado_por: null, qualificacao: "nao_informada", motivo: "", area: "", qualificado_por: null, qualificado_em: null, data_entrada: "", data_fechamento: "", observacoes: "" };

export const TOM_DA_QUALIFICACAO: Record<string, "success" | "warning" | "danger" | "neutral"> = { qualificado: "success", aguardando: "warning", nao_qualificado: "danger", nao_informada: "neutral" };

/** A aba «Negócio» da ficha do cliente: de onde veio, quem fechou, como foi atendido e se o caso foi qualificado. Qualquer funcionário preenche. */
export function NegocioDaPessoa({ pessoaId }: { pessoaId: number }) {
  const { show } = useToast();
  const [n, setN] = useState<Negocio>(VAZIO);
  const [op, setOp] = useState<OpcoesDoNegocio | null>(null);
  const [resp, setResp] = useState<Responsavel[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [sujo, setSujo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<{ negocio: Negocio | null } & OpcoesDoNegocio>(`/gestao/pessoas/${pessoaId}/negocio`);
      setN(r.negocio ?? { ...VAZIO, pessoa_id: pessoaId }); setOp(r); setSujo(false);
    } catch { show("Não foi possível carregar o negócio do cliente.", "error"); }
  }, [pessoaId, show]);
  useEffect(() => { void carregar(); api.get<Responsavel[]>("/gestao/responsaveis").then(setResp).catch(() => undefined); }, [carregar]);

  const muda = (p: Partial<Negocio>) => { setN((x) => ({ ...x, ...p })); setSujo(true); };
  async function salvar() {
    setSalvando(true);
    try {
      const r = await api.put<{ negocio: Negocio }>(`/gestao/pessoas/${pessoaId}/negocio`, {
        fonte: n.fonte, fonte_detalhe: n.fonte_detalhe, tipo_atendimento: n.tipo_atendimento, fechado_por_user_id: n.fechado_por_user_id, qualificacao: n.qualificacao,
        motivo: n.motivo, area: n.area, data_entrada: n.data_entrada, data_fechamento: n.data_fechamento, observacoes: n.observacoes,
      });
      setN(r.negocio); setSujo(false); show("Negócio salvo.", "success");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  }
  if (!op) return <p className="text-sm text-zinc-500">Carregando…</p>;

  return (
    <div className="space-y-5">
      <div className="surface-panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-[15px] font-semibold text-zinc-900 dark:text-white">Negócio</h2><p className="text-xs text-zinc-500">De onde veio, quem fechou e se o caso foi qualificado. Alimenta a tela Captação e o Início.</p></div>
          <Badge tone={TOM_DA_QUALIFICACAO[n.qualificacao] ?? "neutral"}>{op.qualificacoes.find((q) => q.chave === n.qualificacao)?.rotulo ?? n.qualificacao}</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Fonte do lead"><Select value={n.fonte} onChange={(e) => muda({ fonte: e.target.value })}><option value="">Não informada</option>{op.fontes.map((f) => <option key={f.chave} value={f.chave}>{f.rotulo}</option>)}</Select></Campo>
          {(n.fonte === "outro" || n.fonte_detalhe) && <Campo rotulo="Detalhe da fonte"><Input value={n.fonte_detalhe} maxLength={120} onChange={(e) => muda({ fonte_detalhe: e.target.value })} placeholder="Ex.: palestra na OAB" /></Campo>}
          <Campo rotulo="Tipo de atendimento"><Select value={n.tipo_atendimento} onChange={(e) => muda({ tipo_atendimento: e.target.value as Negocio["tipo_atendimento"] })}><option value="">Não informado</option><option value="presencial">Presencial</option><option value="online">Online</option></Select></Campo>
          <Campo rotulo="Quem fechou"><Select value={n.fechado_por_user_id ?? ""} onChange={(e) => muda({ fechado_por_user_id: e.target.value ? Number(e.target.value) : null })}><option value="">Não informado</option>{resp.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}</Select></Campo>
          <Campo rotulo="Área"><Select value={n.area} onChange={(e) => muda({ area: e.target.value })}><option value="">Não informada</option>{op.areas.map((a) => <option key={a.chave} value={a.chave}>{a.rotulo}</option>)}</Select></Campo>
          <Campo rotulo="Data de entrada"><Input type="date" value={n.data_entrada} onChange={(e) => muda({ data_entrada: e.target.value })} /></Campo>
          <Campo rotulo="Data do fechamento"><Input type="date" value={n.data_fechamento} onChange={(e) => muda({ data_fechamento: e.target.value })} /></Campo>
        </div>
      </div>

      <div className="surface-panel p-5">
        <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-white">Qualificação do caso</h2>
        <p className="mb-4 text-xs text-zinc-500">Depois de analisar os documentos, marque se o caso é viável para ajuizar. A IA do atendimento nunca marca «qualificado».</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Qualificação do caso">
          {op.qualificacoes.map((q) => {
            const ativo = n.qualificacao === q.chave;
            const cor = q.chave === "qualificado" ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : q.chave === "nao_qualificado" ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" : q.chave === "aguardando" ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" : "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-200";
            return <button key={q.chave} type="button" role="radio" aria-checked={ativo} onClick={() => muda({ qualificacao: q.chave })} className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${ativo ? cor : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"}`}>{q.rotulo}</button>;
          })}
        </div>
        {n.qualificacao === "nao_qualificado" && (
          <div className="mt-4 max-w-sm"><Campo rotulo="Motivo (obrigatório)"><Select value={n.motivo} onChange={(e) => muda({ motivo: e.target.value })}><option value="">Escolha o motivo</option>{op.motivos.map((m) => <option key={m.chave} value={m.chave}>{m.rotulo}</option>)}</Select></Campo></div>
        )}
        {n.qualificado_por && <p className="mt-3 text-xs text-zinc-500">Decidido por <strong>{n.qualificado_por}</strong>{n.qualificado_em ? ` em ${new Date(n.qualificado_em).toLocaleDateString("pt-BR")}` : ""}.</p>}
        <div className="mt-4"><Campo rotulo="Observações"><Textarea rows={3} maxLength={1000} value={n.observacoes} onChange={(e) => muda({ observacoes: e.target.value })} /></Campo></div>
      </div>

      <div className="flex justify-end"><Button onClick={() => void salvar()} loading={salvando} disabled={!sujo}><Save className="h-4 w-4" /> Salvar negócio</Button></div>
    </div>
  );
}
