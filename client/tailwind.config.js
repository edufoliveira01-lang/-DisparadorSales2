/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      colors: {
        zinc: {
          50: "#f3f6fb",
          100: "#eef0f6",
          200: "#e1e5ef",
          300: "#c7cedd",
          400: "#8993aa",
          500: "#647089",
          600: "#505d75",
          700: "#39455d",
          800: "#1c2840",
          900: "#111a2e",
          950: "#0b1220",
        },
        // Azul de ação (novo visual). `violet` e `indigo` apontam para a mesma escala: o que ainda usa essas classes ganha o azul sem mexer tela por tela.
        accent: {
          50: "#eff7ff",
          100: "#dcedfe",
          200: "#bfe0fd",
          300: "#93ccfb",
          400: "#5cb0f7",
          500: "#2f92ee",
          600: "#1678dc",
          700: "#1262b6",
          800: "#145093",
          900: "#154376",
          950: "#0e2a4c",
        },
        violet: {
          50: "#eff7ff", 100: "#dcedfe", 200: "#bfe0fd", 300: "#93ccfb", 400: "#5cb0f7", 500: "#2f92ee", 600: "#1678dc", 700: "#1262b6", 800: "#145093", 900: "#154376", 950: "#0e2a4c",
        },
        indigo: {
          50: "#eff7ff", 100: "#dcedfe", 200: "#bfe0fd", 300: "#93ccfb", 400: "#5cb0f7", 500: "#2f92ee", 600: "#1678dc", 700: "#1262b6", 800: "#145093", 900: "#154376", 950: "#0e2a4c",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgb(16 24 40 / 0.04), 0 2px 8px -2px rgb(16 24 40 / 0.06)",
        card: "0 4px 16px -6px rgb(16 24 40 / 0.12)",
        float: "0 16px 48px -16px rgb(16 24 40 / 0.28)",
      },
      borderRadius: { xl: "0.75rem", "2xl": "1rem", "3xl": "1.5rem" },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 280ms cubic-bezier(.22,1,.36,1)",
        shimmer: "shimmer 1.8s infinite",
      },
    },
  },
  plugins: [],
};
