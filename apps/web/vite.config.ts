import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const apiDevUrl = process.env.OPENDROP_API_DEV_URL || "http://localhost:3000";
const apiDevOrigin = new URL(apiDevUrl).origin;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    cors: {
      origin: Array.from(new Set(["http://localhost:3000", "http://127.0.0.1:3000", apiDevOrigin]))
    },
    proxy: {
      "/__dev": apiDevUrl,
      "/api": apiDevUrl,
      "/preview": apiDevUrl
    }
  },
  build: {
    manifest: true,
    rollupOptions: {
      input: "src/main.tsx"
    }
  }
});
