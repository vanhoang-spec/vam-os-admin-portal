/**
 * Trainer và Speaker là vai trò trong mùa.
 *
 * ---------------------------------------------------------------------------
 * CÁI BẪY MÀ BỘ TEST NÀY CANH
 * ---------------------------------------------------------------------------
 * `vam063_add_membership_role` ghi vào HAI bảng trong một transaction:
 * `person_season_memberships` rồi `person_season_membership_log`. Cả hai mang
 * một ràng buộc CHECK riêng với cùng một danh sách vai trò.
 *
 * Nới mỗi bảng thứ nhất thì mọi thứ trông như đã xong — migration chạy sạch,
 * ô chọn hiện Trainer, server action nhận giá trị — và thao tác vẫn đổ, vì dòng
 * log bị chặn và cả transaction quay lui. Người vận hành chỉ thấy "không thêm
 * được vai trò".
 *
 * Không cổng nào trong bốn cổng bắt được chuyện đó, nên nó được khoá ở đây.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_LABELS,
  isMembershipRole,
  initialMembershipLifecycleState
} from "@/lib/membership-lifecycle";
import { participantRoleLabel } from "@/lib/participant-home";
import { addMembershipRoleAction } from "@/app/actions/membership-lifecycle";
import { getAdminScopeContext, canOperateSeason } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const MIGRATION = "supabase/migrations/20260912100000_membership_roles_trainer_speaker.sql";
const read = (path: string) => readFileSync(path, "utf8");

const PERSON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const SEASON = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";

/** Chín giá trị đã nằm trong CHECK trước migration này. Không được mất cái nào. */
const PRE_EXISTING_ROLES = [
  "mentee", "mentor", "supporter", "reviewer", "interviewer",
  "coreteam", "advisor", "alumni_mentee", "guest"
];

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function client(rpcOutcome = "created") {
  const chain: any = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: { id: SEASON, program_id: PROGRAM }, error: null }))
  };
  const rpc = vi.fn(async () => ({ data: [{ outcome_status: rpcOutcome }], error: null }));
  return { from: vi.fn(() => chain), rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAdminScopeContext).mockResolvedValue({
    adminUser: { id: ACTOR, role: "core_team", status: "active", auth_user_id: "auth-synthetic" } as any,
    authUserId: "auth-synthetic", globalRole: "core_team", isSuperAdmin: false, programScopes: [], scopeError: null
  });
  vi.mocked(canOperateSeason).mockResolvedValue(true);
});

describe("1. danh sách vai trò thêm tay được", () => {
  it("gồm đúng bốn vai trò: mentor, mentee, trainer, speaker", () => {
    expect([...MEMBERSHIP_ROLES]).toEqual(["mentor", "mentee", "trainer", "speaker"]);
  });

  it("nhận trainer và speaker", () => {
    expect(isMembershipRole("trainer")).toBe(true);
    expect(isMembershipRole("speaker")).toBe(true);
  });

  it("vẫn TỪ CHỐI những vai trò cố ý để ngoài đường thêm tay", () => {
    // reviewer và interviewer lưu được trong bảng nhưng do đường cấp quyền
    // tuyển sinh ghi ra kèm những thứ khác. Thêm tay một dòng membership trần
    // tạo ra một reviewer không chấm được gì — im lặng và khó tìm.
    for (const role of ["reviewer", "interviewer", "supporter", "coreteam", "advisor", "alumni_mentee", "guest", "admin", "core_team", ""]) {
      expect(isMembershipRole(role), `${role} không được thêm tay`).toBe(false);
    }
  });

  it("mỗi vai trò có một nhãn riêng, không trùng nhau", () => {
    const labels = MEMBERSHIP_ROLES.map((role) => MEMBERSHIP_ROLE_LABELS[role]);
    for (const label of labels) expect(label.trim().length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("2. một cửa cho tên gọi", () => {
  it("màn hình của người tham gia gọi Trainer và Speaker đúng như CRM", () => {
    expect(participantRoleLabel("trainer")).toBe(MEMBERSHIP_ROLE_LABELS.trainer);
    expect(participantRoleLabel("speaker")).toBe(MEMBERSHIP_ROLE_LABELS.speaker);
  });

  it("không làm hỏng những nhãn đã có", () => {
    expect(participantRoleLabel("mentor")).toBe("Mentor");
    expect(participantRoleLabel("mentee")).toBe("Mentee");
    expect(participantRoleLabel("alumni_mentee")).toBe("Mentee (cựu)");
    expect(participantRoleLabel("advisor")).toBe("Cố vấn");
  });

  it("hồ sơ trong CRM lấy nhãn từ cùng một nguồn, không tự viết lại", () => {
    const page = read("app/people/[id]/page.tsx");
    expect(page).toContain("MEMBERSHIP_ROLE_LABELS");
    // Một cách viết thứ hai cho cùng bốn vai trò là một cơ hội để hai màn hình
    // gọi cùng một người bằng hai cái tên.
    expect(page).not.toContain('=== "mentor") return "Mentor"');
    expect(page).not.toContain('=== "mentee") return "Mentee"');
  });

  it("ô chọn dựng từ hằng số, không khoá cứng trong JSX", () => {
    const ui = read("app/people/[id]/membership-lifecycle-controls.tsx");
    expect(ui).toContain("MEMBERSHIP_ROLES.map");
    expect(ui).not.toContain('<option value="mentor">');
    expect(ui).not.toContain('<option value="mentee">');
  });
});

describe("3. server action", () => {
  it.each(["trainer", "speaker"])("chuyển %s xuống RPC với actor của phiên", async (role) => {
    const db = client();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    const result = await addMembershipRoleAction(
      initialMembershipLifecycleState,
      form({ person_id: PERSON, program_id: PROGRAM, season_id: SEASON, role, reason: "synthetic" })
    );
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith(
      "vam063_add_membership_role",
      expect.objectContaining({ p_actor_admin_user_id: ACTOR, p_role: role })
    );
  });

  it("vai trò ngoài danh sách bị chặn TRƯỚC khi gọi RPC", async () => {
    // Ô chọn đã lọc trên màn hình không phải một phép kiểm: giá trị đến từ
    // biểu mẫu là thứ người gửi tự đặt được.
    for (const role of ["reviewer", "interviewer", "admin", "super_admin"]) {
      const db = client();
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
      const result = await addMembershipRoleAction(
        initialMembershipLifecycleState,
        form({ person_id: PERSON, program_id: PROGRAM, season_id: SEASON, role })
      );
      expect(result.ok, role).toBe(false);
      expect(db.rpc, `${role} không được xuống tới RPC`).not.toHaveBeenCalled();
    }
  });
});

describe("4. migration", () => {
  const sql = read(MIGRATION);

  it("nới CẢ HAI ràng buộc, không chỉ bảng membership", () => {
    // Soi ĐÚNG khối nới, không tìm chung cả file: tên hai bảng còn xuất hiện ở
    // khối tự kiểm, nên một phép tìm chung vẫn xanh khi khối nới đã đánh rơi
    // bảng log — đúng kiểu test xanh vô nghĩa mà nếp của dự án này canh.
    const start = sql.indexOf("$widen_membership_roles$");
    expect(start, "không tìm thấy khối nới ràng buộc").toBeGreaterThan(-1);
    const widen = sql.slice(start, sql.indexOf("$widen_membership_roles$;", start));
    for (const needle of [
      "public.person_season_memberships",
      "person_season_memberships_role_check",
      "public.person_season_membership_log",
      "person_season_membership_log_role_check"
    ]) {
      expect(widen, "khối nới phải chạm " + needle).toContain(needle);
    }
  });

  it("nới theo lối cộng thêm: đọc lại định nghĩa rồi nối, không viết đè danh sách", () => {
    expect(sql).toContain("pg_get_constraintdef");
    expect(sql).toContain("regexp_replace");
    // Viết đè nghĩa là chép tay chín giá trị cũ vào một câu `check (role in (...))`;
    // chép thiếu một cái thì vai trò đó lặng lẽ ngừng lưu được.
    expect(sql).not.toMatch(/add\s+constraint\s+person_season_membership[a-z_]*_role_check\s+check\s*\(/i);
  });

  it("tự kiểm rằng không mất giá trị cũ nào", () => {
    const selfCheck = sql.slice(sql.indexOf("$self_check$"));
    for (const role of PRE_EXISTING_ROLES) {
      expect(selfCheck, `tự kiểm phải canh giá trị cũ ${role}`).toContain(`'${role}'`);
    }
    expect(selfCheck).toContain("đã MẤT giá trị cũ");
  });

  it("tự kiểm rằng hai giá trị mới đã vào cả hai ràng buộc", () => {
    const selfCheck = sql.slice(sql.indexOf("$self_check$"));
    expect(selfCheck).toContain("person_season_memberships_role_check chưa nhận");
    expect(selfCheck).toContain("person_season_membership_log_role_check chưa nhận");
  });

  it("mở cổng vai trò của hàm ghi, giữ nguyên mọi cổng khác", () => {
    expect(sql).toContain("'mentor','mentee','trainer','speaker'");
    // Những phép kiểm khác của hàm không được rơi mất khi chép lại thân hàm.
    for (const guard of [
      "VAM063 trusted server context required",
      "VAM063 unauthorized actor",
      "VAM063 actor not authorized for this program-season scope",
      "VAM063 cross-program reassignment denied",
      "pg_advisory_xact_lock"
    ]) {
      expect(sql, `hàm phải giữ ${guard}`).toContain(guard);
    }
  });

  it("chạy lại lần hai không nhân đôi giá trị", () => {
    expect(sql).toContain("position('''trainer''' in existing) > 0");
  });

  it("KHÔNG đụng tới ràng buộc của bảng lời mời gia hạn", () => {
    // person_season_invites là đường gửi lời mời mùa mới cho mentor cũ. Trainer
    // và speaker không đi qua đó, và nới nhầm nó sẽ mở một đường mời ngoài ý.
    expect(sql).not.toMatch(new RegExp("alter\s+table\s+(public\.)?person_season_invites", "i"));
  });

  it("có preflight và không chứa lệnh xoá dữ liệu", () => {
    expect(sql).toContain("PREFLIGHT_FAILED");
    expect(sql).not.toMatch(/delete\s+from|drop\s+table|truncate/i);
  });
});
