import type { Config } from "tailwindcss";

import plugin from "tailwindcss/plugin";

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
          50: "var(--ink-50)",
          100: "var(--ink-100)",
          200: "var(--ink-200)",
          300: "var(--ink-300)",
          400: "var(--ink-400)",
          500: "var(--ink-500)",
          600: "var(--ink-600)",
          700: "var(--ink-700)",
          800: "var(--ink-800)",
          900: "var(--ink-900)",
          950: "var(--ink-950)",
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
  plugins: [
    plugin(function ({ addBase }) {
      addBase({
        ":root": {
          "--ink-50": "#0a0a0b",
          "--ink-100": "#111114",
          "--ink-200": "#27272f",      
          "--ink-300": "#3a3a44",      
          "--ink-400": "#48484f",      
          "--ink-500": "#63636e",     
          "--ink-600": "#8a8a96",   
          "--ink-700": "#b4b4bd",   
          "--ink-800": "#d1d1d6",
          "--ink-900": "#ffffff",
          "--ink-950": "#f8f8f9",
        },
        ".dark": {
          "--ink-50": "#f8f8f9",
          "--ink-100": "#ececef",
          "--ink-200": "#d1d1d6",
          "--ink-300": "#b4b4bd",
          "--ink-400": "#8a8a96",
          "--ink-500": "#63636e",
          "--ink-600": "#48484f",
          "--ink-700": "#3a3a44",
          "--ink-800": "#27272f",
          "--ink-900": "#111114",
          "--ink-950": "#0a0a0b",
        },
      });
    }),
  ],
};

export default config;