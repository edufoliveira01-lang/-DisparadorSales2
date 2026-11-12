import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, History, KeyRound, RefreshCw, Trello } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Callout, SettingsBlock, SettingsFooter, SettingsPanel, SettingRow } from "@/components/ui/Settings";

interface TrelloBoard { id: string; name: string }
interface TrelloList { id: string; name: string }
interface CartaoIgnoradoTrello { cardId: string; titulo: string; url: string; motivos: string[] }
interface ResultadoImportacaoTrello {
  totalCards: number;
  cardsImportados: number;
  periciasImportadas: number;
  periciasDuplicadas: number;
  periciasIgnoradas: number;
  cardsIgnorados: number;
  ignorados: CartaoIgnoradoTrello[];
}

export function TrelloSection() {
  const { show } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [trelloKey, setTrelloKey] = useState("");
  const [trelloToken, setTrelloToken] = useState("");
  const [validando, setValidando] = useState(false);
  const [trelloOk, setTrelloOk] = useState(false);
  const [boards, setBoards] = useState<TrelloBoard[]>([]);
  const [lists, setLists] = useState<TrelloList[]>([]);
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const [moveListId, setMoveListId] = useState("");
  const [confirmListId, setConfirmListId] = useState("");
  const [arquivoListId, setArquivoListId] = useState("");
  const [salvandoTrello, setSalvandoTrello] = useState(false);
  const [sincronizandoTrello, setSincronizandoTrello] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImportacaoTrello | null>(null);

  const loadSettings = useCallback(async () => {
    const data = await api.get<Settings>("/settings");
    setSettings(data);
    if (data.trello_board_id) setBoardId(data.trello_board_id);
    if (data.trello_list_id) setListId(data.trello_list_id);
    if (data.trello_move_list_id) setMoveListId(data.trello_move_list_id);
    if (data.trello_confirm_list_id) setConfirmListId(data.trello_confirm_list_id);
    if (data.trello_arquivo_list_id) setArquivoListId(data.trello_arquivo_list_id);

    if (data.trello_key && data.trello_token_configurado) {
      setTrelloOk(true);
      // Board/lista já configurados: busca com as credenciais salvas no servidor (sem passar
      // key/token, que só ficam preenchidos no formulário se o usuário digitar de novo) para
      // os dropdowns virem populados sem exigir revalidação a cada visita à tela.
      try {
        const boardsData = await api.get<TrelloBoard[]>("/trello/boards");
        setBoards(boardsData);
        if (data.trello_board_id) {
          const listsData = await api.get<TrelloList[]>(`/trello/boards/${data.trello_board_id}/lists`);
          setLists(listsData);
        }
      } catch (err) {
        show(err instanceof ApiError ? err.message : "Erro ao carregar boards/listas do Trello.", "error");
      }
    }
  }, [show]);

  useEffect(() => {
    loadSettings().catch(() => undefined);
  }, [loadSettings]);

  async function handleValidarTrello() {
    setValidando(true);
    try {
      await api.post("/trello/validate", { key: trelloKey, token: trelloToken });
      setTrelloOk(true);
      show("Credenciais do Trello validadas com sucesso!", "success");
      const boardsData = await api.get<TrelloBoard[]>(
        `/trello/boards?key=${encodeURIComponent(trelloKey)}&token=${encodeURIComponent(trelloToken)}`
      );
      setBoards(boardsData);
    } catch (err) {
      setTrelloOk(false);
      show(err instanceof ApiError ? err.message : "Erro ao validar credenciais do Trello.", "error");
    } finally {
      setValidando(false);
    }
  }

  async function handleSelectBoard(id: string) {
    setBoardId(id);
    setListId("");
    setMoveListId("");
    setConfirmListId("");
    setArquivoListId("");
    setLists([]);
    if (!id) return;
    try {
      // Só manda key/token na query se o usuário digitou algo novo no formulário — vazio faz
      // o backend cair de volta para as credenciais já salvas.
      const params = new URLSearchParams();
      if (trelloKey) params.set("key", trelloKey);
      if (trelloToken) params.set("token", trelloToken);
      const qs = params.toString();
      const listsData = await api.get<TrelloList[]>(`/trello/boards/${id}/lists${qs ? `?${qs}` : ""}`);
      setLists(listsData);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao buscar listas do board.", "error");
    }
  }

  async function handleSalvarTrello() {
    setSalvandoTrello(true);
    try {
      const board = boards.find((b) => b.id === boardId);
      const list = lists.find((l) => l.id === listId);
      const moveList = lists.find((l) => l.id === moveListId);
      const confirmList = lists.find((l) => l.id === confirmListId);
      const arquivoList = lists.find((l) => l.id === arquivoListId);
      const payload: Record<string, string> = {
        trello_board_id: boardId,
        trello_board_nome: board?.name || "",
        trello_list_id: listId,
        trello_list_nome: list?.name || "",
        trello_move_list_id: moveListId,
        trello_move_list_nome: moveList?.name || "",
        trello_confirm_list_id: confirmListId,
        trello_confirm_list_nome: confirmList?.name || "",
        trello_arquivo_list_id: arquivoListId,
        trello_arquivo_list_nome: arquivoList?.name || "",
      };
      // Só inclui key/token se o usuário digitou algo novo — do contrário, o backend mantém a credencial salva.
      if (trelloKey) payload.trello_key = trelloKey;
      if (trelloToken) payload.trello_token = trelloToken;
      await api.put("/settings", payload);
      show("Configurações do Trello salvas.", "success");
      loadSettings().catch(() => undefined);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar configurações.", "error");
    } finally {
      setSalvandoTrello(false);
    }
  }

  async function handleSincronizarTrello() {
    setSincronizandoTrello(true);
    try {
      const r = await api.post<ResultadoImportacaoTrello>("/pericias-agendadas/sincronizar-trello");
      setResultado(r);
      const partes = [`${r.periciasImportadas} novo(s) evento(s)`];
      if (r.periciasDuplicadas > 0) partes.push(`${r.periciasDuplicadas} já existente(s)`);
      if (r.cardsIgnorados > 0) partes.push(`${r.cardsIgnorados} card(s) com pendência`);
      show(`${partes.join(" · ")} em ${r.totalCards} card(s).`, "success");
    } catch (err) {
      setResultado(null);
      show(err instanceof ApiError ? err.message : "Erro ao sincronizar com o Trello.", "error");
    } finally {
      setSincronizandoTrello(false);
    }
  }

  const semLista = !boardId && lists.length === 0;
  const mostrarQuadro = boards.length > 0 || !!settings?.trello_board_id;

  function opcoesLista(atualId?: string, atualNome?: string) {
    return (
      <>
        {atualId && !lists.find((l) => l.id === atualId) && <option value={atualId}>{atualNome} (atual)</option>}
        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </>
    );
  }

  return (
    <SettingsPanel
      icon={<Trello />}
      title="Integração com o Trello"
      description="Monitora o quadro dos clientes e mantém os cartões em dia."
      status={
        trelloOk
          ? <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado</Badge>
          : <Badge tone="neutral">Sem credenciais</Badge>
      }
    >
      <SettingsBlock step={1} title="Credenciais" description={<>Gere a API Key e o Token em <strong>trello.com/app-key</strong> (o Token precisa de permissão de leitura).</>}>
        <SettingRow label="API Key" htmlFor="cfg-tr-key">
          <Input
            id="cfg-tr-key"
            type="password"
            autoComplete="off"
            placeholder={settings?.trello_key ? "•••••••••••• (já configurada)" : "Cole sua API Key do Trello"}
            value={trelloKey}
            onChange={(e) => setTrelloKey(e.target.value)}
          />
        </SettingRow>
        <SettingRow label="Token" htmlFor="cfg-tr-token">
          <Input
            id="cfg-tr-token"
            type="password"
            autoComplete="off"
            placeholder={settings?.trello_token_configurado ? "•••••••••••• (já configurado)" : "Cole seu Token do Trello"}
            value={trelloToken}
            onChange={(e) => setTrelloToken(e.target.value)}
          />
        </SettingRow>
        <div>
          <Button variant="outline" size="sm" onClick={handleValidarTrello} loading={validando} disabled={!trelloKey || !trelloToken}>
            <KeyRound className="h-4 w-4" /> Validar credenciais
          </Button>
        </div>
      </SettingsBlock>

      {mostrarQuadro ? (
        <>
          <SettingsBlock step={2} title="Quadro e lista" description="De onde o sistema lê os cartões.">
            <SettingRow label="Quadro" htmlFor="cfg-tr-board">
              <Select id="cfg-tr-board" value={boardId} onChange={(e) => handleSelectBoard(e.target.value)}>
                <option value="">Selecione um quadro…</option>
                {settings?.trello_board_id && !boards.find((b) => b.id === settings.trello_board_id) && (
                  <option value={settings.trello_board_id}>{settings.trello_board_nome} (atual)</option>
                )}
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </SettingRow>
            <SettingRow label="Lista a monitorar" hint="Cartões desta lista disparam as mensagens." htmlFor="cfg-tr-list">
              <Select id="cfg-tr-list" value={listId} onChange={(e) => setListId(e.target.value)} disabled={semLista}>
                <option value="">Selecione uma lista…</option>
                {opcoesLista(settings?.trello_list_id, settings?.trello_list_nome)}
              </Select>
            </SettingRow>
          </SettingsBlock>

          <SettingsBlock step={3} title="Para onde mover os cartões" description="Opcional. Deixe em branco para não mover.">
            <SettingRow label="Após o envio" hint="Lista de destino do cartão depois da mensagem." htmlFor="cfg-tr-move">
              <Select id="cfg-tr-move" value={moveListId} onChange={(e) => setMoveListId(e.target.value)} disabled={semLista}>
                <option value="">Não mover (manter na lista atual)</option>
                {opcoesLista(settings?.trello_move_list_id, settings?.trello_move_list_nome)}
              </Select>
            </SettingRow>
            <SettingRow label="Após a resposta do cliente" hint="Quando o cliente responde ou reage, o cartão vai para esta lista." htmlFor="cfg-tr-confirm">
              <Select id="cfg-tr-confirm" value={confirmListId} onChange={(e) => setConfirmListId(e.target.value)} disabled={semLista}>
                <option value="">Não monitorar respostas</option>
                {opcoesLista(settings?.trello_confirm_list_id, settings?.trello_confirm_list_nome)}
              </Select>
            </SettingRow>
            {confirmListId && (
              <Callout tone="info">
                A cada mensagem enviada, o sistema passa a monitorar aquele número. Acompanhe em <strong>Pendentes de Resposta</strong>.
              </Callout>
            )}
          </SettingsBlock>

          <SettingsBlock step={4} title="Importar casos antigos" description="Opcional. Traz cartões antigos direto para o Calendário.">
            <SettingRow label="Lista de casos antigos" hint="Cartões sem descrição usam o título e o vencimento." htmlFor="cfg-tr-arq">
              <Select id="cfg-tr-arq" value={arquivoListId} onChange={(e) => setArquivoListId(e.target.value)} disabled={semLista}>
                <option value="">Não sincronizar</option>
                {opcoesLista(settings?.trello_arquivo_list_id, settings?.trello_arquivo_list_nome)}
              </Select>
            </SettingRow>
            {settings?.trello_arquivo_list_id ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <History className="h-3.5 w-3.5 shrink-0" /> Pode ser repetida sem duplicar eventos.
                  </p>
                  <Button variant="outline" size="sm" onClick={handleSincronizarTrello} loading={sincronizandoTrello} className="shrink-0">
                    <RefreshCw className="h-3.5 w-3.5" /> Importar agora
                  </Button>
                </div>
                {resultado && (
                  <Callout tone={resultado.cardsIgnorados > 0 ? "aviso" : "ok"}>
                    <p className="font-medium">Resultado da última importação</p>
                    <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                      <li><strong>{resultado.totalCards}</strong> cards analisados</li>
                      <li><strong>{resultado.periciasImportadas}</strong> eventos novos</li>
                      <li><strong>{resultado.periciasDuplicadas}</strong> já existentes</li>
                      <li><strong>{resultado.cardsIgnorados}</strong> cards com pendência</li>
                    </ul>
                    {resultado.ignorados.length > 0 && (
                      <details className="mt-2" open>
                        <summary className="cursor-pointer font-medium">Ver cartões não importados e os dados ausentes</summary>
                        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                          {resultado.ignorados.map((card) => (
                            <div key={card.cardId} className="rounded-lg border border-amber-200 bg-white p-2 text-zinc-700 dark:border-amber-900/60 dark:bg-zinc-900 dark:text-zinc-300">
                              <a href={card.url} target="_blank" rel="noreferrer" className="break-words font-medium text-accent-600 hover:underline dark:text-accent-400">
                                {card.titulo || `Card ${card.cardId}`}
                              </a>
                              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                {card.motivos.map((motivo) => <li key={motivo}>{motivo}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </Callout>
                )}
              </>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Escolha a lista e salve para liberar a importação.</p>
            )}
          </SettingsBlock>
        </>
      ) : (
        <SettingsBlock>
          <Callout tone="info">Valide as credenciais no passo 1 para escolher o quadro e as listas.</Callout>
        </SettingsBlock>
      )}

      <SettingsFooter left={!boardId || !listId ? "Escolha o quadro e a lista a monitorar para salvar." : undefined}>
        <Button onClick={handleSalvarTrello} loading={salvandoTrello} disabled={!boardId || !listId}>
          Salvar integração
        </Button>
      </SettingsFooter>
    </SettingsPanel>
  );
}
