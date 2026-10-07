"use server";

import { revalidatePath } from "next/cache";
import { classifyNewPeople, setIndustryGroup } from "@/lib/matching-round2";
import type { Round2ActionState } from "@/lib/matching-round2-action-types";

const PATHS = ["/matches/vong-2", "/matches/vong-2/bao-cao"];

export async function classifyNewAction(_prev: Round2ActionState, _formData: FormData): Promise<Round2ActionState> {
  const result = await classifyNewPeople();
  if (result.ok) for (const path of PATHS) revalidatePath(path);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

function groupNumber(value: FormDataEntryValue | null): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null;
}

export async function setGroupAction(_prev: Round2ActionState, formData: FormData): Promise<Round2ActionState> {
  // Mọi ô đều do người gửi tự đặt được: kiểm hình dạng ở đây, quyền và nhóm hiện tại do
  // máy chủ + RPC kiểm lại.
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  const expectedGroup = groupNumber(formData.get("expectedGroup"));
  const newGroup = groupNumber(formData.get("newGroup"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId) || expectedGroup === null || newGroup === null) {
    return { status: "error", message: "Dữ liệu không hợp lệ — tải lại trang rồi thử lại." };
  }
  if (!reason) return { status: "error", message: "Cần ghi lý do." };
  const result = await setIndustryGroup({ assignmentId, expectedGroup, newGroup, reason });
  if (result.ok) for (const path of PATHS) revalidatePath(path);
  return { status: result.ok ? "ok" : "error", message: result.message };
}
