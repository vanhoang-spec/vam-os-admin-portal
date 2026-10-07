/**
 * Ghép cặp Vòng 2 — số chỗ, danh sách hiển thị theo nhóm, bất thường, đối soát (BTC 07/10/2026).
 *
 * Phần thuần, không I/O. Trang Phân nhóm, trang Báo cáo, file CSV và (PR sau) trang
 * chọn của mentor đều đọc qua đây, để "mentee nào đang hiện", "mentor còn mấy chỗ" chỉ
 * có một câu trả lời.
 *
 * Luật BTC:
 *   - Số chỗ còn = min(2, sức nhận đăng ký) − số cặp đang hoạt động (tính cả vòng 1).
 *   - Mentee đang có cặp hoạt động (vòng nào cũng vậy) thì ẩn; cặp bị huỷ thì mentee hiện
 *     lại, kèm cảnh báo.
 *   - Mọi mentor còn chỗ đều nhận danh sách nhóm mình, kể cả người đã phỏng vấn.
 */
import {
  classifyMentee,
  classifyMentor,
  type Classification,
  type Confidence,
  type MenteeInput,
  type MentorInput
} from "@/lib/matching-round2-classify-core";
import { INDUSTRY_GROUPS, industryGroupLabel } from "@/lib/matching-round2-groups-core";
import { effectiveMentorCapacity } from "@/lib/mentor-capacity";

export const ROUND2_MENTOR_CAP = 2;

export type Role = "mentor" | "mentee";

export type Round2Person = {
  role: Role;
  personId: string;
  applicationId: string;
  name: string;
  email: string | null;
  /** Tư cách mùa không ở trạng thái rút / không tham gia. */
  eligible: boolean;
  mentorInput?: MentorInput;
  menteeInput?: MenteeInput;
  /** Mentor: `mentor_profiles.capacity_target` và số hồ sơ mentor của người này. */
  capacityTarget?: number | null;
  profileCount?: number;
  /** Vài dòng mô tả cho BTC đọc (chức danh, ngành học…). */
  details: Array<[label: string, value: string]>;
};

export type Round2Assignment = {
  id: string;
  role: Role;
  personId: string;
  group: number;
  confidence: Confidence;
  flags: string[];
  source: "auto" | "btc";
  driftGroup: number | null;
  secondary: number[];
  reasons: string[];
  overrideReason: string | null;
  reviewedAt: string | null;
};

export type Round2Match = {
  id: string;
  mentorPersonId: string | null;
  menteePersonId: string | null;
  status: string;
  round: number | null;
  matchedAt: string | null;
  createdAt: string | null;
  endedAt: string | null;
  endReason: string | null;
};

export type MenteeState = "visible" | "matched" | "ineligible";

export type Round2Row = {
  person: Round2Person;
  assignment: Round2Assignment | null;
  /** Kết quả luật hiện hành trên dữ liệu hôm nay (người chưa có nhóm: đây là đề xuất). */
  proposal: Classification;
  /** Nhóm đang dùng: nhóm đã lưu, hoặc null nếu chưa phân nhóm. */
  group: number | null;
  activeMatches: Round2Match[];
  partnerNames: string[];
  // Mentor
  capacity?: number;
  round2Cap?: number;
  slots?: number;
  receivesList?: boolean;
  // Mentee
  menteeState?: MenteeState;
  matchedRound?: number | null;
};

export type GroupSummary = {
  code: number | null;
  label: string;
  mentors: number;
  mentorsWithSlots: number;
  slots: number;
  mentees: number;
  matchedR1: number;
  matchedR2: number;
  matchedOther: number;
  visible: number;
  /** mentees = R1 + R2 + khác + đang hiện. */
  reconciled: boolean;
};

export type Round2Anomaly = {
  kind:
    | "mentor_over_limit"
    | "cross_group"
    | "reappeared"
    | "drift"
    | "unclassified"
    | "mentor_profile_ambiguous"
    | "mentee_multi_active";
  severity: "warning" | "info";
  message: string;
  personIds: string[];
};

export type Round2Board = {
  rows: Round2Row[];
  groups: GroupSummary[];
  unclassified: GroupSummary;
  /** Người đủ điều kiện mà chưa có nhóm: đầu vào của nút "Phân loại người mới". */
  pending: Round2Row[];
  round2Matches: Array<{ match: Round2Match; mentor: Round2Row | null; mentee: Round2Row | null }>;
  anomalies: Round2Anomaly[];
};

/** Số chỗ còn ở Vòng 2 của một mentor. */
export function round2Slots(capacityTarget: unknown, activeCount: number): number {
  const cap = Math.min(ROUND2_MENTOR_CAP, effectiveMentorCapacity(capacityTarget));
  return Math.max(0, cap - activeCount);
}

export function proposeClassification(person: Round2Person): Classification {
  return person.role === "mentor"
    ? classifyMentor(person.mentorInput ?? { title: null, functionCode: null, industryCode: null, functionOther: null })
    : classifyMentee(
        person.menteeInput ?? {
          targetFunction: null,
          targetFunctionOther: null,
          targetIndustry: null,
          targetIndustryOther: null,
          major: null,
          faculty: null,
          goals: null
        }
      );
}

function byName(a: Round2Row, b: Round2Row): number {
  const name = a.person.name.localeCompare(b.person.name, "vi");
  if (name !== 0) return name;
  return a.person.personId < b.person.personId ? -1 : a.person.personId > b.person.personId ? 1 : 0;
}

export function buildRound2Board(input: {
  people: Round2Person[];
  assignments: Round2Assignment[];
  matches: Round2Match[];
}): Round2Board {
  const assignmentKey = (role: Role, personId: string) => `${role}|${personId}`;
  const assignments = new Map(input.assignments.map((a) => [assignmentKey(a.role, a.personId), a]));
  const namesByPerson = new Map<string, string>();
  for (const p of input.people) namesByPerson.set(p.personId, p.name);
  const active = input.matches.filter((m) => m.status === "active");

  const rows: Round2Row[] = [...input.people]
    .sort((a, b) => (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0))
    .map((person) => {
      const assignment = assignments.get(assignmentKey(person.role, person.personId)) ?? null;
      const own = active.filter((m) =>
        person.role === "mentor" ? m.mentorPersonId === person.personId : m.menteePersonId === person.personId
      );
      const partnerNames = own.map((m) => {
        const partner = person.role === "mentor" ? m.menteePersonId : m.mentorPersonId;
        return (partner && namesByPerson.get(partner)) || "(không rõ tên)";
      });
      const row: Round2Row = {
        person,
        assignment,
        proposal: proposeClassification(person),
        group: assignment?.group ?? null,
        activeMatches: own,
        partnerNames
      };
      if (person.role === "mentor") {
        row.capacity = effectiveMentorCapacity(person.capacityTarget);
        row.round2Cap = Math.min(ROUND2_MENTOR_CAP, row.capacity);
        row.slots = round2Slots(person.capacityTarget, own.length);
        row.receivesList = person.eligible && row.group !== null && row.slots > 0 && person.profileCount === 1;
      } else {
        row.menteeState = own.length > 0 ? "matched" : person.eligible ? "visible" : "ineligible";
        row.matchedRound = own.length ? own[0].round : null;
      }
      return row;
    });

  const summarize = (code: number | null, label: string, groupRows: Round2Row[]): GroupSummary => {
    const mentors = groupRows.filter((r) => r.person.role === "mentor" && r.person.eligible);
    const withSlots = mentors.filter((r) => r.receivesList);
    const mentees = groupRows.filter((r) => r.person.role === "mentee" && r.menteeState !== "ineligible");
    const matchedR1 = mentees.filter((r) => r.menteeState === "matched" && r.matchedRound === 1).length;
    const matchedR2 = mentees.filter((r) => r.menteeState === "matched" && r.matchedRound === 2).length;
    const matchedOther = mentees.filter((r) => r.menteeState === "matched" && r.matchedRound !== 1 && r.matchedRound !== 2).length;
    // Chỉ mentee ĐÃ có nhóm mới hiện cho mentor; dòng "Chưa phân nhóm" luôn 0 người hiện.
    const visible = code === null ? 0 : mentees.filter((r) => r.menteeState === "visible").length;
    const waiting = code === null ? mentees.filter((r) => r.menteeState === "visible").length : 0;
    return {
      code,
      label,
      mentors: mentors.length,
      mentorsWithSlots: withSlots.length,
      slots: withSlots.reduce((sum, r) => sum + (r.slots ?? 0), 0),
      mentees: mentees.length,
      matchedR1,
      matchedR2,
      matchedOther,
      visible,
      reconciled: mentees.length === matchedR1 + matchedR2 + matchedOther + visible + waiting
    };
  };

  const groups = INDUSTRY_GROUPS.map((g) => summarize(g.code, industryGroupLabel(g.code), rows.filter((r) => r.group === g.code)));
  const unclassified = summarize(null, "Chưa phân nhóm", rows.filter((r) => r.group === null));
  const pending = rows.filter((r) => r.group === null && r.person.eligible);

  const rowsByPerson = (role: Role) => new Map(rows.filter((r) => r.person.role === role).map((r) => [r.person.personId, r]));
  const mentorRows = rowsByPerson("mentor");
  const menteeRows = rowsByPerson("mentee");

  const round2Matches = active
    .filter((m) => m.round === 2)
    .map((match) => ({
      match,
      mentor: (match.mentorPersonId && mentorRows.get(match.mentorPersonId)) || null,
      mentee: (match.menteePersonId && menteeRows.get(match.menteePersonId)) || null
    }))
    .sort((a, b) => String(a.match.createdAt ?? "").localeCompare(String(b.match.createdAt ?? "")));

  const anomalies: Round2Anomaly[] = [];
  for (const row of [...rows].sort(byName)) {
    const p = row.person;
    if (p.role === "mentor") {
      const count = row.activeMatches.length;
      if (count > ROUND2_MENTOR_CAP || count > (row.capacity ?? Infinity)) {
        anomalies.push({
          kind: "mentor_over_limit",
          severity: "warning",
          message: `${p.name}: đang có ${count} mentee, vượt trần (đăng ký ${row.capacity}, tối đa ${ROUND2_MENTOR_CAP} ở vòng 2).`,
          personIds: [p.personId]
        });
      }
      if (p.eligible && p.profileCount !== 1) {
        anomalies.push({
          kind: "mentor_profile_ambiguous",
          severity: "warning",
          message: `${p.name}: có ${p.profileCount ?? 0} hồ sơ mentor — hệ thống không ghép cặp được cho tới khi gộp còn một hồ sơ.`,
          personIds: [p.personId]
        });
      }
    } else if (row.activeMatches.length > 1) {
      anomalies.push({
        kind: "mentee_multi_active",
        severity: "warning",
        message: `${p.name}: đang có ${row.activeMatches.length} mentor cùng lúc (${row.partnerNames.join(", ")}).`,
        personIds: [p.personId]
      });
    }
    if (row.assignment?.driftGroup) {
      anomalies.push({
        kind: "drift",
        severity: "info",
        message: `${p.name}: nhóm đã khoá là ${industryGroupLabel(row.assignment.group)}, dữ liệu hôm nay cho ra ${industryGroupLabel(row.assignment.driftGroup)}. Nhóm giữ nguyên; BTC đổi nếu cần.`,
        personIds: [p.personId]
      });
    }
    if (row.group === null && p.eligible) {
      anomalies.push({
        kind: "unclassified",
        severity: "info",
        message: `${p.name} (${p.role === "mentor" ? "mentor" : "mentee"}): chưa phân nhóm — chưa có trong danh sách vòng 2.`,
        personIds: [p.personId]
      });
    }
  }

  for (const m of active) {
    const mentor = m.mentorPersonId ? mentorRows.get(m.mentorPersonId) : undefined;
    const mentee = m.menteePersonId ? menteeRows.get(m.menteePersonId) : undefined;
    if (!mentor?.group || !mentee?.group || mentor.group === mentee.group) continue;
    anomalies.push({
      kind: "cross_group",
      severity: m.round === 2 ? "warning" : "info",
      message: `${mentor.person.name} (${industryGroupLabel(mentor.group)}) — ${mentee.person.name} (${industryGroupLabel(mentee.group)}): khác nhóm${m.round === 1 ? " (cặp vòng 1, chọn tại buổi phỏng vấn)" : ""}.`,
      personIds: [mentor.person.personId, mentee.person.personId]
    });
  }

  // Mentee hiện lại vì cặp cũ đã bị huỷ: BTC cần biết để không giới thiệu nhầm.
  const dropped = input.matches.filter((m) => m.status === "dropped");
  for (const row of rows) {
    if (row.person.role !== "mentee" || row.menteeState !== "visible") continue;
    const old = dropped.filter((m) => m.menteePersonId === row.person.personId);
    if (!old.length) continue;
    const last = [...old].sort((a, b) => String(b.endedAt ?? b.createdAt ?? "").localeCompare(String(a.endedAt ?? a.createdAt ?? "")))[0];
    const mentorName = (last.mentorPersonId && namesByPerson.get(last.mentorPersonId)) || "(không rõ)";
    anomalies.push({
      kind: "reappeared",
      severity: "warning",
      message: `${row.person.name}: đang hiện lại trong danh sách vì cặp với ${mentorName} đã huỷ${last.endReason ? ` (${last.endReason})` : ""}.`,
      personIds: [row.person.personId]
    });
  }

  return { rows, groups, unclassified, pending, round2Matches, anomalies };
}

/** Dòng gửi cho vam112_save_industry_assignments: mọi người đủ điều kiện, mentor trước. */
export function assignmentRowsForSave(board: Round2Board) {
  return board.rows
    .filter((r) => r.person.eligible)
    .sort((a, b) => (a.person.role === b.person.role ? 0 : a.person.role === "mentor" ? -1 : 1))
    .map((r) => ({
      role: r.person.role,
      personId: r.person.personId,
      applicationId: r.person.applicationId,
      group: r.proposal.group,
      confidence: r.proposal.confidence,
      flags: r.proposal.flags,
      secondary: r.proposal.secondary,
      evidence: { reasons: r.proposal.reasons }
    }));
}
