import { accountImportTemplateCsv } from "@/lib/account-import";

export function GET() {
  return new Response(accountImportTemplateCsv(), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=vam-account-import-template.csv", "cache-control": "no-store" } });
}
