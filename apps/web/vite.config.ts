import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Only used by `npm run dev`, which serves the storefront from source and
    // hands everything else to the stack `./start.sh` is already running.
    // Cookies are scoped to a host and not to a port, so the refresh cookie
    // the API sets on localhost arrives here as well and the session survives.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/media": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
