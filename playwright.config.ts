import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level acceptance tests for the login form.
 *
 * These run against a real `next build` + `next start`, i.e. the same compiled
 * React runtime the browser receives in production. That matters: React's
 * form-action plugin and `useFormStatus()` only exist in Next's compiled
 * react-dom, so a jsdom suite running the stable `react-dom` package from
 * node_modules cannot exercise them and can only ever assert its own mocks.
 *
 * Supabase env vars are pinned empty for both the build and the server, so
 * `getSupabaseAuthClientForPasswordSignIn()` returns null and the login server
 * action deterministically resolves to its "network unavailable" state. The
 * suite therefore exercises the real Next server-action round trip while making
 * any outbound Supabase call impossible — no staging or production contact.
 */
const PORT = 3411;

const offlineSupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1"
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: offlineSupabaseEnv
  }
});
