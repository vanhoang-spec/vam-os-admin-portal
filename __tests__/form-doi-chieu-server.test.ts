/**
 * Đối chiếu form với danh sách chính thức — phía máy chủ (Support team 25/10/2026), trên bản giả
 * PostgREST.
 *
 * Trang mang họ tên, email, SĐT của cả danh sách mùa, và Support team dựa vào nó để nhắc người:
 *   - cổng fail-closed: không tài khoản, tài khoản ngừng, vai không xem được thành viên → không đọc gì;
 *   - đọc hỏng bất kỳ bảng nào → báo lỗi, KHÔNG trả danh sách thiếu (thiếu email trên đơn = báo
 *     "chưa nộp" cho người đã nộp);
 *   - chỉ thành viên chính thức (active/completed) của ĐÚNG mùa đang chọn; email trên đơn của mùa
 *     khác không dùng để khớp.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/season-context", () => {
  class SeasonAccessDeniedError extends Error {}
  return { resolveSeasonContext: vi.fn(), SeasonAccessDeniedError };
});
// Cổng "xem thành viên" hiện trùng tập vai với cổng vận hành form; giả riêng nó để ca test chứng minh
// cổng này tự đứng được nếu hai quyền tách nhau sau này.
vi.mock("@/lib/read-access", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/read-access")>();
  return { ...real, canBrowseParticipants: vi.fn(real.canBrowseParticipants) };
});

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseParticipants } from "@/lib/read-access";
import { checkFormRoster } from "@/lib/form-roster-check";
import { resolveSeasonContext, SeasonAccessDeniedError } from "@/lib/season-context";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const db = createFakeDb();
const FORM = "11111111-2222-4333-8444-555555555555";
const S12 = "season-12";
const S11 = "season-11";
const field = (id: string, type: string, label: string) => ({ id, type, label, help: "", required: true, hidden: false, options: [] });

function seed() {
  db.reset();
  db.tables.custom_forms = [
    {
      id: FORM,
      public_code: "a1b2c3d4e5f6",
      title: "Training mentee",
      description: "",
      program_id: null,
      status: "published",
      opens_at: null,
      closes_at: null,
      thank_you: "",
      one_per_email: true,
      fields: [field("f_nameaaaa", "short_text", "Họ và tên"), field("f_mailaaaa", "email", "Email"), field("f_telaaaaa", "phone", "Số điện thoại")],
      created_at: "2026-10-20T00:00:00Z",
      updated_at: "2026-10-20T00:00:00Z"
    }
  ];
  db.tables.custom_form_responses = [
    // Khớp email hồ sơ.
    { id: "r-an", form_id: FORM, answers: { f_nameaaaa: "An", f_mailaaaa: "an@gmail.com", f_telaaaaa: "" }, created_at: "2026-10-25T01:00:00Z" },
    // Email hồ sơ khác — khớp email trên ĐƠN mùa 12.
    { id: "r-binh", form_id: FORM, answers: { f_nameaaaa: "Bình", f_mailaaaa: "binh.st@st.ueh.edu.vn", f_telaaaaa: "" }, created_at: "2026-10-25T02:00:00Z" },
    // Email trên đơn MÙA 11 — không được dùng để khớp.
    { id: "r-cu", form_id: FORM, answers: { f_nameaaaa: "Cũ", f_mailaaaa: "cu.s11@gmail.com", f_telaaaaa: "" }, created_at: "2026-10-25T03:00:00Z" },
    // Mentor nộp form mentee.
    { id: "r-loan", form_id: FORM, answers: { f_nameaaaa: "loan", f_mailaaaa: "loan@yahoo.com", f_telaaaaa: "" }, created_at: "2026-10-25T04:00:00Z" },
    // Form khác.
    { id: "r-khac", form_id: "99999999-2222-4333-8444-555555555555", answers: { f_mailaaaa: "chi@gmail.com" }, created_at: "2026-10-25T05:00:00Z" }
  ];
  db.tables.person_season_memberships = [
    { id: "m1", person_id: "p-an", season_id: S12, role: "mentee", status: "active" },
    { id: "m2", person_id: "p-binh", season_id: S12, role: "mentee", status: "completed" },
    { id: "m3", person_id: "p-cu", season_id: S12, role: "mentee", status: "active" },
    { id: "m4", person_id: "p-chi", season_id: S12, role: "mentee", status: "active" },
    { id: "m5", person_id: "p-loan", season_id: S12, role: "mentor", status: "active" },
    // Không chính thức / mùa khác — không thuộc danh sách.
    { id: "m6", person_id: "p-rut", season_id: S12, role: "mentee", status: "withdrawn" },
    { id: "m7", person_id: "p-s11", season_id: S11, role: "mentee", status: "active" }
  ];
  db.tables.people = [
    { id: "p-an", full_name: "Nguyễn Văn An", email_primary: "AN@gmail.com", phone_primary: null },
    { id: "p-binh", full_name: "Trần Thị Bình", email_primary: "binh@gmail.com", phone_primary: null },
    { id: "p-cu", full_name: "Lê Văn Cũ", email_primary: "cu@gmail.com", phone_primary: null },
    { id: "p-chi", full_name: "Phạm Chi", email_primary: "chi@gmail.com", phone_primary: null },
    { id: "p-loan", full_name: "Đặng Phạm Minh Loan", email_primary: "loan@yahoo.com", phone_primary: null },
    { id: "p-rut", full_name: "Rút Đơn", email_primary: "rut@gmail.com", phone_primary: null },
    { id: "p-s11", full_name: "Mùa Cũ", email_primary: "s11@gmail.com", phone_primary: null }
  ];
  db.tables.applications = [
    { id: "a-binh", person_id: "p-binh", season_id: S12, email_primary: "binh.st@st.ueh.edu.vn", phone_primary: null },
    { id: "a-cu-s11", person_id: "p-cu", season_id: S11, email_primary: "cu.s11@gmail.com", phone_primary: null }
  ];
}

const asRole = (role: string | null, status = "active") =>
  vi.mocked(getCurrentAdminUser).mockResolvedValue(role ? ({ id: "admin-1", role, status, email: "a@x.vn" } as any) : null);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
  vi.mocked(resolveSeasonContext).mockResolvedValue({ selectedSeasonId: S12, selectedSeasonCode: "UEHM-S12" } as any);
  asRole("support_team");
});

const check = (role: "mentee" | "mentor" = "mentee") => checkFormRoster(FORM, { role });

describe("1. đúng người, đúng mùa", () => {
  it("mentee: An (email hồ sơ, khác hoa thường) và Bình (email trên đơn mùa 12) đã nộp; Cũ, Chi chưa nộp", async () => {
    const r = await check();
    if (!r.ok) throw new Error(r.message);
    expect(r.data.seasonCode).toBe("UEHM-S12");
    expect(r.data.result.rosterSize).toBe(4);
    expect(r.data.result.submitted.map((e) => e.person.personId).sort()).toEqual(["p-an", "p-binh"]);
    expect(r.data.result.notSubmitted.map((p) => p.personId).sort()).toEqual(["p-chi", "p-cu"]);
  });

  it("email trên đơn mùa 11 không khớp; mentor nộp form mentee nằm ngoài danh sách, có ghi chú", async () => {
    const r = await check();
    if (!r.ok) throw new Error(r.message);
    expect(r.data.result.outsiders.map((o) => [o.submission.responseId, o.note])).toEqual([
      ["r-loan", "Email/SĐT trùng mentor Đặng Phạm Minh Loan — không phải mentee"],
      ["r-cu", ""]
    ]);
  });

  it("câu trả lời của form khác không lẫn vào; người rút đơn và người mùa khác không thuộc danh sách", async () => {
    const r = await check();
    if (!r.ok) throw new Error(r.message);
    const everyone = [...r.data.result.submitted.map((e) => e.person.personId), ...r.data.result.notSubmitted.map((p) => p.personId)];
    expect(everyone).not.toContain("p-rut");
    expect(everyone).not.toContain("p-s11");
    expect(r.data.result.submitted.flatMap((e) => e.submissions.map((s) => s.responseId))).not.toContain("r-khac");
  });

  it("mentor: Loan đã nộp; mentee nộp thành 'ngoài danh sách'", async () => {
    const r = await check("mentor");
    if (!r.ok) throw new Error(r.message);
    expect(r.data.result.submitted.map((e) => e.person.personId)).toEqual(["p-loan"]);
    expect(r.data.result.outsiders).toHaveLength(3);
  });

  it("đọc đúng mùa được chọn và truyền tham số mùa từ đường dẫn", async () => {
    await checkFormRoster(FORM, { role: "mentee", season: "UEHM-S12" });
    expect(vi.mocked(resolveSeasonContext)).toHaveBeenCalledWith("UEHM-S12");
  });

  it("không ghi gì", async () => {
    await check();
    expect(db.writes).toEqual([]);
  });
});

describe("2. cổng quyền (fail-closed)", () => {
  it.each([[null], ["viewer"], ["reviewer"]])("vai %s → từ chối, không đọc danh sách", async (role) => {
    asRole(role);
    const r = await check();
    expect(r.ok).toBe(false);
    expect(vi.mocked(resolveSeasonContext)).not.toHaveBeenCalled();
  });

  it("vận hành được form nhưng KHÔNG được xem thành viên → từ chối, không đọc form lẫn danh sách", async () => {
    vi.mocked(canBrowseParticipants).mockReturnValueOnce(false);
    const r = await check();
    expect(r).toEqual({ ok: false, message: "Bạn không có quyền xem danh sách thành viên của mùa này." });
    expect(vi.mocked(resolveSeasonContext)).not.toHaveBeenCalled();
  });

  it("tài khoản ngừng hoạt động → từ chối", async () => {
    asRole("support_team", "inactive");
    expect((await check()).ok).toBe(false);
  });

  it("không có quyền với mùa → từ chối", async () => {
    vi.mocked(resolveSeasonContext).mockRejectedValue(new SeasonAccessDeniedError());
    const r = await check();
    expect(r).toEqual({ ok: false, message: "Bạn không có quyền xem danh sách thành viên của mùa này." });
  });

  it("form không tồn tại → báo không tìm thấy", async () => {
    const r = await checkFormRoster("00000000-0000-4000-8000-000000000000", { role: "mentee" });
    expect(r).toEqual({ ok: false, message: "Không tìm thấy form." });
  });
});

describe("3. đọc hỏng thì không trả danh sách thiếu", () => {
  it.each(["custom_form_responses", "person_season_memberships", "people", "applications"])("%s lỗi → báo lỗi", async (table) => {
    db.errors[table] = { message: "down" };
    const r = await check();
    expect(r.ok).toBe(false);
  });

  it("không chọn được mùa vì lỗi khác → báo lỗi", async () => {
    vi.mocked(resolveSeasonContext).mockRejectedValue(new Error("boom"));
    const r = await check();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Không đọc được đầy đủ dữ liệu");
  });
});
