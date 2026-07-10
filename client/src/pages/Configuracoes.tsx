import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Lock, LogOut, QrCode, Square, Trello, Unplug, User, Wifi, WifiOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings, WhatsappState } from "@/lib/types";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useToast } from "@/components/ui/Toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";

interface TrelloBoard {
  id: string;
  name: string;
}
interface TrelloList {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<WhatsappState["status"], string> = {
  desconectado: "Desconectado",
  inicializando: "Iniciando…",
  aguardando_qr: "Aguardando escaneamento",
  autenticado: "Autenticando…",
  conectado: "Conectado",
  falha: "Falha na conexão",
};

export function Configuracoes() {
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
  const [salvandoTrello, setSalvandoTrello] = useState(false);

  const [whatsapp, setWhatsapp] = useState<WhatsappState>({ status: "desconectado", qrDataUrl: null, lastError: null });
  const [conectando, setConectando] = useState(false);

  const [intervalMin, setIntervalMin] = useState("5");
  const [intervalMax, setIntervalMax] = useState("15");
  const [salvandoIntervalo, setSalvandoIntervalo] = useState(false);

  const [usuario, setUsuario] = useState("");
  const [emailRecuperacao, setEmailRecuperacao] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [salvandoUsuario, setSalvandoUsuario] = useState(false);

  const loadSettings = useCallback(async () => {
    const me = await api.get<{ user: { username: string, email: string | null } }>("/auth/me");
    setUsuario(me.user.username);
    setEmailRecuperacao(me.user.email || "");

    const data = await api.get<Settings>("/settings");
    setSettings(data);
    setIntervalMin(data.send_interval_min ?? "5");
    setIntervalMax(data.send_interval_max ?? "15");
    if (data.trello_board_id) setBoardId(data.trello_board_id);
    if (data.trello_list_id) setListId(data.trello_list_id);
    if (data.trello_move_list_id) setMoveListId(data.trello_move_list_id);
    if (data.trello_key && data.trello_token_configurado) setTrelloOk(true);
  }, []);

  useEffect(() => {
    loadSettings();
    
    const eventSource = new EventSource(`${api.baseUrl}/whatsapp/events`);
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setWhatsapp(data);
      } catch (err) {
        console.error("Erro ao processar evento de WhatsApp:", err);
      }
    };

    return () => {
      eventSource.close();
    };
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
    setLists([]);
    if (!id) return;
    try {
      const key = trelloKey || settings?.trello_key || "";
      const token = trelloToken || settings?.trello_token_configurado || "";
      const listsData = await api.get<TrelloList[]>(
        `/trello/boards/${id}/lists?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`
      );
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
      await api.put("/settings", {
        trello_key: trelloKey,
        trello_token: trelloToken,
        trello_board_id: boardId,
        trello_board_nome: board?.name || "",
        trello_list_id: listId,
        trello_list_nome: list?.name || "",
        trello_move_list_id: moveListId,
        trello_move_list_nome: moveList?.name || "",
      });
      show("Configurações do Trello salvas.", "success");
      loadSettings();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar configurações.", "error");
    } finally {
      setSalvandoTrello(false);
    }
  }

  async function handleConectarWhatsapp() {
    setConectando(true);
    try {
      const state = await api.post<WhatsappState>("/whatsapp/connect");
      setWhatsapp(state);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao conectar WhatsApp.", "error");
    } finally {
      setConectando(false);
    }
  }

  async function handlePararWhatsapp() {
    try {
      await api.whatsapp.stop();
      show("Geração de QR Code cancelada.", "info");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao parar WhatsApp.", "error");
    }
  }

  async function handleDesconectarWhatsapp() {
    await api.post("/whatsapp/disconnect");
    show("WhatsApp desconectado.", "info");
  }

  async function handleSalvarIntervalo() {
    setSalvandoIntervalo(true);
    try {
      await api.put("/settings", { send_interval_min: intervalMin, send_interval_max: intervalMax });
      show("Intervalo de envio salvo.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar intervalo.", "error");
    } finally {
      setSalvandoIntervalo(false);
    }
  }

  async function handleSalvarUsuario() {
    if (!senhaAtual) {
      show("Informe sua senha atual para salvar as alterações.", "error");
      return;
    }
    setSalvandoUsuario(true);
    try {
      await api.put("/auth/update", {
        username: usuario,
        email: emailRecuperacao,
        password: novaSenha || undefined,
        currentPassword: senhaAtual,
      });
      show("Dados de acesso atualizados.", "success");
      setNovaSenha("");
      setSenhaAtual("");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao atualizar dados.", "error");
    } finally {
      setSalvandoUsuario(false);
    }
  }

  async function handleLogout() {
    await api.post("/auth/logout");
    window.location.href = "/login";
  }

  const whatsappTone = whatsapp.status === "conectado" ? "success" : whatsapp.status === "falha" ? "danger" : "warning";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Configurações</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Gerencie seu acesso, integração com o Trello e WhatsApp.
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout} className="text-red-600 hover:bg-red-50 hover:text-red-700">
          <LogOut className="h-4 w-4" /> Sair do sistema
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-amber-500" /> Dados de Acesso
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Usuário</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input className="pl-9" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>E-mail de Recuperação</Label>
              <Input type="email" value={emailRecuperacao} onChange={(e) => setEmailRecuperacao(e.target.value)} placeholder="email@exemplo.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nova Senha (deixe em branco para não alterar)</Label>
              <Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <Label>Senha Atual (obrigatório para salvar)</Label>
              <Input type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} placeholder="••••••••" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSalvarUsuario} loading={salvandoUsuario}>
              Atualizar dados de acesso
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trello className="h-4 w-4 text-blue-500" /> Integração com o Trello
          </CardTitle>
          {trelloOk && (
            <Badge tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder={settings?.trello_key ? "•••••••••••• (já configurada)" : "Cole sua API Key do Trello"}
                value={trelloKey}
                onChange={(e) => setTrelloKey(e.target.value)}
              />
            </div>
            <div>
              <Label>Token</Label>
              <Input
                type="password"
                placeholder={settings?.trello_token_configurado ? "•••••••••••• (já configurado)" : "Cole seu Token do Trello"}
                value={trelloToken}
                onChange={(e) => setTrelloToken(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Obtenha sua API Key e Token em <span className="font-medium">trello.com/app-key</span> (gere um Token a partir da
            página de API Key, com permissão de leitura).
          </p>
          <Button variant="outline" size="sm" onClick={handleValidarTrello} loading={validando} disabled={!trelloKey || !trelloToken}>
            <KeyRound className="h-4 w-4" /> Validar credenciais
          </Button>

          {(boards.length > 0 || settings?.trello_board_id) && (
            <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              <div>
                <Label>Board</Label>
                <Select value={boardId} onChange={(e) => handleSelectBoard(e.target.value)}>
                  <option value="">Selecione um board…</option>
                  {settings?.trello_board_id && !boards.find((b) => b.id === settings.trello_board_id) && (
                    <option value={settings.trello_board_id}>{settings.trello_board_nome} (atual)</option>
                  )}
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Lista a monitorar</Label>
                <Select value={listId} onChange={(e) => setListId(e.target.value)} disabled={!boardId && lists.length === 0}>
                  <option value="">Selecione uma lista…</option>
                  {settings?.trello_list_id && !lists.find((l) => l.id === settings.trello_list_id) && (
                    <option value={settings.trello_list_id}>{settings.trello_list_nome} (atual)</option>
                  )}
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Mover cartão para:</Label>
                <Select value={moveListId} onChange={(e) => setMoveListId(e.target.value)} disabled={!boardId && lists.length === 0}>
                  <option value="">Não mover (manter na lista atual)</option>
                  {settings?.trello_move_list_id && !lists.find((l) => l.id === settings.trello_move_list_id) && (
                    <option value={settings.trello_move_list_id}>{settings.trello_move_list_nome} (atual)</option>
                  )}
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSalvarTrello} loading={salvandoTrello} disabled={!boardId || !listId}>
              Salvar integração
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-accent-500" /> Conexão com o WhatsApp
          </CardTitle>
          <Badge tone={whatsappTone as "success" | "danger" | "warning"}>{STATUS_LABEL[whatsapp.status]}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {whatsapp.status === "aguardando_qr" && whatsapp.qrDataUrl && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-800/40">
              <img src={whatsapp.qrDataUrl} alt="QR Code do WhatsApp" className="h-56 w-56 rounded-lg bg-white p-2" />
              <p className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                <QrCode className="h-4 w-4" /> Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho
              </p>
            </div>
          )}

          {whatsapp.status === "inicializando" && whatsapp.lastError && (
            <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {whatsapp.lastError}
            </p>
          )}

          {whatsapp.status === "falha" && whatsapp.lastError && (
            <div className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
              <p>{whatsapp.lastError}</p>
              <p className="text-xs opacity-80">
                Essa falha é conhecida e costuma ser temporária (bug do WhatsApp Web). Clique em "Conectar WhatsApp" para
                tentar de novo.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {whatsapp.status === "conectado" ? (
              <Button variant="danger" onClick={handleDesconectarWhatsapp}>
                <Unplug className="h-4 w-4" /> Desconectar / trocar de sessão
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleConectarWhatsapp}
                  loading={conectando || whatsapp.status === "inicializando"}
                  disabled={whatsapp.status === "aguardando_qr" || whatsapp.status === "autenticado"}
                >
                  {whatsapp.status === "aguardando_qr" ? <Loader2 className="h-4 w-4 animate-spin" /> : <WifiOff className="h-4 w-4" />}
                  Conectar WhatsApp
                </Button>

                {whatsapp.status === "aguardando_qr" && (
                  <Button variant="outline" onClick={handlePararWhatsapp}>
                    <Square className="h-4 w-4" /> Parar
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Intervalo entre envios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ao enviar em lote, o sistema aguarda um tempo aleatório entre esses limites antes de cada mensagem, para reduzir o
            risco de bloqueio da conta.
          </p>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <Label>Mínimo (segundos)</Label>
              <Input type="number" min={1} value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} />
            </div>
            <div>
              <Label>Máximo (segundos)</Label>
              <Input type="number" min={1} value={intervalMax} onChange={(e) => setIntervalMax(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSalvarIntervalo} loading={salvandoIntervalo}>
              Salvar intervalo
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
