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
          50: "#f6f7fb",
          100: "#eef0f6",
          200: "#e1e5ef",
          300: "#c7cedd",
          400: "#8993aa",
          500: "#647089",
          600: "#505d75",
          700: "#39455d",
          800: "#252e43",
          900: "#182033",
          950: "#101626",
        },
        accent: {
          50: "#f3f0ff",
          100: "#e9e2ff",
          200: "#d6c8ff",
          300: "#bba2ff",
          400: "#a07aff",
          500: "#8556ee",
          600: "#7340d9",
          700: "#6030b9",
          800: "#502a97",
          900: "#432779",
          950: "#2b1655",
        },
      },
      boxShadow: {
        soft: "0 4px 24px -12px rgb(30 35 74 / 0.12)",
        card: "0 6px 28px -16px rgb(30 35 74 / 0.16)",
        float: "0 20px 60px -20px rgb(39 30 80 / 0.25)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.25rem", "3xl": "1.75rem" },
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
