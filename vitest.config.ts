import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig sets jsx:"preserve" for Next; tests need a runtime transform.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    // Each test file gets its own worker context. Without this, a file that
    // leaves `globalThis.fetch` or an env var mutated hands that state to the
    // next file scheduled onto the same worker, which is order-dependent and
    // therefore only fails some of the time.
    isolate: true,
    // A `vi.spyOn` whose test throws before its own `mockRestore()` would
    // otherwise stay installed for every later test in the file. Restoring
    // centrally makes cleanup independent of whether the test body completed.
    restoreMocks: true,
    // Same reasoning for `vi.stubEnv` / `vi.stubGlobal`.
    unstubEnvs: true,
    unstubGlobals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "__tests__/support/server-only.ts"),
    },
  },
});
