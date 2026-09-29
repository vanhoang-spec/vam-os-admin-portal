/**
 * __tests__/mentee-prep-answers.test.ts
 *
 * Hai câu trả lời chuẩn bị — ghi thẳng vào applications.raw_payload qua đúng
 * hai khoá MENTEE_PREP_QUESTIONS, không đè lên các trường khác đã có trong
 * đơn (đường ghi hẹp — CLAUDE.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseServiceRoleClient: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: mocks.getSupabaseServiceRoleClient
}));

import { saveMenteePrepAnswers } from "@/lib/mentee-interview";
import { MENTEE_PREP_QUESTIONS } from "@/lib/email-core";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const APP_ID = "22222222-2222-4222-8222-222222222222";

type Seed = {
  invite?: { application_id: string } | null;
  app?: Record<string, unknown> | null;
  booking?: { id: string } | null;
};

/**
 * Bản giả CHỈ đủ cho các câu gọi mà saveMenteePrepAnswers thật sự phát ra:
 * mentee_interview_invites (đọc), applications (đọc rồi ghi),
 * mentee_interview_bookings (đọc). fake-postgrest.ts dùng chung của dự án
 * không có .update(), nên bản giả riêng ở đây bù đúng phần đó.
 */
function fakeClient(seed: Seed) {
  const updates: Array<{ table: string; payload: unknown; id: string }> = [];

  function builder(table: string) {
    const self: any = {
      select: () => self,
      eq: (_col: string, value: unknown) => {
        self.__lastEqId = value;
        return self;
      },
      maybeSingle: async () => {
        if (table === "mentee_interview_invites") return { data: seed.invite ?? null, error: null };
        if (table === "applications") return { data: seed.app ?? null, error: null };
        if (table === "mentee_interview_bookings") return { data: seed.booking ?? null, error: null };
        throw new Error(`fake: unexpected select on ${table}`);
      },
      update: (payload: unknown) => ({
        eq: (_col: string, id: unknown) => {
          updates.push({ table, payload, id: String(id) });
          return Promise.resolve({ data: null, error: null });
        }
      })
    };
    return self;
  }

  return { client: { from: (table: string) => builder(table) }, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const [Q1, Q2] = MENTEE_PREP_QUESTIONS;

describe("saveMenteePrepAnswers", () => {
  it("ghi đúng hai khoá, giữ nguyên các trường khác đã có trong raw_payload", async () => {
    const { client, updates } = fakeClient({
      invite: { application_id: APP_ID },
      app: { id: APP_ID, status: "invited_to_interview", role_applied: "mentee", source: "vam_os_form", raw_payload: { major: "Marketing", mssv: "31231020001" } },
      booking: null
    });
    mocks.getSupabaseServiceRoleClient.mockReturnValue(client);

    const result = await saveMenteePrepAnswers({ token: TOKEN, answers: ["Muốn mentor giàu kinh nghiệm", "Cần định hướng nghề nghiệp"] });

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(APP_ID);
    expect(updates[0].payload).toEqual({
      raw_payload: {
        major: "Marketing",
        mssv: "31231020001",
        [Q1.rawPayloadKey]: "Muốn mentor giàu kinh nghiệm",
        [Q2.rawPayloadKey]: "Cần định hướng nghề nghiệp"
      }
    });
  });

  it("cho phép đã đặt ca (booked) hoặc đang ở bước đặt ca (eligible) — không cho khi đã rút đơn", async () => {
    const { client, updates } = fakeClient({
      invite: { application_id: APP_ID },
      app: { id: APP_ID, status: "withdrawn", role_applied: "mentee", source: "vam_os_form", raw_payload: {} },
      booking: null
    });
    mocks.getSupabaseServiceRoleClient.mockReturnValue(client);

    const result = await saveMenteePrepAnswers({ token: TOKEN, answers: ["a", "b"] });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("đã đặt ca vẫn ghi được dù status hồ sơ đã đổi khỏi nhóm đủ điều kiện", async () => {
    const { client, updates } = fakeClient({
      invite: { application_id: APP_ID },
      app: { id: APP_ID, status: "interview_in_progress", role_applied: "mentee", source: "vam_os_form", raw_payload: {} },
      booking: { id: "booking-1" }
    });
    mocks.getSupabaseServiceRoleClient.mockReturnValue(client);

    const result = await saveMenteePrepAnswers({ token: TOKEN, answers: ["a", "b"] });

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("cắt câu trả lời quá dài về đúng trần, không lỗi", async () => {
    const { client, updates } = fakeClient({
      invite: { application_id: APP_ID },
      app: { id: APP_ID, status: "invited_to_interview", role_applied: "mentee", source: "vam_os_form", raw_payload: {} },
      booking: null
    });
    mocks.getSupabaseServiceRoleClient.mockReturnValue(client);

    const long = "a".repeat(3000);
    const result = await saveMenteePrepAnswers({ token: TOKEN, answers: [long, ""] });

    expect(result.ok).toBe(true);
    const written = updates[0].payload as { raw_payload: Record<string, string> };
    expect(written.raw_payload[Q1.rawPayloadKey]).toHaveLength(2000);
    expect(written.raw_payload[Q2.rawPayloadKey]).toBe("");
  });

  it("token sai định dạng bị từ chối trước khi chạm database", async () => {
    const { client, updates } = fakeClient({});
    mocks.getSupabaseServiceRoleClient.mockReturnValue(client);

    const result = await saveMenteePrepAnswers({ token: "khong-phai-uuid", answers: ["a", "b"] });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("token không khớp lời mời nào thì từ chối", async () => {
    const { client, updates } = fakeClient({ invite: null });
    mocks.getSupabaseServiceRoleClient.mockReturnValue(client);

    const result = await saveMenteePrepAnswers({ token: TOKEN, answers: ["a", "b"] });

    expect(result.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
