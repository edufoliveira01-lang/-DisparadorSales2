/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        zinc: {
          50: "#f6f8f5", 100: "#eef2ed", 200: "#e3e9e3",
          300: "#cbd5cc", 400: "#8a9a8f", 500: "#65786b",
          600: "#506456", 700: "#3e5145", 800: "#2b3c31",
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
        soft: "0 1px 3px rgb(36 56 47 / 0.03)",
        card: "0 2px 5px rgb(36 56 47 / 0.035)",
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
