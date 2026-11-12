import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, QrCode, Square, Unplug, Wifi } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { WhatsappState } from "@/lib/types";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { Callout, SettingsBlock, SettingsFooter, SettingsPanel, SettingRow } from "@/components/ui/Settings";

const STATUS_LABEL: Record<WhatsappState["status"], string> = {
  desconectado: "Desconectado",
  inicializando: "Iniciando…",
  aguardando_qr: "Aguardando escaneamento",
  pareando: "Validando vínculo…",
  autenticado: "Sincronizando…",
  conectado: "Conectado",
  falha: "Falha na conexão",
};

export function WhatsappSection() {
  const { show } = useToast();
  const whatsapp = useWhatsapp();
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

  async function handleConectar() {
    try {
      await whatsapp.conectar();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao conectar WhatsApp.", "error");
    }
  }

  async function handleParar() {
    try {
      await whatsapp.parar();
      show("Tentativa de conexão cancelada.", "info");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao parar WhatsApp.", "error");
    }
  }

  async function handleDesconectar() {
    try {
      await whatsapp.desconectar();
      show("WhatsApp desconectado.", "info");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao desconectar WhatsApp.", "error");
    }
  }

  const tone = whatsapp.status === "conectado" ? "success" : whatsapp.status === "falha" ? "danger" : "warning";
  const emAndamento = whatsapp.conectando || ["inicializando", "aguardando_qr", "pareando", "autenticado"].includes(whatsapp.status);
  const sincronizando = whatsapp.status === "autenticado" || (whatsapp.status === "inicializando" && typeof whatsapp.syncProgress === "number");

  if (whatsapp.provedor === "deskcomm") {
    const numeros = whatsapp.numeros ?? [];
    return (
      <SettingsPanel
        icon={<MessageCircle />}
        title="WhatsApp pelo Deskcomm"
        description="Todos os envios (avisos, lembretes, DJEN e cobranças) saem pelo WhatsApp do atendimento. A conexão por QR Code é feita lá."
        status={<Badge tone={whatsapp.status === "conectado" ? "success" : "warning"}>{whatsapp.status === "conectado" ? "Conectado" : whatsapp.status === "falha" ? "Sem resposta do Deskcomm" : "Sem número conectado"}</Badge>}
      >
        <SettingsBlock>
          {whatsapp.lastError && <Callout tone="aviso">{whatsapp.lastError}</Callout>}
          {numeros.length > 0 && (
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {numeros.map((n) => (
                <li key={n.telefone + n.nome} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0"><span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{n.nome}</span><span className="text-xs text-zinc-500">{n.telefone}</span></span>
                  <Badge tone={n.pronto ? "success" : "neutral"}>{n.pronto ? "Conectado" : "Desconectado"}</Badge>
                </li>
              ))}
            </ul>
          )}
          <SettingsFooter left="Para conectar, trocar ou remover um celular, use Atendimento → Conexões no Deskcomm.">
            <a href="/configuracoes?secao=deskcomm-envio"><Button variant="outline">Escolher números e finalidades</Button></a>
          </SettingsFooter>
        </SettingsBlock>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel
      icon={<Wifi />}
      title="WhatsApp de envio aos clientes"
      description="Número usado para enviar as mensagens do escritório."
      status={<Badge tone={tone}>{whatsapp.carregado ? STATUS_LABEL[whatsapp.status] : "Verificando conexão"}</Badge>}
    >
      <SettingsBlock>
        <Callout tone="info">
          Quer usar o <b>mesmo WhatsApp do atendimento (Deskcomm)</b> para tudo? Em <a className="font-medium underline" href="/configuracoes?secao=deskcomm-envio">Envio pelo Deskcomm</a> você escolhe o número e passa os avisos, lembretes, DJEN e cobranças para ele, sem precisar conectar um segundo celular aqui.
        </Callout>
        {whatsapp.status === "conectado" && (
          <Callout tone="ok">
            <p className="font-medium">WhatsApp conectado. Os envios estão liberados.</p>
            {whatsapp.sessionSaved && <p className="mt-0.5">Sessão salva: reconecta sozinho depois de reinicializações.</p>}
          </Callout>
        )}

        {whatsapp.status === "aguardando_qr" && whatsapp.qrDataUrl && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-800/40">
            <img src={whatsapp.qrDataUrl} alt="QR Code do WhatsApp" className="h-56 w-56 max-w-full rounded-lg bg-white p-2" />
            <ol className="space-y-1 text-center text-sm text-zinc-600 dark:text-zinc-300">
              <li className="flex items-center justify-center gap-1.5"><QrCode className="h-4 w-4 shrink-0" /> No celular, abra o WhatsApp</li>
              <li>Aparelhos conectados, depois Conectar um aparelho</li>
              <li>Aponte a câmera para este código</li>
            </ol>
          </div>
        )}
        {whatsapp.status === "aguardando_qr" && !whatsapp.qrDataUrl && (
          <Callout tone="info"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Gerando o QR Code…</span></Callout>
        )}

        {whatsapp.status === "inicializando" && whatsapp.faseInicializacao && !sincronizando && (
          <Callout tone="info"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {whatsapp.faseInicializacao}…</span></Callout>
        )}

        {whatsapp.status === "inicializando" && whatsapp.lastError && (
          <Callout tone="aviso"><span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 shrink-0 animate-spin" /> {whatsapp.lastError}</span></Callout>
        )}

        {whatsapp.status === "pareando" && (
          <Callout tone="info">
            <p className="flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 shrink-0 animate-spin" /> Validando o vínculo com o celular…</p>
            <p className="mt-0.5">Conclua a autorização no celular e aguarde a confirmação.</p>
          </Callout>
        )}

        {sincronizando && (
          <Callout tone="info">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              {whatsapp.status === "autenticado" ? "Dispositivo vinculado. " : ""}Sincronizando
              {whatsapp.syncProgress !== null && whatsapp.syncProgress !== undefined ? ` (${Math.round(whatsapp.syncProgress)}%)` : ""}…
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/60">
              <div className="h-full rounded-full bg-accent-500 transition-all duration-500" style={{ width: `${Math.max(6, whatsapp.syncProgress ?? 12)}%` }} />
            </div>
            <p className="mt-1.5">A sessão é salva quando terminar e o status mudar para conectado.</p>
          </Callout>
        )}

        {whatsapp.status === "falha" && (
          <Callout tone="erro">
            {whatsapp.lastError && <p className="font-medium">{whatsapp.lastError}</p>}
            <p className={cn(whatsapp.lastError && "mt-0.5")}>Clique em Conectar WhatsApp para recuperar. Se precisar, um novo QR Code aparece aqui.</p>
          </Callout>
        )}

        {whatsapp.status === "desconectado" && whatsapp.carregado && (
          <Callout tone="info">O WhatsApp está desconectado. Clique em Conectar WhatsApp; se for preciso um novo vínculo, o QR Code aparece aqui.</Callout>
        )}
      </SettingsBlock>

      <SettingsBlock title="Opções avançadas" className="py-0">
        <details className="group -mt-3 pb-4">
          <summary className="cursor-pointer text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">Escolher o motor de conexão</summary>
          <div className="mt-3">
            <SettingRow label="Motor de conexão" hint="Cada motor guarda a própria sessão; trocar exige ler o QR Code uma vez.">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Motor de conexão do WhatsApp">
                {([["wwebjs", "whatsapp-web.js (atual)"], ["baileys", "Baileys (sem navegador)"]] as const).map(([valor, rotulo]) => (
                  <button
                    key={valor}
                    type="button"
                    role="radio"
                    aria-checked={motorWhatsapp === valor}
                    disabled={trocandoMotor || motorWhatsapp === null}
                    onClick={() => void handleTrocarMotor(valor)}
                    className={cn(
                      "flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:opacity-60",
                      motorWhatsapp === valor
                        ? "border-accent-500 bg-accent-50 font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                        : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    )}
                  >
                    {motorWhatsapp === valor && <CheckCircle2 className="h-4 w-4" />}{rotulo}
                  </button>
                ))}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">O Baileys conecta direto ao WhatsApp: QR em poucos segundos e bem menos memória.</p>
            </SettingRow>
          </div>
        </details>
      </SettingsBlock>

      <SettingsFooter left={whatsapp.status !== "conectado" ? "O sistema recupera a sessão automaticamente." : undefined}>
        {whatsapp.status === "conectado" ? (
          <Button variant="danger" onClick={handleDesconectar}>
            <Unplug className="h-4 w-4" /> Desconectar WhatsApp
          </Button>
        ) : emAndamento ? (
          <Button variant="outline" disabled={whatsapp.conectando} onClick={handleParar}>
            {whatsapp.conectando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {whatsapp.conectando ? "Preparando conexão…" : "Cancelar conexão"}
          </Button>
        ) : (
          <Button onClick={handleConectar} disabled={!whatsapp.carregado}>
            <Wifi className="h-4 w-4" /> Conectar WhatsApp
          </Button>
        )}
      </SettingsFooter>
    </SettingsPanel>
  );
}
