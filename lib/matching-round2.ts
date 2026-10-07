import "server-only";

/**
 * Ghép cặp Vòng 2 — đọc dữ liệu và ghi kết quả phân nhóm (BTC 07/10/2026).
 *
 * Phần tính toán nằm ở lib/matching-round2-core.ts (thuần). Đây chỉ đọc bảng, dựng đầu
 * vào cho phần thuần, và gọi hai RPC vam112. Mọi đường ghi tự kiểm quyền ở máy chủ, rồi
 * RPC kiểm lại lần nữa trong database.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { applicantPayload, pickQuickViewApplication } from "@/lib/matching-quick-view-core";
import {
  assignmentRowsForSave,
  buildRound2Board,
  type Round2Assignment,
  type Round2Board,
  type Round2Match,
  type Round2Person
} from "@/lib/matching-round2-core";
import { CLASSIFICATION_RULE_VERSION } from "@/lib/matching-round2-classify-core";
import { applicationOptionLabel } from "@/lib/application-form-options";
import { MENTOR_FUNCTION_OPTIONS, MENTOR_INDUSTRY_OPTIONS } from "@/lib/mentor-intake-content";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { canManageMatches } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { Application } from "@/lib/types";

type Row = Record<string, any>;

export type Round2Data = {
  seasonId: string;
  seasonCode: string;
  board: Round2Board;
  canManage: boolean;
};

const INACTIVE_MEMBERSHIP = new Set(["withdrawn", "opted_out"]);

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function optionLabel(options: ReadonlyArray<{ value: string; label: string }>, value: unknown): string | null {
  const v = text(value);
  if (!v) return null;
  return options.find((o) => o.value === v)?.label ?? v;
}

export async function round2SeasonContext() {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("DATABASE_UNAVAILABLE");
  const code = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  const { data, error } = await client.from("seasons").select("id").eq("code", code).maybeSingle();
  if (error || !data) throw new Error("SEASON_UNAVAILABLE");
  return { client, seasonId: String(data.id), seasonCode: code };
}

/** Đọc toàn bộ dữ liệu vòng 2 của mùa và dựng bảng. Không ghi gì. */
export async function loadRound2Board(client: any, seasonId: string): Promise<Round2Board> {
  const apps = await readAllPages<Row>(
    "applications",
    "id,person_id,role_applied,status,source,submitted_at,raw_payload",
    (columns) => client.from("applications").select(columns).eq("season_id", seasonId).in("status", ["approved_as_mentor", "approved_as_mentee"])
  );
  if (apps.error) throw new Error("READ_FAILED");

  // Một người, một vai: nếu có nhiều đơn đã duyệt thì lấy đúng đơn trang hồ sơ đang lấy.
  const byPersonRole = new Map<string, Row[]>();
  for (const app of apps.data) {
    if (!app.person_id) continue;
    const role = app.status === "approved_as_mentor" ? "mentor" : "mentee";
    const key = `${role}|${app.person_id}`;
    byPersonRole.set(key, [...(byPersonRole.get(key) ?? []), app]);
  }
  const personIds = Array.from(new Set(apps.data.map((a) => String(a.person_id ?? "")).filter(Boolean)));
  const mentorIds = Array.from(new Set(Array.from(byPersonRole.keys()).filter((k) => k.startsWith("mentor|")).map((k) => k.slice(7))));

  const [people, profiles, matches, memberships, assignments] = await Promise.all([
    readAllPagesIn<Row>(client, "people", "id", personIds, "id,full_name,email_primary"),
    readAllPagesIn<Row>(client, "mentor_profiles", "person_id", mentorIds, "id,person_id,title_current,industry,function_area,capacity_target"),
    readAllPages<Row>(
      "matches",
      "id,mentor_person_id,mentee_person_id,status,matching_round,matched_at,created_at,ended_at,end_reason",
      (columns) => client.from("matches").select(columns).eq("season_id", seasonId)
    ),
    readAllPages<Row>("person_season_memberships", "id,person_id,role,status", (columns) =>
      client.from("person_season_memberships").select(columns).eq("season_id", seasonId).in("role", ["mentor", "mentee"])
    ),
    readAllPages<Row>(
      "matching_industry_assignments",
      "id,person_id,role,group_code,confidence,flags,secondary_groups,evidence,source,drift_group,override_reason,reviewed_at",
      (columns) => client.from("matching_industry_assignments").select(columns).eq("season_id", seasonId)
    )
  ]);
  for (const read of [people, profiles, matches, memberships, assignments]) {
    if (read.error) throw new Error("READ_FAILED");
  }

  const peopleById = new Map(people.data.map((p) => [String(p.id), p]));
  const profilesByPerson = new Map<string, Row[]>();
  for (const p of profiles.data) {
    const id = String(p.person_id ?? "");
    profilesByPerson.set(id, [...(profilesByPerson.get(id) ?? []), p]);
  }
  const inactive = new Set(
    memberships.data.filter((m) => INACTIVE_MEMBERSHIP.has(String(m.status))).map((m) => `${m.role}|${m.person_id}`)
  );

  const persons: Round2Person[] = [];
  for (const [key, list] of Array.from(byPersonRole.entries())) {
    const [role, personId] = key.split("|") as ["mentor" | "mentee", string];
    const app = pickQuickViewApplication(list.map((a: Row) => ({ ...a, id: String(a.id) })));
    if (!app) continue;
    const payload = (applicantPayload(app as unknown as Application) ?? {}) as Record<string, unknown>;
    const person = peopleById.get(personId);
    const base = {
      role,
      personId,
      applicationId: String(app.id),
      name: text(person?.full_name) ?? "(chưa có tên)",
      email: text(person?.email_primary),
      eligible: !inactive.has(key)
    };
    if (role === "mentor") {
      const own = profilesByPerson.get(personId) ?? [];
      const profile = [...own].sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
      const mentorInput = {
        title: text(payload.title_current) ?? text(profile?.title_current),
        functionCode: text(payload.function_primary) ?? text(profile?.function_area),
        industryCode: text(payload.industry_primary) ?? text(profile?.industry),
        functionOther: text(payload.function_primary_other)
      };
      persons.push({
        ...base,
        mentorInput,
        capacityTarget: profile?.capacity_target ?? null,
        profileCount: own.length,
        details: [
          ["Chức danh", mentorInput.title ?? "—"],
          ["Chức năng", optionLabel(MENTOR_FUNCTION_OPTIONS, mentorInput.functionCode) ?? "—"],
          ["Ngành", optionLabel(MENTOR_INDUSTRY_OPTIONS, mentorInput.industryCode) ?? "—"],
          ...(mentorInput.functionOther ? ([["Chức năng khác", mentorInput.functionOther]] as Array<[string, string]>) : [])
        ]
      });
    } else {
      const menteeInput = {
        targetFunction: text(payload.target_function),
        targetFunctionOther: text(payload.target_function_other),
        targetIndustry: text(payload.target_industry),
        targetIndustryOther: text(payload.target_industry_other),
        major: text(payload.major),
        faculty: text(payload.school_or_faculty),
        goals: text(payload.mentoring_goals_text)
      };
      const label = (key: string, value: string | null) => (value ? applicationOptionLabel(key, value) : "—");
      persons.push({
        ...base,
        menteeInput,
        details: [
          ["Chức năng mục tiêu", label("target_function", menteeInput.targetFunction) + (menteeInput.targetFunctionOther ? ` (${menteeInput.targetFunctionOther})` : "")],
          ["Ngành mục tiêu", label("target_industry", menteeInput.targetIndustry) + (menteeInput.targetIndustryOther ? ` (${menteeInput.targetIndustryOther})` : "")],
          ["Ngành học", menteeInput.major ?? "—"],
          ["Khoa", label("school_or_faculty", menteeInput.faculty)],
          ["Năm học", label("year_of_study", text(payload.year_of_study))]
        ]
      });
    }
  }

  const assignmentRows: Round2Assignment[] = assignments.data.map((a) => ({
    id: String(a.id),
    role: a.role === "mentor" ? "mentor" : "mentee",
    personId: String(a.person_id),
    group: Number(a.group_code),
    confidence: a.confidence,
    flags: Array.isArray(a.flags) ? a.flags.map(String) : [],
    source: a.source === "btc" ? "btc" : "auto",
    driftGroup: a.drift_group === null || a.drift_group === undefined ? null : Number(a.drift_group),
    secondary: Array.isArray(a.secondary_groups) ? a.secondary_groups.map(Number) : [],
    reasons: Array.isArray(a.evidence?.reasons) ? a.evidence.reasons.map(String) : [],
    overrideReason: text(a.override_reason),
    reviewedAt: text(a.reviewed_at)
  }));
  const matchRows: Round2Match[] = matches.data.map((m) => ({
    id: String(m.id),
    mentorPersonId: text(m.mentor_person_id),
    menteePersonId: text(m.mentee_person_id),
    status: String(m.status ?? ""),
    round: m.matching_round === null || m.matching_round === undefined ? null : Number(m.matching_round),
    matchedAt: text(m.matched_at),
    createdAt: text(m.created_at),
    endedAt: text(m.ended_at),
    endReason: text(m.end_reason)
  }));

  return buildRound2Board({ people: persons, assignments: assignmentRows, matches: matchRows });
}

export async function round2Operator(seasonId: string) {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canManageMatches(actor.role)) return null;
  const ctx = await getAdminScopeContext();
  return (await canOperateSeason(ctx, seasonId)) ? actor : null;
}

export async function getRound2Data(): Promise<{ ok: true; data: Round2Data } | { ok: false; message: string }> {
  try {
    const { client, seasonId, seasonCode } = await round2SeasonContext();
    const [board, actor] = await Promise.all([loadRound2Board(client, seasonId), round2Operator(seasonId)]);
    return { ok: true, data: { seasonId, seasonCode, board, canManage: Boolean(actor) } };
  } catch (error) {
    console.error("[matching-round2] load failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: "Không đọc được dữ liệu Vòng 2. Thử tải lại trang; nếu vẫn lỗi, báo quản trị viên." };
  }
}

const RPC_MESSAGES: Record<string, string> = {
  ACCESS_DENIED: "Bạn không có quyền vận hành ghép cặp mùa này.",
  NOT_APPROVED: "Có người không còn ở trạng thái đã duyệt — tải lại trang rồi thử lại.",
  INVALID_ROWS: "Dữ liệu phân loại không hợp lệ.",
  INVALID_ROW: "Dữ liệu phân loại không hợp lệ.",
  TOO_MANY_ROWS: "Quá nhiều người trong một lần lưu.",
  NOT_FOUND: "Không tìm thấy người này trong bảng phân nhóm.",
  INVALID_GROUP: "Nhóm phải từ 1 đến 9.",
  REASON_REQUIRED: "Cần ghi lý do.",
  STALE_GROUP: "Nhóm của người này vừa được đổi ở nơi khác — tải lại trang để xem nhóm mới.",
  INDUSTRY_GROUP_LOCKED: "Nhóm đã khoá; chỉ đổi được qua ô “Đổi nhóm”."
};

function rpcMessage(error: { message?: string } | null | undefined): string {
  const raw = String(error?.message ?? "");
  const code = Object.keys(RPC_MESSAGES).find((c) => raw.includes(c));
  return code ? RPC_MESSAGES[code] : "Không lưu được. Thử lại; nếu vẫn lỗi, báo quản trị viên.";
}

/** BTC bấm "Phân loại người mới": người chưa có nhóm được gán; người cũ chỉ ghi drift. */
export async function classifyNewPeople(): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, seasonId } = await round2SeasonContext();
    const actor = await round2Operator(seasonId);
    if (!actor) return { ok: false, message: RPC_MESSAGES.ACCESS_DENIED };
    // Tính lại trên máy chủ từ dữ liệu hiện tại — không tin bất cứ gì gửi lên từ form.
    const board = await loadRound2Board(client, seasonId);
    const rows = assignmentRowsForSave(board);
    if (!rows.length) return { ok: true, message: "Chưa có ai đủ điều kiện để phân loại." };
    const { data, error } = await client.rpc("vam112_save_industry_assignments", {
      p_actor: actor.id,
      p_season: seasonId,
      p_rows: rows,
      p_rule_version: CLASSIFICATION_RULE_VERSION
    });
    if (error) return { ok: false, message: rpcMessage(error) };
    const result = (data ?? {}) as { newMentors?: number; newMentees?: number; drift?: number };
    const parts = [`Đã phân nhóm ${result.newMentors ?? 0} mentor và ${result.newMentees ?? 0} mentee mới.`];
    if (result.drift) parts.push(`${result.drift} người đã có nhóm nhưng dữ liệu hôm nay cho ra nhóm khác — xem mục “Dữ liệu đổi nhóm”.`);
    return { ok: true, message: parts.join(" ") };
  } catch (error) {
    console.error("[matching-round2] classify failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: "Không phân loại được. Thử lại; nếu vẫn lỗi, báo quản trị viên." };
  }
}

/** BTC đặt giờ mở/đóng vòng 2 và đợt gửi thư hiện hành (vam113_set_round2_window). */
export async function setRound2Window(input: { opensAt: string; closesAt: string | null; wave: number }): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, seasonId } = await round2SeasonContext();
    const actor = await round2Operator(seasonId);
    if (!actor) return { ok: false, message: RPC_MESSAGES.ACCESS_DENIED };
    const { error } = await client.rpc("vam113_set_round2_window", {
      p_actor: actor.id,
      p_season: seasonId,
      p_opens_at: input.opensAt,
      p_closes_at: input.closesAt,
      p_send_wave: input.wave
    });
    if (error) {
      const raw = String(error.message ?? "");
      if (raw.includes("WINDOW_ORDER")) return { ok: false, message: "Giờ đóng phải sau giờ mở." };
      return { ok: false, message: rpcMessage(error) };
    }
    return { ok: true, message: "Đã lưu giờ mở/đóng và đợt gửi." };
  } catch (error) {
    console.error("[matching-round2] set window failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: "Không lưu được. Thử lại; nếu vẫn lỗi, báo quản trị viên." };
  }
}

/** BTC đổi hoặc xác nhận nhóm của một người. Chỉ chạm đúng nhóm và lý do. */
export async function setIndustryGroup(input: {
  assignmentId: string;
  expectedGroup: number;
  newGroup: number;
  reason: string;
}): Promise<{ ok: boolean; message: string }> {
  try {
    const { client, seasonId } = await round2SeasonContext();
    const actor = await round2Operator(seasonId);
    if (!actor) return { ok: false, message: RPC_MESSAGES.ACCESS_DENIED };
    const { error } = await client.rpc("vam112_set_industry_group", {
      p_actor: actor.id,
      p_assignment: input.assignmentId,
      p_expected_group: input.expectedGroup,
      p_new_group: input.newGroup,
      p_reason: input.reason
    });
    if (error) return { ok: false, message: rpcMessage(error) };
    return {
      ok: true,
      message: input.newGroup === input.expectedGroup ? "Đã xác nhận nhóm." : `Đã đổi sang nhóm ${input.newGroup}.`
    };
  } catch (error) {
    console.error("[matching-round2] set group failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false, message: "Không lưu được. Thử lại; nếu vẫn lỗi, báo quản trị viên." };
  }
}
