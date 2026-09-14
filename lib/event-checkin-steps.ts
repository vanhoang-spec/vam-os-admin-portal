/**
 * lib/event-checkin-steps.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Các lần quét mã QR của một sự kiện: Quét lần 1, Quét lần 2… mỗi lần một mục.
 *
 * Module thuần, không I/O — form sự kiện và máy quét (trình duyệt) cùng phần ghi
 * lượt quét (máy chủ) đọc chung một định nghĩa.
 *
 * ---------------------------------------------------------------------------
 * NGƯỜI THAM DỰ VẪN CHỈ CÓ MỘT MÃ QR
 * ---------------------------------------------------------------------------
 * Mỗi lần quét là một điểm quét tại sự kiện, không phải một mã riêng. BTC chọn
 * sự kiện này quét mấy lần và mỗi lần để làm gì; máy quét của người hỗ trợ chỉ
 * hiện đúng danh sách đó. Có sự kiện chỉ cần Check out, có sự kiện cần Check in,
 * hai talkshow, quầy đổi quà rồi Check out.
 *
 * ---------------------------------------------------------------------------
 * KHOÁ CỦA MỘT LƯỢT QUÉT (`event_scans.station`)
 * ---------------------------------------------------------------------------
 * Khoá theo MỤC và lần xuất hiện của mục đó — `entrance`, `talkshow`,
 * `talkshow_2` — không theo số thứ tự lần quét.
 *
 * Khoá theo số thứ tự (`step3`) thì chèn thêm một lần quét vào giữa là đẩy số của
 * mọi lần phía sau: lượt Check out đã quét nằm ở "lần 3" trong khi Check out giờ
 * là lần 4, người đã Check out quét lại được như chưa từng quét, và số đếm tách
 * làm hai.
 *
 * `entrance` giữ đúng tên trạm cửa vào của máy quét cũ: lượt quét cửa vào đã có
 * trên production vẫn là Check in, và quét lại người đó vẫn được nhận là quét lại.
 */

/** Chủ dự án chốt 14/09/2026: tối đa 20 lần quét cho một sự kiện. */
export const MAX_CHECKIN_STEPS = 20;

/**
 * Mã của khung "Thiết lập các lần quét" trên trang máy quét, để link trên máy quét
 * trỏ tới. Đặt ở module thuần chứ không ở file component: trang máy chủ nhập một
 * hằng số từ file "use client" thì nhận về một tham chiếu client, không phải chuỗi.
 */
export const CHECKIN_STEPS_PANEL_ID = "thiet-lap-lan-quet";

/** Các mục một lần quét được chọn, đúng thứ tự và cách gọi của team vận hành. */
export const CHECKIN_PURPOSES = [
  { value: "entrance", label: "Check in" },
  { value: "gift_counter", label: "Check quầy đổi quà" },
  { value: "experience_counter", label: "Check quầy trải nghiệm" },
  { value: "talkshow", label: "Check talkshow" },
  { value: "seminar", label: "Check seminar" },
  { value: "checkout", label: "Check out" }
] as const;

export type CheckinPurpose = (typeof CHECKIN_PURPOSES)[number]["value"];

/** Check in. Cũng là giá trị mặc định của cột `event_scans.station`. */
export const ENTRANCE_STATION: CheckinPurpose = "entrance";

/** Sự kiện chưa ai thiết lập: một lần quét, Check in — đúng như mọi sự kiện trước đây. */
export const DEFAULT_CHECKIN_STEPS: readonly CheckinPurpose[] = [ENTRANCE_STATION];

const PURPOSE_VALUES: readonly string[] = CHECKIN_PURPOSES.map((purpose) => purpose.value);

export function isCheckinPurpose(value: unknown): value is CheckinPurpose {
  return typeof value === "string" && PURPOSE_VALUES.includes(value);
}

export function purposeLabel(value: unknown): string {
  return CHECKIN_PURPOSES.find((purpose) => purpose.value === value)?.label ?? String(value ?? "");
}

/**
 * Các lần quét của một sự kiện, đọc từ dòng dữ liệu.
 *
 * Vắng cột, rỗng hay không đọc được thì là MẶC ĐỊNH (một lần Check in), không
 * phải "không có lần quét nào": một máy quét không có lựa chọn nào là một máy
 * quét chặn cửa vào. Giá trị lạ bị bỏ, phần còn lại giữ nguyên thứ tự.
 */
export function checkinStepsOf(event: { checkin_steps?: unknown } | null | undefined): CheckinPurpose[] {
  const raw = event?.checkin_steps;
  const valid = Array.isArray(raw) ? raw.filter(isCheckinPurpose).slice(0, MAX_CHECKIN_STEPS) : [];
  return valid.length ? valid : DEFAULT_CHECKIN_STEPS.slice();
}

export type CheckinStep = {
  /** Quét lần mấy, đếm từ 1. */
  number: number;
  purpose: CheckinPurpose;
  /** Khoá ghi vào `event_scans.station`. */
  station: string;
  /** "Quét lần 2 · Check talkshow" */
  label: string;
};

export function stationFor(purpose: CheckinPurpose, occurrence: number): string {
  return occurrence <= 1 ? purpose : `${purpose}_${occurrence}`;
}

export function buildCheckinSteps(purposes: readonly CheckinPurpose[]): CheckinStep[] {
  const seen = new Map<string, number>();
  return purposes.map((purpose, index) => {
    const occurrence = (seen.get(purpose) ?? 0) + 1;
    seen.set(purpose, occurrence);
    return {
      number: index + 1,
      purpose,
      station: stationFor(purpose, occurrence),
      label: `Quét lần ${index + 1} · ${purposeLabel(purpose)}`
    };
  });
}

const STATION_PATTERN = new RegExp(`^(${PURPOSE_VALUES.join("|")})(?:_([0-9]{1,2}))?$`);

/** Khoá trạm thành mục và lần xuất hiện; khoá không do `stationFor` sinh ra thì null. */
export function parseStation(station: unknown): { purpose: CheckinPurpose; occurrence: number } | null {
  const match = STATION_PATTERN.exec(String(station ?? "").trim());
  if (!match) return null;
  if (match[2] === undefined) return { purpose: match[1] as CheckinPurpose, occurrence: 1 };

  // `_1` và `_02` không bao giờ được sinh ra: lần đầu mang tên trần, số không có
  // số 0 đứng trước. Nhận chúng là cho một trạm hai cách viết — và hai cách viết
  // thì bị đếm thành hai trạm, người đã quét quét lại được lần nữa.
  const occurrence = Number(match[2]);
  if (match[2].startsWith("0") || occurrence < 2 || occurrence > MAX_CHECKIN_STEPS) return null;
  return { purpose: match[1] as CheckinPurpose, occurrence };
}

/** Trạm của máy quét cũ, trước khi có các lần quét. Chỉ còn để đọc lịch sử quét. */
const LEGACY_STATION_LABELS: Record<string, string> = {
  booth_program: "Booth chương trình",
  booth_partner: "Booth đối tác",
  workshop: "Khu trải nghiệm"
};

/**
 * Nhãn của một trạm.
 *
 * Có danh sách lần quét của sự kiện thì nói "Quét lần 2 · Check talkshow" — đúng
 * chữ trên máy quét. Không có (trang vé công khai), hoặc trạm không còn trong
 * thiết lập, thì chỉ nói mục: "Check talkshow 2".
 */
export function stationLabel(station: unknown, steps?: readonly CheckinStep[]): string {
  const raw = String(station ?? "").trim();
  if (!raw) return "—";

  const step = steps?.find((candidate) => candidate.station === raw);
  if (step) return step.label;

  const parsed = parseStation(raw);
  if (parsed) {
    const label = purposeLabel(parsed.purpose);
    return parsed.occurrence > 1 ? `${label} ${parsed.occurrence}` : label;
  }

  return Object.prototype.hasOwnProperty.call(LEGACY_STATION_LABELS, raw) ? LEGACY_STATION_LABELS[raw] : raw;
}

export type ScanBadge = { station: string; label: string; scannedAt: string };

/**
 * Huy hiệu của một người: mỗi trạm đã quét là một huy hiệu.
 *
 * Trùng trạm chỉ tính một lần, giữ lần quét ĐẦU tiên — lần thứ hai thường là
 * quét lại vì máy không đọc được, và mốc thời gian có ý nghĩa là lúc người đó
 * thật sự tới trạm.
 */
export function collectBadges(
  scans: Array<{ station: string; scannedAt: string }>,
  steps?: readonly CheckinStep[]
): ScanBadge[] {
  const earliest = new Map<string, string>();

  for (const scan of scans) {
    const station = String(scan.station ?? "").trim();
    if (!station) continue;
    const current = earliest.get(station);
    if (!current || scan.scannedAt < current) earliest.set(station, scan.scannedAt);
  }

  return Array.from(earliest.entries())
    .map(([station, scannedAt]) => ({ station, label: stationLabel(station, steps), scannedAt }))
    .sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
}

export type StepCount = { station: string; label: string; total: number; configured: boolean };

/**
 * Số lượt quét theo từng lần quét, cho trang sự kiện và máy quét.
 *
 * Mọi lần quét đang thiết lập đều hiện, kể cả khi chưa ai được quét: "Quét lần 2
 * · Check out: 0" là thông tin (chưa ai về). Một lần quét biến mất khỏi bảng thì
 * người đọc không biết là chưa có ai, hay là chưa được thiết lập.
 *
 * Lượt quét ở trạm không còn trong thiết lập — sửa thiết lập giữa chừng, hay trạm
 * của máy quét cũ — vẫn hiện, xếp sau: đó là những lượt đã xảy ra thật.
 */
export function summarizeStepCounts(
  steps: readonly CheckinStep[],
  counts: ReadonlyArray<{ station: string; total: number }>
): StepCount[] {
  const totals = new Map<string, number>();
  for (const row of counts) {
    const station = String(row.station ?? "").trim();
    if (!station) continue;
    totals.set(station, (totals.get(station) ?? 0) + (Number(row.total) || 0));
  }

  const configured: StepCount[] = steps.map((step) => ({
    station: step.station,
    label: step.label,
    total: totals.get(step.station) ?? 0,
    configured: true
  }));

  const known = new Set(steps.map((step) => step.station));
  const others: StepCount[] = [];
  totals.forEach((total, station) => {
    if (!known.has(station)) others.push({ station, label: stationLabel(station), total, configured: false });
  });
  others.sort((a, b) => b.total - a.total || a.station.localeCompare(b.station));

  return configured.concat(others);
}

export type StepsInput = { ok: true; steps: CheckinPurpose[] } | { ok: false; message: string };

/**
 * Kiểm danh sách lần quét gửi lên từ form.
 *
 * Form chỉ cho chọn trong danh sách, nhưng thứ đến từ form là thứ người gửi tự
 * đặt được. Một ô sai thì từ chối CẢ danh sách, không lặng lẽ bỏ ô đó: bỏ một ô
 * là dịch số thứ tự của mọi lần quét phía sau.
 */
export function parseCheckinStepsInput(values: unknown): StepsInput {
  const list: unknown[] = Array.isArray(values) ? values : values == null || values === "" ? [] : [values];

  if (!list.length) return { ok: false, message: "Cần ít nhất một lần quét mã QR." };
  if (list.length > MAX_CHECKIN_STEPS) {
    return { ok: false, message: `Tối đa ${MAX_CHECKIN_STEPS} lần quét mã QR cho một sự kiện.` };
  }

  const steps: CheckinPurpose[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const value = String(list[index] ?? "").trim();
    if (!isCheckinPurpose(value)) {
      return { ok: false, message: `Quét lần ${index + 1} chưa chọn mục hợp lệ.` };
    }
    steps.push(value);
  }
  return { ok: true, steps };
}

/**
 * Có nên nhắc "người này chưa được quét Check in" không.
 *
 * Chỉ nhắc, không chặn — chủ dự án chốt 14/09/2026: người vào cửa phụ hay bị quét
 * sót ở cửa vẫn phải nhận được quà, vẫn Check out được. Màn hình hiện màu vàng để
 * người đứng quét tự quyết.
 *
 * Sự kiện không có lần Check in nào (ví dụ chỉ có Check out) thì không có gì để
 * nhắc.
 */
export function needsCheckInReminder(
  steps: readonly CheckinStep[],
  station: string,
  scannedStations: readonly string[]
): boolean {
  if (!steps.some((step) => step.purpose === ENTRANCE_STATION)) return false;
  if (parseStation(station)?.purpose === ENTRANCE_STATION) return false;
  return !scannedStations.some((scanned) => parseStation(scanned)?.purpose === ENTRANCE_STATION);
}
