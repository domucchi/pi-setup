import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["extensions/**/*.test.ts"],
    exclude: ["reference/**", "node_modules/**"],
  },
});
