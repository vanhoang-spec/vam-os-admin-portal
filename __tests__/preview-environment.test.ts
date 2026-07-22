import { describe, expect, it } from "vitest";
import { getPreviewEnvironmentIdentity } from "@/lib/preview-environment";

describe("preview environment identity", () => {
  it("is hidden for production even when production Supabase is configured", () => {
    const result = getPreviewEnvironmentIdentity({ NODE_ENV: "production", VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://qkkroesfiazsejkzflcd.supabase.co" });
    expect(result.visible).toBe(false);
    expect(result.classification).toBe("PRODUCTION");
    expect(result.warning).toBe(false);
  });
  it("classifies staging preview without exposing keys", () => {
    const result = getPreviewEnvironmentIdentity({ NODE_ENV: "production", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://ljfneyuvpxrmejpxsmpz.supabase.co", VERCEL_GIT_COMMIT_SHA: "1234567890" });
    expect(result).toMatchObject({ visible: true, classification: "STAGING", abbreviatedRef: "ljfn…smpz", commit: "1234567", warning: false });
  });
  it("raises a prominent warning when a preview resolves to production", () => {
    const result = getPreviewEnvironmentIdentity({ NODE_ENV: "production", VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "https://qkkroesfiazsejkzflcd.supabase.co" });
    expect(result.visible).toBe(true);
    expect(result.warning).toBe(true);
  });
  it("fails closed to unknown for missing or malformed URLs", () => {
    expect(getPreviewEnvironmentIdentity({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "not-a-url" })).toMatchObject({ visible: true, classification: "UNKNOWN", abbreviatedRef: "unknown" });
  });
});
