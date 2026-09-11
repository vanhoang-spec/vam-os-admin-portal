/**
 * readAllPagesIn — đọc mọi dòng theo một danh sách id.
 *
 * Hai lớp phải có cùng lúc: chia danh sách thành khối (một `.in()` nghìn id là
 * một URL nhiều proxy từ chối), VÀ đọc hết từng khối theo trang (hai trăm người
 * có thể sở hữu hơn một nghìn dòng). Thiếu lớp nào cũng mất dòng mà không báo.
 */
import { describe, expect, it } from "vitest";
import { IN_FILTER_CHUNK, readAllPagesIn } from "@/lib/paged-read";
import { createFakeDb, fakeClient, requestsFor } from "./support/fake-postgrest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("đọc đủ, không trùng", () => {
  it.each([1, IN_FILTER_CHUNK - 1, IN_FILTER_CHUNK, IN_FILTER_CHUNK + 1, 450])(
    "%i id, trần mỗi trang thấp hơn cỡ một khối",
    async (count) => {
      const db = createFakeDb({ maxRows: 150 });
      const ids = Array.from({ length: count }, (_, index) => id(index + 1));
      db.tables.people = ids.map((personId) => ({ id: personId, full_name: personId }));
      db.tables.people.push({ id: id(999_999), full_name: "không nằm trong danh sách" });

      const result = await readAllPagesIn<{ id: string }>(fakeClient(db), "people", "id", ids, "id,full_name");

      expect(result.error).toBeNull();
      expect(result.data.map((row) => row.id).sort()).toEqual([...ids].sort());
      for (const request of requestsFor(db, "people")) {
        const inFilter = JSON.parse(request.filters).find((filter: { kind: string }) => filter.kind === "in");
        expect(inFilter.values.length).toBeLessThanOrEqual(IN_FILTER_CHUNK);
        expect(request.order).toEqual(["id:asc"]);
      }
    }
  );

  it("một chủ sở hữu nhiều dòng hơn trần một trang: vẫn đọc hết", async () => {
    const db = createFakeDb({ maxRows: 100 });
    db.tables.outbound_emails = Array.from({ length: 260 }, (_, index) => ({
      id: `email-${String(index).padStart(6, "0")}`,
      related_id: "nguoi-1"
    }));

    const result = await readAllPagesIn(fakeClient(db), "outbound_emails", "related_id", ["nguoi-1"], "id,related_id");

    expect(result.data).toHaveLength(260);
  });
});

describe("bộ lọc thêm", () => {
  it("có mặt ở MỌI trang của mọi khối", async () => {
    const db = createFakeDb({ maxRows: 100 });
    const ids = Array.from({ length: 300 }, (_, index) => id(index + 1));
    db.tables.outbound_emails = ids.flatMap((personId, index) => [
      { id: `a-${String(index).padStart(6, "0")}`, related_id: personId, kind: "participant_invite" },
      { id: `b-${String(index).padStart(6, "0")}`, related_id: personId, kind: "general_announcement" }
    ]);

    const result = await readAllPagesIn<{ kind: string }>(
      fakeClient(db),
      "outbound_emails",
      "related_id",
      ids,
      "id,related_id,kind",
      (query) => query.eq("kind", "participant_invite")
    );

    expect(result.data).toHaveLength(300);
    expect(result.data.every((row) => row.kind === "participant_invite")).toBe(true);
    for (const request of requestsFor(db, "outbound_emails")) {
      expect(request.filters).toContain('"column":"kind","value":"participant_invite"');
    }
  });
});

describe("không che lỗi", () => {
  it("một khối sau hỏng thì cả phép đọc báo lỗi", async () => {
    const db = createFakeDb();
    const ids = Array.from({ length: IN_FILTER_CHUNK * 2 + 5 }, (_, index) => id(index + 1));
    db.tables.people = ids.map((personId) => ({ id: personId }));
    db.injectError = (_request, prior) => (prior >= 2 ? { code: "57014", message: "statement timeout" } : null);

    const result = await readAllPagesIn(fakeClient(db), "people", "id", ids, "id");

    expect(result.error).toMatchObject({ code: "57014" });
  });

  it("danh sách rỗng thì không gửi truy vấn nào; id trùng và id trống bị bỏ", async () => {
    const db = createFakeDb();
    db.tables.people = [{ id: id(1) }];

    expect((await readAllPagesIn(fakeClient(db), "people", "id", [], "id")).data).toEqual([]);
    expect(db.requests).toHaveLength(0);

    await readAllPagesIn(fakeClient(db), "people", "id", [id(1), id(1), "", "  "], "id");
    const inFilter = JSON.parse(requestsFor(db, "people")[0].filters).find((filter: { kind: string }) => filter.kind === "in");
    expect(inFilter.values).toEqual([id(1)]);
  });
});
