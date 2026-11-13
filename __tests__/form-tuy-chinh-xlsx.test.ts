/**
 * Xuất Excel câu trả lời Form tùy chỉnh (VAM00032), chạy route thật + listCustomFormResponses thật trên bản giả PostgREST.
 *
 * File có họ tên, email, SĐT của nhiều người, nên các ca khoá:
 *   - cổng quyền fail-closed và KHÔNG rộng hơn CSV: mọi vai trò nhận cùng một mã trạng thái ở hai định dạng; bị chặn thì
 *     không mở client database;
 *   - tham số sai dạng → 400, không lặng lẽ trả CSV;
 *   - mở file bằng PizZip: một sheet, dòng 1 là tiêu đề (trùng dòng tiêu đề của CSV), mỗi phát biểu Likert một cột,
 *     autofilter + cố định dòng 1, ngày giờ DD/MM/YYYY giờ Việt Nam;
 *   - ô bắt đầu bằng "=", "+", "-", "@" là chữ (inlineStr), không có phần tử công thức nào;
 *   - đọc phân trang tới hết: nhiều hơn một trang PostgREST vẫn đủ dòng.
 */
import PizZip from "pizzip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));

import { GET } from "@/app/api/exports/custom-form/[id]/route";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const db = createFakeDb();
const FORM = "11111111-2222-4333-8444-555555555555";
const CODE = "a1b2c3d4e5f6";

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: `Câu ${id}`, help: "", required: true, hidden: false, options: [], ...extra });
const GRID = {
  ...field("f_gridaaaa", "likert_grid", { label: "Đánh giá buổi học", options: ["Không đồng ý", "Bình thường", "Đồng ý"] }),
  rows: [
    { id: "r_noidung1", label: "Nội dung hữu ích" },
    { id: "r_diengia1", label: "Diễn giả dễ hiểu" }
  ]
};
const FIELDS = [
  field("f_nameaaaa", "short_text", { label: "Họ và tên" }),
  field("f_emailaaa", "email", { label: "Email" }),
  GRID,
  field("f_slotaaaa", "multi_choice", { label: "Buổi rảnh", options: ["Sáng", "Tối"] }),
  field("f_secretaa", "short_text", { label: "Ghi chú", hidden: true })
];
const HEADERS = [
  "Gửi lúc",
  "Họ và tên",
  "Email",
  "Đánh giá buổi học [Nội dung hữu ích]",
  "Đánh giá buổi học [Diễn giả dễ hiểu]",
  "Buổi rảnh",
  "Ghi chú (đã ẩn)"
];

function seed(responses: Array<Record<string, unknown>>) {
  db.tables.custom_forms = [
    {
      id: FORM,
      public_code: CODE,
      title: "Khảo sát buổi học",
      description: "",
      program_id: null,
      status: "published",
      opens_at: null,
      closes_at: null,
      thank_you: "",
      one_per_email: false,
      fields: FIELDS,
      created_at: "2026-10-15T10:00:00Z",
      updated_at: "2026-10-15T10:00:00Z"
    }
  ];
  db.tables.custom_form_responses = responses;
}

const asRole = (role: string | null, status = "active") =>
  vi.mocked(getCurrentAdminUser).mockResolvedValue(role ? ({ id: "admin-1", role, status, email: "a@x.vn" } as any) : null);

const call = (query = "", id = FORM) => GET(new Request(`https://os.example.test/api/exports/custom-form/${id}${query}`), { params: Promise.resolve({ id }) });

/** Đọc sheet1 thành lưới chữ theo địa chỉ ô; kèm XML thô để soi phần tử. */
function readXlsx(bytes: ArrayBuffer) {
  const zip = new PizZip(bytes);
  const workbook = zip.file("xl/workbook.xml")!.asText();
  const sheet = zip.file("xl/worksheets/sheet1.xml")!.asText();
  const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const rows = new Map<number, string[]>();
  for (const m of Array.from(sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
    const col = m[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const row = Number(m[2]);
    const text = m[4] ? decode((m[4].match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? m[4].match(/<v>([\s\S]*?)<\/v>/) ?? [, ""])[1] ?? "") : "";
    const cells = rows.get(row) ?? [];
    cells[col] = text;
    rows.set(row, cells);
  }
  const grid = Array.from(rows.keys())
    .sort((a, b) => a - b)
    .map((r) => Array.from(rows.get(r)!, (v) => v ?? ""));
  return { workbook, sheet, grid, files: Object.keys(zip.files) };
}

const RESPONSES = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    form_id: FORM,
    created_at: "2026-10-15T12:00:00Z",
    answers: {
      f_nameaaaa: "=HYPERLINK(\"http://x.test\",\"bấm\")",
      f_emailaaa: "an@example.test",
      "f_gridaaaa.r_noidung1": "Đồng ý",
      "f_gridaaaa.r_diengia1": "Bình thường",
      f_slotaaaa: ["Sáng", "Tối"],
      f_secretaa: "@SUM(A1)"
    }
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    form_id: FORM,
    created_at: "2026-10-16T01:30:00Z",
    answers: {
      f_nameaaaa: "+84 912 345 678",
      f_emailaaa: "-1+1",
      "f_gridaaaa.r_noidung1": "Không đồng ý"
    }
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  seed(RESPONSES);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
  asRole("support_team");
});

describe("1. cổng quyền: fail-closed, không rộng hơn CSV", () => {
  it.each([
    ["chưa đăng nhập", null, "active", 401],
    ["viewer", "viewer", "active", 403],
    ["reviewer", "reviewer", "active", 403],
    ["support_team đã ngừng", "support_team", "disabled", 403]
  ])("%s → %i ở cả CSV lẫn Excel, không mở database", async (_name, role, status, code) => {
    asRole(role, status);
    for (const query of ["", "?dinh_dang=csv", "?dinh_dang=xlsx"]) {
      const res = await call(query);
      expect(res.status).toBe(code);
      expect(res.headers.get("content-type") ?? "").not.toContain("spreadsheetml");
    }
    expect(vi.mocked(getSupabaseServiceRoleClient)).not.toHaveBeenCalled();
  });

  it("viewer bị chặn ngay ở route (không đi tới hàm đọc, nơi tài khoản được hỏi lại lần hai)", async () => {
    asRole("viewer");
    expect((await call("?dinh_dang=xlsx")).status).toBe(403);
    expect(vi.mocked(getCurrentAdminUser)).toHaveBeenCalledTimes(1);
  });

  it.each(["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer", "interviewer", "mentor", ""])(
    "vai trò %j: Excel nhận đúng mã trạng thái như CSV",
    async (role) => {
      asRole(role || "unknown");
      const csv = await call();
      const xlsx = await call("?dinh_dang=xlsx");
      expect(xlsx.status).toBe(csv.status);
    }
  );

  it.each(["?dinh_dang=pdf", "?dinh_dang=XLSX", "?dinh_dang="])("tham số %s → 400, không đọc gì", async (query) => {
    const res = await call(query);
    expect(res.status).toBe(400);
    expect(vi.mocked(getSupabaseServiceRoleClient)).not.toHaveBeenCalled();
  });

  it("mã form sai dạng → 400", async () => {
    const res = await call("?dinh_dang=xlsx", "khong-phai-uuid");
    expect(res.status).toBe(400);
  });
});

describe("2. nội dung file Excel", () => {
  it("một sheet, dòng 1 là tiêu đề trùng CSV, mỗi phát biểu Likert một cột, mới nhất trước", async () => {
    const res = await call("?dinh_dang=xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toContain(`form-${CODE}.xlsx`);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { workbook, grid, files } = readXlsx(await res.arrayBuffer());
    expect(files.filter((f) => f.startsWith("xl/worksheets/") && f.endsWith(".xml"))).toEqual(["xl/worksheets/sheet1.xml"]);
    expect(workbook.match(/<sheet /g)).toHaveLength(1);
    expect(grid[0]).toEqual(HEADERS);

    const csvText = await (await call()).text();
    const csvHeader = csvText.slice(1).split(/\r?\n/)[0];
    expect(csvHeader.split(",").map((c) => c.replace(/^"|"$/g, ""))).toEqual(HEADERS);

    expect(grid).toHaveLength(3);
    // 01:30 UTC 16/10 = 08:30 giờ Việt Nam; 12:00 UTC 15/10 = 19:00.
    expect(grid[1]).toEqual(["16/10/2026 08:30", "+84 912 345 678", "-1+1", "Không đồng ý", "", "", ""]);
    expect(grid[2]).toEqual(["15/10/2026 19:00", "=HYPERLINK(\"http://x.test\",\"bấm\")", "an@example.test", "Đồng ý", "Bình thường", "Sáng; Tối", "@SUM(A1)"]);
  });

  it("có autofilter phủ cả bảng, cố định dòng tiêu đề", async () => {
    const { sheet, workbook } = readXlsx(await (await call("?dinh_dang=xlsx")).arrayBuffer());
    expect(sheet).toContain('<autoFilter ref="A1:G3"/>');
    expect(sheet).toMatch(/<pane ySplit="1" topLeftCell="A2"[^>]*state="frozen"\/>/);
    expect(workbook).toContain("$A$1:$G$3");
  });

  it("ô bắt đầu bằng = + - @ là chữ thuần, không có công thức", async () => {
    const { sheet } = readXlsx(await (await call("?dinh_dang=xlsx")).arrayBuffer());
    expect(sheet).not.toMatch(/<f[ >]/);
    for (const ref of ["B2", "C2", "B3", "G3"]) {
      expect(sheet).toMatch(new RegExp(`<c r="${ref}" s="0" t="inlineStr"><is><t xml:space="preserve">[=+@-]`));
    }
  });
});

describe("3. đọc phân trang tới hết", () => {
  it("nhiều hơn một trang PostgREST (1000 dòng) vẫn đủ mọi lượt gửi", async () => {
    const many = Array.from({ length: 1205 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      form_id: FORM,
      created_at: "2026-10-15T12:00:00Z",
      answers: { f_nameaaaa: `Người ${i}` }
    }));
    seed(many);
    const { grid } = readXlsx(await (await call("?dinh_dang=xlsx")).arrayBuffer());
    expect(grid).toHaveLength(1206);
    expect(new Set(grid.slice(1).map((r) => r[1])).size).toBe(1205);
  });
});
