/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Arial", "sans-serif"],
      },
      colors: {
        zinc: {
          50: "#f6f8f5", 100: "#eef2ed", 200: "#e3e9e3",
          300: "#cbd5cc", 400: "#9ba89f", 500: "#8b9c90",
          600: "#72867a", 700: "#3e5145", 800: "#2b3c31",
          900: "#24382f", 950: "#102019",
        },
        accent: {
          50: "#edf6ef",
          100: "#dceee1",
          200: "#b9dcc7",
          300: "#8bc4a4",
          400: "#4f9e79",
          500: "#157452",
          600: "#106044",
          700: "#10533c",
          800: "#114432",
          900: "#10392c",
        },
      },
      boxShadow: {
        soft: "0 5px 30px rgb(24 61 33 / 0.012)",
        card: "0 5px 30px rgb(24 61 33 / 0.012)",
      },
      borderRadius: {
        xl: "0.625rem",
        "2xl": "0.8125rem",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        "slide-up": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "slide-up": "slide-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
