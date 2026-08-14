import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Only used by `npm run dev`. In Docker, Caddy sits in front and both the
    // SPA and the API share an origin, which is what lets the refresh cookie
    // work without any CORS involvement.
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/media": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
