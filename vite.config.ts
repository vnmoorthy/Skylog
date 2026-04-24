import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
//
// `base` is set to "/Skylog/" only at build time so the production bundle
// hosted on GitHub Pages resolves assets from /Skylog/. Local `vite dev`
// still uses "/" so there's no friction during development.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/Skylog/" : "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // MapLibre alone is ~800 KB uncompressed; nothing else we depend on
    // comes close. Raise the limit rather than chasing false-positive
    // warnings.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Isolate MapLibre so the initial bundle parses faster when the
        // user first lands. MapLibre loads on the Dashboard, not the
        // HomeSetup screen, so this slices a second off first-paint.
        manualChunks: {
          maplibre: ["maplibre-gl"],
        },
      },
    },
  },
}));
