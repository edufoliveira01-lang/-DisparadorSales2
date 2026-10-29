import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, MessageSquareText, ShieldCheck, Zap } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { APP_VERSION } from "@/lib/appVersion";
import { firstAllowedPage } from "@/lib/navigation";
import type { TeamUser } from "@/context/AuthContext";
import "./Login.css";

export function Login() {
  const { show } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot" | "reset">("login");
  const [token, setToken] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("token");
    if (param) { setToken(param); setMode("reset"); }
    void fetch("/api/auth/login-branding", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { imageUrl: string | null }) => setImageUrl(result.imageUrl))
      .catch(() => {});
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      if (mode === "login") {
        const result = await api.post<{ user: TeamUser }>("/auth/login", { username, password });
        window.location.replace(firstAllowedPage(result.user.permissions));
      } else if (mode === "forgot") {
        const result = await api.post<{ message: string }>("/auth/forgot-password", { username });
        show(result.message, "info"); setMode("login");
      } else {
        await api.post("/auth/reset-password", { token, password });
        show("Senha alterada. Entre com sua nova senha.", "success");
        window.history.replaceState({}, "", "/login"); setPassword(""); setMode("login");
      }
    } catch (error) { show(error instanceof ApiError ? error.message : "Não foi possível continuar. Tente novamente.", "error"); }
    finally { setBusy(false); }
  };

  return <main className="login-layout">
    <section className={`login-visual ${imageUrl ? "has-image" : ""}`} style={imageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(21,18,58,.16), rgba(19,15,63,.78)), url("${imageUrl}")` } : undefined} aria-label="DisparaZap 2 · Sales & Associados">
      <div className="login-visual-header"><span className="login-brand-symbol"><Zap size={25} fill="currentColor" /></span><span><strong>DisparaZap <i>2</i></strong><small>Sales &amp; Associados</small></span></div>
      {!imageUrl && <div className="login-illustration" aria-hidden="true"><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><div className="login-floating floating-one"><MessageSquareText size={27} /><span>Mensagens</span></div><div className="login-center-card"><span className="login-center-logo"><Zap size={37} fill="currentColor" /></span><span className="login-center-line" /><span className="login-center-line short" /><span className="login-center-progress"><span /></span></div><div className="login-floating floating-two"><ShieldCheck size={25} /><span>Acompanhamento</span></div></div>}
      <div className="login-visual-copy"><span className="login-eyebrow">UM ESPAÇO DE TRABALHO MAIS CLARO</span><h2>Seu trabalho conectado.<br />Sua rotina no controle.</h2><p>Perícias, mensagens e processos organizados no mesmo lugar.</p></div>
      <span className="login-visual-footer">DisparaZap 2 · v{APP_VERSION}</span>
    </section>

    <section className="login-form-side"><div className="login-form-wrap">
      <div className="login-mobile-brand"><Zap size={20} fill="currentColor" /> DisparaZap 2</div>
      <span className="login-form-eyebrow">BEM-VINDO AO SEU ESPAÇO</span>
      <h1>{mode === "login" ? "Entre na sua conta" : mode === "forgot" ? "Recuperar acesso" : "Criar nova senha"}</h1>
      <p className="login-intro">{mode === "login" ? "Acesse o que você precisa, com as permissões da sua equipe." : mode === "forgot" ? "Informe seu usuário para receber as instruções no canal cadastrado." : "Escolha uma senha segura de pelo menos 12 caracteres."}</p>
      <form onSubmit={submit} className="login-form">
        {mode !== "reset" && <label htmlFor="login-username">Usuário</label>}
        {mode !== "reset" && <div className="login-input-wrap"><Mail size={19} /><input id="login-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Seu nome de usuário" required /></div>}
        {mode !== "forgot" && <><label htmlFor="login-password">{mode === "reset" ? "Nova senha" : "Senha"}</label><div className="login-input-wrap"><LockKeyhole size={19} /><input id="login-password" type={visible ? "text" : "password"} autoComplete={mode === "reset" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "reset" ? "Pelo menos 12 caracteres" : "Sua senha"} minLength={mode === "reset" ? 12 : undefined} required /><button type="button" className="login-visibility" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button></div></>}
        {mode === "login" && <div className="login-inline"><span><KeyRound size={15} /> Acesso individual e protegido</span><button type="button" onClick={() => setMode("forgot")}>Esqueci minha senha</button></div>}
        <button type="submit" className="login-submit" disabled={busy}>{busy ? "Aguarde…" : mode === "login" ? "Entrar no sistema" : mode === "forgot" ? "Enviar instruções" : "Salvar nova senha"}<ArrowRight size={19} /></button>
        {mode !== "login" && <button type="button" className="login-back" onClick={() => setMode("login")}><ArrowLeft size={17} /> Voltar para o login</button>}
      </form>
      <div className="login-footnote"><ShieldCheck size={18} /><span>Sua conta é criada pelo administrador. Cada pessoa acessa apenas suas áreas autorizadas.</span></div>
      <p className="login-mobile-version">DisparaZap 2 · v{APP_VERSION}</p>
    </div></section>
  </main>;
}
