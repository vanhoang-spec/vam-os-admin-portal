/**
 * Đọc chữ đã sửa cho form công khai.
 *
 * Đây là chữ, không phải một cổng quyền: đọc hỏng thì form hiện chữ mặc định, không
 * bao giờ thành trang lỗi giữa đợt tuyển. Và phải đọc đúng đợt tuyển — chữ của mùa
 * khác không được lọt vào form Mùa 12.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { DEFAULT_APPLICATION_FORM_TEXTS as D } from "@/lib/application-form-text-core";
import { getApplicationFormTexts, readApplicationFormTextOverrides } from "@/lib/application-form-texts";

type Row = Record<string, unknown>;

function use(opts: { rows?: Row[]; textsError?: boolean; seasonError?: boolean; noBatch?: boolean; crash?: boolean } = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const from = vi.fn((table: string) => {
    if (opts.crash) throw new Error("mạng hỏng");
    const eqs: Array<[string, unknown]> = [];
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        eqs.push([column, value]);
        filters.push([table, column, value]);
        return chain;
      },
      maybeSingle: async () => {
        if (table === "seasons") {
          if (opts.seasonError) return { data: null, error: { message: "đọc mùa hỏng" } };
          return { data: eqs.some(([c, v]) => c === "code" && v === "UEHM-S12") ? { id: "season-12" } : null, error: null };
        }
        if (table === "intake_batches") {
          if (opts.noBatch) return { data: null, error: null };
          const ok = eqs.some(([c, v]) => c === "code" && v === "UEHM-S12-B1") && eqs.some(([c, v]) => c === "season_id" && v === "season-12");
          return { data: ok ? { id: "batch-1" } : null, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        const result = opts.textsError
          ? { data: null, error: { code: "42P01", message: 'relation "public.application_form_texts" does not exist' } }
          : { data: (opts.rows ?? []).filter((row) => eqs.every(([c, v]) => row[c] === v)), error: null };
        return Promise.resolve(result).then(resolve, reject);
      }
    };
    return chain;
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from } as never);
  return { from, filters };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("1. chữ của form công khai", () => {
  it("chưa sửa gì: đúng chữ mặc định", async () => {
    use({ rows: [] });
    expect(await getApplicationFormTexts()).toEqual(D);
  });

  it("bản đã sửa của ĐÚNG đợt tuyển thắng mặc định; bản của đợt khác và khoá lạ bị bỏ qua", async () => {
    const fake = use({
      rows: [
        { intake_batch_id: "batch-1", text_key: "mentor.process.step1_note", body: "Hạn nộp: **26/09/2026**.", updated_at: null, admin_users: null },
        { intake_batch_id: "batch-other", text_key: "mentor.header.title", body: "Đơn mùa 11", updated_at: null, admin_users: null },
        { intake_batch_id: "batch-1", text_key: "mentor.bogus", body: "x", updated_at: null, admin_users: null }
      ]
    });

    const texts = await getApplicationFormTexts();

    expect(texts["mentor.process.step1_note"]).toBe("Hạn nộp: **26/09/2026**.");
    expect(texts["mentor.header.title"]).toBe(D["mentor.header.title"]);
    expect(fake.filters).toContainEqual(["application_form_texts", "intake_batch_id", "batch-1"]);
  });

  it.each([
    ["bảng chưa có (migration chưa chạy)", { textsError: true }],
    ["đọc mùa hỏng", { seasonError: true }],
    ["không có đợt tuyển", { noBatch: true }],
    ["lỗi bất ngờ", { crash: true }]
  ])("%s: chữ mặc định, không ném lỗi", async (_label, opts) => {
    use(opts);
    await expect(getApplicationFormTexts()).resolves.toEqual(D);
    expect(console.error).toHaveBeenCalled();
  });

  it("không có client: chữ mặc định", async () => {
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(null as never);
    await expect(getApplicationFormTexts()).resolves.toEqual(D);
  });
});

describe("2. bản đã sửa cho trang quản trị", () => {
  it("mang người sửa và lúc sửa", async () => {
    use({
      rows: [
        {
          intake_batch_id: "batch-1",
          text_key: "mentor.header.title",
          body: "Đơn mentor",
          updated_at: "2026-09-15T03:00:00Z",
          admin_users: { full_name: "Thảo" }
        }
      ]
    });

    expect(await readApplicationFormTextOverrides()).toEqual({
      ok: true,
      seasonId: "season-12",
      intakeBatchId: "batch-1",
      overrides: { "mentor.header.title": { body: "Đơn mentor", updatedAt: "2026-09-15T03:00:00Z", updatedByName: "Thảo" } }
    });
  });

  it("bảng chưa có: báo không đọc được, không trả một danh sách rỗng trông như thật", async () => {
    use({ textsError: true });
    expect(await readApplicationFormTextOverrides()).toEqual({ ok: false, reason: "texts_unreadable" });
  });
});
