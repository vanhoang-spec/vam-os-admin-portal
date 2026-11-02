/**
 * Mã thành viên trên giao diện (PR-2). Biểu mẫu sửa hồ sơ không được ghi mã cũ: luồng gia hạn tra mentor_code để
 * nhận ra người cũ, nên một ô để trống trên màn hình có thể xoá mất đường nhận diện đó.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, state: unknown) => [state, action],
  useFormStatus: () => ({ pending: false })
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => auth.user }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: () => ({ rpc }) }));

import { assignMemberCodeAction, setMemberCodeAction } from "@/app/actions/member-code";
import { MemberCodePanel } from "@/app/people/[id]/member-code-panel";
import { memberCodeErrorMessage, parseStartYear } from "@/lib/member-code-core";
import { canManageMemberCode } from "@/lib/permissions";

const source = (file: string) => readFileSync(path.resolve(file), "utf8");
const PERSON = "00000000-0000-4000-8000-000000000001";
const initial = { ok: false, message: null };
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  auth.user = { id: "admin-1", role: "admin" };
  rpc.mockReset();
  rpc.mockResolvedValue({ data: "UEHC0001", error: null });
});

describe("quyền", () => {
  it("chỉ super_admin và admin", () => {
    expect(["super_admin", "admin"].every(canManageMemberCode)).toBe(true);
    for (const role of ["core_team", "support_team", "reviewer", "viewer", "", null]) expect(canManageMemberCode(role)).toBe(false);
  });

  it("core team gửi thẳng biểu mẫu cũng không gọi được database", async () => {
    auth.user = { id: "core-1", role: "core_team" };
    expect((await assignMemberCodeAction(initial, form({ person_id: PERSON, group: "C" }))).ok).toBe(false);
    expect((await setMemberCodeAction(initial, form({ person_id: PERSON, code: "UEHC0001" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập cũng vậy", async () => {
    auth.user = null;
    expect((await assignMemberCodeAction(initial, form({ person_id: PERSON, group: "C" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cấp và sửa mã", () => {
  it("cấp mã gửi đúng người, nhóm, người thao tác", async () => {
    const state = await assignMemberCodeAction(initial, form({ person_id: PERSON, group: "C" }));
    expect(state).toEqual({ ok: true, message: "Đã lưu mã UEHC0001." });
    expect(rpc).toHaveBeenCalledWith("vam124_assign_member_code", { p_person_id: PERSON, p_group: "C", p_source: "admin_assign", p_actor_admin_user_id: "admin-1" });
  });

  it("nhóm lạ không tới database", async () => {
    expect((await assignMemberCodeAction(initial, form({ person_id: PERSON, group: "X" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sửa mã chuẩn hoá chữ hoa, chặn sai dạng trước khi gọi database", async () => {
    await setMemberCodeAction(initial, form({ person_id: PERSON, code: "uehr0007" }));
    expect(rpc).toHaveBeenCalledWith("vam124_set_member_code", { p_person_id: PERSON, p_code: "UEHR0007", p_actor_admin_user_id: "admin-1" });
    rpc.mockClear();
    expect((await setMemberCodeAction(initial, form({ person_id: PERSON, code: "UEHRF0800" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lỗi database hiện thành câu tiếng Việt, không lộ mã lỗi", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "MEMBER_CODE_GROUP_NOT_OPEN" } });
    const state = await assignMemberCodeAction(initial, form({ person_id: PERSON, group: "S" }));
    expect(state).toEqual({ ok: false, message: "Nhóm này chưa mở cấp mã. Chờ xong đợt cấp mã ban đầu." });
    expect(memberCodeErrorMessage("connection reset")).toBe("Không lưu được mã. Vui lòng thử lại.");
  });
});

describe("khung mã trên hồ sơ", () => {
  it("người không có quyền chỉ xem, không có biểu mẫu", () => {
    const html = renderToStaticMarkup(<MemberCodePanel personId={PERSON} memberCode="UEHR0001" canManage={false} />);
    expect(html).toContain("UEHR0001");
    expect(html).not.toContain("<form");
  });
  it("chưa có mã thì admin thấy chọn nhóm, có mã thì thấy ô sửa", () => {
    expect(renderToStaticMarkup(<MemberCodePanel personId={PERSON} memberCode={null} canManage />)).toContain("Cấp mã");
    const html = renderToStaticMarkup(<MemberCodePanel personId={PERSON} memberCode="UEHR0001" canManage />);
    expect(html).toContain("Sửa mã");
    expect(html).not.toContain("Cấp mã");
  });
});

describe("năm bắt đầu", () => {
  it("nhận năm hợp lệ, rỗng là chưa rõ, chặn gõ nhầm", () => {
    expect(parseStartYear("2016")).toEqual({ ok: true, value: 2016 });
    expect(parseStartYear(" ")).toEqual({ ok: true, value: null });
    for (const bad of ["2015", "20", "abc", "2016.5"]) expect(parseStartYear(bad).ok).toBe(false);
  });
});

describe("mã cũ không đi qua biểu mẫu", () => {
  it("hàm cập nhật hồ sơ không ghi mentor_code, mentee_code", () => {
    const code = source("lib/people-create.ts");
    const mentor = code.slice(code.indexOf("const mentorUpdates: JsonRecord = {"));
    expect(mentor.slice(0, mentor.indexOf("};"))).not.toContain("mentor_code");
    const mentee = code.slice(code.indexOf("const menteeUpdates: JsonRecord = {"));
    expect(mentee.slice(0, mentee.indexOf("};"))).not.toContain("mentee_code");
  });
  it("ô mã cũ trên form sửa không có name nên không được gửi đi", () => {
    expect(source("app/mentors/[id]/edit/edit-mentor-form.tsx")).not.toContain('name="mentor_code"');
    expect(source("app/mentees/[id]/edit/edit-mentee-form.tsx")).not.toContain('name="mentee_code"');
  });
});

describe("hiển thị và tìm kiếm", () => {
  it("danh sách mentor, mentee tìm được theo mã mới và mã cũ", () => {
    for (const file of ["app/mentors/page.tsx", "app/mentees/page.tsx"]) {
      const keys = /searchKeys=\{\[(.*?)\]\}/.exec(source(file))?.[1] ?? "";
      expect(keys).toContain('"member_code"');
    }
    expect(/searchKeys=\{\[(.*?)\]\}/.exec(source("app/mentors/page.tsx"))?.[1]).toContain('"mentor_code"');
    expect(/searchKeys=\{\[(.*?)\]\}/.exec(source("app/mentees/page.tsx"))?.[1]).toContain('"mentee_code"');
  });
  it("trang ghép cặp đọc được mã mới từ bảng người", () => {
    expect(source("lib/matches.ts")).toContain('.select("id,full_name,email_primary,phone_primary,member_code")');
  });
  it("hồ sơ xuất ra có Mã thành viên, mã cũ đổi nhãn", () => {
    const code = source("lib/application-export.ts");
    expect(code).toContain('"Mã thành viên", person?.member_code');
    expect(code).not.toContain('"Mã Mentor"');
    expect(code).not.toContain('"Mã Mentee"');
  });
});
