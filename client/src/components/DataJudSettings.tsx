import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { Skeleton } from "@/components/ui/Skeleton";
import { Input } from "@/components/ui/Input";

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

  if (!estado) return <Skeleton className="h-56 w-full" />;
  return (
    <SettingsPanel
      icon={<KeyRound />}
      title="DataJud (CNJ)"
      description="Completa a ficha do processo com assunto, data de ajuizamento, órgão julgador, classe e último movimento."
      status={estado.configurado ? <Badge tone="success">Conectado · {estado.final}</Badge> : <Badge tone="warning">Sem chave</Badge>}
      actions={<a className="inline-flex items-center gap-1 text-xs text-accent-700 underline dark:text-accent-300" href="https://datajud-wiki.cnj.jus.br/api-publica/acesso" target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /> Onde achar a chave</a>}
    >
      <SettingsBlock>
        <Callout>O DJEN traz as publicações; o DataJud complementa o cadastro. Ele exige a <b>chave pública</b> divulgada pelo CNJ (procure por <i>“Chave Pública de Acesso”</i>). Ela muda de tempos em tempos: se parar de funcionar, cole a nova.</Callout>
        <SettingRow label="Chave pública" htmlFor="chave-datajud" hint="Deixe vazio e salve para remover a chave.">
          <Input id="chave-datajud" value={chave} onChange={(e) => setChave(e.target.value)} placeholder={estado.configurado ? "Cole uma nova chave para trocar" : "Cole aqui a chave"} autoComplete="off" />
        </SettingRow>
        {resultado && <Callout tone={resultado.ok ? "ok" : "erro"}>{resultado.texto}</Callout>}
      </SettingsBlock>
      <SettingsFooter left="Roda sozinho junto com o DJEN, no máximo uma vez por dia por processo, e só preenche o que está em branco.">
        <Button variant="outline" loading={testando} onClick={() => void testar()} disabled={!estado.configurado}>Testar com um processo</Button>
        <Button loading={salvando} onClick={() => void salvar()} disabled={!chave.trim() && !estado.configurado}>Salvar</Button>
      </SettingsFooter>
    </SettingsPanel>
  );
}
