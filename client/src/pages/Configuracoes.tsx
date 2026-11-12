import { LogOut } from "lucide-react";
import { AISettings } from "@/components/AISettings";
import { DeadlineSettings } from "@/components/djen/DeadlineSettings";
import { itemDaSecao } from "@/lib/configNav";
import type { SettingsSectionKey } from "@/components/SettingsOverview";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { GoogleCalendarSettings } from "@/components/GoogleCalendarSettings";
import { ArmazenamentoSettings } from "@/components/ArmazenamentoSettings";
import { DataJudSettings } from "@/components/DataJudSettings";
import { AsaasSettings } from "@/components/AsaasSettings";
import { CobrancaSettings } from "@/components/CobrancaSettings";
import { AtendimentoSettings } from "@/components/AtendimentoSettings";
import { DeskcommEnvioSettings } from "@/components/DeskcommEnvioSettings";
import { AparenciaSection } from "@/components/settings/AparenciaSection";
import { AcessoSection } from "@/components/settings/AcessoSection";
import { TrelloSection } from "@/components/settings/TrelloSection";
import { WhatsappSection } from "@/components/settings/WhatsappSection";
import { NotificacoesSection } from "@/components/settings/NotificacoesSection";
import { IntervaloSection } from "@/components/settings/IntervaloSection";
import { BackupSection } from "@/components/settings/BackupSection";

async function handleLogout() {
  await api.post("/auth/logout");
  window.location.href = "/login";
}

export function Configuracoes({ secao }: { secao?: string | null } = {}) {
  const configSection = (secao ?? null) as SettingsSectionKey | null;

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
        {configSection === "aparencia" && <AparenciaSection />}
        {configSection === "acesso" && <AcessoSection />}
        {configSection === "trello" && <TrelloSection />}
        {configSection === "whatsapp" && <WhatsappSection />}
        {configSection === "notificacoes" && <NotificacoesSection />}
        {configSection === "prazos" && <DeadlineSettings />}
        <section hidden={configSection !== "google"}><GoogleCalendarSettings alwaysOpen /></section>
        {configSection === "dropbox" && <ArmazenamentoSettings />}
        {configSection === "datajud" && <DataJudSettings />}
        {configSection === "asaas" && <AsaasSettings />}
        {configSection === "cobranca" && <CobrancaSettings />}
        {configSection === "deskcomm-envio" && <DeskcommEnvioSettings />}
        {configSection === "atendimento" && <AtendimentoSettings />}
        {configSection === "intervalo" && <IntervaloSection />}
        {configSection === "backup" && <BackupSection />}
      </div></div>
    </div>
  );
}
