/**
 * VAM00037 — tệp đính kèm theo lô: mọi người nhận (một hay nhiều, lần đầu hay "Gửi tiếp") nhận đủ
 * bộ tệp đã chốt; lô không tệp chạy y như cũ; không đọc được tệp thì không gửi lá nào.
 *
 * Cùng với đó là module kho lib/mail-dinh-kem.ts: đường dẫn do máy chủ sinh trong thư mục của chính
 * người tải, cỡ thật đọc từ kho, lệnh ghi chốt tệp vào lô, và lô bị đóng khi chốt tệp hỏng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendTemplatedEmail } from "@/lib/email";
import { runEmailBatch, type EmailBatchRow } from "@/lib/bulk-mail";
import { boTepDaTai, capLinkTaiTep, ganTepVaoLo, kiemTepDaTai, tepCuaLo } from "@/lib/mail-dinh-kem";

const SEASON = "00000000-0000-4000-8000-0000000000aa";
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const BATCH = "00000000-0000-4000-8000-0000000000bb";
const U1 = "11111111-1111-4111-8111-111111111111";
const P1 = `${SEASON}/${ACTOR}/${U1}/huong-dan.pdf`;
const P2 = `${SEASON}/${ACTOR}/22222222-2222-4222-8222-222222222222/lich.ics`;

type Result = { data: unknown; error: { code?: string; message?: string } | null };

type World = {
  attachments: Result;
  signed?: Result;
  listed?: Record<string, Result>;
  insertError?: { code?: string; message?: string } | null;
  people: number;
};

const writes: Array<{ table: string; op: string; payload: unknown; filters: unknown[] }> = [];
const storageCalls: Array<{ op: string; args: unknown[] }> = [];

function fakeClient(world: World) {
  return {
    from(table: string) {
      const filters: unknown[] = [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "in", "order", "limit", "range"]) {
        chain[method] = vi.fn((...args: unknown[]) => {
          filters.push([method, ...args]);
          return chain;
        });
      }
      chain.eq = vi.fn((...args: unknown[]) => {
        filters.push(["eq", ...args]);
        return chain;
      });
      chain.update = vi.fn((payload: unknown) => {
        writes.push({ table, op: "update", payload, filters });
        return chain;
      });
      chain.insert = vi.fn((payload: unknown) => {
        writes.push({ table, op: "insert", payload, filters });
        return Promise.resolve({ data: null, error: world.insertError ?? null });
      });
      chain.then = (resolve: (value: Result) => unknown) => {
        if (table === "email_attachments") return Promise.resolve(resolve(world.attachments));
        const data =
          table === "person_season_memberships"
            ? Array.from({ length: world.people }, (_, i) => ({ person_id: `p${i}`, role: "mentee" }))
            : table === "people"
              ? Array.from({ length: world.people }, (_, i) => ({ id: `p${i}`, full_name: `Người ${i}`, email_primary: `n${i}@example.com` }))
              : [];
        return Promise.resolve(resolve({ data, error: null }));
      };
      return chain;
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUrls: vi.fn(async (...args: unknown[]) => {
            storageCalls.push({ op: `createSignedUrls:${bucket}`, args });
            return world.signed ?? { data: null, error: { message: "no" } };
          }),
          createSignedUploadUrl: vi.fn(async (path: string) => {
            storageCalls.push({ op: `createSignedUploadUrl:${bucket}`, args: [path] });
            return { data: { signedUrl: `https://kho.test/upload/${path}?token=x`, path, token: "x" }, error: null };
          }),
          list: vi.fn(async (folder: string) => {
            storageCalls.push({ op: `list:${bucket}`, args: [folder] });
            return world.listed?.[folder] ?? { data: [], error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            storageCalls.push({ op: `remove:${bucket}`, args: [paths] });
            return { data: [], error: null };
          })
        };
      }
    }
  };
}

function batch(overrides: Partial<EmailBatchRow> = {}): EmailBatchRow {
  return {
    id: BATCH,
    seasonId: SEASON,
    kind: "general_announcement",
    templateId: "t1",
    audience: "mentee",
    audienceEventId: null,
    audienceCoversSeries: false,
    status: "running",
    requestedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    note: null,
    createdAt: "",
    completedAt: null,
    ...overrides
  };
}

const ROWS = {
  data: [
    { storage_path: P1, file_name: "Hướng dẫn.pdf", content_type: "application/pdf", position: 0 },
    { storage_path: P2, file_name: "Lịch.ics", content_type: "text/calendar", position: 1 }
  ],
  error: null
};
const SIGNED = {
  data: [
    { path: P1, signedUrl: "https://kho.test/sign/a?token=1" },
    { path: P2, signedUrl: "https://kho.test/sign/b?token=2" }
  ],
  error: null
};

function withWorld(world: World) {
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fakeClient(world) as never);
}

function run(world: World) {
  withWorld(world);
  return runEmailBatch({ batch: batch(), seasonCode: "UEHM-S12", subject: "Thông báo {{mua}}", body: "Chào {{ten_nguoi_nhan}}." });
}

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  storageCalls.length = 0;
  vi.mocked(sendTemplatedEmail).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("gửi hàng loạt kèm tệp", () => {
  it("MỖI người nhận nhận đủ bộ tệp đã chốt, đúng thứ tự", async () => {
    const result = await run({ attachments: ROWS, signed: SIGNED, people: 3 });
    expect(result.sent).toBe(3);
    const expected = [
      { filename: "Hướng dẫn.pdf", url: "https://kho.test/sign/a?token=1", contentType: "application/pdf" },
      { filename: "Lịch.ics", url: "https://kho.test/sign/b?token=2", contentType: "text/calendar" }
    ];
    const calls = vi.mocked(sendTemplatedEmail).mock.calls.map((call) => call[0]);
    expect(calls.map((c) => c.toEmail).sort()).toEqual(["n0@example.com", "n1@example.com", "n2@example.com"]);
    for (const call of calls) expect(call.attachments).toEqual(expected);
    // Link ký một lần cho cả lần chạy, đúng kho riêng, sống 24 giờ.
    expect(storageCalls).toEqual([{ op: "createSignedUrls:mail-dinh-kem", args: [[P1, P2], 86400] }]);
  });

  it("một người nhận cũng nhận đủ tệp", async () => {
    await run({ attachments: ROWS, signed: SIGNED, people: 1 });
    expect(vi.mocked(sendTemplatedEmail).mock.calls[0][0].attachments).toHaveLength(2);
  });

  it("đọc tệp theo đúng lô và theo thứ tự đã chốt", async () => {
    withWorld({ attachments: ROWS, signed: SIGNED, people: 0 });
    let seen: unknown[] = [];
    const client = fakeClient({ attachments: ROWS, signed: SIGNED, people: 0 });
    const original = client.from.bind(client);
    client.from = (table: string) => {
      const chain = original(table) as Record<string, any>;
      if (table === "email_attachments") {
        const eq = chain.eq;
        chain.eq = vi.fn((...args: unknown[]) => {
          seen.push(["eq", ...args]);
          return eq(...args);
        });
        const order = chain.order;
        chain.order = vi.fn((...args: unknown[]) => {
          seen.push(["order", ...args]);
          return order(...args);
        });
      }
      return chain;
    };
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
    seen = [];
    const out = await tepCuaLo(BATCH);
    expect(out.error).toBeNull();
    expect(seen).toEqual([
      ["eq", "batch_id", BATCH],
      ["order", "position", { ascending: true }]
    ]);
  });
});

describe("thư không đính kèm giữ nguyên hành vi cũ", () => {
  it("lô không có tệp: không chạm kho, lời gọi gửi không mang khoá attachments", async () => {
    const result = await run({ attachments: { data: [], error: null }, people: 2 });
    expect(result.sent).toBe(2);
    expect(storageCalls).toEqual([]);
    for (const [call] of vi.mocked(sendTemplatedEmail).mock.calls) expect(call).not.toHaveProperty("attachments");
  });

  it("migration chưa áp (thiếu bảng): vẫn gửi như cũ", async () => {
    const result = await run({
      attachments: { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.email_attachments'" } },
      people: 2
    });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(2);
  });
});

describe("không gửi thư thiếu tệp", () => {
  it("đọc bảng tệp lỗi: không lá nào đi, lô không bị đánh dấu xong", async () => {
    const result = await run({ attachments: { data: null, error: { code: "57014", message: "timeout" } }, people: 3 });
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(3);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.table === "email_batches")).toEqual([]);
  });

  it("không ký được link tệp: không lá nào đi", async () => {
    const result = await run({ attachments: ROWS, signed: { data: null, error: { message: "down" } }, people: 3 });
    expect(result.ok).toBe(false);
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it("thiếu link cho một tệp: không lá nào đi", async () => {
    const result = await run({ attachments: ROWS, signed: { data: [SIGNED.data[0]], error: null }, people: 3 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Lịch.ics");
    expect(sendTemplatedEmail).not.toHaveBeenCalled();
  });
});

describe("module kho", () => {
  it("cấp link tải lên cho đường dẫn do máy chủ sinh, trong thư mục của người tải; bỏ tệp bị chặn", async () => {
    withWorld({ attachments: { data: [], error: null }, people: 0 });
    const out = await capLinkTaiTep({
      seasonId: SEASON,
      actorId: ACTOR,
      current: [],
      files: [
        { name: "Hướng dẫn.pdf", size: 1000 },
        { name: "virus.exe", size: 1000 }
      ]
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.links).toHaveLength(1);
    expect(out.links[0].path).toMatch(new RegExp(`^${SEASON}/${ACTOR}/[0-9a-f-]{36}/huong-dan\\.pdf$`));
    expect(out.links[0].mime).toBe("application/pdf");
    expect(out.problems[0]).toContain("virus.exe");
    expect(storageCalls.map((c) => c.op)).toEqual(["createSignedUploadUrl:mail-dinh-kem"]);
  });

  it("toàn tệp bị chặn thì không cấp link nào", async () => {
    withWorld({ attachments: { data: [], error: null }, people: 0 });
    const out = await capLinkTaiTep({ seasonId: SEASON, actorId: ACTOR, current: [], files: [{ name: "a.sh", size: 1 }] });
    expect(out.ok).toBe(false);
    expect(storageCalls).toEqual([]);
  });

  it("kiểm tệp bằng siêu dữ liệu THẬT trong kho", async () => {
    const folder = P1.slice(0, P1.lastIndexOf("/"));
    withWorld({
      attachments: { data: [], error: null },
      people: 0,
      listed: { [folder]: { data: [{ name: "huong-dan.pdf", metadata: { size: 11 * 1024 * 1024, mimetype: "application/pdf" } }], error: null } }
    });
    const tooBig = await kiemTepDaTai([{ path: P1, name: "Hướng dẫn.pdf" }]);
    expect(tooBig.ok).toBe(false);

    withWorld({
      attachments: { data: [], error: null },
      people: 0,
      listed: { [folder]: { data: [{ name: "huong-dan.pdf", metadata: { size: 5000, mimetype: "application/pdf" } }], error: null } }
    });
    const ok = await kiemTepDaTai([{ path: P1, name: "Hướng dẫn.pdf" }]);
    expect(ok).toEqual({ ok: true, files: [{ path: P1, name: "Hướng dẫn.pdf", size: 5000, mime: "application/pdf" }] });
  });

  it("chốt tệp vào lô: đúng các cột, đúng thứ tự", async () => {
    withWorld({ attachments: { data: [], error: null }, people: 0 });
    const out = await ganTepVaoLo({
      batchId: BATCH,
      seasonId: SEASON,
      actorId: ACTOR,
      files: [
        { path: P1, name: "Hướng dẫn.pdf", size: 5000, mime: "application/pdf" },
        { path: P2, name: "Lịch.ics", size: 300, mime: "text/calendar" }
      ]
    });
    expect(out.error).toBeNull();
    expect(writes).toEqual([
      {
        table: "email_attachments",
        op: "insert",
        filters: [],
        payload: [
          { batch_id: BATCH, season_id: SEASON, uploaded_by: ACTOR, position: 0, storage_path: P1, file_name: "Hướng dẫn.pdf", content_type: "application/pdf", size_bytes: 5000 },
          { batch_id: BATCH, season_id: SEASON, uploaded_by: ACTOR, position: 1, storage_path: P2, file_name: "Lịch.ics", content_type: "text/calendar", size_bytes: 300 }
        ]
      }
    ]);
  });

  it("không tệp thì không ghi gì", async () => {
    withWorld({ attachments: { data: [], error: null }, people: 0 });
    expect(await ganTepVaoLo({ batchId: BATCH, seasonId: SEASON, actorId: ACTOR, files: [] })).toEqual({ error: null });
    expect(writes).toEqual([]);
  });

  it("chốt tệp hỏng thì đóng lô vừa mở, báo chưa lá nào đi", async () => {
    withWorld({ attachments: { data: [], error: null }, people: 0, insertError: { code: "23514", message: "check" } });
    const out = await ganTepVaoLo({
      batchId: BATCH,
      seasonId: SEASON,
      actorId: ACTOR,
      files: [{ path: P1, name: "Hướng dẫn.pdf", size: 5000, mime: "application/pdf" }]
    });
    expect(out.error).toContain("chưa lá thư nào đi");
    const close = writes.find((w) => w.table === "email_batches");
    expect(close?.payload).toMatchObject({ status: "failed" });
    expect(close?.filters).toContainEqual(["eq", "id", BATCH]);
  });

  it("không xoá tệp của người khác, cũng không xoá tệp đã gắn vào lô", async () => {
    withWorld({ attachments: { data: [], error: null }, people: 0 });
    const foreign = `${SEASON}/00000000-0000-4000-8000-0000000000a9/${U1}/x.pdf`;
    expect(await boTepDaTai({ seasonId: SEASON, actorId: ACTOR, path: foreign })).toEqual({ ok: false });
    expect(storageCalls).toEqual([]);

    withWorld({ attachments: { data: [{ id: "x" }], error: null }, people: 0 });
    expect(await boTepDaTai({ seasonId: SEASON, actorId: ACTOR, path: P1 })).toEqual({ ok: false });
    expect(storageCalls).toEqual([]);

    withWorld({ attachments: { data: [], error: null }, people: 0 });
    expect(await boTepDaTai({ seasonId: SEASON, actorId: ACTOR, path: P1 })).toEqual({ ok: true });
    expect(storageCalls).toEqual([{ op: "remove:mail-dinh-kem", args: [[P1]] }]);
  });
});
