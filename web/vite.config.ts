import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// DESIGN.md Bölüm 7 — Admin panel + chat bot, aynı Express uygulaması (app/) içinde
// ayrı route'lar olarak sunulur. Dev'de Vite kendi portunda çalışır ve /api isteklerini
// app/'ye proxy'ler; production build'i app/'nin static olarak servis ettiği dist/'e çıkar.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
