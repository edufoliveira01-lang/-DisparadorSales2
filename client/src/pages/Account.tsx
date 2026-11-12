import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

export function Account() {
  const { user } = useAuth();
  const { show } = useToast();
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email || "");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await api.put<{ ok: boolean; relogin?: boolean }>("/auth/update", { username, email, password: password || undefined, currentPassword });
      if (result.relogin) { window.location.replace("/login"); return; }
      setCurrentPassword(""); setPassword("");
      show("Dados atualizados.", "success");
      window.location.reload();
    } catch (error) { show(error instanceof ApiError ? error.message : "Não foi possível atualizar sua conta.", "error"); }
    finally { setSaving(false); }
  };

  return <div className="max-w-2xl space-y-6">
    <PageHeader title="Minha conta" description="Seus dados de acesso e senha. Para mudar perfis de outras pessoas, use «Equipe e acessos»." />
    <form onSubmit={save} className="surface-panel space-y-5 p-5 sm:p-6">
      <div className="flex items-center gap-3 rounded-xl bg-accent-50 px-4 py-3 dark:bg-accent-950/30">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-500 text-sm font-semibold text-white">{(user.display_name || user.username).slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{user.display_name || user.username}</p><p className="text-xs text-zinc-500 dark:text-zinc-400">Perfil: {user.role}</p></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="conta-usuario">Usuário</Label><Input id="conta-usuario" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
        <div><Label htmlFor="conta-email">E-mail de recuperação</Label><Input id="conta-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      </div>
      <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Trocar senha</h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">Deixe a nova senha em branco para manter a atual.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="conta-nova">Nova senha <span className="font-normal text-zinc-400">(12+ caracteres)</span></Label><Input id="conta-nova" type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div>
          <div><Label htmlFor="conta-atual">Senha atual <span className="font-normal text-zinc-400">(para salvar)</span></Label><Input id="conta-atual" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" className="danger-action" onClick={async () => { await api.post("/auth/logout"); window.location.replace("/login"); }}>Sair do sistema</Button>
        <Button type="submit" loading={saving}>Salvar dados</Button>
      </div>
    </form>
  </div>;
}
