import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

/**
 * The built app is served by the FastAPI server in app/server.py: index.html at
 * `/` and everything else under `/static/`, which is why the build writes into
 * app/static and every asset URL is prefixed with /static/. The bundle is
 * committed, so the Docker image and the Modal deployment stay Python-only.
 */
export default defineConfig({
  base: "/static/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, "../app/static"),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    // `npm run dev` talks to a local `python app/server.py` on port 8000.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
})
