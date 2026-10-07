/**
 * Thứ tự "mới nhất trước" dùng chung cho các danh sách bản ghi (BTC 07/10/2026).
 *
 * Ca nào cũng soi đúng cái làm hỏng thứ tự trên production: mốc thời gian đến
 * từ nhiều nguồn với nhiều dạng chuỗi, dòng thiếu mốc, và đọc phân trang theo
 * UUID ngẫu nhiên.
 */
import { describe, expect, it } from "vitest";
import { byVietnameseName, compareNewest, createdAtOf, newestFirst, parseInstant } from "@/lib/list-order";

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

describe("compareNewest", () => {
  it("so theo thời điểm, không theo chuỗi: ba dạng ISO khác nhau vẫn xếp đúng", () => {
    const rows = [
      { id: "plus7", at: "2026-10-05T15:00:00+07:00" }, // 08:00Z
      { id: "pgrst", at: "2026-10-05T09:30:00+00:00" }, // 09:30Z
      { id: "jsz", at: "2026-10-05T08:30:00.000Z" } // 08:30Z
    ];
    // So chuỗi giảm dần sẽ ra plus7 → pgrst → jsz ("T15" > "T09" > "T08").
    expect(ids(newestFirst(rows, (row) => row.at))).toEqual(["pgrst", "jsz", "plus7"]);
  });

  it("cột DATE và timestamptz so chung được", () => {
    expect(compareNewest("2026-10-06", "2026-10-05T23:00:00Z")).toBeLessThan(0);
  });

  it("mốc vắng hoặc hỏng luôn xuống cuối", () => {
    const rows = [
      { id: "a", at: null },
      { id: "b", at: "không phải ngày" },
      { id: "c", at: "2026-01-01T00:00:00Z" },
      { id: "d", at: "2026-10-01T00:00:00Z" }
    ];
    expect(ids(newestFirst(rows, (row) => row.at))).toEqual(["d", "c", "a", "b"]);
    expect(parseInstant("không phải ngày")).toBeNull();
  });
});

describe("newestFirst", () => {
  it("mốc đầu hoà hoặc vắng thì so mốc sau", () => {
    const rows = [
      { id: "same-old", updated: "2026-10-01T00:00:00Z", created: "2026-09-01T00:00:00Z" },
      { id: "same-new", updated: "2026-10-01T00:00:00Z", created: "2026-09-20T00:00:00Z" },
      { id: "no-update", updated: null, created: "2026-10-05T00:00:00Z" },
      { id: "latest", updated: "2026-10-07T00:00:00Z", created: "2026-08-01T00:00:00Z" }
    ];
    expect(ids(newestFirst(rows, (row) => row.updated, (row) => row.created))).toEqual(["latest", "same-new", "same-old", "no-update"]);
  });

  it("hoà hết thì id tăng dần — đúng thứ tự đọc phân trang, không nhảy giữa hai lần tải", () => {
    const rows = [{ id: "c" }, { id: "a" }, { id: "b" }];
    expect(ids(newestFirst(rows))).toEqual(["a", "b", "c"]);
  });

  it("trả bản sao, không xếp đè lên mảng của người gọi", () => {
    const rows = [
      { id: "old", at: "2026-01-01T00:00:00Z" },
      { id: "new", at: "2026-10-01T00:00:00Z" }
    ];
    newestFirst(rows, (row) => row.at);
    expect(ids(rows)).toEqual(["old", "new"]);
  });

  it("createdAtOf đọc được created_at của dòng mà kiểu TS không khai cột đó", () => {
    expect(createdAtOf({ created_at: "2026-10-07T00:00:00Z" })).toBe("2026-10-07T00:00:00Z");
    expect(createdAtOf({ created_at: 42 })).toBeNull();
    expect(createdAtOf({})).toBeNull();
  });
});

describe("byVietnameseName", () => {
  it("theo chữ cái tiếng Việt: Á cùng chỗ với A, Đ đứng sau D, tên trống xuống cuối", () => {
    const rows = [
      { id: "1", name: "Đặng Văn E" },
      { id: "2", name: "" },
      { id: "3", name: "Dương Thị D" },
      { id: "4", name: "Bùi Văn B" },
      { id: "5", name: null },
      // So theo mã ký tự thì "Á" (U+00C1) đứng sau mọi chữ Latinh không dấu.
      { id: "6", name: "Ánh Nguyễn" }
    ];
    expect(ids(byVietnameseName(rows, (row) => row.name))).toEqual(["6", "4", "3", "1", "2", "5"]);
  });
});
