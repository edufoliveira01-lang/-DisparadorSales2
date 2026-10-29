import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

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

  return <div className="mx-auto max-w-2xl space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Seu acesso</p><h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">Minha conta</h1><p className="mt-2 text-sm text-slate-500">Dados pessoais e senha de acesso ao DisparaZap.</p></div>
    <form onSubmit={save} className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <div className="rounded-xl bg-violet-50 px-4 py-3 text-sm dark:bg-violet-950/40"><strong>{user.display_name || user.username}</strong><span className="ml-2 text-slate-500">· {user.role}</span></div>
      <label className="block text-sm font-medium">Usuário<input className="mt-2 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
      <label className="block text-sm font-medium">E-mail de recuperação<input type="email" className="mt-2 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="block text-sm font-medium">Nova senha <span className="font-normal text-slate-500">(opcional, 12 caracteres ou mais)</span><input type="password" minLength={12} className="mt-2 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
      <label className="block text-sm font-medium">Senha atual <span className="text-slate-500">(necessária para salvar)</span><input type="password" className="mt-2 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required autoComplete="current-password" /></label>
      <div className="flex flex-wrap justify-between gap-3"><button type="button" className="rounded-xl border border-slate-300 px-5 py-3 text-sm" onClick={async () => { await api.post("/auth/logout"); window.location.replace("/login"); }}>Sair do sistema</button><button disabled={saving} className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Salvando…" : "Salvar dados"}</button></div>
    </form>
  </div>;
}
