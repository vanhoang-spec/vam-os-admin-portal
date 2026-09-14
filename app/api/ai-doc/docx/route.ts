import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { AI_RESULT_NOTE } from "@/lib/ai/ai-core";
import { docFileName, parseAiDoc } from "@/lib/doc-blocks";
import { buildDocx, DOCX_MIME } from "@/lib/docx-builder";
import { canUseAiTools } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tài liệu 120 khối cỡ lớn nhất cũng dưới 1MB JSON; lớn hơn thế không phải thứ màn hình gửi. */
const MAX_DOC_JSON_CHARS = 2_000_000;

/**
 * Tên file trong Content-Disposition theo RFC 6266: một bản ASCII cho trình duyệt cũ,
 * một bản UTF-8 đầy đủ. Header HTTP chỉ nhận Latin-1 — ghép thẳng tên có dấu vào là
 * lỗi 500 đúng lúc người dùng bấm tải.
 */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Xuất tài liệu AI ra file Word.
 *
 * Nhận JSON tài liệu TỪ CHÍNH FORM đang hiển thị chứ không đọc database: kết quả AI
 * không được lưu ở đâu, nên không có id nào để tra. Nội dung đi ra đúng bằng nội dung
 * người dùng đang nhìn, nên không có rủi ro lộ dữ liệu chéo.
 *
 * Vẫn phải chạy lại `parseAiDoc`: người dùng sửa được hidden input, và `buildDocx` ghép
 * chuỗi vào XML — payload rác sẽ đẻ ra file Word không mở được.
 */
export async function POST(request: Request) {
  let adminUser: Awaited<ReturnType<typeof getCurrentAdminUser>>;
  try {
    adminUser = await getCurrentAdminUser();
  } catch (error) {
    console.error("[AI] xuất Word: không đọc được người dùng hiện tại", error);
    return new NextResponse("Không xác minh được phiên đăng nhập.", { status: 503 });
  }
  if (!adminUser?.id) return new NextResponse("Bạn chưa đăng nhập.", { status: 401 });
  if (!canUseAiTools(adminUser.role)) return new NextResponse("Bạn không có quyền dùng Công cụ AI.", { status: 403 });

  let raw: FormDataEntryValue | null;
  try {
    raw = (await request.formData()).get("doc");
  } catch {
    return new NextResponse("Yêu cầu không hợp lệ.", { status: 400 });
  }
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_DOC_JSON_CHARS) {
    return new NextResponse("Yêu cầu không hợp lệ.", { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new NextResponse("Yêu cầu không hợp lệ.", { status: 400 });
  }
  const doc = parseAiDoc(parsed);
  if (!doc) return new NextResponse("Yêu cầu không hợp lệ.", { status: 400 });

  const buffer = buildDocx(doc, { note: AI_RESULT_NOTE });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": attachmentDisposition(docFileName(doc.title, "docx")),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}
