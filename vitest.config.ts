import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // UI tests (*.test.tsx) pick jsdom with a `@vitest-environment jsdom` comment at the top
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
