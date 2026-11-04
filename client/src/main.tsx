import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { IdentidadeProvider } from "./context/IdentidadeContext";
import { applyTheme, getInitialTheme, ThemeProvider } from "./context/ThemeContext";
import { aplicarModoLeve } from "./lib/desempenho";
import "./index.css";

applyTheme(getInitialTheme());
aplicarModoLeve();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <IdentidadeProvider>
            <App />
          </IdentidadeProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
