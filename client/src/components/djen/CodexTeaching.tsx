import { useEffect, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";

interface Example { id: number; publicacao_id: number; categoria: string; trecho: string; orientacao: string; created_at: string }
const CATEGORIES = { sentenca: "Sentença", acordao: "Acórdão", pericia: "Perícia agendada", laudo_juntado: "Laudo juntado", rpv: "RPV", precatorio: "Precatório", proposta_acordo: "Proposta de acordo", homologacao_acordo: "Acordo homologado", extincao_execucao: "Extinção da execução", extincao_processo: "Extinção sem mérito", cumprimento_sentenca: "Cumprimento de sentença", levantamento_valores: "Levantamento de valores", decisao_interlocutoria: "Decisão interlocutória", despacho: "Despacho", intimacao: "Intimação", outros: "Outros" };

export function CodexTeaching() {
  const { show } = useToast();
  const [examples, setExamples] = useState<Example[]>([]);
  const [id, setId] = useState(() => new URLSearchParams(window.location.search).get("exemplo") || "");
  const [category, setCategory] = useState("pericia");
  const [quote, setQuote] = useState("");
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.get<Example[]>("/djen/codex/exemplos").then(setExamples);
  useEffect(() => { void load().catch(() => show("Não foi possível carregar os exemplos de classificação.", "error")); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      await api.post("/djen/codex/exemplos", { publicacao_id: Number(id), categoria: category, trecho: quote, orientacao: guidance });
      await load(); setQuote(""); setGuidance(""); show("Exemplo aprovado para orientar as próximas análises.", "success");
    } catch (error) { show(error instanceof ApiError ? error.message : "Não foi possível salvar o exemplo.", "error"); }
    finally { setBusy(false); }
  }
  return <section className="surface-panel space-y-4 p-5">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-600" /> Ensinar a classificação ao Codex</h2>
    <p className="text-xs leading-relaxed text-zinc-500">Exemplos aprovados pelo administrador orientam análises futuras. Primeiro revise a publicação em Publicações; depois copie um trecho literal do texto e explique a categoria. As regras de evidência continuam obrigatórias. Para registros antigos sem revisão, use “Reanalisar publicações” acima.</p>
    <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]"><div><Label htmlFor="example-id">ID da publicação revisada</Label><Input id="example-id" type="number" min="1" required value={id} onChange={(event) => setId(event.target.value)} /></div>
        <div><Label htmlFor="example-category">Categoria confirmada</Label><select id="example-category" className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
      <div><Label htmlFor="example-quote">Trecho literal da publicação</Label><Textarea id="example-quote" required minLength={20} maxLength={800} rows={3} value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Copie exatamente o trecho que comprova a categoria." /></div>
      <div><Label htmlFor="example-guidance">Por que esta categoria se aplica?</Label><Textarea id="example-guidance" required minLength={10} maxLength={400} rows={2} value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Ex.: nova data confirmada e horário anterior mantido; conferir horário original antes de agendar." /></div>
      <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Adicionar exemplo"}</Button>
    </form>
    {!!examples.length && <div className="space-y-2"><h3 className="text-xs font-semibold">Exemplos aprovados ({examples.length})</h3>{examples.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-700"><div className="min-w-0"><strong>{CATEGORIES[item.categoria as keyof typeof CATEGORIES] || item.categoria} · publicação #{item.publicacao_id}</strong><p className="mt-1 line-clamp-2 text-zinc-600 dark:text-zinc-300">“{item.trecho}”</p><p className="mt-1 text-zinc-500">{item.orientacao}</p></div><button type="button" aria-label={`Remover exemplo ${item.id}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { if (window.confirm("Remover este exemplo das próximas análises?")) void api.delete(`/djen/codex/exemplos/${item.id}`).then(load).catch(() => show("Não foi possível remover o exemplo.", "error")); }}><Trash2 className="h-4 w-4" /></button></div>)}</div>}
  </section>;
}
