/**
 * Trang một chương trình: mã đến từ đường dẫn, tức là từ tay người dùng.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI, VÀ NÓ IM LẶNG KHI SAI
 * ---------------------------------------------------------------------------
 * Gõ mã của một chương trình khác vào thanh địa chỉ phải ra con số không. Nạp
 * dữ liệu trước rồi mới đối chiếu tư cách thành viên nghĩa là dữ liệu đã đi qua
 * mạng và nằm trong bộ nhớ trước khi có ai hỏi "người này có được xem không".
 *
 * Và một dòng đăng ký sự kiện của MÙA KHÁC lọt vào trang của mùa này là một câu
 * chuyện sai về chính người đọc — họ sẽ tưởng mình đã dự một buổi chưa từng dự.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getParticipantProgram } from "@/lib/participant-home";

const PERSON = "person-1";
const PROGRAM_ID = "program-1";
const S12 = "season-12";
const S11 = "season-11";

type Filter = { table: string; column: string; value: unknown };

function makeClient(tables: Record<string, { data?: unknown; error?: unknown }>) {
  const filters: Filter[] = [];

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    const note = (column: string, value: unknown) => {
      filters.push({ table: name, column, value });
      return chain;
    };

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(note);
    chain.ilike = vi.fn(note);
    chain.neq = vi.fn(() => chain);
    chain.in = vi.fn(note);
    chain.order = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => {
      const entry = tables[name] ?? {};
      const rows = (entry.data ?? null) as unknown;
      return {
        data: Array.isArray(rows) ? (rows[0] ?? null) : rows,
        error: entry.error ?? null
      };
    });
    chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) => {
      const entry = tables[name] ?? {};
      return Promise.resolve(
        resolve({ data: entry.data ?? [], error: entry.error ?? null })
      );
    };
    return chain;
  }

  return { from: vi.fn((name: string) => table(name)), filters };
}

const program = { id: PROGRAM_ID, code: "UEHM", name: "UEH Mentoring" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("không thuộc chương trình thì không thấy gì", () => {
  it("người không có tư cách thành viên nào trả về rỗng", () => {
    const fake = makeClient({
      programs: { data: [program] },
      person_season_memberships: { data: [] }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    return getParticipantProgram({ personId: PERSON, programCode: "UEHM" }).then((result) => {
      expect(result.view).toBeNull();
      expect(result.error).toBeNull();
    });
  });

  it("mã chương trình không có thật cũng trả về rỗng — cùng một câu trả lời", async () => {
    // Phân biệt "không có" với "bạn không thuộc" là nói cho người ta biết
    // chương trình nào có tồn tại.
    const fake = makeClient({ programs: { data: [] } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await getParticipantProgram({ personId: PERSON, programCode: "KHONG-CO" });
    expect(result.view).toBeNull();
    expect(result.error).toBeNull();
  });

  it("đối chiếu tư cách thành viên theo ĐÚNG người và ĐÚNG chương trình", async () => {
    const fake = makeClient({
      programs: { data: [program] },
      person_season_memberships: { data: [] }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });

    const scoped = fake.filters.filter((row) => row.table === "person_season_memberships");
    expect(scoped).toContainEqual({
      table: "person_season_memberships",
      column: "person_id",
      value: PERSON
    });
    expect(scoped).toContainEqual({
      table: "person_season_memberships",
      column: "program_id",
      value: PROGRAM_ID
    });
  });

  it("chỉ lấy mùa ở trạng thái được xem", async () => {
    const fake = makeClient({
      programs: { data: [program] },
      person_season_memberships: { data: [] }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });

    const statusFilter = fake.filters.find(
      (row) => row.table === "person_season_memberships" && row.column === "status"
    );
    expect(statusFilter?.value).toEqual(["active", "completed"]);
  });
});

describe("sự kiện của mùa nào ở lại mùa đó", () => {
  const base = {
    programs: { data: [program] },
    person_season_memberships: {
      data: [
        { season_id: S12, role: "mentor", status: "active" },
        { season_id: S11, role: "mentor", status: "completed" }
      ]
    },
    seasons: {
      data: [
        { id: S12, code: "UEHM-S12", name: "Season 12" },
        { id: S11, code: "UEHM-S11", name: "Season 11" }
      ]
    },
    event_registrations: {
      data: [
        { id: "r1", event_id: "e-s12", attendance_status: "checked_in" },
        { id: "r2", event_id: "e-s11", attendance_status: "pending" }
      ]
    },
    events: {
      data: [
        { id: "e-s12", event_name: "Orientation S12", starts_at: "2026-09-20T01:00:00.000Z", season_id: S12 },
        { id: "e-s11", event_name: "Closing S11", starts_at: "2025-12-01T01:00:00.000Z", season_id: S11 }
      ]
    }
  };

  it("mỗi mùa chỉ nhận sự kiện của chính nó", async () => {
    const fake = makeClient(base);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const { view } = await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });

    const s12 = view?.seasons.find((row) => row.seasonId === S12);
    const s11 = view?.seasons.find((row) => row.seasonId === S11);

    expect(s12?.events.map((event) => event.id)).toEqual(["e-s12"]);
    expect(s11?.events.map((event) => event.id)).toEqual(["e-s11"]);
  });

  it("chỉ lấy đăng ký của ĐÚNG người này", async () => {
    const fake = makeClient(base);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });

    expect(fake.filters).toContainEqual({
      table: "event_registrations",
      column: "linked_person_id",
      value: PERSON
    });
  });

  it("mùa đang chạy đứng trước mùa đã xong", async () => {
    const fake = makeClient(base);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const { view } = await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });
    expect(view?.seasons.map((row) => row.isPast)).toEqual([false, true]);
  });

  it("đã check-in thì đánh dấu là đã tham dự", async () => {
    const fake = makeClient(base);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const { view } = await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });
    const s12 = view?.seasons.find((row) => row.seasonId === S12);
    expect(s12?.events[0].checkedIn).toBe(true);

    const s11 = view?.seasons.find((row) => row.seasonId === S11);
    expect(s11?.events[0].checkedIn).toBe(false);
  });
});

describe("lỗi hạ tầng không bị nhầm thành không có quyền", () => {
  it("đọc chương trình hỏng thì báo lỗi", async () => {
    const fake = makeClient({ programs: { error: { message: "timeout" } } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });
    expect(result.error).toBeTruthy();
    expect(result.view).toBeNull();
  });

  it("đọc tư cách thành viên hỏng thì báo lỗi, không lặng lẽ trả rỗng", async () => {
    // Trả rỗng nghĩa là một sự cố kết nối hiện ra thành trang 404, và người
    // dùng tưởng chương trình của mình đã biến mất.
    const fake = makeClient({
      programs: { data: [program] },
      person_season_memberships: { error: { message: "timeout" } }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await getParticipantProgram({ personId: PERSON, programCode: "UEHM" });
    expect(result.error).toBeTruthy();
  });

  it("thiếu mã chương trình hoặc thiếu người thì dừng trước khi chạm database", async () => {
    const fake = makeClient({});
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await getParticipantProgram({ personId: "", programCode: "UEHM" });
    await getParticipantProgram({ personId: PERSON, programCode: "  " });

    expect(fake.from).not.toHaveBeenCalled();
  });
});
