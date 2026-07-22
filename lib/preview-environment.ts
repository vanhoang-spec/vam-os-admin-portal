const STAGING_REF = "ljfneyuvpxrmejpxsmpz";
const PRODUCTION_REF = "qkkroesfiazsejkzflcd";

export type PreviewEnvironmentIdentity = {
  visible: boolean;
  classification: "STAGING" | "PRODUCTION" | "UNKNOWN";
  projectRef: string;
  abbreviatedRef: string;
  commit: string | null;
  warning: boolean;
};

function projectRefFromUrl(value: string | undefined) {
  if (!value) return "unknown";
  try { return new URL(value.trim()).hostname.split(".")[0] || "unknown"; } catch { return "unknown"; }
}

function abbreviate(value: string) {
  if (value === "unknown") return value;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function getPreviewEnvironmentIdentity(env: NodeJS.ProcessEnv = process.env): PreviewEnvironmentIdentity {
  const visible = env.VERCEL_ENV === "preview" || (env.NODE_ENV === "development" && env.VERCEL_ENV !== "production");
  const projectRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const classification = projectRef === STAGING_REF ? "STAGING" : projectRef === PRODUCTION_REF ? "PRODUCTION" : "UNKNOWN";
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || null;
  return { visible, classification, projectRef, abbreviatedRef: abbreviate(projectRef), commit, warning: visible && classification === "PRODUCTION" };
}
