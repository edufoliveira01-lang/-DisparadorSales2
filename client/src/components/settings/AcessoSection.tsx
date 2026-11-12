import { useEffect, useState } from "react";
import { Lock, User } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SettingsBlock, SettingsFooter, SettingsPanel, SettingRow } from "@/components/ui/Settings";

export function AcessoSection() {
  const { show } = useToast();
  const [usuario, setUsuario] = useState("");
  const [emailRecuperacao, setEmailRecuperacao] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [salvandoUsuario, setSalvandoUsuario] = useState(false);

  useEffect(() => {
    api.get<{ user: { username: string; email: string | null } }>("/auth/me")
      .then((me) => {
        setUsuario(me.user.username);
        setEmailRecuperacao(me.user.email || "");
      })
      .catch(() => undefined);
  }, []);

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

  return (
    <SettingsPanel icon={<Lock />} title="Dados de acesso" description="Como você entra no sistema e recupera a senha.">
      <SettingsBlock title="Identificação">
        <SettingRow label="Usuário" htmlFor="cfg-usuario">
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input id="cfg-usuario" className="pl-9" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          </div>
        </SettingRow>
        <SettingRow label="E-mail de recuperação" hint="Usado se você esquecer a senha." htmlFor="cfg-email">
          <Input id="cfg-email" type="email" value={emailRecuperacao} onChange={(e) => setEmailRecuperacao(e.target.value)} placeholder="email@exemplo.com" />
        </SettingRow>
      </SettingsBlock>
      <SettingsBlock title="Senha">
        <SettingRow label="Nova senha" hint="Deixe em branco para manter a atual." htmlFor="cfg-nova-senha">
          <Input id="cfg-nova-senha" type="password" autoComplete="new-password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="••••••••" />
        </SettingRow>
        <SettingRow label="Senha atual" hint="Obrigatória para salvar qualquer alteração." htmlFor="cfg-senha-atual">
          <Input id="cfg-senha-atual" type="password" autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} placeholder="••••••••" />
        </SettingRow>
      </SettingsBlock>
      <SettingsFooter>
        <Button onClick={handleSalvarUsuario} loading={salvandoUsuario}>Atualizar dados de acesso</Button>
      </SettingsFooter>
    </SettingsPanel>
  );
}
