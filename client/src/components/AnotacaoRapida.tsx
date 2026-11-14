import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, PenLine, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { SeletorPessoa, type PessoaResumo } from "@/pages/gestao/comum";

interface ProcLigado { id: number; numero: string; pasta: string; titulo: string; status: string }

/** Anotação em três passos curtos, de qualquer tela: cliente, processo (opcional) e o texto. */
export function AnotacaoRapida({ aberto, aoFechar, pessoaInicial }: { aberto: boolean; aoFechar: () => void; pessoaInicial?: { id: number; nome: string } }) {
  const { show } = useToast();
  const [pessoa, setPessoa] = useState<{ id: number; nome: string } | null>(null);
  const [procs, setProcs] = useState<ProcLigado[] | null>(null);
  const [processoId, setProcessoId] = useState<number>(0);
  const [texto, setTexto] = useState("");
  const [importante, setImportante] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState<{ pessoaId: number; processoId: number } | null>(null);

  useEffect(() => { if (aberto) { setSalvo(null); setTexto(""); setImportante(false); setPessoa(pessoaInicial ?? null); } }, [aberto, pessoaInicial]);
  useEffect(() => {
    if (!pessoa) { setProcs(null); setProcessoId(0); return; }
    let ativo = true;
    setProcs(null);
    api.get<{ processos?: ProcLigado[] }>(`/gestao/pessoas/${pessoa.id}`, { fresh: true } as never)
      .then((r) => { if (!ativo) return; const l = (r.processos ?? []).filter((p) => p.status === "ativo"); setProcs(r.processos ?? []); setProcessoId(l.length === 1 ? l[0].id : 0); })
      .catch(() => { if (ativo) setProcs([]); });
    return () => { ativo = false; };
  }, [pessoa]);

  const salvar = async () => {
    if (!pessoa) return show("Escolha o cliente.", "info");
    if (texto.trim().length < 2) return show("Escreva a anotação.", "info");
    setSalvando(true);
    try {
      await api.post("/gestao/anotacao-rapida", { pessoa_id: pessoa.id, processo_id: processoId || undefined, texto, importante });
      setSalvo({ pessoaId: pessoa.id, processoId });
      setTexto(""); setImportante(false);
      show("Anotação salva.", "success");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar a anotação.", "error"); }
    finally { setSalvando(false); }
  };

  return (
    <Modal open={aberto} onClose={aoFechar} presentation="center" title="Nova anotação" description="Escolha o cliente, o processo (se houver) e escreva. Ctrl+Enter salva." maxWidth="max-w-xl"
      footer={salvo
        ? <div className="flex w-full flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => { setSalvo(null); setPessoa(null); }}>Anotar em outro cliente</Button><Button variant="outline" onClick={() => setSalvo(null)}>Mais uma neste cliente</Button><Link to={salvo.processoId ? `/gestao/processos/${salvo.processoId}` : `/gestao/clientes/${salvo.pessoaId}?aba=anotacoes`} onClick={aoFechar} className="inline-flex items-center rounded-xl bg-accent-600 px-4 py-2 text-sm font-medium text-white">Ver anotações</Link></div>
        : <div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={aoFechar}>Cancelar</Button><Button loading={salvando} onClick={() => void salvar()}><PenLine className="h-4 w-4" /> Salvar anotação</Button></div>}>
      {salvo ? <p className="text-sm text-zinc-600 dark:text-zinc-300">Anotação registrada para <b>{pessoa?.nome}</b>{salvo.processoId ? " no processo escolhido" : " no cadastro"}.</p> : (
        <div className="space-y-4 text-sm">
          {pessoa ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-700"><span className="font-semibold text-zinc-900 dark:text-zinc-100">{pessoa.nome}</span>{!pessoaInicial && <button type="button" className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Trocar cliente" onClick={() => setPessoa(null)}><X className="h-4 w-4" /></button>}</div>
          ) : <SeletorPessoa emLinha rotulo="Cliente" aoEscolher={(p: PessoaResumo) => setPessoa({ id: p.id, nome: p.nome })} />}
          {pessoa && (procs === null ? <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando os processos…</p> : (
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Anotar em</legend>
              <label className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"><input type="radio" name="destino" checked={processoId === 0} onChange={() => setProcessoId(0)} /> No cadastro do cliente (sem processo)</label>
              {procs.map((p) => <label key={p.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"><input type="radio" name="destino" checked={processoId === p.id} onChange={() => setProcessoId(p.id)} /> <span className="min-w-0 truncate">Processo {p.pasta} · {p.numero}{p.titulo ? ` — ${p.titulo}` : ""}</span></label>)}
            </fieldset>
          ))}
          {pessoa && <Textarea autoFocus rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void salvar(); }} placeholder="Escreva a anotação…" />}
          {pessoa && (
            <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 ${importante ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-zinc-200 dark:border-zinc-700"}`}>
              <Checkbox className="mt-0.5" checked={importante} onChange={(e) => setImportante(e.target.checked)} />
              <span><b className="text-zinc-900 dark:text-zinc-100">Importante</b><span className="block text-xs text-zinc-500">Avisa quem abrir este cliente (na ficha e no atendimento), até alguém dar como cumprido. Ex.: “preciso do documento deste cliente”.</span></span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}
