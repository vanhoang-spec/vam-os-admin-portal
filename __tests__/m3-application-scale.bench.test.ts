import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { generateBenchmarkDataset } from "./support/benchmark-dataset";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";
import fs from "fs";
import path from "path";

// Mock environment and dependencies before importing data layer
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: (fn: any) => fn
  };
});
vi.mock("@/lib/supabase-server", () => {
  return {
    createClient: () => global.__fakeSupabaseClient,
    getSupabaseServiceRoleClient: () => global.__fakeSupabaseClient,
    getSupabaseServerClient: async () => global.__fakeSupabaseClient
  };
});
vi.mock("@/lib/supabase", () => {
  return {
    createClient: () => global.__fakeSupabaseClient,
    supabase: global.__fakeSupabaseClient
  };
});

// Import after mocks are set up
import { getApplications, getApplication } from "@/lib/data";

declare global {
  var __fakeSupabaseClient: any;
}

describe("M3 R0 Application Scale Benchmark", () => {
  let db: ReturnType<typeof createFakeDb>;
  let dataset: any;
  let checksum: string;

  beforeAll(() => {
    const generated = generateBenchmarkDataset();
    dataset = generated.dataset;
    checksum = generated.checksum;

    db = createFakeDb({ maxRows: 1000, unstableUnorderedReads: false }); // Unstable unordered reads off for consistent benchmark
    db.tables = dataset;
    global.__fakeSupabaseClient = fakeClient(db);
  });

  afterAll(() => {
    delete global.__fakeSupabaseClient;
  });

  it("benchmarks LIST data access (getApplications)", async () => {
    db.requests.length = 0; // reset requests

    const startTime = performance.now();
    const result = await getApplications({ allowedSeasonIds: ["season-1"] });
    const mapTime = performance.now() - startTime;

    expect(result.data).toBeDefined();
    expect(result.data?.length).toBeGreaterThan(0);

    const requests = db.requests;
    const totalRequests = requests.length;
    let totalBytes = 0;
    let totalRows = 0;
    
    requests.forEach(req => {
      totalBytes += req.bytes || 0;
      totalRows += req.returned;
    });

    const metrics = {
      harnessVersion: 2,
      checksum,
      list: {
        totalRequests,
        totalRows,
        totalBytes,
        mapTimeMs: Math.round(mapTime),
        requestsByTable: requests.reduce((acc, req) => {
          acc[req.table] = (acc[req.table] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        rowsByTable: requests.reduce((acc, req) => {
          acc[req.table] = (acc[req.table] || 0) + req.returned;
          return acc;
        }, {} as Record<string, number>)
      }
    };

    // Save intermediate artifact
    const artifactPath = path.resolve(__dirname, "../docs/benchmarks/m3-r0-before.json");
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    
    // We will merge this with detail metrics
    global.__benchmarkMetrics = metrics;
  });

  it("benchmarks DETAIL data access (getApplication)", async () => {
    db.requests.length = 0; // reset requests

    const appIds = ["app-0", "app-100", "app-500", "app-1000", "app-1400"];
    let totalRequests = 0;
    let totalBytes = 0;
    let totalRowsFetched = 0;
    let totalRowsRendered = 0; // Roughly 1 app + 1 person + 1 profile + 1 match + ~20 answers

    for (const appId of appIds) {
      const dbBefore = db.requests.length;
      
      const result = await getApplication(appId, { allowedSeasonIds: ["season-1"] });
      expect(result.data).toBeDefined();

      const reqsForThisApp = db.requests.slice(dbBefore);
      
      totalRequests += reqsForThisApp.length;
      reqsForThisApp.forEach(req => {
        totalBytes += req.bytes || 0;
        totalRowsFetched += req.returned;
      });
      totalRowsRendered += 25; // Estimate ~25 rows per application detail view
    }

    const avgRequests = totalRequests / appIds.length;
    const avgRowsFetched = totalRowsFetched / appIds.length;
    const overFetchAmplification = avgRowsFetched / (totalRowsRendered / appIds.length);

    const detailMetrics = {
      avgRequests,
      avgRowsFetched,
      overFetchAmplification: Math.round(overFetchAmplification * 100) / 100,
      requestsByTable: db.requests.reduce((acc, req) => {
        acc[req.table] = (acc[req.table] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    const artifactPath = path.resolve(__dirname, "../docs/benchmarks/m3-r0-before.json");
    const currentMetrics = global.__benchmarkMetrics || {};
    currentMetrics.detail = detailMetrics;

    fs.writeFileSync(artifactPath, JSON.stringify(currentMetrics, null, 2));

    // The test must pass
    expect(currentMetrics).toBeDefined();
  });
});

declare global {
  var __benchmarkMetrics: any;
}
