import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Eye, EyeOff, ShieldCheck, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Settings";
import { APP_VERSION } from "@/lib/appVersion";
import { firstAllowedPage } from "@/lib/navigation";
import type { TeamUser } from "@/context/AuthContext";
import { useIdentidade } from "@/context/IdentidadeContext";
import "./Login.css";

type Mode = "login" | "forgot" | "reset";

const fieldClass = "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";
const labelClass = "mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300";

const titles: Record<Mode, { title: string; text: string; button: string }> = {
  login: { title: "Entrar", text: "Use seu usuário e senha para acessar o sistema.", button: "Entrar" },
  forgot: { title: "Recuperar acesso", text: "Informe seu usuário para receber as instruções no canal cadastrado.", button: "Enviar instruções" },
  reset: { title: "Criar nova senha", text: "Escolha uma senha com pelo menos 12 caracteres.", button: "Salvar nova senha" },
};

export function Login() {
  const { show } = useToast();
  const identidade = useIdentidade();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [token, setToken] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("token");
    if (param) { setToken(param); setMode("reset"); }
    void fetch("/api/auth/login-branding", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { imageUrl: string | null }) => setImageUrl(result.imageUrl))
      .catch(() => {});
  }, []);

  // Foco automático no primeiro campo da etapa atual.
  useEffect(() => {
    (mode === "reset" ? passRef : userRef).current?.focus();
  }, [mode]);

  const goTo = (next: Mode) => { setError(""); setMode(next); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (mode === "login") {
        const result = await api.post<{ user: TeamUser }>("/auth/login", { username, password });
        window.location.replace(firstAllowedPage(result.user.permissions));
        return;
      } else if (mode === "forgot") {
        const result = await api.post<{ message: string }>("/auth/forgot-password", { username });
        show(result.message, "info"); goTo("login");
      } else {
        await api.post("/auth/reset-password", { token, password });
        show("Senha alterada. Entre com sua nova senha.", "success");
        window.history.replaceState({}, "", "/login"); setPassword(""); goTo("login");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível continuar. Verifique sua conexão e tente novamente.");
      if (mode === "login") passRef.current?.select();
    }
    setBusy(false);
  };

  const nome = identidade.nome || "Sales & Associados";
  const logo = identidade.faviconUrl
    ? <img src={identidade.faviconUrl} alt="" className="h-full w-full rounded-lg bg-white object-contain p-1" />
    : <Zap className="h-5 w-5" fill="currentColor" />;
  const copy = titles[mode];

  return (
    <main className="grid min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <section
        className={`login-hero ${imageUrl ? "has-image" : ""} relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex`}
        style={imageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(10,20,40,.15), rgba(10,20,40,.7)), url("${imageUrl}")` } : undefined}
        aria-label={nome}
      >
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/20">{logo}</span>
          <span className="leading-tight"><strong className="block text-lg">DisparaZap 2</strong><small className="text-sm text-white/80">{nome}</small></span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Mensagens, perícias e processos no mesmo lugar.</h2>
          <p className="mt-3 text-sm text-white/80">Cada pessoa acessa apenas as áreas autorizadas pela equipe.</p>
        </div>
        <span className="relative text-xs text-white/70">DisparaZap 2 · v{APP_VERSION}</span>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="login-card w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-600 text-white">{logo}</span>
            <span className="leading-tight"><strong className="block">DisparaZap 2</strong><small className="text-xs text-zinc-500 dark:text-zinc-400">{nome}</small></span>
          </div>

          <div className="surface-panel rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{copy.text}</p>

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate={false}>
              {error && <Callout tone="erro">{error}</Callout>}

              {mode !== "reset" && (
                <div>
                  <label htmlFor="login-username" className={labelClass}>Usuário</label>
                  <input ref={userRef} id="login-username" className={fieldClass} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Seu nome de usuário" required />
                </div>
              )}

              {mode !== "forgot" && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="login-password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{mode === "reset" ? "Nova senha" : "Senha"}</label>
                    {mode === "login" && <button type="button" onClick={() => goTo("forgot")} className="rounded text-xs font-medium text-accent-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-accent-400">Esqueci minha senha</button>}
                  </div>
                  <div className="relative">
                    <input ref={passRef} id="login-password" className={`${fieldClass} pr-11`} type={visible ? "text" : "password"} autoComplete={mode === "reset" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "reset" ? "Pelo menos 12 caracteres" : "Sua senha"} minLength={mode === "reset" ? 12 : undefined} required />
                    <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visible} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                      {visible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              )}

              <Button type="submit" size="lg" className="w-full" loading={busy}>{busy ? "Aguarde…" : copy.button}</Button>

              {mode !== "login" && (
                <button type="button" onClick={() => goTo("login")} className="mx-auto flex items-center gap-1.5 rounded text-sm font-medium text-zinc-600 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-zinc-400 dark:hover:text-zinc-100">
                  <ArrowLeft className="h-4 w-4" /> Voltar para o login
                </button>
              )}
            </form>
          </div>

          <p className="mt-5 flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Sua conta é criada pelo administrador. Se não tem acesso, fale com ele.</span>
          </p>
          <p className="mt-3 text-center text-xs text-zinc-400 lg:hidden">DisparaZap 2 · v{APP_VERSION}</p>
        </div>
      </section>
    </main>
  );
}
