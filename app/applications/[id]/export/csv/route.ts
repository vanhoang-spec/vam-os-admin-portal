import { applicationExportCsv, applicationExportFilename } from "@/lib/application-export";
import { loadAuthorizedApplicationExport, privateExportHeaders } from "@/lib/application-export-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await loadAuthorizedApplicationExport(id);
  if (!result.ok) {
    return new Response(result.message, {
      status: result.status,
      headers: privateExportHeaders("text/plain; charset=utf-8")
    });
  }

  const filename = applicationExportFilename(result.data, "csv");
  return new Response(applicationExportCsv(result.data), {
    headers: privateExportHeaders("text/csv; charset=utf-8", filename)
  });
}
