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
    // The stack's certificate is self-signed, so the proxy does not verify it.
    proxy: {
      "/api": { target: "https://localhost:3000", changeOrigin: true, secure: false },
      "/media": { target: "https://localhost:3000", changeOrigin: true, secure: false },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
