import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canManageMktPlan, canViewMktPlan } from "@/lib/permissions";
import {
  channelsForSpace,
  isSharedChannel,
  weeklyLoad,
  type ChannelPlan,
  type MktChannel
} from "@/lib/mkt-core";
import {
  resolveBrandName,
  resolveBrandScope,
  type BrandProfile,
  type ChannelBrief
} from "@/lib/mkt-prompt-core";

/**
 * lib/mkt-spaces.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Who is being written for, and on which channels.
 *
 * A space is one programme's fanpage, or the single shared VAM space that owns
 * LinkedIn. The programme's NAME is never stored here — it is read from
 * `programs.name` on the way past, so "UEH Mentoring" appears in a prompt
 * because that is the programme's name and not because somebody typed it into
 * a settings screen two months ago.
 *
 * Turning TikTok on is one row's `is_active` and a number. The owner asked for
 * it to be optional and decided later by the support team; making it a switch
 * rather than a schema change is what that means in practice.
 */

const SAFE_ERROR = "Không lưu được cấu hình. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[mkt-spaces]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

export type MktChannelRow = {
  channel: MktChannel;
  isActive: boolean;
  postsPerWeek: number;
  bestTimes: string[];
  audience: string | null;
  topics: string | null;
  doWrite: string | null;
  avoidWrite: string | null;
  distinctAudience: boolean;
};

export type MktSpace = {
  id: string;
  programId: string | null;
  isShared: boolean;
  /** From programs.name, or the organisation's name for the shared space. */
  brandName: string;
  programCode: string | null;
  pageUrl: string | null;
  notes: string | null;
  isActive: boolean;
  brand: BrandProfile;
  channels: MktChannelRow[];
  /** How many posts a week the current mix asks a design team for. */
  weeklyLoad: number;
};

function toChannelRow(raw: unknown): MktChannelRow {
  const row = raw as Record<string, unknown>;
  return {
    channel: String(row.channel ?? "") as MktChannel,
    isActive: row.is_active === true,
    postsPerWeek: Number(row.posts_per_week ?? 0),
    bestTimes: Array.isArray(row.best_times) ? (row.best_times as string[]) : [],
    audience: (row.audience as string | null) ?? null,
    topics: (row.topics as string | null) ?? null,
    doWrite: (row.do_write as string | null) ?? null,
    avoidWrite: (row.avoid_write as string | null) ?? null,
    distinctAudience: row.distinct_audience === true
  };
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** Every space, each already carrying its programme's real name. */
export async function listMktSpaces(): Promise<MktSpace[]> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data, error } = await client
    .from("mkt_spaces")
    .select("id,program_id,is_shared,brand,page_url,notes,is_active")
    .order("is_shared", { ascending: true });

  if (error) {
    log("list spaces", error);
    return [];
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return [];

  const programIds = rows
    .map((row) => row.program_id)
    .filter((id): id is string => typeof id === "string");

  const programs = await readPrograms(client, programIds);
  const channels = await readChannels(
    client,
    rows.map((row) => String(row.id))
  );

  return rows.map((row) => buildSpace(row, programs, channels.get(String(row.id)) ?? []));
}

/** One space, with everything a prompt or a settings screen needs. */
export async function getMktSpace(spaceId: string): Promise<MktSpace | null> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return null;
  if (!isValidUuid(spaceId)) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("mkt_spaces")
    .select("id,program_id,is_shared,brand,page_url,notes,is_active")
    .eq("id", spaceId)
    .maybeSingle();

  if (error || !data) {
    if (error) log("read space", error);
    return null;
  }

  const row = data as Record<string, unknown>;
  const programs = await readPrograms(
    client,
    typeof row.program_id === "string" ? [row.program_id] : []
  );
  const channels = await readChannels(client, [spaceId]);

  return buildSpace(row, programs, channels.get(spaceId) ?? []);
}

/**
 * The space as the prompt builder wants it.
 *
 * Only ACTIVE channels are handed over: a channel switched off should produce
 * no slots and appear in no channel brief, and filtering here means no caller
 * has to remember that.
 */
export async function getSpacePromptContext(spaceId: string): Promise<{
  space: MktSpace;
  brandName: string;
  brandScope: string;
  briefs: ChannelBrief[];
  plans: ChannelPlan[];
} | null> {
  const space = await getMktSpace(spaceId);
  if (!space) return null;

  const active = space.channels.filter((channel) => channel.isActive);

  return {
    space,
    brandName: space.brandName,
    brandScope: resolveBrandScope({ isShared: space.isShared }),
    briefs: active.map((channel) => ({
      channel: channel.channel,
      postsPerWeek: channel.postsPerWeek,
      audience: channel.audience,
      topics: channel.topics,
      doWrite: channel.doWrite,
      avoidWrite: channel.avoidWrite,
      distinctAudience: channel.distinctAudience
    })),
    plans: active.map((channel) => ({
      channel: channel.channel,
      postsPerWeek: channel.postsPerWeek,
      bestTimes: channel.bestTimes,
      distinctAudience: channel.distinctAudience
    }))
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

/** Save the brand profile: audience, voice, pillars, do, avoid, diagnosis. */
export async function updateMktBrand(input: {
  spaceId?: unknown;
  brand?: BrandProfile;
  pageUrl?: unknown;
  notes?: unknown;
}): Promise<MutationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  if (!isValidUuid(spaceId)) return { ok: false, message: "Không xác định được không gian." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa cấu hình MKT." };
  }

  const pageUrl = String(input.pageUrl ?? "").trim();
  if (pageUrl && !/^https?:\/\//i.test(pageUrl)) {
    return { ok: false, message: "Đường dẫn trang phải bắt đầu bằng http:// hoặc https://" };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client
    .from("mkt_spaces")
    .update({
      brand: normalizeBrand(input.brand),
      page_url: pageUrl || null,
      notes: String(input.notes ?? "").trim().slice(0, 2000) || null,
      updated_by: admin.id
    })
    .eq("id", spaceId);

  if (error) {
    log("update brand", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã lưu hồ sơ thương hiệu." };
}

/**
 * Switch a channel on or off, and set how hard it runs.
 *
 * The refusals here are the same rules the database holds, said in Vietnamese
 * before the database has to say them in Postgres.
 */
export async function updateMktChannel(input: {
  spaceId?: unknown;
  channel?: unknown;
  isActive?: unknown;
  postsPerWeek?: unknown;
  bestTimes?: unknown;
  audience?: unknown;
  topics?: unknown;
  doWrite?: unknown;
  avoidWrite?: unknown;
  distinctAudience?: unknown;
}): Promise<MutationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  if (!isValidUuid(spaceId)) return { ok: false, message: "Không xác định được không gian." };

  const channel = String(input.channel ?? "").trim() as MktChannel;

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa cấu hình kênh." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: spaceRow } = await client
    .from("mkt_spaces")
    .select("is_shared")
    .eq("id", spaceId)
    .maybeSingle();

  const isShared = (spaceRow as { is_shared?: boolean } | null)?.is_shared === true;
  if (!spaceRow) return { ok: false, message: "Không tìm thấy không gian." };

  if (!channelsForSpace(isShared).includes(channel)) {
    return {
      ok: false,
      message: isSharedChannel(channel)
        ? "LinkedIn là kênh chung của VAM, không thuộc riêng chương trình nào."
        : "Kênh này không thuộc không gian đang mở."
    };
  }

  const isActive = String(input.isActive ?? "") === "true";
  const postsPerWeek = Math.max(0, Math.min(7, Math.round(Number(input.postsPerWeek) || 0)));

  if (isActive && postsPerWeek === 0) {
    return { ok: false, message: "Kênh đang bật thì phải đặt số bài mỗi tuần từ 1 trở lên." };
  }

  const { error } = await client
    .from("mkt_space_channels")
    .update({
      is_active: isActive,
      posts_per_week: postsPerWeek,
      best_times: normalizeTimes(input.bestTimes),
      audience: text(input.audience, 1000),
      topics: text(input.topics, 1000),
      do_write: text(input.doWrite, 1000),
      avoid_write: text(input.avoidWrite, 1000),
      distinct_audience: String(input.distinctAudience ?? "") === "true"
    })
    .eq("space_id", spaceId)
    .eq("channel", channel);

  if (error) {
    log("update channel", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    message: isActive
      ? `Đã bật ${channel} — ${postsPerWeek} bài mỗi tuần.`
      : `Đã tắt ${channel}. Bài cũ vẫn được giữ nguyên.`
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function text(value: unknown, max: number): string | null {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
}

/** At most four golden hours per channel, each a real `HH:MM`, in order. */
function normalizeTimes(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const times = raw
    .map((item) => String(item ?? "").trim())
    .map((item) => item.match(/^(\d{1,2}):(\d{2})$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const hour = Math.min(23, Math.max(0, Number(match[1])));
      const minute = Math.min(59, Math.max(0, Number(match[2])));
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    });

  return Array.from(new Set(times)).sort().slice(0, 4);
}

function normalizeBrand(brand?: BrandProfile): Record<string, unknown> {
  const list = (value: unknown, max = 12) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, max);

  return {
    description: text(brand?.description, 2000),
    audience: text(brand?.audience, 2000),
    voice: text(brand?.voice, 2000),
    pillars: (Array.isArray(brand?.pillars) ? brand!.pillars : [])
      .filter((pillar) => String(pillar?.name ?? "").trim())
      .slice(0, 10)
      .map((pillar) => ({
        key: text(pillar.key, 60),
        name: String(pillar.name).trim().slice(0, 120),
        ratio: Number.isFinite(Number(pillar.ratio))
          ? Math.max(0, Math.min(100, Math.round(Number(pillar.ratio))))
          : null,
        note: text(pillar.note, 500)
      })),
    cta: list(brand?.cta),
    hashtags: list(brand?.hashtags),
    doList: list(brand?.doList),
    avoidList: list(brand?.avoidList),
    diagnosis: text(brand?.diagnosis, 3000)
  };
}

async function readPrograms(client: ServiceClient, ids: string[]) {
  const byId = new Map<string, { code: string; name: string }>();
  if (!ids.length) return byId;

  const { data, error } = await client
    .from("programs")
    .select("id,code,name")
    .in("id", Array.from(new Set(ids)));

  if (error) {
    log("read programs", error);
    return byId;
  }

  for (const row of (data ?? []) as Array<{ id: string; code: string; name: string }>) {
    byId.set(row.id, { code: row.code, name: row.name });
  }
  return byId;
}

async function readChannels(client: ServiceClient, spaceIds: string[]) {
  const bySpace = new Map<string, MktChannelRow[]>();
  if (!spaceIds.length) return bySpace;

  const { data, error } = await client
    .from("mkt_space_channels")
    .select(
      "space_id,channel,is_active,posts_per_week,best_times,audience,topics,do_write,avoid_write,distinct_audience"
    )
    .in("space_id", spaceIds);

  if (error) {
    log("read channels", error);
    return bySpace;
  }

  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const spaceId = String(raw.space_id);
    const list = bySpace.get(spaceId) ?? [];
    list.push(toChannelRow(raw));
    bySpace.set(spaceId, list);
  }

  return bySpace;
}

function buildSpace(
  row: Record<string, unknown>,
  programs: Map<string, { code: string; name: string }>,
  channels: MktChannelRow[]
): MktSpace {
  const programId = typeof row.program_id === "string" ? row.program_id : null;
  const program = programId ? programs.get(programId) ?? null : null;
  const isShared = row.is_shared === true || programId === null;

  return {
    id: String(row.id),
    programId,
    isShared,
    // The whole point: the name comes from the programme, not from settings.
    brandName: resolveBrandName({ programName: program?.name ?? null, isShared }),
    programCode: program?.code ?? null,
    pageUrl: (row.page_url as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    isActive: row.is_active !== false,
    brand: (row.brand as BrandProfile) ?? {},
    channels: channels.sort((a, b) => a.channel.localeCompare(b.channel)),
    weeklyLoad: weeklyLoad(
      channels
        .filter((channel) => channel.isActive)
        .map((channel) => ({
          channel: channel.channel,
          postsPerWeek: channel.postsPerWeek,
          bestTimes: channel.bestTimes
        }))
    )
  };
}
