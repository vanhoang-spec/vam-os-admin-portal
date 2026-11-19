/**
 * Thang đo tuyến tính (VAM00033) — phần lõi và file Excel.
 *
 *   - định nghĩa: điểm bắt đầu 0/1, kết thúc 2–10, nhãn hai đầu tuỳ chọn; khoảng sai bị từ chối, thuộc tính lạ bị bỏ;
 *   - câu trả lời: chỉ nhận đúng một mức trong khoảng, ngoài khoảng / không phải số nguyên bị từ chối; bắt buộc;
 *   - đã có câu trả lời: thu hẹp khoảng bị chặn, mở rộng và sửa nhãn được;
 *   - nháp: mức ngoài khoảng (BTC đổi thang) bị bỏ;
 *   - Excel: cột thang đo là SỐ thật (<v>), CSV giữ chữ số; câu Likert vẫn là chữ như cũ.
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
import {
  CUSTOM_FORM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  answerNumber,
  checkLockedChanges,
  numericAnswerIds,
  parseDraft,
  parseFieldDefinitions,
  responseColumns,
  scaleValues,
  serializeDraft,
  storedFields,
  validateFormAnswers,
  type CustomFormField
} from "@/lib/custom-form-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const base = (extra: Record<string, unknown> = {}) => ({
  id: "f_scaleaaa",
  type: "linear_scale",
  label: "Bạn hài lòng với buổi học?",
  help: "",
  required: true,
  hidden: false,
  options: [],
  scale: { min: 1, max: 5, minLabel: "Rất không hài lòng", maxLabel: "Rất hài lòng" },
  ...extra
});
const parseOne = (raw: Record<string, unknown>) => parseFieldDefinitions([raw]);
const field = (extra: Record<string, unknown> = {}): CustomFormField => {
  const parsed = parseOne(base(extra));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.fields[0];
};
const answer = (fields: CustomFormField[], values: Record<string, string | string[]>) =>
  validateFormAnswers(fields, (id) => {
    const v = values[id];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  });

describe("1. định nghĩa", () => {
  it("là một loại câu hỏi mới có nhãn tiếng Việt; loại Likert vẫn còn", () => {
    expect(CUSTOM_FORM_FIELD_TYPES).toContain("linear_scale");
    expect(CUSTOM_FORM_FIELD_TYPES).toContain("likert_grid");
    expect(FIELD_TYPE_LABELS.linear_scale).toBe("Thang đo tuyến tính");
  });

  it("đọc đúng khoảng và nhãn (bỏ khoảng trắng, gộp xuống dòng); options luôn rỗng; thuộc tính lạ bị bỏ", () => {
    const parsed = parseOne(
      base({
        options: ["x", "y"],
        rows: [{ id: "r_abcdefgh", label: "lạ" }],
        scale: { min: 0, max: 10, minLabel: "  Không bao giờ\n giới thiệu ", maxLabel: " Chắc chắn ", extra: 1 },
        evil: true
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fields[0]).toEqual({
      id: "f_scaleaaa",
      type: "linear_scale",
      label: "Bạn hài lòng với buổi học?",
      help: "",
      required: true,
      hidden: false,
      options: [],
      scale: { min: 0, max: 10, minLabel: "Không bao giờ giới thiệu", maxLabel: "Chắc chắn" }
    });
  });

  it("nhận chuỗi số từ ô chọn (\"1\", \"7\") và nhãn trống", () => {
    expect(field({ scale: { min: "1", max: "7" } }).scale).toEqual({ min: 1, max: 7, minLabel: "", maxLabel: "" });
  });

  it.each([
    ["thiếu scale", undefined, "điểm bắt đầu"],
    ["bắt đầu 2", { min: 2, max: 5 }, "điểm bắt đầu"],
    ["bắt đầu -1", { min: -1, max: 5 }, "điểm bắt đầu"],
    ["bắt đầu 0.5", { min: 0.5, max: 5 }, "điểm bắt đầu"],
    ["kết thúc 1", { min: 0, max: 1 }, "điểm kết thúc"],
    ["kết thúc 11", { min: 1, max: 11 }, "điểm kết thúc"],
    ["kết thúc 4.5", { min: 1, max: 4.5 }, "điểm kết thúc"],
    ["kết thúc chữ", { min: 1, max: "năm" }, "điểm kết thúc"],
    ["nhãn quá dài", { min: 1, max: 5, minLabel: "a".repeat(101) }, "nhãn hai đầu"]
  ])("%s → bị từ chối", (_name, scale, message) => {
    const parsed = parseOne(base({ scale }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it("các mức là chữ số liên tiếp; storedFields bỏ dòng hỏng thay vì vỡ trang", () => {
    expect(scaleValues({ min: 0, max: 3 })).toEqual(["0", "1", "2", "3"]);
    expect(scaleValues({ min: 1, max: 10 })).toHaveLength(10);
    expect(storedFields([base(), base({ id: "f_brokenaa", scale: { min: 5, max: 3 } })]).map((f) => f.id)).toEqual(["f_scaleaaa"]);
  });
});

describe("2. câu trả lời", () => {
  it("lưu đúng mức đã chọn, dạng chữ số", () => {
    const r = answer([field()], { f_scaleaaa: "4" });
    expect(r).toEqual({ ok: true, answers: { f_scaleaaa: "4" }, errors: {} });
    expect(answer([field({ scale: { min: 0, max: 10 } })], { f_scaleaaa: "0" }).answers).toEqual({ f_scaleaaa: "0" });
  });

  it.each(["0", "6", "-1", "3.5", "04", "ba", "1e1"])("mức %j ngoài thang 1–5 → bị từ chối, không ghi", (value) => {
    const r = answer([field()], { f_scaleaaa: value });
    expect(r.ok).toBe(false);
    expect(r.answers).toEqual({});
    expect(r.errors.f_scaleaaa).toBe("Mức điểm không hợp lệ — tải lại trang rồi chọn lại.");
  });

  it("bắt buộc mà bỏ trống → báo chọn một mức; không bắt buộc thì bỏ trống được và không ghi gì", () => {
    expect(answer([field()], {}).errors).toEqual({ f_scaleaaa: "Vui lòng chọn một mức." });
    expect(answer([field({ required: false })], {})).toEqual({ ok: true, answers: {}, errors: {} });
  });

  it("câu đã ẩn không nhận dữ liệu", () => {
    expect(answer([field({ hidden: true })], { f_scaleaaa: "3" }).answers).toEqual({});
  });
});

describe("3. form đã có câu trả lời", () => {
  const old = [field()];
  it.each([
    ["bắt đầu 1 → 0", { min: 0, max: 5 }],
    ["kết thúc 5 → 10", { min: 1, max: 10 }],
    ["giữ nguyên, đổi nhãn", { min: 1, max: 5, minLabel: "Tệ", maxLabel: "Tốt" }]
  ])("%s: được", (_name, scale) => {
    expect(checkLockedChanges(old, [field({ scale })])).toBeNull();
  });

  it.each([
    ["kết thúc 5 → 4", { min: 1, max: 4 }],
    ["bắt đầu 0 → 1", { min: 1, max: 5 }, { min: 0, max: 5 }]
  ])("%s: thu hẹp bị chặn", (_name, scale, from = { min: 1, max: 5 }) => {
    const message = checkLockedChanges([field({ scale: from })], [field({ scale })]);
    expect(message).toContain("không thu hẹp được thang điểm");
  });

  it("không đổi được sang loại khác", () => {
    expect(checkLockedChanges(old, [{ ...old[0], type: "number", scale: undefined }])).toContain("không đổi được loại");
  });
});

describe("4. nháp trên máy người điền", () => {
  it("giữ mức còn trong thang, bỏ mức ngoài thang", () => {
    const now = Date.parse("2026-11-19T03:00:00Z");
    const raw = serializeDraft({ f_scaleaaa: "5" }, 0, now);
    expect(parseDraft([field()], raw, now)?.values).toEqual({ f_scaleaaa: "5" });
    expect(parseDraft([field({ scale: { min: 1, max: 4 } })], raw, now)).toBeNull();
  });
});

describe("5. số cho Excel", () => {
  it("chỉ câu thang đo là cột số; giá trị hỏng thành ô trống", () => {
    const likert = { ...base({ id: "f_gridaaaa", type: "likert_grid", options: ["1", "2"], scale: undefined }), rows: [{ id: "r_aaaaaaaa", label: "A" }] };
    const fields = storedFields([base(), likert, base({ id: "f_textaaaa", type: "short_text" })]);
    expect(Array.from(numericAnswerIds(fields))).toEqual(["f_scaleaaa"]);
    expect(answerNumber("4")).toBe(4);
    expect(answerNumber("0")).toBe(0);
    expect(answerNumber(undefined)).toBeNull();
    expect(answerNumber("")).toBeNull();
    expect(answerNumber("bốn")).toBeNull();
    expect(responseColumns(fields).map((c) => c.id)).toEqual(["f_scaleaaa", "f_gridaaaa.r_aaaaaaaa", "f_textaaaa"]);
  });
});

describe("6. route xuất Excel", () => {
  const db = createFakeDb();
  const FORM = "11111111-2222-4333-8444-555555555555";
  const CODE = "a1b2c3d4e5f6";
  const FIELDS = [
    { id: "f_nameaaaa", type: "short_text", label: "Họ và tên", help: "", required: true, hidden: false, options: [] },
    base({ label: "Mức hài lòng" }),
    {
      id: "f_gridaaaa",
      type: "likert_grid",
      label: "Đánh giá",
      help: "",
      required: false,
      hidden: false,
      options: ["1", "2", "3"],
      rows: [{ id: "r_noidung1", label: "Nội dung" }]
    }
  ];
  const RESPONSES = [
    { id: "00000000-0000-4000-8000-000000000001", form_id: FORM, created_at: "2026-11-18T12:00:00Z", answers: { f_nameaaaa: "An", f_scaleaaa: "5", "f_gridaaaa.r_noidung1": "2" } },
    { id: "00000000-0000-4000-8000-000000000002", form_id: FORM, created_at: "2026-11-19T01:00:00Z", answers: { f_nameaaaa: "Bình" } }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    db.reset();
    db.tables.custom_forms = [
      {
        id: FORM,
        public_code: CODE,
        title: "Khảo sát",
        description: "",
        program_id: null,
        status: "published",
        opens_at: null,
        closes_at: null,
        thank_you: "",
        one_per_email: false,
        fields: FIELDS,
        created_at: "2026-11-15T10:00:00Z",
        updated_at: "2026-11-15T10:00:00Z"
      }
    ];
    db.tables.custom_form_responses = RESPONSES;
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "admin-1", role: "support_team", status: "active", email: "a@x.vn" } as any);
  });
  const call = (query = "") => GET(new Request(`https://os.example.test/api/exports/custom-form/${FORM}${query}`), { params: Promise.resolve({ id: FORM }) });

  it("cột thang đo ghi số thật, ô bỏ trống để trống; Likert vẫn là chữ; tiêu đề trùng CSV", async () => {
    const res = await call("?dinh_dang=xlsx");
    expect(res.status).toBe(200);
    const sheet = new PizZip(await res.arrayBuffer()).file("xl/worksheets/sheet1.xml")!.asText();
    expect(sheet).toContain('t="inlineStr"><is><t xml:space="preserve">Mức hài lòng</t>');
    // Mới nhất trước: dòng 2 là Bình (không trả lời thang), dòng 3 là An (chọn 5).
    expect(sheet).toMatch(/<c r="C2" s="0"\/>/);
    expect(sheet).toContain('<c r="C3" s="0"><v>5</v></c>');
    expect(sheet).toContain('<c r="D3" s="0" t="inlineStr"><is><t xml:space="preserve">2</t></is></c>');

    const csv = await (await call()).text();
    const lines = csv.slice(1).split(/\r?\n/);
    const cells = (line: string) => line.split(",").map((c) => c.replace(/^"|"$/g, ""));
    expect(cells(lines[0])).toEqual(["Gửi lúc", "Họ và tên", "Mức hài lòng", "Đánh giá [Nội dung]"]);
    expect(cells(lines[2]).slice(1)).toEqual(["An", "5", "2"]);
  });
});
