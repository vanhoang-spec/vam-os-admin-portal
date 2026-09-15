/**
 * Ai được sửa chữ trên form nộp đơn — và lệnh ghi phát ra đúng những gì.
 *
 * Form nộp đơn là trang hàng trăm người mở. Canh: chỉ người được sửa mới ghi được,
 * lỗi hạ tầng không thành quyền, lệnh ghi đúng đợt tuyển / đúng khối / đúng người
 * sửa, và mỗi lần lưu có một dòng nhật ký chỉ ghi những gì thật sự đã vào database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/events", () => ({ writeAdminAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/application-form-texts", () => ({
  readApplicationFormTextOverrides: vi.fn(),
  overrideBodies: (overrides: Record<string, { body: string }>) =>
    Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, value.body]))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { DEFAULT_APPLICATION_FORM_TEXTS as D } from "@/lib/application-form-text-core";
import { canEditFormTextsForSeason, saveApplicationFormTexts } from "@/lib/application-form-text-write";
import { readApplicationFormTextOverrides } from "@/lib/application-form-texts";
import { writeAdminAudit } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const NOTE = "mentor.process.step1_note";
const TITLE = "mentor.header.title";
const NEW_NOTE = "Lưu ý: Hạn nộp dời sang **26/09/2026**.";

const user = (role: string, status = "active") => ({ id: `u-${role}`, role, status }) as never;

type Call = { op: string; table: string; [key: string]: unknown };

function useClient(opts: { upsertError?: boolean; deleteError?: boolean } = {}) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => ({
    upsert: async (rows: unknown, options: unknown) => {
      calls.push({ op: "upsert", table, rows, options });
      return { error: opts.upsertError ? { message: "ghi hỏng" } : null };
    },
    delete: () => {
      const filters: unknown[] = [];
      const chain: any = {
        eq: (column: string, value: unknown) => {
          filters.push(["eq", column, value]);
          return chain;
        },
        in: async (column: string, values: unknown) => {
          filters.push(["in", column, values]);
          calls.push({ op: "delete", table, filters });
          return { error: opts.deleteError ? { message: "xoá hỏng" } : null };
        }
      };
      return chain;
    }
  }));
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from } as never);
  return { calls, from };
}

function signIn(role: string, opts: { status?: string; scopeError?: string | null } = {}) {
  const admin = user(role, opts.status);
  vi.mocked(getCurrentAdminUser).mockResolvedValue(admin);
  vi.mocked(getAdminScopeContext).mockResolvedValue({ adminUser: admin, scopeError: opts.scopeError ?? null } as never);
}

function overrides(entries: Record<string, string> = {}) {
  vi.mocked(readApplicationFormTextOverrides).mockResolvedValue({
    ok: true,
    seasonId: "season-12",
    intakeBatchId: "batch-1",
    overrides: Object.fromEntries(
      Object.entries(entries).map(([key, body]) => [key, { body, updatedAt: null, updatedByName: null }])
    )
  });
}

const save = (submitted: Record<string, unknown>, expected: Record<string, unknown>) =>
  saveApplicationFormTexts({ submitted, expected });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  signIn("core_team");
  overrides();
});

describe("1. ai được sửa", () => {
  it.each(["super_admin", "admin", "core_team"])("%s vận hành được mùa: được", async (role) => {
    signIn(role);
    expect(await canEditFormTextsForSeason("season-12")).toBe(true);
    expect(canOperateSeason).toHaveBeenCalledWith(expect.objectContaining({ scopeError: null }), "season-12");
  });

  it.each(["support_team", "reviewer", "viewer"])("%s: không", async (role) => {
    signIn(role);
    expect(await canEditFormTextsForSeason("season-12")).toBe(false);
  });

  it("tài khoản đã khoá: không", async () => {
    signIn("admin", { status: "inactive" });
    expect(await canEditFormTextsForSeason("season-12")).toBe(false);
  });

  it("không vận hành được mùa này: không", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect(await canEditFormTextsForSeason("season-12")).toBe(false);
  });

  it("bảng phạm vi đọc hỏng: không — và không đánh giá tiếp trên phạm vi rỗng", async () => {
    signIn("admin", { scopeError: "Không đọc được phạm vi." });
    expect(await canEditFormTextsForSeason("season-12")).toBe(false);
    expect(canOperateSeason).not.toHaveBeenCalled();
  });

  it("lỗi bất ngờ khi đọc phạm vi: không", async () => {
    vi.mocked(getAdminScopeContext).mockRejectedValue(new Error("hỏng"));
    expect(await canEditFormTextsForSeason("season-12")).toBe(false);
  });
});

describe("2. lệnh ghi", () => {
  it("sửa hạn nộp: upsert đúng đợt tuyển, đúng khối, đúng người sửa; một dòng nhật ký", async () => {
    const fake = useClient();

    const result = await save({ [NOTE]: NEW_NOTE }, { [NOTE]: D[NOTE] });

    expect(result).toEqual({ ok: true, message: "Đã lưu 1 khối chữ. Form công khai hiện chữ mới ngay.", changed: 1 });
    expect(fake.calls).toEqual([
      {
        op: "upsert",
        table: "application_form_texts",
        rows: [
          {
            intake_batch_id: "batch-1",
            text_key: NOTE,
            body: NEW_NOTE,
            updated_at: expect.any(String),
            updated_by: "u-core_team"
          }
        ],
        options: { onConflict: "intake_batch_id,text_key" }
      }
    ]);
    expect(writeAdminAudit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeAdminAudit).mock.calls[0][1]).toEqual({
      actionType: "update_application_form_text",
      beforeData: { intake_batch_code: "UEHM-S12-B1", texts: { [NOTE]: D[NOTE] } },
      afterData: { intake_batch_code: "UEHM-S12-B1", texts: { [NOTE]: NEW_NOTE } }
    });
  });

  it("sửa về đúng mặc định: xoá dòng đã sửa của đúng đợt tuyển, không upsert", async () => {
    overrides({ [NOTE]: NEW_NOTE });
    const fake = useClient();

    const result = await save({ [NOTE]: D[NOTE] }, { [NOTE]: NEW_NOTE });

    expect(result.ok).toBe(true);
    expect(fake.calls).toEqual([
      {
        op: "delete",
        table: "application_form_texts",
        filters: [
          ["eq", "intake_batch_id", "batch-1"],
          ["in", "text_key", [NOTE]]
        ]
      }
    ]);
  });

  it("không có gì đổi: không ghi, không nhật ký", async () => {
    const fake = useClient();

    expect(await save({ [TITLE]: D[TITLE] }, { [TITLE]: D[TITLE] })).toEqual({
      ok: true,
      message: "Không có khối chữ nào thay đổi.",
      changed: 0
    });
    expect(fake.calls).toEqual([]);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("upsert hỏng: không xoá tiếp, không nhật ký", async () => {
    overrides({ [TITLE]: "Đơn cũ" });
    const fake = useClient({ upsertError: true });

    const result = await save({ [NOTE]: NEW_NOTE, [TITLE]: D[TITLE] }, { [NOTE]: D[NOTE], [TITLE]: "Đơn cũ" });

    expect(result).toEqual({ ok: false, message: "Không lưu được chữ trên form. Thử lại.", changed: 0 });
    expect(fake.calls.map((call) => call.op)).toEqual(["upsert"]);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("xoá hỏng sau khi upsert xong: nói thật là mới lưu một phần; nhật ký chỉ ghi phần đã lưu", async () => {
    overrides({ [TITLE]: "Đơn cũ" });
    useClient({ deleteError: true });

    const result = await save({ [NOTE]: NEW_NOTE, [TITLE]: D[TITLE] }, { [NOTE]: D[NOTE], [TITLE]: "Đơn cũ" });

    expect(result.ok).toBe(false);
    expect(result.changed).toBe(1);
    expect(result.message).toContain("chưa trả được");
    expect(vi.mocked(writeAdminAudit).mock.calls[0][1]).toMatchObject({
      afterData: { texts: { [NOTE]: NEW_NOTE } }
    });
    expect(Object.keys((vi.mocked(writeAdminAudit).mock.calls[0][1] as { afterData: { texts: object } }).afterData.texts)).toEqual([NOTE]);
  });
});

describe("3. không được thì không ghi gì", () => {
  it.each(["support_team", "reviewer"])("%s: từ chối — kể cả khi nội dung sai", async (role) => {
    signIn(role);
    const fake = useClient();

    const result = await save({ [TITLE]: "" }, { [TITLE]: D[TITLE] });

    expect(result).toEqual({ ok: false, message: "Bạn không có quyền sửa chữ trên form đăng ký của mùa này.", changed: 0 });
    expect(fake.calls).toEqual([]);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("không vận hành được mùa: từ chối", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const fake = useClient();

    expect((await save({ [NOTE]: NEW_NOTE }, { [NOTE]: D[NOTE] })).ok).toBe(false);
    expect(fake.calls).toEqual([]);
  });

  it("người khác vừa sửa: không ghi", async () => {
    overrides({ [NOTE]: "Bản người khác" });
    const fake = useClient();

    const result = await save({ [NOTE]: NEW_NOTE }, { [NOTE]: D[NOTE] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vừa được người khác sửa");
    expect(fake.calls).toEqual([]);
  });

  it("chưa đọc được bảng chữ (migration chưa chạy): không ghi", async () => {
    vi.mocked(readApplicationFormTextOverrides).mockResolvedValue({ ok: false, reason: "texts_unreadable" });
    const fake = useClient();

    const result = await save({ [NOTE]: NEW_NOTE }, { [NOTE]: D[NOTE] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Migration application_form_texts");
    expect(fake.calls).toEqual([]);
  });

  it("chưa đăng nhập: không đọc, không ghi", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    const fake = useClient();

    expect((await save({ [NOTE]: NEW_NOTE }, { [NOTE]: D[NOTE] })).message).toBe("Bạn chưa đăng nhập.");
    expect(readApplicationFormTextOverrides).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });
});
