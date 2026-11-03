import { useState } from "react";
import { api, ApiError } from "@/lib/api";

/** Primeiro acesso com senha definida por outra pessoa: exige criar a senha própria antes de usar o sistema. */
export function TrocaSenhaObrigatoria({ usuario, aoConcluir }: { usuario: string; aoConcluir: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ver, setVer] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErro("");
    if (nova.length < 12) { setErro("A nova senha deve ter pelo menos 12 caracteres."); return; }
    if (nova !== confirmar) { setErro("A confirmação não é igual à nova senha."); return; }
    setSalvando(true);
    try {
      await api.post("/auth/trocar-senha-inicial", { currentPassword: atual, newPassword: nova });
      aoConcluir();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar a senha. Tente novamente.");
    } finally { setSalvando(false); }
  };

  const campo = "mt-2 w-full rounded-xl border border-slate-300 bg-transparent px-4 py-3 dark:border-slate-700";
  const tipo = ver ? "text" : "password";
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <form onSubmit={enviar} className="w-full max-w-md space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Primeiro acesso</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">Crie a sua senha</h1>
          <p className="mt-2 text-sm text-slate-500">Olá, <strong>{usuario}</strong>. Você entrou com uma senha temporária. Defina agora uma senha só sua para liberar o sistema.</p>
        </div>
        {erro && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{erro}</div>}
        <label className="block text-sm font-medium">Senha temporária recebida
          <input type={tipo} className={campo} value={atual} onChange={(e) => setAtual(e.target.value)} required autoComplete="current-password" /></label>
        <label className="block text-sm font-medium">Nova senha <span className="font-normal text-slate-500">(12 caracteres ou mais)</span>
          <input type={tipo} minLength={12} className={campo} value={nova} onChange={(e) => setNova(e.target.value)} required autoComplete="new-password" /></label>
        <label className="block text-sm font-medium">Repita a nova senha
          <input type={tipo} minLength={12} className={campo} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} required autoComplete="new-password" /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} /> Mostrar as senhas</label>
        <div className="flex flex-wrap justify-between gap-3">
          <button type="button" className="rounded-xl border border-slate-300 px-5 py-3 text-sm" onClick={async () => { await api.post("/auth/logout"); window.location.replace("/login"); }}>Sair</button>
          <button disabled={salvando} className="rounded-xl bg-violet-600 px-6 py-3 text-sm font-semibold text-white disabled:opacity-60">{salvando ? "Salvando…" : "Salvar e entrar"}</button>
        </div>
      </form>
    </div>
  );
}
