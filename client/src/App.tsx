import { Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { WhatsappProvider } from "@/context/WhatsappContext";
import { Dashboard } from "@/pages/Dashboard";
import { Agenda } from "@/pages/Agenda";
import { Calendario } from "@/pages/Calendario";
import { TemplatesPericia } from "@/pages/TemplatesPericia";
import { TemplatesCobranca } from "@/pages/TemplatesCobranca";
import { TemplatesAudiencia } from "@/pages/TemplatesAudiencia";
import { Historico } from "@/pages/Historico";
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
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/calendario" element={<Calendario />} />
          <Route path="/templates" element={<TemplatesPericia />} />
          <Route path="/templates/cobranca" element={<TemplatesCobranca />} />
          <Route path="/templates/audiencia" element={<TemplatesAudiencia />} />
          <Route path="/historico" element={<Historico />} />
          <Route path="/pendentes" element={<PendentesResposta />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </Layout>
    </WhatsappProvider>
  );
}
