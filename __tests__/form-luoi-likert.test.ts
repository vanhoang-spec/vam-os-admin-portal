/**
 * Lưới thang đo Likert trong Form tùy chỉnh (VAM00032) — phần thuần và máy chủ (bản giả PostgREST).
 *
 * Khoá: định nghĩa gửi lên bị kiểm lại (số hàng/cột, độ dài, trùng, mã hàng); câu trả lời mỗi hàng chỉ nhận
 * một mức có trong danh sách cột, khoá lạ không được đọc; bắt buộc = đủ mọi hàng; form và câu trả lời cũ
 * không đổi hình dạng; đã có câu trả lời thì không bỏ được mức hay hàng cũ; mỗi hàng là một cột CSV.
 * Phía máy chủ khẳng định chính lệnh ghi: hỏng thì không ghi gì.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendCustomFormReceipt: vi.fn(async () => ({ ok: true, skipped: false })) }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  CUSTOM_FORM_FIELD_TYPES,
  checkLockedChanges,
  gridAnswerKey,
  optionTargetsOf,
  parseDraft,
  parseFieldDefinitions,
  responseColumns,
  serializeDraft,
  storedFields,
  validateFormAnswers,
  type CustomFormField
} from "@/lib/custom-form-core";
import { mentorAnswerRows, sampleMentorAnswerRows } from "@/lib/custom-form-mentor-core";
import { saveCustomForm, submitPublicCustomForm } from "@/lib/custom-forms";
import type { CustomFormSavePayload } from "@/lib/custom-form-action-types";

const COLS = ["Rất không đồng ý", "Không đồng ý", "Trung lập", "Đồng ý", "Rất đồng ý"];
const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: `Câu ${id}`, help: "", required: true, hidden: false, options: [] as string[], ...extra });
const ROWS = [
  { id: "r_noidung1", label: "Nội dung hữu ích" },
  { id: "r_diengia1", label: "Diễn giả dễ hiểu" }
];
const GRID = { ...field("f_gridaaaa", "likert_grid", { label: "Bạn đánh giá buổi học", options: COLS }), rows: ROWS };
const K1 = gridAnswerKey("f_gridaaaa", "r_noidung1");
const K2 = gridAnswerKey("f_gridaaaa", "r_diengia1");

const parseOne = (raw: unknown) => parseFieldDefinitions([raw]);
const parsedGrid = (extra: Record<string, unknown> = {}): CustomFormField => {
  const result = parseOne({ ...GRID, ...extra });
  if (!result.ok) throw new Error(result.error);
  return result.fields[0];
};
const reader = (values: Record<string, unknown>) => (key: string) => {
  const v = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
  return Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)];
};

describe("1. định nghĩa lưới", () => {
  it("là một loại câu hỏi của Form tùy chỉnh; định nghĩa hợp lệ được chép sang đối tượng mới, thuộc tính lạ bị bỏ", () => {
    expect(CUSTOM_FORM_FIELD_TYPES).toContain("likert_grid");
    const result = parseOne({ ...GRID, evil: "x", optionTargets: { "Đồng ý": "__end" }, rows: [{ id: "r_noidung1", label: " Nội dung hữu ích ", extra: 1 }] });
    expect(result).toEqual({
      ok: true,
      fields: [{ id: "f_gridaaaa", type: "likert_grid", label: "Bạn đánh giá buổi học", help: "", required: true, hidden: false, options: COLS, rows: [{ id: "r_noidung1", label: "Nội dung hữu ích" }] }]
    });
    // Lưới không rẽ nhánh: đích gửi kèm không lọt vào định nghĩa, và không có đích nào được đọc ra.
    expect(optionTargetsOf((result as { fields: CustomFormField[] }).fields[0]).size).toBe(0);
  });

  it.each([
    ["dưới 2 mức", { options: ["Có"] }, "ít nhất 2 mức"],
    ["quá 11 mức", { options: Array.from({ length: 12 }, (_, i) => String(i)) }, "tối đa 11 mức"],
    ["mức quá dài", { options: ["1", "x".repeat(101)] }, "tối đa 100 ký tự"],
    ["mức trùng (không phân biệt hoa thường)", { options: ["Đồng ý", "đồng ý"] }, "bị trùng"],
    ["không có hàng", { rows: [] }, "ít nhất 1 phát biểu"],
    ["quá 30 hàng", { rows: Array.from({ length: 31 }, (_, i) => ({ id: `r_row${String(i).padStart(5, "0")}`, label: `P${i}` })) }, "tối đa 30 phát biểu"],
    ["mã hàng sai", { rows: [{ id: "x", label: "A" }] }, "mã hàng không hợp lệ"],
    ["mã hàng trùng", { rows: [{ id: "r_aaaaaaaa", label: "A" }, { id: "r_aaaaaaaa", label: "B" }] }, "mã hàng không hợp lệ"],
    ["hàng trống", { rows: [{ id: "r_aaaaaaaa", label: "  " }] }, "còn trống"],
    ["hàng quá dài", { rows: [{ id: "r_aaaaaaaa", label: "x".repeat(301) }] }, "tối đa 300 ký tự"],
    ["hàng trùng", { rows: [{ id: "r_aaaaaaaa", label: "A" }, { id: "r_bbbbbbbb", label: "a" }] }, "bị trùng"]
  ])("từ chối %s", (_name, extra, message) => {
    const result = parseOne({ ...GRID, ...extra });
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain(message);
  });

  it("form cũ không đổi: câu chọn một / Có-Không đọc lại y như trước, không mang thêm khoá rows", () => {
    const old = [field("f_oneaaaaa", "single_choice", { options: ["A", "B"] }), field("f_ynaaaaaa", "yes_no", { options: ["Có", "Không"], branches: { yes: "", no: "" } })];
    const read = storedFields(old);
    expect(read).toHaveLength(2);
    for (const f of read) expect(f).not.toHaveProperty("rows");
    expect(read[0]).toEqual(old[0]);
    // Lưới hỏng trong database bị bỏ qua thay vì làm vỡ trang.
    expect(storedFields([{ ...GRID, rows: "hỏng" }, old[0]])).toEqual([old[0]]);
  });
});

describe("2. câu trả lời", () => {
  const fields = () => [parsedGrid()];

  it("bắt buộc + đủ hàng: lưu phẳng mỗi hàng một khoá, khoá lạ trình duyệt gửi kèm không được đọc", () => {
    const result = validateFormAnswers(fields(), reader({ [K1]: "Đồng ý", [K2]: " Rất đồng ý ", "f_gridaaaa.r_khonghau": "Đồng ý", f_gridaaaa: "Đồng ý" }));
    expect(result).toEqual({ ok: true, answers: { [K1]: "Đồng ý", [K2]: "Rất đồng ý" }, errors: {} });
  });

  it("bắt buộc + thiếu một hàng: báo dưới câu hỏi, không lưu hàng nào của lưới", () => {
    const result = validateFormAnswers(fields(), reader({ [K1]: "Đồng ý" }));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ f_gridaaaa: "Vui lòng chọn một mức cho mỗi hàng." });
    expect(result.answers).toEqual({});
  });

  it("không bắt buộc: bỏ trống cả lưới hay vài hàng đều được, chỉ hàng đã chọn được lưu", () => {
    const optional = [parsedGrid({ required: false })];
    expect(validateFormAnswers(optional, reader({}))).toEqual({ ok: true, answers: {}, errors: {} });
    expect(validateFormAnswers(optional, reader({ [K2]: "Trung lập" }))).toEqual({ ok: true, answers: { [K2]: "Trung lập" }, errors: {} });
  });

  it("mức không có trong danh sách cột bị từ chối (dù không bắt buộc)", () => {
    const result = validateFormAnswers([parsedGrid({ required: false })], reader({ [K1]: "Tuyệt vời" }));
    expect(result.ok).toBe(false);
    expect(result.errors.f_gridaaaa).toContain("Lựa chọn không hợp lệ");
    expect(result.answers).toEqual({});
  });

  it("lưới đã ẩn không nhận dữ liệu", () => {
    expect(validateFormAnswers([parsedGrid({ hidden: true })], reader({ [K1]: "Đồng ý" }))).toEqual({ ok: true, answers: {}, errors: {} });
  });

  it("nháp mở lại chỉ giữ hàng còn trên form và mức còn trong danh sách", () => {
    const raw = serializeDraft({ [K1]: "Đồng ý", [K2]: "Mức đã bỏ", "f_gridaaaa.r_dabo0000": "Đồng ý" }, 0, 1000);
    expect(parseDraft(fields(), raw, 2000)?.values).toEqual({ [K1]: "Đồng ý" });
  });
});

describe("3. khoá khi đã có câu trả lời", () => {
  const old = () => [parsedGrid()];
  it("sửa chữ phát biểu, thêm hàng, thêm mức: được", () => {
    const now = parsedGrid({ options: [...COLS, "Không ý kiến"], rows: [{ id: "r_noidung1", label: "Nội dung rất hữu ích" }, { id: "r_diengia1", label: "Diễn giả dễ hiểu" }, { id: "r_moi00000", label: "Mới" }] });
    expect(checkLockedChanges(old(), [now])).toBeNull();
  });
  it("bỏ (hay sửa) một mức cũ: không được", () => {
    expect(checkLockedChanges(old(), [parsedGrid({ options: COLS.slice(0, 4) })])).toContain("không bỏ hay sửa được mức “Rất đồng ý”");
  });
  it("xoá một phát biểu cũ: không được", () => {
    expect(checkLockedChanges(old(), [parsedGrid({ rows: [{ id: "r_noidung1", label: "Nội dung hữu ích" }] })])).toContain("không xoá được phát biểu “Diễn giả dễ hiểu”");
  });
});

describe("4. xem câu trả lời, CSV, thư cho mentor", () => {
  const fields = [parsedGrid(), parsedGrid({ id: "f_hiddenaa", hidden: true, label: "Cũ" }), { ...parsedGrid(), id: "f_emailaaa", type: "email" as const, label: "Email", options: [], rows: undefined }];
  it("mỗi phát biểu một cột “Câu hỏi [Phát biểu]”, lưới đã ẩn vẫn có cột; câu thường giữ đúng một cột như cũ", () => {
    expect(responseColumns(fields)).toEqual([
      { id: K1, label: "Bạn đánh giá buổi học [Nội dung hữu ích]" },
      { id: K2, label: "Bạn đánh giá buổi học [Diễn giả dễ hiểu]" },
      { id: "f_hiddenaa.r_noidung1", label: "Cũ [Nội dung hữu ích] (đã ẩn)" },
      { id: "f_hiddenaa.r_diengia1", label: "Cũ [Diễn giả dễ hiểu] (đã ẩn)" },
      { id: "f_emailaaa", label: "Email" }
    ]);
  });
  it("thư cho mentor: mỗi hàng đã chọn một dòng, hàng bỏ trống không chiếm dòng", () => {
    expect(mentorAnswerRows(fields, { [K2]: "Đồng ý", f_emailaaa: "a@x.vn" })).toEqual([
      { label: "Bạn đánh giá buổi học [Diễn giả dễ hiểu]", value: "Đồng ý" },
      { label: "Email", value: "a@x.vn" }
    ]);
    expect(sampleMentorAnswerRows([parsedGrid()]).map((r) => r.label)).toEqual(["Bạn đánh giá buổi học [Nội dung hữu ích]", "Bạn đánh giá buổi học [Diễn giả dễ hiểu]"]);
  });
});

// ---------------------------------------------------------------------------
// Máy chủ
// ---------------------------------------------------------------------------

const db = createFakeDb();
const FORM = "11111111-2222-4333-8444-555555555555";
const CODE = "a1b2c3d4e5f6";
const NOW = Date.parse("2026-11-13T09:00:00Z");

function seed(status: string, fields: unknown[]) {
  db.tables.custom_forms = [
    { id: FORM, public_code: CODE, title: "Thử", description: "", program_id: null, status, opens_at: null, closes_at: null, thank_you: "", one_per_email: false, fields, created_at: "2026-11-13T08:00:00Z", updated_at: "2026-11-13T08:00:00Z" }
  ];
  db.tables.custom_form_responses = [];
  db.tables.outbound_emails = [];
  db.tables.programs = [];
}
const payload = (fields: unknown[]): CustomFormSavePayload => ({ title: "Thử", description: "", programId: "", thankYou: "", onePerEmail: false, autoReply: false, autoReplySubject: "", autoReplyBody: "", opensAt: "", closesAt: "", fields });
const formWrites = () => db.writes.filter((w) => w.table === "custom_forms");
const responseWrites = () => db.writes.filter((w) => w.table === "custom_form_responses");

describe("5. máy chủ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.reset();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "support_team", status: "active", email: "a@x.vn" } as any);
  });

  it("lưu form: định nghĩa ghi xuống giữ hàng (mã + chữ) và cột", async () => {
    seed("draft", []);
    expect((await saveCustomForm(FORM, payload([GRID]))).ok).toBe(true);
    const written = formWrites()[0].rows[0].fields as Array<Record<string, unknown>>;
    expect(written[0]).toMatchObject({ type: "likert_grid", options: COLS, rows: GRID.rows });
  });

  it("lưu form có lưới hỏng (31 hàng): không ghi gì", async () => {
    seed("draft", []);
    const rows = Array.from({ length: 31 }, (_, i) => ({ id: `r_row${String(i).padStart(5, "0")}`, label: `P${i}` }));
    const result = await saveCustomForm(FORM, payload([{ ...GRID, rows }]));
    expect(result.ok).toBe(false);
    expect(formWrites()).toEqual([]);
  });

  it("form đã có câu trả lời: xoá phát biểu cũ thì không ghi; sửa chữ phát biểu thì ghi", async () => {
    seed("published", [GRID]);
    db.tables.custom_form_responses = [{ id: "resp-1", form_id: FORM, answers: { [K1]: "Đồng ý", [K2]: "Đồng ý" }, created_at: "2026-11-13T08:30:00Z" }];
    const dropped = await saveCustomForm(FORM, payload([{ ...GRID, rows: [GRID.rows[0]] }]));
    expect(dropped.ok).toBe(false);
    expect(dropped.message).toContain("không xoá được phát biểu");
    expect(formWrites()).toEqual([]);
    const renamed = await saveCustomForm(FORM, payload([{ ...GRID, rows: [{ ...GRID.rows[0], label: "Nội dung rất hữu ích" }, GRID.rows[1]] }]));
    expect(renamed.ok).toBe(true);
    expect(formWrites()).toHaveLength(1);
  });

  it("gửi form: ghi đúng mức của từng hàng, khoá lạ trình duyệt gửi kèm không xuống database", async () => {
    seed("published", [GRID]);
    const result = await submitPublicCustomForm(CODE, { values: { [K1]: "Đồng ý", [K2]: "Trung lập", "f_gridaaaa.__proto__": "x", f_khac0000: "rác" }, consent: true, trap: "" }, NOW);
    expect(result.ok).toBe(true);
    expect(responseWrites()).toHaveLength(1);
    expect(responseWrites()[0].rows[0].answers).toEqual({ [K1]: "Đồng ý", [K2]: "Trung lập" });
  });

  it("gửi form với mức ngoài danh sách hoặc thiếu hàng bắt buộc: báo dưới câu hỏi, không ghi gì", async () => {
    seed("published", [GRID]);
    const bad = await submitPublicCustomForm(CODE, { values: { [K1]: "Đồng ý", [K2]: "<script>" }, consent: true, trap: "" }, NOW);
    expect(bad.ok).toBe(false);
    expect(bad.errors.f_gridaaaa).toContain("Lựa chọn không hợp lệ");
    const missing = await submitPublicCustomForm(CODE, { values: { [K1]: "Đồng ý" }, consent: true, trap: "" }, NOW);
    expect(missing.ok).toBe(false);
    expect(missing.errors).toEqual({ f_gridaaaa: "Vui lòng chọn một mức cho mỗi hàng." });
    expect(responseWrites()).toEqual([]);
  });
});
