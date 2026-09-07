/**
 * lib/cross-post-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The draft fanpage post, and the line the AI is not allowed across.
 *
 * Deliberately dependency-light and free of `server-only`, so the whole of it
 * can be tested — and the part worth testing hardest is what goes INTO the
 * prompt, not what comes out.
 *
 * WHAT THE MODEL MAY SEE. The owner agreed to one narrow exception: the
 * mentor's name, job title, company and field. Those four are going onto a
 * public Facebook page within the week, so a model reading them discloses
 * nothing that is not about to be broadcast anyway.
 *
 * WHAT IT MAY NEVER SEE. The mentee. Not their name, not their email, not their
 * phone number, not their student number. A mentee asked for help with their
 * career; that is theirs. Their topic goes in — the whole post is about the
 * topic — but stripped of anything that identifies who asked.
 *
 * `buildPostPrompt` is the only place the payload is assembled, and
 * `scrubMenteeIdentity` runs over every free-text field on the way in. The
 * tests assert both.
 */

// ── The line ─────────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Vietnamese mobile numbers, as people actually type them: 0912345678,
 * 0912 345 678, 091.234.5678, +84912345678.
 */
const PHONE_PATTERN = /(?:\+?84|0)\s?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}/g;

/** Student numbers as the programme writes them, e.g. UEHEM11104, 31201020123. */
const STUDENT_ID_PATTERN = /\b(?:[A-Z]{2,6}\d{4,10}|\d{9,12})\b/g;

const FACEBOOK_PATTERN = /(?:https?:\/\/)?(?:www\.|m\.)?(?:facebook|fb)\.(?:com|me)\/\S+/gi;

/**
 * Remove anything that could name the mentee from free text.
 *
 * Belt and braces: the caller already passes only the topic and the note, and
 * neither field is supposed to hold contact details — but mentees type what
 * they type, and "email mình là ..." in a topic box would otherwise be handed
 * to a third-party model verbatim.
 *
 * Replacements are neutral words rather than deletions, so a sentence that
 * contained one still reads as a sentence.
 */
export function scrubMenteeIdentity(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";

  return text
    .replace(EMAIL_PATTERN, "[email đã ẩn]")
    .replace(FACEBOOK_PATTERN, "[liên kết đã ẩn]")
    .replace(PHONE_PATTERN, "[số điện thoại đã ẩn]")
    .replace(STUDENT_ID_PATTERN, "[mã số đã ẩn]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── The payload ──────────────────────────────────────────────────────────────

export type PostMentor = {
  fullName: string;
  jobTitle?: string | null;
  company?: string | null;
};

export type PostInput = {
  fieldLabel: string;
  topic?: string | null;
  mentors: PostMentor[];
  timeLabel?: string | null;
  location?: string | null;
  seasonLabel?: string | null;
  registerUrl?: string | null;
};

export const POST_PROMPT_VERSION = "cross-post-v1";

export const POST_SYSTEM_PROMPT = [
  "Bạn là người viết nội dung cho fanpage của một chương trình mentoring sinh viên tại Việt Nam.",
  "Bạn viết tiếng Việt, giọng thân thiện và tôn trọng, không sáo rỗng, không dùng tiếng Anh khi có từ tiếng Việt tương đương.",
  "",
  "Quy tắc bắt buộc:",
  "- Chỉ dùng thông tin được cung cấp. Không bịa tên người, tên công ty, thành tích, con số hay lịch trình.",
  "- Không nhắc tới mentee nào cụ thể. Buổi này mở cho tất cả các bạn mentee.",
  "- Không hứa hẹn thay ban tổ chức (ví dụ: chắc chắn có quà, chắc chắn có ghi hình).",
  "- Nếu thiếu thời gian hoặc địa điểm thì viết là sẽ thông báo sau, đừng tự điền.",
  "",
  "Đây là BẢN NHÁP cho team truyền thông đọc lại và sửa, không phải bài đăng cuối cùng."
].join("\n");

/**
 * Assemble what the model is told.
 *
 * Every free-text field goes through the scrubber; the mentor block is written
 * out plainly because those are the details meant to be published.
 */
export function buildPostPrompt(input: PostInput): string {
  const mentors = (input.mentors ?? [])
    .filter((mentor) => String(mentor?.fullName ?? "").trim())
    .map((mentor) => {
      const parts = [String(mentor.fullName).trim()];
      const title = String(mentor.jobTitle ?? "").trim();
      const company = String(mentor.company ?? "").trim();
      if (title) parts.push(title);
      if (company) parts.push(company);
      return `- ${parts.join(" — ")}`;
    });

  const lines = [
    "Viết một bài đăng fanpage giới thiệu buổi cross-mentoring sắp diễn ra.",
    "",
    `Lĩnh vực: ${String(input.fieldLabel ?? "").trim() || "(chưa rõ)"}`
  ];

  const topic = scrubMenteeIdentity(input.topic);
  if (topic) lines.push(`Nội dung các bạn mentee muốn nghe: ${topic}`);

  if (input.seasonLabel) lines.push(`Mùa: ${String(input.seasonLabel).trim()}`);

  lines.push("", mentors.length ? "Mentor chia sẻ:" : "Mentor chia sẻ: (chưa chốt)");
  lines.push(...mentors);

  lines.push(
    "",
    `Thời gian: ${String(input.timeLabel ?? "").trim() || "(sẽ thông báo sau)"}`,
    `Địa điểm: ${String(input.location ?? "").trim() || "(sẽ thông báo sau)"}`
  );

  if (input.registerUrl) lines.push(`Link đăng ký: ${String(input.registerUrl).trim()}`);

  lines.push(
    "",
    "Yêu cầu về bài viết:",
    "- Độ dài 120–200 từ.",
    "- Mở đầu bằng một câu chạm được vào điều các bạn sinh viên đang băn khoăn trong lĩnh vực này.",
    "- Giới thiệu mentor bằng đúng tên và chức danh đã cho.",
    "- Nêu rõ thời gian, địa điểm, cách đăng ký.",
    "- Kết bằng một lời mời ngắn.",
    "- Tối đa 5 hashtag ở cuối, tiếng Việt không dấu hoặc tiếng Anh.",
    "",
    "Chỉ trả về nội dung bài đăng, không thêm lời dẫn hay giải thích."
  );

  return lines.join("\n");
}

/**
 * Tidy what came back.
 *
 * Models like to wrap prose in fences or announce themselves first; the draft
 * goes straight into a textarea an organiser edits, so it should arrive clean.
 */
export function parsePostDraft(raw: unknown): string {
  let text = String(raw ?? "").trim();
  if (!text) return "";

  const fenced = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();

  text = text.replace(/^(?:bài đăng|bản nháp|draft)\s*:?\s*\n+/i, "");

  return text.slice(0, 8000).trim();
}

/**
 * A last check before the draft is stored.
 *
 * The model was told not to invent a mentee, but "told not to" is not a
 * guarantee. If a phone number or an email appears in what came back, that is a
 * reason to look, not to publish.
 */
export function draftLooksSafe(draft: unknown): { ok: boolean; reason?: string } {
  const text = String(draft ?? "");
  if (!text.trim()) return { ok: false, reason: "Bản nháp rỗng." };

  if (EMAIL_PATTERN.test(text)) {
    EMAIL_PATTERN.lastIndex = 0;
    return { ok: false, reason: "Bản nháp có địa chỉ email — vui lòng kiểm tra lại trước khi đăng." };
  }
  EMAIL_PATTERN.lastIndex = 0;

  if (PHONE_PATTERN.test(text)) {
    PHONE_PATTERN.lastIndex = 0;
    return { ok: false, reason: "Bản nháp có số điện thoại — vui lòng kiểm tra lại trước khi đăng." };
  }
  PHONE_PATTERN.lastIndex = 0;

  return { ok: true };
}
