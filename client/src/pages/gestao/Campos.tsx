import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, Plus, Settings2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Campo } from "./comum";

export interface CampoValor { id: number; nome: string; tipo: string; opcoes: string[]; grupo: string; valor: string; preenchido: boolean; imprimir: boolean }
interface Def { id: number; entidade: string; nome: string; tipo: string; opcoes: string[]; grupo: string; ordem: number; ativo: boolean; imprimir: boolean }
type Entidade = "pessoa" | "processo";
export const TIPOS: Record<string, string> = { texto: "Texto curto", texto_longo: "Texto longo", numero: "Número", moeda: "Valor em reais", data: "Data", sim_nao: "Sim ou não", lista: "Lista de opções", senha: "Senha (guardada com criptografia)", link: "Link (site)", telefone: "Telefone", email: "E-mail" };

/** Campos criados pelo próprio escritório para o cadastro (ex.: senha do GOV, nº do benefício). */
export function CamposPersonalizados({ campos, valores, aoMudar, entidade, entidadeId, aoAtualizarDefinicoes, somenteLeitura }: {
  campos: CampoValor[]; valores: Record<number, string>; aoMudar: (id: number, v: string) => void; entidade: Entidade; entidadeId: number; aoAtualizarDefinicoes: () => void; somenteLeitura?: boolean;
}) {
  const { can } = useAuth();
  const [gerenciar, setGerenciar] = useState(false);
  const grupos = campos.reduce<Record<string, CampoValor[]>>((a, c) => { (a[c.grupo || "Campos personalizados"] ||= []).push(c); return a; }, {});
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Campos personalizados</h3>
        {can("gestao.manage") && <Button type="button" size="sm" variant="outline" onClick={() => setGerenciar(true)}><Settings2 className="h-4 w-4" /> Criar e organizar campos</Button>}
      </div>
      {campos.length === 0 ? <p className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700">Nenhum campo personalizado ainda. Crie o que o seu escritório precisa guardar: senha do GOV, número do benefício, data de admissão…</p> : (
        Object.entries(grupos).map(([nome, lista]) => (
          <div key={nome}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{nome}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {lista.map((c) => <EntradaCampo key={c.id} c={c} valor={valores[c.id]} aoMudar={(v) => aoMudar(c.id, v)} entidadeId={entidadeId} somenteLeitura={somenteLeitura} />)}
            </div>
          </div>))
      )}
      {gerenciar && <GerenciarCampos entidade={entidade} aoFechar={() => { setGerenciar(false); aoAtualizarDefinicoes(); }} />}
    </section>
  );
}

function EntradaCampo({ c, valor, aoMudar, entidadeId, somenteLeitura }: { c: CampoValor; valor: string | undefined; aoMudar: (v: string) => void; entidadeId: number; somenteLeitura?: boolean }) {
  const v = valor ?? c.valor;
  const cls = "mt-1.5";
  const rotulo = <span className="flex items-center gap-1">{c.tipo === "senha" && <KeyRound className="h-3 w-3" />}{c.nome}</span>;
  if (c.tipo === "senha") return <Senha c={c} novo={valor} aoMudar={aoMudar} entidadeId={entidadeId} rotulo={rotulo} somenteLeitura={somenteLeitura} />;
  const comum = { disabled: somenteLeitura, className: cls };
  return (
    <Campo rotulo="" className={c.tipo === "texto_longo" ? "sm:col-span-2" : ""}>
      {rotulo}
      {c.tipo === "texto_longo" ? <Textarea rows={3} value={v} onChange={(e) => aoMudar(e.target.value)} {...comum} />
        : c.tipo === "sim_nao" ? <Select value={v} onChange={(e) => aoMudar(e.target.value)} {...comum}><option value="">—</option><option value="sim">Sim</option><option value="nao">Não</option></Select>
        : c.tipo === "lista" ? <Select value={v} onChange={(e) => aoMudar(e.target.value)} {...comum}><option value="">—</option>{c.opcoes.map((o) => <option key={o}>{o}</option>)}</Select>
        : c.tipo === "data" ? <Input type="date" value={v} onChange={(e) => aoMudar(e.target.value)} {...comum} />
        : c.tipo === "numero" ? <Input inputMode="decimal" value={v} onChange={(e) => aoMudar(e.target.value)} {...comum} />
        : c.tipo === "moeda" ? <Input inputMode="decimal" placeholder="0,00" value={v && /^\d+\.\d{2}$/.test(v) ? v.replace(".", ",") : v} onChange={(e) => aoMudar(e.target.value)} {...comum} />
        : c.tipo === "link" ? <div className="flex gap-2"><Input type="url" value={v} onChange={(e) => aoMudar(e.target.value)} {...comum} />{v && <a href={v} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center rounded-xl border border-zinc-200 px-3 text-xs text-accent-700 dark:border-zinc-700">Abrir</a>}</div>
        : <Input type={c.tipo === "email" ? "email" : c.tipo === "telefone" ? "tel" : "text"} value={v} onChange={(e) => aoMudar(e.target.value)} {...comum} />}
    </Campo>
  );
}

/** Senha: guardada criptografada; só aparece quando alguém pede para ver (o pedido fica registrado). */
function Senha({ c, novo, aoMudar, entidadeId, rotulo, somenteLeitura }: { c: CampoValor; novo: string | undefined; aoMudar: (v: string) => void; entidadeId: number; rotulo: React.ReactNode; somenteLeitura?: boolean }) {
  const { show } = useToast();
  const { can } = useAuth();
  const [revelada, setRevelada] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const digitando = novo !== undefined;
  const revelar = async () => {
    if (revelada !== null) { setRevelada(null); return; }
    try { const r = await api.post<{ valor: string }>(`/gestao/campos/${c.id}/revelar/${entidadeId}`, {}); setRevelada(r.valor); setTimeout(() => setRevelada(null), 30_000); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível mostrar a senha.", "error"); }
  };
  const copiar = async () => {
    try { const v = revelada ?? (await api.post<{ valor: string }>(`/gestao/campos/${c.id}/revelar/${entidadeId}`, {})).valor; await navigator.clipboard.writeText(v); show("Senha copiada.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível copiar.", "error"); }
  };
  return (
    <Campo rotulo="">
      {rotulo}
      {digitando || !c.preenchido ? (
        <div className="flex gap-2">
          <Input type={mostrar ? "text" : "password"} autoComplete="new-password" value={novo ?? ""} onChange={(e) => aoMudar(e.target.value)} disabled={somenteLeitura || !can("gestao.manage")} className="mt-1.5" placeholder={c.preenchido ? "Nova senha (deixe vazio para manter)" : "Digite a senha"} />
          <button type="button" aria-label={mostrar ? "Ocultar" : "Mostrar"} className="mt-1.5 rounded-xl border border-zinc-200 px-3 text-zinc-500 dark:border-zinc-700" onClick={() => setMostrar((m) => !m)}>{mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex h-11 flex-1 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 font-mono text-[13px] dark:border-zinc-700 dark:bg-zinc-900">{revelada ?? "••••••••••"}</div>
          {can("gestao.manage") && <>
            <button type="button" aria-label={revelada !== null ? "Ocultar senha" : "Mostrar senha"} title="Mostrar (fica registrado)" className="rounded-xl border border-zinc-200 p-3 text-zinc-500 dark:border-zinc-700" onClick={() => void revelar()}>{revelada !== null ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
            <button type="button" aria-label="Copiar senha" title="Copiar" className="rounded-xl border border-zinc-200 p-3 text-zinc-500 dark:border-zinc-700" onClick={() => void copiar()}><Copy className="h-4 w-4" /></button>
            {!somenteLeitura && <Button type="button" size="sm" variant="ghost" onClick={() => aoMudar("")}>Trocar</Button>}
          </>}
        </div>
      )}
    </Campo>
  );
}

export function GerenciarCampos({ entidade, aoFechar }: { entidade: Entidade; aoFechar: () => void }) {
  const { show } = useToast();
  const [lista, setLista] = useState<Def[]>([]);
  const [novo, setNovo] = useState({ nome: "", tipo: "texto", grupo: "", opcoes: "" });
  const [editando, setEditando] = useState<Def | null>(null);
  const [apagar, setApagar] = useState<Def | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(async () => { try { setLista((await api.get<{ campos: Def[] }>(`/gestao/campos?entidade=${entidade}&inativos=1`, { fresh: true } as never)).campos); } catch { show("Não foi possível carregar os campos.", "error"); } }, [entidade, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const erro = (e: unknown) => show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error");
  const criar = async (ev: React.FormEvent) => {
    ev.preventDefault(); ev.stopPropagation(); setOcupado(true);
    try { await api.post("/gestao/campos", { entidade, ...novo, opcoes: novo.tipo === "lista" ? novo.opcoes.split(/[\n;]/) : [] }); setNovo({ nome: "", tipo: "texto", grupo: novo.grupo, opcoes: "" }); await carregar(); show("Campo criado.", "success"); }
    catch (e) { erro(e); } finally { setOcupado(false); }
  };
  const salvarEdicao = async () => {
    if (!editando) return;
    try { await api.put(`/gestao/campos/${editando.id}`, { nome: editando.nome, grupo: editando.grupo, ativo: editando.ativo, imprimir: editando.imprimir, opcoes: editando.opcoes }); setEditando(null); await carregar(); }
    catch (e) { erro(e); }
  };
  const previdenciarios = async () => { try { const r = await api.post<{ criados: number }>("/gestao/campos/previdenciarios", {}); show(r.criados ? `${r.criados} campo(s) da ficha previdenciária adicionados.` : "Os campos previdenciários já existem.", "success"); await carregar(); } catch (e) { erro(e); } };
  const excluir = async () => { if (!apagar) return; try { await api.delete(`/gestao/campos/${apagar.id}`); setApagar(null); await carregar(); show("Campo apagado.", "success"); } catch (e) { erro(e); setApagar(null); } };
  return (
    <Modal open onClose={aoFechar} title="Campos personalizados" description={entidade === "pessoa" ? "Aparecem no cadastro de todas as pessoas e na ficha impressa." : "Aparecem na ficha de todos os processos."} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <form onSubmit={criar} className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Novo campo</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Nome do campo *"><Input required value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} className="mt-1.5" placeholder="Ex.: Senha GOV" /></Campo>
            <Campo rotulo="Tipo de campo"><Select value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value })} className="mt-1.5">{Object.entries(TIPOS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}</Select></Campo>
            <Campo rotulo="Grupo (seção onde aparece)"><Input value={novo.grupo} onChange={(e) => setNovo({ ...novo, grupo: e.target.value })} className="mt-1.5" placeholder="Ex.: Acessos" /></Campo>
            {novo.tipo === "lista" && <Campo rotulo="Opções (uma por linha) *" className="sm:col-span-2"><Textarea required rows={3} value={novo.opcoes} onChange={(e) => setNovo({ ...novo, opcoes: e.target.value })} className="mt-1.5" /></Campo>}
          </div>
          <div className="flex justify-end"><Button type="submit" loading={ocupado}><Plus className="h-4 w-4" /> Criar campo</Button></div>
        </form>
        {entidade === "pessoa" && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-50/60 px-4 py-3 text-sm dark:bg-accent-950/30"><span>Trabalha com previdenciário? Adicione de uma vez os campos da <b>ficha processual</b> (serviço, indicação, seguridade, última contribuição, vínculo, CNPJ, UDT, Meu INSS…).</span><Button type="button" size="sm" variant="outline" onClick={() => void previdenciarios()}>Adicionar campos previdenciários</Button></div>}
        <div>
          <p className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Campos existentes ({lista.length})</p>
          {lista.length === 0 ? <p className="text-sm text-zinc-500">Nenhum ainda.</p> : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
              {lista.map((d) => (
                <li key={d.id} className="px-4 py-2.5">
                  {editando?.id === d.id ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2"><Input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} aria-label="Nome" /><Input value={editando.grupo} onChange={(e) => setEditando({ ...editando, grupo: e.target.value })} placeholder="Grupo" aria-label="Grupo" /></div>
                      {editando.tipo === "lista" && <Textarea rows={3} value={editando.opcoes.join("\n")} onChange={(e) => setEditando({ ...editando, opcoes: e.target.value.split("\n") })} aria-label="Opções" />}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="flex gap-4"><label className="flex items-center gap-1.5"><input type="checkbox" checked={editando.ativo} onChange={(e) => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo</label><label className="flex items-center gap-1.5"><input type="checkbox" checked={editando.imprimir} onChange={(e) => setEditando({ ...editando, imprimir: e.target.checked })} /> Sai na ficha impressa</label></span><span className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="button" size="sm" onClick={() => void salvarEdicao()}>Salvar</Button></span></div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className={`truncate text-sm font-medium ${d.ativo ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400 line-through"}`}>{d.nome}</p><p className="truncate text-xs text-zinc-500">{TIPOS[d.tipo]}{d.grupo ? ` · ${d.grupo}` : ""}{d.imprimir ? "" : " · não imprime"}</p></div>
                      <div className="flex shrink-0 gap-1"><Button type="button" size="sm" variant="ghost" onClick={() => setEditando(d)}>Editar</Button><button type="button" aria-label={`Apagar ${d.nome}`} className="rounded-lg p-2 text-zinc-400 hover:text-red-600" onClick={() => setApagar(d)}><Trash2 className="h-4 w-4" /></button></div>
                    </div>)}
                </li>))}
            </ul>)}
          <p className="mt-2 text-xs text-zinc-500">O tipo não muda depois de criado. Para trocar, crie um campo novo. Desmarque “Ativo” para esconder um campo sem perder o que já foi preenchido.</p>
        </div>
      </div>
      <ConfirmDialog open={Boolean(apagar)} title="Apagar campo" message={`Apagar o campo "${apagar?.nome}" e tudo o que foi preenchido nele em todos os cadastros? Não pode ser desfeito. Para só esconder, use "Ativo".`} confirmLabel="Apagar" onConfirm={() => void excluir()} onCancel={() => setApagar(null)} />
    </Modal>
  );
}
