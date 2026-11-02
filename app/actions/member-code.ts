"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { assignMemberCode, setMemberCode } from "@/lib/member-code";
import { isMemberCode, isMemberCodeGroup } from "@/lib/member-code-core";
import { canManageMemberCode } from "@/lib/permissions";

export type MemberCodeActionState = { ok: boolean; message: string | null };

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

async function actorId() {
  const adminUser = await getCurrentAdminUser();
  return adminUser && canManageMemberCode(adminUser.role) ? adminUser.id : null;
}

function done(personId: string, code: string): MemberCodeActionState {
  revalidatePath(`/people/${personId}`, "page");
  return { ok: true, message: `Đã lưu mã ${code}.` };
}

export async function assignMemberCodeAction(_previous: MemberCodeActionState, formData: FormData): Promise<MemberCodeActionState> {
  const actor = await actorId();
  if (!actor) return { ok: false, message: "Chỉ admin mới được cấp mã thành viên." };
  const personId = text(formData, "person_id");
  const group = text(formData, "group");
  if (!personId || !isMemberCodeGroup(group)) return { ok: false, message: "Chọn nhóm trước khi cấp mã." };
  const result = await assignMemberCode(personId, group, actor);
  return result.ok ? done(personId, result.code) : { ok: false, message: result.message };
}

export async function setMemberCodeAction(_previous: MemberCodeActionState, formData: FormData): Promise<MemberCodeActionState> {
  const actor = await actorId();
  if (!actor) return { ok: false, message: "Chỉ admin mới được sửa mã thành viên." };
  const personId = text(formData, "person_id");
  const code = text(formData, "code").toUpperCase();
  if (!personId || !isMemberCode(code)) return { ok: false, message: "Mã phải có dạng UEH + R/E/S/C + 4 số, ví dụ UEHR0001." };
  const result = await setMemberCode(personId, code, actor);
  return result.ok ? done(personId, result.code) : { ok: false, message: result.message };
}
