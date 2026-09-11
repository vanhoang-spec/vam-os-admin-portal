import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/participant-home.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Người này tham gia những gì.
 *
 * Câu hỏi "tài khoản đăng nhập này là ai" đã do `lib/participant-auth.ts` trả
 * lời. File này trả lời câu tiếp theo, và nó đọc từ `person_season_memberships`
 * — nơi đã có sẵn chương trình, mùa, vai trò và trạng thái — chứ không giữ một
 * bản chép thứ hai.
 */

const VI_ERROR = "Không đọc được thông tin tham gia lúc này.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[participant-home]", scope, {
    code: err?.code,
    message: err?.message ?? String(error)
  });
}

/**
 * Những trạng thái được coi là "có tham gia".
 *
 * `completed` nằm trong danh sách, và đó là một quyết định có cân nhắc. Số đo
 * production ngày 10/09/2026: mùa S11 có 652 mentee và 438 mentor mang trạng
 * thái này. Lọc họ ra nghĩa là 1.090 người đăng nhập thành công rồi mở ra thấy
 * trang trắng — gấp năm lần số người thấy được nội dung.
 *
 * Đăng nhập được mà chẳng thấy gì còn tệ hơn là chưa cho đăng nhập.
 *
 * `withdrawn` và `opted_out` KHÔNG nằm trong danh sách: người đã rút khỏi
 * chương trình không có gì để xem lại, và hiện dữ liệu mùa cho họ là nói rằng
 * họ vẫn đang tham gia.
 */
export const VISIBLE_MEMBERSHIP_STATUSES = ["active", "completed"] as const;

export type ParticipantMembership = {
  programId: string;
  programCode: string | null;
  programName: string | null;
  seasonId: string;
  seasonCode: string | null;
  seasonName: string | null;
  role: string;
  status: string;
  /** `completed` = mùa đã xong, màn hình chỉ đọc. */
  isPast: boolean;
};

export type ParticipantHome = {
  memberships: ParticipantMembership[];
  error: string | null;
};

/**
 * Mọi mùa mà người này tham gia, mùa đang chạy đứng trước.
 *
 * Trả về mảng rỗng KHÔNG phải lỗi: người có trong danh bạ nhưng chưa được xếp
 * vào mùa nào là chuyện bình thường trong lúc đợt tuyển đang chạy. Màn hình nói
 * điều đó bằng lời, chứ không hiện một trang trắng.
 */
export async function getParticipantHome(personId: string): Promise<ParticipantHome> {
  const id = String(personId ?? "").trim();
  if (!id) return { memberships: [], error: null };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { memberships: [], error: VI_ERROR };

  const { data, error } = await client
    .from("person_season_memberships")
    .select("program_id, season_id, role, status")
    .eq("person_id", id)
    .in("status", [...VISIBLE_MEMBERSHIP_STATUSES]);

  if (error) {
    log("đọc danh sách tham gia", error);
    return { memberships: [], error: VI_ERROR };
  }

  const rows = (data ?? []) as Array<{
    program_id: string;
    season_id: string;
    role: string;
    status: string;
  }>;
  if (!rows.length) return { memberships: [], error: null };

  // Một truy vấn cho mỗi bảng tra cứu, không phải một truy vấn mỗi dòng.
  const [programs, seasons] = await Promise.all([
    client
      .from("programs")
      .select("id, code, name")
      .in("id", Array.from(new Set(rows.map((row) => row.program_id)))),
    client
      .from("seasons")
      .select("id, code, name")
      .in("id", Array.from(new Set(rows.map((row) => row.season_id))))
  ]);

  if (programs.error || seasons.error) {
    log("đọc chương trình / mùa", programs.error ?? seasons.error);
    return { memberships: [], error: VI_ERROR };
  }

  const programById = new Map(
    ((programs.data ?? []) as Array<{ id: string; code: string | null; name: string | null }>).map(
      (row) => [String(row.id), row]
    )
  );
  const seasonById = new Map(
    ((seasons.data ?? []) as Array<{ id: string; code: string | null; name: string | null }>).map(
      (row) => [String(row.id), row]
    )
  );

  const memberships = rows.map((row) => {
    const program = programById.get(String(row.program_id));
    const season = seasonById.get(String(row.season_id));
    return {
      programId: String(row.program_id),
      programCode: program?.code ?? null,
      programName: program?.name ?? null,
      seasonId: String(row.season_id),
      seasonCode: season?.code ?? null,
      seasonName: season?.name ?? null,
      role: String(row.role),
      status: String(row.status),
      isPast: row.status === "completed"
    };
  });

  return { memberships: sortMemberships(memberships), error: null };
}

/**
 * Mùa đang chạy đứng trước, rồi tới mùa gần nhất đã xong.
 *
 * Sắp theo mã mùa giảm dần trong từng nhóm: mã mùa của chương trình này mang số
 * tăng dần theo thời gian (UEHM-S11, UEHM-S12), nên đó cũng là thứ tự thời gian.
 */
export function sortMemberships(rows: ParticipantMembership[]): ParticipantMembership[] {
  return [...rows].sort((left, right) => {
    if (left.isPast !== right.isPast) return left.isPast ? 1 : -1;
    return String(right.seasonCode ?? "").localeCompare(String(left.seasonCode ?? ""));
  });
}

/** Nhãn tiếng Việt của vai trò trong mùa. */
export function participantRoleLabel(role: unknown): string {
  const value = String(role ?? "").trim();
  if (value === "mentor") return "Mentor";
  if (value === "mentee") return "Mentee";
  if (value === "alumni_mentee") return "Mentee (cựu)";
  if (value === "supporter") return "Hỗ trợ";
  if (value === "advisor") return "Cố vấn";
  if (value === "guest") return "Khách mời";
  return value || "—";
}

export type ParticipantEvent = {
  id: string;
  eventName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  locationName: string | null;
  attendanceStatus: string | null;
  checkedIn: boolean;
};

export type ParticipantProgramView = {
  programCode: string;
  programName: string | null;
  seasons: Array<{
    seasonId: string;
    seasonCode: string | null;
    seasonName: string | null;
    role: string;
    isPast: boolean;
    events: ParticipantEvent[];
  }>;
};

/**
 * Trang của MỘT chương trình.
 *
 * ---------------------------------------------------------------------------
 * ĐỐI CHIẾU TƯ CÁCH THÀNH VIÊN TRƯỚC KHI NẠP BẤT CỨ GÌ
 * ---------------------------------------------------------------------------
 * Mã chương trình đến từ đường dẫn, tức là từ tay người dùng. Gõ mã của một
 * chương trình khác vào thanh địa chỉ phải ra con số không, chứ không ra dữ
 * liệu của chương trình đó.
 *
 * Trả về `null` khi người này không thuộc chương trình — chỗ gọi hiện 404, y
 * như khi mã không có thật. Hai câu trả lời giống nhau, vì phân biệt chúng là
 * nói cho người ta biết chương trình nào có tồn tại.
 */
export async function getParticipantProgram(input: {
  personId: string;
  programCode: string;
}): Promise<{ view: ParticipantProgramView | null; error: string | null }> {
  const personId = String(input.personId ?? "").trim();
  const programCode = String(input.programCode ?? "").trim();
  if (!personId || !programCode) return { view: null, error: null };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { view: null, error: VI_ERROR };

  const { data: programRow, error: programError } = await client
    .from("programs")
    .select("id, code, name")
    .ilike("code", programCode)
    .maybeSingle();

  if (programError) {
    log("đọc chương trình", programError);
    return { view: null, error: VI_ERROR };
  }
  if (!programRow) return { view: null, error: null };

  const program = programRow as { id: string; code: string; name: string | null };

  // Cổng: người này có thuộc chương trình đó không.
  const { data: membershipRows, error: membershipError } = await client
    .from("person_season_memberships")
    .select("season_id, role, status")
    .eq("person_id", personId)
    .eq("program_id", program.id)
    .in("status", [...VISIBLE_MEMBERSHIP_STATUSES]);

  if (membershipError) {
    log("đọc tư cách thành viên", membershipError);
    return { view: null, error: VI_ERROR };
  }

  const memberships = (membershipRows ?? []) as Array<{
    season_id: string;
    role: string;
    status: string;
  }>;
  if (!memberships.length) return { view: null, error: null };

  const seasonIds = Array.from(new Set(memberships.map((row) => String(row.season_id))));

  const [seasons, registrations] = await Promise.all([
    client.from("seasons").select("id, code, name").in("id", seasonIds),
    // Sự kiện người này đã đăng ký. Lọc theo CẢ người lẫn mùa: một dòng đăng ký
    // của mùa khác không được lọt vào trang của mùa này.
    client
      .from("event_registrations")
      .select("id, event_id, attendance_status, registration_status")
      .eq("linked_person_id", personId)
      .neq("registration_status", "cancelled")
  ]);

  if (seasons.error || registrations.error) {
    log("đọc mùa / đăng ký sự kiện", seasons.error ?? registrations.error);
    return { view: null, error: VI_ERROR };
  }

  const registrationRows = (registrations.data ?? []) as Array<{
    event_id: string;
    attendance_status: string | null;
  }>;

  const eventsById = new Map<string, Record<string, unknown>>();
  if (registrationRows.length) {
    const { data: eventRows, error: eventError } = await client
      .from("events")
      .select("id, event_name, starts_at, ends_at, location_name, season_id")
      .in("id", Array.from(new Set(registrationRows.map((row) => String(row.event_id)))));

    if (eventError) {
      log("đọc sự kiện", eventError);
      return { view: null, error: VI_ERROR };
    }
    for (const row of ((eventRows ?? []) as Array<Record<string, unknown>>)) {
      eventsById.set(String(row.id), row);
    }
  }

  const seasonById = new Map(
    ((seasons.data ?? []) as Array<{ id: string; code: string | null; name: string | null }>).map(
      (row) => [String(row.id), row]
    )
  );

  const view: ParticipantProgramView = {
    programCode: program.code,
    programName: program.name,
    seasons: memberships
      .map((membership) => {
        const seasonId = String(membership.season_id);
        const season = seasonById.get(seasonId);

        const events = registrationRows
          .map((registration) => {
            const event = eventsById.get(String(registration.event_id));
            if (!event) return null;
            if (String(event.season_id ?? "") !== seasonId) return null;
            return {
              id: String(event.id),
              eventName: event.event_name ? String(event.event_name) : null,
              startsAt: event.starts_at ? String(event.starts_at) : null,
              endsAt: event.ends_at ? String(event.ends_at) : null,
              locationName: event.location_name ? String(event.location_name) : null,
              attendanceStatus: registration.attendance_status,
              checkedIn: registration.attendance_status === "checked_in"
            };
          })
          .filter((row): row is ParticipantEvent => row !== null)
          .sort((left, right) =>
            String(left.startsAt ?? "").localeCompare(String(right.startsAt ?? ""))
          );

        return {
          seasonId,
          seasonCode: season?.code ?? null,
          seasonName: season?.name ?? null,
          role: String(membership.role),
          isPast: membership.status === "completed",
          events
        };
      })
      .sort((left, right) => {
        if (left.isPast !== right.isPast) return left.isPast ? 1 : -1;
        return String(right.seasonCode ?? "").localeCompare(String(left.seasonCode ?? ""));
      })
  };

  return { view, error: null };
}
