import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageCircle, Search, Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Settings } from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Callout, SettingsBlock, SettingsFooter, SettingsPanel, SettingRow } from "@/components/ui/Settings";

export function NotificacoesSection() {
  const { show } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);

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

  const load = useCallback(async () => {
    const data = await api.get<Settings>("/settings");
    setSettings(data);
    setTelegramAlertaHoras(data.telegram_alerta_horas ?? "48");
    setTelegramAlertaHorasResposta(data.telegram_alerta_horas_resposta ?? "48");
    if (data.telegram_chat_id) setTelegramChatId(data.telegram_chat_id);
    if (data.whapi_api_url) setWhapiApiUrl(data.whapi_api_url);
    if (data.whapi_numero_notificacao) setWhapiNumero(data.whapi_numero_notificacao);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

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
      load().catch(() => undefined);
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
      load().catch(() => undefined);
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao salvar configurações da Whapi.", "error");
    } finally {
      setSalvandoWhapi(false);
    }
  }

  const telegramInvalido = settings?.telegram_bot_token_configurado && settings?.telegram_bot_token_valido === "false";
  const telegramAtivo = settings?.telegram_bot_token_configurado && settings?.telegram_chat_id;
  const whapiInvalido = settings?.whapi_token_configurado && settings?.whapi_token_valido === "false";
  const whapiAtivo = settings?.whapi_token_configurado && settings?.whapi_numero_notificacao;

  return (
    <div className="space-y-6">
      <SettingsPanel
        icon={<Send />}
        title="Avisos pelo Telegram"
        description="Receba um alerta quando uma mensagem falhar, não confirmar entrega ou o cliente não responder no prazo."
        status={
          telegramInvalido ? <Badge tone="danger"><AlertTriangle className="h-3.5 w-3.5" /> Requer novo token</Badge>
          : telegramAtivo ? <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Ativo</Badge>
          : <Badge tone="neutral">Não configurado</Badge>
        }
      >
        <SettingsBlock title="Conexão com o bot">
          {settings?.telegram_bot_token_valido === "false" && (
            <Callout tone="erro">O token salvo não pode ser lido com a chave atual. Cole o token do bot de novo e salve.</Callout>
          )}
          <SettingRow label="Token do bot" hint={<>Crie o bot no Telegram com <strong>@BotFather</strong> e o comando <code>/newbot</code>.</>} htmlFor="cfg-tg-token">
            <Input
              id="cfg-tg-token"
              type="password"
              autoComplete="off"
              placeholder={settings?.telegram_bot_token_configurado ? "•••••••••••• (já configurado)" : "Cole o token do @BotFather"}
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
            />
          </SettingRow>
          <SettingRow label="Chat ID" hint="Antes de detectar, mande qualquer mensagem ao seu bot no Telegram." htmlFor="cfg-tg-chat">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="cfg-tg-chat" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="Detectado automaticamente" />
              <Button variant="outline" onClick={handleDetectarChatId} loading={detectandoChatId} className="shrink-0">
                <Search className="h-4 w-4" /> Detectar
              </Button>
            </div>
          </SettingRow>
        </SettingsBlock>
        <SettingsBlock title="Quando avisar">
          <SettingRow label="Sem confirmação de entrega" hint="Horas até alertar uma mensagem enviada sem confirmar entrega." htmlFor="cfg-tg-h1">
            <Input id="cfg-tg-h1" type="number" min={1} className="sm:max-w-[10rem]" value={telegramAlertaHoras} onChange={(e) => setTelegramAlertaHoras(e.target.value)} />
          </SettingRow>
          <SettingRow label="Sem resposta do cliente" hint="Horas até alertar que o cliente não respondeu." htmlFor="cfg-tg-h2">
            <Input id="cfg-tg-h2" type="number" min={1} className="sm:max-w-[10rem]" value={telegramAlertaHorasResposta} onChange={(e) => setTelegramAlertaHorasResposta(e.target.value)} />
          </SettingRow>
        </SettingsBlock>
        <SettingsFooter left="O teste envia uma mensagem ao chat informado.">
          <Button
            variant="outline"
            onClick={handleTestarTelegram}
            loading={testandoTelegram}
            disabled={!telegramChatId || (!telegramToken && !settings?.telegram_bot_token_configurado)}
          >
            <Send className="h-4 w-4" /> Testar
          </Button>
          <Button onClick={handleSalvarTelegram} loading={salvandoTelegram} disabled={!telegramChatId}>
            Salvar Telegram
          </Button>
        </SettingsFooter>
      </SettingsPanel>

      <SettingsPanel
        icon={<MessageCircle />}
        title="Avisos por WhatsApp (Whapi)"
        description="Os mesmos alertas, no WhatsApp de um número escolhido, usando uma conta na Whapi. Pode ser usado junto ou no lugar do Telegram."
        status={
          whapiInvalido ? <Badge tone="danger"><AlertTriangle className="h-3.5 w-3.5" /> Requer novo token</Badge>
          : whapiAtivo ? <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Ativo</Badge>
          : <Badge tone="neutral">Não configurado</Badge>
        }
      >
        <SettingsBlock>
          {settings?.whapi_token_valido === "false" && (
            <Callout tone="erro">O token salvo não pode ser lido com a chave atual. Cole o token do canal Whapi de novo e salve.</Callout>
          )}
          <SettingRow label="Token do canal" hint="Gerado no painel da Whapi." htmlFor="cfg-wh-token">
            <Input
              id="cfg-wh-token"
              type="password"
              autoComplete="off"
              placeholder={settings?.whapi_token_configurado ? "•••••••••••• (já configurado)" : "Token do canal na Whapi"}
              value={whapiToken}
              onChange={(e) => setWhapiToken(e.target.value)}
            />
          </SettingRow>
          <SettingRow label="Número que recebe os avisos" hint="Formato internacional, só números: DDI + DDD + número." htmlFor="cfg-wh-num">
            <Input id="cfg-wh-num" placeholder="Ex: 5511999999999" value={whapiNumero} onChange={(e) => setWhapiNumero(e.target.value)} />
          </SettingRow>
          <SettingRow label="URL da API" hint="Normalmente https://gate.whapi.cloud." htmlFor="cfg-wh-url">
            <Input id="cfg-wh-url" placeholder="https://gate.whapi.cloud" value={whapiApiUrl} onChange={(e) => setWhapiApiUrl(e.target.value)} />
          </SettingRow>
        </SettingsBlock>
        <SettingsFooter left="O teste envia uma mensagem ao número informado.">
          <Button
            variant="outline"
            onClick={handleTestarWhapi}
            loading={testandoWhapi}
            disabled={!whapiApiUrl || !whapiNumero || (!whapiToken && !settings?.whapi_token_configurado)}
          >
            <Send className="h-4 w-4" /> Testar
          </Button>
          <Button onClick={handleSalvarWhapi} loading={salvandoWhapi} disabled={!whapiApiUrl || !whapiNumero}>
            Salvar Whapi
          </Button>
        </SettingsFooter>
      </SettingsPanel>
    </div>
  );
}
