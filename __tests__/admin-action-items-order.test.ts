/**
 * /admin "Lịch sử việc cần xử lý" cắt 20 dòng đầu, và hướng dẫn hứa "20 việc
 * mới nhất". Trước 07/10/2026 action_items được đọc phân trang không có thứ tự,
 * nên 20 dòng đó là 20 dòng bất kỳ. Ca dưới đây đọc qua bản giả PostgREST với
 * thứ tự đọc không ổn định — đúng điều kiện đã làm hỏng trên production.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => ({ id: "u1", role: "super_admin", email: "btc@example.test" })) }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scopeError: null })),
  getScopeFilter: vi.fn(async () => undefined),
  canOperateAnyScope: vi.fn(() => true),
  canOperateSeason: vi.fn(async () => true)
}));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getAdminCorrectionData } from "@/lib/admin-corrections";

const db = createFakeDb();

function day(n: number) {
  return `2026-09-${String(n).padStart(2, "0")}T03:00:00+00:00`;
}

beforeEach(() => {
  db.reset();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(db) as any);
  db.tables.people = [];
  db.tables.seasons = [{ id: "s12", code: "S12", name: "Season 12" }];
  db.tables.mentoring_recaps = [];
  db.tables.action_items = [];
});

describe("getAdminCorrectionData — thứ tự việc cần xử lý", () => {
  it("action items xếp theo lần cập nhật mới nhất; 20 dòng đầu đúng là 20 việc mới nhất", async () => {
    // id tăng dần ngược chiều với ngày cập nhật: thứ tự đọc theo id sẽ ra cũ nhất trước.
    db.tables.action_items = Array.from({ length: 25 }, (_, i) => ({
      id: `ai-${String(i).padStart(2, "0")}`,
      type: i % 2 ? "followup_no_recap" : "data_issue",
      status: "open",
      season_code: "S12",
      created_at: day(1),
      updated_at: day(25 - i),
      metadata: {}
    }));

    const data = await getAdminCorrectionData();
    const updated = data.actionItems.map((item) => item.updated_at);
    expect(updated).toEqual([...updated].sort((a, b) => Date.parse(b) - Date.parse(a)));
    expect(data.actionItems.slice(0, 20).map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `ai-${String(i).padStart(2, "0")}`)
    );
    // Tab "Hỗ trợ follow-up" lọc từ cùng danh sách nên cũng mới nhất trước.
    expect(data.followups.map((item) => item.id).slice(0, 3)).toEqual(["ai-01", "ai-03", "ai-05"]);
  });

  it("chưa từng cập nhật thì dùng lúc tạo", async () => {
    db.tables.action_items = [
      { id: "a", type: "data_issue", status: "open", season_code: "S12", created_at: day(2), updated_at: null, metadata: {} },
      { id: "b", type: "data_issue", status: "open", season_code: "S12", created_at: day(9), updated_at: null, metadata: {} },
      { id: "c", type: "data_issue", status: "open", season_code: "S12", created_at: day(1), updated_at: day(5), metadata: {} }
    ];
    const data = await getAdminCorrectionData();
    expect(data.actionItems.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("vấn đề dữ liệu cùng mức, cùng loại: buổi gặp mới nhất trước", async () => {
    const recap = (id: string, date: string) => ({
      id,
      season_id: "s12",
      match_id: null, // → "Unmatched recap", cùng mức "medium"
      mentor_person_id: null,
      mentee_person_id: null,
      meeting_date: date,
      meeting_month: date.slice(0, 7),
      status: "valid"
    });
    db.tables.mentoring_recaps = [recap("r-old", "2026-08-02"), recap("r-new", "2026-09-28"), recap("r-mid", "2026-09-01")];
    const data = await getAdminCorrectionData();
    const unmatched = data.issues.filter((issue) => issue.type === "unmatched_recap").map((issue) => issue.recap_id);
    expect(unmatched).toEqual(["r-new", "r-mid", "r-old"]);
  });
});
