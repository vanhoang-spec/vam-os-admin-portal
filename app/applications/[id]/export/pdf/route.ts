import { applicationExportFilename } from "@/lib/application-export";
import { applicationExportPdf } from "@/lib/application-export-pdf";
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

  const filename = applicationExportFilename(result.data, "pdf");
  try {
    const pdf = await applicationExportPdf(result.data);
    return new Response(new Uint8Array(pdf), {
      headers: privateExportHeaders("application/pdf", filename)
    });
  } catch (error) {
    console.error("[application-export] PDF generation failed", {
      applicationId: result.data.applicationId,
      message: error instanceof Error ? error.message : String(error)
    });
    return new Response("Không thể tạo tệp PDF.", {
      status: 500,
      headers: privateExportHeaders("text/plain; charset=utf-8")
    });
  }
}
