/**
 * Tải CSV đối chiếu (Support team 25/10/2026): file có họ tên, email, SĐT của cả danh sách mùa —
 * cổng kiểm trước khi đọc; một dòng mỗi người, cột "Nhóm" để lọc người chưa nộp.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: null as any, check: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: (fn: unknown) => fn }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/form-roster-check", () => ({
  checkFormRoster: vi.fn(async () => h.check),
  parseRosterRole: (v: unknown) => (v === "mentor" ? "mentor" : "mentee")
}));

import { GET } from "@/app/api/exports/custom-form/[id]/doi-chieu/route";
import { checkFormRoster } from "@/lib/form-roster-check";

const FORM_ID = "09c8eea0-e238-4f5c-9e54-925952ad6020";
const call = (query = "") => GET(new Request(`https://os.example.test/api/exports/custom-form/${FORM_ID}/doi-chieu${query}`), { params: Promise.resolve({ id: FORM_ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "a1", role: "support_team", status: "active" };
  h.check = {
    ok: true,
    data: {
      form: { id: FORM_ID, publicCode: "2411bbb8defd" },
      seasonCode: "UEHM-S12",
      result: {
        role: "mentee",
        rosterSize: 2,
        submitted: [{ person: { name: "An", emails: ["an@gmail.com"], phones: [] }, matchedBy: "phone", submissions: [{ createdAt: "2026-10-25T01:00:00Z" }, { createdAt: "2026-10-24T01:00:00Z" }] }],
        notSubmitted: [{ name: "Chưa Nộp", emails: ["chua@gmail.com"], phones: ["0912345678"] }],
        outsiders: [{ submission: { name: "loan", emails: ["loan@yahoo.com"], phones: [], createdAt: "2026-10-25T02:00:00Z" }, note: "là mentor" }]
      }
    }
  };
});

describe("CSV đối chiếu", () => {
  it.each([
    [null, 401],
    [{ id: "a1", role: "viewer", status: "active" }, 403],
    [{ id: "a1", role: "reviewer", status: "active" }, 403]
  ])("tài khoản %j → %i, không đọc gì", async (user, status) => {
    h.user = user;
    const res = await call();
    expect(res.status).toBe(status);
    expect(vi.mocked(checkFormRoster)).not.toHaveBeenCalled();
  });

  it("một dòng mỗi người, đúng nhóm; tên file mang mã form, vai và mùa", async () => {
    const res = await call("?doi_tuong=mentee");
    expect(res.status).toBe(200);
    const text = await res.text();
    // BOM đầu file (mã 0xFEFF) để Excel đọc đúng tiếng Việt; bỏ đi trước khi tách dòng.
    const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim().split(/\r?\n/);
    expect(lines[0]).toContain("Nhóm");
    expect(lines.slice(1).map((l) => l.split(",")[0].replace(/"/g, ""))).toEqual(["Chưa nộp", "Đã nộp", "Ngoài danh sách"]);
    expect(text).toContain("Số điện thoại");
    expect(lines[2]).toContain(',"2",');
    expect(res.headers.get("content-disposition")).toContain("doi-chieu-2411bbb8defd-mentee-UEHM-S12.csv");
  });

  it("vai và mùa từ đường dẫn đi thẳng vào phép đối chiếu", async () => {
    await call("?doi_tuong=mentor&season=UEHM-S12");
    expect(vi.mocked(checkFormRoster)).toHaveBeenCalledWith(FORM_ID, { role: "mentor", season: "UEHM-S12" });
  });

  it("đối chiếu báo lỗi → không trả file", async () => {
    h.check = { ok: false, message: "Không đọc được đầy đủ dữ liệu để đối chiếu." };
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("Nhóm");
  });
});
