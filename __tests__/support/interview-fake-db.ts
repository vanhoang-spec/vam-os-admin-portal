/**
 * __tests__/support/interview-fake-db.ts
 *
 * Bản giả Supabase cho bộ lịch phỏng vấn — chép khuôn từ
 * event-survey-server.test.ts và thêm hai thứ mã thật cần: phép lọc `.is()`
 * (claim đặt-chỗ-trước lọc `claimed_at is null`) và cổng `rpc` cắm được.
 *
 * `defaultsFor` cấp đúng giá trị mặc định mà migration 20260922100000 đặt.
 * Thiếu chúng thì dòng mời vừa chèn mang `send_count: undefined`, phép lọc
 * đến-hạn không thấy nó, và test xanh cho một bộ gửi không gửi gì — đúng kiểu
 * "bản giả nuốt lệnh" mà CLAUDE.md cảnh báo. `duplicate` thi hành các chỉ số
 * duy nhất để chèn trùng trả 23505 như database thật.
 */
import { vi } from "vitest";

export type Row = Record<string, any>;
export type Filter = { op: "eq" | "neq" | "in" | "lt" | "is"; column: string; value: any };
export type Write = { table: string; op: "insert" | "update" | "upsert"; values: any; filters: Filter[] };

export const DUPLICATE = { code: "23505", message: "duplicate key value violates unique constraint" };

export class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: Write[] = [];
  failures = new Map<string, { code: string; message: string }>();
  private seq = 0;

  uuid() {
    this.seq += 1;
    return `00000000-0000-4000-9000-${String(this.seq).padStart(12, "0")}`;
  }

  rows(table: string) {
    return (this.tables[table] ??= []);
  }

  writesTo(table: string, op?: Write["op"]) {
    return this.writes.filter((write) => write.table === table && (!op || write.op === op));
  }
}

/** Giá trị mặc định của cột, đúng như migration 20260922100000 đặt. */
function defaultsFor(db: FakeDb, table: string): Row {
  if (table === "interview_slots") {
    return { status: "open", booked_application_id: null, removed_at: null, available_since: "2026-09-01T00:00:00.000Z" };
  }
  if (table === "interview_slot_invites") {
    return {
      token: db.uuid(),
      send_count: 0,
      first_sent_at: null,
      last_sent_at: null,
      claimed_at: null,
      last_error: null
    };
  }
  if (table === "interview_bookings") {
    return { status: "booked", cancelled_at: null, cancelled_by: null, cancel_note: null };
  }
  if (table === "interview_mentor_availability") {
    // Cùng lý do với interview_slots: thiếu `status` thì phép lọc "đang chờ"
    // không thấy dòng nào, và test xanh cho một bảng rỗng.
    return {
      status: "open",
      matched_booking_id: null,
      matched_at: null,
      removed_at: null,
      available_since: "2026-09-01T00:00:00.000Z"
    };
  }
  return {};
}

/** Các chỉ số duy nhất mà bộ giả phải thi hành để test nói đúng sự thật. */
function duplicate(table: string, row: Row, candidate: Row): boolean {
  if (table === "interview_slots") {
    return row.admin_user_id === candidate.admin_user_id && row.slot_starts_at === candidate.slot_starts_at;
  }
  if (table === "interview_slot_invites") {
    return (
      row.application_id === candidate.application_id ||
      (candidate.token !== undefined && row.token === candidate.token)
    );
  }
  if (table === "interviewer_profiles") {
    return row.admin_user_id === candidate.admin_user_id;
  }
  if (table === "interview_mentor_availability") {
    return row.application_id === candidate.application_id && row.slot_starts_at === candidate.slot_starts_at;
  }
  return false;
}

export class Query {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private filters: Filter[] = [];
  private payload: any;
  private returning = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private ignoreDuplicates = false;
  private onConflictMerge = false;

  constructor(
    private db: FakeDb,
    private table: string
  ) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: any) {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  upsert(values: any, options?: { ignoreDuplicates?: boolean; onConflict?: string }) {
    this.op = "upsert";
    this.payload = values;
    this.ignoreDuplicates = options?.ignoreDuplicates === true;
    this.onConflictMerge = !this.ignoreDuplicates;
    return this;
  }
  update(values: any) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  eq(column: string, value: any) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: any) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  in(column: string, values: any[]) {
    this.filters.push({ op: "in", column, value: [...values] });
    return this;
  }
  is(column: string, value: any) {
    this.filters.push({ op: "is", column, value });
    return this;
  }
  gt(column: string, value: any) {
    // Phân trang keyset và phép "chỉ giờ tương lai" đi qua đây; bộ giả trả đủ
    // trong một trang nên chỉ cần lọc so sánh chuỗi ISO.
    this.filters.push({ op: "lt", column: `__gt__${column}`, value });
    return this;
  }
  lt(column: string, value: any) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(value: number) {
    this.max = value;
    return this;
  }
  range() {
    return this;
  }
  maybeSingle() {
    return this.run().then((result: any) => ({
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      error: result.error
    }));
  }
  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this.run().then(resolve, reject);
  }

  private matches(row: Row) {
    return this.filters.every((filter) => {
      if (filter.column.startsWith("__gt__")) {
        const column = filter.column.slice(6);
        return String(row[column] ?? "") > String(filter.value);
      }
      const value = row[filter.column];
      if (filter.op === "eq") return value === filter.value;
      if (filter.op === "neq") return value !== filter.value;
      if (filter.op === "in") return filter.value.includes(value);
      if (filter.op === "is") return filter.value === null ? value == null : value === filter.value;
      return value != null && String(value) < String(filter.value);
    });
  }

  private async run(): Promise<{ data: any; error: any }> {
    // Nhường vòng lặp sự kiện một nhịp — hai lượt gọi đồng thời vì thế đan
    // xen thật, và ca "hai tab cùng bấm" kiểm được điều nó nói.
    await Promise.resolve();
    const rows = this.db.rows(this.table);
    const failureKey = `${this.table}:${this.op}`;
    const failure = this.db.failures.get(failureKey);
    if (failure) {
      this.db.failures.delete(failureKey);
      return { data: null, error: failure };
    }

    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      this.db.writes.push({ table: this.table, op: this.op, values: this.payload, filters: [] });

      const inserted: Row[] = [];
      for (const item of list) {
        const clash = rows.find((row) => duplicate(this.table, row, item));
        if (clash) {
          if (this.op === "insert") return { data: null, error: DUPLICATE };
          if (this.ignoreDuplicates) continue;
          if (this.onConflictMerge) Object.assign(clash, item);
          continue;
        }
        const row = { id: this.db.uuid(), ...defaultsFor(this.db, this.table), ...item };
        rows.push(row);
        inserted.push({ ...row });
      }
      return { data: this.returning ? inserted : null, error: null };
    }

    if (this.op === "update") {
      const affected = rows.filter((row) => this.matches(row));
      for (const row of affected) Object.assign(row, this.payload);
      this.db.writes.push({ table: this.table, op: "update", values: this.payload, filters: [...this.filters] });
      return { data: this.returning ? affected.map((row) => ({ ...row })) : null, error: null };
    }

    let result = rows.filter((row) => this.matches(row)).map((row) => ({ ...row }));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result.sort((left, right) => {
        const comparison = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
        return ascending ? comparison : -comparison;
      });
    }
    if (this.max !== null) result = result.slice(0, this.max);
    return { data: result, error: null };
  }
}

/** Client giả: bảng đi qua Query, còn `rpc` là mock cắm từ ngoài vào. */
export function clientFor(db: FakeDb, rpc = vi.fn()) {
  return { from: (table: string) => new Query(db, table), rpc };
}
