import "server-only";

import {
  buildMentorSeasonsByEmail,
  isMentorOrientationEvent,
  splitMentorRegistrants,
  type MentorSplit
} from "@/lib/mentor-orientation-core";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export type MentorOrientationSplits =
  | { ok: true; splits: Map<string, MentorSplit> }
  | { ok: false };

/**
 * Số mentor cũ/mới cho các buổi Mentor Orientation trong một danh sách sự kiện.
 *
 * Chỉ trả về CON SỐ. Email đăng ký và email mentor được đọc, so, rồi bỏ đi ngay
 * trên máy chủ; không địa chỉ nào đi vào dòng dữ liệu của trang.
 *
 * Không có buổi orientation nào thì không đọc gì: danh sách sự kiện mở rất
 * thường xuyên, và phần lớn thời gian không có buổi nào cần đếm.
 *
 * Một lần đọc hỏng thì trả `ok: false`, và trang KHÔNG hiện số. "Cũ 0 · Mới 25"
 * sai trông y hệt "Cũ 0 · Mới 25" đúng — không ai nhìn vào mà biết được.
 */
export async function getMentorOrientationSplits(
  events: Array<{ id: string; season_id?: string | null; event_type?: unknown; event_name?: unknown }>
): Promise<MentorOrientationSplits> {
  const targets = events.filter((event) => Boolean(event.id) && isMentorOrientationEvent(event));
  if (!targets.length) return { ok: true, splits: new Map() };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false };

  try {
    const [registrations, memberships] = await Promise.all([
      readAllPagesIn<Record<string, unknown>>(
        client,
        "event_registrations",
        "event_id",
        targets.map((event) => event.id),
        "event_id,email,registration_status"
      ),
      readAllPages<Record<string, unknown>>(
        "person_season_memberships",
        "person_id,season_id,status",
        (projection) => client.from("person_season_memberships").select(projection).eq("role", "mentor")
      )
    ]);
    if (registrations.error || memberships.error) {
      logReadFailure("registrations_or_memberships", registrations.error ?? memberships.error);
      return { ok: false };
    }

    const people = await readAllPagesIn<Record<string, unknown>>(
      client,
      "people",
      "id",
      memberships.data.map((row) => String(row.person_id ?? "")),
      "id,email_primary"
    );
    if (people.error) {
      logReadFailure("people", people.error);
      return { ok: false };
    }

    return {
      ok: true,
      splits: splitMentorRegistrants({
        events: targets.map((event) => ({ id: event.id, season_id: event.season_id ?? null })),
        registrations: registrations.data,
        mentorSeasonsByEmail: buildMentorSeasonsByEmail(memberships.data, people.data)
      })
    };
  } catch (error) {
    logReadFailure("threw", error);
    return { ok: false };
  }
}

/** Ghi mã và thông điệp lỗi, không bao giờ ghi email. */
function logReadFailure(stage: string, error: unknown) {
  const detail = (error ?? {}) as { code?: string; message?: string };
  console.error("[mentor-orientation] read failed", {
    stage,
    code: detail.code ?? null,
    message: detail.message ?? null
  });
}
