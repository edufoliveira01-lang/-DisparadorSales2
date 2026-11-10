import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Cloud, Copy, FolderCog, FolderSearch, FolderSync, RefreshCw, Send, Unplug } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";

interface Candidata { id: string; nome: string; caminho: string; nota: number }
interface ItemRecente { id: number; status: "pendente" | "aguardando_pasta" | "enviado" | "erro"; titulo: string; tipo_pasta: string; caminho_final: string; ultimo_erro: string; tentativas: number; cliente: string | null }
interface Estado {
  credenciais_salvas: boolean; app_key_final: string; conectado: boolean; conectado_em: string | null; redirect_uri: string; pasta_raiz: string; pastas: { raiz: string; tipos: Array<{ chave: string; nome: string }> };
  conta: { nome: string; email: string; tipo: string; equipe: boolean } | null;
  fila: { pendente: number; aguardando_pasta: number; enviado: number; erro: number; recentes: ItemRecente[] };
}
interface Pendencia { pessoa_id: number; nome: string; documentos: number; candidatas: Candidata[] }
interface Sugestao { pessoa_id: number; nome: string; resultado: "exato" | "parecido" | "nenhum"; pasta?: { id: string; nome: string; caminho: string }; candidatas?: Candidata[] }

const ROTULO_DO_STATUS: Record<ItemRecente["status"], { texto: string; tom: "success" | "warning" | "danger" | "info" }> = {
  enviado: { texto: "Enviado", tom: "success" },
  pendente: { texto: "Na fila", tom: "info" },
  aguardando_pasta: { texto: "Escolher pasta", tom: "warning" },
  erro: { texto: "Erro", tom: "danger" },
};
const TIPO_DE_CONTA: Record<string, string> = { basic: "Dropbox Basic", pro: "Dropbox Plus/Professional", business: "Dropbox Business" };
const mensagemDe = (e: unknown, padrao: string) => (e instanceof ApiError || e instanceof Error ? e.message : padrao);

/** Armazenamento externo (Dropbox): conectar, acompanhar os envios e escolher as pastas dos clientes. */
export function ArmazenamentoSettings() {
  const { show } = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [confirmarDesconectar, setConfirmarDesconectar] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [raiz, setRaiz] = useState("");
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [salvandoPastas, setSalvandoPastas] = useState(false);
  const [sugestoes, setSugestoes] = useState<{ total_de_pastas: number; sugestoes: Sugestao[] } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([api.get<Estado>("/armazenamento/dropbox", { fresh: true }), api.get<{ pendencias: Pendencia[] }>("/armazenamento/pendencias", { fresh: true })]);
      setEstado(e); setPendencias(p.pendencias);
      setRaiz(e.pastas.raiz); setNomes(Object.fromEntries(e.pastas.tipos.map((t) => [t.chave, t.nome])));
    } catch (e) { show(mensagemDe(e, "Não foi possível carregar o Dropbox."), "error"); }
  }, [show]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultado = params.get("dropbox");
    if (resultado === "connected") show("Dropbox conectado. Os documentos assinados passam a ser copiados para a pasta CLIENTES.", "success");
    if (resultado === "error") show(params.get("message") || "Não foi possível conectar o Dropbox.", "error");
    if (resultado) {
      params.delete("dropbox"); params.delete("message");
      const q = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    void carregar();
  }, [carregar, show]);

  async function salvarCredenciais() {
    setSalvando(true);
    try {
      await api.put("/armazenamento/dropbox/credenciais", { appKey, appSecret });
      setAppSecret("");
      show("Dados do app salvos. Agora clique em Conectar ao Dropbox.", "success");
      await carregar();
    } catch (e) { show(mensagemDe(e, "Não foi possível salvar."), "error"); } finally { setSalvando(false); }
  }

  async function salvarPastas() {
    setSalvandoPastas(true);
    try {
      const r = await api.put<{ vinculos_removidos: number }>("/armazenamento/dropbox/pastas", { raiz, tipos: nomes });
      show(r.vinculos_removidos > 0
        ? `Pastas salvas. ${r.vinculos_removidos} vínculo(s) de cliente foram desfeitos porque a pasta-raiz mudou; o sistema procura de novo pelo nome.`
        : "Pastas salvas. Valem para os próximos documentos.", "success");
      await carregar();
    } catch (e) { show(mensagemDe(e, "Não foi possível salvar as pastas."), "error"); } finally { setSalvandoPastas(false); }
  }

  async function acaoAssinados() {
    setOcupado("assinados");
    try {
      const r = await api.post<{ enfileirados: number }>("/armazenamento/enfileirar-assinados");
      show(r.enfileirados > 0 ? `${r.enfileirados} documento(s) assinado(s) entraram na fila e estão sendo enviados.` : "Não há documentos assinados pendentes de cópia.", "success");
      await carregar();
    } catch (e) { show(mensagemDe(e, "Não foi possível enfileirar os documentos."), "error"); } finally { setOcupado(null); }
  }

  async function acao(chave: string, fn: () => Promise<unknown>, sucesso: string) {
    setOcupado(chave);
    try { await fn(); show(sucesso, "success"); await carregar(); }
    catch (e) { show(mensagemDe(e, "Não foi possível concluir."), "error"); }
    finally { setOcupado(null); }
  }

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); show("Endereço copiado.", "success"); } catch { show("Copie manualmente o endereço.", "error"); }
  };

  async function procurarCorrespondencias() {
    setOcupado("sugestoes");
    try { setSugestoes(await api.get("/armazenamento/sugestoes", { fresh: true })); }
    catch (e) { show(mensagemDe(e, "Não foi possível ler as pastas do Dropbox."), "error"); }
    finally { setOcupado(null); }
  }
  async function vincularLote(itens: Array<{ pessoa_id: number; pasta_id: string }>) {
    setOcupado("lote");
    let feitos = 0;
    try { for (const i of itens) { await api.post("/armazenamento/vincular", i); feitos++; } show(`${feitos} cliente(s) vinculado(s).`, "success"); }
    catch (e) { show(`${mensagemDe(e, "Falhou")} (${feitos} vinculado(s) antes do erro).`, "error"); }
    finally { setOcupado(null); await carregar(); await procurarCorrespondencias(); }
  }

  if (!estado) return <p className="text-sm text-zinc-500">Carregando…</p>;
  const idem = sugestoes?.sugestoes.filter((s) => s.resultado === "exato") ?? [];
  const parecidas = sugestoes?.sugestoes.filter((s) => s.resultado === "parecido") ?? [];
  const semPasta = sugestoes?.sugestoes.filter((s) => s.resultado === "nenhum") ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Cloud className="h-4 w-4 text-sky-500" /> Dropbox — documentos dos clientes</CardTitle>
          {estado.conectado
            ? <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado{estado.conta?.nome ? ` · ${estado.conta.nome}` : ""}</Badge>
            : <Badge tone="warning">Não conectado</Badge>}
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
          <p>
            Os documentos assinados no ZapSign são copiados para <strong>{estado.pasta_raiz}/NOME DO CLIENTE/{estado.pastas.tipos.find((t) => t.chave === "CONTRATOS E PROCURAÇÕES")?.nome}</strong> no Dropbox do escritório.
            O sistema só grava dentro de <strong>{estado.pasta_raiz}</strong>.
          </p>
          {estado.conta && (
            <p className="text-xs text-zinc-500">
              Conta: {estado.conta.email} · {TIPO_DE_CONTA[estado.conta.tipo] ?? estado.conta.tipo}{estado.conta.equipe ? " (espaço de equipe)" : ""}
            </p>
          )}

          <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">1. Dados do app do Dropbox</p>
            <p className="text-xs text-zinc-500">
              Crie o app em dropbox.com/developers/apps (Scoped access › Full Dropbox) com as permissões files.metadata.read, files.metadata.write, files.content.read e files.content.write.
              No app, em <em>OAuth 2 › Redirect URIs</em>, cadastre exatamente este endereço:
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">{estado.redirect_uri}</code>
              <Button variant="outline" size="sm" onClick={() => void copiar(estado.redirect_uri)}><Copy className="h-3.5 w-3.5" /> Copiar</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="dbx-key">App key</Label><Input id="dbx-key" value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder={estado.credenciais_salvas ? `Salva (${estado.app_key_final})` : "App key"} autoComplete="off" /></div>
              <div><Label htmlFor="dbx-secret">App secret</Label><Input id="dbx-secret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={estado.credenciais_salvas ? "Salva (deixe em branco para manter)" : "App secret"} autoComplete="new-password" /></div>
            </div>
            <Button onClick={() => void salvarCredenciais()} loading={salvando} disabled={!estado.credenciais_salvas && (!appKey || !appSecret)}>Salvar dados do app</Button>
          </div>

          <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="font-medium text-zinc-800 dark:text-zinc-100">2. Conexão</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!estado.credenciais_salvas} onClick={() => { window.location.href = "/api/armazenamento/dropbox/conectar"; }}>
                <Cloud className="h-4 w-4" /> {estado.conectado ? "Reconectar ao Dropbox" : "Conectar ao Dropbox"}
              </Button>
              {estado.conectado && (
                <>
                  <Button variant="outline" loading={ocupado === "testar"} onClick={() => void acao("testar", () => api.post("/armazenamento/dropbox/testar"), "Conexão funcionando.")}><RefreshCw className="h-4 w-4" /> Testar conexão</Button>
                  <Button variant="outline" onClick={() => setConfirmarDesconectar(true)}><Unplug className="h-4 w-4" /> Desconectar</Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FolderCog className="h-4 w-4 text-amber-500" /> Onde salvar os documentos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-600 dark:text-zinc-300">
          <p>Cada escritório organiza o Dropbox do seu jeito. Defina a pasta onde ficam os clientes e o nome da subpasta de cada tipo de documento. O sistema só grava dentro da pasta dos clientes.</p>
          <div>
            <Label htmlFor="dbx-raiz">Pasta dos clientes</Label>
            <Input id="dbx-raiz" value={raiz} onChange={(e) => setRaiz(e.target.value)} placeholder="/CLIENTES" />
            <p className="mt-1 text-xs text-zinc-500">Exemplos: /CLIENTES ou /ESCRITÓRIO/CLIENTES (até 3 níveis). Se a pasta não existir, o sistema cria.</p>
            {raiz.trim().toLowerCase().replace(/\/+$/, "") !== estado.pasta_raiz.toLowerCase() && (
              <p className="mt-1 text-xs text-amber-600">Ao trocar a pasta dos clientes, os vínculos cliente → pasta são desfeitos e o sistema procura de novo pelo nome na pasta nova. Nada é movido nem apagado no Dropbox.</p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {estado.pastas.tipos.map((t) => (
              <div key={t.chave}>
                <Label htmlFor={`dbx-tipo-${t.chave}`}>{t.chave === "A CLASSIFICAR" ? "Sem classificação" : t.chave.charAt(0) + t.chave.slice(1).toLowerCase()}</Label>
                <Input id={`dbx-tipo-${t.chave}`} value={nomes[t.chave] ?? t.nome} onChange={(e) => setNomes((n) => ({ ...n, [t.chave]: e.target.value }))} placeholder={t.chave} />
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            Resultado: <code>{(raiz.trim() || "/CLIENTES").replace(/\/+$/, "")}/NOME DO CLIENTE/{nomes["CONTRATOS E PROCURAÇÕES"] || "CONTRATOS E PROCURAÇÕES"}/AAAA-MM-DD - Contrato (assinado).pdf</code>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void salvarPastas()} disabled={salvandoPastas}>{salvandoPastas ? "Salvando…" : "Salvar pastas"}</Button>
            <Button variant="outline" onClick={() => { setRaiz("/CLIENTES"); setNomes(Object.fromEntries(estado.pastas.tipos.map((t) => [t.chave, t.chave]))); }}>Voltar ao padrão</Button>
          </div>
        </CardContent>
      </Card>

      {estado.conectado && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Send className="h-4 w-4 text-violet-500" /> Envios</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" loading={ocupado === "assinados"} onClick={() => void acaoAssinados()}>Enviar documentos já assinados</Button>
              <Button variant="outline" size="sm" loading={ocupado === "processar"} onClick={() => void acao("processar", () => api.post("/armazenamento/processar"), "Fila processada.")}>Enviar agora</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="success">{estado.fila.enviado} enviados</Badge>
              <Badge tone="info">{estado.fila.pendente} na fila</Badge>
              <Badge tone="warning">{estado.fila.aguardando_pasta} aguardando pasta</Badge>
              <Badge tone="danger">{estado.fila.erro} com erro</Badge>
            </div>
            {estado.fila.recentes.length === 0
              ? <p className="text-sm text-zinc-500">Nenhum envio ainda. Os documentos assinados aparecem aqui.</p>
              : (
                <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
                  {estado.fila.recentes.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <Badge tone={ROTULO_DO_STATUS[i.status].tom}>{ROTULO_DO_STATUS[i.status].texto}</Badge>
                      <span className="font-medium">{i.cliente ?? "Cliente removido"}</span>
                      <span className="text-zinc-500">{i.titulo}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-400" title={i.caminho_final || i.ultimo_erro}>{i.caminho_final || i.ultimo_erro}</span>
                      {i.status === "erro" && <Button size="sm" variant="outline" onClick={() => void acao(`re${i.id}`, () => api.post("/armazenamento/reenviar", { id: i.id }), "Reenviando…")}>Reenviar</Button>}
                    </li>
                  ))}
                </ul>
              )}
          </CardContent>
        </Card>
      )}

      {estado.conectado && pendencias.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FolderSync className="h-4 w-4 text-amber-500" /> Documentos esperando você escolher a pasta ({pendencias.length})</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-500">Achei pastas com nome parecido, mas não igual. Para não misturar clientes, o sistema não envia sem a sua escolha. Escolhida a pasta, ela fica vinculada a esse cliente.</p>
            {pendencias.map((p) => (
              <div key={p.pessoa_id} className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
                <p className="text-sm font-medium">{p.nome} <span className="font-normal text-zinc-500">· {p.documentos} documento(s) aguardando</span></p>
                <div className="flex flex-wrap gap-2">
                  {p.candidatas.map((c) => (
                    <Button key={c.id} size="sm" variant="outline" loading={ocupado === `v${p.pessoa_id}${c.id}`} onClick={() => void acao(`v${p.pessoa_id}${c.id}`, () => api.post("/armazenamento/vincular", { pessoa_id: p.pessoa_id, pasta_id: c.id }), "Pasta vinculada.")}>
                      Usar «{c.nome}»
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" loading={ocupado === `n${p.pessoa_id}`} onClick={() => void acao(`n${p.pessoa_id}`, () => api.post("/armazenamento/vincular-nova", { pessoa_id: p.pessoa_id }), "Pasta criada.")}>Nenhuma destas — criar pasta nova</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {estado.conectado && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FolderSearch className="h-4 w-4 text-emerald-500" /> Vincular pastas que já existem</CardTitle>
            <Button variant="outline" size="sm" loading={ocupado === "sugestoes"} onClick={() => void procurarCorrespondencias()}>Procurar correspondências</Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-zinc-500">Faça uma vez só: o sistema compara os clientes cadastrados com as pastas de {estado.pasta_raiz} e sugere os pares. Nada é renomeado nem enviado agora; você confirma.</p>
            {sugestoes && (
              <>
                <p className="text-xs text-zinc-500">{sugestoes.total_de_pastas} pasta(s) em {estado.pasta_raiz} · {idem.length} idêntica(s) · {parecidas.length} parecida(s) · {semPasta.length} sem pasta (a pasta será criada no primeiro documento).</p>
                {idem.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">Nome idêntico ({idem.length})</p>
                      <Button size="sm" loading={ocupado === "lote"} onClick={() => void vincularLote(idem.map((s) => ({ pessoa_id: s.pessoa_id, pasta_id: s.pasta!.id })))}>Confirmar todas as idênticas</Button>
                    </div>
                    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {idem.map((s) => <li key={s.pessoa_id} className="py-1.5 text-xs">{s.nome} <span className="text-zinc-400">→ {s.pasta!.nome}</span></li>)}
                    </ul>
                  </div>
                )}
                {parecidas.length > 0 && (
                  <div className="space-y-2">
                    <p className="font-medium">Nome parecido — confira ({parecidas.length})</p>
                    {parecidas.map((s) => (
                      <div key={s.pessoa_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                        <span className="min-w-[10rem] text-sm font-medium">{s.nome}</span>
                        {s.candidatas!.map((c) => (
                          <Button key={c.id} size="sm" variant="outline" loading={ocupado === `p${s.pessoa_id}${c.id}`} onClick={() => void acao(`p${s.pessoa_id}${c.id}`, async () => { await api.post("/armazenamento/vincular", { pessoa_id: s.pessoa_id, pasta_id: c.id }); await procurarCorrespondencias(); }, "Pasta vinculada.")}>Usar «{c.nome}»</Button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmarDesconectar} title="Desconectar o Dropbox?" confirmLabel="Desconectar" loading={desconectando}
        message="Os documentos deixam de ser copiados. Os vínculos com as pastas dos clientes ficam guardados para quando você reconectar."
        onCancel={() => setConfirmarDesconectar(false)}
        onConfirm={async () => {
          setDesconectando(true);
          try { await api.delete("/armazenamento/dropbox"); show("Dropbox desconectado.", "success"); await carregar(); }
          catch (e) { show(mensagemDe(e, "Não foi possível desconectar."), "error"); }
          finally { setDesconectando(false); setConfirmarDesconectar(false); }
        }}
      />
    </div>
  );
}
