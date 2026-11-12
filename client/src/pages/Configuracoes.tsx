import { AISettings } from "@/components/AISettings";
import { Settings as SettingsIcon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { beginRequestActivity } from "@/lib/requestActivity";
import { DeadlineSettings } from "@/components/djen/DeadlineSettings";
import { itemDaSecao } from "@/lib/configNav";
import type { SettingsSectionKey } from "@/components/SettingsOverview";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Database,
  Download,
  History,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Moon,
  Palette,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Square,
  Sun,
  Trello,
  Unplug,
  Upload,
  User,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings, WhatsappState } from "@/lib/types";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useSocketEvent } from "@/hooks/useSocketEvent";
import { useToast } from "@/components/ui/Toast";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import { GoogleCalendarSettings } from "@/components/GoogleCalendarSettings";
import { ArmazenamentoSettings } from "@/components/ArmazenamentoSettings";
import { DataJudSettings } from "@/components/DataJudSettings";
import { AsaasSettings } from "@/components/AsaasSettings";
import { CobrancaSettings } from "@/components/CobrancaSettings";
import { DeskcommEnvioSettings } from "@/components/DeskcommEnvioSettings";
import { LoginBrandingSettings } from "@/components/LoginBrandingSettings";
import { useAuth } from "@/context/AuthContext";

interface TrelloBoard {
  id: string;
  name: string;
}
interface TrelloList {
  id: string;
  name: string;
}
interface CartaoIgnoradoTrello {
  cardId: string;
  titulo: string;
  url: string;
  motivos: string[];
}
interface ResultadoImportacaoTrello {
  totalCards: number;
  cardsImportados: number;
  periciasImportadas: number;
  periciasDuplicadas: number;
  periciasIgnoradas: number;
  cardsIgnorados: number;
  ignorados: CartaoIgnoradoTrello[];
}

const STATUS_LABEL: Record<WhatsappState["status"], string> = {
  desconectado: "Desconectado",
  inicializando: "Iniciando…",
  aguardando_qr: "Aguardando escaneamento",
  pareando: "Validando vínculo…",
  autenticado: "Sincronizando…",
  conectado: "Conectado",
  falha: "Falha na conexão",
};

export function Configuracoes({ secao }: { secao?: string | null } = {}) {
  const { user } = useAuth();
  const { search: settingsSearch } = useLocation();
  const { show } = useToast();
  const { theme, setTheme } = useTheme();
  const configSection = (secao ?? null) as SettingsSectionKey | null;
  void settingsSearch;
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
  const [resultadoImportacaoTrello, setResultadoImportacaoTrello] = useState<ResultadoImportacaoTrello | null>(null);

  const whatsapp = useWhatsapp();

  const [intervalMin, setIntervalMin] = useState("5");
  const [intervalMax, setIntervalMax] = useState("15");
  const [salvandoIntervalo, setSalvandoIntervalo] = useState(false);

  const [usuario, setUsuario] = useState("");
  const [emailRecuperacao, setEmailRecuperacao] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [salvandoUsuario, setSalvandoUsuario] = useState(false);

  const [restaurando, setRestaurando] = useState(false);
  const [arquivoRestore, setArquivoRestore] = useState<File | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramAlertaHoras, setTelegramAlertaHoras] = useState("48");
  const [telegramAlertaHorasResposta, setTelegramAlertaHorasResposta] = useState("48");
  const [detectandoChatId, setDetectandoChatId] = useState(false);
  const [testandoTelegram, setTestandoTelegram] = useState(false);
  const [salvandoTelegram, setSalvandoTelegram] = useState(false);

  const [whapiApiUrl, setWhapiApiUrl] = useState("");
  const [whapiToken, setWhapiToken] = useState("");
  const [whapiNumero, setWhapiNumero] = useState("");
  const [testandoWhapi, setTestandoWhapi] = useState(false);
  const [salvandoWhapi, setSalvandoWhapi] = useState(false);

  const loadSettings = useCallback(async () => {
    const me = await api.get<{ user: { username: string, email: string | null } }>("/auth/me");
    setUsuario(me.user.username);
    setEmailRecuperacao(me.user.email || "");

    const data = await api.get<Settings>("/settings");
    setSettings(data);
    setIntervalMin(data.send_interval_min ?? "5");
    setIntervalMax(data.send_interval_max ?? "15");
    setTelegramAlertaHoras(data.telegram_alerta_horas ?? "48");
    setTelegramAlertaHorasResposta(data.telegram_alerta_horas_resposta ?? "48");
    if (data.telegram_chat_id) setTelegramChatId(data.telegram_chat_id);
    if (data.whapi_api_url) setWhapiApiUrl(data.whapi_api_url);
    if (data.whapi_numero_notificacao) setWhapiNumero(data.whapi_numero_notificacao);
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
    loadSettings();
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
      // o backend cair de volta para as credenciais já salvas (trello_token_configurado é só
      // uma flag de "já tem token", nunca o valor real, então não pode ser usado aqui).
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
      // Só inclui key/token se o usuário digitou algo novo — do contrário, o campo some do
      // corpo da requisição e o backend mantém a credencial já salva em vez de apagá-la.
      if (trelloKey) payload.trello_key = trelloKey;
      if (trelloToken) payload.trello_token = trelloToken;
      await api.put("/settings", payload);
      show("Configurações do Trello salvas.", "success");
      loadSettings();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar configurações.", "error");
    } finally {
      setSalvandoTrello(false);
    }
  }

  async function handleSincronizarTrello() {
    setSincronizandoTrello(true);
    try {
      const resultado = await api.post<ResultadoImportacaoTrello>("/pericias-agendadas/sincronizar-trello");
      setResultadoImportacaoTrello(resultado);
      const partes = [`${resultado.periciasImportadas} novo(s) evento(s)`];
      if (resultado.periciasDuplicadas > 0) partes.push(`${resultado.periciasDuplicadas} já existente(s)`);
      if (resultado.cardsIgnorados > 0) partes.push(`${resultado.cardsIgnorados} card(s) com pendência`);
      show(
        `${partes.join(" · ")} em ${resultado.totalCards} card(s).`,
        "success"
      );
    } catch (err) {
      setResultadoImportacaoTrello(null);
      show(err instanceof ApiError ? err.message : "Erro ao sincronizar com o Trello.", "error");
    } finally {
      setSincronizandoTrello(false);
    }
  }

  const [motorWhatsapp, setMotorWhatsapp] = useState<"wwebjs" | "baileys" | null>(null);
  const [trocandoMotor, setTrocandoMotor] = useState(false);
  useEffect(() => {
    api.get<{ engine: "wwebjs" | "baileys" }>("/whatsapp/engine").then((r) => setMotorWhatsapp(r.engine)).catch(() => undefined);
  }, []);
  async function handleTrocarMotor(engine: "wwebjs" | "baileys") {
    if (engine === motorWhatsapp || trocandoMotor) return;
    if (!window.confirm(engine === "baileys"
      ? "Trocar para o motor novo (sem navegador)? A conexão atual será encerrada e você precisará ler o QR Code de novo. Dá para voltar ao motor atual a qualquer momento."
      : "Voltar ao motor atual (whatsapp-web.js)? A conexão atual será encerrada e a sessão anterior desse motor será retomada.")) return;
    setTrocandoMotor(true);
    try {
      const r = await api.post<{ engine: "wwebjs" | "baileys" }>("/whatsapp/engine", { engine });
      setMotorWhatsapp(r.engine);
      show("Motor alterado. Clique em Conectar para continuar.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao trocar o motor do WhatsApp.", "error");
    } finally {
      setTrocandoMotor(false);
    }
  }

  async function handleConectarWhatsapp() {
    try {
      await whatsapp.conectar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao conectar WhatsApp.", "error");
    }
  }

  async function handlePararWhatsapp() {
    try {
      await whatsapp.parar();
      show("Tentativa de conexão cancelada.", "info");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao parar WhatsApp.", "error");
    }
  }

  async function handleDesconectarWhatsapp() {
    try {
      await whatsapp.desconectar();
      show("WhatsApp desconectado.", "info");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao desconectar WhatsApp.", "error");
    }
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

  async function handleDetectarChatId() {
    setDetectandoChatId(true);
    try {
      const payload: Record<string, string> = {};
      if (telegramToken) payload.token = telegramToken;
      const { chatId } = await api.post<{ chatId: string }>("/settings/telegram/detectar-chat-id", payload);
      setTelegramChatId(chatId);
      show("Chat encontrado! Confira e salve para confirmar.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao detectar o chat_id.", "error");
    } finally {
      setDetectandoChatId(false);
    }
  }

  async function handleTestarTelegram() {
    setTestandoTelegram(true);
    try {
      const payload: Record<string, string> = { chatId: telegramChatId };
      if (telegramToken) payload.token = telegramToken;
      await api.post("/settings/telegram/testar", payload);
      show("Mensagem de teste enviada! Confira o Telegram.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem de teste.", "error");
    } finally {
      setTestandoTelegram(false);
    }
  }

  async function handleSalvarTelegram() {
    setSalvandoTelegram(true);
    try {
      const payload: Record<string, string> = {
        telegram_chat_id: telegramChatId,
        telegram_alerta_horas: telegramAlertaHoras,
        telegram_alerta_horas_resposta: telegramAlertaHorasResposta,
      };
      if (telegramToken) payload.telegram_bot_token = telegramToken;
      await api.put("/settings", payload);
      show("Configurações de notificação salvas.", "success");
      loadSettings();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar configurações de notificação.", "error");
    } finally {
      setSalvandoTelegram(false);
    }
  }

  async function handleTestarWhapi() {
    setTestandoWhapi(true);
    try {
      const payload: Record<string, string> = { apiUrl: whapiApiUrl, numero: whapiNumero };
      if (whapiToken) payload.token = whapiToken;
      await api.post("/settings/whapi/testar", payload);
      show("Mensagem de teste enviada! Confira o WhatsApp.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao enviar mensagem de teste.", "error");
    } finally {
      setTestandoWhapi(false);
    }
  }

  async function handleSalvarWhapi() {
    setSalvandoWhapi(true);
    try {
      const payload: Record<string, string> = {
        whapi_api_url: whapiApiUrl,
        whapi_numero_notificacao: whapiNumero,
      };
      if (whapiToken) payload.whapi_token = whapiToken;
      await api.put("/settings", payload);
      show("Configurações da Whapi salvas.", "success");
      loadSettings();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar configurações da Whapi.", "error");
    } finally {
      setSalvandoWhapi(false);
    }
  }

  async function handleLogout() {
    await api.post("/auth/logout");
    window.location.href = "/login";
  }

  function handleBaixarBackup() {
    window.open("/api/backup/download", "_blank");
  }

  function handleArquivoBackupSelecionado(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setArquivoRestore(file);
    setConfirmRestoreOpen(true);
  }

  async function handleConfirmarRestore() {
    if (!arquivoRestore) return;
    setRestaurando(true);
    const finish = beginRequestActivity("Restaurando backup do sistema");
    try {
      const buffer = await arquivoRestore.arrayBuffer();
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: buffer,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || "Erro ao restaurar backup.");
      }
      show("Backup restaurado! O sistema está reiniciando — a página vai recarregar em instantes.", "success");
      setConfirmRestoreOpen(false);
      setArquivoRestore(null);
      setTimeout(() => window.location.reload(), 5000);
    } catch (err) {
      show(err instanceof Error ? err.message : "Erro ao restaurar backup.", "error");
    } finally {
      finish();
      setRestaurando(false);
    }
  }

  const whatsappTone = whatsapp.status === "conectado" ? "success" : whatsapp.status === "falha" ? "danger" : "warning";

  return (
    <div className="space-y-6">
      <PageHeader
        title={itemDaSecao(secao)?.item.titulo ?? "Conexões e sistema"}
        description={itemDaSecao(secao)?.item.descricao ?? "Ajuste conexões, avisos, acesso e aparência."}
        actions={configSection === "acesso" ? <Button variant="outline" onClick={handleLogout} className="danger-action">
          <LogOut className="h-4 w-4" /> Sair do sistema
        </Button> : undefined}
      />

      <div className="settings-layout"><div className="settings-detail">

      {configSection === "ia" && <AISettings />}
      <section hidden={configSection !== "aparencia"}><Card>
        <CardContent className="pt-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300">
                <Palette className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-semibold text-zinc-950 dark:text-white">Aparência</h2>
                <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">Escolha o tema deste navegador.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:w-72" role="radiogroup" aria-label="Tema da interface">
              {([
                { value: "light" as const, label: "Claro", icon: Sun },
                { value: "dark" as const, label: "Escuro", icon: Moon },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
                    theme === value
                      ? "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>
          {user.role === "administrador" && <LoginBrandingSettings />}
        </CardContent>
      </Card></section>

      <section hidden={configSection !== "acesso"}><CollapsibleCard alwaysOpen icon={<Lock className="h-4 w-4 text-amber-500" />} title="Dados de Acesso" storageKey="dados-acesso">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </CollapsibleCard></section>

      <section hidden={configSection !== "trello"}><CollapsibleCard alwaysOpen
        icon={<Trello className="h-4 w-4 text-blue-500" />}
        title="Integração com o Trello"
        storageKey="trello"
        headerExtra={
          trelloOk && (
            <Badge tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
            </Badge>
          )
        }
      >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
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
              <div>
                <Label>Mover cartão para (após resposta do cliente):</Label>
                <Select value={confirmListId} onChange={(e) => setConfirmListId(e.target.value)} disabled={!boardId && lists.length === 0}>
                  <option value="">Não monitorar respostas</option>
                  {settings?.trello_confirm_list_id && !lists.find((l) => l.id === settings.trello_confirm_list_id) && (
                    <option value={settings.trello_confirm_list_id}>{settings.trello_confirm_list_nome} (atual)</option>
                  )}
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Lista de casos antigos (para importar no calendário):</Label>
                <Select value={arquivoListId} onChange={(e) => setArquivoListId(e.target.value)} disabled={!boardId && lists.length === 0}>
                  <option value="">Não sincronizar</option>
                  {settings?.trello_arquivo_list_id && !lists.find((l) => l.id === settings.trello_arquivo_list_id) && (
                    <option value={settings.trello_arquivo_list_id}>{settings.trello_arquivo_list_nome} (atual)</option>
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
          {confirmListId && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Com uma lista de confirmação selecionada, toda vez que uma mensagem for enviada o sistema passa a monitorar
              aquele número: quando o cliente responder ou reagir à mensagem, o cartão é movido automaticamente para a lista
              acima. Acompanhe em <span className="font-medium">Pendentes de Resposta</span>.
            </p>
          )}
          {settings?.trello_arquivo_list_id && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  <History className="h-3.5 w-3.5 shrink-0" /> Traz os cards da lista de casos antigos direto para o
                  Calendário. Cards sem descrição usam o título e o vencimento. A importação pode ser repetida sem
                  duplicar eventos.
                </p>
                <Button variant="outline" size="sm" onClick={handleSincronizarTrello} loading={sincronizandoTrello} className="shrink-0">
                  <RefreshCw className="h-3.5 w-3.5" /> Importar agora
                </Button>
              </div>

              {resultadoImportacaoTrello && (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                  <p className="font-medium text-zinc-800 dark:text-zinc-200">Resultado da última importação</p>
                  <div className="mt-2 grid gap-2 text-zinc-600 dark:text-zinc-400 sm:grid-cols-4">
                    <span><strong className="text-zinc-900 dark:text-zinc-100">{resultadoImportacaoTrello.totalCards}</strong> cards analisados</span>
                    <span><strong className="text-emerald-600 dark:text-emerald-400">{resultadoImportacaoTrello.periciasImportadas}</strong> eventos novos</span>
                    <span><strong className="text-blue-600 dark:text-blue-400">{resultadoImportacaoTrello.periciasDuplicadas}</strong> já existentes</span>
                    <span><strong className="text-amber-600 dark:text-amber-400">{resultadoImportacaoTrello.cardsIgnorados}</strong> cards com pendência</span>
                  </div>

                  {resultadoImportacaoTrello.ignorados.length > 0 && (
                    <details className="mt-3" open>
                      <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">
                        Ver cartões não importados e os dados ausentes
                      </summary>
                      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {resultadoImportacaoTrello.ignorados.map((card) => (
                          <div key={card.cardId} className="rounded-md border border-amber-200 bg-white p-2 dark:border-amber-900/60 dark:bg-zinc-900">
                            <a
                              href={card.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-accent-600 hover:underline dark:text-accent-400"
                            >
                              {card.titulo || `Card ${card.cardId}`}
                            </a>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-600 dark:text-zinc-400">
                              {card.motivos.map((motivo) => <li key={motivo}>{motivo}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSalvarTrello} loading={salvandoTrello} disabled={!boardId || !listId}>
              Salvar integração
            </Button>
          </div>
      </CollapsibleCard></section>

      <section hidden={configSection !== "whatsapp"}><CollapsibleCard alwaysOpen
        icon={<Wifi className="h-4 w-4 text-accent-500" />}
        title="WhatsApp de envio aos clientes"
        storageKey="whatsapp"
        headerExtra={<Badge tone={whatsappTone as "success" | "danger" | "warning"}>{whatsapp.carregado ? STATUS_LABEL[whatsapp.status] : "Verificando conexão"}</Badge>}
      >
          <div className="mb-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
            <p className="mb-2 font-medium">Motor de conexão</p>
            <div className="flex flex-wrap gap-2">
              {([["wwebjs", "Motor atual (whatsapp-web.js)"], ["baileys", "Motor novo (Baileys, sem navegador)"]] as const).map(([valor, rotulo]) => (
                <button key={valor} type="button" disabled={trocandoMotor || motorWhatsapp === null} onClick={() => void handleTrocarMotor(valor)}
                  className={`rounded-md border px-3 py-1.5 ${motorWhatsapp === valor ? "border-accent-500 bg-accent-500/10 font-semibold" : "border-slate-300 dark:border-slate-600"}`}>{rotulo}</button>
              ))}
            </div>
            <p className="mt-2 text-xs opacity-70">O motor novo conecta direto ao WhatsApp (QR em poucos segundos, bem menos memória). Cada motor guarda a própria sessão; trocar exige ler o QR Code uma vez. Para voltar, escolha o motor atual.</p>
          </div>
          {whatsapp.status === "inicializando" && whatsapp.faseInicializacao && (
            <p role="status" className="mb-3 flex items-center gap-2 text-sm text-accent-600 dark:text-accent-300">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {whatsapp.faseInicializacao}…
            </p>
          )}
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

          {whatsapp.status === "pareando" && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <p className="flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Validando o vínculo com o celular…</p>
              <p className="text-xs opacity-80">Conclua a autorização no celular e aguarde a confirmação para iniciar a sincronização.</p>
            </div>
          )}

          {(whatsapp.status === "autenticado" || (whatsapp.status === "inicializando" && typeof whatsapp.syncProgress === "number")) && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <p className="flex items-center gap-2 font-medium">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                {whatsapp.status === "autenticado" ? "Dispositivo vinculado. " : ""}Sincronizando o WhatsApp
                {whatsapp.syncProgress !== null && whatsapp.syncProgress !== undefined ? ` (${Math.round(whatsapp.syncProgress)}%)` : ""}...
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/60">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${Math.max(6, whatsapp.syncProgress ?? 12)}%` }}
                />
              </div>
              <p className="text-xs opacity-80">A sessão será salva assim que a sincronização terminar e o status mudar para conectado.</p>
            </div>
          )}

          {whatsapp.status === "conectado" && whatsapp.sessionSaved && (
            <p className="flex items-center gap-2 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Sessão salva para reconexão automática após reinicializações.
            </p>
          )}

          {whatsapp.status === "falha" && whatsapp.lastError && (
            <div className="space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
              <p>{whatsapp.lastError}</p>
              <p className="text-xs opacity-80">
                Clique em "Conectar WhatsApp" para recuperar a conexão. Se necessário, o sistema exibirá um novo QR Code.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {whatsapp.status === "conectado" ? (
              <Button variant="danger" onClick={handleDesconectarWhatsapp}>
                <Unplug className="h-4 w-4" /> Desconectar WhatsApp
              </Button>
            ) : whatsapp.conectando || ["inicializando", "aguardando_qr", "pareando", "autenticado"].includes(whatsapp.status) ? (
              <Button variant="outline" disabled={whatsapp.conectando} onClick={handlePararWhatsapp}>
                {whatsapp.conectando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                {whatsapp.conectando ? "Preparando conexão…" : "Cancelar conexão"}
              </Button>
            ) : (
                <Button
                  onClick={handleConectarWhatsapp}
                  disabled={!whatsapp.carregado}
                >
                  <WifiOff className="h-4 w-4" />
                  Conectar WhatsApp
                </Button>
            )}
          </div>
          {whatsapp.status !== "conectado" && <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">O sistema recupera a sessão automaticamente. Quando um novo vínculo for necessário, escaneie o QR Code exibido acima.</p>}
      </CollapsibleCard></section>

      <section hidden={configSection !== "notificacoes"}><CollapsibleCard alwaysOpen
        icon={<Bell className="h-4 w-4 text-rose-500" />}
        title="Notificações"
        storageKey="notificacoes"
        headerExtra={
          settings?.telegram_bot_token_configurado && settings?.telegram_bot_token_valido === "false" ? (
            <Badge tone="danger">
              <AlertTriangle className="h-3.5 w-3.5" /> Requer novo token
            </Badge>
          ) : settings?.telegram_bot_token_configurado && settings?.telegram_chat_id ? (
            <Badge tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ativo
            </Badge>
          ) : null
        }
      >
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Receba um aviso no Telegram sempre que uma mensagem falhar no envio, ficar "enviada" sem confirmar entrega, ou um
            cliente não responder dentro dos prazos abaixo — pra você decidir o que fazer (reenviar, cobrar, ligar pro
            cliente, etc).
          </p>

          {settings?.telegram_bot_token_valido === "false" && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>O token salvo não pode ser lido com a chave atual. Cole novamente o token do bot e clique em Salvar notificações.</p>
            </div>
          )}

          <div>
            <Label>Token do bot</Label>
            <Input
              type="password"
              placeholder={settings?.telegram_bot_token_configurado ? "•••••••••••• (já configurado)" : "Cole o token do @BotFather"}
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
            />
            <p className="mt-1 text-xs text-zinc-400">
              Crie um bot conversando com <span className="font-medium">@BotFather</span> no Telegram e envie <code>/newbot</code>.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
            <div>
              <Label>Chat ID</Label>
              <Input
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="Detectado automaticamente"
              />
            </div>
            <Button variant="outline" onClick={handleDetectarChatId} loading={detectandoChatId}>
              <Search className="h-4 w-4" /> Detectar automaticamente
            </Button>
          </div>
          <p className="text-xs text-zinc-400">
            Antes de detectar, mande qualquer mensagem para o seu bot no Telegram — sem isso, ele não tem permissão para te
            notificar (proteção contra spam do próprio Telegram).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
            <div>
              <Label>Alertar após quantas horas sem confirmar entrega</Label>
              <Input
                type="number"
                min={1}
                value={telegramAlertaHoras}
                onChange={(e) => setTelegramAlertaHoras(e.target.value)}
              />
            </div>
            <div>
              <Label>Alertar após quantas horas sem resposta do cliente</Label>
              <Input
                type="number"
                min={1}
                value={telegramAlertaHorasResposta}
                onChange={(e) => setTelegramAlertaHorasResposta(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleTestarTelegram}
              loading={testandoTelegram}
              disabled={!telegramChatId || (!telegramToken && !settings?.telegram_bot_token_configurado)}
            >
              <Send className="h-4 w-4" /> Enviar teste
            </Button>
            <Button onClick={handleSalvarTelegram} loading={salvandoTelegram} disabled={!telegramChatId}>
              Salvar notificações
            </Button>
          </div>
      </CollapsibleCard></section>

      {configSection === "prazos" && <DeadlineSettings/>}
      <section hidden={configSection !== "google"}><GoogleCalendarSettings alwaysOpen /></section>
      {configSection === "dropbox" && <ArmazenamentoSettings />}
      {configSection === "datajud" && <DataJudSettings />}
      {configSection === "asaas" && <AsaasSettings />}
      {configSection === "cobranca" && <CobrancaSettings />}
      {configSection === "deskcomm-envio" && <DeskcommEnvioSettings />}

      <section hidden={configSection !== "notificacoes"}><CollapsibleCard alwaysOpen
        icon={<MessageCircle className="h-4 w-4 text-emerald-500" />}
        title="Notificações por WhatsApp (Whapi)"
        storageKey="notificacoes-whapi"
        headerExtra={
          settings?.whapi_token_configurado && settings?.whapi_token_valido === "false" ? (
            <Badge tone="danger">
              <AlertTriangle className="h-3.5 w-3.5" /> Requer novo token
            </Badge>
          ) : settings?.whapi_token_configurado && settings?.whapi_numero_notificacao ? (
            <Badge tone="success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ativo
            </Badge>
          ) : null
        }
      >
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Além (ou no lugar) do Telegram, você pode receber os mesmos alertas direto no WhatsApp de um número escolhido,
            usando uma conta na <span className="font-medium">Whapi</span>.
          </p>

          {settings?.whapi_token_valido === "false" && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>O token salvo não pode ser lido com a chave atual. Cole novamente o token do canal Whapi e clique em Salvar.</p>
            </div>
          )}

          <div>
            <Label>URL da API</Label>
            <Input
              placeholder="https://gate.whapi.cloud"
              value={whapiApiUrl}
              onChange={(e) => setWhapiApiUrl(e.target.value)}
            />
          </div>

          <div>
            <Label>Token</Label>
            <Input
              type="password"
              placeholder={settings?.whapi_token_configurado ? "•••••••••••• (já configurado)" : "Token do canal na Whapi"}
              value={whapiToken}
              onChange={(e) => setWhapiToken(e.target.value)}
            />
          </div>

          <div>
            <Label>Número para receber as notificações</Label>
            <Input
              placeholder="Ex: 5511999999999"
              value={whapiNumero}
              onChange={(e) => setWhapiNumero(e.target.value)}
            />
            <p className="mt-1 text-xs text-zinc-400">Formato internacional, só números (DDI + DDD + número).</p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleTestarWhapi}
              loading={testandoWhapi}
              disabled={!whapiApiUrl || !whapiNumero || (!whapiToken && !settings?.whapi_token_configurado)}
            >
              <Send className="h-4 w-4" /> Enviar teste
            </Button>
            <Button onClick={handleSalvarWhapi} loading={salvandoWhapi} disabled={!whapiApiUrl || !whapiNumero}>
              Salvar
            </Button>
          </div>
      </CollapsibleCard></section>

      <section hidden={configSection !== "intervalo"}><CollapsibleCard alwaysOpen title="Intervalo entre envios" storageKey="intervalo">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ao enviar em lote, o sistema aguarda um tempo aleatório entre esses limites antes de cada mensagem, para reduzir o
            risco de bloqueio da conta.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
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
      </CollapsibleCard></section>

      <section hidden={configSection !== "backup"}><CollapsibleCard alwaysOpen icon={<Database className="h-4 w-4 text-emerald-500" />} title="Backup" storageKey="backup">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Baixe uma cópia completa dos dados do sistema (contatos, templates, histórico de envios, pendentes de resposta e
            configurações) para guardar em local seguro. Em caso de problema, restaure esse arquivo para voltar tudo ao
            estado do backup.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleBaixarBackup}>
              <Download className="h-4 w-4" /> Baixar backup
            </Button>
            <Button variant="outline" onClick={() => backupInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Restaurar backup
            </Button>
            <input
              ref={backupInputRef}
              type="file"
              accept=".sqlite3,application/octet-stream"
              className="hidden"
              onChange={handleArquivoBackupSelecionado}
            />
          </div>

          <p className="text-xs text-zinc-400">
            Restaurar substitui <span className="font-medium">todos</span> os dados atuais pelo conteúdo do arquivo e reinicia
            o sistema automaticamente.
          </p>
      </CollapsibleCard></section>

      </div></div>
      <ConfirmDialog
        open={confirmRestoreOpen}
        title="Restaurar backup"
        message={`Isso vai substituir TODOS os dados atuais (contatos, templates, histórico, pendentes de resposta e configurações) pelo conteúdo de "${arquivoRestore?.name}". Essa ação não pode ser desfeita e o sistema será reiniciado em seguida. Deseja continuar?`}
        confirmLabel="Restaurar e substituir tudo"
        loading={restaurando}
        onConfirm={handleConfirmarRestore}
        onCancel={() => {
          setConfirmRestoreOpen(false);
          setArquivoRestore(null);
        }}
      />
    </div>
  );
}


