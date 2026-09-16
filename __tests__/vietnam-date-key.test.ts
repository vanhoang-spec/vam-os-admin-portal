/**
 * Ngày theo lịch Việt Nam khi GHI hay SO một ngày — không phải ngày UTC.
 *
 * Máy chủ Vercel chạy UTC (vitest.config.ts cũng đặt TZ=UTC). `toISOString().slice(0, 10)`
 * vì thế đúng trên máy người phát triển và sai trên production: đơn nộp lúc 00:30 sáng
 * 11/09 giờ Việt Nam mang ngày 10/09. Tới 16/09/2026 lỗi đó đã nằm trong 40 đơn S12.
 *
 * Canh: hàm dùng chung, form nộp đơn, việc quá hạn ở trang Danh mục chương trình, và
 * một phép quét nguồn để mẫu cũ không quay lại ở chỗ khác.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/apply-gate", () => ({
  evaluateApplyGate: vi.fn(async () => ({ status: "open", state: "open" }))
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ sameAsAnonKey: false }))
}));

import { submitPilotApplication } from "@/lib/applications-create";
import { reconcilePortfolioRows } from "@/lib/portfolio-core";
import { vietnamDateKey as bonusDateKey } from "@/lib/submission-bonus-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { vietnamDateKey } from "@/lib/utils";

describe("1. vietnamDateKey", () => {
  it("máy chạy test đúng múi giờ production", () => {
    expect(process.env.TZ).toBe("UTC");
  });

  it("23:59:59 giờ Việt Nam vẫn là ngày đó; 00:00 là ngày hôm sau", () => {
    expect(vietnamDateKey("2026-09-10T16:59:59Z")).toBe("2026-09-10");
    expect(vietnamDateKey("2026-09-10T17:00:00Z")).toBe("2026-09-11");
    expect(vietnamDateKey(new Date("2026-09-10T17:30:00Z"))).toBe("2026-09-11");
  });

  it("đầu năm và cuối tháng vẫn đúng", () => {
    expect(vietnamDateKey("2026-12-31T17:00:00Z")).toBe("2027-01-01");
    expect(vietnamDateKey("2026-02-28T18:00:00Z")).toBe("2026-03-01");
  });

  it("một ngày thuần (cột DATE đọc ra) giữ nguyên ngày đó", () => {
    expect(vietnamDateKey("2026-09-10")).toBe("2026-09-10");
  });

  it("rỗng hoặc không đọc được: null", () => {
    expect(vietnamDateKey(null)).toBeNull();
    expect(vietnamDateKey("")).toBeNull();
    expect(vietnamDateKey("không phải ngày")).toBeNull();
    expect(vietnamDateKey(new Date(Number.NaN))).toBeNull();
  });

  it("điểm cộng theo ngày nộp dùng đúng hàm này, không có bản thứ hai", () => {
    expect(bonusDateKey).toBe(vietnamDateKey);
  });
});

describe("2. form nộp đơn ghi submitted_at theo ngày Việt Nam", () => {
  let inserted: Record<string, unknown> | null = null;

  function mockClient() {
    const chain = (data: unknown) => {
      const c: Record<string, any> = {};
      for (const key of ["select", "eq", "ilike", "limit", "order", "in"]) c[key] = vi.fn(() => c);
      c.maybeSingle = vi.fn(async () => ({ data, error: null }));
      return c;
    };
    const from = vi.fn((table: string) => {
      if (table === "seasons") return chain({ id: "season-12", code: "UEHM-S12" });
      if (table === "intake_batches") return chain({ id: "batch-1", code: "UEHM-S12-B1" });
      if (table === "people") return chain(null);
      if (table === "application_answers") return { insert: vi.fn(async () => ({ error: null })) };
      if (table === "applications") {
        return {
          select: vi.fn(() => chain(null)),
          insert: vi.fn((payload: Record<string, unknown>) => {
            inserted = payload;
            return chain({ id: "11111111-1111-4111-8111-111111111111" });
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from } as never);
  }

  const input = {
    role: "mentor" as const,
    seasonCode: "UEHM-S12",
    intakeBatchCode: "UEHM-S12-B1",
    fullName: "Mentor Test",
    emailPrimary: "mentor@example.com",
    phonePrimary: "0900000000",
    consentDataStorage: true,
    rawPayload: {},
    answers: []
  };

  beforeEach(() => {
    inserted = null;
    mockClient();
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nộp 00:30 sáng 11/09 giờ Việt Nam (17:30 UTC ngày 10/09): ghi 2026-09-11", async () => {
    vi.setSystemTime(new Date("2026-09-10T17:30:00Z"));
    await expect(submitPilotApplication(input)).resolves.toMatchObject({ ok: true });
    expect(inserted?.submitted_at).toBe("2026-09-11");
  });

  it("nộp 23:59 đêm 10/09 giờ Việt Nam: ghi 2026-09-10", async () => {
    vi.setSystemTime(new Date("2026-09-10T16:59:00Z"));
    await expect(submitPilotApplication(input)).resolves.toMatchObject({ ok: true });
    expect(inserted?.submitted_at).toBe("2026-09-10");
  });
});

describe("3. việc quá hạn ở Danh mục chương trình tính theo ngày Việt Nam", () => {
  const catalog = {
    programs: [{ id: "ueh", code: "UEHM", name: "UEH Mentoring", isActive: true }],
    seasons: [{ id: "ueh12", code: "UEHM-S12", name: "S12", programId: "ueh" }],
    intakeBatches: []
  };
  const sources = {
    applications: [],
    memberships: [],
    matches: [],
    events: [],
    actions: [{ season_id: "ueh12", status: "open", action_type: "manual_task", due_date: "2026-09-10" }]
  };

  it("00:30 sáng 11/09 giờ Việt Nam: việc hạn 10/09 đã quá hạn", () => {
    const [row] = reconcilePortfolioRows(catalog as never, sources as never, undefined, new Date("2026-09-10T17:30:00Z"));
    expect(row.overdueTasks).toBe(1);
  });

  it("23:59 đêm 10/09 giờ Việt Nam: chưa quá hạn", () => {
    const [row] = reconcilePortfolioRows(catalog as never, sources as never, undefined, new Date("2026-09-10T16:59:00Z"));
    expect(row.overdueTasks).toBe(0);
  });
});

describe("4. mẫu ngày UTC không quay lại", () => {
  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);
  const PATTERN = "toISOString().slice(0, 10)";

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /[.]tsx?$/.test(name) ? [path] : [];
    });
  }

  it("chỉ còn trong phép kiểm một chuỗi YYYY-MM-DD có thật (so với chính nó, không sinh ngày)", () => {
    const offenders: string[] = [];
    for (const file of ["lib", "app", "components"].flatMap(sourceFiles)) {
      const lines = readFileSync(file, "utf8").split(CR).join("").split(LF);
      lines.forEach((line, index) => {
        if (!line.includes(PATTERN)) return;
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        if (trimmed.includes(`parsed.${PATTERN} === value`)) return;
        offenders.push(`${file}:${index + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
