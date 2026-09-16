/**
 * Ai được đặt mốc điểm cộng theo ngày nộp — và lệnh ghi phát ra đúng những gì.
 *
 * Mốc đổi điểm mà Core Team dùng để xếp hạng hàng trăm đơn. Canh: chỉ người được
 * đặt mới ghi được, lỗi hạ tầng không thành quyền, lệnh thêm ghi đúng đợt tuyển /
 * vai trò / người đặt, lệnh xoá không xoá được mốc của form khác bằng một id tự đặt,
 * và mọi lần bị từ chối là KHÔNG có lệnh ghi nào, kể cả nhật ký.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/events", () => ({ writeAdminAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/application-form-controls", () => ({
  S12_BINDING: { programCode: "UEHM", seasonCode: "UEHM-S12", intakeBatchCode: "UEHM-S12-B1" },
  isApplicantRole: (value: unknown) => value === "mentor" || value === "mentee",
  readApplicationFormControls: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { readApplicationFormControls } from "@/lib/application-form-controls";
import { writeAdminAudit } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  addApplicationBonusRule,
  canManageBonusForSeason,
  deleteApplicationBonusRule
} from "@/lib/submission-bonus-write";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

const BATCH = "33333333-3333-4333-8333-333333333333";
const OTHER_BATCH = "44444444-4444-4444-8444-444444444444";
const RULE_MENTEE = "aaaaaaaa-0000-4000-8000-000000000001";
const RULE_MENTOR = "aaaaaaaa-0000-4000-8000-000000000002";
const RULE_OTHER_BATCH = "aaaaaaaa-0000-4000-8000-000000000003";

const db = createFakeDb();

const user = (role: string, status = "active") => ({ id: `u-${role}`, role, status }) as never;

function signIn(role: string, opts: { status?: string; scopeError?: string | null } = {}) {
  const admin = user(role, opts.status);
  vi.mocked(getCurrentAdminUser).mockResolvedValue(admin);
  vi.mocked(getAdminScopeContext).mockResolvedValue({ adminUser: admin, scopeError: opts.scopeError ?? null } as never);
}

function formControls(ok = true) {
  const control = { seasonId: "season-12", intakeBatchId: BATCH };
  vi.mocked(readApplicationFormControls).mockResolvedValue(
    (ok ? { ok: true, controls: { mentor: control, mentee: control } } : { ok: false, reason: "control_rows_missing" }) as never
  );
}

const ruleRow = (over: Record<string, unknown>) => ({
  id: RULE_MENTEE,
  form_kind: "application",
  intake_batch_id: BATCH,
  role_applied: "mentee",
  label: null,
  starts_on: null,
  ends_on: "2026-09-10",
  points: 3,
  created_at: "2026-09-16T05:00:00Z",
  ...over
});

const writes = (kind: "insert" | "delete") =>
  db.writes.filter((write) => write.table === "submission_bonus_rules" && write.kind === kind);

const validAdd = { role: "mentee", label: "Nộp sớm", startsOn: "01/09/2026", endsOn: "10/09/2026", points: "3" };

beforeEach(() => {
  db.reset();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  formControls();
  signIn("support_team");
  db.tables.submission_bonus_rules = [
    ruleRow({}),
    ruleRow({ id: RULE_MENTOR, role_applied: "mentor", points: 2 }),
    ruleRow({ id: RULE_OTHER_BATCH, intake_batch_id: OTHER_BATCH, points: 9 })
  ];
});

describe("1. ai được đặt mốc", () => {
  it.each(["super_admin", "admin", "core_team", "support_team"])("%s vận hành được mùa: được", async (role) => {
    signIn(role);
    expect(await canManageBonusForSeason("season-12")).toBe(true);
    expect(canOperateSeason).toHaveBeenCalledWith(expect.objectContaining({ scopeError: null }), "season-12");
  });

  it.each(["reviewer", "viewer", "", "unknown_role"])("vai trò %s: không", async (role) => {
    signIn(role);
    expect(await canManageBonusForSeason("season-12")).toBe(false);
  });

  it("tài khoản đã khoá: không", async () => {
    signIn("support_team", { status: "inactive" });
    expect(await canManageBonusForSeason("season-12")).toBe(false);
  });

  it("không vận hành được mùa này: không", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect(await canManageBonusForSeason("season-12")).toBe(false);
  });

  it("bảng phạm vi đọc hỏng: không — và không đánh giá tiếp trên phạm vi rỗng", async () => {
    signIn("admin", { scopeError: "Không đọc được phạm vi." });
    expect(await canManageBonusForSeason("season-12")).toBe(false);
    expect(canOperateSeason).not.toHaveBeenCalled();
  });

  it("lỗi bất ngờ khi đọc phạm vi: không", async () => {
    vi.mocked(getAdminScopeContext).mockRejectedValue(new Error("mạng"));
    expect(await canManageBonusForSeason("season-12")).toBe(false);
  });
});

describe("2. thêm mốc", () => {
  it("support_team thêm được: đúng một lệnh ghi, đúng từng cột", async () => {
    const result = await addApplicationBonusRule(validAdd);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Nộp từ 01/09/2026 đến hết 10/09/2026");
    expect(writes("insert")).toHaveLength(1);
    expect(writes("insert")[0].rows).toEqual([
      {
        form_kind: "application",
        intake_batch_id: BATCH,
        role_applied: "mentee",
        label: "Nộp sớm",
        starts_on: "2026-09-01",
        ends_on: "2026-09-10",
        points: 3,
        created_by: "u-support_team"
      }
    ]);
    expect(writes("delete")).toHaveLength(0);
  });

  it("đợt tuyển lấy từ bản ghi điều khiển form, không từ thứ người gửi đặt", async () => {
    await addApplicationBonusRule({ ...validAdd, intake_batch_id: OTHER_BATCH } as never);
    expect(writes("insert")[0].rows[0].intake_batch_id).toBe(BATCH);
  });

  it("nhật ký: một dòng, trước là mốc của ĐÚNG form này, sau thêm đúng mốc vừa thêm", async () => {
    await addApplicationBonusRule(validAdd);
    expect(writeAdminAudit).toHaveBeenCalledTimes(1);
    const audit = vi.mocked(writeAdminAudit).mock.calls[0][1] as any;
    expect(audit.actionType).toBe("update_submission_bonus_rules");
    expect(audit.beforeData.role).toBe("mentee");
    expect(audit.beforeData.rules.map((entry: any) => entry.id)).toEqual([RULE_MENTEE]);
    expect(audit.afterData.added).toMatchObject({ starts_on: "2026-09-01", ends_on: "2026-09-10", points: 3 });
    expect(audit.afterData.rules).toHaveLength(2);
  });

  it.each(["reviewer", "viewer"])("%s: từ chối, không ghi gì cả", async (role) => {
    signIn(role);
    const result = await addApplicationBonusRule(validAdd);
    expect(result.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("không vận hành được mùa: từ chối, không đọc cả bảng mốc", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect((await addApplicationBonusRule(validAdd)).ok).toBe(false);
    expect(db.writes).toHaveLength(0);
    expect(db.requests.filter((request) => request.table === "submission_bonus_rules")).toHaveLength(0);
  });

  it("vai trò form lạ: từ chối trước khi chạm database", async () => {
    expect((await addApplicationBonusRule({ ...validAdd, role: "admin" })).ok).toBe(false);
    expect(db.requests).toHaveLength(0);
    expect(db.writes).toHaveLength(0);
  });

  it("không đọc được form đăng ký: không ghi", async () => {
    formControls(false);
    expect((await addApplicationBonusRule(validAdd)).ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it("không đọc được bảng mốc (migration chưa chạy): không ghi, và nói rõ", async () => {
    db.errors.submission_bonus_rules = { code: "42P01", message: "relation does not exist" };
    const result = await addApplicationBonusRule(validAdd);
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("submission_bonus_rules");
    expect(db.writes).toHaveLength(0);
  });

  it("ô ngày gõ dở: từ chối, không ghi", async () => {
    expect((await addApplicationBonusRule({ ...validAdd, endsOn: "10/09/20" })).ok).toBe(false);
    expect(db.writes).toHaveLength(0);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("đã đủ 20 mốc: từ chối, không ghi", async () => {
    db.tables.submission_bonus_rules = Array.from({ length: 20 }, (_, index) =>
      ruleRow({ id: `aaaaaaaa-0000-4000-8000-1000000000${String(index).padStart(2, "0")}` })
    );
    expect((await addApplicationBonusRule(validAdd)).ok).toBe(false);
    expect(writes("insert")).toHaveLength(0);
  });

  it("lệnh ghi hỏng: báo lỗi, không ghi nhật ký", async () => {
    db.errors["insert:submission_bonus_rules"] = { message: "ghi hỏng" };
    expect((await addApplicationBonusRule(validAdd)).ok).toBe(false);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });
});

describe("3. xoá mốc", () => {
  it("xoá đúng mốc, lệnh xoá khoá cả id lẫn form (đợt tuyển + vai trò)", async () => {
    const result = await deleteApplicationBonusRule({ role: "mentee", ruleId: RULE_MENTEE });
    expect(result.ok).toBe(true);
    expect(writes("delete")).toHaveLength(1);
    const filters = JSON.parse(writes("delete")[0].filters);
    expect(filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "id", value: RULE_MENTEE },
        { kind: "eq", column: "form_kind", value: "application" },
        { kind: "eq", column: "intake_batch_id", value: BATCH },
        { kind: "eq", column: "role_applied", value: "mentee" }
      ])
    );
    expect(db.tables.submission_bonus_rules.map((row) => row.id)).toEqual([RULE_MENTOR, RULE_OTHER_BATCH]);
  });

  it("nhật ký ghi mốc bị xoá và danh sách còn lại", async () => {
    await deleteApplicationBonusRule({ role: "mentee", ruleId: RULE_MENTEE });
    const audit = vi.mocked(writeAdminAudit).mock.calls[0][1] as any;
    expect(audit.afterData.removed).toMatchObject({ id: RULE_MENTEE, points: 3 });
    expect(audit.afterData.rules).toEqual([]);
  });

  it.each([
    ["mốc của form mentor, gửi kèm vai trò mentee", RULE_MENTOR],
    ["mốc của đợt tuyển khác", RULE_OTHER_BATCH],
    ["id không phải uuid", "1 or 1=1"],
    ["id không tồn tại", "aaaaaaaa-0000-4000-8000-00000000ffff"]
  ])("id tự đặt — %s: không có lệnh xoá nào", async (_name, ruleId) => {
    const result = await deleteApplicationBonusRule({ role: "mentee", ruleId });
    expect(result.ok).toBe(false);
    expect(writes("delete")).toHaveLength(0);
    expect(writeAdminAudit).not.toHaveBeenCalled();
    expect(db.tables.submission_bonus_rules).toHaveLength(3);
  });

  it.each(["reviewer", "viewer"])("%s: từ chối, không xoá", async (role) => {
    signIn(role);
    expect((await deleteApplicationBonusRule({ role: "mentee", ruleId: RULE_MENTEE })).ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });

  it("lệnh xoá hỏng: báo lỗi, không ghi nhật ký", async () => {
    db.errors["delete:submission_bonus_rules"] = { message: "xoá hỏng" };
    expect((await deleteApplicationBonusRule({ role: "mentee", ruleId: RULE_MENTEE })).ok).toBe(false);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });
});
