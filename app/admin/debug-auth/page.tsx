import { notFound } from "next/navigation";
import { Card, DetailGrid, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser, getCurrentSupabaseAuthUser } from "@/lib/admin-auth";
import { getOperationsData } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getSupabasePublicEnvDiagnostics } from "@/lib/supabase";

export default async function DebugAuthPage() {
  const [authUser, adminUser] = await Promise.all([
    getCurrentSupabaseAuthUser(),
    getCurrentAdminUser()
  ]);

  if (!adminUser || adminUser.role !== "super_admin") notFound();

  const diagnostics = getSupabasePublicEnvDiagnostics();
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const operationsProbe = await getOperationsData(scope);
  const operationErrors = operationsProbe
    ? [
        operationsProbe.seasons.error,
        operationsProbe.people.error,
        operationsProbe.mentees.error,
        operationsProbe.matches.error,
        operationsProbe.recaps.error,
        operationsProbe.events.error,
        operationsProbe.eventParticipations.error,
        operationsProbe.kpis.error
      ].filter(Boolean)
    : [];

  return (
    <>
      <PageHeader title="Debug Auth" description="Non-secret diagnostics for Supabase Auth, VAM OS role resolution, and production env." />
      {operationErrors.length ? <ErrorBox message="Operations data probe has errors. See rows below." /> : null}
      <Card className="mb-6">
        <DetailGrid
          rows={[
            ["Supabase host", diagnostics.host],
            ["Project ref", diagnostics.projectRef],
            ["Expected production ref", "qkkroesfiazsejkzflcd"],
            ["Is production ref", diagnostics.projectRef === "qkkroesfiazsejkzflcd" ? "yes" : "no"],
            ["Is staging ref", diagnostics.projectRef === "ljfneyuvpxrmejpxsmpz" ? "yes" : "no"],
            ["Public key type", diagnostics.keyType],
            ["Has session", authUser ? "yes" : "no"],
            ["Auth user email", authUser?.email ?? "-"],
            ["Auth user id", authUser?.id ?? "-"],
            ["App role resolved", adminUser?.role ?? "-"],
            ["Admin user email", adminUser?.email ?? "-"],
            ["Admin user id", adminUser?.id ?? "-"],
            ["Admin status", adminUser?.status ?? "-"],
            ["Operations probe", operationsProbe ? (operationErrors.length ? "error" : "ok") : "not run"],
            ["Operations errors", operationErrors.join(" | ") || "-"]
          ]}
        />
      </Card>
    </>
  );
}
