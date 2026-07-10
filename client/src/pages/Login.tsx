import { useState } from "react";
import { LogIn, Send, ShieldAlert } from "lucide-react";
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-500 text-white shadow-lg">
            <Send className="h-10 w-10" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Disparador de Perícias
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Acesse sua conta para gerenciar os disparos.
          </p>
        </div>

        <Card className="border-none shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LogIn className="h-5 w-5 text-accent-500" /> Identificação
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                <Label htmlFor="password">Senha</Label>
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
          Uso 100% local · v1.1
        </p>
      </div>
    </div>
  );
}
