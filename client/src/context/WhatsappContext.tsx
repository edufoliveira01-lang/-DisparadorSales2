import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { WhatsappState } from "@/lib/types";

interface WhatsappContextValue extends WhatsappState {
  conectando: boolean;
  conectar: () => Promise<void>;
  parar: () => Promise<void>;
  desconectar: () => Promise<void>;
}

const ESTADO_INICIAL: WhatsappState = {
  status: "desconectado",
  qrDataUrl: null,
  lastError: null,
  syncProgress: null,
  sessionSaved: false,
};

const WhatsappContext = createContext<WhatsappContextValue | null>(null);

/**
 * Mantém uma única conexão SSE com /whatsapp/events para todo o app, montada uma vez em
 * volta das rotas autenticadas — não é recriada ao navegar entre páginas, então o status do
 * WhatsApp nunca "pisca" para desconectado só por causa de uma troca de tela. Os métodos de
 * ação (conectar/parar/desconectar) aplicam o estado retornado pela API imediatamente, sem
 * depender só do push do SSE, para a UI reagir na hora.
 */
export function WhatsappProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WhatsappState>(ESTADO_INICIAL);
  const [conectando, setConectando] = useState(false);

  useEffect(() => {
    const eventSource = new EventSource(`${api.baseUrl}/whatsapp/events`);
    eventSource.onmessage = (event) => {
      try {
        setState(JSON.parse(event.data));
      } catch (err) {
        console.error("Erro ao processar evento de WhatsApp:", err);
      }
    };
    return () => eventSource.close();
  }, []);

  async function conectar() {
    setConectando(true);
    try {
      const novoEstado = await api.post<WhatsappState>("/whatsapp/connect");
      setState(novoEstado);
    } finally {
      setConectando(false);
    }
  }

  async function parar() {
    setState((prev) => ({ ...prev, status: "desconectado", qrDataUrl: null, lastError: null }));
    const novoEstado = await api.post<WhatsappState>("/whatsapp/stop");
    setState(novoEstado);
  }

  async function desconectar() {
    setState((prev) => ({ ...prev, status: "desconectado", qrDataUrl: null, lastError: null }));
    const novoEstado = await api.post<WhatsappState>("/whatsapp/disconnect");
    setState(novoEstado);
  }

  return (
    <WhatsappContext.Provider value={{ ...state, conectando, conectar, parar, desconectar }}>
      {children}
    </WhatsappContext.Provider>
  );
}

export function useWhatsapp(): WhatsappContextValue {
  const ctx = useContext(WhatsappContext);
  if (!ctx) throw new Error("useWhatsapp precisa ser usado dentro de um WhatsappProvider");
  return ctx;
}
