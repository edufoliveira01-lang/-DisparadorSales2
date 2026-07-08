import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8081,
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:3333",
      "/socket.io": {
        target: "http://127.0.0.1:3333",
        ws: true,
      },
    },
  },
});
