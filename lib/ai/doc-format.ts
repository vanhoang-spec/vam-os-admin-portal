import type { AiMessage } from "./types";

/**
 * Bắt AI trả JSON theo khuôn `docSchema` (lib/doc-blocks.ts) thay vì văn xuôi.
 *
 * Một chỗ định nghĩa rồi CHÈN vào prompt sẵn có, thay vì chép vào từng prompt: khuôn
 * khối là thứ chung cho mọi công cụ và sẽ còn đổi (thêm loại khối); rải vào sáu chỗ
 * là sáu chỗ phải nhớ sửa cùng lúc.
 *
 * Nhắc "KHÔNG dùng ký tự markdown" là bắt buộc: model quen trả `**đậm**` và `- gạch
 * đầu dòng` ngay trong text của khối, mà không có bộ render markdown nào ở đây, nên
 * người dùng sẽ thấy nguyên mấy dấu sao trong file Word xuất ra.
 */
export const DOC_JSON_FORMAT = `
ĐỊNH DẠNG TRẢ VỀ — CHỈ JSON, không thêm chữ nào ngoài JSON:
{"title":"<tiêu đề tài liệu, 1 dòng>","blocks":[...]}

Mỗi phần tử của "blocks" là MỘT trong sáu loại:
{"type":"heading","level":1,"text":"..."}            (level chỉ 1, 2 hoặc 3)
{"type":"paragraph","text":"..."}
{"type":"bullets","items":["...","..."]}
{"type":"numbered","items":["...","..."]}
{"type":"table","headers":["..."],"rows":[["..."],["..."]]}
{"type":"terms","items":[{"term":"...","definition":"..."}]}

QUY TẮC ĐỊNH DẠNG:
- Có số liệu so sánh thì DÙNG "table", đừng nhét số vào câu văn.
- MỌI dòng trong "rows" phải đúng bằng số ô của "headers".
- TUYỆT ĐỐI không dùng ký tự markdown (**, ##, -, *) bên trong "text"/"items" — tài liệu này xuất
  thẳng ra file Word, mấy ký tự đó sẽ hiện nguyên trên giấy.
- Các mục trong phần hướng dẫn cấu trúc ở trên là "heading"; nội dung từng mục dùng "paragraph",
  "bullets", "numbered", "table" hoặc "terms".
- Mở đầu bằng 1 khối "paragraph" tóm tắt ngắn, rồi mới chia "heading" theo phần.
- Tối đa 120 khối. Viết đủ ý nhưng đừng dài dòng — vượt giới hạn là JSON bị cắt và hỏng cả tài liệu.`;

/** Chèn khuôn JSON vào cuối message system đầu tiên; prompt không có system thì thêm một cái ở đầu. */
export function withDocFormat(messages: AiMessage[]): AiMessage[] {
  let done = false;
  const out = messages.map((m) => {
    if (done || m.role !== "system") return m;
    done = true;
    return { ...m, content: `${m.content}\n${DOC_JSON_FORMAT}` };
  });
  return done ? out : [{ role: "system" as const, content: DOC_JSON_FORMAT }, ...out];
}
