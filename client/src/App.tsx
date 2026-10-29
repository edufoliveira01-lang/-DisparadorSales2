import { lazy, Suspense } from "react";
import { ActiveServiceProvider } from "@/context/ActiveServiceContext";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { WhatsappProvider } from "@/context/WhatsappContext";
import { BatchProgressProvider } from "@/context/BatchProgressContext";
import { AuthProvider, useAuth, type Permission } from "@/context/AuthContext";
import { firstAllowedPage } from "@/lib/navigation";
import { Link, Navigate } from "react-router-dom";

const Acompanhamento = lazy(() =>
  import("@/pages/Acompanhamento").then((module) => ({
    default: module.Acompanhamento,
  })),
);
const CalendariosPrazos = lazy(() =>
  import("@/pages/CalendariosPrazos").then((module) => ({
    default: module.CalendariosPrazos,
  })),
);
const QuadroProcessos = lazy(() =>
  import("@/pages/QuadroProcessos").then((module) => ({
    default: module.QuadroProcessos,
  })),
);
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const Agenda = lazy(() =>
  import("@/pages/Agenda").then((module) => ({ default: module.Agenda })),
);
const Calendario = lazy(() =>
  import("@/pages/Calendario").then((module) => ({
    default: module.Calendario,
  })),
);
const Templates = lazy(() =>
  import("@/pages/Templates").then((module) => ({ default: module.Templates })),
);
const Historico = lazy(() =>
  import("@/pages/Historico").then((module) => ({ default: module.Historico })),
);
const Logs = lazy(() =>
  import("@/pages/Logs").then((module) => ({ default: module.Logs })),
);
const PendentesResposta = lazy(() =>
  import("@/pages/PendentesResposta").then((module) => ({
    default: module.PendentesResposta,
  })),
);
const Configuracoes = lazy(() =>
  import("@/pages/Configuracoes").then((module) => ({
    default: module.Configuracoes,
  })),
);
const Login = lazy(() =>
  import("@/pages/Login").then((module) => ({ default: module.Login })),
);
const Team = lazy(() => import("@/pages/Team").then((module) => ({ default: module.Team })));
const Account = lazy(() => import("@/pages/Account").then((module) => ({ default: module.Account })));

export default function App() {
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  if (isLoginPage) {
    return (
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </Suspense>
    );
  }

  return <AuthProvider><AuthenticatedApp /></AuthProvider>;
}

function AccessRoute({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can, user } = useAuth();
  if (can(permission)) return <>{children}</>;
  return <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <h1 className="text-2xl font-semibold">Acesso não permitido</h1>
    <p className="mt-3 text-sm text-slate-500">Seu perfil não tem permissão para abrir esta área.</p>
    <Link className="mt-5 inline-flex rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white" to={firstAllowedPage(user.permissions)}>Ir para minha área</Link>
  </div>;
}

function AuthenticatedApp() {
  const { can, user } = useAuth();
  return (
    <ActiveServiceProvider>
      <WhatsappProvider>
        <BatchProgressProvider>
          <Layout>
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/processos/quadro" element={<AccessRoute permission="processes.view"><QuadroProcessos /></AccessRoute>} />
                <Route path="/processos/monitoramento" element={<AccessRoute permission="djen.manage"><Acompanhamento /></AccessRoute>} />
                <Route path="/processos/advogados" element={<AccessRoute permission="processes.manage"><Acompanhamento /></AccessRoute>} />
                <Route path="/processos/aguardando" element={<AccessRoute permission="processes.manage"><Acompanhamento /></AccessRoute>} />
                <Route
                  path="/processos/calendarios"
                  element={<AccessRoute permission="deadlines.view"><CalendariosPrazos /></AccessRoute>}
                />
                <Route path="/processos/*" element={<AccessRoute permission="processes.view"><Acompanhamento /></AccessRoute>} />
                <Route path="/" element={can("dashboard.view") ? <Dashboard /> : <Navigate to={firstAllowedPage(user.permissions)} replace />} />
                <Route path="/agenda" element={<AccessRoute permission="contacts.view"><Agenda /></AccessRoute>} />
                <Route path="/calendario" element={<AccessRoute permission="calendar.view"><Calendario /></AccessRoute>} />
                <Route path="/templates/*" element={<AccessRoute permission="templates.view"><Templates /></AccessRoute>} />
                <Route path="/historico" element={<AccessRoute permission="history.view"><Historico /></AccessRoute>} />
                <Route path="/logs" element={<AccessRoute permission="activity.view"><Logs /></AccessRoute>} />
                <Route path="/pendentes" element={<AccessRoute permission="pending.view"><PendentesResposta /></AccessRoute>} />
                <Route path="/configuracoes" element={<AccessRoute permission="integrations.manage"><Configuracoes /></AccessRoute>} />
                <Route path="/equipe" element={<AccessRoute permission="team.manage"><Team /></AccessRoute>} />
                <Route path="/minha-conta" element={<Account />} />
                <Route path="/login" element={<Login />} />
                <Route path="*" element={<Navigate to={firstAllowedPage(user.permissions)} replace />} />
              </Routes>
            </Suspense>
          </Layout>
        </BatchProgressProvider>
      </WhatsappProvider>
    </ActiveServiceProvider>
  );
}

function PageLoading() {
  return (
    <div role="status" aria-label="Carregando página" className="space-y-5 p-4">
      <div className="h-8 w-48 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-36 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/50" />
      <p className="text-xs text-zinc-500">
        Carregando seu espaço de trabalho…
      </p>
    </div>
  );
}
