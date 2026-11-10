import { defineConfig } from "vitest/config";

// Server handler unit tests must not be transformed into TanStack RPC stubs.
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: { include: ["src/lib/__tests__/*.server-test.ts"] },
});