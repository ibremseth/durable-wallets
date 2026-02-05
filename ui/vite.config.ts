import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/wallets": "http://localhost:9000",
      "/pool": "http://localhost:9000",
      "/health": "http://localhost:9000",
    },
  },
});
