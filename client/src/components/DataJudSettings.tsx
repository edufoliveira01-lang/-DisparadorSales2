import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";

interface Estado { configurado: boolean; final: string }

/** DataJud (CNJ): a chave pública que libera a consulta de assunto, data de ajuizamento, órgão julgador e classe de cada processo. */
export function DataJudSettings() {
  const { show } = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [chave, setChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const carregar = useCallback(async () => { try { setEstado(await api.get<Estado>("/gestao/datajud", { fresh: true } as never)); } catch { show("Não foi possível carregar o DataJud.", "error"); } }, [show]);
  useEffect(() => { void carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true); setResultado(null);
    try { setEstado(await api.put<Estado>("/gestao/datajud", { chave })); setChave(""); show(chave.trim() ? "Chave salva." : "Chave removida.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const testar = async () => {
    setTestando(true); setResultado(null);
    try {
      const r = await api.post<{ resultado: string; erro: string | null }>("/gestao/datajud/testar", {});
      setResultado(r.resultado === "ok" ? { ok: true, texto: "Funcionou: o DataJud respondeu e a ficha do processo de teste foi completada." }
        : r.resultado === "nao_encontrado" ? { ok: true, texto: "A chave funciona, mas o DataJud não achou esse processo (pode ainda não estar na base)." }
        : { ok: false, texto: r.erro || "Não consegui consultar o DataJud agora." });
    } catch (e) { setResultado({ ok: false, texto: e instanceof ApiError ? e.message : "Não foi possível testar." }); }
    finally { setTestando(false); }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> DataJud (CNJ)</CardTitle></CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p className="text-zinc-600 dark:text-zinc-300">
          O DJEN traz as publicações; o <b>DataJud</b>, base pública do CNJ, completa a ficha do processo com <b>assunto, data de ajuizamento, órgão julgador, classe</b> e mostra o <b>último movimento</b>.
          Ele só funciona com a <b>chave pública</b> que o CNJ divulga na documentação do DataJud (procure por <i>“Chave Pública de Acesso”</i>). Ela muda de tempos em tempos: se parar de funcionar, cole a nova aqui.
        </p>
        <a className="inline-flex items-center gap-1 text-accent-700 underline dark:text-accent-300" href="https://datajud-wiki.cnj.jus.br/api-publica/acesso" target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Onde achar a chave pública</a>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">Situação:</span>
          {estado?.configurado ? <Badge tone="success"><CheckCircle2 className="mr-1 inline h-3 w-3" />Chave salva ({estado.final})</Badge> : <Badge tone="warning">Sem chave</Badge>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="chave-datajud">Chave pública do DataJud</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="chave-datajud" className="max-w-xl" value={chave} onChange={(e) => setChave(e.target.value)} placeholder={estado?.configurado ? "Cole uma nova chave para trocar (vazio e Salvar remove)" : "Cole aqui a chave"} autoComplete="off" />
            <Button loading={salvando} onClick={() => void salvar()} disabled={!chave.trim() && !estado?.configurado}>Salvar</Button>
            <Button variant="outline" loading={testando} onClick={() => void testar()} disabled={!estado?.configurado}>Testar com um processo</Button>
          </div>
          {resultado && <p role="status" className={resultado.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600 dark:text-red-400"}>{resultado.texto}</p>}
        </div>
        <p className="text-xs text-zinc-500">A consulta roda sozinha junto com o DJEN (no máximo uma vez por dia por processo). Nada que alguém digitou na ficha é trocado: só o que está em branco é preenchido.</p>
      </CardContent>
    </Card>
  );
}
