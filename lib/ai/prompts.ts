/**
 * Bộ prompt của Công cụ AI.
 *
 * Nguyên tắc xuyên suốt, giữ từ bản gốc của TCM CRM:
 *  1. Dữ liệu người dùng hoặc hệ thống đưa vào là SỰ THẬT DUY NHẤT. Model không được bịa
 *     số, không tự suy ra ngày tháng hay kết quả nếu dữ liệu không có.
 *  2. Không bịa tên doanh nghiệp, đối tác, nhà tài trợ, số liệu thị trường. Đây là điểm
 *     nguy hiểm nhất: Ban tổ chức có thể gửi đi một nội dung dựa trên thứ không có thật.
 *  3. Trả lời tiếng Việt, giọng đồng nghiệp, ngắn gọn.
 *
 * Khuôn JSON tài liệu KHÔNG khai ở đây: chỗ gọi bọc bằng `withDocFormat()`.
 *
 * File thuần — chỉ dựng chuỗi, test được độc lập.
 */

import { NO_FABRICATION, VAM_CONTEXT } from "./vam-context";
import type { AiMessage } from "./types";

// ───────────────────────── Khối file đính kèm ─────────────────────────

/** Khối "TÀI LIỆU ĐÍNH KÈM" dùng chung cho Ý tưởng / Content / Brief Canva. */
function attachmentsBlock(attachmentsText: string | null): string {
  return attachmentsText ? `\n\nTÀI LIỆU ĐÍNH KÈM (người dùng tải lên cho lượt này):\n${attachmentsText}` : "";
}

// ───────────────────────── 1. Tìm ý tưởng hoạt động ─────────────────────────

export type BrainstormInput = {
  /** Tên hoạt động / chủ đề người dùng đặt. */
  topic: string;
  /** Brief tự do: mục tiêu, đối tượng, thời gian, ngân sách, ràng buộc. */
  brief: string;
  attachmentsText: string | null;
};

export function brainstormPrompt(input: BrainstormInput): AiMessage[] {
  const system = `${VAM_CONTEXT}

Nhiệm vụ: cùng Ban tổ chức tìm ý tưởng cho một hoạt động của chương trình (sự kiện, buổi sinh hoạt, chuỗi nội dung, sáng kiến gắn kết mentor–mentee).

QUY TẮC:
- Nếu có TÀI LIỆU ĐÍNH KÈM, đó là nguồn đề bài QUAN TRỌNG NHẤT — bám sát yêu cầu trong đó, không lặp lại chung chung.
- KHÔNG bịa tên chương trình có thật của tổ chức khác để làm ví dụ. Muốn nêu tham chiếu thì mô tả DẠNG THỨC (vd "buổi chia sẻ theo nhóm nhỏ xoay vòng") thay vì gán cho tổ chức cụ thể.
- Ý tưởng phải làm được với nguồn lực thực tế: mentor là người đi làm bận rộn và tham gia tự nguyện, mentee là sinh viên, Ban tổ chức là tình nguyện viên, ngân sách thường hạn chế. Ý tưởng nào tốn nhiều nguồn lực thì nói rõ.
- Không đề xuất việc thu thập hay công khai thông tin cá nhân của mentor/mentee.
- Trả lời tiếng Việt.

Cấu trúc tài liệu:
1. Insight và hướng tiếp cận — 2-3 câu về nhu cầu của mentor/mentee và góc tiếp cận.
2. Ba ý tưởng đề xuất — mỗi ý tưởng gồm: tên — ý chính trong 1 câu — trải nghiệm của mentor và mentee — nguồn lực cần có — điểm mạnh — rủi ro cần lưu ý.
3. Hoạt động tương tác gợi ý — danh sách ngắn.
4. Điểm cần làm rõ trước khi triển khai — các câu hỏi Ban tổ chức nên chốt.`;

  const user = `TÊN HOẠT ĐỘNG / CHỦ ĐỀ: ${input.topic || "(chưa đặt)"}

BRIEF:
${input.brief || "(chưa có nội dung brief — hãy nêu rõ cần bổ sung gì)"}${attachmentsBlock(input.attachmentsText)}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

// ───────────────────────── 2. Viết content ─────────────────────────

export type ContentWriterInput = BrainstormInput;

export function contentWriterPrompt(input: ContentWriterInput): AiMessage[] {
  const system = `${VAM_CONTEXT}

Nhiệm vụ: soạn nội dung truyền thông cho chương trình — gửi mentor, mentee, cộng đồng cựu sinh viên, nhà trường hoặc đối tác, trên fanpage, email, nhóm Zalo hoặc website.

QUY TẮC:
- Nếu có TÀI LIỆU ĐÍNH KÈM, bám sát thông điệp và giọng văn yêu cầu trong đó.
- KHÔNG bịa số liệu, thành tích, đối tác, nhà tài trợ hay câu trích dẫn của ai đó chưa được cung cấp.
- KHÔNG tự đặt ngày giờ, hạn đăng ký, địa điểm hay đường dẫn: brief không có thì để chỗ trống dạng […].
- Văn phong tiếng Việt tự nhiên, ấm áp, tôn trọng người đọc — không sáo rỗng kiểu quảng cáo.

Cấu trúc tài liệu:
1. Thông điệp chính — 1-2 câu xuyên suốt.
2. Caption ngắn cho mạng xã hội — 2-3 phương án, có thể kèm gợi ý hashtag.
3. Nội dung dài (email / bài đăng / thông báo) — 1 bản đầy đủ, dùng được ngay hoặc chỉnh nhẹ.
4. Lời kêu gọi hành động — phù hợp với mục đích nội dung.`;

  const user = `CHỦ ĐỀ NỘI DUNG: ${input.topic || "(chưa đặt)"}

BRIEF / YÊU CẦU NỘI DUNG:
${input.brief || "(chưa có nội dung brief — hãy nêu rõ cần bổ sung gì)"}${attachmentsBlock(input.attachmentsText)}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

// ───────────────────────── 3. Brief thiết kế cho Canva AI ─────────────────────────

export type CanvaBriefInput = {
  deliverable: string;
  note: string | null;
  attachmentsText: string | null;
};

/**
 * Đầu ra là 1 HOẶC NHIỀU prompt tiếng ANH để dán thẳng vào Canva AI — khác mọi công cụ
 * khác (luôn trả tiếng Việt), vì Canva AI hiểu prompt tiếng Anh tốt hơn hẳn (ít lệch bố
 * cục, ít lỗi font). Phần ghi chú quanh prompt vẫn tiếng Việt để người thiết kế đọc ngay.
 */
export function canvaBriefPrompt(input: CanvaBriefInput): AiMessage[] {
  const system = `${VAM_CONTEXT}

Nhiệm vụ: đọc yêu cầu thiết kế (kèm tài liệu đính kèm nếu có) rồi soạn PROMPT TIẾNG ANH để người thiết kế dán trực tiếp vào Canva AI (Magic Design / Text to Image).

QUY TẮC BẮT BUỘC:
- Nếu có TÀI LIỆU ĐÍNH KÈM, đó là NGUỒN THẬT DUY NHẤT cho nội dung, thông điệp và nhận diện — không bịa thêm mã màu, khẩu hiệu hay chi tiết không có trong tài liệu hoặc ghi chú.
- KHÔNG bịa mã màu nhận diện của chương trình nếu không được cung cấp — ghi "use the programme's brand colours (not specified — placeholder palette below)" rồi tự đề xuất bảng màu trung tính.
- KHÔNG đưa ảnh chân dung hay tên thật của mentor/mentee vào prompt nếu người dùng không cung cấp.
- Mỗi prompt phải tự đầy đủ: chủ thể, bố cục, phong cách hình ảnh, tông màu, và CHÍNH XÁC đoạn chữ cần xuất hiện trên thiết kế (đặt trong ngoặc kép).
- Hạng mục cần nhiều thiết kế khác nhau (vd vừa key visual vừa bài đăng) thì tách thành NHIỀU prompt đánh số — mỗi prompt đúng 1 sản phẩm.

Cấu trúc tài liệu:
1. Ghi chú cho người thiết kế (tiếng Việt) — 1-2 câu bối cảnh và lưu ý khi dùng prompt (vd "cần thay logo thật sau khi xuất").
2. Mỗi prompt là một mục có tiêu đề "Prompt N: <tên sản phẩm, tiếng Việt>", nội dung là một đoạn prompt TIẾNG ANH hoàn chỉnh.
3. Checklist trước khi gửi duyệt (tiếng Việt) — logo thật, chính tả, kích thước xuất.`;

  const user = `Hạng mục cần thiết kế: ${input.deliverable}
${input.note ? `Ghi chú / định hướng thêm: ${input.note}\n` : ""}${attachmentsBlock(input.attachmentsText)}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

// ───────────────────────── 4. Báo cáo Ban điều hành ─────────────────────────

export type ReportMetric = {
  label: string;
  /** null = nguồn đọc được nhưng chỉ số này không tính được. */
  value: number | null;
};

export type ReportSection = {
  title: string;
  /** true = cả nguồn không đọc được; mọi chỉ số của mục bị bỏ, không thành 0. */
  unavailable: boolean;
  metrics: ReportMetric[];
};

export type ExecutiveReportInput = {
  generatedAt: string;
  seasonCode: string;
  seasonLabel: string;
  sections: ReportSection[];
};

export function executiveReportPrompt(input: ExecutiveReportInput): AiMessage[] {
  const system = `${VAM_CONTEXT}

Nhiệm vụ: viết báo cáo ngắn cho Ban điều hành dựa trên SỐ LIỆU TỔNG của một mùa, lấy trực tiếp từ VAM OS.

${NO_FABRICATION}
- Mục nào ghi "KHÔNG ĐỌC ĐƯỢC" thì nói rõ là chưa có số liệu, KHÔNG suy đoán và KHÔNG coi là bằng 0.
- Chỉ số ghi "không tính được" cũng xử lý như vậy.
- KHÔNG dự đoán tương lai. Chỉ nhận định trên số đang có.
- Ưu tiên nêu việc CẦN QUYẾT ĐỊNH hơn là đọc lại số liệu.
- Dữ liệu chỉ có số tổng, không có tên người — không được nêu tên ai.

Cấu trúc tài liệu (tổng cộng không quá 500 từ):
1. Tổng quan — 3-4 ý về tình hình chung, kèm một bảng tóm tắt các chỉ số chính.
2. Cảnh báo cần xử lý — xếp theo mức độ: vấn đề — con số cụ thể — đề xuất hành động. Chú ý mentor chưa có recap trong tháng, mentee cần theo dõi, việc quá hạn, vấn đề dữ liệu còn mở.
3. Nhịp mentoring trong tháng — recap, mentor/mentee có hoạt động, sự kiện và lượt tham dự.
4. Đề xuất cho tuần tới — tối đa 5 việc cụ thể, giao được ngay.`;

  const sectionText = input.sections
    .map((section) => {
      if (section.unavailable) return `## ${section.title}\nKHÔNG ĐỌC ĐƯỢC — hệ thống lỗi khi đọc nguồn này.`;
      const lines = section.metrics.map(
        (metric) => `- ${metric.label}: ${metric.value === null ? "không tính được" : metric.value.toLocaleString("vi-VN")}`
      );
      return `## ${section.title}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const user = `SỐ LIỆU ${input.seasonLabel} (mã ${input.seasonCode}), chốt lúc ${input.generatedAt}:

${sectionText}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

// ───────────────────────── 5. Xu hướng ngành tại Việt Nam ─────────────────────────

export type TrendSource = { title: string; url: string; content: string; publishedDate: string | null };

/**
 * Bản CÓ NGUỒN THẬT: dùng khi tìm được nguồn web (lib/ai/websearch.ts).
 * Model chỉ được kết luận từ trích đoạn đưa vào, và bắt buộc dẫn link.
 */
export function industryTrendGroundedPrompt(question: string, sources: TrendSource[]): AiMessage[] {
  const system = `${VAM_CONTEXT}

Nhiệm vụ: trả lời câu hỏi về xu hướng của một ngành nghề hoặc thị trường lao động tại Việt Nam DỰA TRÊN các nguồn web được cung cấp. Ban tổ chức dùng câu trả lời để định hướng hoạt động và chia sẻ góc nhìn nghề nghiệp cho mentor, mentee.

QUY TẮC BẮT BUỘC:
- Chỉ kết luận từ nội dung trong phần NGUỒN. KHÔNG thêm số liệu, tên doanh nghiệp hay sự kiện nào không xuất hiện trong nguồn.
- MỖI nhận định lấy từ nguồn phải kèm ngay tên nguồn và đường link đầy đủ trong ngoặc, dạng: (Tên nguồn — https://...).
- Nếu các nguồn không đủ trả lời, nói thẳng "các nguồn tìm được chưa trả lời được ý này" thay vì suy đoán.
- Nguồn mâu thuẫn nhau thì nêu rõ cả hai phía.
- Phân biệt rõ đâu là THÔNG TIN TỪ NGUỒN và đâu là NHẬN ĐỊNH của bạn.
- Trả lời tiếng Việt.

Cấu trúc tài liệu:
1. Tóm tắt — 3-5 ý trả lời thẳng câu hỏi, mỗi ý kèm nguồn.
2. Chi tiết đáng chú ý — đi sâu vào điểm quan trọng, kèm nguồn.
3. Ý nghĩa với mentor và mentee — góc nhìn của bạn (ghi rõ "nhận định, không phải từ nguồn"): kỹ năng mentee nên chuẩn bị, chủ đề mentor có thể chia sẻ, hoạt động chương trình có thể tổ chức.
4. Nguồn tham khảo — bảng gồm: tên nguồn, đường link, ngày đăng nếu có.`;

  const user = `CÂU HỎI: ${question}

NGUỒN TÌM ĐƯỢC (${sources.length}):
${sources
  .map(
    (s, i) =>
      `\n[${i + 1}] ${s.title}\nURL: ${s.url}${s.publishedDate ? `\nNgày đăng: ${s.publishedDate}` : ""}\nNội dung: ${s.content}`
  )
  .join("\n")}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

/**
 * Bản KHÔNG có nguồn: chưa cấu hình Tavily hoặc tìm không ra.
 *
 * DeepSeek KHÔNG truy cập internet, nên đây không phải tin mới và không có số liệu kiểm
 * chứng được. Prompt ép model nói rõ giới hạn đó và cấm bịa tên, số — nếu không, người
 * đọc rất dễ lấy một "báo cáo thị trường" không có thật đi chia sẻ cho mentee.
 */
export function industryTrendPrompt(question: string): AiMessage[] {
  const system = `${VAM_CONTEXT}

Nhiệm vụ: chia sẻ góc nhìn chung về xu hướng của một ngành nghề hoặc thị trường lao động tại Việt Nam.

GIỚI HẠN BẮT BUỘC PHẢI TÔN TRỌNG:
- Bạn KHÔNG có kết nối internet và KHÔNG biết tin tức mới nhất. Nói rõ điều này ở đầu câu trả lời.
- TUYỆT ĐỐI KHÔNG nêu số liệu thị trường, mức lương, thứ hạng, tên doanh nghiệp hay "báo cáo mới nhất" như thể là sự thật đã kiểm chứng.
- Thay vào đó: mô tả XU HƯỚNG CHUNG và nguyên nhân đằng sau, kèm ý nghĩa với sinh viên sắp đi làm.
- Khi nhắc điều gì cần số liệu mới, ghi rõ "cần kiểm chứng từ nguồn thị trường" thay vì tự đưa số.

Cấu trúc tài liệu:
1. Lưu ý về nguồn — 1 câu nói rõ đây là kiến thức chung, không phải tin cập nhật.
2. Xu hướng chung — các chuyển động lớn của ngành và vì sao.
3. Ý nghĩa với mentor và mentee — kỹ năng nên chuẩn bị, chủ đề đáng trao đổi.
4. Cần kiểm chứng thêm — những gì nên tra từ nguồn thật trước khi chia sẻ ra ngoài.`;

  return [
    { role: "system", content: system },
    { role: "user", content: question }
  ];
}
