"use server";

import { revalidatePath } from "next/cache";
import { classifyNewPeople, confirmMentorGroups, setIndustryGroup, setRound2Window } from "@/lib/matching-round2";
import { parseGroupApprovals } from "@/lib/matching-round2-bulk-core";
import { runRound2Dispatch, sendRound2InviteTest } from "@/lib/matching-round2-dispatch";
import { parseVietnamDateTime } from "@/lib/event-datetime";
import type { Round2ActionState } from "@/lib/matching-round2-action-types";

const PATHS = ["/matches/vong-2", "/matches/vong-2/bao-cao"];

export async function confirmMentorGroupsAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  if (form.get("confirmed") !== "yes") return { status: "error", message: "Cần xác nhận danh sách trước khi duyệt." };
  let rows;
  try { rows = parseGroupApprovals(JSON.parse(String(form.get("rows") ?? ""))); } catch { rows = null; }
  if (!rows) return { status: "error", message: "Danh sách không hợp lệ. Chọn từ 1 đến 500 mentor rồi thử lại." };
  const result = await confirmMentorGroups(rows);
  if (result.ok) for (const path of PATHS) revalidatePath(path);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

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

/** BTC đặt giờ mở/đóng vòng 2 và đợt gửi thư hiện hành. Giờ nhập theo giờ Việt Nam. */
export async function setRound2WindowAction(_prev: Round2ActionState, formData: FormData): Promise<Round2ActionState> {
  const opensAt = parseVietnamDateTime(formData.get("opensAt"));
  const closesRaw = String(formData.get("closesAt") ?? "").trim();
  const closesAt = closesRaw ? parseVietnamDateTime(closesRaw) : null;
  const wave = Number(String(formData.get("wave") ?? "").trim());
  if (!opensAt) return { status: "error", message: "Cần giờ mở vòng 2 (ngày + giờ)." };
  if (closesRaw && !closesAt) return { status: "error", message: "Giờ đóng không đọc được — nhập đủ ngày và giờ, hoặc để trống." };
  if (!Number.isInteger(wave) || wave < 1 || wave > 9) return { status: "error", message: "Đợt gửi không hợp lệ." };
  const result = await setRound2Window({ opensAt, closesAt, wave });
  if (result.ok) for (const path of PATHS) revalidatePath(path);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

export async function sendRound2TestAction(_prev: Round2ActionState, _formData: FormData): Promise<Round2ActionState> {
  const result = await sendRound2InviteTest();
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/** Gửi thật. Chỉ chạy khi form mang đúng dấu xác nhận của bước thứ hai trên trang. */
export async function sendRound2InvitesAction(_prev: Round2ActionState, formData: FormData): Promise<Round2ActionState> {
  if (formData.get("confirmed") !== "yes") return { status: "error", message: "Cần bấm xác nhận trước khi gửi." };
  const result = await runRound2Dispatch();
  for (const path of PATHS) revalidatePath(path);
  return { status: result.ok ? "ok" : "error", message: result.message };
}
