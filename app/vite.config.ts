import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/utils/**", "src/store/**"],
    },
  },
  server: {
    proxy: {
      "/events": "http://localhost:4000",
      "/config": "http://localhost:4000",
    },
  },
});
