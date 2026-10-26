import { lazy, Suspense } from "react";
import { ActiveServiceProvider } from "@/context/ActiveServiceContext";
import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { WhatsappProvider } from "@/context/WhatsappContext";
import { BatchProgressProvider } from "@/context/BatchProgressContext";

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

  return (
    <ActiveServiceProvider>
      <WhatsappProvider>
        <BatchProgressProvider>
          <Layout>
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route path="/processos/quadro" element={<QuadroProcessos />} />
                <Route
                  path="/processos/calendarios"
                  element={<CalendariosPrazos />}
                />
                <Route path="/processos/*" element={<Acompanhamento />} />
                <Route path="/" element={<Dashboard />} />
                <Route path="/agenda" element={<Agenda />} />
                <Route path="/calendario" element={<Calendario />} />
                <Route path="/templates" element={<Templates />} />
                <Route path="/templates/cobranca" element={<Templates />} />
                <Route path="/templates/audiencia" element={<Templates />} />
                <Route path="/templates/remarcacao" element={<Templates />} />
                <Route path="/templates/lembretes" element={<Templates />} />
                <Route path="/historico" element={<Historico />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/pendentes" element={<PendentesResposta />} />
                <Route path="/configuracoes" element={<Configuracoes />} />
                <Route path="/login" element={<Login />} />
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
