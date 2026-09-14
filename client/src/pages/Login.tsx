import { useState, useEffect } from "react";
import { ArrowLeft, Key, LogIn, Mail, Send, ShieldAlert } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

export function Login() {
  const { show } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [carregando, setCarregando] = useState(false);
  
  // Estados para recuperação
  const [modo, setModo] = useState<"login" | "esqueci" | "reset">("login");
  const [token, setToken] = useState("");
  const [novaSenha, setNovaSenha] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (t) {
      setToken(t);
      setModo("reset");
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      await api.post("/auth/login", { username, password });
      window.location.href = "/";
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao realizar login.", "error");
    } finally {
      setCarregando(false);
    }
  }

  async function handleEsqueci(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      const res = await api.post<{ message: string }>("/auth/forgot-password", { username });
      show(res.message, "info");
      setModo("login");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao processar pedido.", "error");
    } finally {
      setCarregando(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    try {
      await api.post("/auth/reset-password", { token, password: novaSenha });
      show("Senha alterada com sucesso! Faça login.", "success");
      setModo("login");
      window.history.replaceState({}, "", "/login");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Token inválido ou expirado.", "error");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-accent-200/40 blur-3xl dark:bg-accent-900/20" />
      <div className="pointer-events-none absolute -bottom-40 -right-32 h-96 w-96 rounded-full bg-blue-200/30 blur-3xl dark:bg-blue-950/20" />
      <div className="relative w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500 text-white shadow-lg">
            <Send className="h-10 w-10" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            DisparaZap
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {modo === "login" ? "Acesse sua conta para gerenciar os disparos." : 
             modo === "esqueci" ? "Recupere seu acesso ao sistema." : "Defina sua nova senha."}
          </p>
        </div>

        <Card className="border border-white/80 shadow-xl dark:border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              {modo === "login" ? (
                <><LogIn className="h-5 w-5 text-accent-500" /> Identificação</>
              ) : modo === "esqueci" ? (
                <><Mail className="h-5 w-5 text-accent-500" /> Recuperação</>
              ) : (
                <><Key className="h-5 w-5 text-accent-500" /> Nova Senha</>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {modo === "login" && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Usuário</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Seu usuário"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Senha</Label>
                    <button 
                      type="button" 
                      onClick={() => setModo("esqueci")}
                      className="text-xs text-accent-600 hover:underline"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" loading={carregando}>
                  Entrar no sistema
                </Button>
              </form>
            )}

            {modo === "esqueci" && (
              <form onSubmit={handleEsqueci} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username-recovery">Usuário</Label>
                  <Input
                    id="username-recovery"
                    type="text"
                    placeholder="Digite seu usuário"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                  />
                  <p className="text-xs text-zinc-500">
                    Um link será enviado pelo Telegram (se configurado) ou para o e-mail cadastrado neste usuário.
                  </p>
                </div>
                <Button type="submit" className="w-full" loading={carregando}>
                  Enviar link de recuperação
                </Button>
                <button 
                  type="button" 
                  onClick={() => setModo("login")}
                  className="flex w-full items-center justify-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
                >
                  <ArrowLeft className="h-4 w-4" /> Voltar para o login
                </button>
              </form>
            )}

            {modo === "reset" && (
              <form onSubmit={handleReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova Senha</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" loading={carregando}>
                  Alterar senha
                </Button>
              </form>
            )}
            
            <div className="mt-6 rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
              <p className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" /> Segurança
              </p>
              <p className="mt-1">
                Sua sessão expira automaticamente após 3 horas de inatividade.
              </p>
            </div>
          </CardContent>
        </Card>
        
        <p className="text-center text-xs text-zinc-400">
          Uso 100% local · v2.33.6
        </p>
      </div>
    </div>
  );
}
