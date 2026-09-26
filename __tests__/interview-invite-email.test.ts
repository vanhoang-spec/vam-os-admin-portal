/**
 * Thư mời ứng viên vào vòng phỏng vấn.
 *
 * Hai nhóm khẳng định, và nhóm đầu quan trọng hơn nhóm sau: lá thư này đi tới
 * một người đang chờ kết quả, nên nó không được hứa thứ hệ thống không có.
 * Main chưa lưu giờ phỏng vấn ở đâu cả, nên thư phải nói "ban tổ chức sẽ liên
 * hệ hẹn giờ" chứ không được ngụ ý đã có lịch.
 *
 * Phân loại: DIRECT PRODUCTION TESTS.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendInterviewRoundInvite: vi.fn() }));

import { buildInterviewRoundInviteEmail } from "@/lib/email-core";
import { sendInterviewRoundInvite } from "@/lib/email";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  INTERVIEW_INVITE_MAX_PER_RUN,
  INTERVIEW_INVITE_STATUS,
  interviewInviteNotifyMessage,
  notifyInterviewRoundInvites
} from "@/lib/interview-invite-notifications";

// ── Nội dung lá thư ───────────────────────────────────────────────────────────

describe("buildInterviewRoundInviteEmail", () => {
  const built = buildInterviewRoundInviteEmail({
    candidateName: "Nguyễn Văn A",
    seasonLabel: "Mùa 12"
  });

  it("KHÔNG hứa một giờ phỏng vấn cụ thể", () => {
    // Main không có cột nào lưu giờ. Một lá thư nói "lúc 15h thứ Bảy" sẽ là
    // bịa, và người nhận sẽ chờ một buổi không tồn tại.
    const body = `${built.subject} ${built.text}`.toLowerCase();
    for (const word of ["thời gian:", "địa điểm:", "hình thức:", "google meet", "zoom"]) {
      expect(body).not.toContain(word);
    }
  });

  it("nói rõ ban tổ chức sẽ liên hệ để hẹn giờ", () => {
    expect(built.text).toContain("liên hệ");
    expect(built.text.toLowerCase()).toContain("thời gian phỏng vấn");
  });

  it("mời trả lời, vì hộp thư gửi đi là hộp có người đọc", () => {
    expect(built.text).toContain("trả lời email này");
  });

  it("không mang đường dẫn nào — ứng viên không có màn hình nào để bấm vào", () => {
    expect(built.text).not.toMatch(/https?:\/\//);
    expect(built.html).not.toMatch(/<a\s/i);
  });

  it("có cả hai nửa text và html, và nhắc tên mùa", () => {
    expect(built.text).toContain("Mùa 12");
    expect(built.html).toContain("Mùa 12");
    expect(built.subject).toContain("Mùa 12");
  });

  it("thoát HTML trong tên người nhận", () => {
    const nasty = buildInterviewRoundInviteEmail({
      candidateName: '<img src=x onerror="alert(1)">',
      seasonLabel: "Mùa 12"
    });
    // Điều cần khoá là markup bị vô hiệu, không phải chuỗi "onerror" biến mất:
    // sau khi thoát, nó chỉ còn là văn bản hiển thị và không chạy được.
    expect(nasty.html).not.toContain("<img");
    expect(nasty.html).toContain("&lt;img");
    expect(nasty.html).toContain("&quot;");
  });

  it("tên rỗng vẫn ra lời chào đọc được", () => {
    const anon = buildInterviewRoundInviteEmail({ candidateName: "", seasonLabel: "Mùa 12" });
    expect(anon.text.startsWith("Chào bạn,")).toBe(true);
  });
});

// ── Vòng gửi ──────────────────────────────────────────────────────────────────

type Row = { id: string; full_name: string | null; email_primary: string | null; role_applied?: string | null };

let rows: Row[];

function makeClient() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.in = () => Promise.resolve({ data: rows, error: null });
  return { from: () => chain } as unknown as ReturnType<typeof getSupabaseServiceRoleClient>;
}

function person(id: string, over: Partial<Row> = {}): Row {
  return { id, full_name: `Người ${id}`, email_primary: `${id}@example.test`, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  (getSupabaseServiceRoleClient as unknown as Mock).mockImplementation(() => makeClient());
  (sendInterviewRoundInvite as unknown as Mock).mockResolvedValue({ ok: true, skipped: false });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("notifyInterviewRoundInvites", () => {
  it("chỉ chạm vào trạng thái mời phỏng vấn", () => {
    expect(INTERVIEW_INVITE_STATUS).toBe("invited_to_interview");
  });

  it("không có đơn nào thì không đọc database", async () => {
    const result = await notifyInterviewRoundInvites({ applicationIds: [] });
    expect(result.sent).toBe(0);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it("gửi cho từng người, kèm mã đơn để tra ngược", async () => {
    rows = [person("a1"), person("a2")];

    const result = await notifyInterviewRoundInvites({ applicationIds: ["a1", "a2"] });

    expect(result.sent).toBe(2);
    expect(sendInterviewRoundInvite).toHaveBeenCalledTimes(2);
    expect((sendInterviewRoundInvite as unknown as Mock).mock.calls[0][0]).toMatchObject({
      toEmail: "a1@example.test",
      applicationId: "a1"
    });
  });

  /**
   * Giai đoạn 1 (26/09/2026): mentee nhận thư mời KÈM LINK chọn ca từ bộ gửi
   * riêng. Gửi thêm lá này là mỗi bạn nhận hai thư trong một buổi chiều, lá đầu
   * không bấm được gì — và 334 lá thừa ăn vào đúng hạn mức 300 thư/ngày.
   */
  it("mentee KHÔNG nhận lá thư không-link này — chỉ mentor nhận", async () => {
    rows = [
      person("m1", { role_applied: "mentor" }),
      person("e1", { role_applied: "mentee" }),
      // Vai trò đọc từ đơn đã lưu: viết hoa hay dư khoảng trắng vẫn là mentee.
      person("e2", { role_applied: " Mentee " })
    ];

    const result = await notifyInterviewRoundInvites({ applicationIds: ["m1", "e1", "e2"] });

    expect(result.sent).toBe(1);
    expect(result.menteeSkipped).toBe(2);
    expect(sendInterviewRoundInvite).toHaveBeenCalledTimes(1);
    expect((sendInterviewRoundInvite as unknown as Mock).mock.calls[0][0].applicationId).toBe("m1");
  });

  it("mentee bị bỏ qua không bị tính là lỗi hay 'chưa gửi'", async () => {
    rows = [person("e1", { role_applied: "mentee" })];

    const result = await notifyInterviewRoundInvites({ applicationIds: ["e1"] });

    expect(result.failed).toBe(0);
    expect(result.notAttempted).toBe(0);
    expect(result.noEmail).toBe(0);
  });

  it("đơn thiếu email được đếm riêng, không tính là lỗi gửi", async () => {
    rows = [person("a1", { email_primary: "  " }), person("a2", { email_primary: null })];

    const result = await notifyInterviewRoundInvites({ applicationIds: ["a1", "a2"] });

    expect(result.noEmail).toBe(2);
    expect(result.failed).toBe(0);
    expect(sendInterviewRoundInvite).not.toHaveBeenCalled();
  });

  it("cổng gửi tắt thì đếm là bỏ qua, không phải lỗi", async () => {
    rows = [person("a1")];
    (sendInterviewRoundInvite as unknown as Mock).mockResolvedValue({ ok: true, skipped: true });

    const result = await notifyInterviewRoundInvites({ applicationIds: ["a1"] });

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("một lá thư ném lỗi không làm hỏng cả lượt", async () => {
    rows = [person("a1"), person("a2")];
    (sendInterviewRoundInvite as unknown as Mock)
      .mockRejectedValueOnce(new Error("Brevo unreachable"))
      .mockResolvedValueOnce({ ok: true, skipped: false });

    const result = await notifyInterviewRoundInvites({ applicationIds: ["a1", "a2"] });

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
  });

  it("vượt trần một lượt thì dừng, và NÊU TÊN những người chưa được gửi", async () => {
    rows = Array.from({ length: INTERVIEW_INVITE_MAX_PER_RUN + 3 }, (_, i) => person(`a${i}`));

    const result = await notifyInterviewRoundInvites({
      applicationIds: rows.map((r) => r.id)
    });

    expect(result.sent).toBe(INTERVIEW_INVITE_MAX_PER_RUN);
    expect(result.notAttempted).toBe(3);
    // Người vận hành phải biết còn nợ ai, chứ không chỉ biết một con số.
    expect(result.notAttemptedNames).toHaveLength(3);
  });

  it("hết ngân sách thời gian thì dừng giữa chừng", async () => {
    rows = [person("a1"), person("a2"), person("a3")];
    let ticks = 0;
    const now = () => {
      ticks += 1;
      return ticks <= 2 ? 0 : 10_000_000;
    };

    const result = await notifyInterviewRoundInvites({
      applicationIds: ["a1", "a2", "a3"],
      now
    });

    expect(result.sent).toBe(1);
    expect(result.notAttempted).toBe(2);
  });
});

// ── Câu thông báo cho người vận hành ─────────────────────────────────────────

describe("interviewInviteNotifyMessage", () => {
  const empty = {
    sent: 0,
    failed: 0,
    skipped: 0,
    noEmail: 0,
    notAttempted: 0,
    notAttemptedNames: [] as string[],
    menteeSkipped: 0
  };

  it("mọi thứ trôi chảy thì không làm loãng thông báo gốc", () => {
    expect(interviewInviteNotifyMessage(empty)).toBe("");
  });

  it("mentee không nhận thư ở bước này thì nói rõ họ nhận thư ở đâu", () => {
    const message = interviewInviteNotifyMessage({ ...empty, menteeSkipped: 3 });
    expect(message).toContain("3 mentee");
    expect(message).toContain("Ca phỏng vấn mentee");
  });

  it("nói thẳng khi cổng gửi đang tắt", () => {
    const message = interviewInviteNotifyMessage({ ...empty, skipped: 4 });
    expect(message).toContain("đang tắt");
  });

  it("người chưa được gửi thì nêu tên và nói rõ họ chưa nhận được thư", () => {
    const message = interviewInviteNotifyMessage({
      ...empty,
      sent: 50,
      notAttempted: 2,
      notAttemptedNames: ["Trần B", "Lê C"]
    });
    expect(message).toContain("Trần B");
    expect(message).toContain("Lê C");
    expect(message).toContain("chưa nhận được thư");
  });

  it("nhiều người chưa gửi thì cắt bớt danh sách chứ không đổ hết ra", () => {
    const message = interviewInviteNotifyMessage({
      ...empty,
      notAttempted: 9,
      notAttemptedNames: ["A", "B", "C", "D", "E", "F", "G", "H", "I"]
    });
    expect(message).toContain("và 4 người nữa");
  });
});
