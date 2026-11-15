import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Link2, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Campo, SeletorPessoa, campoClasse, type PessoaResumo } from "./comum";

interface Vinculo { id: number; tipo: string; direcao: "direto" | "inverso"; rotulo: string; observacao: string; outra_id: number; outra_nome: string; processos_da_outra: number; herda_processos: boolean }
interface Tipo { chave: string; rotulo: string; herda: boolean }

/** Vínculos entre cadastros: herdeiro de, representante legal de, cônjuge… O herdeiro passa a acompanhar também os processos do outro. */
export function Vinculos({ pessoaId, nome, gerir }: { pessoaId: number; nome: string; gerir: boolean }) {
  const { show } = useToast();
  const [lista, setLista] = useState<Vinculo[] | null>(null);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [novo, setNovo] = useState(false);
  const [outra, setOutra] = useState<PessoaResumo | null>(null);
  const [tipo, setTipo] = useState("herdeiro");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [remover, setRemover] = useState<Vinculo | null>(null);

  const carregar = useCallback(async () => {
    try { setLista((await api.get<{ vinculos: Vinculo[] }>(`/gestao/pessoas/${pessoaId}/vinculos`)).vinculos); }
    catch { show("Não foi possível carregar os vínculos.", "error"); }
  }, [pessoaId, show]);
  useEffect(() => { setLista(null); void carregar(); }, [carregar]);
  useEffect(() => { api.get<{ tipos: Tipo[] }>("/gestao/vinculos/tipos").then((r) => setTipos(r.tipos)).catch(() => undefined); }, []);

  async function salvar() {
    if (!outra) { show("Escolha o cliente a vincular.", "error"); return; }
    setSalvando(true);
    try {
      const r = await api.post<{ vinculos: Vinculo[] }>(`/gestao/pessoas/${pessoaId}/vinculos`, { relacionada_id: outra.id, tipo, observacao: obs });
      setLista(r.vinculos); setNovo(false); setOutra(null); setObs(""); show("Vínculo criado.", "success");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível vincular.", "error"); }
    finally { setSalvando(false); }
  }
  async function excluir() {
    const v = remover; if (!v) return; setRemover(null);
    try { setLista((await api.delete<{ vinculos: Vinculo[] }>(`/gestao/pessoas/${pessoaId}/vinculos/${v.id}`)).vinculos); show("Vínculo removido.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível remover.", "error"); }
  }
  const atual = tipos.find((t) => t.chave === tipo);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 surface-panel p-4">
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">Ligue este cadastro a outro: por exemplo, <b>herdeiro</b> de um cliente falecido, <b>representante legal</b> ou cônjuge. O herdeiro e o representante passam a acompanhar também os processos do outro, e a ficha dos dois mostra o vínculo.</p>
        {gerir && !novo && <Button onClick={() => setNovo(true)}><Plus className="h-4 w-4" /> Vincular a outro cliente</Button>}
      </div>

      {novo && (
        <div className="space-y-3 surface-panel p-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Novo vínculo</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo={`${nome.split(" ")[0]} é…`}>
              <select className={campoClasse} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {tipos.map((t) => <option key={t.chave} value={t.chave}>{t.rotulo}</option>)}
              </select>
            </Campo>
            <div>
              <SeletorPessoa rotulo="…do cliente" tipo="cliente" aoEscolher={(p) => setOutra(p)} />
              {outra && <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-200">Escolhido: <b>{outra.nome}</b></p>}
            </div>
          </div>
          <Campo rotulo="Observação (opcional)"><Input value={obs} onChange={(e) => setObs(e.target.value)} className="mt-1.5" placeholder="Ex.: filho; habilitação no inventário em andamento" maxLength={500} /></Campo>
          {atual?.herda && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">Com esse vínculo, {nome.split(" ")[0]} passa a ver os processos e perícias de {outra?.nome ?? "o outro cliente"} (inclusive nas respostas do atendimento por IA). O contrário não acontece.</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setNovo(false); setOutra(null); }}>Cancelar</Button><Button loading={salvando} onClick={() => void salvar()}>Salvar vínculo</Button></div>
        </div>
      )}

      {lista === null ? <p className="text-sm text-zinc-500">Carregando…</p> : lista.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhum vínculo com outros cadastros.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 overflow-hidden surface-panel dark:divide-zinc-800">
          {lista.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-zinc-900 dark:text-zinc-100"><Link2 className="mr-1.5 inline h-4 w-4 text-zinc-400" />{v.rotulo} <Link to={`/gestao/clientes/${v.outra_id}`} className="font-semibold underline-offset-2 hover:underline">{v.outra_nome}</Link></p>
                {v.observacao && <p className="mt-0.5 text-xs text-zinc-500">{v.observacao}</p>}
                {v.herda_processos && <p className="mt-0.5 text-xs text-zinc-500">{v.processos_da_outra > 0 ? `Acompanha ${v.processos_da_outra} processo(s) de ${v.outra_nome.split(" ")[0]}.` : `${v.outra_nome.split(" ")[0]} ainda não tem processo cadastrado.`}</p>}
              </div>
              <div className="flex items-center gap-2">
                {v.herda_processos && <Badge tone="info">Acompanha os casos</Badge>}
                {gerir && <Button size="sm" variant="ghost" aria-label="Remover vínculo" onClick={() => setRemover(v)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </li>))}
        </ul>)}
      <ConfirmDialog open={Boolean(remover)} title="Remover vínculo" message={`Remover o vínculo "${remover?.rotulo} ${remover?.outra_nome}"? Os cadastros e processos continuam; só deixam de estar ligados.`} confirmLabel="Remover" onConfirm={() => void excluir()} onCancel={() => setRemover(null)} />
    </section>
  );
}
