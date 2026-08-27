import { legacyMentorTemplateCsv } from "@/lib/legacy-mentor-import";

export async function GET() {
  return new Response(legacyMentorTemplateCsv(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="vam-s12-legacy-mentors.csv"'
    }
  });
}
