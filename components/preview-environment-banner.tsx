import { getPreviewEnvironmentIdentity } from "@/lib/preview-environment";

export function PreviewEnvironmentBanner() {
  const identity = getPreviewEnvironmentIdentity();
  if (!identity.visible) return null;
  const label = ["PREVIEW", identity.classification, identity.abbreviatedRef, identity.commit].filter(Boolean).join(" · ");
  return (
    <div role={identity.warning ? "alert" : "status"} className={identity.warning ? "bg-red-700 px-3 py-2 text-center text-sm font-bold text-white" : "bg-amber-100 px-3 py-2 text-center text-sm font-semibold text-amber-950"}>
      {identity.warning ? `BLOCK UAT — PREVIEW IS USING PRODUCTION · ${identity.abbreviatedRef}` : label}
    </div>
  );
}
