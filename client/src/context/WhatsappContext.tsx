import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { WhatsappState } from "@/lib/types";

interface WhatsappContextValue extends WhatsappState {
  carregado: boolean;
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
  const [carregado, setCarregado] = useState(false);
  const operacao = useRef(0);
  const revisao = useRef(0);
  const aplicar = useCallback((value: WhatsappState) => {
    revisao.current++;
    setState(value);
    setCarregado(true);
  }, []);

  useEffect(() => {
    let ativo = true;
    let consultando = false;
    const consultar = async () => {
      if (!ativo || consultando || document.visibilityState !== "visible") return;
      consultando = true;
      const seq = operacao.current;
      const versao = revisao.current;
      try {
        const value = await api.get<WhatsappState>("/whatsapp/status", { background: true, signal: AbortSignal.timeout(10000) });
        if (ativo && seq === operacao.current && versao === revisao.current) aplicar(value);
      } catch { /* A próxima consulta recupera o estado sem inventar uma desconexão. */ }
      finally { consultando = false; }
    };
    const eventSource = new EventSource(`${api.baseUrl}/whatsapp/events`);
    eventSource.onopen = () => { void consultar(); };
    eventSource.onerror = () => { void consultar(); };
    eventSource.onmessage = (event) => {
      try {
        if (ativo) aplicar(JSON.parse(event.data));
      } catch (err) {
        console.error("Erro ao processar evento de WhatsApp:", err);
      }
    };
    void consultar();
    const timer = setInterval(() => { void consultar(); }, 5000);
    window.addEventListener("focus", consultar);
    document.addEventListener("visibilitychange", consultar);
    return () => {
      ativo = false;
      clearInterval(timer);
      eventSource.close();
      window.removeEventListener("focus", consultar);
      document.removeEventListener("visibilitychange", consultar);
    };
  }, [aplicar]);

  async function conectar() {
    const atual = ++operacao.current;
    setConectando(true);
    try {
      const novoEstado = await api.post<WhatsappState>("/whatsapp/connect");
      if (atual === operacao.current) aplicar(novoEstado);
    } finally {
      if (atual === operacao.current) setConectando(false);
    }
  }

  async function parar() {
    const atual = ++operacao.current;
    setConectando(false);
    const novoEstado = await api.post<WhatsappState>("/whatsapp/stop");
    if (atual === operacao.current) aplicar(novoEstado);
  }

  async function desconectar() {
    const atual = ++operacao.current;
    setConectando(false);
    const novoEstado = await api.post<WhatsappState>("/whatsapp/disconnect");
    if (atual === operacao.current) aplicar(novoEstado);
  }

  return (
    <WhatsappContext.Provider
      value={{ ...state, carregado, conectando, conectar, parar, desconectar }}
    >
      {children}
    </WhatsappContext.Provider>
  );
}

export function useWhatsapp(): WhatsappContextValue {
  const ctx = useContext(WhatsappContext);
  if (!ctx)
    throw new Error(
      "useWhatsapp precisa ser usado dentro de um WhatsappProvider",
    );
  return ctx;
}

