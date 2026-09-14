/**
 * DANH MỤC LOẠI VĂN BẢN cho công cụ "Soạn thảo văn bản" ở `/ai`.
 *
 * Để ở CODE, mỗi loại đi kèm một BỐ CỤC có thật đưa vào prompt. `outline` là thứ quyết
 * định chất lượng bản soạn: không có nó thì model trả một bài văn xuôi đúng nội dung
 * nhưng sai khuôn văn bản hành chính (thiếu "Nơi nhận", thiếu căn cứ, thiếu chỗ ký).
 *
 * Bản gốc có thêm "Văn bản kế toán" — chủ dự án bỏ ngày 14/09/2026 cùng các tính năng kế
 * toán khác. Xin duyệt kinh phí vẫn soạn được bằng "Tờ trình / Đề xuất".
 *
 * File THUẦN: ô chọn loại văn bản ở client import được.
 */

export type DocumentTypeCode =
  | "DECISION"
  | "ANNOUNCEMENT"
  | "OFFICIAL_LETTER"
  | "PROPOSAL"
  | "MINUTES"
  | "REGULATION"
  | "VOLUNTEER_LETTER"
  | "OTHER";

export type DocumentType = {
  code: DocumentTypeCode;
  label: string;
  /** Gợi ý ngắn hiện dưới ô chọn — cho người dùng biết chọn đúng loại. */
  hint: string;
  /** Bố cục chuẩn, đưa thẳng vào prompt. */
  outline: string[];
};

export const DOCUMENT_TYPES: DocumentType[] = [
  {
    code: "DECISION",
    label: "Quyết định",
    hint: "Thành lập ban, phân công nhiệm vụ, ghi nhận mentor/tình nguyện viên, ban hành quy chế",
    outline: [
      "Tên loại văn bản + trích yếu (VỀ VIỆC ...)",
      "Căn cứ ban hành (quy chế chương trình, đề nghị của ban phụ trách) — chỉ nêu căn cứ NGƯỜI DÙNG đã cung cấp",
      "Các điều khoản đánh số: Điều 1 nội dung quyết định · Điều 2 hiệu lực · Điều 3 trách nhiệm thi hành",
      "Nơi nhận",
      "Chỗ ký: chức danh người ký (bỏ trống tên nếu người dùng không nêu)"
    ]
  },
  {
    code: "ANNOUNCEMENT",
    label: "Thông báo",
    hint: "Lịch sinh hoạt, thay đổi quy trình, nhắc việc tới mentor, mentee hoặc đội vận hành",
    outline: [
      "Tên loại văn bản + trích yếu",
      "Đoạn mở: lý do/căn cứ thông báo",
      "Nội dung thông báo (gạch đầu dòng hoặc đánh số nếu nhiều mục)",
      "Thời điểm áp dụng và đầu mối liên hệ khi cần hỏi thêm",
      "Nơi nhận + chỗ ký"
    ]
  },
  {
    code: "OFFICIAL_LETTER",
    label: "Công văn gửi ra ngoài",
    hint: "Gửi nhà trường, doanh nghiệp đối tác, nhà tài trợ, đơn vị hỗ trợ địa điểm",
    outline: [
      "Kính gửi: (tên đơn vị nhận)",
      "Trích yếu: về việc ...",
      "Đoạn mở: giới thiệu ngắn chương trình và lý do gửi công văn",
      "Nội dung đề nghị/trao đổi, tách ý rõ ràng",
      "Đề nghị cụ thể + mốc thời gian mong nhận phản hồi",
      "Lời cảm ơn + chỗ ký"
    ]
  },
  {
    code: "PROPOSAL",
    label: "Tờ trình / Đề xuất",
    hint: "Trình Ban điều hành duyệt kinh phí, nhân sự, phương án tổ chức",
    outline: [
      "Kính gửi + trích yếu",
      "Hiện trạng và lý do đề xuất",
      "Nội dung đề xuất (phương án, số lượng, kinh phí — DÙNG BẢNG nếu có số)",
      "Lợi ích / rủi ro nếu không làm",
      "Kiến nghị cụ thể cần phê duyệt",
      "Chỗ ký người trình"
    ]
  },
  {
    code: "MINUTES",
    label: "Biên bản",
    hint: "Biên bản họp, bàn giao, làm việc với đối tác, sự việc",
    outline: [
      "Tên loại văn bản + trích yếu",
      "Thời gian, địa điểm",
      "Thành phần tham dự (bên A / bên B nếu là bàn giao)",
      "Nội dung diễn biến hoặc danh mục bàn giao (DÙNG BẢNG nếu là danh mục)",
      "Kết luận / cam kết của các bên",
      "Biên bản lập thành mấy bản, mỗi bên giữ mấy bản + chỗ ký các bên"
    ]
  },
  {
    code: "REGULATION",
    label: "Quy định / Quy chế",
    hint: "Quy chế chương trình, bộ quy tắc ứng xử, quy trình phối hợp",
    outline: [
      "Tên quy định + phạm vi áp dụng và đối tượng áp dụng",
      "Giải thích từ ngữ (nếu có thuật ngữ riêng)",
      "Các điều khoản đánh số theo chương/điều",
      "Trách nhiệm thi hành và cách xử lý khi vi phạm",
      "Hiệu lực thi hành + chỗ ký"
    ]
  },
  {
    code: "VOLUNTEER_LETTER",
    label: "Thư gửi mentor / tình nguyện viên",
    hint: "Thư mời tham gia, xác nhận tham gia, thư cảm ơn, nhắc cam kết",
    outline: [
      "Kính gửi: (tên người nhận, chức danh nếu có)",
      "Trích yếu",
      "Nội dung chính, nêu rõ mốc thời gian và điều kiện kèm theo nếu có",
      "Việc người nhận cần làm tiếp theo và hạn phản hồi",
      "Chỗ ký đại diện Ban tổ chức"
    ]
  },
  {
    code: "OTHER",
    label: "Khác",
    hint: "Loại chưa có trong danh sách — mô tả rõ ở phần nội dung",
    outline: ["Tự chọn bố cục hợp lý theo mô tả của người dùng, vẫn phải có trích yếu và chỗ ký"]
  }
];

export function resolveDocumentType(code: string | null | undefined): DocumentType | null {
  return DOCUMENT_TYPES.find((d) => d.code === code) ?? null;
}

/** Trần ký tự ô "nội dung / dữ kiện" — đủ cho một brief dài, chặn dán nhầm cả tệp vào ô nhập. */
export const MAX_DOCUMENT_BRIEF = 8000;
/** Trần chữ lấy từ file mẫu tham chiếu gửi sang DeepSeek. */
export const MAX_DOCUMENT_REF_CHARS = 20000;
