/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "#0a0e14",
          soft: "#0f1620",
          card: "#121a26",
          hover: "#182230",
        },
        line: "#1f2c3d",
        ink: {
          DEFAULT: "#e6edf3",
          soft: "#9bb0c4",
          dim: "#5f7185",
        },
        bull: {
          DEFAULT: "#22c55e",
          soft: "#16331f",
        },
        bear: {
          DEFAULT: "#ef4444",
          soft: "#3a1717",
        },
        accent: {
          DEFAULT: "#38bdf8",
          soft: "#0c2a3a",
        },
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        glow: "0 0 0 1px rgba(56,189,248,0.25), 0 0 24px -4px rgba(56,189,248,0.25)",
      },
      keyframes: {
        pulseSoft: {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseSoft: "pulseSoft 2s ease-in-out infinite",
        slideUp: "slideUp 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
