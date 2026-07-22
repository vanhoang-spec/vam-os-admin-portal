import { currentMonthVN, isOperationalMonth, OPERATIONAL_MONTH_START, operationalMonthRange } from "@/lib/dashboard-month";
import { SEASON_CONFIG } from "@/lib/season-config";
import type { Event, EventParticipation, Match, MentoringRecap, Season } from "@/lib/types";

export type ProgramOperationsKpis = {
  selectedMonth: string;
  recapCount: number;
  activeMenteeCount: number;
  activeMentorCount: number;
  mentorWithoutRecapCount: number;
  eventTrainingCount: number;
  eventAttendanceCount: number;
  followUpCount: number;
};

const VALID_RECAP_STATUSES = new Set(["", "submitted", "needs_review"]);
const normalizeStatus = (value: unknown) => String(value ?? "").trim().toLowerCase();
const isValidRecap = (recap: MentoringRecap) => VALID_RECAP_STATUSES.has(normalizeStatus(recap.status));

function monthFromDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 7);
}

function addMonths(month: string, delta: number) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

/** Count-only program aggregate. Role and reviewer assignment are deliberately absent. */
export function computeProgramOperationsKpis(input: {
  seasons: Season[];
  matches: Match[];
  recaps: MentoringRecap[];
  events: Event[];
  eventParticipations: EventParticipation[];
  seasonCode?: string;
  selectedMonth?: string;
}): ProgramOperationsKpis {
  const nowMonth = currentMonthVN();
  const season = input.seasons.find((row) => row.code === (input.seasonCode ?? SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE));
  if (!season) {
    return {
      selectedMonth: input.selectedMonth ?? OPERATIONAL_MONTH_START,
      recapCount: 0,
      activeMenteeCount: 0,
      activeMentorCount: 0,
      mentorWithoutRecapCount: 0,
      eventTrainingCount: 0,
      eventAttendanceCount: 0,
      followUpCount: 0
    };
  }
  const seasonRecaps = input.recaps.filter((row) => !season?.id || row.season_id === season.id);
  const seasonEvents = input.events.filter((row) => !season?.id || row.season_id === season.id);
  const seasonEventIds = new Set(seasonEvents.map((row) => row.id));
  const seasonParticipations = input.eventParticipations.filter(
    (row) => !season?.id || row.season_id === season.id || (row.event_id ? seasonEventIds.has(row.event_id) : false)
  );
  const validRecaps = seasonRecaps.filter(isValidRecap);
  const seasonMonths = operationalMonthRange(nowMonth);
  const monthsWithData = new Set([
    ...validRecaps.filter((row) => isOperationalMonth(row.meeting_month, nowMonth)).map((row) => row.meeting_month).filter((month): month is string => Boolean(month)),
    ...seasonEvents.map((row) => monthFromDate(row.starts_at)).filter((month): month is string => isOperationalMonth(month, nowMonth))
  ]);
  const availableMonths = seasonMonths.filter((month) => monthsWithData.has(month)).sort((a, b) => b.localeCompare(a));
  const selectedMonth = input.selectedMonth ?? availableMonths.find((month) => month <= nowMonth) ?? (isOperationalMonth(nowMonth, nowMonth) ? nowMonth : null) ?? availableMonths[0] ?? OPERATIONAL_MONTH_START;
  const previousMonth = addMonths(selectedMonth, -1);
  const activeMatches = input.matches.filter((row) => normalizeStatus(row.status) === "active" && (!season?.id || row.season_id === season.id) && row.mentor_person_id && row.mentee_person_id);
  const activeMenteeIds = new Set(activeMatches.map((row) => row.mentee_person_id).filter(Boolean));
  const activeMentorIds = new Set(activeMatches.map((row) => row.mentor_person_id).filter(Boolean));
  const selectedRecaps = validRecaps.filter((row) => row.meeting_month === selectedMonth);
  const previousRecaps = validRecaps.filter((row) => row.meeting_month === previousMonth);
  const selectedMenteeIds = new Set(selectedRecaps.map((row) => row.mentee_person_id).filter(Boolean));
  const selectedMentorIds = new Set(selectedRecaps.map((row) => row.mentor_person_id).filter(Boolean));
  const previousMenteeIds = new Set(previousRecaps.map((row) => row.mentee_person_id).filter(Boolean));
  const eventsInMonth = seasonEvents.filter((row) => monthFromDate(row.starts_at) === selectedMonth);
  const eventIdsInMonth = new Set(eventsInMonth.map((row) => row.id));
  const participationsInMonth = seasonParticipations.filter((row) => row.event_id && eventIdsInMonth.has(row.event_id));

  return {
    selectedMonth,
    recapCount: selectedRecaps.length,
    activeMenteeCount: selectedMenteeIds.size,
    activeMentorCount: selectedMentorIds.size,
    mentorWithoutRecapCount: Array.from(activeMentorIds).filter((id) => !selectedMentorIds.has(id)).length,
    eventTrainingCount: eventsInMonth.length,
    eventAttendanceCount: participationsInMonth.filter((row) => normalizeStatus(row.attendance_status) === "attended").length,
    followUpCount: Array.from(activeMenteeIds).filter((id) => !selectedMenteeIds.has(id) && !previousMenteeIds.has(id)).length
  };
}
