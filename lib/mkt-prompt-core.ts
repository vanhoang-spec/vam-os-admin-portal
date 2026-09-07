import { scrubMenteeIdentity } from "@/lib/cross-post-core";
import { CHANNEL_LABELS, type MktChannel, type MktSlot } from "@/lib/mkt-core";

/**
 * lib/mkt-prompt-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the model is told, assembled in one testable place.
 *
 * Three decisions are worth reading before the code.
 *
 * THE BRAND NAME IS NEVER TYPED IN. The imported specification had a
 * `[TÊN THƯƠNG HIỆU]` placeholder in the brand profile. Here the name is read
 * from `programs.name` — "UEH Mentoring", "BK Mentoring", "Banking Mentoring" —
 * so a prompt cannot address the wrong programme, and renaming a programme
 * renames it everywhere at once. `resolveBrandName` is the only place it is
 * decided, and the tests pin it.
 *
 * THE STEERING BLOCK IS ALWAYS PRINTED. When a month or a week has no note, the
 * line still appears, reading `chưa có`. Dropping the line entirely tells the
 * model the concept does not exist, and it goes and invents a topic per post —
 * which is how a week ends up with seven unrelated ideas.
 *
 * NO MENTEE'S DETAILS LEAVE THE BUILDING. Requests are typed by organisers, and
 * an organiser pasting "bạn Hương, 09xx…" into a request is not unusual. Every
 * free-text field is scrubbed on the way in by the same function the
 * cross-mentoring post draft uses. Mentor names, titles and companies do go —
 * they are going onto a public page anyway.
 */

// ── Who the post is for ──────────────────────────────────────────────────────

/** The shared space's name. Used when a space belongs to no single programme. */
export const SHARED_SPACE_NAME = "VAM — Vietnam Alumni Mentoring";

/**
 * The name that appears in the prompt, and therefore in the post.
 *
 * A programme space is called by its programme's own name. The shared space —
 * the one that owns LinkedIn — speaks for the organisation.
 */
export function resolveBrandName(space: {
  programName?: string | null;
  isShared?: boolean;
}): string {
  if (space?.isShared) return SHARED_SPACE_NAME;

  const name = String(space?.programName ?? "").trim();
  return name || SHARED_SPACE_NAME;
}

/** One line describing what this space is, for the role sentence. */
export function resolveBrandScope(space: { isShared?: boolean }): string {
  return space?.isShared
    ? "kênh chung của cả hệ thống mentoring VAM, nói với cựu sinh viên đi làm và doanh nghiệp"
    : "một chương trình mentoring dành cho sinh viên, do cựu sinh viên dẫn dắt";
}

// ── The brand profile ────────────────────────────────────────────────────────

export type Pillar = { key?: string; name?: string; ratio?: number; note?: string };

export type BrandProfile = {
  description?: string | null;
  audience?: string | null;
  voice?: string | null;
  pillars?: Pillar[];
  cta?: string[];
  hashtags?: string[];
  doList?: string[];
  avoidList?: string[];
  /**
   * What the page looks like today, written by a person who read the last
   * 10–15 posts on it. Without this the model copies the current voice back,
   * because the current voice is all it can see.
   */
  diagnosis?: string | null;
};

export type ChannelBrief = {
  channel: MktChannel;
  postsPerWeek?: number;
  audience?: string | null;
  topics?: string | null;
  doWrite?: string | null;
  avoidWrite?: string | null;
  distinctAudience?: boolean;
};

const NONE = "chưa có";

function line(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || NONE;
}

function bullets(values: unknown): string {
  const items = Array.isArray(values)
    ? values.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  return items.length ? items.map((item) => `  - ${item}`).join("\n") : `  - ${NONE}`;
}

/** The pillar mix, with its percentages, so the week is balanced not random. */
export function formatPillars(pillars: Pillar[] | undefined): string {
  const items = (pillars ?? []).filter((pillar) => String(pillar?.name ?? "").trim());
  if (!items.length) return `  - ${NONE}`;

  return items
    .map((pillar) => {
      const ratio = Number(pillar.ratio);
      const share = Number.isFinite(ratio) && ratio > 0 ? ` (${Math.round(ratio)}%)` : "";
      const note = String(pillar.note ?? "").trim();
      return `  - ${String(pillar.name).trim()}${share}${note ? ` — ${note}` : ""}`;
    })
    .join("\n");
}

// ── Writing like a person ────────────────────────────────────────────────────

/**
 * The rules that keep the output from reading like a machine.
 *
 * Distilled deliberately short. The source material for this runs to hundreds
 * of lines, most of it English phrase lists that catch nothing in Vietnamese
 * and cost several thousand tokens on every single call. What survives is the
 * part that transfers: the banned Vietnamese clichés, the structural tells, and
 * the one rule that is about risk rather than taste.
 */
export const HUMAN_VOICE_RULES = [
  "VIẾT NHƯ NGƯỜI THẬT (bắt buộc):",
  "",
  "1.  Trước khi viết, tự trả lời: người đọc câu này đang cảm thấy gì? Phần lớn là sinh viên",
  "    đang lướt điện thoại lúc tối muộn, đã đọc hàng chục lời mời gọi trong ngày.",
  "2.  Câu đầu quyết định tất cả. Mở bằng chi tiết cụ thể nhất bạn có — một câu nói thật, một",
  "    con số, một khoảnh khắc. Không mở bằng \"Trong bối cảnh…\", \"Với sự phát triển…\".",
  "3.  Cấm cụm sáo rỗng: \"không chỉ… mà còn\", \"chính là\", \"đánh dấu bước ngoặt\",",
  "    \"góp phần khẳng định\", \"thể hiện rõ nét\", \"hành trình chinh phục\", \"sứ mệnh\",",
  "    \"đồng hành cùng\", \"trải nghiệm tuyệt vời\", \"môi trường lý tưởng\", \"nền tảng vững chắc\",",
  "    \"tự tin toả sáng\", \"khơi nguồn cảm hứng\", \"chắp cánh ước mơ\".",
  "4.  Cấm kết bài lên gân: \"Hãy để … đồng hành\", \"Tương lai tươi sáng đang chờ\",",
  "    \"Còn chần chừ gì nữa\". Kết bằng một lời mời cụ thể, đúng một câu.",
  "5.  Không dùng dấu gạch ngang dài. Dùng dấu chấm, phẩy, hai chấm hoặc ngoặc đơn.",
  "6.  Không nhóm ba: đừng ép mọi thứ thành ba vế cho đủ nhịp.",
  "7.  Không bôi đậm máy móc. Emoji tối đa 1–2 cái mỗi bài, đặt đúng chỗ cảm xúc.",
  "8.  Câu dài ngắn xen kẽ. Đừng để câu nào cũng dài bằng nhau.",
  "9.  Không viết câu tổng kết ý nghĩa (\"Đây không chỉ là …, mà là …\"). Dừng ở chi tiết thật.",
  "10. Xưng hô đúng cách sinh viên tự xưng. Không trang trọng sáo.",
  "11. TUYỆT ĐỐI KHÔNG BỊA: không bịa tên sinh viên, tên mentor, lời khen, con số, thành tích.",
  "    Cần chỗ điền thì để [tên mentee] hoặc [số liệu] cho người phụ trách điền.",
  "    Thà viết câu nhạt mà thật.",
  "12. Chi tiết cụ thể luôn thắng tính từ.",
  "13. Viết như đang kể cho một người, không phải phát biểu trước hội trường."
].join("\n");

// ── System prompt ────────────────────────────────────────────────────────────

/**
 * Four blocks, in this order on purpose.
 *
 * Role, then who the brand is, then who each channel is for, then how to write.
 * The channel block sits before the writing rules because "who am I writing
 * for" has to be settled before "how do I write" means anything.
 */
export function buildSystemPrompt(input: {
  brandName: string;
  brandScope: string;
  brand?: BrandProfile;
  channels?: ChannelBrief[];
}): string {
  const brand = input.brand ?? {};

  const blocks: string[] = [
    `Bạn là người phụ trách nội dung của ${input.brandName} — ${input.brandScope}.`,
    "Bạn viết tiếng Việt, giọng thân thiện và tôn trọng, không sáo rỗng.",
    "",
    "HỒ SƠ THƯƠNG HIỆU:",
    `  Tên dùng trong bài: ${input.brandName}`,
    `  Mô tả: ${line(brand.description)}`,
    `  Đối tượng: ${line(brand.audience)}`,
    `  Giọng văn: ${line(brand.voice)}`,
    "  Trụ cột nội dung:",
    formatPillars(brand.pillars),
    "  Kêu gọi hành động thường dùng:",
    bullets(brand.cta),
    "  Hashtag:",
    bullets(brand.hashtags),
    "  Nên làm:",
    bullets(brand.doList),
    "  Tránh:",
    bullets(brand.avoidList),
    `  Hiện trạng trang (đọc kỹ, đây là thứ cần sửa): ${line(brand.diagnosis)}`,
    "",
    buildChannelBlock(input.channels ?? []),
    "",
    HUMAN_VOICE_RULES
  ];

  return blocks.join("\n");
}

/**
 * Who each channel is for.
 *
 * A channel marked as having a different audience says so in capitals, because
 * the failure this prevents — LinkedIn getting a post written for first-year
 * students — is invisible in the output unless you know who it was meant for.
 */
export function buildChannelBlock(channels: ChannelBrief[]): string {
  const active = (channels ?? []).filter((brief) => brief?.channel);
  if (!active.length) {
    return "ĐỊNH HƯỚNG RIÊNG TỪNG KÊNH:\n  chưa có";
  }

  const parts = active.map((brief) => {
    const label = CHANNEL_LABELS[brief.channel] ?? brief.channel;
    const header = brief.distinctAudience
      ? `[${label}] (ĐỐI TƯỢNG KHÁC HẲN — không dùng chung ý tưởng với kênh khác)`
      : `[${label}]`;

    return [
      header,
      `  Người đọc: ${line(brief.audience)}`,
      `  Chủ đề được viết: ${line(brief.topics)}`,
      `  Nên: ${line(brief.doWrite)}`,
      `  Tránh: ${line(brief.avoidWrite)}`
    ].join("\n");
  });

  return [
    "ĐỊNH HƯỚNG RIÊNG TỪNG KÊNH (bắt buộc — sai kênh là bài hỏng, dù viết hay tới đâu):",
    ...parts,
    "Quy tắc chung: xác định kênh của bài TRƯỚC, rồi mới nghĩ ý tưởng.",
    "Không bê chủ đề của kênh này sang kênh khác."
  ].join("\n");
}

// ── The steering block ───────────────────────────────────────────────────────

export type Direction = {
  monthTheme?: string | null;
  monthNotes?: string | null;
  weekTopic?: string | null;
  weekFocus?: string | null;
  weekNotes?: string | null;
};

/**
 * The month's and the week's direction, loaded into every prompt that generates
 * content — planning a week and rewriting a single post alike.
 *
 * Missing it in one of them is how the first version of this went wrong
 * elsewhere: the rewrite function received day, channel, pillar and idea, and
 * no context whatsoever, so every rewritten post drifted onto its own topic.
 */
export function buildDirectionBlock(direction: Direction = {}): string {
  return [
    "ĐỊNH HƯỚNG PHẢI BÁM (đọc kỹ trước khi nghĩ ý tưởng):",
    `[THÁNG] chủ đề: ${line(direction.monthTheme)}`,
    `[THÁNG] định hướng nội dung: ${line(direction.monthNotes)}`,
    `[TUẦN] chủ đề: ${line(direction.weekTopic)}`,
    `[TUẦN] trọng tâm: ${line(direction.weekFocus)}`,
    `[TUẦN] định hướng nội dung: ${line(direction.weekNotes)}`,
    "Mọi bài trong đợt này phải phục vụ chủ đề và định hướng ở trên; bài nào lệch thì đổi góc",
    "nhìn chứ không đổi chủ đề. Nếu định hướng mâu thuẫn hồ sơ thương hiệu thì ưu tiên định",
    "hướng, trừ phần TRÁNH."
  ].join("\n");
}

// ── Requests from the programme ──────────────────────────────────────────────

export type MktOrder = {
  id: string;
  title: string;
  purpose?: string | null;
  body?: string | null;
  wantedChannels?: string[];
  neededBy?: string | null;
  isUrgent?: boolean;
  contentPriority?: string | null;
  createdAt?: string | null;
};

const PRIORITY_RANK: Record<string, number> = { high: 0, priority: 1, normal: 2 };
const PRIORITY_LABEL: Record<string, string> = {
  high: "ƯU TIÊN CAO",
  priority: "ƯU TIÊN",
  normal: "thường"
};

/**
 * Put the requests in order before the model sees them.
 *
 * Sorting is arithmetic and creating is not; asking one pass to do both gets
 * you a list that is neither well ordered nor well written. The prompt then
 * says "keep this order", and the numbering makes it checkable.
 */
export function sortOrders(orders: MktOrder[]): MktOrder[] {
  return [...(orders ?? [])].sort((a, b) => {
    const rankA = PRIORITY_RANK[String(a?.contentPriority ?? "normal")] ?? 2;
    const rankB = PRIORITY_RANK[String(b?.contentPriority ?? "normal")] ?? 2;
    if (rankA !== rankB) return rankA - rankB;

    // Same priority: whoever asked first is served first.
    return String(a?.createdAt ?? "").localeCompare(String(b?.createdAt ?? ""));
  });
}

export function formatOrders(orders: MktOrder[]): string {
  const sorted = sortOrders(orders);
  if (!sorted.length) return "Không có đề nghị nào tuần này.";

  return sorted
    .map((order, index) => {
      const priority = PRIORITY_LABEL[String(order.contentPriority ?? "normal")] ?? "thường";
      const urgent = order.isUrgent ? " + gấp tiến độ" : "";
      const channels = (order.wantedChannels ?? []).length
        ? ` · mong muốn: ${(order.wantedChannels ?? []).join(", ")}`
        : "";
      const needed = order.neededBy ? ` · cần lên trước ${order.neededBy}` : "";

      return [
        `${index + 1}. [${order.id.slice(0, 8)}] ${priority}${urgent}${needed}${channels}`,
        `      ${scrubMenteeIdentity(order.title)}`,
        order.purpose ? `      mục đích: ${scrubMenteeIdentity(order.purpose)}` : "",
        `      nội dung đề nghị: ${scrubMenteeIdentity(order.body).slice(0, 500)}`
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export const ORDER_INSTRUCTIONS = [
  "CÁCH XỬ LÝ ĐỀ NGHỊ (làm đúng trình tự):",
  "a) Với TỪNG đề nghị, so nội dung của nó với định hướng tháng/tuần rồi tự phân loại:",
  "   - TRÙNG chủ đề: gộp làm MỘT bài phục vụ cả hai. Lấy chi tiết thật trong đề nghị (tên",
  "     hoạt động, ngày, địa điểm, quyền lợi) làm bằng chứng cho định hướng.",
  "   - GẦN chủ đề: giữ một bài, lấy góc nhìn của định hướng làm khung, đề nghị làm nội dung.",
  "   - KHÁC hẳn: tách bài riêng. KHÔNG bỏ đề nghị chỉ vì lệch định hướng — đó là cam kết với",
  "     người đã gửi. Xếp vào ngày hợp lịch nhất so với hạn cần lên.",
  "b) Nội dung cụ thể của đề nghị được ưu tiên TRƯỚC nội dung chung của plan. Đề nghị ƯU TIÊN",
  "   CAO xếp vào ngày sớm nhất và kênh mạnh nhất trong tuần.",
  "c) Slot còn lại sau khi phủ hết đề nghị mới dành cho nội dung chung theo tỷ lệ trụ cột.",
  "d) Với mỗi bài phục vụ đề nghị, ghi mã đề nghị vào \"order_ref\".",
  "e) Nếu đề nghị nhiều hơn slot: giữ đề nghị ưu tiên cao, liệt kê mã những đề nghị chưa xếp",
  "   được vào \"orders_unplaced\" để người phụ trách xử lý tay. Đừng im lặng bỏ qua."
].join("\n");

// ── The real calendar ────────────────────────────────────────────────────────

export type CalendarItem = {
  label: string;
  date?: string | null;
  kind?: string | null;
};

/**
 * What is genuinely happening, read out of the application's own tables.
 *
 * This is the difference between a plan that announces real events on the right
 * days and a plan that invents a content calendar in a vacuum. Names of events
 * and sessions go in; nobody's personal details do.
 */
export function formatCalendar(items: CalendarItem[]): string {
  const rows = (items ?? []).filter((item) => String(item?.label ?? "").trim());
  if (!rows.length) return "Không có hoạt động nào được ghi nhận trong khoảng này.";

  return rows
    .map((item) => {
      const when = item.date ? `${item.date}` : "chưa có ngày";
      const kind = item.kind ? ` (${item.kind})` : "";
      return `  - ${when}: ${scrubMenteeIdentity(item.label)}${kind}`;
    })
    .join("\n");
}

// ── The three user prompts ───────────────────────────────────────────────────

export function buildMasterPlanPrompt(input: {
  brandName: string;
  month: string;
  weekStarts: string[];
  calendar?: CalendarItem[];
  previousTheme?: string | null;
}): string {
  return [
    `Lập master plan nội dung tháng ${input.month} cho ${input.brandName}.`,
    "",
    "CÁC TUẦN TRONG THÁNG (mỗi tuần bắt đầu Thứ Hai):",
    input.weekStarts.map((week, index) => `  Tuần ${index + 1}: ${week}`).join("\n"),
    "",
    "HOẠT ĐỘNG THẬT ĐÃ CÓ TRONG HỆ THỐNG:",
    formatCalendar(input.calendar ?? []),
    "",
    input.previousTheme ? `Chủ đề tháng trước: ${input.previousTheme}. Đừng lặp lại y hệt.` : "",
    "",
    "Trả về DUY NHẤT một khối JSON theo đúng khuôn:",
    "{",
    '  "theme": "chủ đề tháng, một câu ngắn",',
    '  "goals": ["mục tiêu đo được", "..."],',
    '  "content_notes": "định hướng nội dung cả tháng, 3-5 câu",',
    '  "weekly_focus": [',
    '    { "week_start": "YYYY-MM-DD", "focus": "...", "topic": "...", "note": "..." }',
    "  ],",
    '  "notes": "ghi chú cho người phụ trách"',
    "}",
    "Số phần tử weekly_focus phải bằng đúng số tuần ở trên, đúng thứ tự."
  ]
    .filter((block) => block !== "")
    .join("\n");
}

export function buildWeekPlanPrompt(input: {
  brandName: string;
  weekStart: string;
  slots: MktSlot[];
  direction?: Direction;
  orders?: MktOrder[];
  calendar?: CalendarItem[];
}): string {
  return [
    `Lập plan nội dung tuần bắt đầu ${input.weekStart} cho ${input.brandName}.`,
    "",
    buildDirectionBlock(input.direction),
    "",
    "HOẠT ĐỘNG THẬT TRONG TUẦN (lấy từ hệ thống, dùng làm bằng chứng, không bịa thêm):",
    formatCalendar(input.calendar ?? []),
    "",
    "ĐỀ NGHỊ ĐĂNG BÀI (đã sắp theo thứ tự ưu tiên — GIỮ NGUYÊN thứ tự này):",
    formatOrders(input.orders ?? []),
    "",
    ORDER_INSTRUCTIONS,
    "",
    "DANH SÁCH SLOT ĐÃ CHIA SẴN (không được thêm, bớt hay đổi ngày/kênh):",
    input.slots
      .map(
        (slot) =>
          `  - ${slot.postDate} · ${CHANNEL_LABELS[slot.channel] ?? slot.channel} · ${slot.slotTime} · nhóm ${slot.variantGroup}`
      )
      .join("\n"),
    "",
    "Bài cùng một nhóm là MỘT ý tưởng ở nhiều dạng khác nhau theo kênh, không phải nhiều ý rời rạc.",
    "",
    "Trả về DUY NHẤT một khối JSON theo đúng khuôn:",
    "{",
    '  "topic": "chủ đề tuần",',
    '  "focus": "trọng tâm tuần",',
    '  "content_notes": "định hướng nội dung tuần",',
    '  "order_review": [',
    '    { "order_ref": "8 ký tự đầu của mã", "relation": "trung|gan|khac", "handling": "một câu" }',
    "  ],",
    '  "orders_unplaced": ["mã đề nghị chưa xếp được"],',
    '  "posts": [',
    "    {",
    '      "date": "YYYY-MM-DD", "channel": "facebook|tiktok|youtube|linkedin",',
    '      "variant_group": "đúng nhóm của slot",',
    '      "pillar": "tên trụ cột", "idea": "ý tưởng một câu",',
    '      "content": "caption hoàn chỉnh viết theo đúng kênh",',
    '      "hashtags": ["#..."], "cta": "một câu",',
    '      "order_ref": "mã đề nghị nếu bài này phục vụ đề nghị, không thì bỏ trống",',
    '      "brief": { "format": "...", "size": "...", "visual": "...",',
    '                 "text_on_image": "...", "assets_needed": "...", "deadline": "YYYY-MM-DD" }',
    "    }",
    "  ]",
    "}",
    `Mảng posts phải có đúng ${input.slots.length} phần tử, mỗi phần tử ứng với đúng một slot ở trên.`
  ].join("\n");
}

export function buildPostRewritePrompt(input: {
  brandName: string;
  post: {
    postDate: string;
    channel: MktChannel;
    pillar?: string | null;
    idea?: string | null;
    content?: string | null;
  };
  instruction?: string | null;
  direction?: Direction;
  calendar?: CalendarItem[];
}): string {
  const channel = CHANNEL_LABELS[input.post.channel] ?? input.post.channel;

  return [
    `Viết lại một bài đăng cho ${input.brandName}.`,
    "",
    buildDirectionBlock(input.direction),
    "",
    "HOẠT ĐỘNG THẬT LIÊN QUAN:",
    formatCalendar(input.calendar ?? []),
    "",
    "BÀI CẦN VIẾT LẠI:",
    `  Ngày: ${input.post.postDate}`,
    `  Kênh: ${channel}`,
    `  Trụ cột: ${line(input.post.pillar)}`,
    `  Ý tưởng: ${line(input.post.idea)}`,
    `  Nội dung hiện tại: ${line(input.post.content)}`,
    "",
    input.instruction
      ? `YÊU CẦU CỦA NGƯỜI PHỤ TRÁCH: ${scrubMenteeIdentity(input.instruction)}`
      : "YÊU CẦU CỦA NGƯỜI PHỤ TRÁCH: viết lại cho hay hơn, bám đúng định hướng ở trên.",
    "",
    "Trả về DUY NHẤT một khối JSON:",
    "{",
    '  "idea": "ý tưởng một câu",',
    '  "content": "caption hoàn chỉnh",',
    '  "hashtags": ["#..."], "cta": "một câu",',
    '  "brief": { "format": "...", "size": "...", "visual": "...",',
    '             "text_on_image": "...", "assets_needed": "...", "deadline": "YYYY-MM-DD" }',
    "}"
  ].join("\n");
}

// ── One last look before anything is stored ──────────────────────────────────

/**
 * Does this draft look like it invented somebody?
 *
 * The rules tell the model not to make up names and numbers. "Told not to" is
 * not a guarantee, and a fabricated student testimonial on a programme's
 * fanpage is the kind of mistake that is discussed publicly. A contact detail
 * appearing in generated copy is a reason to look before publishing, not a
 * reason to refuse to save.
 */
export function draftNeedsChecking(content: unknown): { ok: boolean; reason?: string } {
  const text = String(content ?? "");
  if (!text.trim()) return { ok: false, reason: "Nội dung rỗng." };

  const scrubbed = scrubMenteeIdentity(text);
  if (scrubbed !== text.trim().replace(/\s{2,}/g, " ")) {
    return {
      ok: false,
      reason: "bài có email, số điện thoại hoặc mã số — vui lòng kiểm tra trước khi đăng."
    };
  }

  return { ok: true };
}
