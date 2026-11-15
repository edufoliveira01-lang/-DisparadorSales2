import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Textarea } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Campo, campoClasse, dataBr } from "./comum";

export interface PericiaInss { id: number; pessoa_id: number; pessoa_nome?: string; tipo: string; data: string; horario: string; agencia: string; protocolo: string; beneficio: string; status: string; resultado: string; observacoes: string; passada?: boolean }
interface Opcoes { tipos: Record<string, string>; status: Record<string, string>; resultados: Record<string, string> }
const TOM: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = { agendada: "info", realizada: "success", remarcada: "warning", faltou: "danger", cancelada: "neutral" };
const TOM_RESULTADO: Record<string, "success" | "danger" | "neutral"> = { favoravel: "success", desfavoravel: "danger", "": "neutral" };
const VAZIA = { tipo: "medica", data: "", horario: "", agencia: "", protocolo: "", beneficio: "", status: "agendada", resultado: "", observacoes: "" };

export function useOpcoesInss() {
  const [o, setO] = useState<Opcoes | null>(null);
  useEffect(() => { api.get<Opcoes>("/gestao/pericias-inss/opcoes").then(setO).catch(() => undefined); }, []);
  return o;
}

export function LinhaPericiaInss({ p, opcoes, acoes }: { p: PericiaInss; opcoes: Opcoes | null; acoes?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {dataBr(p.data)}{p.horario ? ` às ${p.horario}` : ""} · {opcoes?.tipos[p.tipo] ?? p.tipo}
          {p.pessoa_nome && <> · <Link to={`/gestao/clientes/${p.pessoa_id}?aba=pericia_inss`} className="underline-offset-2 hover:underline">{p.pessoa_nome}</Link></>}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">{[p.agencia, p.beneficio, p.protocolo && `protocolo ${p.protocolo}`].filter(Boolean).join(" · ") || "Sem agência/benefício informados"}</p>
        {p.observacoes && <p className="mt-0.5 text-xs text-zinc-500">{p.observacoes}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={TOM[p.status] ?? "neutral"}>{opcoes?.status[p.status] ?? p.status}</Badge>
        {p.status === "realizada" && <Badge tone={TOM_RESULTADO[p.resultado] ?? "neutral"}>{opcoes?.resultados[p.resultado] ?? "Aguardando"}</Badge>}
        {acoes}
      </div>
    </li>
  );
}

/** Perícia ADMINISTRATIVA (no INSS) do cliente: data, agência, protocolo, situação e resultado, com acesso rápido pela ficha e pela lista geral. */
export function PericiaInssDaPessoa({ pessoaId, gerir }: { pessoaId: number; gerir: boolean }) {
  const { show } = useToast();
  const opcoes = useOpcoesInss();
  const [lista, setLista] = useState<PericiaInss[] | null>(null);
  const [edit, setEdit] = useState<(typeof VAZIA & { id?: number }) | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [apagar, setApagar] = useState<PericiaInss | null>(null);

  const carregar = useCallback(async () => {
    try { setLista((await api.get<{ itens: PericiaInss[] }>(`/gestao/pessoas/${pessoaId}/pericias-inss`)).itens); }
    catch { show("Não foi possível carregar as perícias do INSS.", "error"); }
  }, [pessoaId, show]);
  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  async function salvar() {
    if (!edit) return;
    if (!edit.data) { show("Informe a data da perícia.", "error"); return; }
    setSalvando(true);
    try {
      const { id, ...corpo } = edit;
      const r = id ? await api.put<{ itens: PericiaInss[] }>(`/gestao/pessoas/${pessoaId}/pericias-inss/${id}`, corpo) : await api.post<{ itens: PericiaInss[] }>(`/gestao/pessoas/${pessoaId}/pericias-inss`, corpo);
      setLista(r.itens); setEdit(null); show("Perícia do INSS salva.", "success");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  }
  async function excluir() {
    const p = apagar; if (!p) return; setApagar(null);
    try { setLista((await api.delete<{ itens: PericiaInss[] }>(`/gestao/pessoas/${pessoaId}/pericias-inss/${p.id}`)).itens); show("Perícia removida.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível remover.", "error"); }
  }
  const set = (k: keyof typeof VAZIA, v: string) => setEdit((e) => (e ? { ...e, [k]: v } : e));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 surface-panel p-4">
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">Perícias e avaliações <b>feitas no INSS</b> (administrativas), separadas das judiciais. As próximas aparecem na lista geral “Perícias do INSS” e o atendimento por IA já responde com elas.</p>
        {gerir && !edit && <Button onClick={() => setEdit({ ...VAZIA })}><Plus className="h-4 w-4" /> Nova perícia do INSS</Button>}
      </div>

      {edit && (
        <div className="space-y-3 surface-panel p-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{edit.id ? "Editar perícia do INSS" : "Nova perícia do INSS"}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo rotulo="Tipo"><select className={campoClasse} value={edit.tipo} onChange={(e) => set("tipo", e.target.value)}>{Object.entries(opcoes?.tipos ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
            <Campo rotulo="Data"><Input type="date" value={edit.data} onChange={(e) => set("data", e.target.value)} className="mt-1.5" /></Campo>
            <Campo rotulo="Horário"><Input type="time" value={edit.horario} onChange={(e) => set("horario", e.target.value)} className="mt-1.5" /></Campo>
            <Campo rotulo="Agência / local" className="sm:col-span-2"><Input value={edit.agencia} onChange={(e) => set("agencia", e.target.value)} className="mt-1.5" placeholder="APS Santos — Av. Ana Costa, 123" maxLength={160} /></Campo>
            <Campo rotulo="Nº do protocolo/requerimento"><Input value={edit.protocolo} onChange={(e) => set("protocolo", e.target.value)} className="mt-1.5" maxLength={40} /></Campo>
            <Campo rotulo="Benefício" className="sm:col-span-3"><Input value={edit.beneficio} onChange={(e) => set("beneficio", e.target.value)} className="mt-1.5" placeholder="Auxílio por incapacidade temporária, BPC/LOAS…" maxLength={120} /></Campo>
            <Campo rotulo="Situação"><select className={campoClasse} value={edit.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(opcoes?.status ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
            <Campo rotulo="Resultado"><select className={campoClasse} value={edit.resultado} onChange={(e) => set("resultado", e.target.value)}>{Object.entries(opcoes?.resultados ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          </div>
          <Campo rotulo="Observações"><Textarea rows={2} value={edit.observacoes} onChange={(e) => set("observacoes", e.target.value)} className="mt-1.5" /></Campo>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={salvando} onClick={() => void salvar()}>Salvar</Button></div>
        </div>
      )}

      {lista === null ? <p className="text-sm text-zinc-500">Carregando…</p> : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhuma perícia do INSS registrada para este cliente.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
          {lista.map((p) => <LinhaPericiaInss key={p.id} p={p} opcoes={opcoes} acoes={gerir && <>
            <Button size="sm" variant="ghost" aria-label="Editar" onClick={() => setEdit({ ...p })}><Pencil className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => setApagar(p)}><Trash2 className="h-4 w-4" /></Button></>} />)}
        </ul>)}
      <ConfirmDialog open={Boolean(apagar)} title="Excluir perícia do INSS" message={`Excluir a perícia de ${apagar ? dataBr(apagar.data) : ""}? Não pode ser desfeito.`} confirmLabel="Excluir" onConfirm={() => void excluir()} onCancel={() => setApagar(null)} />
    </section>
  );
}
