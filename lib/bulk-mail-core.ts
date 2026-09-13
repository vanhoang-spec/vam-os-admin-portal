/**
 * lib/bulk-mail-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của một lượt gửi hàng loạt: gửi cho ai, điền gì vào thư, và một
 * lượt được phép làm bao nhiêu trong một lần chạy.
 *
 * Không I/O — để test chạy được mà không cần database và không gửi thư thật.
 */

import { normalizeEmailAddress } from "@/lib/email-core";
import { TEMPLATE_SPECS, type TemplateKind } from "@/lib/email-templates-core";

/**
 * Các nhóm nhận thư.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO MỖI NHÓM LÀ MỘT CÂU TRUY VẤN VIẾT SẴN, KHÔNG PHẢI MỘT BỘ LỌC TỰ DO
 * ---------------------------------------------------------------------------
 * Một lô không gửi xong trong một lần chạy, và lần "Gửi tiếp" dựng lại danh sách
 * từ nhóm đã chốt vào lô. Nhóm phải dựng lại được ĐÚNG như lần đầu, và con số
 * người bấm gõ xác nhận phải bằng đúng con số máy chủ tự đếm. Một bộ lọc tự do
 * gõ trên màn hình không giữ được cả hai lời hứa đó.
 *
 * Nhóm "đã đăng ký một sự kiện" mang tham số — sự kiện nào, có gồm cả chuỗi
 * không — để một nhóm phủ được mọi buổi: orientation của mentor, của mentee, và
 * mọi sự kiện sau này, mà không phải thêm mã cho từng buổi.
 */
export const BULK_AUDIENCES = ["mentee", "mentor", "both", "staff", "returning_mentor", "event"] as const;
export type BulkAudience = (typeof BULK_AUDIENCES)[number];

/** Nhóm cố định: không mang tham số, nên đếm sẵn được để hiện ngay trong ô chọn. */
export const FIXED_BULK_AUDIENCES = ["mentee", "mentor", "both", "staff", "returning_mentor"] as const;
export type FixedBulkAudience = (typeof FIXED_BULK_AUDIENCES)[number];

export const BULK_AUDIENCE_LABELS: Record<BulkAudience, string> = {
  mentee: "Mentee",
  mentor: "Mentor",
  both: "Cả mentor và mentee",
  staff: "Ban tổ chức (admin, core team, support team)",
  returning_mentor: "Mentor đã xác nhận quay lại mùa này",
  event: "Người đã đăng ký một sự kiện"
};

export function isBulkAudience(value: unknown): value is BulkAudience {
  return typeof value === "string" && (BULK_AUDIENCES as readonly string[]).includes(value);
}

/** Ba nhóm đọc thẳng từ membership của mùa. */
export type MembershipAudience = "mentee" | "mentor" | "both";

export function isMembershipAudience(value: unknown): value is MembershipAudience {
  return value === "mentee" || value === "mentor" || value === "both";
}

/** Các vai trò membership mà một đối tượng nhận thư tương ứng. */
export function rolesForAudience(audience: MembershipAudience): Array<"mentor" | "mentee"> {
  if (audience === "both") return ["mentor", "mentee"];
  return [audience];
}

/**
 * Vai trò tài khoản được tính là "Ban tổ chức".
 *
 * Không gồm `reviewer` và `viewer`: reviewer là mentor được mở quyền chấm hồ sơ,
 * và thư gửi BTC thường nói việc nội bộ mà người chấm không cần nhận. Muốn gửi
 * cho reviewer thì đó là một nhóm riêng, có tên riêng — không phải một nhóm lặng
 * lẽ rộng hơn cái tên của nó.
 */
export const STAFF_ROLES = ["super_admin", "admin", "core_team", "support_team"] as const;

export type AudienceChoice = {
  audience: BulkAudience;
  /** Chỉ có với nhóm `event`. */
  eventId: string | null;
  /** Chỉ có nghĩa với nhóm `event`: gồm cả các buổi khác cùng chuỗi. */
  coversSeries: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đọc nhóm nhận thư từ những gì form gửi lên.
 *
 * Nhóm không mang tham số thì BỎ mọi tham số đi kèm, kể cả khi form lỡ gửi: một
 * lô "Mentor" mà mang theo một event id là một lô mà lần gửi tiếp có thể đọc
 * nhầm. Nhóm `event` mà thiếu sự kiện thì từ chối, không đoán.
 *
 * Hàm này chỉ kiểm HÌNH DẠNG. Sự kiện có thuộc mùa đang gửi không là việc của
 * đường đọc danh sách — event id là thứ người gửi form tự đặt được.
 */
export function resolveAudienceChoice(input: {
  audience: unknown;
  eventId?: unknown;
  coversSeries?: unknown;
}): { ok: true; choice: AudienceChoice } | { ok: false; message: string } {
  const audience = String(input.audience ?? "").trim();
  if (!isBulkAudience(audience)) return { ok: false, message: "Chưa chọn đối tượng nhận thư." };

  if (audience !== "event") {
    return { ok: true, choice: { audience, eventId: null, coversSeries: false } };
  }

  const eventId = String(input.eventId ?? "").trim();
  if (!UUID_PATTERN.test(eventId)) {
    return { ok: false, message: "Chưa chọn sự kiện cho nhóm người đã đăng ký." };
  }
  return {
    ok: true,
    choice: { audience, eventId, coversSeries: String(input.coversSeries ?? "").trim() === "true" }
  };
}

/** Một sự kiện chọn được cho nhóm `event`, kèm số người nhận đã đếm sẵn. */
export type BulkEventOption = {
  id: string;
  label: string;
  seriesId: string | null;
  /** Số người nhận nếu chỉ lấy đúng buổi này. */
  sendable: number;
  unreachable: number;
  /** Số người nhận nếu lấy cả chuỗi; null khi buổi này không thuộc chuỗi nào. */
  seriesSendable: number | null;
  seriesUnreachable: number | null;
};

/**
 * Số thư tối đa một lần chạy được gửi.
 *
 * Cùng con số với đợt gửi bù thư xác nhận, vì cùng một lý do: các lời gọi nhà
 * cung cấp email chạy tuần tự, và một request phải kết thúc trước khi Vercel
 * cắt. Lô còn dư thì lần chạy sau đi tiếp — trạng thái nằm trong
 * `outbound_emails`, không nằm trong bộ nhớ của tiến trình.
 */
export const BULK_SEND_CHUNK = 25;

/**
 * Ngân sách thời gian của một lần chạy.
 *
 * Ngắn hơn `maxDuration` của route một quãng: bị cắt giữa chừng nghĩa là dòng
 * ghi sổ của bức thư cuối không kịp viết xong, và bức thư đó biến mất khỏi mọi
 * câu trả lời cho "đã gửi cho ai".
 */
export const BULK_TIME_BUDGET_MS = 40_000;

/** Người nhận thuộc về dòng dữ liệu nào — để sổ thư nối lá thư về đúng chỗ. */
export type RecipientSource = "people" | "admin_users" | "event_registrations";

/**
 * Vai trò của người nhận trong lô, dùng để điền ô {{vai_tro}}.
 *
 * `staff` và `attendee` có mặt vì BTC và người đăng ký sự kiện không phải mentor
 * hay mentee. Ô đã dùng trong thư mà để trống thì cả lá thư bị chặn — nên nhóm
 * nào cũng phải có một chữ để điền vào đó.
 */
export type RecipientRole = "mentor" | "mentee" | "staff" | "attendee";

export const RECIPIENT_ROLE_WORDS: Record<RecipientRole, string> = {
  mentor: "mentor",
  mentee: "mentee",
  staff: "ban tổ chức",
  attendee: "người tham dự"
};

export type BulkRecipient = {
  /**
   * Id của dòng nguồn — người trong danh bạ, tài khoản BTC, hoặc phiếu đăng ký
   * sự kiện, tuỳ `relationTable`. Giữ tên cũ vì mọi nhóm có trước đều là người.
   */
  personId: string;
  fullName: string;
  email: string;
  role: RecipientRole;
  /** Vắng mặt nghĩa là `people`, như mọi nhóm trước khi có nhóm BTC và sự kiện. */
  relationTable?: RecipientSource;
};

/**
 * Giá trị điền vào thư cho MỘT người nhận.
 *
 * Chỉ trả về đúng các ô mà loại thư ấy khai báo. Đây là nửa còn lại của lời hứa
 * "danh mục ô điền là danh sách đóng": danh mục nói được phép dùng ô nào, còn
 * hàm này quyết định ô đó lấy dữ liệu ở đâu. Thêm một ô vào một chỗ mà quên chỗ
 * kia thì `renderTemplate` chặn bức thư lại chứ không gửi ra một chỗ trống.
 */
export function buildRecipientValues(input: {
  kind: TemplateKind;
  recipient: BulkRecipient;
  seasonCode: string;
}): Record<string, string> {
  const source: Record<string, string> = {
    ten_nguoi_nhan: input.recipient.fullName,
    mua: input.seasonCode,
    vai_tro: RECIPIENT_ROLE_WORDS[input.recipient.role] ?? RECIPIENT_ROLE_WORDS.mentee
  };

  const values: Record<string, string> = {};
  for (const placeholder of TEMPLATE_SPECS[input.kind]?.placeholders ?? []) {
    values[placeholder.key] = source[placeholder.key] ?? "";
  }
  return values;
}

export type RecipientPartition = {
  /** Gửi được: có tên và có địa chỉ hợp lệ, mỗi địa chỉ đúng một lần. */
  sendable: BulkRecipient[];
  /** Không gửi được, kèm lý do — để nói ra chứ không lặng lẽ bỏ qua. */
  unreachable: Array<{ personId: string; fullName: string; reason: string }>;
};

/**
 * Tách danh sách thành gửi được và không gửi được.
 *
 * Người thiếu địa chỉ hoặc thiếu tên KHÔNG bị lặng lẽ bỏ qua: họ đi vào
 * `unreachable` và được đếm, vì "gửi cho 180 người" mà thật ra là 174 là một
 * câu trả lời sai cho câu hỏi quan trọng nhất sau một lượt gửi.
 *
 * Trùng địa chỉ chỉ nhận một lá. Một người vừa là mentor vừa là mentee của cùng
 * một mùa là chuyện có thật, và họ không nên nhận hai bản của cùng một thông
 * báo. Bản giữ lại là bản gặp trước — thứ tự gọi hàm quyết định, nên nơi gọi
 * sắp xếp trước khi đưa vào.
 */
export function partitionRecipients(rows: BulkRecipient[]): RecipientPartition {
  const sendable: BulkRecipient[] = [];
  const unreachable: RecipientPartition["unreachable"] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const fullName = String(row.fullName ?? "").trim();
    const email = normalizeEmailAddress(row.email);

    if (!email) {
      unreachable.push({
        personId: row.personId,
        fullName: fullName || "(chưa có tên)",
        reason: "Chưa có địa chỉ email hợp lệ"
      });
      continue;
    }
    if (!fullName) {
      // Thư mở đầu bằng "Chào ," thì thà không gửi. `renderTemplate` cũng sẽ
      // chặn, nhưng chặn ở đây thì đếm được và nói ra được trước khi bấm gửi.
      unreachable.push({
        personId: row.personId,
        fullName: email,
        reason: "Chưa có họ tên trong hệ thống"
      });
      continue;
    }
    if (seen.has(email)) continue;

    seen.add(email);
    sendable.push({
      personId: row.personId,
      fullName,
      email,
      role: row.role,
      ...(row.relationTable ? { relationTable: row.relationTable } : {})
    });
  }

  return { sendable, unreachable };
}

/**
 * Những người còn phải gửi trong một lô đang chạy dở.
 *
 * `done` là các địa chỉ đã có dòng kết quả trong `outbound_emails` của lô này.
 * Lọc theo đó chứ không theo số đếm: một lần chạy bị cắt giữa chừng vẫn để lại
 * đúng những dòng nó đã ghi, nên lần chạy sau đi tiếp từ đúng chỗ đó và không
 * ai nhận hai lá.
 */
export function remainingRecipients(
  all: BulkRecipient[],
  done: Iterable<string>
): BulkRecipient[] {
  const sent = new Set(Array.from(done, (email) => normalizeEmailAddress(email) ?? ""));
  return all.filter((row) => !sent.has(row.email));
}

export type BulkSendConfirmation =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Kiểm câu xác nhận trước khi gửi.
 *
 * Người bấm phải gõ lại đúng số người sẽ nhận thư. Đây là nút có sức công phá
 * lớn nhất trong app: không có đường thu hồi một lá thư đã vào hộp thư của một
 * sinh viên, và một cú bấm nhầm là hàng trăm lá. Gõ lại con số buộc mắt nhìn
 * vào quy mô của việc mình đang làm.
 */
export function confirmBulkSend(input: {
  typed: unknown;
  expected: number;
}): BulkSendConfirmation {
  if (input.expected <= 0) {
    return { ok: false, message: "Không có ai để gửi." };
  }

  const typed = String(input.typed ?? "").trim();
  if (!typed) {
    return { ok: false, message: `Gõ lại số người nhận (${input.expected}) để xác nhận.` };
  }
  if (!/^\d+$/.test(typed) || Number(typed) !== input.expected) {
    return {
      ok: false,
      message: `Số xác nhận chưa khớp. Lượt gửi này có ${input.expected} người nhận.`
    };
  }

  return { ok: true };
}

/** Câu tóm tắt sau một lần chạy, dùng chung cho action và cho màn hình. */
export function describeRunResult(input: {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
}): string {
  const parts = [`Đã gửi ${input.sent} thư`];
  if (input.skipped) parts.push(`${input.skipped} thư bị cấu hình chặn`);
  if (input.failed) parts.push(`${input.failed} thư lỗi`);

  const head = parts.join(", ") + ".";
  if (input.remaining > 0) {
    return `${head} Còn ${input.remaining} người chưa nhận — bấm “Gửi tiếp” để đi tiếp.`;
  }
  return `${head} Lô này đã gửi xong.`;
}
