import { useRef, useState } from "react";
import { Database, Download, Upload } from "lucide-react";
import { beginRequestActivity } from "@/lib/requestActivity";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Callout, SettingsBlock, SettingsPanel } from "@/components/ui/Settings";

export function BackupSection() {
  const { show } = useToast();
  const [restaurando, setRestaurando] = useState(false);
  const [arquivoRestore, setArquivoRestore] = useState<File | null>(null);
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <>
      <SettingsPanel icon={<Database />} title="Backup dos dados" description="Contatos, modelos, histórico de envios, pendentes de resposta e configurações.">
        <SettingsBlock title="Baixar uma cópia" description="Guarde o arquivo em local seguro, fora do servidor.">
          <div>
            <Button variant="outline" onClick={handleBaixarBackup}>
              <Download className="h-4 w-4" /> Baixar backup
            </Button>
          </div>
        </SettingsBlock>
        <SettingsBlock title="Restaurar a partir de um arquivo" description="Use só se precisar voltar tudo ao estado de um backup anterior.">
          <Callout tone="aviso">
            Restaurar substitui <strong>todos</strong> os dados atuais pelo conteúdo do arquivo e reinicia o sistema. Não dá para desfazer. Você confirmará antes de continuar.
          </Callout>
          <div>
            <Button variant="outline" onClick={() => backupInputRef.current?.click()}>
              <Upload className="h-4 w-4" /> Escolher arquivo de backup…
            </Button>
            <input
              ref={backupInputRef}
              type="file"
              accept=".sqlite3,application/octet-stream"
              className="hidden"
              onChange={handleArquivoBackupSelecionado}
            />
          </div>
        </SettingsBlock>
      </SettingsPanel>
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
    </>
  );
}
