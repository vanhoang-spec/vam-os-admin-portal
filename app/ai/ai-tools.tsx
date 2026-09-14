"use client";

import { useState } from "react";
// useFormState, không phải useActionState: dự án chạy React 18.3.1, nơi hook đó
// chưa tồn tại. @types/react khai báo nó nên tsc vẫn cho qua — chỉ tới lúc dựng
// component mới vỡ.
import { useFormState } from "react-dom";
import {
  askIndustryTrend,
  brainstormIdeas,
  draftDocument,
  generateCanvaBrief,
  generateExecutiveReport,
  writeContent
} from "@/app/actions/ai-tools";
import { initialAiState } from "@/lib/ai-action-types";
import { AI_INPUT_LIMITS } from "@/lib/ai/ai-core";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BRIEF, type DocumentTypeCode } from "@/lib/ai/document-types";
import { MAX_AI_FILES } from "@/lib/ai/upload-core";
import { AiFileInput } from "./ai-file-input";
import { AiResult, RunButton, ToolCard, aiInputClass, aiLabelClass, keepFormValues } from "./ai-shared";

const ATTACH_HINT = `PDF, DOCX, XLSX, TXT, CSV, MD — tối đa ${MAX_AI_FILES} file, mỗi file 8MB. AI chỉ đọc chữ trong file; file scan dạng ảnh không đọc được. App không lưu file.`;

// ───────────────────────── Tìm ý tưởng hoạt động ─────────────────────────

export function BrainstormTool() {
  const [state, action] = useFormState(brainstormIdeas, initialAiState);
  return (
    <ToolCard
      title="Tìm ý tưởng hoạt động"
      description="Mô tả hoạt động cần làm (sự kiện, buổi sinh hoạt, chuỗi nội dung…), AI đề xuất ba hướng kèm nguồn lực, rủi ro và câu hỏi cần chốt."
    >
      <form action={action} onReset={keepFormValues} className="space-y-3">
        <div>
          <label htmlFor="bs-topic" className={aiLabelClass}>Tên hoạt động / chủ đề</label>
          <input id="bs-topic" name="topic" maxLength={AI_INPUT_LIMITS.topic} placeholder="Ví dụ: Buổi networking giữa kỳ cho mentee năm 3" className={aiInputClass} />
        </div>
        <div>
          <label htmlFor="bs-brief" className={aiLabelClass}>Brief</label>
          <textarea id="bs-brief" name="brief" rows={4} maxLength={AI_INPUT_LIMITS.brief} placeholder="Mục tiêu, đối tượng, thời gian, ngân sách, những hướng đã loại trừ…" className={aiInputClass} />
        </div>
        <AiFileInput id="bs-files" name="files" multiple label="Tài liệu đính kèm (tuỳ chọn)" hint={ATTACH_HINT} />
        <RunButton hasResult={Boolean(state.doc)} />
      </form>
      <AiResult state={state} />
    </ToolCard>
  );
}

// ───────────────────────── Viết content ─────────────────────────

export function ContentTool() {
  const [state, action] = useFormState(writeContent, initialAiState);
  return (
    <ToolCard
      title="Viết content"
      description="AI soạn thông điệp chính, caption mạng xã hội, bài dài và lời kêu gọi hành động cho mentor, mentee, cộng đồng hoặc đối tác."
    >
      <form action={action} onReset={keepFormValues} className="space-y-3">
        <div>
          <label htmlFor="ct-topic" className={aiLabelClass}>Chủ đề nội dung</label>
          <input id="ct-topic" name="topic" maxLength={AI_INPUT_LIMITS.topic} placeholder="Ví dụ: Mở đăng ký mentee Mùa 12" className={aiInputClass} />
        </div>
        <div>
          <label htmlFor="ct-brief" className={aiLabelClass}>Yêu cầu nội dung</label>
          <textarea id="ct-brief" name="brief" rows={4} maxLength={AI_INPUT_LIMITS.brief} placeholder="Mục đích, kênh đăng, người đọc, giọng văn, thông tin bắt buộc phải có…" className={aiInputClass} />
        </div>
        <AiFileInput id="ct-files" name="files" multiple label="Tài liệu đính kèm (tuỳ chọn)" hint={ATTACH_HINT} />
        <RunButton hasResult={Boolean(state.doc)} />
      </form>
      <AiResult state={state} />
    </ToolCard>
  );
}

// ───────────────────────── Brief thiết kế Canva ─────────────────────────

export function CanvaBriefTool() {
  const [state, action] = useFormState(generateCanvaBrief, initialAiState);
  return (
    <ToolCard
      title="Brief thiết kế cho Canva AI"
      description="AI soạn prompt tiếng Anh để dán thẳng vào Canva AI, kèm ghi chú và checklist cho người thiết kế."
    >
      <form action={action} onReset={keepFormValues} className="space-y-3">
        <div>
          <label htmlFor="cv-deliverable" className={aiLabelClass}>Hạng mục cần thiết kế</label>
          <input id="cv-deliverable" name="deliverable" required maxLength={AI_INPUT_LIMITS.deliverable} placeholder="Key visual, backdrop, standee, bài đăng Facebook…" className={aiInputClass} />
        </div>
        <div>
          <label htmlFor="cv-note" className={aiLabelClass}>Ghi chú / định hướng (tuỳ chọn)</label>
          <textarea id="cv-note" name="note" rows={3} maxLength={AI_INPUT_LIMITS.note} placeholder="Nội dung chữ trên thiết kế, tông màu, phong cách hình ảnh, điều cần tránh…" className={aiInputClass} />
        </div>
        <AiFileInput id="cv-files" name="files" multiple label="Tài liệu đính kèm (tuỳ chọn)" hint={ATTACH_HINT} />
        <RunButton hasResult={Boolean(state.doc)} />
      </form>
      <AiResult state={state} />
    </ToolCard>
  );
}

// ───────────────────────── Báo cáo Ban điều hành ─────────────────────────

export function ExecutiveReportTool({ seasonCode, seasonName }: { seasonCode: string; seasonName: string }) {
  const [state, action] = useFormState(generateExecutiveReport, initialAiState);
  return (
    <ToolCard
      title="Báo cáo Ban điều hành"
      description={`Tổng hợp tình hình ${seasonName} từ số liệu hiện có trên VAM OS: tuyển sinh, ghép cặp, recap, sự kiện, việc vận hành.`}
    >
      <form action={action} onReset={keepFormValues} className="space-y-3">
        <input type="hidden" name="season" value={seasonCode} />
        <p className="text-xs text-slate-500">
          Chỉ các con số tổng (không có tên, email hay số điện thoại) được gửi sang DeepSeek. Số liệu lấy tại thời điểm bấm chạy, khớp với các trang vận hành.
        </p>
        <RunButton hasResult={Boolean(state.doc)} />
      </form>
      <AiResult state={state} />
    </ToolCard>
  );
}

// ───────────────────────── Xu hướng ngành ─────────────────────────

export function TrendTool({ webSearchOn }: { webSearchOn: boolean }) {
  const [state, action] = useFormState(askIndustryTrend, initialAiState);
  return (
    <ToolCard
      title="Xu hướng ngành tại Việt Nam"
      description="Hỏi về xu hướng một ngành nghề hoặc thị trường lao động, để định hướng hoạt động và chia sẻ cho mentor, mentee."
    >
      {/* Đặt TRƯỚC ô nhập: người đọc phải biết câu trả lời lấy từ đâu trước khi đọc nó. */}
      {webSearchOn ? (
        <p className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
          Đã bật tìm kiếm web: trợ lý đọc các nguồn thật trên internet (ưu tiên nguồn Việt Nam, trong 12 tháng gần đây) rồi tổng hợp, kèm link để bạn tự kiểm chứng.
        </p>
      ) : (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Chưa bật tìm kiếm web: trợ lý KHÔNG truy cập internet, không biết tin mới và không dẫn được số liệu có thật. Chỉ dùng như gợi ý tư duy.
        </p>
      )}
      <form action={action} onReset={keepFormValues} className="space-y-3">
        <div>
          <label htmlFor="tr-question" className={aiLabelClass}>Câu hỏi</label>
          <textarea id="tr-question" name="question" rows={3} required maxLength={AI_INPUT_LIMITS.question} placeholder="Ví dụ: Ngành logistics đang tuyển những vị trí nào cho sinh viên mới ra trường?" className={aiInputClass} />
        </div>
        <RunButton hasResult={Boolean(state.doc)} />
      </form>
      {state.doc ? (
        <p data-testid="trend-grounding" className={`mt-3 text-xs ${state.grounded ? "text-green-700" : "text-amber-800"}`}>
          {state.grounded
            ? `Câu trả lời dựa trên ${state.sourceCount ?? 0} nguồn web — kiểm tra link trong phần Nguồn tham khảo.`
            : "Không có nguồn web. Câu trả lời dưới đây chỉ là kiến thức chung, không có link kiểm chứng."}
        </p>
      ) : null}
      <AiResult state={state} />
    </ToolCard>
  );
}

// ───────────────────────── Soạn thảo văn bản ─────────────────────────

export function DocumentTool() {
  const [state, action] = useFormState(draftDocument, initialAiState);
  const [typeCode, setTypeCode] = useState<DocumentTypeCode>(DOCUMENT_TYPES[0].code);
  const current = DOCUMENT_TYPES.find((item) => item.code === typeCode) ?? DOCUMENT_TYPES[0];

  return (
    <ToolCard
      title="Soạn thảo văn bản"
      description="Quyết định, thông báo, công văn, tờ trình, biên bản, quy chế, thư gửi mentor — AI soạn theo bố cục hành chính, tải về Word hoặc PDF."
    >
      <form action={action} onReset={keepFormValues} className="space-y-3">
        <div>
          <label htmlFor="doc-type" className={aiLabelClass}>Loại văn bản</label>
          <select id="doc-type" name="docType" value={typeCode} onChange={(event) => setTypeCode(event.target.value as DocumentTypeCode)} className={aiInputClass}>
            {DOCUMENT_TYPES.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{current.hint}</p>
        </div>
        <div>
          <label htmlFor="doc-subject" className={aiLabelClass}>Trích yếu (tuỳ chọn)</label>
          <input id="doc-subject" name="subject" maxLength={AI_INPUT_LIMITS.subject} placeholder="Ví dụ: Về việc tổ chức buổi Mentor Orientation Mùa 12" className={aiInputClass} />
        </div>
        <div>
          <label htmlFor="doc-brief" className={aiLabelClass}>Nội dung / dữ kiện</label>
          <textarea id="doc-brief" name="brief" rows={5} required maxLength={MAX_DOCUMENT_BRIEF} placeholder="Nêu đủ dữ kiện: việc gì, từ ngày nào, áp dụng cho ai, ai phụ trách, kinh phí nếu có…" className={aiInputClass} />
          <p className="mt-1 text-xs text-slate-500">Đây là nguồn dữ kiện DUY NHẤT. Thiếu thông tin thì AI để chỗ trống […] chứ không tự đoán.</p>
        </div>
        <AiFileInput
          id="doc-reference"
          name="reference"
          label="File mẫu tham chiếu (tuỳ chọn)"
          hint="Một file PDF, DOCX, TXT hoặc MD — AI học bố cục và cách hành văn, không chép số liệu. File chỉ dùng cho lượt chạy này rồi bỏ."
        />
        <RunButton hasResult={Boolean(state.doc)} />
      </form>
      <AiResult state={state} />
    </ToolCard>
  );
}
