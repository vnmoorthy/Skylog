import type { Config } from "tailwindcss";

/**
 * SKYLOG tailwind config.
 *
 * Design constraints:
 *  - Single accent color (warm orange #ff8a4c). No blue.
 *  - Dark near-black surface. No gradients.
 *  - Inter for UI, JetBrains Mono for numerals.
 *  - Loudness scale: cool gray -> pale yellow -> deep orange-red.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0b",
          900: "#111114",
          850: "#15151a",
          800: "#1b1b22",
          700: "#27272f",
          600: "#3a3a44",
          500: "#5a5a67",
          400: "#8a8a96",
          300: "#b4b4bd",
          200: "#d4d4db",
          100: "#ececef",
        },
        accent: {
          DEFAULT: "#ff8a4c",
          soft: "#ffb07d",
          deep: "#e56a25",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontVariantNumeric: {
        tabular: "tabular-nums",
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "4px",
        md: "6px",
      },
      ringWidth: {
        DEFAULT: "1px",
      },
    },
  },
  plugins: [],
};

export default config;
