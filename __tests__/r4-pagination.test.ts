import { describe, it, expect, vi, beforeEach } from "vitest";
import { getApplications, getAllApplicationReviews } from "@/lib/data";

vi.mock("react", () => ({
  cache: (fn: any) => fn,
}));

const mockQuery: any = {
  from: () => mockQuery,
  select: () => mockQuery,
  in: () => mockQuery,
  eq: () => mockQuery,
  gt: () => mockQuery,
  order: () => mockQuery,
  limit: () => mockQuery,
  then: (resolve: any) => resolve({ data: [], error: null }),
  range: () => Promise.resolve({ data: [], error: null }),
};

import * as supabaseServer from "@/lib/supabase-server";

vi.spyOn(supabaseServer, "getSupabaseServiceRoleClient").mockReturnValue(mockQuery as any);
vi.spyOn(supabaseServer, "getSupabaseServerClient").mockReturnValue(mockQuery as any);

describe("Pagination real path testing", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "dummy");
  });

  it("getApplications handles exactly 999, 1000, 1001, 1500, 2000 rows across pages", async () => {
    const rows = Array.from({ length: 2000 }).map((_, i) => ({ id: `app-${i}` }));

    for (const total of [999, 1000, 1001, 1500, 2000]) {
      const targetRows = rows.slice(0, total);
      
      mockQuery.then = (resolve: any) => resolve({ data: [{ id: "batch-1" }], error: null });
      mockQuery.range = (from: number, to: number) => {
        const slice = targetRows.slice(from, to + 1);
        return Promise.resolve({ data: slice, error: null });
      };
      
      const res = await getApplications({} as any);
      expect(res.error).toBeNull();
      expect(res.data?.length).toBe(total);
    }
  });

  it("getAllApplicationReviews handles >1000 reviews across chunks", async () => {
    const total = 1200;
    const targetRows = Array.from({ length: total }).map((_, i) => ({ id: `rev-${i}`, application_id: "app-1" }));
    
    mockQuery.then = (resolve: any) => resolve({ data: targetRows, error: null });
    mockQuery.range = (from: number, to: number) => {
      const slice = targetRows.slice(from, to + 1);
      return Promise.resolve({ data: slice, error: null });
    };

    const res = await getAllApplicationReviews({} as any);
    expect(res.error).toBeNull();
    expect(res.data?.length).toBe(total);
  });
});
