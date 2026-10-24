/**
 * Nhóm nhận thư "Mentee không trúng tuyển vòng phỏng vấn" mùa 12 (BTC 24/10/2026): 287 bạn = rớt
 * phỏng vấn + check-in/phân bàn/chọn ca mà không phỏng vấn + được mời mà không chọn ca, trừ 5 bạn.
 *
 * Một lá thư rớt gửi nhầm không rút lại được. Mỗi đơn trong dữ liệu dưới đây là một lý do — tên đơn
 * nói lý do đó: năm đơn ĐƯỢC nhận thư (một cho mỗi nhóm), còn lại là người thật khớp vào lúc viết mà
 * KHÔNG được nhận: đã đậu, đang chờ BTC xem xét, huỷ chỗ không chọn lại, chưa nhận thư mời, đã bị rút
 * lời mời (đã nhận thư riêng), 5 bạn BTC giữ lại (kể cả viết dấu khác), đang tham gia mùa, là BTC, có
 * đơn khác đã duyệt, đã nhận thư rớt trước đó, đơn đã rút, mùa khác, đơn mentor.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng `lib/bulk-mail` trên bản giả PostgREST.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  BULK_AUDIENCE_HINTS,
  BULK_AUDIENCE_LABELS,
  FIXED_BULK_AUDIENCES,
  MENTEE_INTERVIEW_LETTER_HELD_NAMES,
  foldPersonName,
  isHeldFromInterviewLetter,
  menteeInterviewLetterGroup
} from "@/lib/bulk-mail-core";
import { listBulkRecipients } from "@/lib/bulk-mail";

type Row = Record<string, unknown>;
const S12 = "season-12";
const S11 = "season-11";
const SENT = "2026-10-02T03:00:00Z";
const db = createFakeDb();

function app(id: string, over: Row = {}): Row {
  return {
    id,
    season_id: S12,
    person_id: null,
    full_name: `Bạn ${id}`,
    email_primary: `${id}@sv.ueh.edu.vn`,
    role_applied: "mentee",
    status: "interview_scheduled",
    ...over
  };
}
const op = (id: string, over: Row = {}): Row => ({ id, outcome: null, checked_in_at: SENT, interviewer_id: null, ...over });
const invite = (id: string, sent = true): Row => ({ id: `inv-${id}`, application_id: id, first_sent_at: sent ? SENT : null });
const booking = (id: string, status: string): Row => ({ id: `bk-${id}-${status}`, application_id: id, season_id: S12, status });

function seed() {
  db.reset();
  db.tables.applications = [
    // ĐƯỢC nhận thư — một cho mỗi nhóm.
    app("a-rot-pv", { status: "rejected_or_not_fit" }),
    app("b-check-in"),
    app("c-phan-ban"),
    app("d-chon-ca-khong-den"),
    app("e-moi-khong-chon", { status: "invited_to_interview" }),
    // KHÔNG được nhận.
    app("dat", { status: "approved_as_mentee" }),
    app("can-xem-xet", { status: "needs_more_review" }),
    app("huy-khong-chon-lai", { status: "invited_to_interview" }),
    app("chua-nhan-thu-moi", { status: "invited_to_interview" }),
    app("rut-loi-moi", { status: "rejected_or_not_fit" }),
    app("giu-lai-thuy", { full_name: "Vũ Thị Thuý Vy" }),
    app("giu-lai-ten-ho-so", { full_name: "Le Hoang Thinh (ten tren don)", person_id: "p-thinh" }),
    app("dang-tham-gia", { status: "rejected_or_not_fit", person_id: "p-member" }),
    app("la-btc", { status: "rejected_or_not_fit", email_primary: "Core.Team@x.org" }),
    app("co-don-duyet", { status: "rejected_or_not_fit", email_primary: "mentor-too@x.org" }),
    app("don-mentor-da-duyet", { role_applied: "mentor", status: "approved_as_mentor", email_primary: "MENTOR-TOO@x.org" }),
    // Cùng một người, khác email: chỉ nối được qua hồ sơ.
    app("co-don-duyet-theo-nguoi", { status: "rejected_or_not_fit", person_id: "p-approved" }),
    app("don-mentor-cung-nguoi", { role_applied: "mentor", status: "approved_as_mentor", person_id: "p-approved", email_primary: "cong-viec@x.org" }),
    app("da-nhan-thu-rot", { status: "rejected_or_not_fit" }),
    app("don-rut", { status: "withdrawn" }),
    app("mua-cu", { season_id: S11, status: "rejected_or_not_fit" }),
    app("don-mentor-rot", { role_applied: "mentor", status: "rejected_or_not_fit" })
  ];
  db.tables.mentee_interview_operations = [
    op("a-rot-pv", { interviewer_id: "iv", outcome: "rejected" }),
    op("b-check-in"),
    op("c-phan-ban", { interviewer_id: "iv" }),
    op("d-chon-ca-khong-den", { checked_in_at: null }),
    op("dat", { interviewer_id: "iv", outcome: "passed" }),
    op("can-xem-xet", { interviewer_id: "iv", outcome: "needs_review" }),
    op("giu-lai-thuy", { interviewer_id: "iv" }),
    op("giu-lai-ten-ho-so", { interviewer_id: "iv" }),
    op("dang-tham-gia", { interviewer_id: "iv", outcome: "rejected" }),
    op("la-btc", { interviewer_id: "iv", outcome: "rejected" }),
    op("co-don-duyet", { interviewer_id: "iv", outcome: "rejected" }),
    op("co-don-duyet-theo-nguoi", { interviewer_id: "iv", outcome: "rejected" }),
    op("da-nhan-thu-rot", { interviewer_id: "iv", outcome: "rejected" }),
    op("don-rut"),
    op("mua-cu", { interviewer_id: "iv", outcome: "rejected" }),
    op("don-mentor-rot", { interviewer_id: "iv", outcome: "rejected" })
  ];
  db.tables.mentee_interview_bookings = [
    booking("a-rot-pv", "booked"),
    booking("d-chon-ca-khong-den", "booked"),
    booking("huy-khong-chon-lai", "cancelled")
  ];
  db.tables.mentee_interview_invites = [
    invite("a-rot-pv"),
    invite("e-moi-khong-chon"),
    invite("huy-khong-chon-lai"),
    invite("chua-nhan-thu-moi", false),
    invite("rut-loi-moi")
  ];
  db.tables.people = [
    { id: "p-thinh", full_name: "Lê Hoàng Thịnh" },
    { id: "p-member", full_name: "Bạn đang tham gia" },
    { id: "p-approved", full_name: "Bạn có đơn mentor" }
  ];
  db.tables.person_season_memberships = [{ id: "m1", person_id: "p-member", season_id: S12, role: "mentee", status: "active" }];
  db.tables.admin_users = [{ id: "a1", email: "core.team@x.org" }];
  db.tables.email_batches = [{ id: "batch-cv", season_id: S12, audience: "mentee_cv_rejected" }];
  db.tables.outbound_emails = [
    { id: "o1", batch_id: "batch-cv", to_email: "da-nhan-thu-rot@sv.ueh.edu.vn", related_id: "da-nhan-thu-rot", status: "sent" }
  ];
}

const list = async () => {
  const r = await listBulkRecipients({ seasonId: S12, audience: "mentee_interview_rejected" });
  return { ...r, ids: r.partition.sendable.map((x) => x.personId).sort() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
});

describe("1. ai nhận thư", () => {
  it("đúng năm nhóm BTC đếm, mỗi nhóm một người; không ai khác", async () => {
    const r = await list();
    expect(r.error).toBeNull();
    expect(r.ids).toEqual(["a-rot-pv", "b-check-in", "c-phan-ban", "d-chon-ca-khong-den", "e-moi-khong-chon"]);
    expect(r.partition.unreachable).toEqual([]);
  });

  it("thư nối về đơn, mang tên và email trên đơn", async () => {
    const r = await list();
    const a = r.partition.sendable.find((x) => x.personId === "a-rot-pv")!;
    expect(a).toMatchObject({ fullName: "Bạn a-rot-pv", email: "a-rot-pv@sv.ueh.edu.vn", role: "mentee", relationTable: "applications" });
    expect(r.label).toBe(BULK_AUDIENCE_LABELS.mentee_interview_rejected);
  });

  it("người đã nhận lá thư này ở một lô trước (Gửi tiếp / lô sau) không nhận lần hai", async () => {
    db.tables.email_batches.push({ id: "batch-pv", season_id: S12, audience: "mentee_interview_rejected" });
    db.tables.outbound_emails.push({ id: "o2", batch_id: "batch-pv", to_email: "x@y.z", related_id: "a-rot-pv", status: "sent" });
    db.tables.outbound_emails.push({ id: "o3", batch_id: "batch-pv", to_email: "B-CHECK-IN@sv.ueh.edu.vn", related_id: "khac", status: "queued" });
    // Thư hỏng không tính là đã nhận.
    db.tables.outbound_emails.push({ id: "o4", batch_id: "batch-pv", to_email: "c@y.z", related_id: "c-phan-ban", status: "failed" });
    expect((await list()).ids).toEqual(["c-phan-ban", "d-chon-ca-khong-den", "e-moi-khong-chon"]);
  });

  it("thư rớt của mùa khác không chặn", async () => {
    db.tables.email_batches.push({ id: "batch-s11", season_id: S11, audience: "mentee_interview_rejected" });
    db.tables.outbound_emails.push({ id: "o5", batch_id: "batch-s11", to_email: "x@y.z", related_id: "a-rot-pv", status: "sent" });
    expect((await list()).ids).toContain("a-rot-pv");
  });
});

describe("2. đọc hỏng thì không trả danh sách thiếu phép loại", () => {
  it.each([
    "applications",
    "mentee_interview_operations",
    "mentee_interview_bookings",
    "mentee_interview_invites",
    "person_season_memberships",
    "admin_users",
    "people",
    "email_batches",
    "outbound_emails"
  ])("%s lỗi → báo lỗi, không ai trong danh sách", async (table) => {
    db.tables.email_batches.push({ id: "batch-pv", season_id: S12, audience: "mentee_interview_rejected" });
    db.errors[table] = { message: "down" };
    const r = await list();
    expect(r.error).toBeTruthy();
    expect(r.ids).toEqual([]);
  });
});

describe("3. phần thuần", () => {
  const base = { applicationStatus: "interview_scheduled", operation: null, hasBookedSeat: false, hadAnyBooking: false, inviteSent: false };
  it.each([
    ["rớt", { operation: { outcome: "rejected", checked_in_at: SENT, interviewer_id: "iv" } }, "failed"],
    ["đậu", { operation: { outcome: "passed", checked_in_at: SENT, interviewer_id: "iv" } }, null],
    ["cần xem xét", { operation: { outcome: "needs_review", checked_in_at: SENT, interviewer_id: "iv" } }, null],
    ["phân bàn, chưa kết quả", { operation: { outcome: null, checked_in_at: SENT, interviewer_id: "iv" } }, "assigned"],
    ["check-in, chưa phân bàn", { operation: { outcome: null, checked_in_at: SENT, interviewer_id: null } }, "checked_in"],
    ["đang giữ chỗ, không đến", { hasBookedSeat: true, hadAnyBooking: true }, "booked_no_show"],
    ["huỷ chỗ, không chọn lại", { hadAnyBooking: true, inviteSent: true }, null],
    ["được mời, không chọn ca", { inviteSent: true, applicationStatus: "invited_to_interview" }, "invited_no_booking"],
    ["được mời nhưng đã Không đạt (rút lời mời)", { inviteSent: true, applicationStatus: "rejected_or_not_fit" }, null],
    ["chưa nhận thư mời", {}, null]
  ])("%s", (_label, over, expected) => {
    expect(menteeInterviewLetterGroup({ ...base, ...(over as object) })).toBe(expected);
  });

  it("nhóm theo kết quả trước, rồi phân bàn, rồi check-in — không ai thuộc hai nhóm", () => {
    expect(
      menteeInterviewLetterGroup({ ...base, operation: { outcome: null, checked_in_at: SENT, interviewer_id: "iv" }, hasBookedSeat: true, hadAnyBooking: true })
    ).toBe("assigned");
  });

  it("so tên bỏ dấu, kể cả vị trí dấu thanh, chữ hoa và khoảng trắng thừa", () => {
    expect(foldPersonName("Vũ Thị Thúy Vy")).toBe(foldPersonName("vũ  thị THUÝ vy "));
    expect(foldPersonName("Đinh Ngọc Kim Hoàn")).toBe("dinh ngoc kim hoan");
    expect(foldPersonName("Đinh Ngọc Kim Hoàn".normalize("NFD"))).toBe("dinh ngoc kim hoan");
    expect(isHeldFromInterviewLetter("Không phải", "Lê Hoàng Thịnh")).toBe(true);
    expect(isHeldFromInterviewLetter("Lê Hoàn Thịnh")).toBe(false);
    expect(isHeldFromInterviewLetter("", null)).toBe(false);
    expect(MENTEE_INTERVIEW_LETTER_HELD_NAMES).toHaveLength(5);
  });

  it("nhóm có tên, lời giải thích, và đếm sẵn được trong ô chọn", () => {
    expect(FIXED_BULK_AUDIENCES).toContain("mentee_interview_rejected");
    expect(BULK_AUDIENCE_HINTS.mentee_interview_rejected).toContain("5 bạn BTC giữ lại");
  });
});
