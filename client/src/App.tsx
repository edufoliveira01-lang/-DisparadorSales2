import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { WhatsappProvider } from "@/context/WhatsappContext";
import { BatchProgressProvider } from "@/context/BatchProgressContext";
import { Dashboard } from "@/pages/Dashboard";
import { Agenda } from "@/pages/Agenda";
import { Calendario } from "@/pages/Calendario";
import { Templates } from "@/pages/Templates";
import { Historico } from "@/pages/Historico";
import { Logs } from "@/pages/Logs";
import { PendentesResposta } from "@/pages/PendentesResposta";
import { Configuracoes } from "@/pages/Configuracoes";
import { Login } from "@/pages/Login";

export default function App() {
  const location = useLocation();
  const isLoginPage = location.pathname === "/login";

  if (isLoginPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    );
  }

  return (
    <WhatsappProvider>
      <BatchProgressProvider>
        <Layout>
          <Routes>
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
        </Layout>
      </BatchProgressProvider>
    </WhatsappProvider>
  );
}

