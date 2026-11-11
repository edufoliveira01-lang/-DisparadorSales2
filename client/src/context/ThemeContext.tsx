import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/** O tema que está valendo na tela. */
export type Theme = "light" | "dark";
/** O que a pessoa escolhe: claro, escuro ou automático (segue o computador/navegador). */
export type ThemeMode = Theme | "system";

const STORAGE_KEY = "disparazap:theme";

interface ThemeContextValue {
  /** O tema resolvido (nunca «system»). */
  theme: Theme;
  /** A escolha da pessoa. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Compatível com quem só conhece claro/escuro: grava essa escolha. */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "system" ? v : "light"; // padrão: claro
  } catch {
    return "light";
  }
}

const sistemaEscuro = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveTheme(mode: ThemeMode): Theme {
  return mode === "system" ? (sistemaEscuro() ? "dark" : "light") : mode;
}

export function getInitialTheme(): Theme {
  return resolveTheme(getInitialMode());
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(getInitialMode()));

  useEffect(() => {
    const aplicar = () => { const t = resolveTheme(mode); setTheme(t); applyTheme(t); };
    aplicar();
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // A interface continua funcionando mesmo quando o navegador bloqueia o armazenamento local.
    }
    if (mode !== "system" || typeof window.matchMedia !== "function") return;
    const midia = window.matchMedia("(prefers-color-scheme: dark)");
    midia.addEventListener("change", aplicar); // no automático, acompanha o computador em tempo real
    return () => midia.removeEventListener("change", aplicar);
  }, [mode]);

  return <ThemeContext.Provider value={{ theme, mode, setMode, setTheme: setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme deve ser usado dentro de ThemeProvider");
  return context;
}
