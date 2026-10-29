import { useEffect, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";

interface Example { id: number; publicacao_id: number; categoria: string; trecho: string; orientacao: string; created_at: string }
interface Publication { id: number; texto: string; categorias: string[]; revisada: number; processo: string; situacao: string }
const CATEGORIES = { sentenca: "Sentença", acordao: "Acórdão", pericia: "Perícia agendada", laudo_juntado: "Laudo juntado", rpv: "RPV", precatorio: "Precatório", proposta_acordo: "Proposta de acordo", homologacao_acordo: "Acordo homologado", extincao_execucao: "Extinção da execução", extincao_processo: "Extinção sem mérito", cumprimento_sentenca: "Cumprimento de sentença", levantamento_valores: "Levantamento de valores", decisao_interlocutoria: "Decisão interlocutória", despacho: "Despacho", intimacao: "Intimação", outros: "Outros" };

export function CodexTeaching() {
  const { show } = useToast();
  const [examples, setExamples] = useState<Example[]>([]);
  const [id, setId] = useState(() => new URLSearchParams(window.location.search).get("exemplo") || "");
  const [category, setCategory] = useState("pericia");
  const [quote, setQuote] = useState("");
  const [guidance, setGuidance] = useState("");
  const [busy, setBusy] = useState(false);
  const [publication, setPublication] = useState<Publication | null>(null);
  const [loadingPublication, setLoadingPublication] = useState(false);
  const [publicationError, setPublicationError] = useState("");
  const load = () => api.get<Example[]>("/djen/codex/exemplos").then(setExamples);
  useEffect(() => { void load().catch(() => show("Não foi possível carregar os exemplos de classificação.", "error")); }, []);
  useEffect(() => {
    const number = Number(id);
    setPublication(null);
    setPublicationError("");
    if (!Number.isSafeInteger(number) || number <= 0) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoadingPublication(true);
      void api.get<Publication>(`/djen/publicacoes/${number}`).then((item) => {
        if (!active) return;
        setPublication(item);
        setCategory(item.categorias[0] || "outros");
        setQuote("");
      }).catch((error) => {
        if (active) setPublicationError(error instanceof ApiError ? error.message : "Não foi possível abrir a publicação.");
      }).finally(() => { if (active) setLoadingPublication(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [id]);
  const validCategory = Boolean(publication?.revisada && (category === "outros" ? publication.categorias.length === 0 : publication.categorias.includes(category)));
  const validQuote = Boolean(publication?.texto.includes(quote.trim()) && quote.trim().length >= 20);
  function useSelection() {
    const selected = window.getSelection()?.toString().trim() || "";
    if (selected.length < 20 || selected.length > 800) { show("Selecione de 20 a 800 caracteres no texto da publicação.", "error"); return; }
    setQuote(selected);
  }
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
    <p className="text-xs leading-relaxed text-zinc-500">1. Abra uma publicação em Publicações e salve a revisão. 2. Use “Usar esta revisão como exemplo” para trazer o ID. 3. Selecione abaixo o trecho que comprova a categoria e explique o motivo. O exemplo orienta análises futuras; não altera publicações antigas automaticamente.</p>
    <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]"><div><Label htmlFor="example-id">ID da publicação revisada</Label><Input id="example-id" type="number" min="1" required value={id} onChange={(event) => setId(event.target.value)} /></div>
        <div><Label htmlFor="example-category">Categoria da revisão salva</Label><select id="example-category" className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" value={category} disabled={!publication?.revisada} onChange={(event) => setCategory(event.target.value)}>{publication?.revisada ? (publication.categorias.length ? publication.categorias : ["outros"]).map((key) => <option key={key} value={key}>{CATEGORIES[key as keyof typeof CATEGORIES] || key}</option>) : <option value={category}>Carregue uma publicação revisada</option>}</select></div></div>
      {loadingPublication && <p role="status" className="text-xs text-violet-600">Carregando publicação…</p>}
      {publicationError && <p role="alert" className="text-xs text-red-600">{publicationError}</p>}
      {publication && <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-xs dark:border-violet-900 dark:bg-violet-950/20"><strong>Publicação #{publication.id} · processo {publication.processo}</strong><p className="mt-1">{publication.situacao || "Sem assunto informado"}</p><p className="mt-1">{publication.revisada ? `Revisão salva: ${publication.categorias.length ? publication.categorias.map((key) => CATEGORIES[key as keyof typeof CATEGORIES] || key).join(", ") : "Outros"}` : "Esta publicação ainda não foi revisada. Abra o processo e clique em Salvar revisão."}</p></div>}
      {publication?.revisada ? <details className="rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-700" open><summary className="cursor-pointer font-semibold">Texto capturado · selecione a passagem que comprova a categoria</summary><p className="mt-2 text-zinc-500">Marque as palavras no texto e clique em “Usar trecho selecionado”. Isso evita diferenças de pontuação e espaçamento.</p><div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 leading-relaxed [overflow-wrap:anywhere] select-text dark:bg-zinc-800">{publication.texto}</div><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={useSelection} className="mt-3 rounded-xl border border-violet-300 px-3 py-2 font-medium text-violet-700 dark:text-violet-300">Usar trecho selecionado</button></details> : null}
      <div><Label htmlFor="example-quote">Trecho da publicação</Label><Textarea id="example-quote" required minLength={20} maxLength={800} rows={3} value={quote} onChange={(event) => setQuote(event.target.value)} placeholder="Selecione no texto acima para preencher automaticamente." />{quote && !validQuote && <p className="mt-1 text-xs text-amber-700">O trecho não coincide com esta publicação. Selecione as palavras diretamente no texto acima.</p>}</div>
      <div><Label htmlFor="example-guidance">Por que esta categoria se aplica?</Label><Textarea id="example-guidance" required minLength={10} maxLength={400} rows={2} value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Ex.: nova data confirmada e horário anterior mantido; conferir horário original antes de agendar." /></div>
      <Button type="submit" disabled={busy || !validCategory || !validQuote}>{busy ? "Salvando…" : "Adicionar exemplo"}</Button>
    </form>
    {!!examples.length && <div className="space-y-2"><h3 className="text-xs font-semibold">Exemplos aprovados ({examples.length})</h3>{examples.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-700"><div className="min-w-0"><strong>{CATEGORIES[item.categoria as keyof typeof CATEGORIES] || item.categoria} · publicação #{item.publicacao_id}</strong><p className="mt-1 line-clamp-2 text-zinc-600 dark:text-zinc-300">“{item.trecho}”</p><p className="mt-1 text-zinc-500">{item.orientacao}</p></div><button type="button" aria-label={`Remover exemplo ${item.id}`} className="rounded-lg p-2 text-red-600 hover:bg-red-50" onClick={() => { if (window.confirm("Remover este exemplo das próximas análises?")) void api.delete(`/djen/codex/exemplos/${item.id}`).then(load).catch(() => show("Não foi possível remover o exemplo.", "error")); }}><Trash2 className="h-4 w-4" /></button></div>)}</div>}
  </section>;
}
