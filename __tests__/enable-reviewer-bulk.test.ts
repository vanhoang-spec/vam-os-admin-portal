/**
 * Cấp quyền hàng loạt: khớp danh sách email, xử lý tối đa theo hạn mức thư,
 * và gọi lại đúng `enableMentorAsReviewer` cho từng người khớp được — không
 * viết lại logic cấp quyền ở đây.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  canOperateSeason: vi.fn(),
  getAdminScopeContext: vi.fn()
}));
vi.mock("@/lib/data", () => ({ getReviewerPool: vi.fn() }));
vi.mock("@/lib/enable-reviewer", () => ({ enableMentorAsReviewer: vi.fn() }));
vi.mock("@/lib/mentee-invite-dispatch", () => ({ countSentInWindow: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getReviewerPool } from "@/lib/data";
import { enableMentorAsReviewer } from "@/lib/enable-reviewer";
import { bulkEnableMentorsAsReviewers } from "@/lib/enable-reviewer-bulk";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { BULK_GRANT_MAX_PER_RUN } from "@/lib/reviewer-invite-dispatch-core";

const BATCH_ID = "batch-1";
const SEASON_ID = "season-1";

const POOL = [
  { mentor_profile_id: "m1", person_id: "p1", full_name: "Mentor A", email_primary: "a@example.com", mentor_code: null, intake_batch_id: BATCH_ID, admin_user_id: null, admin_user_role: null, admin_user_status: null },
  { mentor_profile_id: "m2", person_id: "p2", full_name: "Mentor B", email_primary: "b@example.com", mentor_code: null, intake_batch_id: BATCH_ID, admin_user_id: null, admin_user_role: null, admin_user_status: null }
];

function seasonLookupClient() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: BATCH_ID, season_id: SEASON_ID }], error: null })
    }))
  };
}

function grant(input: { rawEmails: string; intakeBatchId?: string; participationRole?: "reviewer" | "interviewer" }) {
  return bulkEnableMentorsAsReviewers({
    rawEmails: input.rawEmails,
    intakeBatchId: input.intakeBatchId ?? BATCH_ID,
    participationRole: input.participationRole ?? "interviewer"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role: "core_team" } as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({} as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(seasonLookupClient() as never);
  vi.mocked(getReviewerPool).mockResolvedValue({ data: POOL, error: null } as never);
  vi.mocked(countSentInWindow).mockResolvedValue(0);
  vi.mocked(enableMentorAsReviewer).mockResolvedValue({ ok: true, message: "Đã cấp quyền Interviewer cho đúng mùa." } as never);
});

describe("cổng quyền — fail-closed", () => {
  it("chưa đăng nhập: không gọi gì cả", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    const result = await grant({ rawEmails: "a@example.com" });
    expect(result).toMatchObject({ ok: false, message: "Bạn chưa đăng nhập." });
    expect(enableMentorAsReviewer).not.toHaveBeenCalled();
  });

  it("vai trò không được quản lý reviewer (viewer): chặn trước khi đọc pool", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "actor-1", role: "viewer" } as never);
    const result = await grant({ rawEmails: "a@example.com" });
    expect(result.ok).toBe(false);
    expect(getReviewerPool).not.toHaveBeenCalled();
  });

  it("không có quyền vận hành mùa: chặn, không gọi enableMentorAsReviewer", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const result = await grant({ rawEmails: "a@example.com" });
    expect(result).toMatchObject({ ok: false, message: "Bạn không có quyền vận hành mùa này." });
    expect(enableMentorAsReviewer).not.toHaveBeenCalled();
  });

  it("participationRole không hợp lệ thì chặn", async () => {
    const result = await grant({ rawEmails: "a@example.com", participationRole: "admin" as never });
    expect(result.ok).toBe(false);
  });

  it("chưa chọn đợt tuyển thì chặn", async () => {
    const result = await grant({ rawEmails: "a@example.com", intakeBatchId: "" });
    expect(result.ok).toBe(false);
  });

  it("đọc pool hỏng thì fail-closed, không cấp cho ai", async () => {
    vi.mocked(getReviewerPool).mockResolvedValue({ data: [], error: "boom" } as never);
    const result = await grant({ rawEmails: "a@example.com" });
    expect(result.ok).toBe(false);
    expect(enableMentorAsReviewer).not.toHaveBeenCalled();
  });

  it("không đếm được số thư đã gửi thì KHÔNG xử lý mù", async () => {
    vi.mocked(countSentInWindow).mockResolvedValue(null);
    const result = await grant({ rawEmails: "a@example.com" });
    expect(result.ok).toBe(false);
    expect(enableMentorAsReviewer).not.toHaveBeenCalled();
  });
});

describe("khớp danh sách", () => {
  it("email không khớp mentor nào của mùa: liệt kê notFound, không gọi enableMentorAsReviewer", async () => {
    const result = await grant({ rawEmails: "khong-ton-tai@example.com" });
    expect(result.ok).toBe(true);
    expect(result.notFound).toEqual(["khong-ton-tai@example.com"]);
    expect(enableMentorAsReviewer).not.toHaveBeenCalled();
  });

  it("khớp đúng person_id, gọi enableMentorAsReviewer với đúng seasonId lấy từ batch và đúng participationRole", async () => {
    await grant({ rawEmails: "A@Example.com", participationRole: "interviewer" });
    expect(enableMentorAsReviewer).toHaveBeenCalledTimes(1);
    expect(enableMentorAsReviewer).toHaveBeenCalledWith({ personId: "p1", seasonId: SEASON_ID, participationRole: "interviewer" });
  });

  it("trộn khớp được và không khớp: cả hai nhóm đều có mặt trong kết quả", async () => {
    const result = await grant({ rawEmails: "a@example.com\nkhong-ton-tai@example.com" });
    expect(result.granted).toEqual([{ email: "a@example.com", message: "Đã cấp quyền Interviewer cho đúng mùa." }]);
    expect(result.notFound).toEqual(["khong-ton-tai@example.com"]);
  });
});

describe("hạn mức thư — không bao giờ vượt", () => {
  it("còn đủ hạn mức: xử lý hết, skippedDueToQuota rỗng", async () => {
    const result = await grant({ rawEmails: "a@example.com\nb@example.com" });
    expect(enableMentorAsReviewer).toHaveBeenCalledTimes(2);
    expect(result.granted).toHaveLength(2);
    expect(result.skippedDueToQuota).toEqual([]);
  });

  it("hạn mức chỉ còn 1: xử lý đúng 1 người, người còn lại vào skippedDueToQuota — không gọi enableMentorAsReviewer cho họ", async () => {
    vi.mocked(countSentInWindow).mockResolvedValue(300 - 1);
    const result = await grant({ rawEmails: "a@example.com\nb@example.com" });
    expect(enableMentorAsReviewer).toHaveBeenCalledTimes(1);
    expect(enableMentorAsReviewer).toHaveBeenCalledWith({ personId: "p1", seasonId: SEASON_ID, participationRole: "interviewer" });
    expect(result.granted).toHaveLength(1);
    expect(result.skippedDueToQuota).toEqual(["b@example.com"]);
  });

  it("hạn mức đã hết (đã gửi đủ 300): không gọi enableMentorAsReviewer cho ai, tất cả vào skippedDueToQuota", async () => {
    vi.mocked(countSentInWindow).mockResolvedValue(300);
    const result = await grant({ rawEmails: "a@example.com\nb@example.com" });
    expect(enableMentorAsReviewer).not.toHaveBeenCalled();
    expect(result.skippedDueToQuota).toEqual(["a@example.com", "b@example.com"]);
  });

  it("không bao giờ xử lý quá BULK_GRANT_MAX_PER_RUN người dù hạn mức thư còn nhiều và danh sách dài hơn", async () => {
    const manyPool = Array.from({ length: BULK_GRANT_MAX_PER_RUN + 5 }, (_, i) => ({
      mentor_profile_id: `m${i}`,
      person_id: `p${i}`,
      full_name: `Mentor ${i}`,
      email_primary: `m${i}@example.com`,
      mentor_code: null,
      intake_batch_id: BATCH_ID,
      admin_user_id: null,
      admin_user_role: null,
      admin_user_status: null
    }));
    vi.mocked(getReviewerPool).mockResolvedValue({ data: manyPool, error: null } as never);
    const emails = manyPool.map((row) => row.email_primary).join("\n");
    const result = await grant({ rawEmails: emails });
    expect(enableMentorAsReviewer).toHaveBeenCalledTimes(BULK_GRANT_MAX_PER_RUN);
    expect(result.skippedDueToQuota).toHaveLength(5);
  });
});

describe("kết quả thất bại của từng người vẫn được báo lại, không nuốt lỗi", () => {
  it("một người cấp quyền lỗi thì vào failed, người kia vẫn granted bình thường", async () => {
    vi.mocked(enableMentorAsReviewer)
      .mockResolvedValueOnce({ ok: true, message: "Đã cấp quyền Interviewer cho đúng mùa." } as never)
      .mockResolvedValueOnce({ ok: false, message: "Bạn không có quyền vận hành mùa này." } as never);
    const result = await grant({ rawEmails: "a@example.com\nb@example.com" });
    expect(result.granted).toEqual([{ email: "a@example.com", message: "Đã cấp quyền Interviewer cho đúng mùa." }]);
    expect(result.failed).toEqual([{ email: "b@example.com", message: "Bạn không có quyền vận hành mùa này." }]);
  });
});
